// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import * as convModule from '@/lib/services/conversations'
import { sendMessage } from '@/lib/services/conversations'
import { sendManualMessageInternal } from '@/lib/services/conversations-internal'
import { inMemoryDb, resetInMemoryDb, createAdminClient, createAuthenticatedClient, createClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3I.2 — Auditoria da Exposição de Server Actions e Semântica de Confirmação do Gateway', () => {
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const OTHER_COMPANY_ID = '22222222-2222-2222-2222-222222222222'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'

  const CONV_ACTIVE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_OTHER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  const USER_ACTIVE_ID = 'user-act-1111'
  const USER_OTHER_ID = 'user-oth-2222'

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
        text: async () => JSON.stringify({ message: 'Dispatched successfully', id: 'gw-msg-123' })
      } as any
    }

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(ACTIVE_COMPANY_ID, {
      id: ACTIVE_COMPANY_ID,
      name: 'Empresa Alpha Ativa',
      slug: 'empresa-alpha-ativa',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(OTHER_COMPANY_ID, {
      id: OTHER_COMPANY_ID,
      name: 'Empresa Beta Ativa',
      slug: 'empresa-beta-ativa',
      status: 'active',
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

    // 3. Integrações de mensageria
    inMemoryDb.integrations.set('int-active-1', {
      id: 'int-active-1',
      company_id: ACTIVE_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-outbound-alpha' }
    })

    // 4. Clientes e Conversas
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
  // TESTE 1: ISOLAMENTO ARQUITETURAL DE EXPORTS
  // ============================================================================
  test('1. sendManualMessageInternal NÃO é exportada por lib/services/conversations.ts', () => {
    // Garante que a função interna privilegiada não foi exportada pelo arquivo 'use server'
    assert.equal(
      (convModule as any).sendManualMessageInternal,
      undefined,
      'sendManualMessageInternal JAMAIS deve ser exportada por lib/services/conversations.ts (módulo use server)'
    )
    assert.equal(
      (convModule as any).SendMessageInternalContext,
      undefined,
      'SendMessageInternalContext não deve ser exportado como valor em runtime no módulo use server'
    )
  })

  // ============================================================================
  // TESTE 2: AUDITORIA DOS EXPORTS DO MÓDULO 'use server'
  // ============================================================================
  test('2. Nenhuma função interna privilegiada está exposta como Server Action em conversations.ts', () => {
    const exportedKeys = Object.keys(convModule)
    
    // Lista exata de Server Actions autorizadas
    const allowedServerActions = [
      'getCompanyId',
      'getConversations',
      'getConversation',
      'getMessages',
      'sendMessage',
      'updateConversationStatus',
      'markAsRead'
    ]

    for (const key of exportedKeys) {
      assert.ok(
        allowedServerActions.includes(key),
        `Exportação inesperada '${key}' encontrada em lib/services/conversations.ts! Todas as funções exportadas por este módulo tornam-se endpoints de Server Action no Next.js.`
      )
    }

    // Nenhuma função com 'internal' no nome deve existir
    const internalExports = exportedKeys.filter(k => k.toLowerCase().includes('internal'))
    assert.deepEqual(internalExports, [], 'Nenhum export com o termo "internal" pode estar presente em conversartions.ts')
  })

  // ============================================================================
  // TESTE 3: SESSÃO AUTENTICADA OBRIGATÓRIA NA SERVER ACTION PÚBLICA
  // ============================================================================
  test('3. Server Action pública sendMessage continua exigindo sessão autenticada', async () => {
    // Cliente anônimo / não autenticado
    const anonymousClient = createClient(null, null, { auth: { user: null } })

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Tentativa de envio não autenticado',
      { supabaseClient: anonymousClient }
    )

    assert.equal(result.success, false)
    assert.equal(result.code, 'UNAUTHORIZED')
    assert.equal(result.gatewayDispatched, false)
    assert.equal(result.externalDeliveryConfirmed, false)
    assert.equal(fetchCallCount, 0, 'O gateway de mensageria JAMAIS deve ser chamado por usuários não autenticados')
  })

  // ============================================================================
  // TESTE 4: BLOQUEIO ESTRITO DE FORGING DE companyId E userId
  // ============================================================================
  test('4. Tentativas de forjar companyId e userId via sendMessage permanecem estritamente neutralizadas', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    // Operador tenta se passar por outro usuário e injetar tenant diferente
    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Tentativa de spoofing de tenant e operador',
      {
        companyId: OTHER_COMPANY_ID,
        userId: 'malicious-spoofed-user',
        supabaseClient: userClient
      }
    )

    assert.equal(result.success, true)
    // O servidor usou os dados da sessão/perfil, ignorando completamente o untrustedOptions
    assert.equal(result.message.company_id, ACTIVE_COMPANY_ID)
    assert.notEqual(result.message.company_id, OTHER_COMPANY_ID)
    assert.equal(result.message.sender_id, USER_ACTIVE_ID)
    assert.notEqual(result.message.sender_id, 'malicious-spoofed-user')

    // Tentativa em conversa que não pertence à sua empresa
    const resultCross = await sendMessage(
      CONV_OTHER_ID,
      'Tentativa em conversa alheia',
      {
        companyId: OTHER_COMPANY_ID,
        supabaseClient: userClient
      }
    )

    assert.equal(resultCross.success, false)
    assert.equal(resultCross.code, 'CONVERSATION_NOT_FOUND')
    assert.equal(resultCross.gatewayDispatched, false)
    assert.equal(resultCross.externalDeliveryConfirmed, false)
  })

  // ============================================================================
  // TESTE 5: CONTEXTO PRIVILEGIADO É CRIADO EXCLUSIVAMENTE NO SERVIDOR
  // ============================================================================
  test('5. Contexto privilegiado é construído pelo servidor e adminClient forjado é descartado', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })
    
    let fakeAdminUsed = false
    const maliciousAdminClient = {
      from: () => {
        fakeAdminUsed = true
        throw new Error('Malicious admin client should never be executed!')
      }
    }

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Mensagem enviada com adminClient forjado no cliente',
      {
        adminClient: maliciousAdminClient,
        supabaseClient: userClient
      }
    )

    assert.equal(result.success, true)
    assert.equal(fakeAdminUsed, false, 'O adminClient injetado via untrustedOptions NUNCA deve ser utilizado!')
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.externalDeliveryConfirmed, true)
  })

  // ============================================================================
  // TESTE 6: SEMÂNTICA DE CONFIRMAÇÃO DO GATEWAY (gatewayDispatched vs entrega final)
  // ============================================================================
  test('6. Gateway success: true é tratado como aceite de despacho (gatewayDispatched), não entrega física ao aparelho', async () => {
    const userClient = createAuthenticatedClient({ id: USER_ACTIVE_ID })

    const result = await sendMessage(
      CONV_ACTIVE_ID,
      'Olá cliente, sua fatura está disponível.',
      { supabaseClient: userClient }
    )

    assert.equal(result.success, true)
    // O retorno formal indica que a requisição foi despachada/aceita pelo gateway externo
    assert.equal(result.gatewayDispatched, true)
    assert.equal(result.externalDeliveryConfirmed, true) // Alias mantido para compatibilidade
    assert.equal(result.persistedStatus, 'sent')
    assert.equal(result.inconsistency, false)

    // O status da mensagem no banco é 'sent' (despachada ao gateway)
    assert.equal(result.message.metadata.delivery_status, 'sent')

    // Documenta e valida a semântica:
    // O retorno 200 do n8n NÃO garante que o celular do destinatário recebeu ('delivered') ou leu ('read').
    assert.notEqual(result.message.metadata.delivery_status, 'delivered')
    assert.notEqual(result.message.metadata.delivery_status, 'read')
  })

  // ============================================================================
  // TESTE 7: DISTINÇÃO ENTRE 'sent' E 'pending' EM CASO DE INCONSISTÊNCIA DE PERSISTÊNCIA
  // ============================================================================
  test('7. Interface continua distinguindo sent de pending em inconsistência de persistência local', async () => {
    const adminClient = createAdminClient()

    // Configura o mock da tabela messages para aceitar o insert inicial (pending)
    // mas simular falha de banco no update para 'sent'
    let updateAttempts = 0
    const originalMessagesMap = inMemoryDb.messages
    
    // Criamos um proxy sobre inMemoryDb.messages para interceptar o update
    const messagesProxy = new Proxy(originalMessagesMap, {
      get(target, prop, receiver) {
        if (prop === 'set') {
          return function(key: any, value: any) {
            // Se for update modificando status para 'sent'
            if (value?.metadata?.delivery_status === 'sent') {
              updateAttempts++
              throw new Error('Supabase DB connection lost during message update')
            }
            return target.set(key, value)
          }
        }
        const val = Reflect.get(target, prop, target)
        return typeof val === 'function' ? val.bind(target) : val
      }
    })

    inMemoryDb.messages = messagesProxy

    try {
      const result = await sendManualMessageInternal(
        CONV_ACTIVE_ID,
        'Mensagem com falha de persistência após aceite do gateway',
        {
          userId: USER_ACTIVE_ID,
          companyId: ACTIVE_COMPANY_ID,
          supabaseClient: adminClient,
          adminClient: adminClient
        }
      )

      assert.equal(result.success, true)
      // O gateway externo recebeu com sucesso
      assert.equal(result.gatewayDispatched, true)
      assert.equal(result.externalDeliveryConfirmed, true)
      // Porém o banco de dados NÃO foi atualizado para 'sent'
      assert.equal(result.persistedStatus, 'pending')
      assert.equal(result.inconsistency, true)
      assert.ok(result.warning?.includes('pendente para reconciliação'))
      assert.equal(result.message.metadata.delivery_status, 'pending')
    } finally {
      inMemoryDb.messages = originalMessagesMap
    }
  })
})
