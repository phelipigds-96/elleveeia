import { createAdminClient } from '@/lib/supabase/service'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'
import { buildAgentContext } from './context-builder'
import { getLLMProvider } from '../llm/factory'
import type { LLMProviderType, LLMRequestMessage, LLMProvider } from '../llm/types'
import { ToolRegistry, ToolExecutor } from './tools'
import { getCurrentDatetimeTool } from './tools/get-current-datetime'
import { buscarProdutoTool } from './tools/buscar-produto'
import { consultarPrecoTool } from './tools/consultar-preco'
import { calcularPrecoProdutoTool } from './tools/calcular-preco'
import { gerarOrcamentoTool } from './tools/gerar-orcamento'
import { consultarOrcamentoTool } from './tools/consultar-orcamento'
import { consultarProdutoComercialTool } from './tools/consultar-produto-comercial'
import { resolveToolScope, hasClearProductIntent } from './tool-scoping'
import { applyWorkingMemoryUpdate } from './working-memory'

const MAX_TOOL_ITERATIONS = 5

export interface AgentRunParams {
  companyId: string
  agentId: string
  conversationId: string
  userMessage?: string
  skipCustomerMessageInsert?: boolean
  adminClient?: any
  llmProvider?: LLMProvider
  persistMessage?: boolean
}

export interface AgentRunResult {
  success: boolean
  message?: string
  messageId?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  workingMemory?: any
  agentId?: string
  conversationId?: string
  metadata?: Record<string, any> | null
  code?: string
  statusCode?: number
  error?: string
  details?: string | null
}

/**
 * Constrói resposta segura quando o loop de ferramentas encerra sem texto final do LLM
 * ou quando o teto de iterações é atingido. Evita alucinações e não confirma operações incompletas.
 */
export function buildSafeIterationLimitResponse(allToolResults: any[]): string {
  const failedResults = allToolResults.filter(r => !r.success)
  if (failedResults.length > 0) {
    const lastError = failedResults[failedResults.length - 1]?.error?.message || 'instabilidade no processamento'
    return `Não foi possível concluir a operação solicitada: ${lastError}. Deseja tentar novamente ou falar com um atendente?`
  }

  const lastSuccessful = allToolResults.filter(r => r.success).pop()
  if (lastSuccessful?.toolName === 'gerar_orcamento' && lastSuccessful.data?.id) {
    const totalStr = typeof lastSuccessful.data.total === 'number' ? ` no valor total de R$ ${lastSuccessful.data.total.toFixed(2)}` : ''
    return `Seu orçamento foi gerado com sucesso (ID: ${lastSuccessful.data.id})${totalStr}. Deseja mais alguma informação ou falar com um atendente?`
  }

  return 'Consultei nosso sistema para atender sua solicitação, mas não consegui concluir a resposta automaticamente. Gostaria de falar com nossa equipe de atendimento?'
}

/**
 * Higieniza metadados para telemetria, garantindo que nenhum token, senha,
 * chave de API ou segredo seja gravado no banco de logs.
 */
export function sanitizeLogMetadata(metadata: any): any {
  if (!metadata || typeof metadata !== 'object') return metadata
  if (Array.isArray(metadata)) {
    return metadata.map(item => sanitizeLogMetadata(item))
  }

  const sanitized: Record<string, any> = {}
  const sensitiveKeys = ['token', 'password', 'secret', 'key', 'authorization', 'bearer', 'apikey', 'api_key', 'credential', 'credenciais']

  for (const [key, val] of Object.entries(metadata)) {
    const isSensitive = sensitiveKeys.some(s => key.toLowerCase().includes(s))
    if (isSensitive) {
      sanitized[key] = '[REDACTED]'
    } else if (val && typeof val === 'object') {
      sanitized[key] = sanitizeLogMetadata(val)
    } else {
      sanitized[key] = val
    }
  }

  return sanitized
}

