// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { sendMessage } from '@/lib/services/conversations'
import { sendManualMessageInternal } from '@/lib/services/conversations-internal'
import { inMemoryDb, resetInMemoryDb, createAdminClient, createClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { retryOutboxMessage } from '@/lib/services/message-engine'

describe('ETAPA 8.4.3I — Integração do Ciclo de Vida do Tenant no Envio Manual de Mensagens', () => {
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const OTHER_COMPANY_ID = '22222222-2222-2222-2222-222222222222'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'
  const PROVISIONING_COMPANY_ID = '55555555-5555-5555-5555-555555555555'
  const CORRUPTED_COMPANY_ID = '66666666-6666-6666-6666-666666666666'

  const CONV_ACTIVE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_OTHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_SUSPENDED_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  const CONV_CANCELLED_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  const CONV_PROVISIONING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  const CONV_CORRUPTED_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

  const USER_ACTIVE_ID = 'user-act-1111'
  const USER_SUSPENDED_ID = 'user-susp-3333'
  const USER_CANCELLED_ID = 'user-canc-4444'
  const USER_PROVISIONING_ID = 'user-prov-5555'
  const USER_CORRUPTED_ID = 'user-corr-6666'

  const SENSITIVE_SUSPENSION_REASON = 'Bloqueio estrito por suspeita de fraude documental e inadimplência severa'

  let fetchCallCount = 0
  let fetchHistory: any[] = []
  let originalFetch: any

  beforeEach(() => {
    resetInMemoryDb()
    fetchCallCount = 0
    fetchHistory = []
    originalFetch = globalThis.fetch

    globalThis.fetch = async (url: any, options: any) => {
      fetchCallCount++
      fetchHistory.push({ url, options })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully' })
      } as any
    }

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(ACTIVE_COMPANY_ID, {
      id: ACTIVE_COMPANY_ID,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-ativa-alpha',
      status: 'active',
      plan_tier: 'pro',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(OTHER_COMPANY_ID, {
      id: OTHER_COMPANY_ID,
      name: 'Empresa Secundária Beta',
      slug: 'empresa-secundaria-beta',
      status: 'active',
      plan_tier: 'standard',
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
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(PROVISIONING_COMPANY_ID, {
      id: PROVISIONING_COMPANY_ID,
      name: 'Empresa em Implantação Epsilon',
      slug: 'empresa-implantacao-epsilon',
      status: 'provisioning',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CORRUPTED_COMPANY_ID, {
      id: CORRUPTED_COMPANY_ID,
      name: 'Empresa Corrompida Zeta',
      slug: 'empresa-corrompida-zeta',
      status: 'status_desconhecido_invalido',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    // 2. Perfis de Atendentes
    inMemoryDb.profiles.set(USER_ACTIVE_ID, {
      id: USER_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      role: 'agent',
      email: 'operador@alpha.com'
    })

    inMemoryDb.profiles.set(USER_SUSPENDED_ID, {
      id: USER_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      role: 'agent',
      email: 'operador@gamma.com'
    })

    inMemoryDb.profiles.set(USER_CANCELLED_ID, {
      id: USER_CANCELLED_ID,
      company_id: CANCELLED_COMPANY_ID,
      role: 'agent',
      email: 'operador@delta.com'
    })

    inMemoryDb.profiles.set(USER_PROVISIONING_ID, {
      id: USER_PROVISIONING_ID,
      company_id: PROVISIONING_COMPANY_ID,
      role: 'agent',
      email: 'operador@epsilon.com'
    })

    inMemoryDb.profiles.set(USER_CORRUPTED_ID, {
      id: USER_CORRUPTED_ID,
      company_id: CORRUPTED_COMPANY_ID,
      role: 'agent',
      email: 'operador@zeta.com'
    })

    // 3. Integração n8n ativa para ACTIVE_COMPANY_ID
    inMemoryDb.integrations.set('int-active-1', {
      id: 'int-active-1',
      company_id: ACTIVE_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-outbound-alpha' }
    })

    // 4. Conversas e Clientes
    inMemoryDb.customers.set('cust-act-1', {
      id: 'cust-act-1',
      company_id: ACTIVE_COMPANY_ID,
      name: 'Cliente Alpha 1',
      phone: '5511999990001'
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_ID, {
      id: CONV_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      customer_id: 'cust-act-1',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990001', name: 'Cliente Alpha 1' }
    })

    inMemoryDb.conversations.set(CONV_OTHER_ID, {
      id: CONV_OTHER_ID,
      company_id: OTHER_COMPANY_ID,
      customer_id: 'cust-oth-2',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990002', name: 'Cliente Beta 2' }
    })

    inMemoryDb.conversations.set(CONV_SUSPENDED_ID, {
      id: CONV_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      customer_id: 'cust-susp-3',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990003', name: 'Cliente Gamma 3' }
    })

    inMemoryDb.conversations.set(CONV_CANCELLED_ID, {
      id: CONV_CANCELLED_ID,
      company_id: CANCELLED_COMPANY_ID,
      customer_id: 'cust-canc-4',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990004', name: 'Cliente Delta 4' }
    })

    inMemoryDb.conversations.set(CONV_PROVISIONING_ID, {
      id: CONV_PROVISIONING_ID,
      company_id: PROVISIONING_COMPANY_ID,
      customer_id: 'cust-prov-5',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990005', name: 'Cliente Epsilon 5' }
    })

    inMemoryDb.conversations.set(CONV_CORRUPTED_ID, {
      id: CONV_CORRUPTED_ID,
      company_id: CORRUPTED_COMPANY_ID,
      customer_id: 'cust-corr-6',
      channel: 'whatsapp',
      status: 'human',
      last_message_at: '2026-10-01T10:00:00Z',
      customers: { phone: '5511999990006', name: 'Cliente Zeta 6' }
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('1. Empresa ativa: envio manual funciona normalmente', async () => {
    const adminClient = createAdminClient()
    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Olá cliente, confirmamos o envio do seu pedido!',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.persistedStatus, 'sent')
    assert.ok(result.message)
    assert.equal(result.message.company_id, ACTIVE_COMPANY_ID)
    assert.equal(result.message.conversation_id, CONV_ACTIVE_ID)
    assert.equal(result.message.sender_type, 'human')
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.equal(result.message.content, 'Olá cliente, confirmamos o envio do seu pedido!')
    assert.equal(result.message.metadata.delivery_status, 'sent')

    // Confirmação no banco em memória
    const storedMsg = inMemoryDb.messages.get(result.message.id)
    assert.ok(storedMsg)
    assert.equal(storedMsg.metadata.delivery_status, 'sent')

    // last_message_at da conversa atualizado
    const conv = inMemoryDb.conversations.get(CONV_ACTIVE_ID)
    assert.ok(new Date(conv.last_message_at).getTime() > new Date('2026-10-01T10:00:00Z').getTime())

    // Verificação de disparo externo via fetch
    assert.equal(fetchCallCount, 1)
    const payload = JSON.parse(fetchHistory[0].options.body)
    assert.equal(payload.customer.phone, '5511999990001')
    assert.equal(payload.message.content, 'Olá cliente, confirmamos o envio do seu pedido!')
  })

  test('2. Empresa suspensa: bloqueada antes de qualquer gravação no banco', async () => {
    const adminClient = createAdminClient()
    const initialMsgCount = inMemoryDb.messages.size

    const result = await sendManualMessageInternal(
      CONV_SUSPENDED_ID,
      'Tentativa de envio por empresa suspensa',
      {
        companyId: SUSPENDED_COMPANY_ID,
        userId: USER_SUSPENDED_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.reason, 'tenant_blocked')
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.equal(result.error, 'A empresa está suspensa e não pode enviar mensagens.')
    assert.equal(result.error.includes(SENSITIVE_SUSPENSION_REASON), false)

    // Nenhuma mensagem gravada
    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    // Gateway externo nunca acionado
    assert.equal(fetchCallCount, 0)
  })

  test('3. Empresa cancelada: bloqueada antes de qualquer gravação no banco', async () => {
    const adminClient = createAdminClient()
    const initialMsgCount = inMemoryDb.messages.size

    const result = await sendManualMessageInternal(
      CONV_CANCELLED_ID,
      'Tentativa de envio por empresa cancelada',
      {
        companyId: CANCELLED_COMPANY_ID,
        userId: USER_CANCELLED_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.reason, 'tenant_blocked')
    assert.equal(result.code, 'TENANT_CANCELLED')
    assert.equal(result.error, 'A empresa foi cancelada e não pode enviar mensagens.')

    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    assert.equal(fetchCallCount, 0)
  })

  test('4. Empresa em provisionamento: bloqueada antes de qualquer gravação no banco', async () => {
    const adminClient = createAdminClient()
    const initialMsgCount = inMemoryDb.messages.size

    const result = await sendManualMessageInternal(
      CONV_PROVISIONING_ID,
      'Tentativa de envio por empresa em implantação',
      {
        companyId: PROVISIONING_COMPANY_ID,
        userId: USER_PROVISIONING_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.reason, 'tenant_blocked')
    assert.equal(result.code, 'TENANT_PROVISIONING')
    assert.equal(result.error, 'A empresa está em provisionamento e ainda não pode enviar mensagens.')

    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    assert.equal(fetchCallCount, 0)
  })

  test('5. Falha na consulta de status: fail-closed', async () => {
    const adminClient = createAdminClient()
    const initialMsgCount = inMemoryDb.messages.size

    // Caso A: Status desconhecido/inválido
    const resultCorrupted = await sendManualMessageInternal(
      CONV_CORRUPTED_ID,
      'Tentativa de envio com status corrompido',
      {
        companyId: CORRUPTED_COMPANY_ID,
        userId: USER_CORRUPTED_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(resultCorrupted.success, false)
    assert.equal(resultCorrupted.reason, 'tenant_blocked')
    assert.equal(resultCorrupted.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(resultCorrupted.error.includes('Status da empresa indisponível'), true)

    // Caso B: Falha inesperada de infraestrutura/conexão no banco durante requireActiveCompany
    const failingDbClient = {
      ...adminClient,
      from: (table: string) => {
        if (table === 'companies') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => {
                  throw new Error('Postgres connection pool exhausted')
                }
              })
            })
          }
        }
        return adminClient.from(table)
      }
    }

    const resultDbFail = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Tentativa com queda de conexão no status',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient: failingDbClient
      }
    )

    assert.equal(resultDbFail.success, false)
    assert.equal(resultDbFail.reason, 'tenant_blocked')
    assert.equal(resultDbFail.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(resultDbFail.error.includes('Status da empresa indisponível'), true)

    // Caso C: Exceção inesperada não mapeada (não-TenantAccessError)
    const crashingClient = {
      ...adminClient,
      from: (table: string) => {
        if (table === 'companies') {
          throw new TypeError('Unexpected runtime V8 crash')
        }
        return adminClient.from(table)
      }
    }

    const resultCrash = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Tentativa com erro inesperado não mapeado',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient: crashingClient
      }
    )

    assert.equal(resultCrash.success, false)
    assert.equal(resultCrash.reason, 'tenant_blocked')
    assert.equal(resultCrash.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(resultCrash.error.includes('Status da empresa indisponível'), true)

    // Fail-closed garantido: nenhuma mensagem criada e gateway nunca acionado
    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    assert.equal(fetchCallCount, 0)
  })

  test('6. Conversa pertencente a outra empresa: bloqueada (Prevenção Cross-Tenant)', async () => {
    const adminClient = createAdminClient()
    const initialMsgCount = inMemoryDb.messages.size

    // Atendente da Empresa Alpha tenta enviar mensagem na conversa pertencente à Empresa Beta
    const result = await sendManualMessageInternal(
      CONV_OTHER_ID,
      'Tentativa de invasão entre tenants',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'CONVERSATION_NOT_FOUND')
    assert.equal(result.error, 'Conversa não encontrada ou não pertence a esta empresa.')

    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    assert.equal(fetchCallCount, 0)
  })

  test('7. companyId forjado/adulterado: não permite envio em nome de outro tenant', async () => {
    const adminClient = createAdminClient()
    const initialMsgCount = inMemoryDb.messages.size

    // Conversa é da Empresa Alpha, mas chamada informa Empresa Beta como companyId
    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Tentativa com companyId adulterado',
      {
        companyId: OTHER_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'CONVERSATION_NOT_FOUND')

    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    assert.equal(fetchCallCount, 0)
  })

  test('8. Gateway retorna success: false: não retorna sucesso à interface e marca failed', async () => {
    const adminClient = createAdminClient()

    // Mock fetch retornando HTTP 400 Bad Request
    globalThis.fetch = async () => {
      fetchCallCount++
      return {
        ok: false,
        status: 400,
        text: async () => 'Destinatário sem WhatsApp'
      } as any
    }

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Mensagem com falha externa 400',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'OUTBOUND_DISPATCH_FAILED')
    assert.ok(result.error)

    // Mensagem no banco gravada e atualizada com status failed
    assert.ok(result.message)
    const stored = inMemoryDb.messages.get(result.message.id)
    assert.ok(stored)
    assert.equal(stored.metadata.delivery_status, 'failed')
  })

  test('9. Gateway retorna tenant_blocked: mensagem marcada como suppressed e não apresentada como enviada', async () => {
    const adminClient = createAdminClient()

    // Simula TOCTOU: a empresa era ativa no requireActiveCompany inicial, mas
    // quando a mensagem é persistida no banco, a empresa é suspensa concorrentemente,
    // fazendo com que a validação dentro do gateway bloqueie o despacho e retorne reason: 'tenant_blocked'.
    const raceClient = {
      ...adminClient,
      from: (table: string) => {
        const builder = adminClient.from(table)
        if (table === 'messages') {
          return {
            ...builder,
            insert: (data: any) => {
              // Suspende a empresa concorrentemente no momento da inserção da mensagem
              inMemoryDb.companies.set(ACTIVE_COMPANY_ID, {
                ...inMemoryDb.companies.get(ACTIVE_COMPANY_ID),
                status: 'suspended',
                suspension_reason: 'Suspensão concorrente durante despacho'
              })
              return builder.insert(data)
            }
          }
        }
        return builder
      }
    }

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Tentativa bloqueada no gateway por TOCTOU',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: raceClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.reason, 'tenant_blocked')
    assert.equal(result.code, 'TENANT_BLOCKED')
    assert.equal(result.error.includes('Envio bloqueado'), true)

    // Mensagem no banco deve estar como 'suppressed'
    assert.ok(result.message)
    const stored = inMemoryDb.messages.get(result.message.id)
    assert.ok(stored)
    assert.equal(stored.metadata.delivery_status, 'suppressed')
    assert.equal(stored.metadata.suppressed_reason, 'tenant_blocked')
  })

  test('10. Gateway retorna erro de integração (500): tratado corretamente', async () => {
    const adminClient = createAdminClient()

    // Mock fetch retornando HTTP 500
    globalThis.fetch = async () => {
      fetchCallCount++
      return {
        ok: false,
        status: 500,
        text: async () => 'n8n Internal Server Error'
      } as any
    }

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Mensagem erro 500',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'OUTBOUND_DISPATCH_FAILED')
    assert.equal(result.error.includes('HTTP 500'), true)

    assert.ok(result.message)
    const stored = inMemoryDb.messages.get(result.message.id)
    assert.equal(stored.metadata.delivery_status, 'failed')
  })

  test('11. Falha de persistência antes do envio: gateway não é chamado', async () => {
    const adminClient = createAdminClient()

    // Proxy do adminClient que falha no insert de 'messages'
    const failingClient = {
      ...adminClient,
      from: (table: string) => {
        const builder = adminClient.from(table)
        if (table === 'messages') {
          return {
            ...builder,
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: 'DB connection dropped', code: '08006' }
                })
              })
            })
          }
        }
        return builder
      }
    }

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Mensagem com falha no banco',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: failingClient,
        adminClient
      }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'DB_INSERT_FAILED')
    assert.equal(result.error, 'Erro ao registrar a mensagem no banco de dados.')

    // O gateway NUNCA deve ser chamado se o banco falhou antes
    assert.equal(fetchCallCount, 0)
  })

  test('12. Falha de atualização após envio externo: registra inconsistência sem falso rollback', async () => {
    const adminClient = createAdminClient()

    // Proxy onde o insert funciona, mas updates posteriores de messages falham
    const partialFailingClient = {
      ...adminClient,
      from: (table: string) => {
        const builder = adminClient.from(table)
        if (table === 'messages') {
          return {
            ...builder,
            insert: (data: any) => builder.insert(data),
            update: () => ({
              eq: () => ({
                then: (resolve: any) => {
                  resolve({ data: null, error: { message: 'Lock timeout during update' } })
                }
              })
            })
          }
        }
        return builder
      }
    }

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Mensagem pós envio sucesso mas update falhou',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: partialFailingClient,
        adminClient
      }
    )

    // O envio externo aconteceu e foi 200, portanto não podemos fazer falso rollback
    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.persistedStatus, 'pending')
    assert.equal(result.inconsistency, true)
    assert.ok(result.warning)
    assert.equal(result.warning.includes('não pôde ser atualizado') || result.warning.includes('falhou'), true)
    assert.equal(result.message.metadata.delivery_status, 'pending')
    assert.equal(fetchCallCount, 1)
  })

  test('13. Nenhuma retentativa dispara mensagem com status suppressed', async () => {
    const outboxId = '00000000-0000-0000-0000-000000000999'
    // Insere registro na outbox para empresa suspensa
    inMemoryDb.message_outbox.set(outboxId, {
      id: outboxId,
      company_id: SUSPENDED_COMPANY_ID,
      conversation_id: CONV_SUSPENDED_ID,
      message_id: null,
      status: 'pending',
      retry_count: 0,
      next_retry_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    })

    const initialFetchCount = fetchCallCount
    const retryRes = await retryOutboxMessage(SUSPENDED_COMPANY_ID, outboxId)

    assert.equal(retryRes.success, false)
    assert.equal(retryRes.suppressed, true)
    assert.equal(retryRes.code, 'TENANT_SUSPENDED')

    // Nenhuma chamada externa ao n8n
    assert.equal(fetchCallCount, initialFetchCount)

    // Outbox marcada como suppressed
    const outbox = inMemoryDb.message_outbox.get(outboxId)
    assert.equal(outbox.status, 'suppressed')
  })

  test('14. Empresa ativa com envio confirmado: fluxo anterior preservado integralmente', async () => {
    const adminClient = createAdminClient()

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Confirmação final de compra - Código #9988',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: adminClient,
        adminClient
      }
    )

    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.persistedStatus, 'sent')
    assert.ok(result.message)
    assert.equal(result.message.sender_type, 'human')
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.equal(result.message.company_id, ACTIVE_COMPANY_ID)
    assert.equal(result.message.conversation_id, CONV_ACTIVE_ID)
    assert.equal(result.message.content, 'Confirmação final de compra - Código #9988')
    assert.equal(result.message.message_type, 'text')
    assert.equal(result.message.metadata.delivery_status, 'sent')

    // Confirma que a conversa teve o last_message_at atualizado
    const conv = inMemoryDb.conversations.get(CONV_ACTIVE_ID)
    assert.ok(conv.last_message_at)

    // Confirma payload recebido pelo n8n
    assert.equal(fetchCallCount, 1)
    const outboundBody = JSON.parse(fetchHistory[0].options.body)
    assert.equal(outboundBody.channel, 'whatsapp')
    assert.equal(outboundBody.customer.phone, '5511999990001')
    assert.equal(outboundBody.message.content, 'Confirmação final de compra - Código #9988')
    assert.equal(outboundBody.metadata.message_id, result.message.id)
  })
})
