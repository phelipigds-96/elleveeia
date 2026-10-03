import { createAdminClient } from '@/lib/supabase/service'
import { OpenAIMessage } from './openai'

interface ContextBuilderParams {
  companyId: string
  agentId: string
  conversationId: string
}

export async function buildAgentContext({ companyId, agentId, conversationId }: ContextBuilderParams) {
  const supabase = createAdminClient()

  // 1. Validar e carregar o agente com tenant isolation absoluto
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .eq('company_id', companyId)
    .single()

  if (agentError || !agent) {
    throw new Error('Agente não encontrado ou acesso negado.')
  }

  if (!agent.is_active) {
    throw new Error('O agente está desabilitado.')
  }

  // 2. Validar a conversa e buscar o cliente e o status
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*, customers(name, phone)')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (convError || !conversation) {
    throw new Error('Conversa não encontrada ou acesso negado.')
  }

  if (conversation.status === 'human') {
    throw new Error('Conversa em modo de atendimento humano (Handoff). O agente não deve intervir.')
  }

  // 3. Carregar as últimas mensagens do histórico (Janela de contexto controlada)
  // Limitamos a 20 mensagens para evitar estouro de tokens desnecessário nesta fase inicial
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20)

  // Inverter para ordem cronológica (oldest first)
  const history = (messages || []).reverse()

  // 4. Montar o prompt de sistema (System Instructions)
  // O "segment" entra apenas como metadado injetado no prompt, sem regras if/else rígidas no código.
  let systemPrompt = `Você é um assistente de IA operando no sistema Ellevee IA.\n\n`
  systemPrompt += `IDENTIDADE DO AGENTE:\nNome: ${agent.name}\nSegmento/Contexto da Empresa: ${agent.segment || 'Geral'}\n`
  
  if (agent.personality) {
    systemPrompt += `\nPERSONALIDADE E TOM DE VOZ:\n${agent.personality}\n`
  }

  if (agent.instructions) {
    systemPrompt += `\nINSTRUÇÕES PRINCIPAIS:\n${agent.instructions}\n`
  }

  systemPrompt += `\nDADOS DO CLIENTE (com quem você está falando):\n`
  systemPrompt += `Nome: ${conversation.customers?.name || 'Não informado'}\n`
  systemPrompt += `Telefone: ${conversation.customers?.phone || 'Não informado'}\n`

  systemPrompt += `\nREGRAS OPERACIONAIS GERAIS:\n- Seja conciso e direto, ideal para chat.\n- Se não souber a resposta baseada nas suas instruções e ferramentas, ofereça transferir para um atendente humano.\n`

  const payloadMessages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt }
  ]

  // 5. Mapear o histórico para o formato OpenAI
  for (const msg of history) {
    if (msg.sender_type === 'customer') {
      payloadMessages.push({ role: 'user', content: msg.content })
    } else if (msg.sender_type === 'agent' || msg.sender_type === 'human') {
      // Mensagens de humanos também servem como "assistant" para o LLM entender o que já foi dito
      payloadMessages.push({ role: 'assistant', content: msg.content })
    } else if (msg.sender_type === 'system') {
      // Mensagens de sistema podem entrar como user contextualizando (ex: "O status do pedido mudou")
      payloadMessages.push({ role: 'system', content: `[SYSTEM LOG]: ${msg.content}` })
    }
  }

  return {
    agent,
    conversation,
    payloadMessages
  }
}
