// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { sendOutboundMessage } from '@/lib/services/n8n-internal'
import { retryOutboxMessage } from '@/lib/services/message-engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3G — Blindagem do Gateway de Saída e das Retentativas da Outbox', () => {
  // IDs de Empresas
  const ACTIVE_COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const ACTIVE_COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'
  const PROVISIONING_COMPANY_ID = '55555555-5555-5555-5555-555555555555'
  const CORRUPTED_COMPANY_ID = '66666666-6666-6666-6666-666666666666'

  // IDs de Conversas e Outbox
  const CONV_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_SUSPENDED_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  const OUTBOX_ACTIVE_A_ID = '00000000-000b-aaaa-1111-000000000001'
  const OUTBOX_ACTIVE_B_ID = '00000000-000b-bbbb-2222-000000000002'
  const OUTBOX_SUSPENDED_ID = '00000000-000b-cccc-3333-000000000003'
  const OUTBOX_CANCELLED_ID = '00000000-000b-dddd-4444-000000000004'
  const OUTBOX_PROVISIONING_ID = '00000000-000b-eeee-5555-000000000005'
  const OUTBOX_CORRUPTED_ID = '00000000-000b-ffff-6666-000000000006'

  const SENSITIVE_SUSPENSION_REASON = 'Inadimplência financeira grave fatura #9999 no valor de R$ 25.000,00'

  let fetchCallCount = 0
  let originalFetch: any

  beforeEach(() => {
    resetInMemoryDb()
    fetchCallCount = 0
    originalFetch = globalThis.fetch

    // Interceptador de fetch para simular requisições externas para o n8n
    globalThis.fetch = async (url: any, options: any) => {
      fetchCallCount++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully' })
      } as any
    }

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(ACTIVE_COMPANY_A_ID, {
      id: ACTIVE_COMPANY_A_ID,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-ativa-alpha',
      status: 'active',
      plan_tier: 'pro',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(ACTIVE_COMPANY_B_ID, {
      id: ACTIVE_COMPANY_B_ID,
      name: 'Empresa Ativa Beta',
      slug: 'empresa-ativa-beta',
      status: 'active',
      plan_tier: 'enterprise',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(SUSPENDED_COMPANY_ID, {
      id: SUSPENDED_COMPANY_ID,
      name: 'Empresa Suspensa Gamma',
      slug: 'empresa-suspensa-gamma',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: SENSITIVE_SUSPENSION_REASON,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CANCELLED_COMPANY_ID, {
      id: CANCELLED_COMPANY_ID,
      name: 'Empresa Cancelada Delta',
      slug: 'empresa-cancelada-delta',
      status: 'cancelled',
      plan_tier: 'trial',
      suspension_reason: 'Contrato cancelado pelo cliente',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(PROVISIONING_COMPANY_ID, {
      id: PROVISIONING_COMPANY_ID,
      name: 'Empresa Em Implantação Epsilon',
      slug: 'empresa-implantacao-epsilon',
      status: 'provisioning',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CORRUPTED_COMPANY_ID, {
      id: CORRUPTED_COMPANY_ID,
      name: 'Empresa Status Corrompido Zeta',
      slug: 'empresa-corrompida-zeta',
      status: 'status_desconhecido_ou_legado',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Integrações n8n
    inMemoryDb.integrations.set('int-alpha', {
      id: 'int-alpha',
      company_id: ACTIVE_COMPANY_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/alpha' },
      credentials: { webhook_secret: 'sec_alpha_123' }
    })

    inMemoryDb.integrations.set('int-beta', {
      id: 'int-beta',
      company_id: ACTIVE_COMPANY_B_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/beta' },
      credentials: { webhook_secret: 'sec_beta_123' }
    })

    inMemoryDb.integrations.set('int-gamma', {
      id: 'int-gamma',
      company_id: SUSPENDED_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/gamma' },
      credentials: { webhook_secret: 'sec_gamma_123' }
    })

    inMemoryDb.integrations.set('int-delta', {
      id: 'int-delta',
      company_id: CANCELLED_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/delta' },
      credentials: { webhook_secret: 'sec_delta_123' }
    })

    inMemoryDb.integrations.set('int-epsilon', {
      id: 'int-epsilon',
      company_id: PROVISIONING_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/epsilon' },
      credentials: { webhook_secret: 'sec_epsilon_123' }
    })

    // 3. Cadastrar Registros de Outbox
    inMemoryDb.message_outbox.set(OUTBOX_ACTIVE_A_ID, {
      id: OUTBOX_ACTIVE_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      conversation_id: CONV_A_ID,
      message_id: 'msg-active-a',
      idempotency_key: 'idem-active-a',
      channel: 'whatsapp',
      recipient: '5511999990001',
      payload: { message: { content: 'Olá Alpha' } },
      status: 'failed',
      attempts: 1,
      last_error: 'Timeout temporário anterior'
    })

    inMemoryDb.message_outbox.set(OUTBOX_ACTIVE_B_ID, {
      id: OUTBOX_ACTIVE_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      conversation_id: CONV_B_ID,
      message_id: 'msg-active-b',
      idempotency_key: 'idem-active-b',
      channel: 'whatsapp',
      recipient: '5511999990002',
      payload: { message: { content: 'Olá Beta' } },
      status: 'failed',
      attempts: 1,
      last_error: 'Erro temporário'
    })

    inMemoryDb.message_outbox.set(OUTBOX_SUSPENDED_ID, {
      id: OUTBOX_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      conversation_id: CONV_SUSPENDED_ID,
      message_id: 'msg-susp-1',
      idempotency_key: 'idem-susp-1',
      channel: 'whatsapp',
      recipient: '5511999990003',
      payload: { message: { content: 'Mensagem gerada quando empresa era ativa' } },
      status: 'failed',
      attempts: 1,
      last_error: 'Falha de entrega anterior'
    })

    inMemoryDb.message_outbox.set(OUTBOX_CANCELLED_ID, {
      id: OUTBOX_CANCELLED_ID,
      company_id: CANCELLED_COMPANY_ID,
      conversation_id: 'conv-canc-1',
      message_id: 'msg-canc-1',
      idempotency_key: 'idem-canc-1',
      channel: 'whatsapp',
      recipient: '5511999990004',
      payload: { message: { content: 'Mensagem antiga pendente' } },
      status: 'failed',
      attempts: 1,
      last_error: 'Erro'
    })

    inMemoryDb.message_outbox.set(OUTBOX_PROVISIONING_ID, {
      id: OUTBOX_PROVISIONING_ID,
      company_id: PROVISIONING_COMPANY_ID,
      conversation_id: 'conv-prov-1',
      message_id: 'msg-prov-1',
      idempotency_key: 'idem-prov-1',
      channel: 'whatsapp',
      recipient: '5511999990005',
      payload: { message: { content: 'Mensagem de teste' } },
      status: 'pending',
      attempts: 0,
      last_error: null
    })

    inMemoryDb.message_outbox.set(OUTBOX_CORRUPTED_ID, {
      id: OUTBOX_CORRUPTED_ID,
      company_id: CORRUPTED_COMPANY_ID,
      conversation_id: 'conv-corr-1',
      message_id: 'msg-corr-1',
      idempotency_key: 'idem-corr-1',
      channel: 'whatsapp',
      recipient: '5511999990006',
      payload: { message: { content: 'Mensagem' } },
      status: 'failed',
      attempts: 1,
      last_error: 'Erro'
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ============================================================================
  // PARTE 1: GATEWAY sendOutboundMessage (Cenários 1 a 9)
  // ============================================================================

  test('1. Empresa ativa: envio preserva o comportamento anterior e invoca fetch', async () => {
    const payload = {
      event_id: 'evt-test-alpha-1',
      message: { content: 'Olá, seu pedido está pronto!' }
    }

    const res = await sendOutboundMessage(ACTIVE_COMPANY_A_ID, payload)

    assert.equal(res.success, true)
    assert.equal(fetchCallCount, 1, 'Fetch para n8n deve ser invocado exatamente uma vez')

    // Integração atualizada
    const intRecord = inMemoryDb.integrations.get('int-alpha')
    assert.ok(intRecord.last_event_at, 'last_event_at deve ser registrado na integração')
  })

  test('2. Empresa suspensa: envio bloqueado no gateway com TENANT_SUSPENDED', async () => {
    const payload = {
      event_id: 'evt-test-susp-1',
      message: { content: 'Mensagem que jamais deve sair' }
    }

    const res = await sendOutboundMessage(SUSPENDED_COMPANY_ID, payload)

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_SUSPENDED')
    assert.equal(res.statusCode, 403)
    assert.equal(res.reason, 'tenant_blocked')
    assert.equal(fetchCallCount, 0, 'Fetch externo JAMAIS pode ser chamado para empresa suspensa')
  })

  test('3. Empresa cancelada: envio bloqueado no gateway com TENANT_CANCELLED', async () => {
    const payload = { event_id: 'evt-test-canc-1', message: { content: 'Mensagem' } }

    const res = await sendOutboundMessage(CANCELLED_COMPANY_ID, payload)

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_CANCELLED')
    assert.equal(res.statusCode, 403)
    assert.equal(fetchCallCount, 0)
  })

  test('4. Empresa em provisionamento: envio bloqueado no gateway com TENANT_PROVISIONING', async () => {
    const payload = { event_id: 'evt-test-prov-1', message: { content: 'Mensagem' } }

    const res = await sendOutboundMessage(PROVISIONING_COMPANY_ID, payload)

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_PROVISIONING')
    assert.equal(res.statusCode, 403)
    assert.equal(fetchCallCount, 0)
  })

  test('5. Falha na consulta de status: envio bloqueado com TENANT_STATUS_UNAVAILABLE (503)', async () => {
    const failingDbClient = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'companies') {
                return { data: null, error: { message: 'Database connection timeout', code: 'ETIMEDOUT' } }
              }
              return { data: null, error: null }
            }
          })
        })
      })
    }

    const res = await sendOutboundMessage(ACTIVE_COMPANY_A_ID, { event_id: 'evt-fail-1' }, { adminClient: failingDbClient })

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(res.statusCode, 503)
    assert.equal(fetchCallCount, 0, 'Falha no banco deve bloquear o envio fail-closed')
  })

  test('6. Status desconhecido no banco: envio bloqueado com TENANT_STATUS_UNAVAILABLE (503)', async () => {
    const res = await sendOutboundMessage(CORRUPTED_COMPANY_ID, { event_id: 'evt-corr-1' })

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(res.statusCode, 503)
    assert.equal(fetchCallCount, 0)
  })

  test('7. Confirmação de que o bloqueio ocorre estritamente antes do fetch', async () => {
    let integrationLookedUp = false

    const spyClient = {
      from: (table: string) => {
        if (table === 'integrations') {
          integrationLookedUp = true
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (table === 'companies') {
                  return {
                    data: { id: SUSPENDED_COMPANY_ID, name: 'Suspensa', status: 'suspended', plan_tier: 'standard' },
                    error: null
                  }
                }
                return { data: null, error: null }
              }
            })
          })
        }
      }
    }

    const res = await sendOutboundMessage(SUSPENDED_COMPANY_ID, { event_id: 'evt-spy-1' }, { adminClient: spyClient })

    assert.equal(res.success, false)
    assert.equal(fetchCallCount, 0)
    assert.equal(integrationLookedUp, false, 'A tabela integrations sequer deve ser consultada se a empresa estiver suspensa')
  })

  test('8. Nenhum evento de integração é registrado para empresa bloqueada', async () => {
    const initialEventsCount = inMemoryDb.integration_events.size

    await sendOutboundMessage(SUSPENDED_COMPANY_ID, { event_id: 'evt-blocked-event' })

    assert.equal(inMemoryDb.integration_events.size, initialEventsCount, 'Nenhum registro em integration_events pode ser criado')
  })

  test('9. Nenhuma informação interna de suspensão (suspensionReason) é exposta', async () => {
    const res = await sendOutboundMessage(SUSPENDED_COMPANY_ID, { event_id: 'evt-leak-check' })

    assert.equal(res.success, false)
    assert.equal(res.error, 'Operação comercial bloqueada: acesso da empresa suspenso pela plataforma.')

    // Garantir que a razão financeira sigilosa não vaza
    assert.ok(!res.error.includes('Inadimplência'))
    assert.ok(!res.error.includes('#9999'))
    assert.ok(!res.error.includes('25.000,00'))
    assert.ok(!JSON.stringify(res).includes('25.000,00'))
  })

  // ============================================================================
  // PARTE 2: RETENTATIVAS DA OUTBOX retryOutboxMessage (Cenários 10 a 20)
  // ============================================================================

  test('10. Empresa ativa: retentativa funciona normalmente e atualiza outbox para sent', async () => {
    const res = await retryOutboxMessage(ACTIVE_COMPANY_A_ID, OUTBOX_ACTIVE_A_ID)

    assert.equal(res.success, true)
    assert.equal(fetchCallCount, 1)

    const updatedRecord = inMemoryDb.message_outbox.get(OUTBOX_ACTIVE_A_ID)
    assert.equal(updatedRecord.status, 'sent')
    assert.equal(updatedRecord.attempts, 2)
    assert.ok(updatedRecord.sent_at)
  })

  test('11. Empresa suspensa: retentativa é bloqueada com TENANT_SUSPENDED', async () => {
    const res = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_SUSPENDED')
    assert.equal(res.statusCode, 403)
    assert.equal(res.suppressed, true)
    assert.equal(fetchCallCount, 0, 'Fetch externo não pode ser invocado')
  })

  test('12. Empresa cancelada: retentativa é bloqueada com TENANT_CANCELLED', async () => {
    const res = await retryOutboxMessage(CANCELLED_COMPANY_ID, OUTBOX_CANCELLED_ID)

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_CANCELLED')
    assert.equal(res.statusCode, 403)
    assert.equal(res.suppressed, true)
    assert.equal(fetchCallCount, 0)
  })

  test('13. Empresa em provisionamento: retentativa é bloqueada com TENANT_PROVISIONING', async () => {
    const res = await retryOutboxMessage(PROVISIONING_COMPANY_ID, OUTBOX_PROVISIONING_ID)

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_PROVISIONING')
    assert.equal(res.statusCode, 403)
    assert.equal(res.suppressed, true)
    assert.equal(fetchCallCount, 0)
  })

  test('14. Falha na consulta de status na retentativa resulta em bloqueio fail-closed', async () => {
    const failingDbClient = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: string) => ({
            single: async () => {
              if (table === 'message_outbox') {
                return {
                  data: {
                    id: OUTBOX_ACTIVE_A_ID,
                    company_id: ACTIVE_COMPANY_A_ID,
                    status: 'failed',
                    payload: { message: { content: 'Teste' } }
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            },
            maybeSingle: async () => {
              if (table === 'companies') {
                return { data: null, error: { message: 'DB connection error', code: 'ETIMEDOUT' } }
              }
              return { data: null, error: null }
            }
          })
        }),
        update: () => ({
          eq: async () => ({ data: null, error: null })
        })
      })
    }

    const res = await retryOutboxMessage(ACTIVE_COMPANY_A_ID, OUTBOX_ACTIVE_A_ID, { adminClient: failingDbClient })

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(res.statusCode, 503)
    assert.equal(fetchCallCount, 0)
  })

  test('15. Tenant bloqueado: sendOutboundMessage não é chamado na retentativa', async () => {
    const res = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)

    assert.equal(res.success, false)
    assert.equal(fetchCallCount, 0)
  })

  test('16. Tenant bloqueado: nenhuma chamada externa é executada', async () => {
    await retryOutboxMessage(CANCELLED_COMPANY_ID, OUTBOX_CANCELLED_ID)
    await retryOutboxMessage(PROVISIONING_COMPANY_ID, OUTBOX_PROVISIONING_ID)

    assert.equal(fetchCallCount, 0)
  })

  test('17. Estado de outbox utilizado para supressão é estritamente status: "suppressed"', async () => {
    await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)

    const record = inMemoryDb.message_outbox.get(OUTBOX_SUSPENDED_ID)
    assert.equal(record.status, 'suppressed', 'O status da outbox deve ser atualizado para "suppressed"')
    assert.match(record.last_error, /Envio suprimido/i)
  })

  test('18. Mensagem suprimida não é reativada automaticamente nem se retentada novamente', async () => {
    // 1ª chamada: bloqueia e marca como suppressed
    const firstTry = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)
    assert.equal(firstTry.success, false)
    assert.equal(firstTry.suppressed, true)

    // 2ª chamada: deve rejeitar de imediato com erro de supressão sem tocar no gateway
    const secondTry = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)
    assert.equal(secondTry.success, false)
    assert.equal(secondTry.suppressed, true)
    assert.match(secondTry.error, /suprimida não pode ser reprocessada/i)
    assert.equal(fetchCallCount, 0)
  })

  test('19. Falha ao persistir o bloqueio na outbox é tratada sem executar o envio', async () => {
    const updateFailingClient = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: string) => ({
            single: async () => {
              if (table === 'message_outbox') {
                return {
                  data: {
                    id: OUTBOX_SUSPENDED_ID,
                    company_id: SUSPENDED_COMPANY_ID,
                    status: 'failed',
                    payload: { message: { content: 'Teste' } }
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            },
            maybeSingle: async () => {
              if (table === 'companies') {
                return {
                  data: { id: SUSPENDED_COMPANY_ID, name: 'Suspensa', status: 'suspended', plan_tier: 'standard' },
                  error: null
                }
              }
              return { data: null, error: null }
            }
          })
        }),
        update: () => ({
          eq: async () => {
            throw new Error('Falha simulada de disco/banco ao gravar update na outbox')
          }
        })
      })
    }

    const res = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID, { adminClient: updateFailingClient })

    assert.equal(res.success, false)
    assert.equal(res.code, 'TENANT_SUSPENDED')
    assert.equal(fetchCallCount, 0, 'Mesmo se o update da outbox falhar, o envio externo NUNCA pode ser executado')
  })

  test('20. Empresa A suspensa não interfere na retentativa da Empresa B ativa', async () => {
    // Empresa A (suspensa) é bloqueada
    const resA = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)
    assert.equal(resA.success, false)
    assert.equal(resA.code, 'TENANT_SUSPENDED')
    assert.equal(fetchCallCount, 0)

    // Empresa B (ativa) é despachada com sucesso
    const resB = await retryOutboxMessage(ACTIVE_COMPANY_B_ID, OUTBOX_ACTIVE_B_ID)
    assert.equal(resB.success, true)
    assert.equal(fetchCallCount, 1)

    const recordB = inMemoryDb.message_outbox.get(OUTBOX_ACTIVE_B_ID)
    assert.equal(recordB.status, 'sent')
  })
})
