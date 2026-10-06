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
    throw new Error('Agente nao encontrado ou acesso negado.')
  }

  if (!agent.is_active) {
    throw new Error('O agente esta desabilitado.')
  }

  // 2. Validar a conversa e buscar o cliente
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*, customers(name, phone)')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (convError || !conversation) {
    throw new Error('Conversa nao encontrada ou acesso negado.')
  }

  if (conversation.status === 'human') {
    throw new Error('Conversa em modo de atendimento humano (Handoff). O agente nao deve intervir.')
  }

  // 3. Carregar histrico bruto (Ate 20 mensagens)
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
      break
    }
  }

  // 5. Selecao Inteligente de Historico (Camada A + Anchoring)
  const RECENT_WINDOW = 8
  const MAX_WINDOW = 12
  let historyWindow = RECENT_WINDOW

  if (rawHistory.length > 0) {
    const lastMsgContent = rawHistory[0].content.toLowerCase()
    const anchors = [
      'essa', 'esse', 'a primeira', 'a segunda', 'aquele', 'aquela',
      'o primeiro', 'o segundo', 'e 20', 'e 10', 'quanto fica',
      'quanto custa', 'pode colocar', 'adiciona', 'coloca', 'fecha'
    ]

    if (anchors.some(a => lastMsgContent.includes(a))) {
      historyWindow = MAX_WINDOW
    }
  }

  const selectedHistory = rawHistory.slice(0, historyWindow).reverse() // oldest first

  // 6. Montar o System Prompt
  // --- PARTE ESTATICA ---
  let systemPrompt = `[SISTEMA]\nAssistente Ellevee IA\n`
  systemPrompt += `Nome: ${agent.name}\nSegmento: ${agent.segment || 'Geral'}\n`
  systemPrompt += `Regras: Conciso. Se nao souber, transfira.\n`
    
  if (agent.personality) {
    systemPrompt += `\n[PERSONALIDADE]\n${agent.personality.substring(0, 800)}\n`
  }

  if (agent.instructions) {
    systemPrompt += `\n[INSTRUCOES]\n${agent.instructions.substring(0, 2000)}\n`
  }

  // --- PARTE DINAMICA ---
  systemPrompt += `\n[CLIENTE]\nNome: ${conversation.customers?.name || '?'}\nTel: ${conversation.customers?.phone || '?'}\n`

  const now = new Date()
  systemPrompt += `\n[CONTEXTO TEMPORAL]\n${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`

  if (workingMemory && Object.keys(workingMemory).length > 0) {
     systemPrompt += `\n[WORKING MEMORY]\n`
     if (workingMemory.activeProduct) {
         systemPrompt += `Produto: ${workingMemory.activeProduct.name} (ID: ${workingMemory.activeProduct.id})\n`
     }
     let priceQtd = []
     if (workingMemory.activePrice) priceQtd.push(`Preco: R$ ${workingMemory.activePrice.unitPrice}`)
     if (workingMemory.activeQuantity) priceQtd.push(`Qtd: ${workingMemory.activeQuantity}`)
     if (priceQtd.length > 0) systemPrompt += priceQtd.join(' | ') + '\n'
     
     if (workingMemory.activeQuote) {
         systemPrompt += `Orcamento: ID ${workingMemory.activeQuote.id} (${workingMemory.activeQuote.status})\n`
     }
  }

  systemPrompt += `\n[PRIORIDADE ABSOLUTA]\nQuando uma ferramenta disponivel retornar sucesso (ex: horas, datas, precos, etc), VOCE DEVE priorizar o resultado dessa ferramenta na resposta. O resultado de uma ferramenta tem precedencia total sobre restricoes genericas de dominio ("Responda apenas sobre produtos"). Nao finja que nao pode informar algo se a ferramenta acabou de lhe devolver os dados.`

  const payloadMessages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt }
  ]

  // 7. Mapear as mensagens
  for (const msg of selectedHistory) {
    if (msg.sender_type === 'customer') {
      payloadMessages.push({ role: 'user', content: msg.content })
    } else if (msg.sender_type === 'agent') {
      payloadMessages.push({ role: 'assistant', content: msg.content })
    } else if (msg.sender_type === 'human') {
      payloadMessages.push({ role: 'assistant', content: `[ATENDENTE HUMANO]: ${msg.content}` })
    } else if (msg.sender_type === 'system') {
      payloadMessages.push({ role: 'system', content: `[LOG]: ${msg.content}` })
    }
  }

  return {
    agent,
    conversation,
    payloadMessages,
    workingMemory,
    contextMetrics: {
      availableMessages: rawHistory.length,
      usedMessages: selectedHistory.length,
      history_anchor_expansion: historyWindow - RECENT_WINDOW
    }
  }
}

