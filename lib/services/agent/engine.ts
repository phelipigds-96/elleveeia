import { createAdminClient } from '@/lib/supabase/service'
import { buildAgentContext } from './context-builder'
import { getLLMProvider } from '../llm/factory'
import { LLMProviderType, LLMRequestMessage } from '../llm/types'
import { ToolRegistry, ToolExecutor } from './tools'
import { getCurrentDatetimeTool } from './tools/get-current-datetime'
import { buscarProdutoTool } from './tools/buscar-produto'
import { consultarPrecoTool } from './tools/consultar-preco'

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
  const executedTools: Array<{name: string, success: boolean}> = []

  try {
    if (userMessage) {
      const { error: msgErr } = await supabase.from('messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'customer',
        content: userMessage,
        message_type: 'text'
      })
      if (msgErr) throw new Error(`Falha ao inserir mensagem do usuário: ${msgErr.message}`)
    }

    const { agent, conversation, payloadMessages } = await buildAgentContext({
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
    
    const executor = new ToolExecutor(registry)
    const availableTools = registry.getProviderPayload()

    let messagesForLLM: LLMRequestMessage[] = payloadMessages.map(msg => ({
      role: msg.role === 'function' || msg.role === 'tool' ? 'user' : msg.role,
      content: msg.content || ''
    }))

    let iteration = 0
    let finalContent: string | null = null

    // LLM Loop para Function Calling
    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++

      const response = await provider.generateResponse({
        model: modelUsed,
        messages: messagesForLLM,
        temperature: 0.7,
        tools: availableTools
      })

      // Acumula métricas
      usageMetrics.prompt_tokens += response.usage.prompt_tokens
      usageMetrics.completion_tokens += response.usage.completion_tokens
      usageMetrics.total_tokens += response.usage.total_tokens

      if (response.tool_calls && response.tool_calls.length > 0) {
        // LLM pediu execução de ferramentas
        // Adiciona a resposta do LLM no histórico como assistant
        messagesForLLM.push({
          role: 'assistant',
          content: response.content || undefined,
          tool_calls: response.tool_calls
        })

        // Executa todas as tools (Em paralelo para leitura, mas seguro aqui no forEach se houver write futuramente gerenciar concorrência)
        for (const call of response.tool_calls) {
          const result = await executor.execute(call, { companyId, agentId, conversationId })
          
          executedTools.push({ name: call.toolName, success: result.success })

          // Envia o resultado de volta para o LLM
          messagesForLLM.push({
            role: 'tool',
            tool_result: result
          })
        }
        
        // Continua para a próxima iteração para o LLM gerar a resposta baseado no resultado
        continue
      }

      // Se chegou aqui, não há mais tool calls. Salva a resposta final
      finalContent = response.content
      break
    }

    if (!finalContent) {
      throw new Error(`O LLM encerrou o fluxo sem prover uma resposta válida de texto após ${iteration} iterações.`)
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content: finalContent,
      message_type: 'text'
    })

    if (insertErr) throw new Error(`Falha ao persistir resposta do agente: ${insertErr.message}`)

    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agent_id: agentId
    }).eq('id', conversationId)

    runStatus = 'success'

    await logAgentRun(supabase, {
      companyId, 
      agentId, 
      conversationId, 
      status: runStatus, 
      provider: providerUsed, 
      model: modelUsed, 
      usageMetrics, 
      duration: Date.now() - startTime,
      metadata: executedTools.length > 0 ? { tool_calls: executedTools } : null
    })

    return {
      success: true,
      message: finalContent,
      usage: usageMetrics
    }

  } catch (error: any) {
    runStatus = 'error'
    runErrorMessage = error.message

    await logAgentRun(supabase, {
      companyId, agentId, conversationId, status: runStatus, provider: providerUsed, model: modelUsed, usageMetrics, duration: Date.now() - startTime, errorMessage: runErrorMessage
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
