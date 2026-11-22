/**
 * Script de Testes Complementares de Reconciliação (AC-SEC-01.3-H4-R)
 * Executa exclusivamente no Staging:
 * - B.4a: SuperAdmin com ID de empresa inexistente
 * - B.4b: SuperAdmin com ID de empresa suspensa
 * - B.4c: Atendente com ID de empresa inexistente
 * - E-Probe: Inspeção empírica detalhada da rota POST /api/chat/upload e bucket chat-media
 */

import fs from 'fs'
import path from 'path'
import {
  discoverServerActionIds,
  getAuthSessionCookie,
  invokeServerAction,
  invokeUploadApi,
  RUNTIME_BASE_URL,
} from './run-staging-security-matrix.mjs'

const TEST_PASSWORD = 'QaHomologPassword#2026!'
const STAGING_URL = 'https://dkjrpdhymtkgbknocijy.supabase.co'
const COMPANY_A_ID = '00000000-0000-4000-a000-000000000001'
const COMPANY_B_ID = '00000000-0000-4000-b000-000000000002'
const COMPANY_SUSPENDED_ID = '00000000-0000-4000-c000-000000000003'
const NON_EXISTENT_COMPANY_ID = '00000000-0000-4000-9999-999999999999'

async function runComplementaryTests() {
  console.log('=== [H4-R] INICIANDO TESTES COMPLEMENTARES DE RECONCILIAÇÃO ===\n')

  const actionIds = discoverServerActionIds(process.cwd())
  console.log('Action IDs descobertos:', actionIds)

  // Autenticação dos atores sintéticos
  console.log('\n[1] Autenticando SuperAdmin sintético e Alice...')
  const superadminCookie = await getAuthSessionCookie(
    'superadmin.synth@qa.ellevee.local',
    TEST_PASSWORD,
    STAGING_URL
  )
  const aliceCookie = await getAuthSessionCookie(
    'alice.qa@qa.ellevee.local',
    TEST_PASSWORD,
    STAGING_URL
  )
  console.log('✓ Sessões autenticadas com sucesso.')

  // CENÁRIO B.4a: SuperAdmin ativo com cookie de empresa inexistente
  console.log('\n--- CENÁRIO B.4a: SuperAdmin com cookie de empresa INEXISTENTE ---')
  const cookieB4a = `${superadminCookie}; ellevee_impersonate_active=${NON_EXISTENT_COMPANY_ID}`
  const resB4a = await invokeServerAction(actionIds['getAgentProfileContext'], [], cookieB4a)
  console.log('Status B.4a:', resB4a.status)
  console.log('Data retornada B.4a:', JSON.stringify(resB4a.data))
  const passB4a = resB4a.data && resB4a.data.companyId === COMPANY_A_ID && resB4a.data.role === 'admin'
  console.log(`Resultado B.4a: ${passB4a ? 'PASS' : 'FAIL'} (Retornou à empresa nativa Empresa Alfa: ${resB4a.data?.companyId})`)

  // CENÁRIO B.4b: SuperAdmin ativo com cookie de empresa SUSPENSA
  console.log('\n--- CENÁRIO B.4b: SuperAdmin com cookie de empresa SUSPENSA ---')
  const cookieB4b = `${superadminCookie}; ellevee_impersonate_active=${COMPANY_SUSPENDED_ID}`
  const resB4b = await invokeServerAction(actionIds['getAgentProfileContext'], [], cookieB4b)
  console.log('Status B.4b:', resB4b.status)
  console.log('Data retornada B.4b:', JSON.stringify(resB4b.data))
  const passB4b = resB4b.data && resB4b.data.companyId === COMPANY_A_ID && resB4b.data.role === 'admin'
  console.log(`Resultado B.4b: ${passB4b ? 'PASS' : 'FAIL'} (Recusou impersonar empresa suspensa: manteve Empresa Alfa: ${resB4b.data?.companyId})`)

  // CENÁRIO B.4c: Atendente com cookie de empresa inexistente
  console.log('\n--- CENÁRIO B.4c: Atendente Alice com cookie de empresa INEXISTENTE ---')
  const cookieB4c = `${aliceCookie}; ellevee_impersonate_active=${NON_EXISTENT_COMPANY_ID}`
  const resB4c = await invokeServerAction(actionIds['getAgentProfileContext'], [], cookieB4c)
  console.log('Status B.4c:', resB4c.status)
  console.log('Data retornada B.4c:', JSON.stringify(resB4c.data))
  const passB4c = resB4c.data && resB4c.data.companyId === COMPANY_A_ID && resB4c.data.role === 'attendant'
  console.log(`Resultado B.4c: ${passB4c ? 'PASS' : 'FAIL'} (Atendente mantida estritamente em Empresa Alfa com role attendant)`)

  // CENÁRIO E-PROBE: Inspeção de rota de upload e bucket chat-media
  console.log('\n--- PROBE DE UPLOAD: ROTA POST /api/chat/upload E BUCKET chat-media ---')
  const dummyBuffer = Buffer.from('ELLEVEE_H4_R_UPLOAD_PROBE_EVIDENCE')
  const resUpload = await invokeUploadApi(
    dummyBuffer,
    'h4r-probe.txt',
    'text/plain',
    `${superadminCookie}; ellevee_impersonate_active=${COMPANY_B_ID}`
  )
  console.log('Status Upload HTTP:', resUpload.status)
  console.log('Response JSON:', JSON.stringify(resUpload.json, null, 2))
  const uploadUrl = resUpload.json?.url || ''
  const isChatMediaBucket = uploadUrl.includes('/chat-media/')
  const isCompanyB = uploadUrl.includes(`/${COMPANY_B_ID}/`)
  console.log(`Contém /chat-media/: ${isChatMediaBucket}`)
  console.log(`Gravado sob diretório da Empresa B: ${isCompanyB}`)

  console.log('\n=== [H4-R] RESULTADO CONSOLIDADO DOS TESTES COMPLEMENTARES ===')
  console.log(`B.4a (Inexistente -> Fallback Home Tenant): ${passB4a ? 'PASS' : 'FAIL'}`)
  console.log(`B.4b (Suspensa -> Fallback Home Tenant): ${passB4b ? 'PASS' : 'FAIL'}`)
  console.log(`B.4c (Atendente -> Inalterada): ${passB4c ? 'PASS' : 'FAIL'}`)
  console.log(`E-Probe (/api/chat/upload -> chat-media): ${resUpload.status === 200 && isChatMediaBucket && isCompanyB ? 'PASS' : 'FAIL'}`)
}

runComplementaryTests().catch(err => {
  console.error('[H4-R ERROR]', err)
  process.exit(1)
})
