import { createAdminClient } from '@/lib/supabase/service'
import { buildAgentContext } from './context-builder'
import { getLLMProvider } from '../llm/factory'
import { LLMProviderType } from '../llm/types'

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

    const response = await provider.generateResponse({
      model: modelUsed,
      messages: payloadMessages.map(msg => ({
        role: msg.role === 'function' || msg.role === 'tool' ? 'assistant' : msg.role,
        content: msg.content || ''
      })),
      temperature: 0.7
    })

    usageMetrics = response.usage
    const replyContent = response.content

    if (!replyContent) {
      throw new Error(`A resposta do modelo (${providerUsed}) veio vazia.`)
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content: replyContent,
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
      companyId, agentId, conversationId, status: runStatus, provider: providerUsed, model: modelUsed, usageMetrics, duration: Date.now() - startTime
    })

    return {
      success: true,
      message: replyContent,
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

async function logAgentRun(supabase: any, { companyId, agentId, conversationId, status, provider, model, usageMetrics, duration, errorMessage }: any) {
  await supabase.from('agent_runs').insert({
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
  })
}
