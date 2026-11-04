// @ts-nocheck
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { runAgentEngine } from '@/lib/services/agent/engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3E — Integração do Controle de Acesso no Agent Engine', () => {
  // IDs de Empresas
  const ACTIVE_COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const ACTIVE_COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'
  const PROVISIONING_COMPANY_ID = '55555555-5555-5555-5555-555555555555'
  const CORRUPTED_COMPANY_ID = '66666666-6666-6666-6666-666666666666'

  // IDs de Conversas
  const CONV_ACTIVE_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_ACTIVE_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_SUSPENDED_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  const CONV_CANCELLED_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
  const CONV_PROVISIONING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  const CONV_CORRUPTED_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

  // IDs de Agentes
  const AGENT_A_ID = 'agent-1111-aaaa'
  const AGENT_B_ID = 'agent-2222-bbbb'
  const AGENT_SUSPENDED_ID = 'agent-3333-cccc'
  const AGENT_CANCELLED_ID = 'agent-4444-dddd'
  const AGENT_PROVISIONING_ID = 'agent-5555-eeee'
  const AGENT_CORRUPTED_ID = 'agent-6666-ffff'

  const SENSITIVE_SUSPENSION_REASON = 'Inadimplência financeira grave referente à fatura INV-2026-9999 no valor de R$ 15.000,00'

  beforeEach(() => {
    resetInMemoryDb()

    // 1. Configurar Empresas
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
      suspension_reason: 'Contrato rescindido amigavelmente',
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
      status: 'status_invalido_ou_legado',
      plan_tier: 'trial',
      suspension_reason: null,
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

    inMemoryDb.agents.set(AGENT_CANCELLED_ID, {
      id: AGENT_CANCELLED_ID,
      company_id: CANCELLED_COMPANY_ID,
      name: 'Agente Delta',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    inMemoryDb.agents.set(AGENT_PROVISIONING_ID, {
      id: AGENT_PROVISIONING_ID,
      company_id: PROVISIONING_COMPANY_ID,
      name: 'Agente Epsilon',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    inMemoryDb.agents.set(AGENT_CORRUPTED_ID, {
      id: AGENT_CORRUPTED_ID,
      company_id: CORRUPTED_COMPANY_ID,
      name: 'Agente Zeta',
      model: 'gpt-4o-mini',
      provider: 'openai',
      is_active: true
    })

    // 3. Configurar Conversas persistidas no servidor
    inMemoryDb.conversations.set(CONV_ACTIVE_A_ID, {
      id: CONV_ACTIVE_A_ID,
      company_id: ACTIVE_COMPANY_A_ID,
      agent_id: AGENT_A_ID,
      status: 'bot',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_B_ID, {
      id: CONV_ACTIVE_B_ID,
      company_id: ACTIVE_COMPANY_B_ID,
      agent_id: AGENT_B_ID,
      status: 'bot',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.conversations.set(CONV_SUSPENDED_ID, {
      id: CONV_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      agent_id: AGENT_SUSPENDED_ID,
      status: 'bot',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.conversations.set(CONV_CANCELLED_ID, {
      id: CONV_CANCELLED_ID,
      company_id: CANCELLED_COMPANY_ID,
      agent_id: AGENT_CANCELLED_ID,
      status: 'bot',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.conversations.set(CONV_PROVISIONING_ID, {
      id: CONV_PROVISIONING_ID,
      company_id: PROVISIONING_COMPANY_ID,
      agent_id: AGENT_PROVISIONING_ID,
      status: 'bot',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })

    inMemoryDb.conversations.set(CONV_CORRUPTED_ID, {
      id: CONV_CORRUPTED_ID,
      company_id: CORRUPTED_COMPANY_ID,
      agent_id: AGENT_CORRUPTED_ID,
      status: 'bot',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  })

  function createMockLLMProvider(options: {
    replyContent?: string
    toolCalls?: any[]
  } = {}) {
    let callCount = 0
    return {
      get callCount() {
        return callCount
      },
      generateResponse: async (request: any) => {
        callCount++
        return {
          content: options.replyContent || 'Olá! Como posso ajudar você hoje?',
          tool_calls: options.toolCalls || null,
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

  // ============================================================================
  // CENÁRIO 1: Empresa ativa continua executando o fluxo normalmente
  // ============================================================================
  test('1. Empresa ativa continua executando o fluxo normalmente', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Atendimento autorizado para Empresa Alpha.' })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Olá, gostaria de saber informações sobre produtos.',
      skipCustomerMessageInsert: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true, 'Execução da empresa ativa deve ter sucesso')
    assert.equal(result.message, 'Atendimento autorizado para Empresa Alpha.')
    assert.equal(mockLLM.callCount, 1, 'LLM deve ter sido invocado exatamente uma vez')
    assert.ok(result.messageId, 'ID da mensagem do agente deve ser retornado')
  })

  // ============================================================================
  // CENÁRIO 2: Empresa suspensa é bloqueada antes da primeira chamada ao LLM
  // ============================================================================
  test('2. Empresa suspensa é bloqueada antes da primeira chamada ao LLM', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Gostaria de comprar 10 unidades.',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false, 'Execução de empresa suspensa deve ser bloqueada')
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.equal(result.statusCode, 403)
    assert.equal(mockLLM.callCount, 0, 'O LLM JAMAIS deve ser invocado para empresa suspensa')
  })

  // ============================================================================
  // CENÁRIO 3: Empresa cancelada é bloqueada antes da primeira chamada ao LLM
  // ============================================================================
  test('3. Empresa cancelada é bloqueada antes da primeira chamada ao LLM', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: CANCELLED_COMPANY_ID,
      agentId: AGENT_CANCELLED_ID,
      conversationId: CONV_CANCELLED_ID,
      userMessage: 'Qual o valor da mensalidade?',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false, 'Execução de empresa cancelada deve ser bloqueada')
    assert.equal(result.code, 'TENANT_CANCELLED')
    assert.equal(result.statusCode, 403)
    assert.equal(mockLLM.callCount, 0, 'O LLM JAMAIS deve ser invocado para empresa cancelada')
  })

  // ============================================================================
  // CENÁRIO 4: Empresa em provisionamento é bloqueada
  // ============================================================================
  test('4. Empresa em provisionamento é bloqueada com TENANT_PROVISIONING', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: PROVISIONING_COMPANY_ID,
      agentId: AGENT_PROVISIONING_ID,
      conversationId: CONV_PROVISIONING_ID,
      userMessage: 'Testando agente antes da liberação oficial.',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false, 'Execução de empresa em provisionamento deve ser bloqueada')
    assert.equal(result.code, 'TENANT_PROVISIONING')
    assert.equal(result.statusCode, 403)
    assert.equal(mockLLM.callCount, 0, 'O LLM não pode ser chamado em fase de implantação')
  })

  // ============================================================================
  // CENÁRIO 5: Falha na consulta de status bloqueia o fluxo (Fail-closed)
  // ============================================================================
  test('5. Falha na consulta de status bloqueia o fluxo com fail-closed incondicional (503)', async () => {
    const mockLLM = createMockLLMProvider()

    // Mock client simulando queda de conexão no banco
    const failingDbClient = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              if (table === 'conversations') {
                return { data: { id: val, company_id: ACTIVE_COMPANY_A_ID }, error: null }
              }
              if (table === 'companies') {
                return {
                  data: null,
                  error: { message: 'Connection to PostgreSQL pool failed (ECONNREFUSED)', code: '08006' }
                }
              }
              return { data: null, error: null }
            }
          })
        })
      })
    }

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Olá!',
      adminClient: failingDbClient,
      llmProvider: mockLLM
    })

    assert.equal(result.success, false, 'Falha no banco deve bloquear a execução')
    assert.equal(result.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(result.statusCode, 503)
    assert.equal(mockLLM.callCount, 0, 'O LLM não pode ser invocado em caso de falha de infraestrutura')
  })

  // ============================================================================
  // CENÁRIO 6: Status desconhecido bloqueia o fluxo
  // ============================================================================
  test('6. Status desconhecido/corrompido no banco bloqueia o fluxo com TENANT_STATUS_UNAVAILABLE (503)', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: CORRUPTED_COMPANY_ID,
      agentId: AGENT_CORRUPTED_ID,
      conversationId: CONV_CORRUPTED_ID,
      userMessage: 'Olá!',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_STATUS_UNAVAILABLE')
    assert.equal(result.statusCode, 503)
    assert.equal(mockLLM.callCount, 0)
  })

  // ============================================================================
  // CENÁRIO 7: Nenhuma ferramenta comercial é executada após o bloqueio
  // ============================================================================
  test('7. Nenhuma ferramenta comercial é executada após o bloqueio de empresa suspensa', async () => {
    let toolExecuted = false
    const mockLLM = createMockLLMProvider({
      toolCalls: [
        {
          callId: 'call-1',
          toolName: 'consultar_preco',
          arguments: { product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }
        }
      ]
    })

    const result = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Qual o preço do Top Gotas?',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.equal(mockLLM.callCount, 0)
    assert.equal(toolExecuted, false, 'Ferramentas comerciais não podem ser executadas')
  })

  // ============================================================================
  // CENÁRIO 8: Nenhum orçamento é criado após o bloqueio
  // ============================================================================
  test('8. Nenhum orçamento é criado após o bloqueio da empresa', async () => {
    const quotesBefore = inMemoryDb.quotes.size

    const mockLLM = createMockLLMProvider({
      toolCalls: [
        {
          callId: 'call-quote',
          toolName: 'gerar_orcamento',
          arguments: { items: [{ product_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', quantity: 5 }] }
        }
      ]
    })

    const result = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Gere um orçamento para 5 itens',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(inMemoryDb.quotes.size, quotesBefore, 'A quantidade de orçamentos deve permanecer inalterada (0 orçamentos criados)')
  })

  // ============================================================================
  // CENÁRIO 9: O motivo interno da suspensão não aparece na resposta pública
  // ============================================================================
  test('9. O motivo interno da suspensão não vaza na resposta pública ou nos detalhes de erro', async () => {
    const mockLLM = createMockLLMProvider()

    const result = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Gostaria de atendimento comercial.',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')

    // Mensagem de erro pública deve ser limpa e padronizada
    assert.equal(result.error, 'Operação comercial bloqueada: acesso da empresa suspenso pela plataforma.')
    assert.equal(result.details, 'Operação comercial bloqueada: acesso da empresa suspenso pela plataforma.')

    // Informações financeiras confidenciais do banco jamais podem aparecer na resposta
    assert.ok(!result.error?.includes('Inadimplência'), 'Não deve conter "Inadimplência"')
    assert.ok(!result.error?.includes('INV-2026-9999'), 'Não deve conter o número da fatura')
    assert.ok(!result.error?.includes('15.000,00'), 'Não deve conter o valor da dívida')

    assert.ok(!result.details?.includes('Inadimplência'))
    assert.ok(!result.details?.includes('INV-2026-9999'))
    assert.ok(!result.details?.includes('15.000,00'))
  })

  // ============================================================================
  // CENÁRIO 10: A empresa A suspensa não bloqueia a empresa B ativa
  // ============================================================================
  test('10. Isolamento multi-tenant: empresa A suspensa não afeta a empresa B ativa', async () => {
    const mockLLMA = createMockLLMProvider()
    const mockLLMB = createMockLLMProvider({ replyContent: 'Empresa B operando 100% normalmente.' })

    // Empresa A (suspensa) é bloqueada
    const resultA = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Olá Empresa A',
      llmProvider: mockLLMA
    })
    assert.equal(resultA.success, false)
    assert.equal(resultA.code, 'TENANT_SUSPENDED')
    assert.equal(mockLLMA.callCount, 0)

    // Empresa B (ativa) responde perfeitamente
    const resultB = await runAgentEngine({
      companyId: ACTIVE_COMPANY_B_ID,
      agentId: AGENT_B_ID,
      conversationId: CONV_ACTIVE_B_ID,
      userMessage: 'Olá Empresa B',
      llmProvider: mockLLMB
    })
    assert.equal(resultB.success, true)
    assert.equal(resultB.message, 'Empresa B operando 100% normalmente.')
    assert.equal(mockLLMB.callCount, 1)
  })

  // ============================================================================
  // CENÁRIO 11: O companyId utilizado corresponde à conversa processada
  // ============================================================================
  test('11. Mismatch de tenant: rejeita companyId que não corresponde à conversa persistida no banco', async () => {
    const mockLLM = createMockLLMProvider()

    // O solicitante tenta usar a conversa da Empresa A (CONV_ACTIVE_A_ID) passando a Empresa B (ACTIVE_COMPANY_B_ID)
    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_B_ID,
      agentId: AGENT_B_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Tentativa de spoofing multi-tenant',
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'INVALID_COMPANY_ID')
    assert.equal(result.statusCode, 400)
    assert.match(result.error, /não pertence à empresa informada/i)
    assert.equal(mockLLM.callCount, 0, 'O LLM não pode ser chamado se houver mismatch de tenant')
  })

  // ============================================================================
  // CENÁRIO 12: O fluxo normal de empresa ativa preserva o comportamento anterior
  // ============================================================================
  test('12. O fluxo normal de empresa ativa preserva a persistência da resposta e atualização de conversa', async () => {
    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta oficial do assistente inteligente.' })

    const result = await runAgentEngine({
      companyId: ACTIVE_COMPANY_A_ID,
      agentId: AGENT_A_ID,
      conversationId: CONV_ACTIVE_A_ID,
      userMessage: 'Mensagem de teste de integridade.',
      skipCustomerMessageInsert: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, true)
    assert.equal(result.message, 'Resposta oficial do assistente inteligente.')

    // Verificar se a conversa foi atualizada
    const updatedConv = inMemoryDb.conversations.get(CONV_ACTIVE_A_ID)
    assert.ok(updatedConv.last_message_at, 'Conversa deve registrar last_message_at')

    // Verificar se as mensagens foram inseridas no banco
    const msgs = Array.from(inMemoryDb.messages.values()).filter(m => m.conversation_id === CONV_ACTIVE_A_ID)
    assert.ok(msgs.length >= 2, 'Deve conter a mensagem do cliente e a resposta do agente')
    assert.ok(msgs.some(m => m.sender_type === 'customer' && m.content === 'Mensagem de teste de integridade.'))
    assert.ok(msgs.some(m => m.sender_type === 'agent' && m.content === 'Resposta oficial do assistente inteligente.'))
  })

  // ============================================================================
  // CENÁRIO 13: Bloqueio impede inserção de mensagem de cliente no banco quando tenant suspenso
  // ============================================================================
  test('13. Bloqueio impede qualquer efeito colateral: mensagem do cliente NÃO é inserida no banco se tenant suspenso', async () => {
    const mockLLM = createMockLLMProvider()

    const initialMsgCount = inMemoryDb.messages.size

    const result = await runAgentEngine({
      companyId: SUSPENDED_COMPANY_ID,
      agentId: AGENT_SUSPENDED_ID,
      conversationId: CONV_SUSPENDED_ID,
      userMessage: 'Mensagem que jamais deve ser inserida.',
      skipCustomerMessageInsert: false,
      llmProvider: mockLLM
    })

    assert.equal(result.success, false)
    assert.equal(result.code, 'TENANT_SUSPENDED')
    assert.equal(inMemoryDb.messages.size, initialMsgCount, 'Nenhuma mensagem de cliente pode ser persistida no banco quando a empresa está suspensa')
  })
})
