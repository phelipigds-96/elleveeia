/**
 * scripts/run-real-postgres-atomic-test.mjs
 * 
 * ELLEVEE IA — AC-04.5-P0.5: RUNNER OPERACIONAL DE TESTES EM POSTGRESQL REAL
 * 
 * Executa a validação reproduzível da RPC save_enterprise_quote_atomic utilizando
 * duas conexões PostgreSQL reais e independentes (pg.Client nativo), eliminando
 * limitações de afinidade de sessão do Supabase SQL Editor e garantindo:
 * 
 * 1. Destino exclusivamente Staging: validação positiva de host e marcadores de base.
 * 2. Segurança TLS estrita com validação de certificados (rejectUnauthorized: true).
 * 3. Sanitização absoluta de credenciais, senhas e tokens nos logs.
 * 4. Controle explícito de transações em ambas as conexões e rollback defensivo.
 * 5. Teardown cirúrgico garantido com cliente reserva e confirmação de 0 resíduos.
 * 6. Rastreamento incremental de manifestos e recuperação de sessões interrompidas.
 * 7. Desabilitação padrão de --keep-fixtures com exigência de autorização de diagnóstico.
 * 8. Testes de privilégios separando troca de role (SET ROLE) da rejeição da RPC (42501).
 * 9. Teste de rollback real de transação do chamador com alterações efetuadas.
 * 10. Concorrência atômica comprovada por inspeção direta de pg_locks (sem sleeps arbitrários).
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
export const AUTHORIZED_STAGING_HOST = `db.${STAGING_PROJECT_ID}.supabase.co`

// Marcadores de referência imutáveis do Staging oficial para auditoria de identidade
export const PREEXISTING_OFFICIAL_SUPERADMIN_ID = '38bbee0f-c0a6-46cd-856b-ce77a6ff801d'
export const PREEXISTING_OFFICIAL_COMPANY_ID = '9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad'

// Certificado Raiz Oficial do Supabase (Supabase Root 2021 CA) para validação estrita TLS (rejectUnauthorized: true)
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`

function getSslConfig() {
  const ca = process.env.STAGING_DB_CA_CERT || SUPABASE_ROOT_CA
  return {
    rejectUnauthorized: true,
    ca,
  }
}

const ROOT = process.cwd()
const WORKSPACE_DIR = path.join(ROOT, '.staging-workspace')

// ==============================================================================
// UTILITÁRIOS DE SEGURANÇA E HIGIENIZAÇÃO DE LOGS
// ==============================================================================

function sanitizeLog(text) {
  if (typeof text !== 'string') text = String(text)
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1***$3')
    .replace(/(password[=:]\s*)([^\s&,;]+)/gi, '$1***')
    .replace(/(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/g, '***JWT_REDACTED***')
}

function safeLog(...args) {
  const sanitized = args.map(arg => {
    if (typeof arg === 'string') return sanitizeLog(arg)
    if (arg instanceof Error) {
      const err = new Error(sanitizeLog(arg.message))
      err.stack = sanitizeLog(arg.stack || '')
      return err
    }
    return arg
  })
  console.log(...sanitized)
}

function safeError(...args) {
  const sanitized = args.map(arg => {
    if (typeof arg === 'string') return sanitizeLog(arg)
    if (arg instanceof Error) {
      const err = new Error(sanitizeLog(arg.message))
      err.stack = sanitizeLog(arg.stack || '')
      return err
    }
    return arg
  })
  console.error(...sanitized)
}

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    dryRun: false,
    keepFixtures: false,
    allowDiagnosticFixtures: false,
    skipConcurrency: false,
    recover: false,
    help: false,
  }

  for (const arg of args) {
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--keep-fixtures') options.keepFixtures = true
    else if (arg === '--allow-diagnostic-fixtures') options.allowDiagnosticFixtures = true
    else if (arg === '--skip-concurrency') options.skipConcurrency = true
    else if (arg === '--recover') options.recover = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else {
      throw new Error(`Argumento não reconhecido: ${arg}. Utilize --help para ver as opções.`)
    }
  }

  return options
}

function printHelp() {
  safeLog(`
Uso: node scripts/run-real-postgres-atomic-test.mjs [opções]

Opções:
  --dry-run                    Executa apenas a validação de identidade e compatibilidade (somente leitura).
  --keep-fixtures              Preserva as fixtures sintéticas ao final.
                               EXIGE autorização explícita via --allow-diagnostic-fixtures.
  --allow-diagnostic-fixtures  Autoriza o uso de --keep-fixtures para fins de diagnóstico.
  --skip-concurrency           Pula o teste de duas conexões concorrentes.
  --recover                    Localiza e executa teardown de manifestos de execuções anteriores interrompidas.
  --help, -h                   Exibe esta ajuda.

Variáveis de Ambiente / Configuração:
  Lidas automaticamente de .env.staging.local:
    - STAGING_DB_PASSWORD
    - STAGING_SUPABASE_SERVICE_ROLE_KEY
  Restrição absoluta: O endpoint deve corresponder estritamente a ${AUTHORIZED_STAGING_HOST}.
`)
}

// ==============================================================================
// CONFIGURAÇÃO E GUARDA POSITIVA DE DESTINO
// ==============================================================================

function getStagingConfig() {
  // 1. Guarda Ativa: Proibição absoluta de menção a Produção
  const allEnvKeys = Object.keys(process.env)
  for (const k of allEnvKeys) {
    const val = process.env[k] || ''
    if (val.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL SECURITY GUARD] Referência ao projeto de PRODUÇÃO (${PRODUCTION_PROJECT_ID}) detectada na variável ${k}! Abortando imediatamente.`)
    }
  }

  // 2. Leitura de .env.staging.local
  const envPath = path.join(ROOT, '.env.staging.local')
  let dbPassword = process.env.STAGING_DB_PASSWORD
  let dbHost = process.env.STAGING_DB_HOST || AUTHORIZED_STAGING_HOST
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

  // 3. Validação Positiva de Endpoint: Não permitir URLs genéricas nem outros hosts
  const connStr = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL
  if (connStr) {
    if (connStr.includes(PRODUCTION_PROJECT_ID)) {
      throw new Error(`[CRITICAL SECURITY GUARD] Connection string aponta para PRODUÇÃO (${PRODUCTION_PROJECT_ID})!`)
    }
    try {
      const parsedUrl = new URL(connStr)
      if (parsedUrl.hostname !== AUTHORIZED_STAGING_HOST && !parsedUrl.hostname.includes(STAGING_PROJECT_ID)) {
        throw new Error(`[DESTINATION GUARD] Connection string aponta para host não autorizado (${parsedUrl.hostname}). O host deve corresponder estritamente a ${AUTHORIZED_STAGING_HOST}.`)
      }
    } catch (e) {
      if (e.message.includes('DESTINATION GUARD')) throw e
      throw new Error(`[DESTINATION GUARD] Connection string inválida ou malformada. Host autorizado obrigatório: ${AUTHORIZED_STAGING_HOST}`)
    }
    return { connectionString: connStr }
  }

  // Se configurado via host/user/pass direto
  if (dbHost !== AUTHORIZED_STAGING_HOST && !dbHost.includes(STAGING_PROJECT_ID)) {
    throw new Error(`[DESTINATION GUARD] Host configurado (${dbHost}) não corresponde ao endpoint de Staging autorizado (${AUTHORIZED_STAGING_HOST}).`)
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
    ssl: getSslConfig(),
  }
}

function createClient(config, label = 'Conexão') {
  const sslConfig = getSslConfig()
  const clientConfig = config.connectionString
    ? { connectionString: config.connectionString, ssl: sslConfig }
    : { ...config, ssl: sslConfig }

  const client = new pg.Client(clientConfig)
  client.on('error', (err) => {
    safeError(`[${label}] Erro na conexão PostgreSQL:`, err.message)
  })
  return client
}

function ensureWorkspaceDir() {
  if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
  }
}

function persistManifest(manifest) {
  ensureWorkspaceDir()
  const manifestPath = path.join(WORKSPACE_DIR, `manifest-atomic-test-${manifest.runTag}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

// ==============================================================================
// VERIFICAÇÃO POSITIVA DE IDENTIDADE DO BANCO ANTES DE QUALQUER ESCRITA
// ==============================================================================

async function verifyDatabaseIdentity(client) {
  safeLog('\n--- [GATE 0] VERIFICAÇÃO POSITIVA DE IDENTIDADE DE STAGING ---')

  const dbInfo = await client.query('SELECT current_database(), current_user, inet_server_addr(), version();')
  safeLog(`Conexão ativa: Database=${dbInfo.rows[0].current_database}, User=${dbInfo.rows[0].current_user}`)

  if (dbInfo.rows[0].current_database !== 'postgres') {
    throw new Error(`[IDENTITY GUARD] Nome do banco inesperado: ${dbInfo.rows[0].current_database}. Esperado 'postgres'.`)
  }

  // Validação dos marcadores de referência imutáveis do Staging
  const adminCheck = await client.query(
    'SELECT id, email, active FROM public.platform_admins WHERE id = $1',
    [PREEXISTING_OFFICIAL_SUPERADMIN_ID]
  )
  if (adminCheck.rows.length === 0) {
    throw new Error(`[IDENTITY GUARD] Marcador oficial de Staging ausente: SuperAdmin (${PREEXISTING_OFFICIAL_SUPERADMIN_ID}) não localizado!`)
  }

  const companyCheck = await client.query(
    'SELECT id, name FROM public.companies WHERE id = $1',
    [PREEXISTING_OFFICIAL_COMPANY_ID]
  )
  if (companyCheck.rows.length === 0) {
    throw new Error(`[IDENTITY GUARD] Marcador oficial de Staging ausente: Empresa oficial (${PREEXISTING_OFFICIAL_COMPANY_ID}) não localizada!`)
  }

  safeLog(`✓ Identidade de Staging positivada com sucesso via marcadores de referência: SuperAdmin=${adminCheck.rows[0].id}, Empresa=${companyCheck.rows[0].name}`)
}

// ==============================================================================
// SEÇÃO 1: CONSULTAS DE COMPATIBILIDADE PRÉ-MIGRATION (SOMENTE LEITURA)
// ==============================================================================

async function runPreflightChecks(client) {
  safeLog('\n--- [SEÇÃO 1] CONSULTAS DE COMPATIBILIDADE PRÉ-MIGRATION (SOMENTE LEITURA) ---')

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
    safeLog(`⚠️ ALERTA: Encontradas ${q1.rows.length} conversas com múltiplos orçamentos ativos! Requer resolução antes de aplicar o índice único.`)
    console.table(q1.rows)
  } else {
    safeLog('✓ Nenhuma colisão prévia: zero conversas com múltiplos orçamentos ativos.')
  }

  // 1.2 Orçamentos ativos sem conversation_id
  const q2 = await client.query(`
    SELECT COUNT(*) AS total_sem_conv
    FROM public.quotes
    WHERE status IN ('draft', 'pending_validation', 'ready')
      AND (metadata->>'conversation_id' IS NULL OR (metadata->>'conversation_id') = '');
  `)
  safeLog(`✓ Orçamentos ativos sem conversation_id existentes: ${q2.rows[0].total_sem_conv}`)

  // 1.3 Resumo de status
  const q3 = await client.query(`
    SELECT status, COUNT(*) AS count
    FROM public.quotes
    GROUP BY status
    ORDER BY count DESC;
  `)
  safeLog('✓ Distribuição geral de status em public.quotes:')
  console.table(q3.rows)
}

// ==============================================================================
// SEÇÃO 2: VALIDAÇÃO DE PERMISSÕES E PRINCÍPIO DO MENOR PRIVILÉGIO
// ==============================================================================

async function runPermissionChecks(client) {
  safeLog('\n--- [SEÇÃO 2] VALIDAÇÃO DE PERMISSÕES E MENOR PRIVILÉGIO (DESACOPLADA) ---')

  const rpcCheck = await client.query(`
    SELECT routine_name, security_type 
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
      AND routine_name = 'save_enterprise_quote_atomic';
  `)
  if (rpcCheck.rows.length === 0) {
    throw new Error('RPC public.save_enterprise_quote_atomic não encontrada! Aplique a migration 2026112204 primeiro.')
  }
  safeLog(`✓ RPC save_enterprise_quote_atomic confirmada (Security Type: ${rpcCheck.rows[0].security_type}).`)

  // 2.1 Teste com anon: Separa sucesso do SET ROLE da rejeição da função
  await client.query('SET ROLE anon;')
  const checkAnonRole = await client.query('SELECT current_user;')
  if (checkAnonRole.rows[0].current_user !== 'anon') {
    throw new Error(`Falha ao assumir role anon: current_user=${checkAnonRole.rows[0].current_user}`)
  }

  let anonCallRejected = false
  let anonError = null
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := gen_random_uuid(),
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
      );
    `)
  } catch (err) {
    anonCallRejected = true
    anonError = err
  } finally {
    await client.query('RESET ROLE;')
  }

  if (!anonCallRejected) {
    throw new Error('VULNERABILIDADE CRÍTICA: Role anon conseguiu executar save_enterprise_quote_atomic sem erro!')
  }
  if (anonError.code !== '42501' && !anonError.message.includes('permission denied')) {
    throw new Error(`Rejeição de anon com código inesperado: ${anonError.code} (${anonError.message})`)
  }
  safeLog('✓ 2.1 Role anon confirmada e chamada à RPC rejeitada com insufficient_privilege (42501).')

  // 2.2 Teste com authenticated: Separa sucesso do SET ROLE da rejeição da função
  await client.query('SET ROLE authenticated;')
  const checkAuthRole = await client.query('SELECT current_user;')
  if (checkAuthRole.rows[0].current_user !== 'authenticated') {
    throw new Error(`Falha ao assumir role authenticated: current_user=${checkAuthRole.rows[0].current_user}`)
  }

  let authCallRejected = false
  let authError = null
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := gen_random_uuid(),
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
      );
    `)
  } catch (err) {
    authCallRejected = true
    authError = err
  } finally {
    await client.query('RESET ROLE;')
  }

  if (!authCallRejected) {
    throw new Error('VULNERABILIDADE CRÍTICA: Role authenticated conseguiu executar save_enterprise_quote_atomic sem erro!')
  }
  if (authError.code !== '42501' && !authError.message.includes('permission denied')) {
    throw new Error(`Rejeição de authenticated com código inesperado: ${authError.code} (${authError.message})`)
  }
  safeLog('✓ 2.2 Role authenticated confirmada e chamada à RPC rejeitada com insufficient_privilege (42501).')

  // 2.3 Teste com service_role: Verifica privilégio de execução concedido
  await client.query('SET ROLE service_role;')
  const checkSrRole = await client.query('SELECT current_user;')
  if (checkSrRole.rows[0].current_user !== 'service_role') {
    throw new Error(`Falha ao assumir role service_role: current_user=${checkSrRole.rows[0].current_user}`)
  }

  const privCheck = await client.query(`
    SELECT has_function_privilege('service_role', 'public.save_enterprise_quote_atomic(uuid, uuid, text, uuid, integer, text, numeric, jsonb, jsonb)', 'EXECUTE') AS has_exec;
  `)
  await client.query('RESET ROLE;')

  if (!privCheck.rows[0].has_exec) {
    throw new Error('FALHA DE PERMISSÃO: Role service_role não possui permissão de EXECUTE sobre save_enterprise_quote_atomic!')
  }
  safeLog('✓ 2.3 Permissão de EXECUTE confirmada exclusivamente para service_role.')
}

// ==============================================================================
// SEÇÃO 3: SETUP DE FIXTURES SINTÉTICAS COM RASTREAMENTO INCREMENTAL
// ==============================================================================

async function setupFixtures(client1, client2, manifest) {
  safeLog('\n--- [SEÇÃO 3] SETUP DE FIXTURES SINTÉTICAS RASTREADAS ---')
  const runSuffix = manifest.runTag

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

  // Inserção com gravação incremental no manifesto a cada passo
  await client1.query(`
    INSERT INTO public.companies (id, name, slug)
    VALUES ($1, $2, $3);
  `, [companyA, `Empresa Teste AC-04.5 ${runSuffix}`, `empresa-teste-ac045-${runSuffix}`])
  manifest.companies.push(companyA)
  persistManifest(manifest)

  await client1.query(`
    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES ($1, $2, $3, $4, $5);
  `, [customerA, companyA, `Cliente Teste ${runSuffix}`, '+5511999990001', `teste-${runSuffix}@ellevee.ia`])
  manifest.customers.push(customerA)
  persistManifest(manifest)

  await client1.query(`
    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES 
      ($1, $2, $3, 'whatsapp', 'open'),
      ($4, $2, $3, 'whatsapp', 'open'),
      ($5, $2, $3, $6, 'open');
  `, [convA1, companyA, customerA, convA2, convConc, `test_concorrencia_${runSuffix}`])
  manifest.conversations.push(convA1, convA2, convConc)
  persistManifest(manifest)

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
  persistManifest(manifest)

  // Tenant B (Invasor)
  await client1.query(`
    INSERT INTO public.companies (id, name, slug)
    VALUES ($1, $2, $3);
  `, [companyB, `Empresa Invasora B ${runSuffix}`, `empresa-invasora-b-${runSuffix}`])
  manifest.companies.push(companyB)
  persistManifest(manifest)

  await client1.query(`
    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES ($1, $2, $3, $4, $5);
  `, [customerB, companyB, `Cliente Invasor B ${runSuffix}`, '+5511888880002', `invasor-b-${runSuffix}@ellevee.ia`])
  manifest.customers.push(customerB)
  persistManifest(manifest)

  await client1.query(`
    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES ($1, $2, $3, 'whatsapp', 'open');
  `, [convB, companyB, customerB])
  manifest.conversations.push(convB)
  persistManifest(manifest)

  await client1.query(`
    INSERT INTO public.products (id, company_id, name, normalized_name, active)
    VALUES ($1, $2, $3, $4, true);
  `, [prodB, companyB, `Produto Sintético B Invasor ${runSuffix}`, `produto sintetico b invasor ${runSuffix}`])
  manifest.products.push(prodB)
  persistManifest(manifest)

  safeLog(`✓ Fixtures sintéticas criadas e salvas incrementalmente no manifesto (${runSuffix}).`)

  // Confirmação de visibilidade mútua pela Conexão 2
  const c2Check = await client2.query('SELECT id FROM public.conversations WHERE id = $1', [convConc])
  if (c2Check.rows.length === 0) {
    throw new Error('Falha de visibilidade: Conexão 2 não conseguiu consultar as fixtures da Conexão 1!')
  }
  safeLog('✓ Visibilidade mútua confirmada: Conexão 2 acessou diretamente as entidades criadas.')

  return {
    companyA, customerA, convA1, convA2, convConc, prodA1, prodA2,
    companyB, customerB, convB, prodB,
  }
}

// ==============================================================================
// SEÇÃO 4: TESTES TRANSACIONAIS ACID, INVARIANTES E ROLLBACK REAL
// ==============================================================================

async function runAcidTests(client, fixtures, manifest, txState) {
  safeLog('\n--- [SEÇÃO 4] TESTES TRANSACIONAIS ACID, INVARIANTES E ROLLBACK REAL ---')
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
  safeLog(`✓ 4.1 Criação inicial aprovada (ID: ${quote1Id}, versão: ${quote1.version}).`)

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

  const metaCheck = await client.query('SELECT metadata FROM public.quotes WHERE id = $1', [quote1Id])
  const savedMeta = metaCheck.rows[0].metadata
  if (savedMeta.observacao_comercial !== 'pedido inicial') {
    throw new Error('4.2 Falhou: metadado observacao_comercial foi apagado!')
  }
  if (savedMeta.desconto_concedido !== '5%') {
    throw new Error('4.2 Falhou: novo metadado desconto_concedido não foi gravado!')
  }
  safeLog('✓ 4.2 Atualização de versão e mesclagem de metadados confirmadas (versão: 2).')

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
    if (err.message.includes('PRODUTO_NOT_FOUND')) roll1Ok = true
    else throw err
  }

  if (!roll1Ok) throw new Error('4.3 Falhou: inserção com produto inexistente não gerou erro!')

  const cQuotes = await client.query("SELECT COUNT(*) FROM public.quotes WHERE metadata @> jsonb_build_object('conversation_id', $1::text)", [convA2])
  if (parseInt(cQuotes.rows[0].count, 10) !== 0) {
    throw new Error('4.3 Violação de atomicidade: orçamento residual encontrado após rollback de criação!')
  }
  safeLog('✓ 4.3 Rollback em falha de criação comprovado (0 resíduos).')

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
    if (err.message.includes('PRODUTO_NOT_FOUND')) roll2Ok = true
    else throw err
  }

  if (!roll2Ok) throw new Error('4.4 Falhou: atualização com item inválido não gerou erro!')

  const q1Intact = await client.query(`SELECT total, (metadata->>'version')::int AS version FROM public.quotes WHERE id = $1`, [quote1Id])
  if (parseFloat(q1Intact.rows[0].total) !== 105.00 || q1Intact.rows[0].version !== 2) {
    throw new Error(`4.4 Violação de atomicidade: estado alterado após rollback!`)
  }
  safeLog('✓ 4.4 Rollback em falha de atualização comprovado (versão 2 e total 105.00 preservados).')

  // ---------------------------------------------------------------------------
  // 4.5 ROLLBACK REAL: TRANSAÇÃO DO CHAMADOR COM ALTERAÇÕES EFETUADAS
  // ---------------------------------------------------------------------------
  // Captura o estado antes da transação (versão 2, total 105.00)
  const qBefore = (await client.query(`
    SELECT total, status, (metadata->>'version')::int AS version, metadata
    FROM public.quotes WHERE id = $1;
  `, [quote1Id])).rows[0]

  const itemsBefore = (await client.query(`
    SELECT id, product_id, quantity, unit_price, subtotal
    FROM public.quote_items WHERE quote_id = $1 ORDER BY id;
  `, [quote1Id])).rows

  // Abre transação no cliente
  txState.client1 = true
  await client.query('BEGIN;')

  // Atualização bem-sucedida para versão 3 dentro da transação
  const updateV3 = await client.query(`
    SELECT public.save_enterprise_quote_atomic(
      p_company_id := $1,
      p_customer_id := $2,
      p_conversation_id := $3,
      p_existing_quote_id := $4,
      p_expected_version := 2,
      p_status := 'ready',
      p_total := 175.00,
      p_metadata := '{"nova_nota": "atualizacao em transacao aberta"}'::jsonb,
      p_items := jsonb_build_array(
        jsonb_build_object('product_id', $5::uuid, 'quantity', 5, 'unit_price', 35.00, 'subtotal', 175.00)
      )
    ) AS res;
  `, [companyA, customerA, convA1, quote1Id, prodA1])

  const v3Data = updateV3.rows[0].res
  if (v3Data.version !== 3) {
    throw new Error(`Falha ao atualizar para versão 3 na transação: ${JSON.stringify(v3Data)}`)
  }

  // Verifica que dentro da transação as alterações estão visíveis
  const qInsideTx = (await client.query(`
    SELECT total, (metadata->>'version')::int AS version
    FROM public.quotes WHERE id = $1;
  `, [quote1Id])).rows[0]

  if (qInsideTx.version !== 3 || parseFloat(qInsideTx.total) !== 175.00) {
    throw new Error('Alterações da versão 3 não refletidas dentro da transação!')
  }

  // Realiza ROLLBACK da transação
  await client.query('ROLLBACK;')
  txState.client1 = false

  // Comprova fora da transação a preservação estrita do cabeçalho, versão, total e itens originais
  const qAfterRollback = (await client.query(`
    SELECT total, status, (metadata->>'version')::int AS version, metadata
    FROM public.quotes WHERE id = $1;
  `, [quote1Id])).rows[0]

  const itemsAfterRollback = (await client.query(`
    SELECT id, product_id, quantity, unit_price, subtotal
    FROM public.quote_items WHERE quote_id = $1 ORDER BY id;
  `, [quote1Id])).rows

  if (qAfterRollback.version !== qBefore.version) {
    throw new Error(`VIOLAÇÃO ACID 4.5: Versão alterada após ROLLBACK! (esperada=${qBefore.version}, obtida=${qAfterRollback.version})`)
  }
  if (parseFloat(qAfterRollback.total) !== parseFloat(qBefore.total)) {
    throw new Error(`VIOLAÇÃO ACID 4.5: Total alterado após ROLLBACK! (esperado=${qBefore.total}, obtido=${qAfterRollback.total})`)
  }
  if (qAfterRollback.metadata.observacao_comercial !== qBefore.metadata.observacao_comercial) {
    throw new Error('VIOLAÇÃO ACID 4.5: Metadados corrompidos após ROLLBACK!')
  }
  if (qAfterRollback.metadata.nova_nota) {
    throw new Error('VIOLAÇÃO ACID 4.5: Metadado da transação revertida vazou no banco!')
  }

  if (itemsAfterRollback.length !== itemsBefore.length) {
    throw new Error(`VIOLAÇÃO ACID 4.5: Quantidade de itens divergente após ROLLBACK! (antes=${itemsBefore.length}, depois=${itemsAfterRollback.length})`)
  }
  for (let i = 0; i < itemsBefore.length; i++) {
    if (itemsAfterRollback[i].id !== itemsBefore[i].id ||
        parseFloat(itemsAfterRollback[i].subtotal) !== parseFloat(itemsBefore[i].subtotal)) {
      throw new Error(`VIOLAÇÃO ACID 4.5: Item ${i} modificado após ROLLBACK!`)
    }
  }

  safeLog('✓ 4.5 Rollback real de transação do chamador comprovado: cabeçalho, versão 2, metadados e IDs dos itens preservados 100%.')

  // 4.6 Concorrência Otimista: Rejeição de Versão Defasada
  let verConflict = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_existing_quote_id := $4,
        p_expected_version := 1, -- Versão 1 defasada (banco está na 2)
        p_total := 35.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $5::uuid, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
        )
      );
    `, [companyA, customerA, convA1, quote1Id, prodA1])
  } catch (err) {
    if (err.message.includes('ORCAMENTO_CONCURRENCY_CONFLICT')) verConflict = true
    else throw err
  }
  if (!verConflict) throw new Error('4.6 Falhou: versão obsoleta não foi rejeitada com ORCAMENTO_CONCURRENCY_CONFLICT!')
  safeLog('✓ 4.6 Concorrência otimista comprovada: sobrescrita com versão defasada bloqueada.')

  // 4.7 Isolamento entre Conversas (Bloqueio de Sequestro)
  let crossConvBlocked = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3, -- convA2 divergente!
        p_existing_quote_id := $4,
        p_expected_version := 2,
        p_total := 35.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $5::uuid, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
        )
      );
    `, [companyA, customerA, convA2, quote1Id, prodA1])
  } catch (err) {
    if (err.message.includes('ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN')) crossConvBlocked = true
    else throw err
  }
  if (!crossConvBlocked) throw new Error('4.7 Falhou: sequestro entre conversas não bloqueado!')
  safeLog('✓ 4.7 Isolamento entre conversas comprovado.')

  // 4.8 Isolamento entre Clientes e Empresas
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
    } else throw err
  }
  if (!crossCustBlocked) throw new Error('4.8 Falhou: cliente pertencente a outro tenant não foi rejeitado!')
  safeLog('✓ 4.8 Isolamento multi-tenant de cliente comprovado.')

  // 4.9 Validação Financeira Estrita (Subtotal e Total)
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
          jsonb_build_object('product_id', $4::uuid, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 80.00)
        )
      );
    `, [companyA, customerA, convA2, prodA1])
  } catch (err) {
    if (err.message.includes('FINANCEIRO_SUBTOTAL_INCONSISTENTE')) subtotalBlocked = true
    else throw err
  }
  if (!subtotalBlocked) throw new Error('4.9A Falhou: subtotal inconsistente foi aceito!')

  let totalBlocked = false
  try {
    await client.query(`
      SELECT public.save_enterprise_quote_atomic(
        p_company_id := $1,
        p_customer_id := $2,
        p_conversation_id := $3,
        p_status := 'draft',
        p_total := 100.00,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', $4::uuid, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
        )
      );
    `, [companyA, customerA, convA2, prodA1])
  } catch (err) {
    if (err.message.includes('FINANCEIRO_TOTAL_INCONSISTENTE')) totalBlocked = true
    else throw err
  }
  if (!totalBlocked) throw new Error('4.9B Falhou: total divergente da soma foi aceito!')

  safeLog('✓ 4.9 Invariantes financeiros validados com rigor (subtotal e total validados matematicamente).')
}

// ==============================================================================
// SEÇÃO 5: CONCORRÊNCIA COMPROVADA EM PG_LOCKS (SEM SLEEP FIXO)
// ==============================================================================

async function runConcurrencyTest(client1, client2, fixtures, manifest, txState) {
  safeLog('\n--- [SEÇÃO 5] CONCORRÊNCIA ATÔMICA COMPROVADA EM PG_LOCKS ---')
  const { companyA, customerA, convConc, prodA1 } = fixtures

  // Define timeouts explícitos de segurança para evitar qualquer travamento indefinido
  await client1.query("SET statement_timeout = '10000ms';")
  await client2.query("SET statement_timeout = '10000ms';")

  const pid1 = (await client1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  const pid2 = (await client2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
  safeLog(`Conexões prontas para corrida: Conexão 1 (PID ${pid1}), Conexão 2 (PID ${pid2})`)

  // 1. Conexão 1 abre transação e adquire advisory lock via RPC
  txState.client1 = true
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
  safeLog(`[Conexão 1] Orçamento criado na transação (ID: ${q1Id}). Lock advisory retido...`)

  // 2. Conexão 2 abre transação e tenta criar para a mesma conversa
  txState.client2 = true
  await client2.query('BEGIN;')
  safeLog('[Conexão 2] Disparando criação simultânea na mesma conversa...')

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

  // 3. Inspeção determinística em pg_locks: Conexão 1 verifica que Conexão 2 está retida
  safeLog('[Conexão 1] Monitorando pg_locks para comprovar bloqueio ativo do PID 2...')
  let lockWaitingDetected = false
  const waitStart = Date.now()

  while (Date.now() - waitStart < 4000) {
    const lockCheck = await client1.query(`
      SELECT count(*) AS count
      FROM pg_catalog.pg_locks
      WHERE locktype = 'advisory'
        AND pid = $1
        AND NOT granted;
    `, [pid2])

    if (parseInt(lockCheck.rows[0].count, 10) > 0) {
      lockWaitingDetected = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }

  if (!lockWaitingDetected) {
    throw new Error(`Falha de concorrência: Conexão 2 (PID ${pid2}) não foi detectada aguardando o lock em pg_locks!`)
  }
  safeLog(`✓ Evidência de concorrência comprovada em pg_locks: PID ${pid2} aguardando liberação do advisory lock retido por PID ${pid1}.`)

  // 4. Conexão 1 comita sua transação e libera o lock
  safeLog('[Conexão 1] Comitando transação da Conexão 1 e liberando advisory lock...')
  await client1.query('COMMIT;')
  txState.client1 = false

  // 5. Conexão 2 desbloqueia e é avaliada
  await c2Promise
  await client2.query('ROLLBACK;')
  txState.client2 = false

  if (!c2Error) {
    throw new Error('Falha de concorrência: Conexão 2 deveria ter sido bloqueada e rejeitada após o commit da Conexão 1!')
  }

  if (!c2Error.message.includes('ORCAMENTO_ACTIVE_EXISTS')) {
    throw new Error(`Conexão 2 falhou com erro inesperado: ${c2Error.message}`)
  }
  safeLog(`✓ [Conexão 2] Corretamente rejeitada com fail-closed pós-desbloqueio: ${c2Error.message}`)

  // 6. Confirmação no banco: exatamente 1 orçamento ativo persistido
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
    throw new Error(`Inconsistência de dados: orçamento ativo diverge do criado pela Conexão 1!`)
  }

  safeLog(`✓ Serialização perfeita comprovada: exatamente 1 orçamento ativo persistido (ID: ${q1Id}, total: 35.00).`)
}

// ==============================================================================
// SEÇÃO 6: TEARDOWN CIRÚRGICO, AUDITÁVEL E RECUPERAÇÃO DE MANIFESTOS
// ==============================================================================

async function executeDeletion(client, manifest) {
  // 1. Exclui quote_items vinculados aos quotes rastreados
  if (manifest.quotes.length > 0) {
    const delItems = await client.query(`
      DELETE FROM public.quote_items 
      WHERE quote_id = ANY($1::uuid[]);
    `, [manifest.quotes])
    safeLog(`✓ quote_items excluídos: ${delItems.rowCount}`)

    const delQuotes = await client.query(`
      DELETE FROM public.quotes 
      WHERE id = ANY($1::uuid[]);
    `, [manifest.quotes])
    safeLog(`✓ quotes excluídos: ${delQuotes.rowCount}`)
  }

  // 2. Exclui conversas
  if (manifest.conversations.length > 0) {
    const delConvs = await client.query(`
      DELETE FROM public.conversations 
      WHERE id = ANY($1::uuid[]);
    `, [manifest.conversations])
    safeLog(`✓ conversations excluídas: ${delConvs.rowCount}`)
  }

  // 3. Exclui produtos
  if (manifest.products.length > 0) {
    const delProds = await client.query(`
      DELETE FROM public.products 
      WHERE id = ANY($1::uuid[]);
    `, [manifest.products])
    safeLog(`✓ products excluídos: ${delProds.rowCount}`)
  }

  // 4. Exclui clientes
  if (manifest.customers.length > 0) {
    const delCusts = await client.query(`
      DELETE FROM public.customers 
      WHERE id = ANY($1::uuid[]);
    `, [manifest.customers])
    safeLog(`✓ customers excluídos: ${delCusts.rowCount}`)
  }

  // 5. Exclui empresas
  if (manifest.companies.length > 0) {
    const delComps = await client.query(`
      DELETE FROM public.companies 
      WHERE id = ANY($1::uuid[]);
    `, [manifest.companies])
    safeLog(`✓ companies excluídas: ${delComps.rowCount}`)
  }

  // 6. Confirmação estrita de ausência de registros residuais
  safeLog('Verificando ausência de registros residuais por IDs rastreados...')

  if (manifest.quotes.length > 0) {
    const checkQuotes = await client.query('SELECT count(*) FROM public.quotes WHERE id = ANY($1::uuid[])', [manifest.quotes])
    const checkItems = await client.query('SELECT count(*) FROM public.quote_items WHERE quote_id = ANY($1::uuid[])', [manifest.quotes])
    if (parseInt(checkQuotes.rows[0].count, 10) > 0 || parseInt(checkItems.rows[0].count, 10) > 0) {
      throw new Error(`[RESÍDUO DETECTADO] Orçamentos ou itens residuais não foram excluídos!`)
    }
  }

  if (manifest.conversations.length > 0) {
    const checkConvs = await client.query('SELECT count(*) FROM public.conversations WHERE id = ANY($1::uuid[])', [manifest.conversations])
    if (parseInt(checkConvs.rows[0].count, 10) > 0) {
      throw new Error(`[RESÍDUO DETECTADO] Conversas residuais não foram excluídas!`)
    }
  }

  if (manifest.products.length > 0) {
    const checkProds = await client.query('SELECT count(*) FROM public.products WHERE id = ANY($1::uuid[])', [manifest.products])
    if (parseInt(checkProds.rows[0].count, 10) > 0) {
      throw new Error(`[RESÍDUO DETECTADO] Produtos residuais não foram excluídos!`)
    }
  }

  if (manifest.customers.length > 0) {
    const checkCusts = await client.query('SELECT count(*) FROM public.customers WHERE id = ANY($1::uuid[])', [manifest.customers])
    if (parseInt(checkCusts.rows[0].count, 10) > 0) {
      throw new Error(`[RESÍDUO DETECTADO] Clientes residuais não foram excluídos!`)
    }
  }

  if (manifest.companies.length > 0) {
    const checkComps = await client.query('SELECT count(*) FROM public.companies WHERE id = ANY($1::uuid[])', [manifest.companies])
    if (parseInt(checkComps.rows[0].count, 10) > 0) {
      throw new Error(`[RESÍDUO DETECTADO] Empresas residuais não foram excluídas!`)
    }
  }

  safeLog('✓ Ausência total de resíduos confirmada por checagem direta (0 registros restantes).')
}

async function performTeardown(primaryClient, manifest, config, txState) {
  safeLog('\n--- [SEÇÃO 6] TEARDOWN CIRÚRGICO E AUDITÁVEL DAS FIXTURES SINTÉTICAS ---')

  // 1. Rollback defensivo das transações caso tenham ficado abertas
  if (primaryClient) {
    if (txState?.client1) {
      try {
        await primaryClient.query('ROLLBACK;')
        txState.client1 = false
        safeLog('✓ Rollback defensivo executado na Conexão 1 antes da limpeza.')
      } catch (_) {}
    }
  }

  let cleanupClient = primaryClient
  let usingFallbackClient = false

  // 2. Se a conexão primária estiver indisponível, estabelece conexão reserva para limpeza
  try {
    if (!cleanupClient) throw new Error('Cliente nulo')
    await cleanupClient.query('SELECT 1;')
  } catch (err) {
    safeLog('⚠️ Conexão primária inutilizável para teardown. Estabelecendo nova conexão validada reserva...')
    try {
      cleanupClient = createClient(config, 'TeardownFallback')
      await cleanupClient.connect()
      usingFallbackClient = true
      safeLog('✓ Conexão reserva estabelecida com sucesso para executar a limpeza.')
    } catch (connErr) {
      safeError('❌ Falha crítica: Impossível conectar para teardown:', connErr.message)
      manifest.status = 'teardown_failed'
      manifest.teardownError = connErr.message
      persistManifest(manifest)
      throw connErr
    }
  }

  try {
    await executeDeletion(cleanupClient, manifest)
    manifest.status = 'cleaned'
    persistManifest(manifest)
    safeLog('✓ Teardown cirúrgico concluído com 100% de sucesso. Manifesto atualizado como cleaned.')
  } catch (err) {
    safeError('❌ Falha crítica durante o teardown:', err.message)
    manifest.status = 'teardown_failed'
    manifest.teardownError = err.message
    persistManifest(manifest)
    throw err
  } finally {
    if (usingFallbackClient && cleanupClient) {
      try { await cleanupClient.end() } catch (_) {}
    }
  }
}

async function recoverInterruptedManifests(config) {
  safeLog('\n--- [RECUPERAÇÃO] BUSCA DE MANIFESTOS DE EXECUÇÕES ANTERIORES INTERROMPIDAS ---')
  if (!fs.existsSync(WORKSPACE_DIR)) {
    safeLog('Nenhum diretório .staging-workspace localizado.')
    return
  }

  const files = fs.readdirSync(WORKSPACE_DIR).filter(f => f.startsWith('manifest-atomic-test-') && f.endsWith('.json'))
  let recoveredCount = 0

  for (const file of files) {
    const filePath = path.join(WORKSPACE_DIR, file)
    try {
      const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (manifest.status !== 'cleaned') {
        safeLog(`\nManifesto pendente localizado: ${file} (status: ${manifest.status}, runTag: ${manifest.runTag})`)
        const client = createClient(config, 'RecoveryClient')
        await client.connect()
        try {
          await verifyDatabaseIdentity(client)
          await executeDeletion(client, manifest)
          manifest.status = 'cleaned'
          fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf8')
          safeLog(`✓ Manifesto ${file} recuperado e limpo com sucesso!`)
          recoveredCount++
        } finally {
          try { await client.end() } catch (_) {}
        }
      }
    } catch (e) {
      safeError(`Erro ao recuperar manifesto ${file}:`, e.message)
    }
  }

  if (recoveredCount === 0) {
    safeLog('✓ Nenhum manifesto pendente de limpeza encontrado.')
  } else {
    safeLog(`✓ Total de manifestos recuperados: ${recoveredCount}`)
  }
}

// ==============================================================================
// EXECUÇÃO PRINCIPAL
// ==============================================================================

async function main() {
  const options = parseArgs()
  if (options.help) {
    printHelp()
    process.exit(0)
  }

  // Validação estrita da flag --keep-fixtures
  if (options.keepFixtures) {
    if (!options.allowDiagnosticFixtures && process.env.ALLOW_DIAGNOSTIC_FIXTURES !== '1') {
      safeError('❌ ERRO OPERACIONAL: A opção --keep-fixtures está desabilitada por padrão para proteger o ambiente.')
      safeError('Para autorizar explicitamente o modo de diagnóstico, forneça também a flag --allow-diagnostic-fixtures ou defina ALLOW_DIAGNOSTIC_FIXTURES=1.')
      process.exit(1)
    }
  }

  safeLog('==============================================================================')
  safeLog('   ELLEVEE IA — RUNNER OPERACIONAL POSTGRESQL REAL (AC-04.5-P0.5)             ')
  safeLog('==============================================================================')

  const config = getStagingConfig()

  // Modo de recuperação de manifestos interrompidos
  if (options.recover) {
    await recoverInterruptedManifests(config)
    return
  }

  const client1 = createClient(config, 'Conexão 1')
  const client2 = createClient(config, 'Conexão 2')

  const txState = { client1: false, client2: false }

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
    safeLog(`\nConectando Conexão 1 ao host: ${config.host || 'DATABASE_URL'} (TLS estrito)...`)
    await client1.connect()
    safeLog('✓ Conexão 1 estabelecida com sucesso.')

    safeLog(`Conectando Conexão 2 ao host: ${config.host || 'DATABASE_URL'} (TLS estrito)...`)
    await client2.connect()
    safeLog('✓ Conexão 2 estabelecida com sucesso.')

    // 0. Verificação Positiva de Identidade
    await verifyDatabaseIdentity(client1)

    // 1. Pré-flight
    await runPreflightChecks(client1)

    if (options.dryRun) {
      safeLog('\n[Modo --dry-run] Validações de pré-flight concluídas com sucesso. Nenhuma escrita realizada.')
      return
    }

    // 2. Permissões
    await runPermissionChecks(client1)

    // 3. Setup de Fixtures
    const fixtures = await setupFixtures(client1, client2, manifest)

    // 4. Testes ACID e Rollback Real
    await runAcidTests(client1, fixtures, manifest, txState)

    // 5. Teste de Concorrência
    if (!options.skipConcurrency) {
      await runConcurrencyTest(client1, client2, fixtures, manifest, txState)
    } else {
      safeLog('\n[Aviso] Teste de concorrência pulado devido à flag --skip-concurrency.')
    }

    safeLog('\n==============================================================================')
    safeLog('   TODOS OS TESTES ATÔMICOS E DE CONCORRÊNCIA FORAM APROVADOS COM SUCESSO!     ')
    safeLog('==============================================================================')
    manifest.status = 'passed'

  } catch (err) {
    executionFailed = true
    failureError = err
    safeError('\n❌ EXECUÇÃO ABORTADA POR ERRO:')
    safeError(err)
    manifest.status = 'failed'
    manifest.error = err.message
  } finally {
    // Rollback de segurança na conexão 2 caso tenha ficado em transação
    if (txState.client2 && client2) {
      try {
        await client2.query('ROLLBACK;')
        txState.client2 = false
        safeLog('✓ Rollback defensivo executado na Conexão 2.')
      } catch (_) {}
    }

    if (!options.dryRun && !options.keepFixtures) {
      try {
        await performTeardown(client1, manifest, config, txState)
      } catch (tdErr) {
        safeError('❌ FALHA CRÍTICA NO TEARDOWN: A execução NÃO pode ser considerada bem-sucedida.')
        executionFailed = true
        if (!failureError) failureError = tdErr
      }
    } else if (options.keepFixtures) {
      safeLog('\n[Aviso] Fixtures mantidas para auditoria manual (--keep-fixtures autorizado).')
      safeLog(`Manifesto salvo em: .staging-workspace/manifest-atomic-test-${manifest.runTag}.json`)
    }

    try { await client1.end() } catch (_) {}
    try { await client2.end() } catch (_) {}

    if (executionFailed) {
      process.exit(1)
    }
  }
}

main().catch((err) => {
  safeError('Erro fatal:', err)
  process.exit(1)
})
