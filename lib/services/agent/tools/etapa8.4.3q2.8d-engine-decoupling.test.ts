// @ts-nocheck
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { runAgentEngine } from '@/lib/services/agent/engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3Q.2.8D — Desacoplamento do Agent Engine', () => {
  // IDs de Empresas
  const ACTIVE_COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const ACTIVE_COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'

  // IDs de Conversas
  const CONV_ACTIVE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_ACTIVE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_SUSPENDED_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  // IDs de Agentes
  const AGENT_A_ID = 'agent-1111-aaaa'
  const AGENT_B_ID = 'agent-2222-bbbb'
  const AGENT_SUSPENDED_ID = 'agent-3333-cccc'

  // ID de Produto
  const PROD_TOP_GOTAS_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  beforeEach(() => {
    resetInMemoryDb()

    // 1. Configurar Empresas
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
      plan_tier: 'enterprise',
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

    // 2. Configurar Agentes
    inMemoryDb.agents.set(AGENT_A_ID, {
      id: AGENT_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      name: 'Agente Comercial Alpha',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    inMemoryDb.agents.set(AGENT_B_ID, {
      id: AGENT_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      name: 'Agente Comercial Beta',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    inMemoryDb.agents.set(AGENT_SUSPENDED_ID, {
      id: AGENT_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      name: 'Agente Gamma',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    // 3. Configurar Conversas
    inMemoryDb.conversations.set(CONV_ACTIVE_A_ID, {
      id: CONV_ACTIVE_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      agent_id: AGENT_A_ID,
      status: 'bot',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      last_message_at: '2026-11-01T10:00:00.000Z'
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_B_ID, {
      id: CONV_ACTIVE_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      agent_id: AGENT_B_ID,
      status: 'bot',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      last_message_at: '2026-11-01T10:00:00.000Z'
    })

    inMemoryDb.conversations.set(CONV_SUSPENDED_ID, {
      id: CONV_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      agent_id: AGENT_SUSPENDED_ID,
      status: 'bot',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-01T10:00:00.000Z',
      last_message_at: '2026-11-01T10:00:00.000Z'
    })

    // 4. Configurar Produto para testes de ferramentas
    inMemoryDb.products.set(PROD_TOP_GOTAS_ID, {
      id: PROD_TOP_GOTAS_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      name: 'Top Gotas Blend 1kg',
      normalized_name: 'top gotas blend 1kg',
      unit: 'kg',
      active: true,
      product_brands: { name: 'Harald' },
      product_categories: { name: 'Cobertura' }
    })
  })

  function createMockLLMProvider(options: {
    replyContent?: string
    toolCalls?: any[]
    rounds?: Array<{ replyContent?: string; toolCalls?: any[] }>
  } = {}) {
    let callCount = 0
    return {
      get callCount() {
        return callCount
      },
      generateResponse: async (_request: any) => {
        const currentRound = options.rounds ? options.rounds[callCount] : options
        callCount++
        return {
          content: currentRound?.replyContent || 'Olá! Como posso ajudar você hoje?',
          tool_calls: currentRound?.toolCalls || null,
          usage: {
            prompt_tokens: 120,
            completion_tokens: 40,
            total_tokens: 160,
            cached_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
            tool_use_tokens: 0
          }
        }
      }
    }
  }

  // ============================================================================
  // CENÁRIO 1: Com persistMessage omitido, o comportamento atual permanece
  // ============================================================================
  test('1. Com persistMessage omitido, o comportamento legado permanece (persiste em messages e atualiza conversa)', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta com persistMessage padrão omitido.' })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Olá assistente',
      skipCustomerMessageInsert: true,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true, 'Execução deve ter sucesso')
    assert.equal(result.message, 'Resposta com persistMessage padrão omitido.')
    assert.ok(result.messageId, 'messageId deve ser retornado quando persistMessage é omitido')
    assert.equal(typeof result.messageId, 'string')

    // Confirma que foi persistido na tabela messages com sender_type 'agent'
    const persistedAgentMsg = inMemoryDb.messages.get(result.messageId)
    assert.ok(persistedAgentMsg, 'Mensagem deve existir na base de dados em memória')
    assert.equal(persistedAgentMsg.sender_type, 'agent')
    assert.equal(persistedAgentMsg.content, 'Resposta com persistMessage padrão omitido.')
    assert.equal(persistedAgentMsg.company_id, ACTIVE_COMPANY_A_ID)

    // Confirma que a conversa foi atualizada
    const conv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
    assert.notEqual(conv.last_message_at, '2026-11-01T10:00:00.000Z', 'last_message_at deve ter sido atualizado')
  })

  // ============================================================================
  // CENÁRIO 2: Com persistMessage: true, a persistência continua funcionando
  // ============================================================================
  test('2. Com persistMessage: true, a persistência continua funcionando normalmente', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta com persistMessage explicitamente true.' })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Olá novamente',
      skipCustomerMessageInsert: true,
      persistMessage: true,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(result.message, 'Resposta com persistMessage explicitamente true.')
    assert.ok(result.messageId, 'messageId deve ser preenchido quando persistMessage: true')

    const persistedAgentMsg = inMemoryDb.messages.get(result.messageId)
    assert.ok(persistedAgentMsg)
    assert.equal(persistedAgentMsg.sender_type, 'agent')
    assert.equal(persistedAgentMsg.content, 'Resposta com persistMessage explicitamente true.')
  })

  // ============================================================================
  // CENÁRIO 3: Com persistMessage: false, nenhuma inserção outbound ocorre
  // ============================================================================
  test('3. Com persistMessage: false, nenhuma inserção outbound ocorre e a conversa não é alterada', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta desacoplada do storage.' })

    const agentMsgsBefore = Array.from(inMemoryDb.messages.values()).filter(m => m.sender_type === 'agent').length
    const convBefore = { ...inMemoryDb.conversations.get(CONV_ACTIVE_A_ID) }

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Olá motor',
      skipCustomerMessageInsert: true,
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(result.messageId, undefined, 'messageId deve ser undefined quando persistMessage: false')

    // Confirma que nenhuma mensagem de agente foi gravada
    const agentMsgsAfter = Array.from(inMemoryDb.messages.values()).filter(m => m.sender_type === 'agent').length
    assert.equal(agentMsgsAfter, agentMsgsBefore, 'Nenhuma mensagem de agente pode ser inserida em messages')

    // Confirma que o ponteiro temporal da conversa não foi alterado
    const convAfter = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
    assert.equal(convAfter.last_message_at, convBefore.last_message_at, 'last_message_at da conversa deve permanecer inalterado')
  })

  // ============================================================================
  // CENÁRIO 4: A resposta gerada continua disponível no retorno com persistMessage: false
  // ============================================================================
  test('4. Com persistMessage: false, a resposta textual gerada continua íntegra no retorno', async () => {
    const expectedText = 'Temos o produto Top Gotas Blend 1kg por R$ 38,50 com pronta entrega.'
    const mockLLM = createMockLLMProvider({ replyContent: expectedText })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Qual o valor do Top Gotas?',
      skipCustomerMessageInsert: true,
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(result.message, expectedText, 'O texto completo da resposta deve estar presente no resultado')
    assert.ok(result.usage, 'Métricas de uso de tokens devem ser retornadas')
    assert.ok(result.usage.total_tokens > 0, 'total_tokens deve ser maior que zero')
    assert.equal(result.agentId, AGENT_A_ID)
    assert.equal(result.conversationId, CONV_ACTIVE_A_ID)
  })

  // ============================================================================
  // CENÁRIO 5: A working memory é preservada e retornada com persistMessage: false
  // ============================================================================
  test('5. Com persistMessage: false, a working memory e os metadados são retornados para futura persistência', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Informações processadas.' })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Olá',
      skipCustomerMessageInsert: true,
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.ok(result.workingMemory !== undefined, 'workingMemory deve ser retornada no contrato')
    assert.equal(typeof result.workingMemory, 'object')
    assert.equal(result.agentId, AGENT_A_ID)
    assert.equal(result.conversationId, CONV_ACTIVE_A_ID)
  })

  // ============================================================================
  // CENÁRIO 6: Ferramentas comerciais continuam funcionando com persistMessage: false
  // ============================================================================
  test('6. Ferramentas comerciais executam normalmente e populam a working memory sem persistir mensagem', async () => {
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
          replyContent: 'Encontrei o produto Top Gotas Blend 1kg no catálogo!'
        }
      ]
    })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Procure Top Gotas',
      skipCustomerMessageInsert: true,
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(result.message, 'Encontrei o produto Top Gotas Blend 1kg no catálogo!')
    assert.equal(mockLLM.callCount, 2, 'LLM deve ter executado 2 rounds (tool call + final text)')
    assert.equal(result.messageId, undefined, 'Não deve persistir a mensagem outbound')

    // Verifica que a working memory capturou o produto via ferramenta comercial
    assert.ok(result.workingMemory?.activeProduct, 'activeProduct deve ter sido populado pela ferramenta comercial')
    assert.equal(result.workingMemory.activeProduct.id, PROD_TOP_GOTAS_ID)
    assert.equal(result.workingMemory.activeProduct.name, 'Top Gotas Blend 1kg')

    // Confirma que os metadados contêm a working memory
    assert.ok(result.metadata?.working_memory, 'metadata deve conter working_memory estruturada')
    assert.equal(result.metadata.working_memory.activeProduct.id, PROD_TOP_GOTAS_ID)

    // Garante que o banco continua sem novas mensagens de saída
    const agentMsgs = Array.from(inMemoryDb.messages.values()).filter(m => m.sender_type === 'agent')
    assert.equal(agentMsgs.length, 0, 'Zero mensagens de saída persistidas no banco')
  })

  // ============================================================================
  // CENÁRIO 7: Falhas de execução continuam sendo tratadas corretamente
  // ============================================================================
  test('7. Falhas de execução (conversa inexistente) são tratadas com erro controlado', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: '00000000-0000-0000-0000-000000000404',
      userMessage: 'Olá',
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_NOT_FOUND')
    assert.equal(result.statusCode, 404)
    assert.equal(mockLLM.callCount, 0, 'LLM não pode ser chamado se a conversa não existir')
  })

  // ============================================================================
  // CENÁRIO 8: Conversa de outro tenant continua bloqueada com persistMessage: false
  // ============================================================================
  test('8. Isolamento multi-tenant: conversa de outro tenant é bloqueada mesmo com persistMessage: false', async () => {
    const mockLLM = createMockLLMProvider()

    // Tenant B tenta acessar a conversa do Tenant A
    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_B_ID,
      agentId: AGENT_B_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Tentativa de cross-tenant spoofing',
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'INVALID_COMPANY_ID')
    assert.equal(result.statusCode, 400)
    assert.match(result.error, /não pertence à empresa informada/i)
    assert.equal(mockLLM.callCount, 0, 'LLM não deve ser invocado em violação de segurança multi-tenant')
  })

  // ============================================================================
  // CENÁRIO 9: Empresa suspensa continua bloqueada com persistMessage: false
  // ============================================================================
  test('9. Empresa suspensa é bloqueada fail-closed antes do LLM mesmo com persistMessage: false', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Gostaria de atendimento',
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.equal(result.statusCode, 403)
    assert.equal(mockLLM.callCount, 0, 'LLM JAMAIS deve ser invocado para empresa suspensa')
  })

  // ============================================================================
  // CENÁRIO 10: Nenhum envio externo ou criação de outbox é disparado
  // ============================================================================
  test('10. Nenhum envio externo ou inserção na message_outbox ocorre durante a execução desacoplada', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta gerada para outbox futura.' })

    const outboxCountBefore = inMemoryDb.message_outbox.size

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Preparar mensagem sem envio',
      skipCustomerMessageInsert: true,
      persistMessage: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(result.messageId, undefined)
    assert.equal(inMemoryDb.message_outbox.size, outboxCountBefore, 'A tabela message_outbox deve permanecer estritamente intocada')
  })
})
