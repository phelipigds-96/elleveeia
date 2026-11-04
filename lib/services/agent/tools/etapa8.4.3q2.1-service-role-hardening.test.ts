import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import { processWebhookEvent, handleAutonomousCycle } from '@/lib/services/message-engine'
import { runAgentEngine } from '@/lib/services/agent/engine'
import { buildAgentContext } from '@/lib/services/agent/context-builder'
import { sendManualMessageInternal } from '@/lib/services/conversations-internal'

function createMockLLMProvider(options?: { replyContent?: string; shouldThrow?: boolean }) {
  let callCount = 0
  const replyContent = options?.replyContent || 'Resposta automática de teste do agente.'
  return {
    get callCount() {
      return callCount
    },
    generateResponse: async () => {
      callCount++
      if (options?.shouldThrow) {
        throw new Error('LLM Provider Error')
      }
      return {
        content: replyContent,
        tool_calls: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        }
      }
    }
  }
}

test.describe('ETAPA 8.4.3Q.2.1 — Hardening de Consultas e Atualizações com Service Role', () => {
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'

  const USER_A_ID = 'user-tenant-a-1'
  const USER_B_ID = 'user-tenant-b-1'

  const CUST_A_ID = 'aaaaaaaa-0001-0000-0000-000000000001'
  const CUST_B_ID = 'bbbbbbbb-0001-0000-0000-000000000001'

  const CONV_A_ID = 'cccccccc-0001-0000-0000-000000000001'
  const CONV_B_ID = 'cccccccc-0002-0000-0000-000000000002'

  const AGENT_A_ID = 'dddddddd-0001-0000-0000-000000000001'
  const AGENT_B_ID = 'dddddddd-0002-0000-0000-000000000002'

  const MSG_A1_ID = 'eeeeeeee-0001-0000-0000-000000000001'
  const MSG_B1_ID = 'eeeeeeee-0002-0000-0000-000000000002'

  function seedDb() {
    resetInMemoryDb()

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

    // 2. Profiles
    inMemoryDb.profiles.set(USER_A_ID, {
      id: USER_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant'
    })
    inMemoryDb.profiles.set(USER_B_ID, {
      id: USER_B_ID,
      company_id: TENANT_B_ID,
      role: 'attendant'
    })

    // 3. Clientes
    inMemoryDb.customers.set(CUST_A_ID, {
      id: CUST_A_ID,
      company_id: TENANT_A_ID,
      name: 'Cliente Alpha Original',
      phone: '+5511999990001'
    })
    inMemoryDb.customers.set(CUST_B_ID, {
      id: CUST_B_ID,
      company_id: TENANT_B_ID,
      name: 'Cliente Beta Original',
      phone: '+5521999990002'
    })

    // 4. Conversas
    inMemoryDb.conversations.set(CONV_A_ID, {
      id: CONV_A_ID,
      company_id: TENANT_A_ID,
      customer_id: CUST_A_ID,
      agent_id: AGENT_A_ID,
      status: 'open',
      channel: 'whatsapp',
      unread_count: 0,
      last_message_at: '2026-10-01T10:00:00Z',
      created_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      customers: { phone: '+5511999990001', name: 'Cliente Alpha Original' }
    })
    inMemoryDb.conversations.set(CONV_B_ID, {
      id: CONV_B_ID,
      company_id: TENANT_B_ID,
      customer_id: CUST_B_ID,
      agent_id: AGENT_B_ID,
      status: 'open',
      channel: 'whatsapp',
      unread_count: 0,
      last_message_at: '2026-10-01T10:00:00Z',
      created_at: '2026-10-01T09:00:00Z',
      closed_at: null,
      customers: { phone: '+5521999990002', name: 'Cliente Beta Original' }
    })

    // 5. Agentes
    inMemoryDb.agents.set(AGENT_A_ID, {
      id: AGENT_A_ID,
      company_id: TENANT_A_ID,
      name: 'Agente Alpha',
      is_active: true,
      model: 'gemini-2.0-flash',
      prompt: 'Você é um assistente de vendas da Empresa Alpha.'
    })
    inMemoryDb.agents.set(AGENT_B_ID, {
      id: AGENT_B_ID,
      company_id: TENANT_B_ID,
      name: 'Agente Beta',
      is_active: true,
      model: 'gemini-2.0-flash',
      prompt: 'Você é um assistente de vendas da Empresa Beta.'
    })

    // 6. Mensagens
    inMemoryDb.messages.set(MSG_A1_ID, {
      id: MSG_A1_ID,
      conversation_id: CONV_A_ID,
      company_id: TENANT_A_ID,
      sender_type: 'customer',
      content: 'Mensagem inicial do cliente Alpha',
      created_at: '2026-11-05T10:00:00Z'
    })
    inMemoryDb.messages.set(MSG_B1_ID, {
      id: MSG_B1_ID,
      conversation_id: CONV_B_ID,
      company_id: TENANT_B_ID,
      sender_type: 'customer',
      content: 'Mensagem inicial do cliente Beta',
      created_at: '2026-11-05T10:00:00Z'
    })

    // 7. Integrações (necessário para sendOutboundMessage simular sucesso)
    inMemoryDb.integrations.set('int-alpha-n8n', {
      id: 'int-alpha-n8n',
      company_id: TENANT_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-123' }
    })
    inMemoryDb.integrations.set('int-beta-n8n', {
      id: 'int-beta-n8n',
      company_id: TENANT_B_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-123' }
    })
  }

  let originalFetch: any

  test.beforeEach(() => {
    originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
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
  // TESTE 1: UPDATE de conversa com ID correto e empresa correta (message-engine)
  // ============================================================================
  test('1. UPDATE de conversa via processWebhookEvent atualiza estritamente no escopo da empresa correta', async () => {
    seedDb()
    const adminClient = createAdminClient()

    const payload = {
      event_id: 'evt-alpha-001',
      event_type: 'message.received',
      channel: 'whatsapp' as const,
      customer: {
        phone: '+5511999990001',
        name: 'Cliente Alpha Atualizado'
      },
      message: {
        content: 'Nova mensagem recebida no webhook Alpha',
        sender_type: 'customer' as const,
        created_at: '2026-11-05T11:00:00Z'
      }
    }

    const result = await processWebhookEvent(TENANT_A_ID, payload, { adminClient })
    assert.equal(result.success, true)
    assert.equal(result.conversation_id, CONV_A_ID)

    // Conversa da Empresa A deve ter unread_count incrementado e last_message_at atualizado
    const convA = inMemoryDb.conversations.get(CONV_A_ID)
    assert.equal(convA.unread_count, 1)
    assert.equal(convA.last_message_at, '2026-11-05T11:00:00Z')

    // Conversa da Empresa B deve permanecer 100% inalterada
    const convB = inMemoryDb.conversations.get(CONV_B_ID)
    assert.equal(convB.unread_count, 0)
    assert.equal(convB.last_message_at, '2026-10-01T10:00:00Z')
  })

  // ============================================================================
  // TESTE 2: UPDATE de conversa com ID de outra empresa sob Service Role
  // ============================================================================
  test('2. UPDATE em conversations sob service_role com id de outra empresa não afeta o registro', async () => {
    seedDb()
    const adminClient = createAdminClient()

    // Tenta atualizar a conversa da Empresa B passando company_id da Empresa A
    const { data } = await adminClient
      .from('conversations')
      .update({ status: 'closed' })
      .eq('id', CONV_B_ID)
      .eq('company_id', TENANT_A_ID) // Empresa divergente!

    // A conversa da Empresa B permanece 'open' pois o filtro company_id bloqueou a mutação
    const convB = inMemoryDb.conversations.get(CONV_B_ID)
    assert.equal(convB.status, 'open', 'Status da Empresa B não pode ter sido alterado')
    assert.equal(convB.company_id, TENANT_B_ID)
  })

  // ============================================================================
  // TESTE 3: UPDATE de mensagem com empresa divergente sob Service Role
  // ============================================================================
  test('3. UPDATE em messages sob service_role com empresa divergente não afeta o registro', async () => {
    seedDb()
    const adminClient = createAdminClient()

    // Tenta atualizar metadata da mensagem da Empresa B passando company_id da Empresa A
    await adminClient
      .from('messages')
      .update({ metadata: { delivery_status: 'sent' } })
      .eq('id', MSG_B1_ID)
      .eq('company_id', TENANT_A_ID) // Empresa divergente!

    // A mensagem da Empresa B não tem seu metadata alterado
    const msgB = inMemoryDb.messages.get(MSG_B1_ID)
    assert.equal(msgB.metadata, undefined)
  })

  // ============================================================================
  // TESTE 4: SELECT de histórico com filtro de empresa em buildAgentContext
  // ============================================================================
  test('4. buildAgentContext consulta histórico de mensagens com filtro estrito de company_id', async () => {
    seedDb()

    // Contexto legítimo da Empresa A
    const contextA = await buildAgentContext({
      companyId: TENANT_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_A_ID
    })

    assert.ok(contextA.conversation)
    assert.equal(contextA.conversation.id, CONV_A_ID)
    assert.equal(contextA.conversation.company_id, TENANT_A_ID)
    // O histórico carregado deve conter apenas mensagens da Empresa A
    for (const msg of contextA.payloadMessages) {
      if (msg.role !== 'system') {
        assert.ok(msg.content.includes('Alpha'), 'Mensagens devem pertencer à conversa da Empresa A')
      }
    }

    // Se conversationId for da Empresa B mas companyId for Empresa A, deve rejeitar com erro
    await assert.rejects(
      async () => {
        await buildAgentContext({
          companyId: TENANT_A_ID,
          agentId: AGENT_A_ID,
          conversationId: CONV_B_ID // Conversa de outro tenant
        })
      },
      /Conversa nao encontrada ou acesso negado/i
    )
  })

  // ============================================================================
  // TESTE 5: Atualizações de status de entrega com isolamento por tenant
  // ============================================================================
  test('5. Atualizações de entrega em messages e message_outbox usam company_id estrito', async () => {
    seedDb()
    const adminClient = createAdminClient()
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta do agente Alpha para entrega' })

    const payload = {
      event_id: 'evt-alpha-delivery-001',
      event_type: 'message.received',
      channel: 'whatsapp' as const,
      customer: {
        phone: '+5511999990001',
        name: 'Cliente Alpha'
      },
      message: {
        content: 'Olá atendente',
        sender_type: 'customer' as const,
        created_at: '2026-11-05T12:00:00Z'
      }
    }

    const cycleRes = await handleAutonomousCycle({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      messageId: MSG_A1_ID,
      eventId: 'evt-alpha-delivery-001',
      payload,
      adminClient,
      llmProvider: mockLLM
    })

    assert.equal(cycleRes.executed, true)

    // Se o agente respondeu, a mensagem gerada deve pertencer estritamente à Empresa A
    if (cycleRes.replyMessageId) {
      const replyMsg = inMemoryDb.messages.get(cycleRes.replyMessageId)
      assert.ok(replyMsg, 'Mensagem de resposta deve existir')
      assert.equal(replyMsg.company_id, TENANT_A_ID, 'Mensagem deve pertencer à Empresa A')
    }
  })

  // ============================================================================
  // TESTE 6: runAgentEngine valida conversa com .eq('id', conversationId).eq('company_id', companyId)
  // ============================================================================
  test('6. runAgentEngine valida conversa e atualiza last_message_at com escopo de tenant', async () => {
    seedDb()
    const adminClient = createAdminClient()
    const mockLLM = createMockLLMProvider({ replyContent: 'Tudo bem, como posso ajudar?' })

    // Execução legítima na Empresa A
    const result = await runAgentEngine({
      companyId: TENANT_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_A_ID,
      userMessage: 'Olá assistente',
      skipCustomerMessageInsert: true,
      adminClient,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(mockLLM.callCount, 1)

    // Conversa da Empresa A teve last_message_at atualizado
    const convA = inMemoryDb.conversations.get(CONV_A_ID)
    assert.ok(convA.last_message_at > '2026-10-01T10:00:00Z')

    // Tentativa cross-tenant com conversa da Empresa B passando Empresa A
    const crossResult = await runAgentEngine({
      companyId: TENANT_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_B_ID, // Conversa da Empresa B!
      userMessage: 'Tentativa cross-tenant',
      adminClient,
      llmProvider: mockLLM
    })

    assert.equal(crossResult.success, false)
    assert.equal(crossResult.code, 'INVALID_COMPANY_ID')
    assert.match(crossResult.error, /não pertence à empresa informada/i)
  })

  // ============================================================================
  // TESTE 7: sendManualMessageInternal atualiza mensagens e conversas com company_id
  // ============================================================================
  test('7. sendManualMessageInternal atualiza estado local de delivery e conversa com filtro de tenant', async () => {
    seedDb()
    const adminClient = createAdminClient()
    const originalFetch = globalThis.fetch

    try {
      globalThis.fetch = (async (url: any, options: any) => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ message: 'Dispatched successfully' })
        } as any
      }) as any

      const result = await sendManualMessageInternal(CONV_A_ID, 'Mensagem manual do operador Alpha', {
        userId: USER_A_ID,
        companyId: TENANT_A_ID,
        supabaseClient: adminClient,
        adminClient
      })

      assert.equal(result.success, true)
      assert.equal(result.gatewayDispatched, true)

      // Conversa da Empresa A teve last_message_at atualizado
      const convA = inMemoryDb.conversations.get(CONV_A_ID)
      assert.ok(convA.last_message_at > '2026-10-01T10:00:00Z')

      // Mensagem inserida pertence à Empresa A
      const msg = inMemoryDb.messages.get(result.message.id)
      assert.ok(msg)
      assert.equal(msg.company_id, TENANT_A_ID)
      assert.equal(msg.sender_id, USER_A_ID)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // ============================================================================
  // TESTE 8: Análise estática do código-fonte para comprovar os filtros
  // ============================================================================
  test('8. Análise estática: confirma presença de .eq("company_id", companyId) nas operações com service_role', () => {
    // 1. message-engine.ts
    const msgEnginePath = path.resolve(process.cwd(), 'lib/services/message-engine.ts')
    const msgEngineCode = fs.readFileSync(msgEnginePath, 'utf8')

    // Update de customers com company_id
    assert.match(msgEngineCode, /\.from\('customers'\)\s*\.update\([\s\S]*?\)\s*\.eq\('id',\s*customerId\)\s*\.eq\('company_id',\s*companyId\)/)
    // Update de conversations com company_id
    assert.match(msgEngineCode, /\.from\('conversations'\)\s*\.update\([\s\S]*?\)\s*\.eq\('id',\s*conversationId\)\s*\.eq\('company_id',\s*companyId\)/)
    // Update de messages (suprimida) com company_id
    assert.match(msgEngineCode, /\.from\('messages'\)\s*\.update\([\s\S]*?\)\s*\.eq\('id',\s*agentResult\.messageId\)\s*\.eq\('company_id',\s*companyId\)/)

    // 2. agent/engine.ts
    const enginePath = path.resolve(process.cwd(), 'lib/services/agent/engine.ts')
    const engineCode = fs.readFileSync(enginePath, 'utf8')

    // Validação da conversa com id e company_id
    assert.match(engineCode, /\.from\('conversations'\)\s*\.select\('id,\s*company_id'\)\s*\.eq\('id',\s*conversationId\)\s*\.eq\('company_id',\s*companyId\)/)
    // Update pós-resposta com id e company_id
    assert.match(engineCode, /\.from\('conversations'\)\s*\.update\([\s\S]*?\)\s*\.eq\('id',\s*conversationId\)\s*\.eq\('company_id',\s*companyId\)/)

    // 3. agent/context-builder.ts
    const contextBuilderPath = path.resolve(process.cwd(), 'lib/services/agent/context-builder.ts')
    const contextBuilderCode = fs.readFileSync(contextBuilderPath, 'utf8')

    // Carregamento de mensagens com conversation_id e company_id
    assert.match(contextBuilderCode, /\.from\('messages'\)\s*\.select\('\*'\)\s*\.eq\('conversation_id',\s*conversationId\)\s*\.eq\('company_id',\s*companyId\)/)

    // 4. conversations-internal.ts
    const convInternalPath = path.resolve(process.cwd(), 'lib/services/conversations-internal.ts')
    const convInternalCode = fs.readFileSync(convInternalPath, 'utf8')

    // Updates pós-despacho com id e company_id
    assert.match(convInternalCode, /\.from\('messages'\)\s*\.update\([\s\S]*?\)\s*\.eq\('id',\s*message\.id\)\s*\.eq\('company_id',\s*companyId\)/)
    assert.match(convInternalCode, /\.from\('conversations'\)\s*\.update\([\s\S]*?\)\s*\.eq\('id',\s*conversationId\)\s*\.eq\('company_id',\s*companyId\)/)
  })
})
