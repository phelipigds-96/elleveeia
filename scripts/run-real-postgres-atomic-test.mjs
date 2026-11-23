/**
 * scripts/run-real-postgres-atomic-test.mjs
 * 
 * ELLEVEE IA — AC-04.5-P0.3 / P0.4: RUNNER LOCAL DE TESTES EM POSTGRESQL REAL
 * 
 * Executa a validação reproduzível da RPC save_enterprise_quote_atomic utilizando
 * duas conexões PostgreSQL reais e independentes (pg.Client nativo), eliminando
 * limitações de afinidade de sessão do Supabase SQL Editor e garantindo:
 * 
 * 1. Fixtures de concorrência visíveis às duas conexões.
 * 2. Sessão primária com manifesto em memória disponível até o fim.
 * 3. Teardown cirúrgico garantido no bloco finally, mesmo em caso de erro.
 * 4. Nenhuma dependência de tabelas temporárias entre sessões.
 * 5. Independência total de afinidade do SQL Editor.
 * 6. Teste de concorrência atômica real com serialização por advisory locks.
 * 
 * AMBIENTE AUTORIZADO:
 * Supabase Staging: dkjrpdhymtkgbknocijy (db.dkjrpdhymtkgbknocijy.supabase.co)
 * 
 * AMBIENTE PROIBIDO (NUNCA EXECUTAR):
 * Supabase Produção: ipxhkwirzrigttpwzwbl
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'

export const STAGING_PROJECT_ID = 'dkjrpdhymtkgbknocijy'
export const PRODUCTION_PROJECT_ID = 'ipxhkwirzrigttpwzwbl'
export const STAGING_DB_HOST = `db.${STAGING_PROJECT_ID}.supabase.co`

const ROOT = process.cwd()
const WORKSPACE_DIR = path.join(ROOT, '.staging-workspace')

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    dryRun: false,
    keepFixtures: false,
    skipConcurrency: false,
    help: false,
  }

  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--keep-fixtures') options.keepFixtures = true
    else if (arg === '--skip-concurrency') options.skipConcurrency = true
    else if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

function printHelp() {
  console.log(`
Uso: node scripts/run-real-postgres-atomic-test.mjs [opções]

Opções:
  --dry-run            Executa apenas consultas de compatibilidade pré-migration (somente leitura).
  --keep-fixtures      Não executa teardown ao final (para inspeção manual detalhada).
  --skip-concurrency   Pula o teste de duas conexões concorrentes.
  --help, -h           Exibe esta ajuda.

Variáveis de Ambiente / Configuração:
  Lidas automaticamente de .env.staging.local:
    - STAGING_DB_PASSWORD
    - STAGING_SUPABASE_SERVICE_ROLE_KEY
  Ou fornecidas via variáveis de ambiente padrão:
    - DATABASE_URL / STAGING_DATABASE_URL
`)
}

function getStagingConfig() {
  // Guarda de Produção em variáveis de ambiente
  const allEnvKeys = Object.keys(process.env)
  for (const k of allEnvKeys) {
    const val = process.env[k] || ''
    if (val.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL SECURITY GUARD] Referência ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID}) detectada na variável ${k}! Abortando imediatamente.`)
    }
  }

  const envPath = path.join(ROOT, '.env.staging.local')
  let dbPassword = process.env.STAGING_DB_PASSWORD
  let dbHost = process.env.STAGING_DB_HOST || STAGING_DB_HOST
  let dbPort = parseInt(process.env.STAGING_DB_PORT || '5432', 10)
  let dbUser = process.env.STAGING_DB_USER || 'postgres'
  let dbName = process.env.STAGING_DB_NAME || 'postgres'

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8')
    if (content.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL SECURITY GUARD] Referência ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID}) em .env.staging.local!`)
    }
    const passMatch = content.match(/STAGING_DB_PASSWORD=([^\r\n]+)/)
    if (passMatch && !dbPassword) {
      dbPassword = passMatch[1].trim()
    }
  }

  // Suporte a DATABASE_URL / STAGING_DATABASE_URL
  const connStr = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL
  if (connStr) {
    if (connStr.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL SECURITY GUARD] Connection string aponta para PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
    }
    return { connectionString: connStr }
  }

  if (!dbPassword) {
    throw new Error('Senha do banco não encontrada. Configure STAGING_DB_PASSWORD em .env.staging.local ou no ambiente.')
  }

  return {
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: { rejectUnauthorized: false },
  }
}

function createClient(config, label = 'Conexão') {
  const clientConfig = config.connectionString
    ? { connectionString: config.connectionString, ssl: { rejectUnauthorized: false } }
    : { ...config }
  
  const client = new pg.Client(clientConfig)
  client.on('error', (err) => {
    console.error(`[${label}] Erro na conexão PostgreSQL:`, err.message)
  })
  return client
}

function ensureWorkspaceDir() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
}

async function runPreflightChecks(client) {
  console.log('\n--- [SEÇÃO 1] CONSULTAS DE COMPATIBILIDADE PRÉ-MIGRATION (SOMENTE LEITURA) ---')
  
  // 1.1 Múltiplos orçamentos ativos para a mesma conversa
  const q1 = await client.query(`
    SELECT 
        company_id,
        (metadata->>'conversation_id') AS conversation_id,
        COUNT(*) AS total_ativos,
        ARRAY_AGG(id) AS quote_ids
    FROM public.quotes
    WHERE status IN ('draft', 'pending_validation', 'ready')
      AND (metadata->>'conversation_id') IS NOT NULL
    GROUP BY company_id, (metadata->>'conversation_id')
    HAVING COUNT(*) > 1;
  `)
  if (q1.rows.length > 0) {
    console.warn(`⚠️ ALERTA: Encontradas ${q1.rows.length} conversas com múltiplos orçamentos ativos! Requer resolução antes de aplicar o índice único.`)
    console.table(q1.rows)
  } else {
    console.log('✓ Nenhuma colisão prévia: zero conversas com múltiplos orçamentos ativos.')
  }

  // 1.2 Orçamentos ativos sem conversation_id
  const q2 = await client.query(`
    SELECT COUNT(*) AS total_sem_conv
    FROM public.quotes
    WHERE status IN ('draft', 'pending_validation', 'ready')
      AND (metadata->>'conversation_id' IS NULL OR (metadata->>'conversation_id') = '');
  `)
  console.log(`✓ Orçamentos ativos sem conversation_id existentes: ${q2.rows[0].total_sem_conv}`)

  // 1.3 Resumo de status
  const q3 = await client.query(`
    SELECT status, COUNT(*) AS count
    FROM public.quotes
    GROUP BY status
    ORDER BY count DESC;
  `)
  console.log('✓ Distribuição geral de status em public.quotes:')
  console.table(q3.rows)
}

async function runPermissionChecks(client) {
  console.log('\n--- [SEÇÃO 2] VALIDAÇÃO DE PERMISSÕES E PRINCÍPIO DO MENOR PRIVILÉGIO ---')

  // Verifica existência da função
  const rpcCheck = await client.query(`
    SELECT routine_name, security_type 
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
      AND routine_name = 'save_enterprise_quote_atomic';
  `)
  if (rpcCheck.rows.length === 0) {
    throw new Error('RPC public.save_enterprise_quote_atomic não encontrada! Aplique a migration 2026112204 primeiro.')
  }
  console.log(`✓ RPC save_enterprise_quote_atomic confirmada (Security: ${rpcCheck.rows[0].security_type}).`)

  // 2.1 Teste com anon
  let anonRejected = false
  try {
    await client.query('SET ROLE anon;')
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := gen_random_uuid(),
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
      );
    `)
  } catch (err) {
    if (err.code === '42501' || err.message.includes('permission denied')) {
      anonRejected = true
    } else {
      console.warn(`[anon check] Erro inesperado: ${err.code} - ${err.message}`)
    }
  } finally {
    await client.query('RESET ROLE;')
  }

  if (!anonRejected) {
    throw new Error('FALHA DE SEGURANÇA: Role anon conseguiu executar save_enterprise_quote_atomic ou não recebeu 42501!')
  }
  console.log('✓ Chamada direta como anon rejeitada com insufficient_privilege (42501).')

  // 2.2 Teste com authenticated
  let authRejected = false
  try {
    await client.query('SET ROLE authenticated;')
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := gen_random_uuid(),
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
      );
    `)
  } catch (err) {
    if (err.code === '42501' || err.message.includes('permission denied')) {
      authRejected = true
    } else {
      console.warn(`[authenticated check] Erro inesperado: ${err.code} - ${err.message}`)
    }
  } finally {
    await client.query('RESET ROLE;')
  }

  if (!authRejected) {
    throw new Error('FALHA DE SEGURANÇA: Role authenticated conseguiu executar save_enterprise_quote_atomic ou não recebeu 42501!')
  }
  console.log('✓ Chamada direta como authenticated rejeitada com insufficient_privilege (42501).')
}

async function setupFixtures(client1, client2, manifest) {
  console.log('\n--- [SEÇÃO 3] SETUP DE FIXTURES SINTÉTICAS RASTREADAS ---')
  const runSuffix = manifest.runTag

  // Gera UUIDs aleatórios
  const companyA = crypto.randomUUID()
  const customerA = crypto.randomUUID()
  const convA1 = crypto.randomUUID()
  const convA2 = crypto.randomUUID()
  const convConc = crypto.randomUUID()
  const prodA1 = crypto.randomUUID()
  const prodA2 = crypto.randomUUID()

  const companyB = crypto.randomUUID()
  const customerB = crypto.randomUUID()
  const convB = crypto.randomUUID()
  const prodB = crypto.randomUUID()

  // 1. Empresa A e entidades associadas
  await client1.query(`
    INSERT INTO public.companies (id, name, slug)
    VALUES ($1, $2, $3);
  `, [companyA, `Empresa Teste AC-04.5 ${runSuffix}`, `empresa-teste-ac045-${runSuffix}`])
  manifest.companies.push(companyA)

  await client1.query(`
    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES ($1, $2, $3, $4, $5);
  `, [customerA, companyA, `Cliente Teste ${runSuffix}`, '+5511999990001', `teste-${runSuffix}@ellevee.ia`])
  manifest.customers.push(customerA)

  await client1.query(`
    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES 
      ($1, $2, $3, 'whatsapp', 'open'),
      ($4, $2, $3, 'whatsapp', 'open'),
      ($5, $2, $3, $6, 'open');
  `, [convA1, companyA, customerA, convA2, convConc, `test_concorrencia_${runSuffix}`])
  manifest.conversations.push(convA1, convA2, convConc)

  await client1.query(`
    INSERT INTO public.products (id, company_id, name, normalized_name, active)
    VALUES 
      ($1, $2, $3, $4, true),
      ($5, $2, $6, $7, true);
  `, [
    prodA1, companyA, `Produto Sintético A ${runSuffix}`, `produto sintetico a ${runSuffix}`,
    prodA2, companyA, `Produto Sintético B ${runSuffix}`, `produto sintetico b ${runSuffix}`
  ])
  manifest.products.push(prodA1, prodA2)

  // 2. Empresa B (Invasor para testes de fronteira multi-tenant)
  await client1.query(`
    INSERT INTO public.companies (id, name, slug)
    VALUES ($1, $2, $3);
  `, [companyB, `Empresa Invasora B ${runSuffix}`, `empresa-invasora-b-${runSuffix}`])
  manifest.companies.push(companyB)

  await client1.query(`
    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES ($1, $2, $3, $4, $5);
  `, [customerB, companyB, `Cliente Invasor B ${runSuffix}`, '+5511888880002', `invasor-b-${runSuffix}@ellevee.ia`])
  manifest.customers.push(customerB)

  await client1.query(`
    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES ($1, $2, $3, 'whatsapp', 'open');
  `, [convB, companyB, customerB])
  manifest.conversations.push(convB)

  await client1.query(`
    INSERT INTO public.products (id, company_id, name, normalized_name, active)
    VALUES ($1, $2, $3, $4, true);
  `, [prodB, companyB, `Produto Sintético B Invasor ${runSuffix}`, `produto sintetico b invasor ${runSuffix}`])
  manifest.products.push(prodB)

  // Atualiza arquivo de manifesto
  persistManifest(manifest)

  console.log(`✓ Fixtures sintéticas criadas e comitadas no PostgreSQL (runTag=${runSuffix}).`)

  // Validação essencial: Provar que Conexão 2 enxerga as fixtures comitadas
  const c2Check = await client2.query('SELECT id FROM public.conversations WHERE id = $1', [convConc])
  if (c2Check.rows.length === 0) {
    throw new Error('Falha de visibilidade: Conexão 2 não conseguiu consultar a conversa de concorrência comitada pela Conexão 1!')
  }
  console.log('✓ Visibilidade mútua comprovada: Conexão 2 consultou diretamente as fixtures criadas pela Conexão 1.')

  return {
    companyA, customerA, convA1, convA2, convConc, prodA1, prodA2,
    companyB, customerB, convB, prodB,
  }
}

async function runAcidTests(client, fixtures, manifest) {
  console.log('\n--- [SEÇÃO 4] TESTES TRANSACIONAIS ACID, INVARIANTES E ROLLBACK (Conexão 1) ---')
  const { companyA, customerA, convA1, convA2, prodA1, companyB, customerB } = fixtures

  // 4.1 Criação de Orçamento Inicial (Versão 1)
  const res1 = await client.query(`
    SELECT public.save_enterprise_quote_atomic(
      p_company_id := $1,
      p_customer_id := $2,
      p_conversation_id := $3,
      p_status := 'draft',
      p_total := 70.00,
      p_metadata := '{"canal": "whatsapp_staging", "observacao_comercial": "pedido inicial"}'::jsonb,
      p_items := jsonb_build_array(
        jsonb_build_object('product_id', $4::uuid, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
      )
    ) AS res;
  `, [companyA, customerA, convA1, prodA1])
  
  const quote1 = res1.rows[0].res
  const quote1Id = quote1.id
  manifest.quotes.push(quote1Id)
  persistManifest(manifest)

  if (!quote1Id || quote1.version !== 1) {
    throw new Error(`4.1 Falhou: esperado version 1, recebido: ${JSON.stringify(quote1)}`)
  }
  console.log(`✓ 4.1 Criação de Orçamento Inicial aprovada (ID: ${quote1Id}, versão: ${quote1.version}).`)

  // 4.2 Atualização com Incremento de Versão e Preservação de Metadados (Versão 2)
  const res2 = await client.query(`
    SELECT public.save_enterprise_quote_atomic(
      p_company_id := $1,
      p_customer_id := $2,
      p_conversation_id := $3,
      p_existing_quote_id := $4,
      p_expected_version := 1,
      p_status := 'ready',
      p_total := 105.00,
      p_metadata := '{"desconto_concedido": "5%"}'::jsonb,
      p_items := jsonb_build_array(
        jsonb_build_object('product_id', $5::uuid, 'quantity', 3, 'unit_price', 35.00, 'subtotal', 105.00)
      )
    ) AS res;
  `, [companyA, customerA, convA1, quote1Id, prodA1])

  const quote2 = res2.rows[0].res
  if (quote2.version !== 2) {
    throw new Error(`4.2 Falhou: esperado version 2, recebido: ${JSON.stringify(quote2)}`)
  }

  // Verifica no banco a preservação dos metadados
  const metaCheck = await client.query('SELECT metadata FROM public.quotes WHERE id = $1', [quote1Id])
  const savedMeta = metaCheck.rows[0].metadata
  if (savedMeta.observacao_comercial !== 'pedido inicial') {
    throw new Error('4.2 Falhou: metadado observacao_comercial anterior foi apagado!')
  }
  if (savedMeta.desconto_concedido !== '5%') {
    throw new Error('4.2 Falhou: novo metadado desconto_concedido não foi gravado!')
  }
  console.log('✓ 4.2 Atualização de versão e mesclagem de metadados confirmadas (versão: 2).')

  // 4.3 Rollback Total em Falha de Criação (Zero Lixo Residual)
  const invalidProdId = crypto.randomUUID()
  let roll1Ok = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_status := 'draft',
        p_total := 50.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $4::uuid, 'quantity', 1, 'unit_price', 35.0, 'subtotal', 35.0),
          jsonb_build_object('product_id', $5::uuid, 'quantity', 1, 'unit_price', 15.0, 'subtotal', 15.0)
        )
      );
    `, [companyA, customerA, convA2, prodA1, invalidProdId])
  } catch (err) {
    if (err.message.includes('PRODUTO_NOT_FOUND')) {
      roll1Ok = true
    } else {
      throw err
    }
  }

  if (!roll1Ok) throw new Error('4.3 Falhou: inserção com produto inexistente não gerou erro!')

  // Verifica que zero registros foram gravados para convA2
  const cQuotes = await client.query("SELECT COUNT(*) FROM public.quotes WHERE metadata @> jsonb_build_object('conversation_id', $1::text)", [convA2])
  if (parseInt(cQuotes.rows[0].count, 10) !== 0) {
    throw new Error('4.3 Violação de atomicidade: orçamento residual encontrado após rollback de criação!')
  }
  console.log('✓ 4.3 Rollback total em falha de criação comprovado (0 resíduos).')

  // 4.4 Rollback em Falha de Atualização: Preservação Integral dos Itens Anteriores
  let roll2Ok = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_existing_quote_id := $4,
        p_expected_version := 2,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $5::uuid, 'quantity', 10, 'unit_price', 35.0, 'subtotal', 350.0),
          jsonb_build_object('product_id', $6::uuid, 'quantity', 1, 'unit_price', 10.0, 'subtotal', 10.0)
        )
      );
    `, [companyA, customerA, convA1, quote1Id, prodA1, invalidProdId])
  } catch (err) {
    if (err.message.includes('PRODUTO_NOT_FOUND')) {
      roll2Ok = true
    } else {
      throw err
    }
  }

  if (!roll2Ok) throw new Error('4.4 Falhou: atualização com item inválido não gerou erro!')

  // Verifica que o quote1 continua intacto na versão 2 com total 105.00 e itens originais
  const q1Intact = await client.query(`SELECT total, (metadata->>'version')::int AS version FROM public.quotes WHERE id = $1`, [quote1Id])
  if (parseFloat(q1Intact.rows[0].total) !== 105.00 || q1Intact.rows[0].version !== 2) {
    throw new Error(`4.4 Violação de atomicidade: estado do orçamento alterado após rollback de update! Total: ${q1Intact.rows[0].total}, Versão: ${q1Intact.rows[0].version}`)
  }
  console.log('✓ 4.4 Rollback em falha de atualização comprovado (versão 2 e total 105.00 preservados integralmente).')

  // 4.5 Concorrência Otimista: Rejeição de Versão Defasada
  let verConflict = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_existing_quote_id := $4,
        p_expected_version := 1, -- Banco está na versão 2!
        p_total := 35.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $5::uuid, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
        )
      );
    `, [companyA, customerA, convA1, quote1Id, prodA1])
  } catch (err) {
    if (err.message.includes('ORCAMENTO_CONCURRENCY_CONFLICT')) {
      verConflict = true
    } else {
      throw err
    }
  }
  if (!verConflict) throw new Error('4.5 Falhou: versão obsoleta não foi rejeitada com ORCAMENTO_CONCURRENCY_CONFLICT!')
  console.log('✓ 4.5 Concorrência otimista comprovada: sobrescrita com versão obsoleta bloqueada.')

  // 4.6 Isolamento entre Conversas (Bloqueio de Sequestro)
  let crossConvBlocked = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3, -- convA2 divergente do orçamento original!
        p_existing_quote_id := $4,
        p_expected_version := 2,
        p_total := 35.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $5::uuid, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
        )
      );
    `, [companyA, customerA, convA2, quote1Id, prodA1])
  } catch (err) {
    if (err.message.includes('ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN')) {
      crossConvBlocked = true
    } else {
      throw err
    }
  }
  if (!crossConvBlocked) throw new Error('4.6 Falhou: sequestro de orçamento entre conversas não foi bloqueado!')
  console.log('✓ 4.6 Isolamento entre conversas comprovado: tentativa de sequestro rejeitada.')

  // 4.7 Isolamento entre Clientes e Empresas
  let crossCustBlocked = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2, -- Cliente B de outra empresa!
        p_conversation_id := $3,
        p_total := 35.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $4::uuid, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
        )
      );
    `, [companyA, customerB, convA1, prodA1])
  } catch (err) {
    if (err.message.includes('ORCAMENTO_CROSS_COMPANY_FORBIDDEN') || err.message.includes('ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN')) {
      crossCustBlocked = true
    } else {
      throw err
    }
  }
  if (!crossCustBlocked) throw new Error('4.7 Falhou: cliente pertencente a outro tenant não foi rejeitado!')
  console.log('✓ 4.7 Isolamento multi-tenant de cliente comprovado: rejeição de cliente cruzado.')

  // 4.8 Validação Financeira Estrita
  // 4.8A Subtotal inconsistente
  let subtotalBlocked = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_status := 'draft',
        p_total := 80.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $4::uuid, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 80.00) -- Divergente de 70.00!
        )
      );
    `, [companyA, customerA, convA2, prodA1])
  } catch (err) {
    if (err.message.includes('FINANCEIRO_SUBTOTAL_INCONSISTENTE')) {
      subtotalBlocked = true
    } else {
      throw err
    }
  }
  if (!subtotalBlocked) throw new Error('4.8A Falhou: subtotal inconsistente (quantidade * preco <> subtotal) foi aceito!')

  // 4.8B Total inconsistente com soma dos itens
  let totalBlocked = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_status := 'draft',
        p_total := 100.00, -- Divergente de 70.00!
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $4::uuid, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
        )
      );
    `, [companyA, customerA, convA2, prodA1])
  } catch (err) {
    if (err.message.includes('FINANCEIRO_TOTAL_INCONSISTENTE')) {
      totalBlocked = true
    } else {
      throw err
    }
  }
  if (!totalBlocked) throw new Error('4.8B Falhou: total divergente da soma dos itens foi aceito!')

  console.log('✓ 4.8 Invariantes financeiras validadas (subtotal inconsistente e total divergente rejeitados com rigor).')
}

async function runConcurrencyTest(client1, client2, fixtures, manifest) {
  console.log('\n--- [SEÇÃO 5] TESTE DE CONCORRÊNCIA REAL COM DUAS CONEXÕES INDEPENDENTES ---')
  const { companyA, customerA, convConc, prodA1 } = fixtures

  console.log(`Iniciando corrida de concorrência na conversa: ${convConc}`)

  // 1. Conexão 1 abre transação e invoca a RPC (adquire advisory lock)
  await client1.query('BEGIN;')
  const q1Promise = client1.query(`
    SELECT public.save_enterprise_quote_atomic(
      p_company_id := $1,
      p_customer_id := $2,
      p_conversation_id := $3,
      p_status := 'draft',
      p_total := 35.00,
      p_items := jsonb_build_array(
        jsonb_build_object('product_id', $4::uuid, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
      )
    ) AS res;
  `, [companyA, customerA, convConc, prodA1])

  const q1Result = await q1Promise
  const q1Id = q1Result.rows[0].res.id
  manifest.quotes.push(q1Id)
  persistManifest(manifest)
  console.log(`[Conexão 1] Orçamento criado na transação (ID: ${q1Id}). Lock advisory retido...`)

  // 2. Conexão 2 abre transação e tenta criar simultaneamente na mesma conversa
  await client2.query('BEGIN;')
  console.log('[Conexão 2] Disparando criação simultânea na mesma conversa...')

  let c2Error = null
  const c2Promise = client2.query(`
    SELECT public.save_enterprise_quote_atomic(
      p_company_id := $1,
      p_customer_id := $2,
      p_conversation_id := $3,
      p_status := 'draft',
      p_total := 70.00,
      p_items := jsonb_build_array(
        jsonb_build_object('product_id', $4::uuid, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
      )
    ) AS res;
  `, [companyA, customerA, convConc, prodA1]).catch((err) => {
    c2Error = err
    return null
  })

  // Aguarda 250ms para garantir que Conexão 2 entrou na fila do advisory lock
  await new Promise((resolve) => setTimeout(resolve, 250))
  console.log('[Conexão 1] Comitando transação da Conexão 1 e liberando advisory lock...')
  await client1.query('COMMIT;')

  // Conexão 2 agora desbloqueia e é avaliada
  await c2Promise
  await client2.query('ROLLBACK;')

  if (!c2Error) {
    throw new Error('Falha de concorrência: Conexão 2 deveria ter sido bloqueada e rejeitada!')
  }

  if (!c2Error.message.includes('ORCAMENTO_ACTIVE_EXISTS')) {
    throw new Error(`Conexão 2 falhou com erro inesperado: ${c2Error.message}`)
  }

  console.log(`✓ [Conexão 2] Corretamente rejeitada com fail-closed: ${c2Error.message}`)

  // 3. Verifica integridade no banco: exatamente 1 orçamento ativo para a conversa
  const checkActive = await client1.query(`
    SELECT id, total, status 
    FROM public.quotes 
    WHERE company_id = $1 
      AND (metadata->>'conversation_id') = $2::text
      AND status IN ('draft', 'pending_validation', 'ready');
  `, [companyA, convConc])

  if (checkActive.rows.length !== 1) {
    throw new Error(`Falha de integridade: esperava exatamente 1 orçamento ativo, encontrados ${checkActive.rows.length}!`)
  }

  if (checkActive.rows[0].id !== q1Id || parseFloat(checkActive.rows[0].total) !== 35.00) {
    throw new Error(`Inconsistência de dados: orçamento ativo divergente do esperado! (${JSON.stringify(checkActive.rows[0])})`)
  }

  console.log(`✓ Serialização perfeita comprovada: exatamente 1 orçamento ativo retido (ID: ${q1Id}, total: 35.00).`)
}

async function performTeardown(client, manifest) {
  console.log('\n--- [SEÇÃO 6] TEARDOWN CIRÚRGICO E AUDITÁVEL DAS FIXTURES SINTÉTICAS ---')
  if (!client) {
    console.warn('Cliente não disponível para teardown.')
    return
  }

  try {
    // 1. Exclui quote_items vinculados aos quotes rastreados
    if (manifest.quotes.length > 0) {
      const delItems = await client.query(`
        DELETE FROM public.quote_items 
        WHERE quote_id = ANY($1::uuid[]);
      `, [manifest.quotes])
      console.log(`✓ quote_items excluídos: ${delItems.rowCount}`)

      const delQuotes = await client.query(`
        DELETE FROM public.quotes 
        WHERE id = ANY($1::uuid[]);
      `, [manifest.quotes])
      console.log(`✓ quotes excluídos: ${delQuotes.rowCount}`)
    }

    // 2. Exclui conversas sintéticas
    if (manifest.conversations.length > 0) {
      const delConvs = await client.query(`
        DELETE FROM public.conversations 
        WHERE id = ANY($1::uuid[]);
      `, [manifest.conversations])
      console.log(`✓ conversations excluídas: ${delConvs.rowCount}`)
    }

    // 3. Exclui produtos sintéticos
    if (manifest.products.length > 0) {
      const delProds = await client.query(`
        DELETE FROM public.products 
        WHERE id = ANY($1::uuid[]);
      `, [manifest.products])
      console.log(`✓ products excluídos: ${delProds.rowCount}`)
    }

    // 4. Exclui clientes sintéticos
    if (manifest.customers.length > 0) {
      const delCusts = await client.query(`
        DELETE FROM public.customers 
        WHERE id = ANY($1::uuid[]);
      `, [manifest.customers])
      console.log(`✓ customers excluídos: ${delCusts.rowCount}`)
    }

    // 5. Exclui empresas sintéticas
    if (manifest.companies.length > 0) {
      const delComps = await client.query(`
        DELETE FROM public.companies 
        WHERE id = ANY($1::uuid[]);
      `, [manifest.companies])
      console.log(`✓ companies excluídas: ${delComps.rowCount}`)
    }

    manifest.status = 'cleaned'
    persistManifest(manifest)
    console.log('✓ Teardown cirúrgico concluído com 100% de sucesso. Zero resíduos deixados no banco.')
  } catch (err) {
    console.error('❌ Erro durante o teardown:', err.message)
    manifest.status = 'teardown_failed'
    manifest.teardownError = err.message
    persistManifest(manifest)
  }
}

function persistManifest(manifest) {
  ensureWorkspaceDir()
  const manifestPath = path.join(WORKSPACE_DIR, `manifest-atomic-test-${manifest.runTag}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function main() {
  const options = parseArgs()
  if (options.help) {
    printHelp()
    process.exit(0)
  }

  console.log('==============================================================================')
  console.log('   ELLEVEE IA — RUNNER DE HOMOLOGAÇÃO POSTGRESQL REAL (AC-04.5-P0.3/P0.4)     ')
  console.log('==============================================================================')

  const config = getStagingConfig()
  const client1 = createClient(config, 'Conexão 1')
  const client2 = createClient(config, 'Conexão 2')

  const manifest = {
    runTag: `ac045_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
    startTime: new Date().toISOString(),
    status: 'initialized',
    companies: [],
    customers: [],
    conversations: [],
    products: [],
    quotes: [],
  }

  let executionFailed = false
  let failureError = null

  try {
    console.log(`\nConectando Conexão 1 ao host: ${config.host || 'DATABASE_URL'}...`)
    await client1.connect()
    console.log('✓ Conexão 1 estabelecida com sucesso.')

    console.log(`Conectando Conexão 2 ao host: ${config.host || 'DATABASE_URL'}...`)
    await client2.connect()
    console.log('✓ Conexão 2 estabelecida com sucesso.')

    // 1. Pré-flight
    await runPreflightChecks(client1)

    if (options.dryRun) {
      console.log('\n[Modo --dry-run] Consultas de pré-flight concluídas. Finalizando sem alterações.')
      return
    }

    // 2. Permissões
    await runPermissionChecks(client1)

    // 3. Setup de Fixtures
    const fixtures = await setupFixtures(client1, client2, manifest)

    // 4. Testes ACID
    await runAcidTests(client1, fixtures, manifest)

    // 5. Teste de Concorrência
    if (!options.skipConcurrency) {
      await runConcurrencyTest(client1, client2, fixtures, manifest)
    } else {
      console.log('\n[Aviso] Teste de concorrência pulado devido à flag --skip-concurrency.')
    }

    console.log('\n==============================================================================')
    console.log('   TODOS OS TESTES ATÔMICOS E DE CONCORRÊNCIA FORAM APROVADOS COM SUCESSO!     ')
    console.log('==============================================================================')
    manifest.status = 'passed'

  } catch (err) {
    executionFailed = true
    failureError = err
    console.error('\n❌ EXECUÇÃO ABORTADA POR ERRO:')
    console.error(err)
    manifest.status = 'failed'
    manifest.error = err.message
  } finally {
    if (!options.dryRun && !options.keepFixtures) {
      await performTeardown(client1, manifest)
    } else if (options.keepFixtures) {
      console.log('\n[Aviso] Fixtures mantidas para auditoria manual (--keep-fixtures).')
      console.log(`Manifesto salvo em: .staging-workspace/manifest-atomic-test-${manifest.runTag}.json`)
    }

    try { await client1.end() } catch (_) {}
    try { await client2.end() } catch (_) {}

    if (executionFailed) {
      process.exit(1)
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err)
  process.exit(1)
})
