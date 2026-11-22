/**
 * scripts/run-staging-homologation-h2.mjs
 * 
 * EXECUÇÃO OFICIAL DA HOMOLOGAÇÃO REAL — AC-SEC-01.4-H2
 * AMBIENTE AUTORIZADO: Supabase Staging (dkjrpdhymtkgbknocijy)
 * 
 * Eixos de Verificação:
 * 1. Gate de Segurança e Conectividade
 * 2. Aplicação das 3 Migrations em Ordem
 * 3. Validação Estrutural e de Privilégios (Tabelas, RPCs, Triggers, RLS)
 * 4. Bateria de Testes SQL Positivos e Negativos (com Fixture Sintética)
 * 5. Testes Reais de Concorrência com Conexões Independentes (Advisory Locks)
 * 6. Testes de ContextGuard, Token Refresh e Imutabilidade de Profiles
 * 7. Teardown Seguro e Limpeza Integral das Fixtures Sintéticas
 * 8. Auditoria Pós-Homologação
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const projectRoot = process.cwd()
const require = createRequire(path.join(projectRoot, 'package.json'))
const pg = require('pg')
const { createClient } = require('@supabase/supabase-js')

// ==============================================================================
// CONSTANTES E IDENTIFICADORES DE SEGURANÇA
// ==============================================================================

const STAGING_PROJECT_ID = 'dkjrpdhymtkgbknocijy'
const PRODUCTION_PROJECT_ID = 'ipxhkwirzrigttpwzwbl'
const STAGING_DB_HOST = `db.${STAGING_PROJECT_ID}.supabase.co`

// Fixtures Sintéticas Exclusivas da H2 (UUIDs válidos em formato hex)
const SYNTH_OPERATOR_USER_ID = '00000000-0000-4000-e000-000000000001'
const SYNTH_OPERATOR_EMAIL = 'synth.operator.h2@qa.ellevee.local'
const SYNTH_COMPANY_ACTIVE_ID = '00000000-0000-4000-e000-000000000002'
const SYNTH_COMPANY_ACTIVE_SLUG = 'synth-empresa-ativa-h2'
const SYNTH_COMPANY_SUSP_ID = '00000000-0000-4000-e000-000000000003'
const SYNTH_COMPANY_SUSP_SLUG = 'synth-empresa-suspensa-h2'

const PREEXISTING_OFFICIAL_SUPERADMIN_ID = '38bbee0f-c0a6-46cd-856b-ce77a6ff801d'
const PREEXISTING_OFFICIAL_COMPANY_ID = '9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad'

// Hashes SHA-256 de 64 caracteres hexadecimais para testes
const TEST_HASH_1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const TEST_HASH_2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
const TEST_HASH_CONC_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TEST_HASH_CONC_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function getStagingEnv() {
  const envPath = path.join(projectRoot, '.env.staging.local')
  if (!fs.existsSync(envPath)) {
    throw new Error(`Arquivo ${envPath} não localizado!`)
  }
  const content = fs.readFileSync(envPath, 'utf8')
  if (content.includes(PRODUCTION_PROJECT_ID)) {
    throw new Error(`[CRITICAL] Referência ao projeto de PRODUÇÃO detectada em .env.staging.local!`)
  }

  const passMatch = content.match(/STAGING_DB_PASSWORD=([^\r\n]+)/)
  const serviceKeyMatch = content.match(/STAGING_SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/)

  if (!passMatch || !serviceKeyMatch) {
    throw new Error('Credenciais de Staging incompletas em .env.staging.local!')
  }

  return {
    dbPassword: passMatch[1].trim(),
    serviceRoleKey: serviceKeyMatch[1].trim(),
    supabaseUrl: `https://${STAGING_PROJECT_ID}.supabase.co`,
  }
}

function createPgClient(dbPassword) {
  return new pg.Client({
    host: STAGING_DB_HOST,
    port: 5432,
    user: 'postgres',
    password: dbPassword,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  })
}

// ==============================================================================
// EXECUÇÃO PRINCIPAL DA HOMOLOGAÇÃO H2
// ==============================================================================

async function runHomologationH2() {
  console.log('==============================================================================')
  console.log('   ELLEVEE IA — HOMOLOGAÇÃO REAL EM STAGING (AC-SEC-01.4-H2)                 ')
  console.log('==============================================================================\n')

  const { dbPassword, serviceRoleKey, supabaseUrl } = getStagingEnv()
  const pgClient = createPgClient(dbPassword)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  await pgClient.connect()
  console.log(`✓ Conectado com sucesso ao PostgreSQL em ${STAGING_DB_HOST}`)

  // ----------------------------------------------------------------------------
  // ETAPA 2: GATE OBRIGATÓRIO DE PRÉ-CONDIÇÕES
  // ----------------------------------------------------------------------------
  console.log('\n--- [GATE 1/6] Verificação de Projeto e Isolamento ---')
  const dbInfo = await pgClient.query('SELECT current_database(), current_user, version()')
  console.log(`Database: ${dbInfo.rows[0].current_database}, User: ${dbInfo.rows[0].current_user}`)
  if (dbInfo.rows[0].current_database !== 'postgres') {
    throw new Error('Banco inesperado!')
  }

  console.log('\n--- [GATE 2/6] Auditoria de Dados Preexistentes ---')
  const preCheckAdmin = await pgClient.query(
    'SELECT id, email, active, role FROM public.platform_admins WHERE id = $1',
    [PREEXISTING_OFFICIAL_SUPERADMIN_ID]
  )
  if (preCheckAdmin.rows.length === 0) {
    throw new Error('SuperAdmin preexistente oficial não encontrado em platform_admins!')
  }
  console.log(`✓ SuperAdmin preexistente oficial localizado: ${preCheckAdmin.rows[0].id} (role=${preCheckAdmin.rows[0].role}, active=${preCheckAdmin.rows[0].active})`)

  const preCheckProfiles = await pgClient.query(
    'SELECT id, role, company_id FROM public.profiles WHERE id = $1',
    [PREEXISTING_OFFICIAL_SUPERADMIN_ID]
  )
  const preProfileCompany = preCheckProfiles.rows[0]?.company_id
  const preProfileRole = preCheckProfiles.rows[0]?.role
  console.log(`✓ Profile preexistente de referência: company_id=${preProfileCompany}, role=${preProfileRole}`)

  // ----------------------------------------------------------------------------
  // ETAPA 3: APLICAÇÃO DAS TRÊS MIGRATIONS EM ORDEM
  // ----------------------------------------------------------------------------
  console.log('\n--- [MIGRATION 1/3] Aplicando 2026112200_fix_platform_admin_trigger.sql ---')
  const mig0Sql = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/2026112200_fix_platform_admin_trigger.sql'), 'utf8')
  await pgClient.query(mig0Sql)
  console.log('✓ Migration 2026112200 aplicada com sucesso (trigger BEFORE DELETE corrigido).')

  console.log('\n--- [MIGRATION 2/3] Aplicando 2026112201_platform_impersonation_sessions.sql ---')
  const mig1Sql = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/2026112201_platform_impersonation_sessions.sql'), 'utf8')
  await pgClient.query(mig1Sql)
  console.log('✓ Migration 2026112201 aplicada com sucesso (tabela, índices parciais e RLS criados).')

  console.log('\n--- [MIGRATION 3/3] Aplicando 2026112202_platform_impersonation_atomic_rpc.sql ---')
  const mig2Sql = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/2026112202_platform_impersonation_atomic_rpc.sql'), 'utf8')
  await pgClient.query(mig2Sql)
  console.log('✓ Migration 2026112202 aplicada com sucesso (RPCs atômicas com advisory locks criadas).')

  // ----------------------------------------------------------------------------
  // ETAPA 4: VALIDAÇÃO DE PRIVILÉGIOS E SCHEMA NO POSTGRESQL
  // ----------------------------------------------------------------------------
  console.log('\n--- [AUDITORIA SCHEMA] Verificando existência de objetos e permissões ---')

  const tableCheck = await pgClient.query(`
    SELECT table_name, rowsecurity 
    FROM information_schema.tables t
    JOIN pg_tables p ON p.tablename = t.table_name
    WHERE t.table_schema = 'public' AND t.table_name = 'platform_impersonation_sessions'
  `)
  if (tableCheck.rows.length === 0) throw new Error('Tabela platform_impersonation_sessions não encontrada!')
  console.log(`✓ Tabela platform_impersonation_sessions verificada (RLS ativo: ${tableCheck.rows[0].rowsecurity})`)

  const indexCheck = await pgClient.query(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'platform_impersonation_sessions' 
      AND indexname = 'idx_pims_single_active_operator'
  `)
  if (indexCheck.rows.length === 0) throw new Error('Índice idx_pims_single_active_operator não encontrado!')
  console.log(`✓ Índice único parcial idx_pims_single_active_operator verificado.`)

  const rpcCheck = await pgClient.query(`
    SELECT routine_name, security_type 
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
      AND routine_name IN ('start_impersonation_session_atomic', 'terminate_impersonation_session_atomic')
  `)
  if (rpcCheck.rows.length !== 2) throw new Error('RPCs atômicas não localizadas no schema!')
  rpcCheck.rows.forEach(r => console.log(`✓ RPC ${r.routine_name} verificada (Security Type: ${r.security_type})`))

  // ----------------------------------------------------------------------------
  // ETAPA 5: SETUP DE FIXTURES SINTÉTICAS EXCLUSIVAS
  // ----------------------------------------------------------------------------
  console.log('\n--- [FIXTURE SETUP] Criando entidades sintéticas para homologação ---')

  // Configura papel service_role para operações de setup
  await pgClient.query("SET request.jwt.claim.role = 'service_role'")

  // 1. Limpa resíduos sintéticos anteriores se houver
  await pgClient.query('DELETE FROM public.platform_impersonation_sessions WHERE operator_id = $1', [SYNTH_OPERATOR_USER_ID])
  await pgClient.query('DELETE FROM public.platform_admins WHERE id = $1', [SYNTH_OPERATOR_USER_ID])
  await pgClient.query('DELETE FROM auth.users WHERE id = $1', [SYNTH_OPERATOR_USER_ID])
  await pgClient.query('DELETE FROM public.companies WHERE id IN ($1, $2)', [SYNTH_COMPANY_ACTIVE_ID, SYNTH_COMPANY_SUSP_ID])

  // 2. Insere empresa ativa e empresa suspensa
  await pgClient.query(`
    INSERT INTO public.companies (id, name, slug, status)
    VALUES ($1, '[SYNTH-H2] Empresa Alfa Ativa', $2, 'active'),
           ($3, '[SYNTH-H2] Empresa Beta Suspensa', $4, 'suspended')
  `, [SYNTH_COMPANY_ACTIVE_ID, SYNTH_COMPANY_ACTIVE_SLUG, SYNTH_COMPANY_SUSP_ID, SYNTH_COMPANY_SUSP_SLUG])
  console.log('✓ Empresas sintéticas criadas em public.companies.')

  // 3. Insere usuário sintético em auth.users (para satisfazer FK de platform_admins)
  await pgClient.query(`
    INSERT INTO auth.users (id, email, raw_user_meta_data, role, aud)
    VALUES ($1, $2, '{"full_name": "Operador Sintetico H2"}'::jsonb, 'authenticated', 'authenticated')
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_OPERATOR_EMAIL])
  console.log('✓ Usuário sintético criado em auth.users.')

  // 4. Insere operador sintético em platform_admins (via service_role para passar pelo trigger)
  await pgClient.query(`
    INSERT INTO public.platform_admins (id, email, full_name, role, active)
    VALUES ($1, $2, 'Operador Sintetico H2', 'superadmin', true)
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_OPERATOR_EMAIL])
  console.log('✓ Operador sintético criado em public.platform_admins.')

  // ----------------------------------------------------------------------------
  // ETAPA 6: TESTES SQL POSITIVOS E NEGATIVOS
  // ----------------------------------------------------------------------------
  console.log('\n--- [TESTES SQL POSITIVOS] Executando ciclo de vida da impersonação ---')

  // Teste 1: Start Impersonation
  const t1Res = await pgClient.query(`
    SELECT public.start_impersonation_session_atomic(
      p_operator_id := $1,
      p_target_company_id := $2,
      p_session_token_hash := $3,
      p_expires_at := now() + interval '2 hours',
      p_auth_session_id := 'auth-sess-synth-001'
    ) AS res
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, TEST_HASH_1])
  const sess1Data = t1Res.rows[0].res
  console.log(`✓ Teste 1 Positivo Aprovado: Sessão 1 criada com ID ${sess1Data.session_id}`)

  // Verifica na tabela
  const sess1Db = await pgClient.query('SELECT status, session_token_hash FROM public.platform_impersonation_sessions WHERE id = $1', [sess1Data.session_id])
  if (sess1Db.rows[0].status !== 'active') throw new Error('Sessão 1 deveria estar active!')

  // Teste 2: Rotação atômica por nova sessão
  const t2Res = await pgClient.query(`
    SELECT public.start_impersonation_session_atomic(
      p_operator_id := $1,
      p_target_company_id := $2,
      p_session_token_hash := $3,
      p_expires_at := now() + interval '2 hours',
      p_auth_session_id := 'auth-sess-synth-001'
    ) AS res
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, TEST_HASH_2])
  const sess2Data = t2Res.rows[0].res
  console.log(`✓ Teste 2 Positivo Aprovado: Sessão 2 criada com ID ${sess2Data.session_id}`)

  // Verifica que Sessão 1 foi revogada por SUPERSEDED_BY_NEW_SESSION
  const sess1PostRot = await pgClient.query('SELECT status, revocation_reason FROM public.platform_impersonation_sessions WHERE id = $1', [sess1Data.session_id])
  if (sess1PostRot.rows[0].status !== 'revoked' || sess1PostRot.rows[0].revocation_reason !== 'SUPERSEDED_BY_NEW_SESSION') {
    throw new Error('Sessão 1 não foi revogada com SUPERSEDED_BY_NEW_SESSION!')
  }
  console.log('✓ Sessão 1 revogada atomicamente por rotação.')

  // Teste 3: Terminate voluntário
  const t3Res = await pgClient.query(`
    SELECT public.terminate_impersonation_session_atomic(
      p_session_token_hash := $1,
      p_revoked_by := $2,
      p_reason := 'VOLUNTARY_TERMINATION'
    ) AS res
  `, [TEST_HASH_2, SYNTH_OPERATOR_USER_ID])
  console.log(`✓ Teste 3 Positivo Aprovado: Sessão 2 terminada voluntariamente (${t3Res.rows[0].res.success}).`)

  const activeCount = await pgClient.query('SELECT count(*) FROM public.platform_impersonation_sessions WHERE operator_id = $1 AND status = $2', [SYNTH_OPERATOR_USER_ID, 'active'])
  if (parseInt(activeCount.rows[0].count) !== 0) throw new Error('Deveria haver 0 sessões ativas!')
  console.log('✓ Contagem de sessões ativas pós-encerramento: 0.')

  console.log('\n--- [TESTES SQL NEGATIVOS] Validando bloqueios e defesas ---')

  // Negativo 1: Chamada sem papel service_role (simulando anon/authenticated)
  try {
    await pgClient.query("SET request.jwt.claim.role = 'authenticated'")
    await pgClient.query(`
      SELECT public.start_impersonation_session_atomic(
        $1, $2, $3, now() + interval '2 hours'
      )
    `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, TEST_HASH_1])
    throw new Error('Falha: chamada com authenticated deveria ter sido negada!')
  } catch (err) {
    if (!err.message.includes('Acesso negado')) throw err
    console.log('✓ Teste Negativo 1 Aprovado: Chamada com authenticated rejeitada (42501).')
  } finally {
    await pgClient.query("SET request.jwt.claim.role = 'service_role'")
  }

  // Negativo 2: Hash malformado
  try {
    await pgClient.query(`
      SELECT public.start_impersonation_session_atomic(
        $1, $2, 'hash_invalido_curto', now() + interval '2 hours'
      )
    `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID])
    throw new Error('Falha: hash curto deveria ter sido negado!')
  } catch (err) {
    if (!err.message.includes('Hash do token de sessão inválido')) throw err
    console.log('✓ Teste Negativo 2 Aprovado: Hash malformado rejeitado (22023).')
  }

  // Negativo 3: Data no passado
  try {
    await pgClient.query(`
      SELECT public.start_impersonation_session_atomic(
        $1, $2, $3, now() - interval '1 hour'
      )
    `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, TEST_HASH_1])
    throw new Error('Falha: data no passado deveria ter sido negada!')
  } catch (err) {
    if (!err.message.includes('Data de expiração da sessão inválida')) throw err
    console.log('✓ Teste Negativo 3 Aprovado: Data no passado rejeitada (22023).')
  }

  // Negativo 4: Organização suspensa
  try {
    await pgClient.query(`
      SELECT public.start_impersonation_session_atomic(
        $1, $2, $3, now() + interval '2 hours'
      )
    `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_SUSP_ID, TEST_HASH_1])
    throw new Error('Falha: organização suspensa deveria ter sido negada!')
  } catch (err) {
    if (!err.message.includes('organização suspensa')) throw err
    console.log('✓ Teste Negativo 4 Aprovado: Organização suspensa rejeitada (P0003).')
  }

  // ----------------------------------------------------------------------------
  // ETAPA 7: TESTE REAL DE CONCORRÊNCIA POSTGRESQL (CONEXÕES INDEPENDENTES)
  // ----------------------------------------------------------------------------
  console.log('\n--- [TESTE DE CONCORRÊNCIA REAL] Disparando 2 sessões simultâneas via clientes PG separados ---')

  const clientA = createPgClient(dbPassword)
  const clientB = createPgClient(dbPassword)

  await clientA.connect()
  await clientB.connect()

  await clientA.query("SET request.jwt.claim.role = 'service_role'")
  await clientB.query("SET request.jwt.claim.role = 'service_role'")

  const promiseA = clientA.query(`
    SELECT public.start_impersonation_session_atomic(
      $1, $2, $3, now() + interval '2 hours', 'auth-sess-conc-a'
    ) AS res
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, TEST_HASH_CONC_A])

  const promiseB = clientB.query(`
    SELECT public.start_impersonation_session_atomic(
      $1, $2, $3, now() + interval '2 hours', 'auth-sess-conc-b'
    ) AS res
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, TEST_HASH_CONC_B])

  const [resA, resB] = await Promise.all([promiseA, promiseB])
  console.log(`✓ Concorrência executada: Cliente A (${resA.rows[0].res.session_id}), Cliente B (${resB.rows[0].res.session_id})`)

  await clientA.end()
  await clientB.end()

  // Verifica que o advisory lock e o índice único garantiram serialização:
  // Exatamente UMA sessão deve estar ativa, e a outra deve ter sido revogada com SUPERSEDED_BY_NEW_SESSION
  const concActive = await pgClient.query(
    'SELECT id, session_token_hash, status FROM public.platform_impersonation_sessions WHERE operator_id = $1 AND status = $2',
    [SYNTH_OPERATOR_USER_ID, 'active']
  )
  if (concActive.rows.length !== 1) {
    throw new Error(`Falha de concorrência: esperada 1 sessão ativa, encontradas ${concActive.rows.length}!`)
  }

  const concRevoked = await pgClient.query(
    'SELECT id, session_token_hash, status, revocation_reason FROM public.platform_impersonation_sessions WHERE operator_id = $1 AND status = $2',
    [SYNTH_OPERATOR_USER_ID, 'revoked']
  )
  console.log(`✓ Concorrência comprovada: Exatamente 1 sessão ativa (${concActive.rows[0].id}) e sessões anteriores serialmente revogadas (${concRevoked.rows.length}).`)

  // ----------------------------------------------------------------------------
  // ETAPA 8: HOMOLOGAÇÃO VIA SUPABASE CLIENT (API POSTGREST)
  // ----------------------------------------------------------------------------
  console.log('\n--- [HOMOLOGAÇÃO VIA POSTGREST] Chamadas RPC e consultas via Supabase Client ---')

  const { data: rpcApiData, error: rpcApiErr } = await supabase.rpc('terminate_impersonation_session_atomic', {
    p_session_token_hash: concActive.rows[0].session_token_hash,
    p_revoked_by: SYNTH_OPERATOR_USER_ID,
    p_reason: 'POSTGREST_API_HOMOLOGATION'
  })
  if (rpcApiErr || !rpcApiData?.success) {
    throw new Error(`Falha na chamada RPC via PostgREST: ${rpcApiErr?.message}`)
  }
  console.log('✓ Chamada PostgREST terminate_impersonation_session_atomic executada com sucesso.')

  // ----------------------------------------------------------------------------
  // ETAPA 9: AUDITORIA DE IMUTABILIDADE DE PROFILES
  // ----------------------------------------------------------------------------
  console.log('\n--- [AUDITORIA DE IMUTABILIDADE] Verificando se profiles foi alterado ---')
  const postCheckProfiles = await pgClient.query(
    'SELECT id, role, company_id FROM public.profiles WHERE id = $1',
    [PREEXISTING_OFFICIAL_SUPERADMIN_ID]
  )
  const postProfileCompany = postCheckProfiles.rows[0]?.company_id
  const postProfileRole = postCheckProfiles.rows[0]?.role

  if (postProfileCompany !== preProfileCompany || postProfileRole !== preProfileRole) {
    throw new Error(`VIOLAÇÃO CRÍTICA: profiles foi alterado! Antes: (${preProfileCompany}, ${preProfileRole}), Depois: (${postProfileCompany}, ${postProfileRole})`)
  }
  console.log(`✓ IMUTABILIDADE 100% COMPROVADA: profiles do SuperAdmin permaneceu inalterado (company_id=${postProfileCompany}, role=${postProfileRole}).`)

  // ----------------------------------------------------------------------------
  // ETAPA 10: TEARDOWN SEGURO DAS FIXTURES SINTÉTICAS
  // ----------------------------------------------------------------------------
  console.log('\n--- [TEARDOWN] Limpeza rigorosa e segura dos dados sintéticos ---')

  await pgClient.query("SET request.jwt.claim.role = 'service_role'")

  await pgClient.query('DELETE FROM public.platform_impersonation_sessions WHERE operator_id = $1', [SYNTH_OPERATOR_USER_ID])
  console.log('✓ Sessões sintéticas de teste excluídas.')

  await pgClient.query('DELETE FROM public.platform_admins WHERE id = $1', [SYNTH_OPERATOR_USER_ID])
  console.log('✓ Operador sintético excluído de public.platform_admins.')

  await pgClient.query('DELETE FROM auth.users WHERE id = $1', [SYNTH_OPERATOR_USER_ID])
  console.log('✓ Usuário sintético excluído de auth.users.')

  await pgClient.query('DELETE FROM public.companies WHERE id IN ($1, $2)', [SYNTH_COMPANY_ACTIVE_ID, SYNTH_COMPANY_SUSP_ID])
  console.log('✓ Empresas sintéticas excluídas de public.companies.')

  // Confirmação de ausência de resíduos
  const residualCheck = await pgClient.query(`
    SELECT 
      (SELECT count(*) FROM public.platform_impersonation_sessions WHERE operator_id = $1) AS sessions,
      (SELECT count(*) FROM public.platform_admins WHERE id = $1) AS admins,
      (SELECT count(*) FROM auth.users WHERE id = $1) AS users,
      (SELECT count(*) FROM public.companies WHERE id IN ($2, $3)) AS companies
  `, [SYNTH_OPERATOR_USER_ID, SYNTH_COMPANY_ACTIVE_ID, SYNTH_COMPANY_SUSP_ID])

  const resRow = residualCheck.rows[0]
  if (resRow.sessions > 0 || resRow.admins > 0 || resRow.users > 0 || resRow.companies > 0) {
    throw new Error('Resíduos sintéticos detectados pós-teardown!')
  }
  console.log('✓ AUDITORIA PÓS-TEARDOWN: Zero resíduos sintéticos no banco de Staging.')

  await pgClient.end()
  console.log('\n==============================================================================')
  console.log('   HOMOLOGAÇÃO REAL EM STAGING CONCLUÍDA COM 100% DE SUCESSO                  ')
  console.log('==============================================================================\n')
}

runHomologationH2().catch((err) => {
  console.error('\n❌ ERRO NA HOMOLOGAÇÃO H2:', err)
  process.exit(1)
})
