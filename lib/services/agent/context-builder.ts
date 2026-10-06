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
    throw new Error('Agente nǜo encontrado ou acesso negado.')
  }

  if (!agent.is_active) {
    throw new Error('O agente estǭ desabilitado.')
  }

  // 2. Validar a conversa e buscar o cliente
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*, customers(name, phone)')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (convError || !conversation) {
    throw new Error('Conversa nǜo encontrada ou acesso negado.')
  }

  if (conversation.status === 'human') {
    throw new Error('Conversa em modo de atendimento humano (Handoff). O agente nǜo deve intervir.')
  }

  // 3. Carregar histrico bruto (AtǸ 20 mensagens)
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(20)

  const rawHistory = messages || []

  // 4. Extrair Working Memory Operacional
  let workingMemory: any = null
  for (const msg of rawHistory) {
    if (msg.sender_type === 'agent' && msg.metadata?.working_memory) {
      workingMemory = msg.metadata.working_memory
      break // Pega a memria mais recente gravada
    }
  }

  // 5. Seleǜo Inteligente de Histrico (Camada A)
  // Preservamos as ltimas 8 mensagens incondicionalmente para manter referǦncias como "essa", "a de 1kg".
  // Reduz drasticamente tokens em conversas comerciais longas.
  const HISTORY_WINDOW = 8
  const selectedHistory = rawHistory.slice(0, HISTORY_WINDOW).reverse() // oldest first

  // 6. Montar o System Prompt
  let systemPrompt = `VocǦ Ǹ um assistente de IA operando no sistema Ellevee IA.\n\n`
  systemPrompt += `IDENTIDADE:\nNome: ${agent.name}\nSegmento: ${agent.segment || 'Geral'}\n`

  // Data/Hora nativa e barata
  const now = new Date()
  systemPrompt += `DATA/HORA ATUAL:\nData: ${now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`
  systemPrompt += `Hora: ${now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\nTimezone: America/Sao_Paulo\n`
  
  if (agent.personality) {
    // Truncamento explcito por seguranǜa de contexto
    systemPrompt += `\nPERSONALIDADE E TOM DE VOZ:\n${agent.personality.substring(0, 800)}\n`
  }

  if (agent.instructions) {
    // Truncamento explcito para nǜo estourar budget em gestores prolixos
    systemPrompt += `\nINSTRUÇÕES:\n${agent.instructions.substring(0, 2000)}\n`
  }

  systemPrompt += `\nDADOS DO CLIENTE:\n`
  systemPrompt += `Nome: ${conversation.customers?.name || 'Nǜo informado'}\n`
  systemPrompt += `Telefone: ${conversation.customers?.phone || 'Nǜo informado'}\n`

  // Injeǜo da Working Memory Estruturada (O LLM se guia por fatos e nǜo inventa)
  if (workingMemory && Object.keys(workingMemory).length > 0) {
     systemPrompt += `\n=== WORKING MEMORY (CONTEXTO COMERCIAL ATUAL) ===\n`
     if (workingMemory.activeProduct) {
         systemPrompt += `Produto em foco: ${workingMemory.activeProduct.name} (ID: ${workingMemory.activeProduct.id})\n`
     }
     if (workingMemory.activePrice) {
         systemPrompt += `Preo atual: R$ ${workingMemory.activePrice.unitPrice}\n`
     }
     if (workingMemory.activeQuantity) {
         systemPrompt += `Quantidade em foco: ${workingMemory.activeQuantity}\n`
     }
     if (workingMemory.activeQuote) {
         systemPrompt += `Oramento em aberto: ID ${workingMemory.activeQuote.id} (Status: ${workingMemory.activeQuote.status})\n`
     }
     systemPrompt += `=================================================\n`
  }

  systemPrompt += `\nREGRAS OPERACIONAIS:\n- Seja conciso.\n- Se nǜo souber, oferea transferir.\n`

  const payloadMessages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt }
  ]

  // 7. Mapear as mensagens selecionadas para o Provider
  for (const msg of selectedHistory) {
    if (msg.sender_type === 'customer') {
      payloadMessages.push({ role: 'user', content: msg.content })
    } else if (msg.sender_type === 'agent') {
      payloadMessages.push({ role: 'assistant', content: msg.content })
    } else if (msg.sender_type === 'human') {
      // Semǜntica clara para o LLM de que a empresa respondeu, mas foi um humano e nǜo a prpria IA
      payloadMessages.push({ role: 'assistant', content: `[ATENDENTE HUMANO]: ${msg.content}` })
    } else if (msg.sender_type === 'system') {
      payloadMessages.push({ role: 'system', content: `[SYSTEM LOG]: ${msg.content}` })
    }
  }

  return {
    agent,
    conversation,
    payloadMessages,
    workingMemory,
    contextMetrics: {
      availableMessages: rawHistory.length,
      usedMessages: selectedHistory.length
    }
  }
}
