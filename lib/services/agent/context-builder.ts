import { createAdminClient } from '@/lib/supabase/service'
import type { OpenAIMessage } from './openai'
import { isWorkingMemoryExpired, expireWorkingMemory, type WorkingMemory } from './working-memory'
import { isPlausibleHumanName, sanitizeCustomerName } from '@/lib/services/customer-name'

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
    for (const p of workingMemory.discoveredProducts.slice(0, 15)) {
      const priceStr = p.unitPrice ? ` | Preço: R$ ${p.unitPrice.toFixed(2)}` : ''
      prompt += `- ${p.name} | ID: ${p.id}${priceStr}\n`
    }
    prompt += `ATENÇÃO: A lista acima é APENAS o histórico de opções recentemente visualizadas nesta conversa, NÃO É O CATÁLOGO COMPLETO DA LOJA.\n`
    prompt += `A loja possui milhares de produtos. Para qualquer novo produto ou marca perguntado pelo cliente (ex: "tem trakinas?", "tem nutella?"), VOCÊ DEVE OBRIGATORIAMENTE consultar o catálogo via consultar_produto_comercial. NUNCA diga que não localizou sem antes pesquisar na ferramenta!\n`
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

  // 2. Validar a conversa e buscar o cliente (com fallback 42703 caso migration pendente)
  let { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('*, customers(name, phone, name_confirmed, whatsapp_name)')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (convError && convError.code === '42703') {
    const baseRes = await supabase
      .from('conversations')
      .select('*, customers(name, phone)')
      .eq('id', conversationId)
      .eq('company_id', companyId)
      .single()
    conversation = baseRes.data
    convError = baseRes.error
  }

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

  // 3.1 Verificar se a empresa possui catálogo de produtos cadastrado
  const { count: productCount } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
  const hasCatalogProducts = (productCount || 0) > 0

  // 4. Extrair Working Memory Operacional
  let workingMemory: WorkingMemory | null = null
  let workingMemoryTimestamp: string | null = null

  for (const msg of rawHistory) {
    if (msg.sender_type === 'agent' && msg.metadata?.working_memory) {
      workingMemory = msg.metadata.working_memory
      workingMemoryTimestamp = workingMemory?.updatedAt || msg.created_at || null
      break
    }
  }

  // Fallback duravel: se a conversa tiver >20 mensagens desde a ultima acao comercial,
  // busca a ultima working_memory persistida diretamente no banco.
  if (!workingMemory) {
    const wmBaseQuery = (supabase as any)
      .from('messages')
      .select('metadata, created_at')
      .eq('conversation_id', conversationId)
      .eq('company_id', companyId)
      .eq('sender_type', 'agent')

    if (typeof wmBaseQuery?.not === 'function') {
      const { data: wmRows, error: wmLookupError } = await wmBaseQuery
        .not('metadata->>working_memory', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)

      if (wmLookupError) {
        console.warn('[buildAgentContext] Falha ao buscar working_memory duravel:', wmLookupError)
      } else if (Array.isArray(wmRows) && wmRows[0]?.metadata?.working_memory) {
        workingMemory = wmRows[0].metadata.working_memory
        workingMemoryTimestamp = workingMemory?.updatedAt || wmRows[0].created_at || null
      }
    }
  }

  // 4.1 Validação de TTL e Inatividade (Expiração Automática de Carrinho)
  if (workingMemory) {
    const isExpiredByTime = isWorkingMemoryExpired(workingMemoryTimestamp)

    // Se a conversa foi fechada anteriormente ou se a memória é anterior ao closed_at
    const isClosedSession = Boolean(
      conversation.closed_at &&
      workingMemoryTimestamp &&
      new Date(workingMemoryTimestamp).getTime() <= new Date(conversation.closed_at).getTime()
    )

    if (isExpiredByTime || isClosedSession) {
      workingMemory = expireWorkingMemory(workingMemory)
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
  const customerRow: any = Array.isArray((conversation as any).customers)
    ? (conversation as any).customers[0]
    : (conversation as any).customers

  const hasConfirmedCustomerName =
    customerRow?.name_confirmed === true ||
    (customerRow?.name_confirmed === undefined && isPlausibleHumanName(customerRow?.name))

  if (hasConfirmedCustomerName && customerRow?.name) {
    const displayName = sanitizeCustomerName(customerRow.name)
    systemPrompt += `\n[CLIENTE]\nNome confirmado: ${displayName}\nTel: ${customerRow?.phone || '?'}\nStatus cadastral: CLIENTE JÁ IDENTIFICADO (chame-o pelo primeiro nome com naturalidade e NÃO pergunte o nome novamente)\n`
  } else {
    const refName = customerRow?.whatsapp_name || customerRow?.name || 'Não informado'
    systemPrompt += `\n[CLIENTE]\nNome atual: ${refName} (NÃO CONFIRMADO / PROVISÓRIO)\nTel: ${customerRow?.phone || '?'}\nStatus cadastral: PRIMEIRO CONTATO SEM NOME REAL CONFIRMADO\nRegra de cadastro de nome: Caso o cliente ainda não tenha informado o nome nesta conversa, pergunte gentilmente como prefere ser chamado(a). Se ele já fez uma pergunta comercial ou sobre a loja, responda a dúvida primeiro com clareza e peça o nome ao final da mensagem. Assim que o cliente informar o nome, chame obrigatoriamente a ferramenta salvar_nome_cliente antes de encerrar a resposta.\n`
  }

  const now = new Date()
  systemPrompt += `\n[CONTEXTO TEMPORAL]\n${now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n`

  // Injeção de memória resumida persistente para conversas longas (> janela de 8-12 mensagens)
  const savedSummary = typeof (conversation as any)?.summary === 'string'
    ? (conversation as any).summary.trim()
    : ''
  if (savedSummary) {
    systemPrompt += `\n[RESUMO ANTERIOR DA CONVERSA]\n${savedSummary.substring(0, 1200)}\n`
  }

  // Injeção da Working Memory estruturada
  if (workingMemory && Object.keys(workingMemory).length > 0) {
    systemPrompt += formatWorkingMemoryPrompt(workingMemory)
  }

  systemPrompt += `\n[PRIORIDADE ABSOLUTA]\nQuando uma ferramenta disponivel retornar sucesso (ex: horas, datas, precos, etc), VOCE DEVE priorizar o resultado dessa ferramenta na resposta. O resultado de uma ferramenta tem precedencia total sobre restricoes genericas de dominio ("Responda apenas sobre produtos"). Nao finja que nao pode informar algo se a ferramenta acabou de lhe devolver os dados.`

  if (hasCatalogProducts) {
    systemPrompt += `\n\n[OBRIGATORIEDADE DE CATALOGO E REGRAS COMERCIAIS]\n`
    systemPrompt += `1. IDENTIFICAÇÃO DE PRODUTOS:\n`
    systemPrompt += `- Use o catálogo oficial como fonte de identificação.\n`
  systemPrompt += `- Não invente produtos, marcas, códigos ou preços.\n`
  systemPrompt += `- Quando houver ambiguidade de marcas ou modelos, apresente as opções disponíveis e peça esclarecimento ao cliente.\n`
  systemPrompt += `- Produto não localizado no catálogo NÃO significa produto sem estoque. NUNCA diga 'está sem estoque' ou 'esgotou'. Diga que não localizou o produto no catálogo e ofereça transferir para um atendente humano apenas SE a ferramenta consultar_produto_comercial tiver sido executada e retornado not_found.\n`
  systemPrompt += `- RESPOSTA COM NÚMERO ISOLADO (SELEÇÃO DE OPÇÃO vs QUANTIDADE):\n`
  systemPrompt += `  Quando você tiver acabado de apresentar uma lista numerada de produtos/sabores (ex: 1 a 5) e a mensagem seguinte do cliente contiver APENAS um número (ex: "5", "opcao 3", "quero a 2", "1"):\n`
  systemPrompt += `  1. Esse número refere-se OBRIGATORIAMENTE à OPÇÃO DA LISTA correspondente (ex: se o cliente enviou "5", ele quer a Opção 5 da lista anterior, e NUNCA 5 unidades da Opção 1!).\n`
  systemPrompt += `  2. Adicione 1 unidade do produto correspondente àquela opção ou confirme a opção selecionada: "Você escolheu a opção 5 ([Nome do Produto]). Gostaria de quantas unidades? 😊". Jamais atribua o número como quantidade da opção 1.\n`
  systemPrompt += `- RESPOSTA COM QUANTIDADE SEM ESPECIFICAR A OPÇÃO (DESAMBIGUAÇÃO DE OPÇÕES ANTERIORES):\n`
  systemPrompt += `  Quando você tiver acabado de apresentar uma lista de opções (ex: 1. Zero Lactose R$ 8,99, 2. Semidesnatado R$ 5,49, 3. Caixa 27x R$ 145,99) e a mensagem seguinte do cliente informar APENAS uma quantidade (ex: "quero 10 unidades", "me vê 5", "vou querer 2"), sem especificar qual das opções prefere:\n`
  systemPrompt += `  1. NUNCA invente UUIDs de produtos e NUNCA chame ferramentas com IDs alucinados.\n`
  systemPrompt += `  2. Pergunte imediatamente e com simpatia qual das opções apresentadas o cliente prefere para aquela quantidade:\n`
  systemPrompt += `     Exemplo: "Perfeito! Você gostaria de 10 unidades do **Semidesnatado tradicional (395g)** por R$ 5,49 cada, ou do **Zero Lactose** por R$ 8,99? 😊"\n`
  systemPrompt += `  3. Se o cliente tiver especificado a opção junto da quantidade (ex: "quero 10 do semidesnatado" ou "10 da opção 2"), use o ID real correspondente listado em [PRODUTOS APRESENTADOS RECENTEMENTE] para calcular o preço com calcular_preco_produto.\n`
  systemPrompt += `- PERGUNTAS SOBRE PRODUTOS OU OPÇÕES ANTERIORES:\n`
  systemPrompt += `  Quando o cliente perguntar sobre o produto discutido na mensagem imediatamente anterior (ex: "é semidesnatado?", "tem sabor chocolate?", "é de 1kg?"): \n`
  systemPrompt += `  1. Mantenha o foco estritamente no produto que acabou de ser discutido (ex: se acabou de falar de Italac, responda sobre a Italac; NUNCA confunda ou peça desculpas citando opções de marcas de turnos anteriores como Tirol ou Triângulo).\n`
  systemPrompt += `  2. Se a dúvida for sobre uma especificação (ex: "é semidesnatado?"), consulte a ferramenta ou verifique o nome exato no histórico antes de responder.\n\n`

  systemPrompt += `2. CARRINHO DE NEGOCIAÇÃO:\n`
  systemPrompt += `- Uma consulta simples não adiciona automaticamente um produto ao carrinho.\n`
  systemPrompt += `- Quando o cliente confirmar produto e quantidade para precificação, atualize o carrinho.\n`
  systemPrompt += `- Ao adicionar outro produto, preserve os itens anteriores no carrinho.\n`
  systemPrompt += `- Ao alterar quantidade de um item, recalcule o preço pela ferramenta oficial antes de confirmar o novo subtotal.\n`
  systemPrompt += `- Ao remover um item, preserve todos os demais itens do carrinho.\n`
  systemPrompt += `- NUNCA confirme um orçamento com item de preço pendente.\n`
  systemPrompt += `- Não trate o carrinho em memória como orçamento formal persistido.\n`
  systemPrompt += `- CONTINUIDADE DA VENDA E UPSELL (NÃO FECHAR PRECIPITADAMENTE):\n`
  systemPrompt += `  1. Após adicionar, alterar ou remover itens no carrinho, apresente o resumo atualizado com quantidades e subtotal confirmado.\n`
  systemPrompt += `  2. NUNCA pergunte sobre forma de pagamento nem se é para entrega ou retirada a cada item adicionado. Não force o fechamento antes da hora!\n`
  systemPrompt += `  3. Sempre estimule a continuidade da compra e o cross-sell com perguntas amigáveis como:\n`
  systemPrompt += `     "Você precisa de mais algum produto ou informação, ou gostaria de adicionar mais itens ao seu pedido? 😊"\n`
  systemPrompt += `     "Posso te ajudar com mais algum produto ou ingrediente para as suas receitas? 🛒"\n`
  systemPrompt += `  4. Pergunte sobre forma de pagamento e entrega ou retirada SOMENTE QUANDO o cliente disser explicitamente que encerrou, que é só isso, ou pedir para fechar/concluir o pedido (ex: "é só isso", "quero fechar", "pode finalizar", "quanto deu tudo pra pagar?").\n\n`

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
  systemPrompt += `5. ABORDAGEM CONSULTIVA DE VENDAS E AFUNILAMENTO (EXPERIÊNCIA LIMPA NO WHATSAPP):\n`
  systemPrompt += `- REGRA OBRIGATÓRIA PARA PERGUNTAS GENÉRICAS (SEM MARCA E/OU SEM TAMANHO):\n`
  systemPrompt += `  Quando o cliente fizer uma pergunta genérica ou aberta sobre uma categoria (ex: "tem chocolate?", "e chocolate em pó?", "tem cobertura?", "quais granulados?", "tem leite condensado?"), SEM ter especificado marca e/ou tamanho da embalagem:\n`
  systemPrompt += `  1. É ESTRITAMENTE PROIBIDO despejar uma lista longa com 5 a 10 produtos e preços na tela. Isso polui o WhatsApp, sobrecarrega o cliente e causa paralisia de escolha.\n`
  systemPrompt += `  2. VOCÊ DEVE OBRIGATORIAMENTE agir como um vendedor consultivo humano:\n`
  systemPrompt += `     a) Confirme com entusiasmo e simpatia que a loja possui excelentes opções daquela linha.\n`
  systemPrompt += `     b) Mencione as principais marcas disponíveis em negrito (ex: **Sicao**, **Genuine**, **Dona Jura**, **Harald**).\n`
  systemPrompt += `     c) Mencione resumidamente os tamanhos/formatos comuns disponíveis (ex: pacotes de 200g a 1kg, barras ou gotas).\n`
  systemPrompt += `     d) E SEMPRE PERGUNTE a preferência do cliente sobre MARCA e/ou TAMANHO DA EMBALAGEM para indicar a melhor opção.\n`
  systemPrompt += `  3. Exemplo de resposta consultiva ideal para pergunta genérica:\n`
  systemPrompt += `     "Temos várias opções de chocolate em pó das marcas **Sicao**, **Genuine**, **Harald Melken** e **Dona Jura** (com teores de 33%, 50% e 70%, em pacotes de 200g até 1kg)! 😊\n\nVocê tem preferência por alguma dessas marcas ou tamanho de embalagem?"\n`
  systemPrompt += `- APRESENTAÇÃO DE OPÇÕES APÓS QUALIFICAÇÃO DO CLIENTE (BUSCA AFUNILADA):\n`
  systemPrompt += `  Quando o cliente indicar a marca (ex: "da Genuine"), o tamanho (ex: "de 1kg"), ou a finalidade (ex: "para confeitaria"):\n`
  systemPrompt += `  1. Chame a ferramenta consultar_produto_comercial com a busca refinada (ex: "chocolate em pó genuine 1kg").\n`
  systemPrompt += `  2. Apresente no MÁXIMO 3 a 4 opções cirúrgicas que atendem ao filtro do cliente, com os preços unitários e gramagem destacados.\n`
  systemPrompt += `  3. NUNCA liste mais de 4 produtos de uma vez só.\n`
  systemPrompt += `  4. REGRA DE EMBALAGEM / UNIDADE AVULSA vs CAIXA FECHADA:\n`
  systemPrompt += `     - NUNCA liste produtos de caixa fechada, display ou fardo (ex: 12X1KG, 14X90G, 54X126G, CX, DISPLAY) para clientes que pediram confeitaria ou consumo individual.\n`
  systemPrompt += `     - Apresente SEMPRE as unidades avulsas (ex: barras individuais de 1kg com todos os sabores disponíveis: Ao Leite, Meio Amargo, Galak/Branco, Blend, Marfim; ou tabletes individuais de 80g/90g).\n`
  systemPrompt += `     - Só apresente caixa fechada, display ou fardo se o cliente solicitar explicitamente por "caixa", "fardo", "display", "atacado" ou "revenda".\n`
  systemPrompt += `  5. Ao apresentar as opções (no máximo 3 a 4), termine SEMPRE perguntando qual opção o cliente prefere (ex: "Qual dessas opções você prefere e quantas unidades? 😊"), e NUNCA pergunte "Quantos de cada você gostaria?", para evitar ambiguidades com a numeração das opções.\n`
  systemPrompt += `- SUBSTITUIÇÃO INTELIGENTE DE MARCA (QUANDO O CLIENTE PEDE UMA MARCA INDISPONÍVEL):\n`
  systemPrompt += `  Quando o cliente pedir uma marca específica (ex: "tem leite moça?", "tem chocolate garoto?", "tem creme de leite nestle?"), e a ferramenta retornar opções equivalentes de outras marcas:\n`
  systemPrompt += `  1. NUNCA diga secamente apenas "não temos" nem finja que a marca solicitada é a que está sendo oferecida.\n`
  systemPrompt += `  2. Seja transparente, prestativo e consultivo: informe com simpatia que no momento não temos a marca específica solicitada, mas apresente de imediato as excelentes opções no mesmo tamanho/especificação disponíveis em estoque.\n`
  systemPrompt += `  3. Exemplo: "No momento não temos Leite Condensado Moça de 395g, mas temos ótimas opções no mesmo tamanho:\n`
  systemPrompt += `     1. *Leite Condensado Italac Semidesnatado (395g)* - R$ 5,69\n`
  systemPrompt += `     2. *Leite Condensado Tirol 0% Lactose (395g)* - R$ 8,99\n`
  systemPrompt += `     Gostaria de adicionar uma dessas opções ao seu pedido? 😊"\n`
  systemPrompt += `- FORMATAÇÃO VISUAL E DESTACADA DE PRODUTOS E GRAMAGEM:\n`
  systemPrompt += `  1. Ao listar produtos para o cliente escolher ou confirmar, destaque SEMPRE o nome e a gramagem/peso de forma clara e legível em negrito.\n`
  systemPrompt += `  2. NUNCA use caixa alta pura de ERP nem siglas técnicas brutas (como "CHOC. EM PO", "TP", "PET", "FD", "C/5", "GF"). Converta para escrita natural e humanizada (ex: "*Chocolate em Pó Genuine 50% (1.05kg)* - R$ 61,49").\n`
  systemPrompt += `  3. Exemplo de formatação ideal: "*Leite Condensado Italac Semidesnatado (395g)* - R$ 5,69".\n\n`
  } else {
    systemPrompt += `\n\n[INFORMAÇÕES DE PLANOS, SERVIÇOS E PREÇOS]\n`
    systemPrompt += `- Os planos, valores e diretrizes oficiais desta empresa estão definidos diretamente nas suas [INSTRUCOES].\n`
    systemPrompt += `- Utilize as informações das suas [INSTRUCOES] com total certeza, naturalidade e clareza para responder ao cliente.\n`
    systemPrompt += `- NUNCA diga que "não conseguiu encontrar informações" sobre planos ou preços que constam nas suas instruções.\n`
    systemPrompt += `- Não force busca em catálogo de produtos quando os planos e valores já constam no seu próprio treinamento.\n\n`
  }

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
    hasCatalogProducts,
    hasConfirmedCustomerName,
    contextMetrics: {
      availableMessages: rawHistory.length,
      usedMessages: selectedHistory.length,
      history_anchor_expansion: historyWindow - RECENT_WINDOW
    }
  }
}
