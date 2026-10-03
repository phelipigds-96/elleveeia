import { createAdminClient } from '@/lib/supabase/service'
import { buildAgentContext } from './context-builder'
import { callOpenAI } from './openai'

interface AgentRunParams {
  companyId: string
  agentId: string
  conversationId: string
  userMessage?: string // Opcional caso a engine seja engatilhada logo após salvar a mensagem no banco
}

export async function runAgentEngine({ companyId, agentId, conversationId, userMessage }: AgentRunParams) {
  const supabase = createAdminClient()
  const startTime = Date.now()

  let runStatus = 'processing'
  let runErrorMessage: string | null = null
  let usageMetrics = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let modelUsed = 'unknown'

  try {
    // 1. Opcionalmente salva a nova mensagem do cliente (se o fluxo exigir inserção neste ponto)
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

    // 2. Constrói o Contexto (valida company, agent e conversation)
    const { agent, conversation, payloadMessages } = await buildAgentContext({
      companyId,
      agentId,
      conversationId
    })

    modelUsed = agent.model

    // 3. Chamada ao Cérebro (OpenAI)
    // No futuro, passaremos "tools" aqui
    const response = await callOpenAI(payloadMessages, modelUsed)

    usageMetrics = response.usage

    const replyContent = response.message.content

    if (!replyContent) {
      throw new Error('A resposta do modelo veio vazia.')
    }

    // 4. Persiste a Resposta do Agente
    const { error: insertErr } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content: replyContent,
      message_type: 'text'
    })

    if (insertErr) throw new Error(`Falha ao persistir resposta do agente: ${insertErr.message}`)

    // 5. Atualiza a Conversa (last_message_at, desfaz unread se for o caso, etc)
    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agent_id: agentId // Garante que a conversa fica vinculada a este agente
    }).eq('id', conversationId)

    runStatus = 'success'

    // 6. Finaliza Registrando a Observabilidade e retorna sucesso
    await logAgentRun(supabase, {
      companyId, agentId, conversationId, status: runStatus, model: modelUsed, usageMetrics, duration: Date.now() - startTime
    })

    return {
      success: true,
      message: replyContent,
      usage: usageMetrics
    }

  } catch (error: any) {
    runStatus = 'error'
    runErrorMessage = error.message

    // Tenta logar a falha em background
    await logAgentRun(supabase, {
      companyId, agentId, conversationId, status: runStatus, model: modelUsed, usageMetrics, duration: Date.now() - startTime, errorMessage: runErrorMessage
    }).catch(console.error)

    console.error('[Agent Engine Error]', error)
    
    // Retorna erro estruturado amigável, escondendo stack traces do client
    return {
      success: false,
      error: 'Ocorreu um erro no processamento do agente inteligente.',
      details: runErrorMessage // Em ambiente dev poderíamos exibir. Em prod, avaliar ocultar. Aqui deixaremos por debug interno da ferramenta de playground.
    }
  }
}

async function logAgentRun(supabase: any, { companyId, agentId, conversationId, status, model, usageMetrics, duration, errorMessage }: any) {
  await supabase.from('agent_runs').insert({
    company_id: companyId,
    agent_id: agentId,
    conversation_id: conversationId,
    status,
    model,
    prompt_tokens: usageMetrics.prompt_tokens,
    completion_tokens: usageMetrics.completion_tokens,
    total_tokens: usageMetrics.total_tokens,
    duration_ms: duration,
    error_message: errorMessage || null
  })
}