export async function runAgentEngine({ 
  companyId, 
  agentId, 
  conversationId, 
  userMessage,
  skipCustomerMessageInsert = false,
  adminClient,
  llmProvider,
  persistMessage = true
}: AgentRunParams): Promise<AgentRunResult> {
  const supabase = adminClient || createAdminClient()
  const startTime = Date.now()

  let runStatus = 'processing'
  let runErrorMessage: string | null = null
  let usageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let modelUsed = 'unknown'
  let providerUsed: LLMProviderType = 'openai'
  let scopedTools: any[] = []
  const executedTools: Array<{name: string, success: boolean}> = []

  // Rastreabilidade estrita e determinística da Memória de Trabalho (Sem LLM)
  const allToolResults: any[] = []
  let fallbackTriggered = false

  try {
    // 1. Validação estrita de associação e integridade da conversa no servidor:
    // Garante que a conversa existe e que seu company_id corresponde exatamente ao tenant informado
    const convQueryBuilder = (supabase as any).from('conversations').select('id, company_id').eq('id', conversationId)
    const { data: convRecord, error: convLookupError } = await (
      typeof convQueryBuilder?.eq === 'function'
        ? (supabase as any).from('conversations').select('id, company_id').eq('id', conversationId).eq('company_id', companyId).maybeSingle()
        : convQueryBuilder.maybeSingle()
    )

    if (convLookupError) {
      throw new TenantAccessError(
        'Falha de infraestrutura ao validar a conversa.',
        'TENANT_STATUS_UNAVAILABLE',
        503,
        companyId
      )
    }

    if (!convRecord) {
      // Verifica se a conversa pertence a outro tenant para diagnosticar mismatch de tenant
      const { data: crossTenantRecord } = await supabase
        .from('conversations')
        .select('id, company_id')
        .eq('id', conversationId)
        .maybeSingle()

      if (crossTenantRecord && crossTenantRecord.company_id !== companyId) {
        throw new TenantAccessError(
          `Violação de segurança multi-tenant: a conversa '${conversationId}' não pertence à empresa informada.`,
          'INVALID_COMPANY_ID',
          400,
          companyId
        )
      }

      throw new TenantAccessError(
        `Conversa '${conversationId}' não encontrada.`,
        'TENANT_NOT_FOUND',
        404,
        companyId
      )
    }

    // 2. Controle de acesso operacional do tenant (Fail-closed incondicional):
    // Bloqueia empresas em implantação (provisioning), suspensas, canceladas ou com status indisponível.
    // Executado rigorosamente antes de inserir mensagens, chamar LLM ou executar ferramentas comerciais.
    await requireActiveCompany(companyId, { adminClient: supabase })

    // 3. Inserção controlada da mensagem do cliente (apenas após o tenant ser validado como ativo)
    if (userMessage && !skipCustomerMessageInsert) {
      const { error: msgErr } = await supabase.from('messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'customer',
        content: userMessage,
        message_type: 'text'
      })
      if (msgErr) throw new Error(`Falha ao inserir mensagem do usuário: ${msgErr.message}`)
    }

    // 4. Carregamento do contexto operacional do agente (histórico, Working Memory, etc.)
    const { agent, conversation, payloadMessages, workingMemory: previousWorkingMemory, contextMetrics } = await buildAgentContext({
      companyId,
      agentId,
      conversationId
    })

    modelUsed = agent.model
    providerUsed = (agent.provider || 'openai') as LLMProviderType
    const provider: LLMProvider = llmProvider || getLLMProvider(providerUsed)

    // Configurar Registry e Executor com as ferramentas comerciais oficiais
    const registry = new ToolRegistry()
    registry.register(getCurrentDatetimeTool) 
    registry.register(buscarProdutoTool)
    registry.register(consultarPrecoTool)
    registry.register(calcularPrecoProdutoTool)
    registry.register(gerarOrcamentoTool)
    registry.register(consultarOrcamentoTool)
    registry.register(consultarProdutoComercialTool)
    
    const executor = new ToolExecutor(registry)
    
    // 1. Tool Scoping: Resolvemos as tools ideais baseado na msg, historico limpo e Working Memory atual
    const historyForScoping = payloadMessages.filter(m => m.role === 'user' || m.role === 'assistant')
    scopedTools = resolveToolScope(userMessage, historyForScoping, registry.list(), previousWorkingMemory)
    const availableTools = registry.getProviderPayload(scopedTools)

    let messagesForLLM: LLMRequestMessage[] = payloadMessages.map(msg => ({
      role: msg.role === 'function' || msg.role === 'tool' ? 'user' : msg.role,
      content: msg.content || ''
    }))

    let iteration = 0
    let llm_rounds: any[] = []
    let finalContent: string | null = null
    let debug_tool_loop: any[] = []

    // Memória de trabalho viva para propagação dinâmica entre iterações do mesmo turno
    let currentWorkingMemory: any = previousWorkingMemory ? { ...previousWorkingMemory } : {}

    // LLM Loop para Function Calling (com teto de segurança MAX_TOOL_ITERATIONS)
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++

      const roundStartTime = Date.now()

      const response = await provider.generateResponse({
        model: modelUsed,
        messages: messagesForLLM,
        temperature: 0.7,
        tools: availableTools
      })

      // Acumula métricas de uso de tokens
      usageMetrics.prompt_tokens += response.usage.prompt_tokens
      usageMetrics.completion_tokens += response.usage.completion_tokens
      usageMetrics.total_tokens += response.usage.total_tokens

      // Fallback Determinístico de Catálogo (Zero-Shot)
      // Se no primeiro turno o LLM ignorou uma ferramenta de catálogo disponível e tentou gerar apenas texto,
      // forçamos a chamada da ferramenta injetando-a na resposta do LLM ANTES de processar,
      // DESDE QUE a mensagem tenha intenção explícita de produto/preço (não institucional, não encerramento).
      if (
        iteration === 1 && 
        (!response.tool_calls || response.tool_calls.length === 0) &&
        hasClearProductIntent(userMessage)
      ) {
        const catalogTool = scopedTools.find(t => t.name === 'consultar_produto_comercial' || t.name === 'buscar_produto')
        if (catalogTool) {
          fallbackTriggered = true
          response.tool_calls = [{
            callId: 'fallback_catalog_1',
            toolName: catalogTool.name,
            arguments: catalogTool.name === 'consultar_produto_comercial' 
              ? { product_query: userMessage || '' } 
              : { query: userMessage || '' }
          }]
          response.content = null // Anula texto alucinado apenas quando a intenção de produto era explícita
        }
      }

      llm_rounds.push({
        round: iteration,
        provider: providerUsed,
        model: modelUsed,
        duration_ms: Date.now() - roundStartTime,
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
        cached_input_tokens: response.usage.cached_tokens,
        cache_write_tokens: response.usage.cache_write_tokens,
        reasoning_tokens: response.usage.reasoning_tokens,
        tool_use_tokens: response.usage.tool_use_tokens,
        tool_names: response.tool_calls ? response.tool_calls.map((tc: any) => tc.toolName) : [],
        tool_calls: response.tool_calls ? response.tool_calls.map((tc: any) => ({
          name: tc.toolName,
          arguments: tc.arguments
        })) : []
      })

      if (response.tool_calls && response.tool_calls.length > 0) {
        messagesForLLM.push({
          role: 'assistant',
          content: response.content || undefined,
          tool_calls: response.tool_calls
        })

        debug_tool_loop.push({
          round: iteration,
          tool_calls_requested: response.tool_calls.map(tc => tc.toolName)
        })

        for (const call of response.tool_calls) {
          const result = await executor.execute(call, { 
            companyId, 
            agentId, 
            conversationId,
            customerId: conversation?.customer_id || undefined,
            workingMemory: currentWorkingMemory // Propagação viva da memória de trabalho atualizada
          })
          
          executedTools.push({ name: call.toolName, success: result.success })
          allToolResults.push(result) // Registrado para o consolidador da Working Memory

          // Se a ferramenta retornou dados com sucesso, atualiza a memória de trabalho viva
          // para que iterações seguintes deste mesmo turno tenham acesso imediato aos novos itens/preços
          if (result.success && result.data) {
            currentWorkingMemory = applyWorkingMemoryUpdate(currentWorkingMemory, [result])
          }

          messagesForLLM.push({
            role: 'tool',
            tool_result: result
          })
        }

        debug_tool_loop.push({
          round: iteration + 1,
          tool_results_sent: allToolResults.map(r => ({ tool_name: r.toolName, success: r.success, data: r.data }))
        })
      
        continue
      }

      finalContent = response.content
      break
    }

    // Tratamento resiliente de encerramento do loop:
    // Se o teto de iterações foi atingido sem texto final do LLM, produz resposta segura baseada nos dados reais
    if (!finalContent) {
      finalContent = buildSafeIterationLimitResponse(allToolResults)
    }

    // 2. Extrair a nova Working Memory baseado nos resultados REAIS das ferramentas executadas
    // Não inventamos dados, apenas parseamos resultados determinísticos de forma segura
    const newWorkingMemory = applyWorkingMemoryUpdate(previousWorkingMemory, allToolResults)

    // 3. Preparar metadados da mensagem do agente contendo a nova memória de trabalho
    const messageMetadata: any = {}
    if (Object.keys(newWorkingMemory).length > 0) {
      messageMetadata.working_memory = newWorkingMemory
    }

    let insertedAgentMsg: { id: string } | null = null

    // Persistência controlada pelo parâmetro persistMessage (default: true).
    // Quando false: desacopla a inteligência da persistência para que a camada
    // chamadora possa realizar a criação atômica via outbox transacional (prepareOutboundMessage).
    if (persistMessage) {
      const { data: insertedMsg, error: insertErr } = await supabase.from('messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'agent',
        content: finalContent,
        message_type: 'text',
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : null
      }).select('id').single()

      if (insertErr) throw new Error(`Falha ao persistir resposta do agente: ${insertErr.message}`)
      insertedAgentMsg = insertedMsg

      const { error: convUpdateErr } = await supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        agent_id: agentId
      })
        .eq('id', conversationId)
        .eq('company_id', companyId)

      if (convUpdateErr) {
        throw new Error(`Falha ao atualizar conversa após resposta do agente: ${convUpdateErr.message}`)
      }
    }

    runStatus = 'success'

    // Calcular métricas de cache agregadas
    let total_cached_tokens = 0
    let total_input_tokens = 0
    for (const round of llm_rounds) {
      if (round.cached_input_tokens) total_cached_tokens += round.cached_input_tokens
      if (round.input_tokens) total_input_tokens += round.input_tokens
    }
    
    let cache_hit_ratio: number | undefined = undefined
    if (total_input_tokens > 0 && total_cached_tokens > 0) {
      cache_hit_ratio = parseFloat((total_cached_tokens / total_input_tokens).toFixed(4))
    }

    // Observabilidade e Telemetria Segura (sem dados confidenciais ou tokens sensíveis)
    const runMetadata: any = {
      debug_tool_loop,
      llm_rounds,
      caching: {
        total_cached_tokens,
        cache_hit: total_cached_tokens > 0,
        cache_hit_ratio
      },
      tools_available: scopedTools.map(t => t.name),
      cart: {
        item_count: newWorkingMemory.activeCart ? newWorkingMemory.activeCart.length : 0,
        has_items: Boolean(newWorkingMemory.activeCart && newWorkingMemory.activeCart.length > 0)
      },
      orchestration: {
        iterations: iteration,
        fallback_catalog_triggered: fallbackTriggered,
        executed_tools: executedTools.map(t => ({ tool: t.name, success: t.success })),
        has_active_quote: Boolean(newWorkingMemory.activeQuote?.id),
        quote_id: newWorkingMemory.activeQuote?.id || null
      },
      context: {
        history_messages_available: contextMetrics.availableMessages,
        history_messages_used: contextMetrics.usedMessages,
        history_anchor_expansion: contextMetrics.history_anchor_expansion,
        working_memory: {
          has_active_product: !!newWorkingMemory.activeProduct,
          has_active_price: !!newWorkingMemory.activePrice,
          has_active_quantity: !!newWorkingMemory.activeQuantity,
          has_active_cart: Boolean(newWorkingMemory.activeCart && newWorkingMemory.activeCart.length > 0),
          has_active_quote: !!newWorkingMemory.activeQuote
        }
      }
    }
    if (executedTools.length > 0) {
      runMetadata.tool_calls = executedTools
    }

    await logAgentRun(supabase, {
      companyId, 
      agentId, 
      conversationId, 
      status: runStatus, 
      provider: providerUsed, 
      model: modelUsed, 
      usageMetrics, 
      duration: Date.now() - startTime,
      metadata: runMetadata
    })

    return {
      success: true,
      message: finalContent,
      messageId: insertedAgentMsg?.id,
      usage: usageMetrics,
      workingMemory: newWorkingMemory,
      agentId,
      conversationId,
      metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : null
    }

  } catch (error: any) {
    runStatus = 'error'
    runErrorMessage = error.message

    // Tratamento controlado e seguro de TenantAccessError:
    // Não executa fallback ao LLM, não executa ferramentas comerciais,
    // não expõe detalhes internos/financeiros (suspensionReason) e preserva os códigos tipados
    if (error instanceof TenantAccessError) {
      console.warn(`[Agent Engine Blocked] Acesso negado para empresa '${companyId}': ${error.code} - ${error.message}`)

      return {
        success: false,
        code: error.code,
        statusCode: error.statusCode,
        error: error.message,
        details: error.message
      }
    }

    const errMetadata: any = {
      tools_available: scopedTools.map(t => t.name)
    }
    if (executedTools.length > 0) {
      errMetadata.tool_calls = executedTools
    }

    await logAgentRun(supabase, {
      companyId, agentId, conversationId, status: runStatus, provider: providerUsed, model: modelUsed, usageMetrics, duration: Date.now() - startTime, errorMessage: runErrorMessage, metadata: errMetadata
    }).catch(console.error)

    console.error('[Agent Engine Error]', error)
    
    return {
      success: false,
      error: 'Ocorreu um erro no processamento do agente inteligente.',
      details: runErrorMessage
    }
  }
}

async function logAgentRun(supabase: any, { companyId, agentId, conversationId, status, provider, model, usageMetrics, duration, errorMessage, metadata }: any) {
  const payload: any = {
    company_id: companyId,
    agent_id: agentId,
    conversation_id: conversationId,
    status,
    provider,
    model,
    prompt_tokens: usageMetrics.prompt_tokens,
    completion_tokens: usageMetrics.completion_tokens,
    total_tokens: usageMetrics.total_tokens,
    duration_ms: duration,
    error_message: errorMessage || null
  }
  
  if (metadata) {
    payload.metadata = sanitizeLogMetadata(metadata)
  }

  await supabase.from('agent_runs').insert(payload)
}
