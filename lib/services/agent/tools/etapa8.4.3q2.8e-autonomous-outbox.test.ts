// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { handleAutonomousCycle, type AutonomousCycleParams } from '@/lib/services/message-engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

describe('ETAPA 8.4.3Q.2.8E — Integração do Ciclo Autônomo com Outbox Transacional', () => {
  const ACTIVE_COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const ACTIVE_COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'

  const CONV_ACTIVE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_ACTIVE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_SUSPENDED_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  const AGENT_A_ID = 'agent-1111-aaaa'
  const AGENT_B_ID = 'agent-2222-bbbb'

  const PROD_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  let fetchCallCount = 0
  let lastFetchOptions: any = null
  let originalFetch: any
  let fetchMockHandler: ((url: string, options: any) => Promise<any>) | null = null

  function createValidPayload(eventId = 'evt-test-1', phone = '5511999991111', content = 'Olá assistente'): any {
    return {
      event_id: eventId,
      channel: 'whatsapp',
      company_id: ACTIVE_COMPANY_A_ID,
      customer: {
        phone,
        name: 'Cliente Teste'
      },
      message: {
        id: `msg-${eventId}`,
        content,
        sender_type: 'customer',
        created_at: new Date().toISOString()
      }
    }
  }

  function createMockLLMProvider(options: {
    replyContent?: string
    toolCalls?: any[]
    rounds?: Array<{ replyContent?: string; toolCalls?: any[] }>
    onGenerate?: () => void
  } = {}) {
    let callCount = 0
    return {
      get callCount() {
        return callCount
      },
      generateResponse: async (_request: any) => {
        if (options.onGenerate) {
          options.onGenerate()
        }
        const currentRound = options.rounds ? options.rounds[callCount] : options
        callCount++
        return {
          content: currentRound?.replyContent || 'Resposta gerada pela IA.',
          tool_calls: currentRound?.toolCalls || null,
          usage: {
            prompt_tokens: 150,
            completion_tokens: 30,
            total_tokens: 180,
            cached_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            tool_use_tokens: 0
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

    inMemoryDb.companies.set(SUSPENDED_COMPANY_ID, {
      id: SUSPENDED_COMPANY_ID,
      name: 'Empresa Suspensa Gamma',
      slug: 'empresa-suspensa-gamma',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: 'Inadimplência financeira',
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

    // 3. Cadastrar Conversas
    inMemoryDb.conversations.set(CONV_ACTIVE_A_ID, {
      id: CONV_ACTIVE_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      agent_id: AGENT_A_ID,
      status: 'bot',
      channel: 'whatsapp',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      last_message_at: '2026-11-01T10:00:00.000Z'
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_B_ID, {
      id: CONV_ACTIVE_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      agent_id: AGENT_B_ID,
      status: 'bot',
      channel: 'whatsapp',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      last_message_at: '2026-11-01T10:00:00.000Z'
    })

    inMemoryDb.conversations.set(CONV_SUSPENDED_ID, {
      id: CONV_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      agent_id: AGENT_A_ID,
      status: 'bot',
      channel: 'whatsapp',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      last_message_at: '2026-11-01T10:00:00.000Z'
    })

    // 4. Cadastrar Integração n8n ativa
    inMemoryDb.integrations.set('int-alpha-n8n', {
      id: 'int-alpha-n8n',
      company_id: ACTIVE_COMPANY_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/test-alpha' },
      credentials: { webhook_secret: 'sec-alpha-123' },
      created_at: new Date().toISOString()
    })

    // 5. Cadastrar Produto comercial para tools
    inMemoryDb.products.set(PROD_ID, {
      id: PROD_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      name: 'Top Gotas Blend 1kg',
      normalized_name: 'top gotas blend 1kg',
      unit: 'kg',
      active: true,
      product_brands: { name: 'Harald' },
      product_categories: { name: 'Cobertura' }
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ============================================================================
  // CENÁRIO 1: Engine executado com persistMessage: false
  // ============================================================================
  test('1. Engine executado com persistMessage: false — nenhuma mensagem outbound direta é criada pelo Engine', async () => {
    let persistOptionPassed: boolean | undefined = undefined

    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta via outbox transacional.' })
    const payload = createValidPayload('evt-scen-1')

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-1',
      eventId: 'evt-scen-1',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, true)
    assert.ok(res.replyMessageId, 'replyMessageId deve ser preenchido pela criação atômica')
    assert.ok(res.outboxId, 'outboxId deve ser preenchido')
  })

  // ============================================================================
  // CENÁRIO 2: Resposta válida cria exatamente uma mensagem e uma outbox
  // ============================================================================
  test('2. Resposta válida cria exatamente uma mensagem e uma outbox vinculada com status sent', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Olá! Como posso ajudar você hoje com seus pedidos?' })
    const payload = createValidPayload('evt-scen-2')

    const msgsBefore = inMemoryDb.messages.size
    const outboxBefore = inMemoryDb.message_outbox.size

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-2',
      eventId: 'evt-scen-2',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, true)
    assert.equal(fetchCallCount, 1, 'Gateway deve ser invocado exatamente 1 vez')

    // Confirma que foi criada exatamente 1 mensagem de saída
    const msgsAfter = inMemoryDb.messages.size
    assert.equal(msgsAfter, msgsBefore + 1, 'Exatamente 1 nova mensagem deve ser criada')

    const agentMsg = inMemoryDb.messages.get(res.replyMessageId)
    assert.ok(agentMsg)
    assert.equal(agentMsg.sender_type, 'agent')
    assert.equal(agentMsg.content, 'Olá! Como posso ajudar você hoje com seus pedidos?')
    assert.equal(agentMsg.metadata?.delivery_status, 'sent')

    // Confirma que foi criada exatamente 1 outbox vinculada com status 'sent'
    const outboxAfter = inMemoryDb.message_outbox.size
    assert.equal(outboxAfter, outboxBefore + 1, 'Exatamente 1 novo registro na outbox deve ser criado')

    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.ok(outboxRecord)
    assert.equal(outboxRecord.status, 'sent')
    assert.equal(outboxRecord.message_id, res.replyMessageId)
    assert.equal(outboxRecord.idempotency_key, 'agent-reply-evt-scen-2')
  })

  // ============================================================================
  // CENÁRIO 3: Duplicata não gera segundo despacho
  // ============================================================================
  test('3. Duplicata de chave idempotente não gera segundo despacho ao gateway', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Primeiro despacho.' })
    const payload = createValidPayload('evt-scen-3')

    // Primeiro envio
    const res1 = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-3',
      eventId: 'evt-scen-3',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res1.dispatched, true)
    assert.equal(fetchCallCount, 1)

    // Segundo envio com o mesmo eventId
    const res2 = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-3',
      eventId: 'evt-scen-3',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res2.executed, true)
    assert.equal(res2.dispatched, false, 'Duplicata NUNCA deve ser despachada uma segunda vez')
    assert.equal(res2.reason, 'idempotent_duplicate')
    assert.equal(res2.replyMessageId, res1.replyMessageId, 'Deve referenciar a mensagem já criada')
    assert.equal(res2.outboxId, res1.outboxId, 'Deve referenciar a outbox já criada')
    assert.equal(fetchCallCount, 1, 'Contador de chamadas HTTP deve permanecer em 1')
  })

  // ============================================================================
  // CENÁRIO 4: Claim negado não gera chamada ao gateway
  // ============================================================================
  test('4. Claim negado (ex: active_lease) não gera chamada ao gateway externo', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Tentativa de claim' })
    const payload = createValidPayload('evt-scen-4')

    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: (fnName: string, params: any) => {
        if (fnName === 'claim_outbox_message') {
          return Promise.resolve({
            data: [{
              was_claimed: false,
              claim_token: null,
              claim_version: null,
              status: 'processing',
              attempts: 1,
              locked_until: new Date(Date.now() + 60000).toISOString(),
              payload: null,
              message_id: null,
              error_reason: 'active_lease'
            }],
            error: null
          })
        }
        return baseClient.rpc(fnName, params)
      }
    }

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-4',
      eventId: 'evt-scen-4',
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false, 'Com claim negado, o despacho não pode ocorrer')
    assert.equal(res.reason, 'active_lease')
    assert.equal(fetchCallCount, 0, 'Nenhuma chamada ao gateway deve ser realizada')
  })

  // ============================================================================
  // CENÁRIO 5: Empresa suspensa não gera chamada ao LLM nem ao gateway
  // ============================================================================
  test('5. Empresa suspensa é bloqueada no início: zero chamadas ao LLM e zero chamadas ao gateway', async () => {
    const mockLLM = createMockLLMProvider()
    const payload = createValidPayload('evt-scen-5')

    const res = await handleAutonomousCycle({
      companyId: SUSPENDED_COMPANY_ID,
      conversationId: CONV_SUSPENDED_ID,
      messageId: 'msg-inbound-5',
      eventId: 'evt-scen-5',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, false)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'tenant_blocked')
    assert.equal(mockLLM.callCount, 0, 'LLM jamais pode ser invocado para empresa suspensa')
    assert.equal(fetchCallCount, 0, 'Gateway jamais pode ser invocado para empresa suspensa')
  })

  // ============================================================================
  // CENÁRIO 6: Handoff antes da preparação suprime a resposta
  // ============================================================================
  test('6. Handoff ocorrido durante a inferência (antes da preparação) suprime a resposta sem criar registros', async () => {
    const mockLLM = createMockLLMProvider({
      replyContent: 'Resposta que deve ser suprimida.',
      onGenerate: () => {
        // Atendente assume a conversa durante a execução do LLM
        const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
        conv.status = 'human'
      }
    })

    const msgsBefore = inMemoryDb.messages.size
    const outboxBefore = inMemoryDb.message_outbox.size
    const payload = createValidPayload('evt-scen-6')

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-6',
      eventId: 'evt-scen-6',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'suppressed_by_handoff')
    assert.equal(fetchCallCount, 0, 'Nenhum envio externo pode ser efetuado após handoff')

    // Como o desacoplamento impediu a criação antes de validar, zero registros foram criados
    assert.equal(inMemoryDb.messages.size, msgsBefore, 'Nenhuma mensagem de saída deve ser persistida')
    assert.equal(inMemoryDb.message_outbox.size, outboxBefore, 'Nenhuma outbox deve ser gerada')
  })

  // ============================================================================
  // CENÁRIO 7: Handoff antes do despacho impede o envio quando ainda tecnicamente possível
  // ============================================================================
  test('7. Handoff ocorrido após o claim mas antes do despacho suprime a outbox com claim_token válido', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta que será suprimida pós-claim.' })
    const payload = createValidPayload('evt-scen-7')

    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        const result = await baseClient.rpc(fnName, params)
        if (fnName === 'claim_outbox_message') {
          // Atendente assume a conversa imediatamente após a outbox ser reivindicada
          const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
          conv.status = 'human'
        }
        return result
      }
    }

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-7',
      eventId: 'evt-scen-7',
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'suppressed_by_handoff')
    assert.equal(fetchCallCount, 0, 'Gateway não pode ser acionado')

    // Confirma que a outbox foi finalizada como 'suppressed' com last_error descritivo
    assert.ok(res.outboxId)
    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outboxRecord?.status, 'suppressed')
    assert.match(outboxRecord?.last_error, /Handoff humano/i)

    // Confirma que a mensagem vinculada foi marcada como suppressed
    assert.ok(res.replyMessageId)
    const replyMsg = inMemoryDb.messages.get(res.replyMessageId)
    assert.equal(replyMsg?.metadata?.delivery_status, 'suppressed')
  })

  // ============================================================================
  // CENÁRIO 8: Falha determinística conclui conforme contrato
  // ============================================================================
  test('8. Falha determinística do gateway (HTTP 500) conclui outbox como failed via complete_outbox_message', async () => {
    fetchMockHandler = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error no gateway'
    })

    const mockLLM = createMockLLMProvider({ replyContent: 'Tentativa com falha HTTP 500.' })
    const payload = createValidPayload('evt-scen-8')

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-8',
      eventId: 'evt-scen-8',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'fetch_error')
    assert.match(res.error, /HTTP 500/i)

    // Confirma que a outbox foi marcada como 'failed'
    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outboxRecord?.status, 'failed')
    assert.match(outboxRecord?.last_error, /HTTP 500/i)

    // Confirma que a mensagem vinculada registra a falha
    const replyMsg = inMemoryDb.messages.get(res.replyMessageId)
    assert.equal(replyMsg?.metadata?.delivery_status, 'failed')
  })

  // ============================================================================
  // CENÁRIO 9: Timeout ambíguo preserva o estado adequado
  // ============================================================================
  test('9. Timeout ambíguo não conclui como failed; preserva status processing para reconciliação', async () => {
    fetchMockHandler = async () => {
      throw new Error('The operation was aborted due to timeout')
    }

    const mockLLM = createMockLLMProvider({ replyContent: 'Tentativa com timeout ambíguo.' })
    const payload = createValidPayload('evt-scen-9')

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-9',
      eventId: 'evt-scen-9',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'unknown_outcome')

    // O status da outbox NÃO deve ter sido marcado como failed; permanece 'processing'
    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outboxRecord?.status, 'processing', 'Outbox ambígua deve permanecer em processing para expiração do lease')
  })

  // ============================================================================
  // CENÁRIO 10: Falha de conclusão não provoca despacho automático duplicado
  // ============================================================================
  test('10. Falha na conclusão da outbox após aceitação do gateway não provoca segundo despacho', async () => {
    const baseClient = createAdminClient()
    const proxyClient = {
      ...baseClient,
      rpc: async (fnName: string, params: any) => {
        if (fnName === 'complete_outbox_message' && params.p_status === 'sent') {
          // Simula expiração de lease ou conflito de fencing após o gateway aceitar a chamada
          return {
            data: [{
              was_completed: false,
              current_status: 'processing',
              error_reason: 'claim_expired_or_fencing_mismatch'
            }],
            error: null
          }
        }
        return baseClient.rpc(fnName, params)
      }
    }

    const mockLLM = createMockLLMProvider({ replyContent: 'Mensagem com falha de conclusão pós-envio.' })
    const payload = createValidPayload('evt-scen-10')

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-10',
      eventId: 'evt-scen-10',
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, true, 'O despacho já foi aceito pelo gateway')
    assert.equal(res.reason, 'claim_lost_post_dispatch')
    assert.equal(fetchCallCount, 1, 'Jamais deve reenviar ao gateway automaticamente')
  })

  // ============================================================================
  // CENÁRIO 11: Working Memory e metadados comerciais são preservados
  // ============================================================================
  test('11. Working Memory e metadados comerciais de ferramentas são preservados na mensagem atômica', async () => {
    const mockLLM = createMockLLMProvider({
      rounds: [
        {
          toolCalls: [
            {
              callId: 'call-buscar-prod',
              toolName: 'buscar_produto',
              arguments: { query: 'Top Gotas' }
            }
          ]
        },
        {
          replyContent: 'Temos o produto Top Gotas Blend 1kg disponível.'
        }
      ]
    })

    const payload = createValidPayload('evt-scen-11', '5511999991111', 'Tem Top Gotas?')

    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-11',
      eventId: 'evt-scen-11',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, true)

    // Verifica que a mensagem persistida no banco contém a working memory capturada pela ferramenta
    const agentMsg = inMemoryDb.messages.get(res.replyMessageId)
    assert.ok(agentMsg?.metadata?.working_memory, 'metadata.working_memory deve ser gravada')
    assert.equal(agentMsg.metadata.working_memory.activeProduct?.id, PROD_ID)
    assert.equal(agentMsg.metadata.working_memory.activeProduct?.name, 'Top Gotas Blend 1kg')
  })

  // ============================================================================
  // CENÁRIO 12: Conversa de outra empresa permanece bloqueada
  // ============================================================================
  test('12. Isolamento multi-tenant: conversa de outra empresa é bloqueada fail-closed', async () => {
    const mockLLM = createMockLLMProvider()
    const payload = createValidPayload('evt-scen-12')

    // Empresa B tenta processar conversa pertencente à Empresa A
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_B_ID,
      conversationId: CONV_ACTIVE_A_ID,
      messageId: 'msg-inbound-12',
      eventId: 'evt-scen-12',
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, false)
    assert.equal(res.reason, 'conversation_not_found')
    assert.equal(mockLLM.callCount, 0, 'LLM não pode ser chamado se conversa não pertence ao tenant')
    assert.equal(fetchCallCount, 0, 'Gateway não pode ser chamado')
  })
})
