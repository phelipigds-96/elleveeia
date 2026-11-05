// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { handleAutonomousCycle, type AutonomousCycleParams } from '@/lib/services/message-engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

describe('ETAPA 8.4.3Q.2.8E.2 — Hardening Pré-LLM e Supressão de Handoff', () => {
  const ACTIVE_COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const ACTIVE_COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'

  const CONV_ACTIVE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_ACTIVE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  const AGENT_A_ID = 'agent-1111-aaaa'
  const AGENT_B_ID = 'agent-2222-bbbb'

  let fetchCallCount = 0
  let lastFetchOptions: any = null
  let originalFetch: any
  let fetchMockHandler: ((url: string, options: any) => Promise<any>) | null = null

  function createValidPayload(companyId = ACTIVE_COMPANY_A_ID, eventId = 'evt-test-1', phone = '5511999991111'): any {
    return {
      event_id: eventId,
      channel: 'whatsapp',
      company_id: companyId,
      customer: {
        phone,
        name: 'Cliente Teste'
      },
      message: {
        id: `msg-${eventId}`,
        content: 'Olá, gostaria de informações.',
        sender_type: 'customer',
        created_at: new Date().toISOString()
      }
    }
  }

  function createMockLLMProvider(options: {
    replyContent?: string
    onGenerate?: () => void
  } = {}) {
    let callCount = 0
    return {
      get callCount() {
        return callCount
      },
      generateResponse: async (_request: any) => {
        callCount++
        if (options.onGenerate) {
          options.onGenerate()
        }
        return {
          content: options.replyContent || 'Resposta gerada pela IA.',
          tool_calls: null,
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120
          }
        }
      }
    }
  }

  beforeEach(() => {
    resetInMemoryDb()
    fetchCallCount = 0
    lastFetchOptions = null
    fetchMockHandler = null
    originalFetch = globalThis.fetch

    globalThis.fetch = async (url: any, options: any) => {
      fetchCallCount++
      lastFetchOptions = options
      if (fetchMockHandler) {
        return fetchMockHandler(url, options)
      }
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
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(ACTIVE_COMPANY_B_ID, {
      id: ACTIVE_COMPANY_B_ID,
      name: 'Empresa Ativa Beta',
      slug: 'empresa-ativa-beta',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Agentes
    inMemoryDb.agents.set(AGENT_A_ID, {
      id: AGENT_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      name: 'Agente IA Alpha',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    inMemoryDb.agents.set(AGENT_B_ID, {
      id: AGENT_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      name: 'Agente IA Beta',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    // 3. Cadastrar Clientes e Conversas
    inMemoryDb.customers.set('cust-a', {
      id: 'cust-a',
      company_id: ACTIVE_COMPANY_A_ID,
      phone: '5511999991111',
      name: 'Cliente Alpha'
    })

    inMemoryDb.customers.set('cust-b', {
      id: 'cust-b',
      company_id: ACTIVE_COMPANY_B_ID,
      phone: '5511999992222',
      name: 'Cliente Beta'
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_A_ID, {
      id: CONV_ACTIVE_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      channel: 'whatsapp',
      status: 'open',
      agent_id: AGENT_A_ID,
      customer_id: 'cust-a',
      customers: {
        id: 'cust-a',
        phone: '5511999991111',
        name: 'Cliente Alpha'
      }
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_B_ID, {
      id: CONV_ACTIVE_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      channel: 'whatsapp',
      status: 'open',
      agent_id: AGENT_B_ID,
      customer_id: 'cust-b',
      customers: {
        id: 'cust-b',
        phone: '5511999992222',
        name: 'Cliente Beta'
      }
    })

    // 4. Cadastrar Integrações n8n
    inMemoryDb.integrations.set('int-alpha', {
      id: 'int-alpha',
      company_id: ACTIVE_COMPANY_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://gateway.example.com/webhook/alpha' },
      credentials: { webhook_secret: 'sec-alpha-123' }
    })

    inMemoryDb.integrations.set('int-beta', {
      id: 'int-beta',
      company_id: ACTIVE_COMPANY_B_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://gateway.example.com/webhook/beta' },
      credentials: { webhook_secret: 'sec-beta-123' }
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ============================================================================
  // PARTE A: CENÁRIO 1 — Webhook duplicado com outbox 'pending' -> LLM NÃO executado
  // ============================================================================
  test('1. Webhook duplicado com outbox em estado pending não executa o LLM', async () => {
    const eventId = 'evt-dup-pending'
    const idempotencyKey = `agent-reply-${eventId}`
    const existingOutboxId = 'outbox-pending-1'
    const existingMessageId = 'msg-pending-1'

    // Pre-popula outbox com status pending
    inMemoryDb.message_outbox.set(existingOutboxId, {
      id: existingOutboxId,
      company_id: ACTIVE_COMPANY_A_ID,
      conversation_id: CONV_ACTIVE_A_ID,
      message_id: existingMessageId,
      idempotency_key: idempotencyKey,
      channel: 'whatsapp',
      recipient: '5511999991111',
      payload: {},
      status: 'pending',
      attempts: 0,
      max_attempts: 5
    })

    const mockLLM = createMockLLMProvider()
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-1',
      eventId,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(mockLLM.callCount, 0, 'O LLM não pode ser executado para duplicata pending')
    assert.equal(fetchCallCount, 0, 'O gateway não pode ser acionado')
    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'idempotent_duplicate')
    assert.equal(res.outboxId, existingOutboxId)
    assert.equal(res.replyMessageId, existingMessageId)
  })

  // ============================================================================
  // PARTE A: CENÁRIO 2 — Webhook duplicado com outbox 'processing' -> LLM NÃO executado
  // ============================================================================
  test('2. Webhook duplicado com outbox em estado processing não executa o LLM', async () => {
    const eventId = 'evt-dup-processing'
    const idempotencyKey = `agent-reply-${eventId}`
    const existingOutboxId = 'outbox-proc-2'
    const existingMessageId = 'msg-proc-2'

    inMemoryDb.message_outbox.set(existingOutboxId, {
      id: existingOutboxId,
      company_id: ACTIVE_COMPANY_A_ID,
      conversation_id: CONV_ACTIVE_A_ID,
      message_id: existingMessageId,
      idempotency_key: idempotencyKey,
      status: 'processing',
      attempts: 1,
      max_attempts: 5
    })

    const mockLLM = createMockLLMProvider()
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-2',
      eventId,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(mockLLM.callCount, 0, 'O LLM não pode ser executado para duplicata em processamento')
    assert.equal(fetchCallCount, 0, 'O gateway não pode ser acionado')
    assert.equal(res.reason, 'idempotent_duplicate')
    assert.equal(res.outboxId, existingOutboxId)
    assert.equal(res.replyMessageId, existingMessageId)
  })

  // ============================================================================
  // PARTE A: CENÁRIO 3 — Webhook duplicado com outbox 'sent' -> LLM NÃO executado
  // ============================================================================
  test('3. Webhook duplicado com outbox em estado sent não executa o LLM', async () => {
    const eventId = 'evt-dup-sent'
    const idempotencyKey = `agent-reply-${eventId}`
    const existingOutboxId = 'outbox-sent-3'
    const existingMessageId = 'msg-sent-3'

    inMemoryDb.message_outbox.set(existingOutboxId, {
      id: existingOutboxId,
      company_id: ACTIVE_COMPANY_A_ID,
      conversation_id: CONV_ACTIVE_A_ID,
      message_id: existingMessageId,
      idempotency_key: idempotencyKey,
      status: 'sent',
      attempts: 1,
      max_attempts: 5
    })

    const mockLLM = createMockLLMProvider()
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-3',
      eventId,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(mockLLM.callCount, 0, 'O LLM não pode ser executado para duplicata já enviada')
    assert.equal(fetchCallCount, 0, 'O gateway não pode ser acionado')
    assert.equal(res.reason, 'idempotent_duplicate')
    assert.equal(res.outboxId, existingOutboxId)
    assert.equal(res.replyMessageId, existingMessageId)
  })

  // ============================================================================
  // PARTE A: CENÁRIO 4 — Evento novo sem outbox existente: fluxo normal preservado
  // ============================================================================
  test('4. Evento novo sem outbox prévia executa normalmente o LLM e despacha ao gateway', async () => {
    const eventId = 'evt-brand-new-4'
    const mockLLM = createMockLLMProvider({ replyContent: 'Atendimento normal' })
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-4',
      eventId,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(mockLLM.callCount, 1, 'O LLM deve ser executado exatamente uma vez')
    assert.equal(fetchCallCount, 1, 'O gateway deve ser acionado exatamente uma vez')
    assert.equal(res.executed, true)
    assert.equal(res.dispatched, true)
    assert.ok(res.outboxId)
    assert.ok(res.replyMessageId)

    // Verifica que a outbox e messages foram criadas e finalizadas como sent
    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outboxRecord?.status, 'sent')
    const messageRecord = inMemoryDb.messages.get(res.replyMessageId)
    assert.equal(messageRecord?.metadata?.delivery_status, 'sent')
  })

  // ============================================================================
  // PARTE A: CENÁRIO 5 — Isolamento estrito entre empresas
  // ============================================================================
  test('5. Isolamento entre empresas: chave idempotente de outra empresa não bloqueia evento da empresa atual', async () => {
    const sharedEventId = 'evt-shared-123'
    const idempotencyKey = `agent-reply-${sharedEventId}`

    // Empresa B possui outbox criada com essa chave
    inMemoryDb.message_outbox.set('outbox-company-b', {
      id: 'outbox-company-b',
      company_id: ACTIVE_COMPANY_B_ID,
      conversation_id: CONV_ACTIVE_B_ID,
      message_id: 'msg-b',
      idempotency_key: idempotencyKey,
      status: 'sent',
      attempts: 1,
      max_attempts: 5
    })

    // Empresa A recebe o mesmo eventId (ex: IDs gerados sequencialmente em canais independentes)
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta Empresa A' })
    const payloadA = createValidPayload(ACTIVE_COMPANY_A_ID, sharedEventId)

    const resA = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-a',
      eventId: sharedEventId,
      payload: payloadA,
      llmProvider: mockLLM
    })

    // Deve executar normalmente para Empresa A, sem colidir com Empresa B
    assert.equal(mockLLM.callCount, 1, 'Empresa A deve executar o LLM sem ser bloqueada por Empresa B')
    assert.equal(fetchCallCount, 1, 'Empresa A deve despachar ao gateway')
    assert.equal(resA.dispatched, true)
    assert.notEqual(resA.outboxId, 'outbox-company-b', 'Outbox da Empresa A deve ser distinta da Empresa B')
  })

  // ============================================================================
  // PARTE B: CENÁRIO 6 — Supressão por handoff com RPC bem-sucedida
  // ============================================================================
  test('6. Supressão por handoff com RPC bem-sucedida valida claim_token/version e atualiza mensagem', async () => {
    const eventId = 'evt-suppress-ok-6'
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta que será suprimida' })
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    let capturedCompleteArgs: any = null
    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        const result = await baseClient.rpc(fnName, params)
        if (fnName === 'claim_outbox_message') {
          // Atendente assume a conversa durante a janela pós-claim
          const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
          conv.status = 'human'
        }
        if (fnName === 'complete_outbox_message') {
          capturedCompleteArgs = params
        }
        return result
      }
    }

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-6',
      eventId,
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(res.dispatched, false, 'Mensagem não pode ser enviada ao gateway')
    assert.equal(res.reason, 'suppressed_by_handoff')
    assert.equal(fetchCallCount, 0, 'Zero chamadas ao gateway')

    // Confirma que os argumentos enviados à RPC de conclusão correspondem rigorosamente ao claim
    assert.ok(capturedCompleteArgs, 'complete_outbox_message deve ter sido chamada')
    assert.equal(capturedCompleteArgs.p_company_id, ACTIVE_COMPANY_A_ID)
    assert.equal(capturedCompleteArgs.p_outbox_id, res.outboxId)
    assert.ok(capturedCompleteArgs.p_claim_token, 'claim_token deve estar presente')
    assert.equal(capturedCompleteArgs.p_claim_version, 1, 'claim_version deve ser 1')
    assert.equal(capturedCompleteArgs.p_status, 'suppressed')

    // Confirma que a mensagem vinculada recebeu status 'suppressed' após confirmação da RPC
    const msgRecord = inMemoryDb.messages.get(res.replyMessageId)
    assert.equal(msgRecord?.metadata?.delivery_status, 'suppressed')
    assert.equal(msgRecord?.metadata?.suppression_reason, 'handoff')
  })

  // ============================================================================
  // PARTE B: CENÁRIO 7 — Supressão com erro retornado pela RPC (ex: erro de banco)
  // ============================================================================
  test('7. Supressão com erro retornado pela RPC não atualiza mensagem para suppressed e não chama gateway', async () => {
    const eventId = 'evt-suppress-err-7'
    const mockLLM = createMockLLMProvider({ replyContent: 'Tentativa supressão com erro' })
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        if (fnName === 'claim_outbox_message') {
          const res = await baseClient.rpc(fnName, params)
          const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
          conv.status = 'human'
          return res
        }
        if (fnName === 'complete_outbox_message') {
          // Simula erro inesperado no banco de dados
          return { data: null, error: { message: 'Database transaction error in complete_outbox_message' } }
        }
        return baseClient.rpc(fnName, params)
      }
    }

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-7',
      eventId,
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(res.dispatched, false, 'Gateway NUNCA pode ser chamado se a supressão falhar')
    assert.equal(res.reason, 'suppress_failed', 'Deve reportar explicitamente falha na supressão')
    assert.match(res.error, /Database transaction error/i)
    assert.equal(fetchCallCount, 0, 'Zero chamadas ao gateway')

    // Confirma que a mensagem vinculada NÃO foi prematuramente marcada como suppressed
    const msgRecord = inMemoryDb.messages.get(res.replyMessageId)
    assert.notEqual(msgRecord?.metadata?.delivery_status, 'suppressed', 'A mensagem não pode ser marcada como suppressed se a RPC falhou')
    assert.equal(msgRecord?.metadata?.delivery_status, 'pending')
  })

  // ============================================================================
  // PARTE B: CENÁRIO 8 — Supressão com was_completed: false (fencing mismatch)
  // ============================================================================
  test('8. Supressão com was_completed: false rejeitada por conflito de fencing', async () => {
    const eventId = 'evt-suppress-fence-8'
    const mockLLM = createMockLLMProvider({ replyContent: 'Tentativa supressão com conflito fencing' })
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        if (fnName === 'claim_outbox_message') {
          const res = await baseClient.rpc(fnName, params)
          const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
          conv.status = 'human'
          return res
        }
        if (fnName === 'complete_outbox_message') {
          // Simula rejeição por fencing token mismatch (ex: lease expirou e outro worker assumiu)
          return {
            data: [{
              was_completed: false,
              current_status: 'processing',
              error_reason: 'fencing_token_mismatch'
            }],
            error: null
          }
        }
        return baseClient.rpc(fnName, params)
      }
    }

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-8',
      eventId,
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'suppress_failed')
    assert.match(res.error, /fencing_token_mismatch/i)
    assert.equal(fetchCallCount, 0, 'Zero chamadas ao gateway')

    const msgRecord = inMemoryDb.messages.get(res.replyMessageId)
    assert.notEqual(msgRecord?.metadata?.delivery_status, 'suppressed')
  })

  // ============================================================================
  // PARTE B: CENÁRIO 9 — Nenhum envio ao gateway quando a supressão falhar
  // ============================================================================
  test('9. Garantia absoluta: falha de supressão sob qualquer exceção nunca despacha ao gateway', async () => {
    const eventId = 'evt-suppress-safe-9'
    const mockLLM = createMockLLMProvider({ replyContent: 'Teste de segurança gateway' })
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        if (fnName === 'claim_outbox_message') {
          const res = await baseClient.rpc(fnName, params)
          const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
          conv.status = 'human'
          return res
        }
        if (fnName === 'complete_outbox_message') {
          throw new Error('Crash catastrófico na RPC complete_outbox_message')
        }
        return baseClient.rpc(fnName, params)
      }
    }

    // Mesmo com exceção não tratada na RPC, o gateway NUNCA deve ser invocado
    try {
      await handleAutonomousCycle({
        companyId: ACTIVE_COMPANY_A_ID,
        conversationId: CONV_ACTIVE_A_ID,
        messageId: 'msg-inbound-9',
        eventId,
        payload,
        adminClient: proxyClient,
        llmProvider: mockLLM
      })
    } catch (err: any) {
      assert.match(err.message, /Crash catastrófico/i)
    }

    assert.equal(fetchCallCount, 0, 'Em nenhuma hipótese o gateway pode ser acionado após handoff detectado')
  })

  // ============================================================================
  // PARTE B: CENÁRIO 10 — Nenhuma atualização prematura da mensagem para suppressed
  // ============================================================================
  test('10. Nenhuma atualização prematura: messages.metadata.delivery_status permanece pending até confirmação positiva', async () => {
    const eventId = 'evt-no-premature-10'
    const mockLLM = createMockLLMProvider({ replyContent: 'Teste não prematuro' })
    const payload = createValidPayload(ACTIVE_COMPANY_A_ID, eventId)

    let messageStatusDuringRpc = 'unknown'

    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        if (fnName === 'claim_outbox_message') {
          const res = await baseClient.rpc(fnName, params)
          const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
          conv.status = 'human'
          return res
        }
        if (fnName === 'complete_outbox_message') {
          // Inspeciona o status da mensagem DURANTE a execução da RPC
          const msg = Array.from(inMemoryDb.messages.values()).find(m => m.external_id === `agent-reply-${eventId}`)
          messageStatusDuringRpc = msg?.metadata?.delivery_status || 'not_found'
          
          // Rejeita a conclusão
          return { data: [{ was_completed: false, error_reason: 'already_completed' }], error: null }
        }
        return baseClient.rpc(fnName, params)
      }
    }

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-10',
      eventId,
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(messageStatusDuringRpc, 'pending', 'Status da mensagem durante a chamada RPC devia ser pending')
    assert.equal(res.reason, 'suppress_failed')

    const finalMsg = inMemoryDb.messages.get(res.replyMessageId)
    assert.equal(finalMsg?.metadata?.delivery_status, 'pending', 'Status final da mensagem deve permanecer pending após rejeição da RPC')
  })
})
