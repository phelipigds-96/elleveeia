import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import { retryOutboxMessage, isValidUuid } from '@/lib/services/message-engine'

test.describe('ETAPA 8.4.3Q.2.2 — Hardening do Reprocessamento de Outbox', () => {
  // Empresas de Teste
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED_ID = '33333333-3333-3333-3333-333333333333'
  const TENANT_CANCELLED_ID = '44444444-4444-4444-4444-444444444444'
  const TENANT_PROVISIONING_ID = '55555555-5555-5555-5555-555555555555'

  // Conversas
  const CONV_A_ID = 'aaaaaaaa-1111-0000-0000-000000000001'
  const CONV_B_ID = 'bbbbbbbb-2222-0000-0000-000000000001'
  const CONV_SUSP_ID = 'cccccccc-3333-0000-0000-000000000001'
  const CONV_CANC_ID = 'dddddddd-4444-0000-0000-000000000001'
  const CONV_PROV_ID = 'eeeeeeee-5555-0000-0000-000000000001'

  // Mensagens
  const MSG_A1_ID = '10000000-1111-0000-0000-000000000001'
  const MSG_B1_ID = '20000000-2222-0000-0000-000000000001'

  // Outbox IDs
  const OUTBOX_A1_FAILED = '90000000-aaaa-0000-0000-000000000001'
  const OUTBOX_A2_SENT = '90000000-aaaa-0000-0000-000000000002'
  const OUTBOX_A3_SUPPRESSED = '90000000-aaaa-0000-0000-000000000003'
  const OUTBOX_A4_CORRUPT_MSG = '90000000-aaaa-0000-0000-000000000004'
  const OUTBOX_A5_UNKNOWN_STATUS = '90000000-aaaa-0000-0000-000000000005'

  const OUTBOX_B1_FAILED = '90000000-bbbb-0000-0000-000000000001'
  const OUTBOX_SUSP_FAILED = '90000000-cccc-0000-0000-000000000001'
  const OUTBOX_CANC_FAILED = '90000000-dddd-0000-0000-000000000001'
  const OUTBOX_PROV_FAILED = '90000000-eeee-0000-0000-000000000001'

  let fetchCallCount = 0
  let fetchHistory: any[] = []
  let originalFetch: any

  function seedDb() {
    resetInMemoryDb()
    fetchCallCount = 0
    fetchHistory = []

    // 1. Tenants
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa Alpha (Ativa)',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa Beta (Ativa)',
      status: 'active',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Gamma (Suspensa)',
      status: 'suspended',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_CANCELLED_ID, {
      id: TENANT_CANCELLED_ID,
      name: 'Empresa Delta (Cancelada)',
      status: 'cancelled',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_PROVISIONING_ID, {
      id: TENANT_PROVISIONING_ID,
      name: 'Empresa Epsilon (Em Provisionamento)',
      status: 'provisioning',
      plan_tier: 'standard'
    })

    // 2. Integrações n8n
    inMemoryDb.integrations.set('int-alpha-n8n', {
      id: 'int-alpha-n8n',
      company_id: TENANT_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-alpha-123' }
    })
    inMemoryDb.integrations.set('int-beta-n8n', {
      id: 'int-beta-n8n',
      company_id: TENANT_B_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-beta-123' }
    })

    // 3. Conversas
    inMemoryDb.conversations.set(CONV_A_ID, {
      id: CONV_A_ID,
      company_id: TENANT_A_ID,
      status: 'open',
      channel: 'whatsapp'
    })
    inMemoryDb.conversations.set(CONV_B_ID, {
      id: CONV_B_ID,
      company_id: TENANT_B_ID,
      status: 'open',
      channel: 'whatsapp'
    })
    inMemoryDb.conversations.set(CONV_SUSP_ID, {
      id: CONV_SUSP_ID,
      company_id: TENANT_SUSPENDED_ID,
      status: 'open',
      channel: 'whatsapp'
    })

    // 4. Mensagens
    inMemoryDb.messages.set(MSG_A1_ID, {
      id: MSG_A1_ID,
      company_id: TENANT_A_ID,
      conversation_id: CONV_A_ID,
      content: 'Mensagem Alpha legítima'
    })
    inMemoryDb.messages.set(MSG_B1_ID, {
      id: MSG_B1_ID,
      company_id: TENANT_B_ID,
      conversation_id: CONV_B_ID,
      content: 'Mensagem Beta legítima'
    })

    // 5. Outbox
    inMemoryDb.message_outbox.set(OUTBOX_A1_FAILED, {
      id: OUTBOX_A1_FAILED,
      company_id: TENANT_A_ID,
      conversation_id: CONV_A_ID,
      message_id: MSG_A1_ID,
      idempotency_key: 'agent-reply-alpha-001',
      channel: 'whatsapp',
      recipient: '+5511999990001',
      payload: { message: { content: 'Resposta Alpha pendente de retry' } },
      status: 'failed',
      attempts: 1,
      last_error: 'HTTP 502 Bad Gateway'
    })

    inMemoryDb.message_outbox.set(OUTBOX_A2_SENT, {
      id: OUTBOX_A2_SENT,
      company_id: TENANT_A_ID,
      conversation_id: CONV_A_ID,
      message_id: MSG_A1_ID,
      idempotency_key: 'agent-reply-alpha-002',
      channel: 'whatsapp',
      recipient: '+5511999990001',
      payload: { message: { content: 'Já enviada anteriormente' } },
      status: 'sent',
      attempts: 1
    })

    inMemoryDb.message_outbox.set(OUTBOX_A3_SUPPRESSED, {
      id: OUTBOX_A3_SUPPRESSED,
      company_id: TENANT_A_ID,
      conversation_id: CONV_A_ID,
      message_id: MSG_A1_ID,
      idempotency_key: 'agent-reply-alpha-003',
      channel: 'whatsapp',
      recipient: '+5511999990001',
      payload: { message: { content: 'Suprimida' } },
      status: 'suppressed',
      attempts: 1,
      last_error: 'Envio suprimido por handoff'
    })

    inMemoryDb.message_outbox.set(OUTBOX_A4_CORRUPT_MSG, {
      id: OUTBOX_A4_CORRUPT_MSG,
      company_id: TENANT_A_ID, // Pertence à empresa A
      conversation_id: CONV_A_ID,
      message_id: MSG_B1_ID, // MENSAGEM PERTENCE À EMPRESA B (Violação Cross-Tenant)
      idempotency_key: 'agent-reply-alpha-corrupt-004',
      channel: 'whatsapp',
      recipient: '+5511999990001',
      payload: { message: { content: 'Mensagem adulterada' } },
      status: 'failed',
      attempts: 1
    })

    inMemoryDb.message_outbox.set(OUTBOX_A5_UNKNOWN_STATUS, {
      id: OUTBOX_A5_UNKNOWN_STATUS,
      company_id: TENANT_A_ID,
      conversation_id: CONV_A_ID,
      message_id: MSG_A1_ID,
      idempotency_key: 'agent-reply-alpha-005',
      channel: 'whatsapp',
      recipient: '+5511999990001',
      payload: { message: { content: 'Status desconhecido' } },
      status: 'draft', // Não é pending nem failed
      attempts: 0
    })

    inMemoryDb.message_outbox.set(OUTBOX_B1_FAILED, {
      id: OUTBOX_B1_FAILED,
      company_id: TENANT_B_ID,
      conversation_id: CONV_B_ID,
      message_id: MSG_B1_ID,
      idempotency_key: 'agent-reply-beta-001',
      channel: 'whatsapp',
      recipient: '+5521999990002',
      payload: { message: { content: 'Resposta Beta pendente de retry' } },
      status: 'failed',
      attempts: 1
    })

    inMemoryDb.message_outbox.set(OUTBOX_SUSP_FAILED, {
      id: OUTBOX_SUSP_FAILED,
      company_id: TENANT_SUSPENDED_ID,
      conversation_id: CONV_SUSP_ID,
      message_id: null,
      idempotency_key: 'agent-reply-susp-001',
      channel: 'whatsapp',
      recipient: '+5531999990003',
      payload: { message: { content: 'Envio empresa suspensa' } },
      status: 'failed',
      attempts: 1
    })

    inMemoryDb.message_outbox.set(OUTBOX_CANC_FAILED, {
      id: OUTBOX_CANC_FAILED,
      company_id: TENANT_CANCELLED_ID,
      conversation_id: CONV_CANC_ID,
      message_id: null,
      idempotency_key: 'agent-reply-canc-001',
      channel: 'whatsapp',
      recipient: '+5531999990004',
      payload: { message: { content: 'Envio empresa cancelada' } },
      status: 'failed',
      attempts: 1
    })

    inMemoryDb.message_outbox.set(OUTBOX_PROV_FAILED, {
      id: OUTBOX_PROV_FAILED,
      company_id: TENANT_PROVISIONING_ID,
      conversation_id: CONV_PROV_ID,
      message_id: null,
      idempotency_key: 'agent-reply-prov-001',
      channel: 'whatsapp',
      recipient: '+5531999990005',
      payload: { message: { content: 'Envio empresa provisioning' } },
      status: 'failed',
      attempts: 1
    })
  }

  test.beforeEach(() => {
    seedDb()
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: any, options: any) => {
      fetchCallCount++
      fetchHistory.push({ url, options })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully' })
      } as any
    }) as any
  })

  test.afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ============================================================================
  // TESTE 1: Retry com companyId correto e registro pertencente à empresa
  // ============================================================================
  test('1. Retry com companyId correto e registro pertencente à empresa despacha com sucesso', async () => {
    const adminClient = createAdminClient()
    const result = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A1_FAILED, { adminClient })

    assert.equal(result.success, true)
    assert.equal(fetchCallCount, 1, 'Deve disparar 1 chamada externa via gateway')

    // Registro na outbox deve ter sido atualizado para sent com attempts incrementado
    const updated = inMemoryDb.message_outbox.get(OUTBOX_A1_FAILED)
    assert.equal(updated.status, 'sent')
    assert.equal(updated.attempts, 2)
    assert.ok(updated.sent_at)
  })

  // ============================================================================
  // TESTE 2: Retry com companyId divergente (Tentativa Cross-Tenant)
  // ============================================================================
  test('2. Retry com companyId divergente bloqueia a consulta sem revelar existência do registro', async () => {
    const adminClient = createAdminClient()

    // Passa TENANT_A_ID mas o outboxId pertence a TENANT_B_ID
    const result = await retryOutboxMessage(TENANT_A_ID, OUTBOX_B1_FAILED, { adminClient })

    assert.equal(result.success, false)
    assert.equal(result.error, 'Registro não encontrado')
    assert.equal(fetchCallCount, 0, 'Nenhum envio pode ser disparado em caso de tenant divergente')

    // Registro da Empresa B permanece inalterado
    const recordB = inMemoryDb.message_outbox.get(OUTBOX_B1_FAILED)
    assert.equal(recordB.status, 'failed')
    assert.equal(recordB.attempts, 1)
  })

  // ============================================================================
  // TESTE 3: UUID inválido de empresa ou Outbox (Sem consulta ao banco)
  // ============================================================================
  test('3. UUID inválido de empresa ou outbox rejeita de imediato sem consultar o banco', async () => {
    let dbQueryCount = 0
    const trackingClient = {
      from: () => {
        dbQueryCount++
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })
        }
      }
    }

    // Caso A: companyId inválido
    const resA = await retryOutboxMessage('invalid-uuid', OUTBOX_A1_FAILED, { adminClient: trackingClient })
    assert.equal(resA.success, false)
    assert.match(resA.error || '', /Identificador inválido/i)
    assert.equal(dbQueryCount, 0, 'Não deve tocar no banco se o companyId for inválido')

    // Caso B: outboxId inválido
    const resB = await retryOutboxMessage(TENANT_A_ID, 'outbox-string-not-uuid', { adminClient: trackingClient })
    assert.equal(resB.success, false)
    assert.match(resB.error || '', /Identificador inválido/i)
    assert.equal(dbQueryCount, 0, 'Não deve tocar no banco se o outboxId for inválido')
    assert.equal(fetchCallCount, 0, 'Nenhum despacho externo pode ocorrer')
  })

  // ============================================================================
  // TESTE 4: Registro inexistente
  // ============================================================================
  test('4. Registro inexistente retorna erro seguro sem disparar gateway', async () => {
    const adminClient = createAdminClient()
    const nonExistentOutboxId = '00000000-0000-0000-0000-999999999999'

    const result = await retryOutboxMessage(TENANT_A_ID, nonExistentOutboxId, { adminClient })

    assert.equal(result.success, false)
    assert.equal(result.error, 'Registro não encontrado')
    assert.equal(fetchCallCount, 0)
  })

  // ============================================================================
  // TESTE 5: Tenant suspenso, cancelado ou em provisioning
  // ============================================================================
  test('5. Tenant suspenso, cancelado ou em provisioning bloqueia o envio e marca outbox como suppressed', async () => {
    const adminClient = createAdminClient()

    // 1. Suspenso
    const resSusp = await retryOutboxMessage(TENANT_SUSPENDED_ID, OUTBOX_SUSP_FAILED, { adminClient })
    assert.equal(resSusp.success, false)
    assert.equal(resSusp.code, 'TENANT_SUSPENDED')
    assert.equal(resSusp.suppressed, true)
    const outboxSusp = inMemoryDb.message_outbox.get(OUTBOX_SUSP_FAILED)
    assert.equal(outboxSusp.status, 'suppressed')

    // 2. Cancelado
    const resCanc = await retryOutboxMessage(TENANT_CANCELLED_ID, OUTBOX_CANC_FAILED, { adminClient })
    assert.equal(resCanc.success, false)
    assert.equal(resCanc.code, 'TENANT_CANCELLED')
    assert.equal(resCanc.suppressed, true)

    // 3. Provisioning
    const resProv = await retryOutboxMessage(TENANT_PROVISIONING_ID, OUTBOX_PROV_FAILED, { adminClient })
    assert.equal(resProv.success, false)
    assert.equal(resProv.code, 'TENANT_PROVISIONING')
    assert.equal(resProv.suppressed, true)

    assert.equal(fetchCallCount, 0, 'Nenhum envio para empresas suspensas/canceladas/provisioning')
  })

  // ============================================================================
  // TESTE 6: Mensagem vinculada pertencente a outro tenant
  // ============================================================================
  test('6. Mensagem vinculada pertencente a outro tenant bloqueia o despacho', async () => {
    const adminClient = createAdminClient()

    // OUTBOX_A4_CORRUPT_MSG tem company_id = TENANT_A_ID, mas message_id = MSG_B1_ID (Empresa B)
    const result = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A4_CORRUPT_MSG, { adminClient })

    assert.equal(result.success, false)
    assert.match(result.error || '', /Mensagem vinculada não encontrada ou pertence a outro tenant/i)
    assert.equal(fetchCallCount, 0, 'Despacho deve ser estritamente bloqueado')
  })

  // ============================================================================
  // TESTE 7: Registro em estado não elegível para retry
  // ============================================================================
  test('7. Registro em estado não elegível para retry (sent, suppressed, draft) é bloqueado', async () => {
    const adminClient = createAdminClient()

    // 1. Registro já enviado (sent) -> idempotência sem novo despacho
    const resSent = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A2_SENT, { adminClient })
    assert.equal(resSent.success, true)
    assert.equal(resSent.alreadySent, true)
    assert.equal(fetchCallCount, 0)

    // 2. Registro suprimido (suppressed) -> rejeitado
    const resSupp = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A3_SUPPRESSED, { adminClient })
    assert.equal(resSupp.success, false)
    assert.equal(resSupp.suppressed, true)
    assert.match(resSupp.error || '', /suprimida não pode ser reprocessada/i)
    assert.equal(fetchCallCount, 0)

    // 3. Status não elegível (draft) -> rejeitado
    const resDraft = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A5_UNKNOWN_STATUS, { adminClient })
    assert.equal(resDraft.success, false)
    assert.match(resDraft.error || '', /não elegível para retry/i)
    assert.equal(fetchCallCount, 0)
  })

  // ============================================================================
  // TESTE 8: Falha de consulta ao Supabase
  // ============================================================================
  test('8. Falha na consulta ao banco retorna erro amigável sem chamar gateway', async () => {
    const failingClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'PostgreSQL connection timeout (ECONNRESET)' }
              })
            })
          })
        })
      })
    }

    const result = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A1_FAILED, { adminClient: failingClient })

    assert.equal(result.success, false)
    assert.match(result.error || '', /Falha na consulta da outbox/i)
    assert.equal(fetchCallCount, 0)
  })

  // ============================================================================
  // TESTE 9: Falha ao atualizar o registro após o despacho
  // ============================================================================
  test('9. Falha ao atualizar o registro após o despacho não quebra a operação', async () => {
    const baseClient = createAdminClient()
    let updateAttempted = false

    const failingUpdateClient = {
      ...baseClient,
      from: (table: string) => {
        const builder = baseClient.from(table)
        if (table === 'message_outbox') {
          return {
            ...builder,
            update: () => ({
              eq: () => ({
                eq: async () => {
                  updateAttempted = true
                  return { data: null, error: { message: 'Lock acquisition failure' } }
                }
              })
            })
          }
        }
        return builder
      }
    }

    const result = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A1_FAILED, { adminClient: failingUpdateClient })

    assert.equal(result.success, true)
    assert.equal(updateAttempted, true)
    assert.equal(fetchCallCount, 1, 'Gateway foi acionado')
  })

  // ============================================================================
  // TESTE 10: Garantia formal de que nenhum envio é disparado nos cenários bloqueados
  // ============================================================================
  test('10. Garantia formal de que nenhum gateway fetch ocorre em cenários de bloqueio', async () => {
    const adminClient = createAdminClient()
    const baselineFetch = fetchCallCount

    // Bloco 1: Tenant divergente
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_B1_FAILED, { adminClient })
    // Bloco 2: UUIDs inválidos
    await retryOutboxMessage('bad-uuid', OUTBOX_A1_FAILED, { adminClient })
    await retryOutboxMessage(TENANT_A_ID, 'bad-uuid', { adminClient })
    // Bloco 3: Inexistente
    await retryOutboxMessage(TENANT_A_ID, '00000000-0000-0000-0000-888888888888', { adminClient })
    // Bloco 4: Tenant inativo
    await retryOutboxMessage(TENANT_SUSPENDED_ID, OUTBOX_SUSP_FAILED, { adminClient })
    // Bloco 5: Mensagem adulterada
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_A4_CORRUPT_MSG, { adminClient })
    // Bloco 6: Já enviado / suprimido
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_A2_SENT, { adminClient })
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_A3_SUPPRESSED, { adminClient })

    assert.equal(fetchCallCount, baselineFetch, 'Em absolutamente nenhum cenário bloqueado o gateway pode ter sido chamado')
  })

  // ============================================================================
  // TESTE 11: Análise estática do código-fonte
  // ============================================================================
  test('11. Análise estática: confirma assinatura (companyId, outboxId) e filtros obrigatórios', () => {
    const msgEnginePath = path.resolve(process.cwd(), 'lib/services/message-engine.ts')
    const msgEngineCode = fs.readFileSync(msgEnginePath, 'utf8')

    // Assinatura exige companyId e outboxId
    assert.match(msgEngineCode, /export\s+async\s+function\s+retryOutboxMessage\s*\(\s*companyId\s*:\s*string\s*,\s*outboxId\s*:\s*string/s)

    // Validação sintática de UUIDs antes do banco
    assert.match(msgEngineCode, /if\s*\(\s*!isValidUuid\(companyId\)\s*\|\|\s*!isValidUuid\(outboxId\)\s*\)/s)

    // Consulta à outbox com id e company_id
    assert.match(msgEngineCode, /\.from\('message_outbox'\)\s*\.select\('\*'\)\s*\.eq\('id',\s*outboxId\)/s)
    assert.match(msgEngineCode, /outboxBuilder\.eq\('company_id',\s*companyId\)/s)

    // Validação de mensagem vinculada com id e company_id
    assert.match(msgEngineCode, /msgQuery\.eq\('company_id',\s*companyId\)/s)

    // Update com id e company_id
    assert.match(msgEngineCode, /outboxBuilder\.eq\('company_id',\s*companyId\)/s)
  })
})
