// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { sendMessage } from '@/lib/services/conversations'
import { sendManualMessageInternal } from '@/lib/services/conversations-internal'
import { inMemoryDb, resetInMemoryDb, createAdminClient, createAuthenticatedClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3I.1 — Verificação de Segurança da Identidade e Consistência do Envio Manual', () => {
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const OTHER_COMPANY_ID = '22222222-2222-2222-2222-222222222222'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'

  const CONV_ACTIVE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_OTHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  const USER_ACTIVE_ID = 'user-act-1111'
  const USER_OTHER_ID = 'user-oth-2222'
  const USER_CANCELLED_ID = 'user-canc-4444'

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
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(OTHER_COMPANY_ID, {
      id: OTHER_COMPANY_ID,
      name: 'Empresa Secundária Beta',
      slug: 'empresa-secundaria-beta',
      status: 'active',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CANCELLED_COMPANY_ID, {
      id: CANCELLED_COMPANY_ID,
      name: 'Empresa Cancelada Delta',
      slug: 'empresa-cancelada-delta',
      status: 'cancelled',
      plan_tier: 'standard',
      created_at: new Date().toISOString()
    })

    // 2. Perfis de Atendentes
    inMemoryDb.profiles.set(USER_ACTIVE_ID, {
      id: USER_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      role: 'agent',
      email: 'operador@alpha.com'
    })

    inMemoryDb.profiles.set(USER_OTHER_ID, {
      id: USER_OTHER_ID,
      company_id: OTHER_COMPANY_ID,
      role: 'agent',
      email: 'operador@beta.com'
    })

    inMemoryDb.profiles.set(USER_CANCELLED_ID, {
      id: USER_CANCELLED_ID,
      company_id: CANCELLED_COMPANY_ID,
      role: 'agent',
      email: 'operador@delta.com'
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

    inMemoryDb.customers.set('cust-oth-2', {
      id: 'cust-oth-2',
      company_id: OTHER_COMPANY_ID,
      name: 'Cliente Beta 2',
      phone: '5511999990002'
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
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ============================================================================
  // PARTE 1: IDENTIDADE E INJEÇÃO DE DEPENDÊNCIAS
  // ============================================================================

  test('1. Atendente tenta enviar companyId de outro tenant via sendMessage (Server Action)', async () => {
    // Usuário autenticado como USER_ACTIVE_ID (pertencente à ACTIVE_COMPANY_ID)
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    // Cenário A: Tenta enviar mensagem na sua própria conversa, mas tentando injetar companyId da Empresa B
    const resultOwn = await sendMessage(
      CONV_ACTIVE_ID,
      'Mensagem legítima com options adulterada',
      {
        companyId: OTHER_COMPANY_ID, // Tentativa de forjar tenant
        supabaseClient: userClient
      }
    )

    assert.equal(resultOwn.success, true)
    // A identidade do servidor prevaleceu: a mensagem foi gravada com a company_id do perfil autenticado
    assert.equal(resultOwn.message.company_id, ACTIVE_COMPANY_ID)
    assert.notEqual(resultOwn.message.company_id, OTHER_COMPANY_ID)

    // Cenário B: Tenta enviar mensagem em conversa de outra empresa passando companyId de outra empresa
    const resultOther = await sendMessage(
      CONV_OTHER_ID,
      'Tentativa de invasão entre empresas',
      {
        companyId: OTHER_COMPANY_ID,
        supabaseClient: userClient
      }
    )

    // Bloqueado com CONVERSATION_NOT_FOUND porque o servidor consulta apenas a empresa da sessão (ACTIVE_COMPANY_ID)
    assert.equal(resultOther.success, false)
    assert.equal(resultOther.code, 'CONVERSATION_NOT_FOUND')
    assert.equal(resultOther.gatewayDispatched, false)
  })

  test('2. Atendente tenta enviar userId de outro usuário via sendMessage (Server Action)', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Tentativa de se passar por outro operador',
      {
        userId: 'user-impostor-999', // Tentativa de spoofing de autor
        supabaseClient: userClient
      }
    )

    assert.equal(result.success, true)
    // A identidade do servidor prevaleceu: o sender_id é estritamente o ID autenticado na sessão
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.notEqual(result.message.sender_id, 'user-impostor-999')
  })

  test('3. Chamador externo tenta injetar adminClient via sendMessage', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    let maliciousAdminWasCalled = false
    const maliciousAdminClient = {
      from: () => {
        maliciousAdminWasCalled = true
        throw new Error('Malicious adminClient injection executed!')
      }
    }

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Tentativa com adminClient malicioso',
      {
        adminClient: maliciousAdminClient, // Injeção de cliente não confiável
        supabaseClient: userClient
      }
    )

    assert.equal(result.success, true)
    // O cliente malicioso recebido foi completamente ignorado pelo servidor
    assert.equal(maliciousAdminWasCalled, false)
  })

  test('4. A identidade autenticada prevalece sobre qualquer valor recebido em opções não confiáveis', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    let maliciousAdminWasCalled = false
    const maliciousAdminClient = {
      from: () => {
        maliciousAdminWasCalled = true
        throw new Error('Malicious client!')
      }
    }

    // Ataque combinado: tenta falsificar companyId, userId e adminClient simultaneamente
    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Ataque combinado de spoofing',
      {
        companyId: OTHER_COMPANY_ID,
        userId: USER_CANCELLED_ID,
        adminClient: maliciousAdminClient,
        supabaseClient: userClient
      }
    )

    assert.equal(result.success, true)
    assert.equal(result.message.company_id, ACTIVE_COMPANY_ID)
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.equal(maliciousAdminWasCalled, false)
  })

  // ============================================================================
  // PARTE 2: CONSISTÊNCIA APÓS ENVIO EXTERNO CONFIRMADO
  // ============================================================================

  test('5. Gateway confirma envio, mas atualização local retorna { error }', async () => {
    const adminClient = createAdminClient()

    // Proxy onde o insert funciona e o envio externo funciona, mas o update retorna { error }
    const failingUpdateClient = {
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
                  resolve({
                    data: null,
                    error: { message: 'Lock contention on messages table', code: '40P01' }
                  })
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
      'Mensagem confirmada externamente com erro no update',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: failingUpdateClient,
        adminClient
      }
    )

    // O envio externo foi confirmado pelo gateway (não foi revertido)
    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    // O status no retorno reflete o status real persistido no banco ('pending'), sem falso 'sent'
    assert.equal(result.persistedStatus, 'pending')
    assert.equal(result.inconsistency, true)
    assert.ok(result.warning)
    assert.equal(result.warning.includes('falhou'), true)
    assert.equal(result.message.metadata.delivery_status, 'pending')
    // Identificador é preservado para reconciliação
    assert.ok(result.message.id)
  })

  test('6. Gateway confirma envio, mas atualização local lança exceção', async () => {
    const adminClient = createAdminClient()

    // Proxy onde o update lança uma exceção inesperada de conexão
    const crashingUpdateClient = {
      ...adminClient,
      from: (table: string) => {
        const builder = adminClient.from(table)
        if (table === 'messages') {
          return {
            ...builder,
            insert: (data: any) => builder.insert(data),
            update: () => {
              throw new Error('Postgres socket disconnected during update')
            }
          }
        }
        return builder
      }
    }

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Mensagem confirmada externamente com crash no update',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: crashingUpdateClient,
        adminClient
      }
    )

    // A função NÃO quebrou com exceção não tratada e preservou o envio confirmado
    assert.equal(result.success, true)
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.persistedStatus, 'pending')
    assert.equal(result.inconsistency, true)
    assert.ok(result.warning)
    assert.equal(result.message.metadata.delivery_status, 'pending')
    assert.ok(result.message.id)
  })

  test('7. Em ambos os casos (5 e 6), interface não apresenta persistência sent como confirmada', async () => {
    const adminClient = createAdminClient()

    // Testando com retorno de { error }
    const resError = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Teste validação status não sent (error)',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: {
          ...adminClient,
          from: (table: string) => {
            const builder = adminClient.from(table)
            if (table === 'messages') {
              return {
                ...builder,
                insert: (data: any) => builder.insert(data),
                update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'Fail' } }) })
              }
            }
            return builder
          }
        },
        adminClient
      }
    )

    assert.notEqual(resError.persistedStatus, 'sent')
    assert.equal(resError.persistedStatus, 'pending')
    assert.notEqual(resError.message.metadata.delivery_status, 'sent')
    assert.equal(resError.message.metadata.delivery_status, 'pending')

    // Testando com exceção
    const resCrash = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Teste validação status não sent (exception)',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: {
          ...adminClient,
          from: (table: string) => {
            const builder = adminClient.from(table)
            if (table === 'messages') {
              return {
                ...builder,
                insert: (data: any) => builder.insert(data),
                update: () => { throw new Error('Crash') }
              }
            }
            return builder
          }
        },
        adminClient
      }
    )

    assert.notEqual(resCrash.persistedStatus, 'sent')
    assert.equal(resCrash.persistedStatus, 'pending')
    assert.notEqual(resCrash.message.metadata.delivery_status, 'sent')
    assert.equal(resCrash.message.metadata.delivery_status, 'pending')
  })

  test('8. Não ocorre novo disparo externo automático', async () => {
    const adminClient = createAdminClient()
    const initialFetchCount = fetchCallCount
    const initialOutboxSize = inMemoryDb.message_outbox.size

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Teste verificação ausência de retentativa automática',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: {
          ...adminClient,
          from: (table: string) => {
            const builder = adminClient.from(table)
            if (table === 'messages') {
              return {
                ...builder,
                insert: (data: any) => builder.insert(data),
                update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'Fail' } }) })
              }
            }
            return builder
          }
        },
        adminClient
      }
    )

    // O gateway disparou apenas uma vez
    assert.equal(fetchCallCount, initialFetchCount + 1)

    // Na arquitetura transacional, exatamente 1 linha é criada na outbox com chave manual
    assert.equal(inMemoryDb.message_outbox.size, initialOutboxSize + 1)
    const outboxEntries = Array.from(inMemoryDb.message_outbox.values()).filter(
      (o: any) => o.conversation_id === CONV_ACTIVE_ID
    )
    assert.ok(outboxEntries.length > 0)
    assert.ok(outboxEntries[outboxEntries.length - 1].idempotency_key.startsWith('manual-'))
  })

  test('9. A mensagem e o identificador ficam disponíveis para reconciliação', async () => {
    const adminClient = createAdminClient()

    const result = await sendManualMessageInternal(
      CONV_ACTIVE_ID,
      'Mensagem retida para reconciliação administrativa',
      {
        companyId: ACTIVE_COMPANY_ID,
        userId: USER_ACTIVE_ID,
        supabaseClient: {
          ...adminClient,
          from: (table: string) => {
            const builder = adminClient.from(table)
            if (table === 'messages') {
              return {
                ...builder,
                insert: (data: any) => builder.insert(data),
                update: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'Lock error' } }) })
              }
            }
            return builder
          }
        },
        adminClient
      }
    )

    assert.ok(result.message.id)
    // O registro existe no banco de dados e pode ser consultado pelo ID para reconciliação
    const stored = inMemoryDb.messages.get(result.message.id)
    assert.ok(stored)
    assert.equal(stored.id, result.message.id)
    assert.equal(stored.conversation_id, CONV_ACTIVE_ID)
    assert.equal(stored.company_id, ACTIVE_COMPANY_ID)
    assert.equal(stored.metadata.delivery_status, 'pending')
  })
})
