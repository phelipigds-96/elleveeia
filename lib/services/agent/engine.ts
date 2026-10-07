import { createAdminClient } from '@/lib/supabase/service'
import { buildAgentContext } from './context-builder'
import { getLLMProvider } from '../llm/factory'
import { LLMProviderType, LLMRequestMessage } from '../llm/types'
import { ToolRegistry, ToolExecutor } from './tools'
import { getCurrentDatetimeTool } from './tools/get-current-datetime'
import { buscarProdutoTool } from './tools/buscar-produto'
import { consultarPrecoTool } from './tools/consultar-preco'
import { calcularPrecoProdutoTool } from './tools/calcular-preco'
import { gerarOrcamentoTool } from './tools/gerar-orcamento'
import { consultarProdutoComercialTool } from './tools/consultar-produto-comercial'
import { resolveToolScope } from './tool-scoping'
import { applyWorkingMemoryUpdate } from './working-memory'

const MAX_TOOL_ITERATIONS = 5

interface AgentRunParams {
  companyId: string
  agentId: string
  conversationId: string
  userMessage?: string
}

export async function runAgentEngine({ companyId, agentId, conversationId, userMessage }: AgentRunParams) {
  const supabase = createAdminClient()
  const startTime = Date.now()

  let runStatus = 'processing'
  let runErrorMessage: string | null = null
  let usageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let modelUsed = 'unknown'
  let providerUsed: LLMProviderType = 'openai'
  let scopedTools: any[] = []
  const executedTools: Array<{name: string, success: boolean}> = []

  // Rastreabilidade estrita e deterministica da Memria de Trabalho (Sem LLM)
  const allToolResults: any[] = []

  try {
    if (userMessage) {
      const { error: msgErr } = await supabase.from('messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'customer',
        content: userMessage,
        message_type: 'text'
      })
      if (msgErr) throw new Error(`Falha ao inserir mensagem do usuÃ‡Â­rio: ${msgErr.message}`)
    }

    // O Context Builder agora devolve tambÃ‡Â¸m a workingMemory da Ã‡Â§ltima interaÃ‡Å“o
    const { agent, conversation, payloadMessages, workingMemory: previousWorkingMemory, contextMetrics } = await buildAgentContext({
      companyId,
      agentId,
      conversationId
    })

    modelUsed = agent.model
    providerUsed = (agent.provider || 'openai') as LLMProviderType
    const provider = getLLMProvider(providerUsed)

    // Configurar Registry e Executor
    const registry = new ToolRegistry()
    registry.register(getCurrentDatetimeTool) 
    registry.register(buscarProdutoTool)
    registry.register(consultarPrecoTool)
    registry.register(calcularPrecoProdutoTool)
    registry.register(gerarOrcamentoTool)
    registry.register(consultarProdutoComercialTool)
    
    const executor = new ToolExecutor(registry)
    
    // 1. Tool Scoping: Resolvemos as tools ideais baseado na msg e historico limpo
    const historyForScoping = payloadMessages.filter(m => m.role === 'user' || m.role === 'assistant')
    scopedTools = resolveToolScope(userMessage, historyForScoping, registry.list())
    const availableTools = registry.getProviderPayload(scopedTools)

    let messagesForLLM: LLMRequestMessage[] = payloadMessages.map(msg => ({
      role: msg.role === 'function' || msg.role === 'tool' ? 'user' : msg.role,
      content: msg.content || ''
    }))

    let iteration = 0
    let llm_rounds: any[] = []
      let finalContent: string | null = null
      let debug_tool_loop: any[] = []

    // LLM Loop para Function Calling
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++

      const roundStartTime = Date.now()

      const response = await provider.generateResponse({
        model: modelUsed,
        messages: messagesForLLM,
        temperature: 0.7,
        tools: availableTools
      })

      // Acumula mÃ‡Â¸tricas
      usageMetrics.prompt_tokens += response.usage.prompt_tokens
      usageMetrics.completion_tokens += response.usage.completion_tokens
      usageMetrics.total_tokens += response.usage.total_tokens

      // Fallback Determinístico de Catálogo (Zero-Shot)
      // Se no primeiro turno o LLM ignorou uma ferramenta de catálogo disponível e tentou gerar apenas texto,
      // forçamos a chamada da ferramenta injetando-a na resposta do LLM ANTES de processar.
      if (iteration === 1 && (!response.tool_calls || response.tool_calls.length === 0)) {
        const catalogTool = scopedTools.find(t => t.name === 'consultar_produto_comercial' || t.name === 'buscar_produto')
        if (catalogTool) {
          response.tool_calls = [{
            callId: 'fallback_catalog_1',
            toolName: catalogTool.name,
            arguments: catalogTool.name === 'consultar_produto_comercial' 
              ? { product_query: userMessage || '' } 
              : { query: userMessage || '' }
          }]
          response.content = null // Anula texto alucinado
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
        tool_names: response.tool_calls ? response.tool_calls.map(tc => tc.toolName) : [],
        tool_calls: response.tool_calls ? response.tool_calls.map(tc => ({
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
          const result = await executor.execute(call, { companyId, agentId, conversationId })
          
          executedTools.push({ name: call.toolName, success: result.success })
          allToolResults.push(result) // Salvamos para o parser da Working Memory

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

    if (!finalContent) {
      throw new Error(`O LLM encerrou o fluxo sem prover uma resposta vÃ‡Â­lida de texto aps ${iteration} iteraes.`)
    }

    // 2. Extrair a nova Working Memory baseado nos resultados REAIS das ferramentas executadas
    // NÃƒÂ£o inventamos dados, apenas parseamos resultados deterministicos de forma segura
    const newWorkingMemory = applyWorkingMemoryUpdate(previousWorkingMemory, allToolResults)

    // 3. Salvar a resposta do agente contendo a nova memÃƒÂ³ria no campo metadata!
    const messageMetadata: any = {}
    if (Object.keys(newWorkingMemory).length > 0) {
      messageMetadata.working_memory = newWorkingMemory
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content: finalContent,
      message_type: 'text',
      metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : null
    })

    if (insertErr) throw new Error(`Falha ao persistir resposta do agente: ${insertErr.message}`)

    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agent_id: agentId
    }).eq('id', conversationId)

    runStatus = 'success'

      // Calcular metricas de cache agregadas
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

      // Observabilidade das Metricas de Contexto
      const runMetadata: any = {
          debug_tool_loop,
          llm_rounds,
        caching: {
          total_cached_tokens,
          cache_hit: total_cached_tokens > 0,
          cache_hit_ratio
        },
      tools_available: scopedTools.map(t => t.name),
      context: {
        history_messages_available: contextMetrics.availableMessages,
        history_messages_used: contextMetrics.usedMessages,
        history_anchor_expansion: contextMetrics.history_anchor_expansion,
        working_memory: {
          has_active_product: !!newWorkingMemory.activeProduct,
          has_active_price: !!newWorkingMemory.activePrice,
          has_active_quantity: !!newWorkingMemory.activeQuantity,
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
      usage: usageMetrics
    }

  } catch (error: any) {
    runStatus = 'error'
    runErrorMessage = error.message

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
    payload.metadata = metadata
  }

  await supabase.from('agent_runs').insert(payload)
}









