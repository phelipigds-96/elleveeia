import { createAdminClient } from '@/lib/supabase/service'
import type { OpenAIMessage } from './openai'
import type { WorkingMemory } from './working-memory'

interface ContextBuilderParams {
  companyId: string
  agentId: string
  conversationId: string
}

/**
 * Formata o bloco [WORKING MEMORY] para exibição determinística no System Prompt do LLM.
 * Exibe o produto em foco no diálogo, dados de preço/quantidade atuais,
 * o carrinho multi-item de negociação com status de confirmação e totais validados,
 * e o orçamento formal caso exista.
 */
export function formatWorkingMemoryPrompt(workingMemory: WorkingMemory | null | undefined): string {
  if (!workingMemory || Object.keys(workingMemory).length === 0) {
    return ''
  }

  let prompt = `\n[WORKING MEMORY]\n`

  if (workingMemory.activeProduct) {
    prompt += `Produto em Foco: ${workingMemory.activeProduct.name} (ID: ${workingMemory.activeProduct.id})\n`
  }

  const priceQtd: string[] = []
  if (workingMemory.activePrice && typeof workingMemory.activePrice.unitPrice === 'number') {
    const typeStr = workingMemory.activePrice.priceType ? ` (${workingMemory.activePrice.priceType})` : ''
    priceQtd.push(`Preco: R$ ${workingMemory.activePrice.unitPrice.toFixed(2)}${typeStr}`)
  }
  if (typeof workingMemory.activeQuantity === 'number') {
    priceQtd.push(`Qtd: ${workingMemory.activeQuantity}`)
  }
  if (priceQtd.length > 0) {
    prompt += priceQtd.join(' | ') + '\n'
  }

  // Exposição do carrinho multi-item (activeCart)
  if (workingMemory.activeCart && workingMemory.activeCart.length > 0) {
    const count = workingMemory.activeCart.length
    prompt += `\nCarrinho de Negociação (${count} ${count === 1 ? 'item distinto' : 'itens distintos'}):\n`
    let partialTotalCents = 0
    const unconfirmedNames: string[] = []

    for (const item of workingMemory.activeCart) {
      const statusStr = item.isPriceConfirmed ? 'Confirmada' : 'Pendente'
      let itemLine = `- ${item.name} (ID: ${item.productId}) | Qtd: ${item.quantity} | Precificação: ${statusStr}`
      if (item.isPriceConfirmed && typeof item.unitPrice === 'number' && typeof item.subtotal === 'number') {
        const typeStr = item.priceType ? ` (${item.priceType})` : ''
        itemLine += ` | Preço Unit: R$ ${item.unitPrice.toFixed(2)}${typeStr} | Subtotal: R$ ${item.subtotal.toFixed(2)}`
        partialTotalCents += Math.round(item.subtotal * 100)
      } else {
        unconfirmedNames.push(item.name)
      }
      prompt += itemLine + '\n'
    }

    const partialTotal = partialTotalCents / 100
    prompt += `Total Parcial Confirmado: R$ ${partialTotal.toFixed(2)}\n`
    if (unconfirmedNames.length > 0) {
      prompt += `Atenção: Os seguintes produtos precisam de recálculo/confirmação de preço antes de gerar orçamento: ${unconfirmedNames.join(', ')}\n`
    }
  }

  if (workingMemory.activeQuote) {
    const totalFormatted = typeof workingMemory.activeQuote.total === 'number'
      ? ` | Total: R$ ${workingMemory.activeQuote.total.toFixed(2)}`
      : ''
    prompt += `Orcamento Formal: ID ${workingMemory.activeQuote.id} (${workingMemory.activeQuote.status})${totalFormatted}\n`
  }

  // Exposição do Buffer de Produtos Apresentados Recentemente
  if (workingMemory.discoveredProducts && workingMemory.discoveredProducts.length > 0) {
    prompt += `\n[PRODUTOS APRESENTADOS RECENTEMENTE]\n`
    for (const p of workingMemory.discoveredProducts.slice(0, 12)) {
      const priceStr = p.unitPrice ? ` | Preço: R$ ${p.unitPrice.toFixed(2)}` : ''
      prompt += `- ${p.name} | ID: ${p.id}${priceStr}\n`
    }
    prompt += `ATENÇÃO: Ao calcular preço, consultar preço ou gerar orçamento para algum dos produtos acima, use OBRIGATORIAMENTE o ID indicado. NUNCA invente outros IDs.\n`
  }

  return prompt
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

  // 3. Carregar histórico bruto com isolamento estrito de tenant (Até 20 mensagens)
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (messagesError) {
    console.error('[buildAgentContext] Erro ao carregar histórico de mensagens:', messagesError)
  }

  const rawHistory = messages || []

  // 4. Extrair Working Memory Operacional
  let workingMemory: WorkingMemory | null = null
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

  // Injeção da Working Memory estruturada
  if (workingMemory && Object.keys(workingMemory).length > 0) {
    systemPrompt += formatWorkingMemoryPrompt(workingMemory)
  }

  systemPrompt += `\n[PRIORIDADE ABSOLUTA]\nQuando uma ferramenta disponivel retornar sucesso (ex: horas, datas, precos, etc), VOCE DEVE priorizar o resultado dessa ferramenta na resposta. O resultado de uma ferramenta tem precedencia total sobre restricoes genericas de dominio ("Responda apenas sobre produtos"). Nao finja que nao pode informar algo se a ferramenta acabou de lhe devolver os dados.`

  systemPrompt += `\n\n[OBRIGATORIEDADE DE CATALOGO E REGRAS COMERCIAIS]\n`
  systemPrompt += `1. IDENTIFICAÇÃO DE PRODUTOS:\n`
  systemPrompt += `- Use o catálogo importado da Sumel como fonte oficial de identificação.\n`
  systemPrompt += `- Não invente produtos, marcas, códigos ou preços.\n`
  systemPrompt += `- Quando houver ambiguidade de marcas ou modelos, apresente as opções disponíveis e peça esclarecimento ao cliente.\n`
  systemPrompt += `- Produto não localizado no catálogo NÃO significa produto sem estoque. NUNCA diga 'está sem estoque' ou 'esgotou' ao não encontrar um produto. Diga que não localizou o produto no catálogo e ofereça transferir para um atendente humano.\n\n`

  systemPrompt += `2. CARRINHO DE NEGOCIAÇÃO:\n`
  systemPrompt += `- Uma consulta simples não adiciona automaticamente um produto ao carrinho.\n`
  systemPrompt += `- Quando o cliente confirmar produto e quantidade para precificação, atualize o carrinho.\n`
  systemPrompt += `- Ao adicionar outro produto, preserve os itens anteriores no carrinho.\n`
  systemPrompt += `- Ao alterar quantidade de um item, recalcule o preço pela ferramenta oficial antes de confirmar o novo subtotal.\n`
  systemPrompt += `- Ao remover um item, preserve todos os demais itens do carrinho.\n`
  systemPrompt += `- NUNCA confirme um orçamento com item de preço pendente.\n`
  systemPrompt += `- Não trate o carrinho em memória como orçamento formal persistido.\n\n`

  systemPrompt += `3. PRECIFICAÇÃO OFICIAL:\n`
  systemPrompt += `- Use exclusivamente o motor oficial de precificação via ferramentas. Não calcule ou invente descontos por conta própria.\n`
  systemPrompt += `- Respeite rigorosamente as regras de varejo, atacado, lotes mínimos de quantidade e vigência comercial.\n`
  systemPrompt += `- Preço Clube Sumel só pode ser informado quando a elegibilidade estiver confirmada no sistema.\n`
  systemPrompt += `- Se o cliente solicitar preço Clube sem elegibilidade confirmada, informe o preço regular vigente e explique que o benefício é exclusivo para membros cadastrados do Clube Sumel.\n\n`

  systemPrompt += `4. GERAÇÃO E EDIÇÃO DE ORÇAMENTOS:\n`
  systemPrompt += `- Ao solicitar orçamento, utilize os itens com preços confirmados do carrinho.\n`
  systemPrompt += `- Ao editar um orçamento existente, atualize o registro draft existente, evitando duplicação.\n`
  systemPrompt += `- Após qualquer inclusão, remoção ou alteração de quantidade, atualize os valores e totais formais.\n`
  systemPrompt += `- Só informe número (ID) e total de orçamento após o retorno confirmado da ferramenta gerar_orcamento.\n`
  systemPrompt += `- Se uma operação de ferramenta falhar, explique com clareza o motivo e não simule sucesso.\n\n`
  systemPrompt += `5. ABORDAGEM CONSULTIVA DE VENDAS (QUALIFICAÇÃO DE NECESSIDADE E EMBALAGENS):\n`
  systemPrompt += `- NUNCA despeje uma lista aleatória com preços díspares (misturando caixas de atacado de centenas de reais, barras culinárias de 1kg e pequenos docinhos) quando a pergunta do cliente for ampla ou genérica sobre marcas ou categorias (ex: "tem chocolate nestlé?", "tem chocolate?", "tem granulado?", "tem forma?").\n`
  systemPrompt += `- Quando a ferramenta retornar múltiplos produtos ou indicar consulta ampla:\n`
  systemPrompt += `  1. Confirme com simpatia e acolhimento que a loja possui a linha/marca solicitada.\n`
  systemPrompt += `  2. Faça uma pergunta consultiva amigável para entender a finalidade: pergunte se procura para CONFEITARIA/RECEITAS (ex: barras culinárias de 1kg, coberturas, gotas) ou para CONSUMO INDIVIDUAL/DOCINHO (ex: tabletes de 80g/90g, bombons, snacks) ou caixas fechadas de atacado para revenda.\n`
  systemPrompt += `  3. Mencione brevemente exemplos das opções disponíveis sem poluir a mensagem com listas numéricas de preços.\n`
  systemPrompt += `- RESPOSTA À QUALIFICAÇÃO DO CLIENTE (BUSCA REFINADA E VARIETAL):\n`
  systemPrompt += `  Quando o cliente responder indicando a finalidade (ex: "para confeitaria", "para receitas", "para consumo", "docinho", "revenda", "atacado") ou pedir opções/sabores:\n`
  systemPrompt += `  1. VOCÊ DEVE OBRIGATORIAMENTE chamar a ferramenta consultar_produto_comercial com o termo refinado (ex: "chocolate nestle barra 1kg", "chocolate nestle confeitaria", "chocolate nestle tablete"). NÃO responda apenas com a memória antiga!\n`
  systemPrompt += `  2. REGRA DE EMBALAGEM / UNIDADE AVULSA vs CAIXA FECHADA:\n`
  systemPrompt += `     - NUNCA liste produtos de caixa fechada, display ou fardo (ex: 12X1KG, 14X90G, 54X126G, CX, DISPLAY) para clientes que pediram confeitaria ou consumo individual.\n`
  systemPrompt += `     - Apresente SEMPRE as unidades avulsas (ex: barras individuais de 1kg com todos os sabores disponíveis: Ao Leite, Meio Amargo, Galak/Branco, Blend, Marfim; ou tabletes individuais de 80g/90g).\n`
  systemPrompt += `     - Só apresente caixa fechada, display ou fardo se o cliente solicitar explicitamente por "caixa", "fardo", "display", "atacado" ou "revenda".\n`
  systemPrompt += `  3. Apresente as opções e sabores de unidades avulsas retornadas pela ferramenta com seus respectivos preços unitários, facilitando a escolha do cliente.\n`

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
