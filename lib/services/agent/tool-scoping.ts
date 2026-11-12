import type { ToolDefinition } from './tools'

/**
 * Normaliza o texto para matching robusto
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
}

/**
 * Padrões conservadores de encerramento e agradecimento.
 * Identifica frases completas sem depender de palavras isoladas como "era" ou "isso".
 */
const CLOSING_PATTERNS = [
  /^(?:muito\s+)?(?:obrigad[oa]|valeu|agradeco)(?:\s+(?:por\s+enquanto|por\s+hoje|era\s+(?:so\s+|apenas\s+)?isso|e\s+(?:so\s+|apenas\s+)?isso|mesmo|demais))?$/,
  /^(?:(?:era|e|foi)\s+(?:so\s+|apenas\s+|somente\s+)?isso)(?:\s+(?:por\s+enquanto|por\s+hoje|obrigad[oa]|valeu))?$/,
  /^(?:por\s+hoje\s+(?:e\s+so|era\s+so|e\s+isso))$/,
  /^(?:somente\s+isso|so\s+isso)(?:\s+(?:mesmo|obrigad[oa]|valeu))?$/
]

/**
 * Regex para unidades de medida com ou sem espaço e com suporte a decimais (vírgula ou ponto).
 * Ex: 1kg, 1 kg, 500g, 500 g, 1,5kg, 1.5 kg, 250ml, 250 ml, 2l, 2 l, 10un, 10 un, 10 und, 10 unidades
 */
const UNIT_MEASURE_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:kg|quilos?|kilos?|g|gramas?|ml|l|litros?|un|und|unidades?)\b/i

/**
 * Padrões de perguntas de prazo, duração e tempo de espera.
 * Expressões como "quanto tempo", "quanto demora", "quanto falta" indicam prazo/duração e NÃO preço comercial.
 */
const TIME_DURATION_PATTERNS = [
  /quanto\s+tempo\b/,
  /quanto\s+(?:tempo\s+)?(?:vai\s+)?demor(?:a|ar|am|aria|ando)\b/,
  /quanto\s+(?:tempo\s+)?(?:vai\s+)?falt(?:a|ar|am)\b/,
  /quanto\s+(?:tempo\s+)?(?:vai\s+)?lev(?:a|ar|am|aria)\b/,
  /\bdemor(?:a|ar|am|aria)\s+quanto\b/
]

function isAskingDuration(msg: string): boolean {
  return TIME_DURATION_PATTERNS.some(p => p.test(msg))
}

/**
 * Padrões explícitos de pedido de atendimento humano ou transferência para pessoa real.
 * Não dispara em perguntas institucionais gerais (ex: "horário de atendimento", "telefone do suporte").
 */
const HANDOFF_PATTERNS = [
  /\b(?:falar|conversar|passa|passe|transfere|transferir|chamar?|manda|encaminh(?:ar?|e))\b.*\b(?:humano|atendente|pessoa|vendedor|vendedora|gerente|consultor|consultora|especialista|suporte|alguem)\b/i,
  /\b(?:quero|preciso|gostaria|prefiro|pode)\b.*\b(?:humano|atendente|pessoa|vendedor|vendedora|gerente|atendimento\s+humano)\b/i,
  /\b(?:atendimento\s+humano|falar\s+com\s+(?:um\s+|uma\s+)?(?:pessoa|alguem|atendente|vendedor|vendedora|gerente)|transferir\s+para\s+(?:um\s+)?humano)\b/i,
  /^(?:sim|ok|beleza|por\s+favor|pfv)?\s*(?:pode\s+)?transfer(?:ir|e)(?:\s+(?:pfv|por\s+favor|sim))?$/i
]

/**
 * Termos institucionais e operacionais que indicam perguntas sobre a empresa,
 * políticas, formas de pagamento, horários ou atendimento, e NÃO consulta a catálogo.
 */
const INSTITUTIONAL_KEYWORDS = [
  'nota', 'fiscal', 'nf', 'danfe', 'cnpj', 'endereco', 'localizacao', 'onde',
  'bairro', 'cidade', 'rua', 'cep', 'telefone', 'contato', 'whatsapp', 'email',
  'pix', 'cartao', 'boleto', 'pagamento', 'pagar', 'parcelamento', 'parcelas',
  'entrega', 'entregam', 'entregar', 'entregas', 'frete', 'envio', 'envia', 'enviam',
  'prazo', 'prazos', 'demora', 'demoram', 'politica', 'troca',
  'atendente', 'humano', 'suporte', 'atendimento'
]

/**
 * Padrões de intenção de remoção de item do carrinho ou orçamento.
 */
const REMOVAL_PATTERNS = [
  /\b(?:tira|tire|retira|retire|remove|remova|exclui|exclua)\s+(?:o|a|os|as|esse|essa|este|esta|aquele|aquela|o\s+item|um|uma|do\s+carrinho|do\s+orcamento|do\s+pedido)\b/i,
  /\b(?:tira|tire|retira|retire|remove|remova|exclui|exclua)\s+[a-z0-9]+/i,
  /\bnao\s+quero\s+mais\b/i,
  /\bcancel(?:a|ar|e)\s+(?:esse|este|o)\s+item\b/i,
  /\bdeixa\s+so\s+(?:o|a|os|as|esse|essa)\b/i
]

/**
 * Padrões de intenção de alteração de quantidade ou orçamento.
 */
const MODIFICATION_PATTERNS = [
  /\b(?:muda|mude|altera|altere|troca|troque)\s+(?:para|pra|por)\s+\d+\b/i,
  /\b(?:muda|mude|altera|altere|atualiza|atualize)\s+(?:o|meu)\s+(?:orcamento|pedido|carrinho)\b/i,
  /\bcoloca\s+\d+\b/i,
  /\bquero\s+\d+\s+(?:unidades?|un|und|caixas?|fardos?|pacotes?|barras?|kilos?|kg|litros?|l)\b/i
]

/**
 * Padrões de intenção de inclusão de produto no carrinho/orçamento.
 */
const INCLUSION_PATTERNS = [
  /\b(?:adiciona|adicione|inclui|inclua|acrescenta|acrescente|bota)\s+(?:mais|tambem|outro|outra|o|a|um|uma|\d+)\b/i,
  /\bcoloca\s+tambem\b/i,
  /\bquero\s+mais\s+um\b/i,
  /\be\s+esse\s+tambem\b/i,
  /\be\s+essa\s+tambem\b/i,
  /\bmais\s+\d+\s+(?:de|do|da|unidades?|caixas?|fardos?|pacotes?)\b/i
]

/**
 * Padrões explícitos de orçamento / cotação.
 */
const QUOTE_PATTERNS = [
  /\b(?:fecha|fechar|atualiza|atualizar|altera|alterar|passa|passar)\s+(?:o|meu|um)?\s*(?:orcamento|cotacao|pedido|total)\b/i,
  /\b(?:resumo|detalhes)\s+(?:do|de)?\s*(?:orcamento|pedido)\b/i
]

/**
 * Padrões de fechamento de pedido, escolha de retirada/entrega ou pagamento.
 */
const ORDER_CLOSURE_PATTERNS = [
  /\b(?:fechar?|finalizar?|concluir?|terminar?)\s+(?:o|meu)?\s*(?:pedido|orcamento|compra)\b/i,
  /\b(?:retirar?|retirada|pegar|buscar)\s+(?:na|em|no|pela)?\s*(?:loja|balcao|estabelecimento)\b/i,
  /\b(?:vou|quero|pode)\s+(?:retirar|ir\s+buscar|pegar)\b/i,
  /\b(?:pagar?|pagamento|pago)\s+(?:no|na|em|via|com|pelo|ato)\b/i,
  /\b(?:passa|manda|envia|qual\s+e)\s+(?:o\s+)?pix\b/i,
  /\b(?:e\s+so\s+isso|so\s+isso|pode\s+fechar|pode\s+finalizar|quanto\s+deu\s+tudo|fechou)\b/i,
  /\b(?:entrega|entregar|envia|enviar)\s+(?:no|na|em|pra|para)\b/i,
  /\b(?:pode\s+mandar\s+entregar|faz\s+a\s+entrega)\b/i
]

/**
 * Verifica se a mensagem possui intenção clara de produto ou consulta comercial.
 * Usado pelo engine para evitar disparar fallbacks determinísticos em mensagens
 * puramente institucionais, encerramentos ou dúvidas gerais.
 */
export function hasClearProductIntent(userMessage: string | undefined): boolean {
  if (!userMessage) return false

  const msg = normalizeText(userMessage)
  if (!msg) return false

  // Se for encerramento ou pedido explícito de atendimento humano, nunca é intenção de produto
  if (CLOSING_PATTERNS.some(p => p.test(msg))) return false
  if (HANDOFF_PATTERNS.some(p => p.test(msg))) return false

  const words = msg.split(/\s+/)
  const GREETINGS = new Set([
    'ola', 'oi', 'tudo', 'bem', 'bom', 'dia', 'boa', 'tarde', 'noite',
    'opa', 'eae', 'obrigado', 'obrigada', 'valeu', 'tchau', 'ate', 'logo',
    'beleza', 'ok', 'certo', 'entendi', 'sim', 'nao', 'aham', 'isso', 'perfeito'
  ])
  if (words.every(w => GREETINGS.has(w))) return false

  // Intenção de preço comercial
  // Expressões de prazo/duração (ex: "quanto tempo", "quanto demora", "quanto falta") não são preço
  const isAskingTimeDuration = isAskingDuration(msg)
  const productPriceKeywords = ['preco', 'valor', 'custa', 'custam', 'fica', 'sair', 'cair']
  const hasPriceIntent = words.some(w => productPriceKeywords.includes(w)) || (!isAskingTimeDuration && words.includes('quanto'))

  // Intenção de quantidade
  const quantityKeywords = ['unidades', 'caixas', 'fardos', 'pacotes']
  const hasQuantityIntent = words.some(w => quantityKeywords.includes(w))

  // Intenção explícita de catálogo / produto (sem "qual" / "quais" e sem "tem" isolado)
  const catalogKeywords = [
    'buscar', 'procura', 'catalogo', 'produto', 'marca',
    'sabor', 'sabores', 'vende', 'vendem', 'trabalham'
  ]
  const productInquiryVerbs = ['tem', 'teria', 'teriam', 'temos', 'vende', 'vendem', 'trabalham', 'trabalha', 'consegue']
  const nonPronounWords = words.filter(w => !INSTITUTIONAL_KEYWORDS.includes(w) && !['tu', 'voce', 'voces', 'vc', 'vcs', 'te', 'ti', 'ele', 'ela', 'tem', 'temos', 'teria', 'teriam', 'ai', 'aqui', 'la', 'de', 'da', 'do', 'um', 'uma', 'o', 'a', 'os', 'as', 'e', 'pra', 'para', 'com', 'sem', 'ainda', 'por', 'acaso'].includes(w))
  const hasProductQueryPattern = words.some(w => productInquiryVerbs.includes(w)) && nonPronounWords.length > 0
  const hasCatalogKeyword = words.some(w => catalogKeywords.includes(w)) || hasProductQueryPattern

  // Unidade de medida explícita (ex: 1kg, 1 kg, 500g, 500 g, 1,5kg, 10 un)
  const hasUnitMeasure = UNIT_MEASURE_REGEX.test(userMessage)

  // Intenções de edição comercial
  const hasEditIntent = REMOVAL_PATTERNS.some(p => p.test(msg)) ||
                        MODIFICATION_PATTERNS.some(p => p.test(msg)) ||
                        INCLUSION_PATTERNS.some(p => p.test(msg)) ||
                        QUOTE_PATTERNS.some(p => p.test(msg))

  const productAttributes = [
    'semidesnatado', 'desnatado', 'integral', 'zero', 'lactose', 'amargo', 'meio amargo',
    'ao leite', 'branco', 'blend', 'marfim', 'diet', 'recheado', 'gotas', 'barra', 'tablete', 'po'
  ]
  const hasAttributeQuery = words.some(w => productAttributes.includes(w))

  const hasExplicitCommercialIntent = hasPriceIntent || hasQuantityIntent || hasCatalogKeyword || hasUnitMeasure || hasEditIntent || hasAttributeQuery

  // Se contiver termos institucionais e NÃO houver intenção comercial explícita, nunca é intenção de produto
  const isInstitutional = words.some(w => INSTITUTIONAL_KEYWORDS.includes(w))
  if (isInstitutional && !hasExplicitCommercialIntent) return false

  return hasExplicitCommercialIntent
}

/**
 * Resolve quais ferramentas devem ser enviadas ao LLM com base na mensagem atual,
 * no histórico e na Working Memory (activeCart e activeQuote), reduzindo cirurgicamente o consumo de tokens.
 */
export interface ToolScopeOptions {
  hasConfirmedCustomerName?: boolean
}

function withCustomerNameTool(
  tools: ToolDefinition[],
  availableTools: ToolDefinition[],
  options?: ToolScopeOptions,
  isClosing?: boolean
): ToolDefinition[] {
  if (options?.hasConfirmedCustomerName !== false || isClosing) {
    return tools
  }
  const nameTool = availableTools.find(t => t.name === 'salvar_nome_cliente')
  if (!nameTool || tools.some(t => t.name === 'salvar_nome_cliente')) {
    return tools
  }
  return [...tools, nameTool]
}

export function resolveToolScope(
  userMessage: string | undefined,
  history: any[],
  availableTools: ToolDefinition[],
  workingMemory?: any,
  options?: ToolScopeOptions
): ToolDefinition[] {
  if (!userMessage) return availableTools

  const msg = normalizeText(userMessage)
  const words = msg.split(/\s+/)

  // 1. Extrair Working Memory primeiro para distinguir saudações vazias de confirmações curtas comerciais
  let wm = workingMemory
  if (!wm && Array.isArray(history)) {
    for (const m of history) {
      if (m.metadata?.working_memory) {
        wm = m.metadata.working_memory
        break
      }
    }
  }

  const hasActiveCart = Boolean(wm?.activeCart && Array.isArray(wm.activeCart) && wm.activeCart.length > 0)
  const hasActiveQuote = Boolean(wm?.activeQuote?.id)
  const hasActiveProduct = Boolean(wm?.activeProduct?.id || wm?.activeProduct?.name)
  const hasDiscoveredProducts = Boolean(wm?.discoveredProducts && Array.isArray(wm.discoveredProducts) && wm.discoveredProducts.length > 0)
  const hasCartOrQuote = hasActiveCart || hasActiveQuote
  const hasCommercialState = hasCartOrQuote || hasActiveProduct || hasDiscoveredProducts

  // 2. Identificar se é Greeting/Encerramento vs Confirmação curta em fluxo comercial ativo
  const GREETINGS = new Set([
    'ola', 'oi', 'tudo', 'bem', 'bom', 'dia', 'boa', 'tarde', 'noite',
    'opa', 'eae', 'obrigado', 'obrigada', 'valeu', 'tchau', 'ate', 'logo',
    'beleza', 'ok', 'certo', 'entendi', 'sim', 'nao', 'aham', 'isso', 'perfeito'
  ])
  const CONFIRMATION_WORDS = new Set([
    'beleza', 'ok', 'certo', 'entendi', 'sim', 'aham', 'isso', 'perfeito'
  ])
  const SHORT_COMMERCIAL_CONFIRMATION_REGEX =
    /^(?:(?:sim|ok|beleza|certo|perfeito|isso|por favor|pfv)\s+)*(?:(?:pode\s+)?(?:gerar|fazer|fechar|mandar|enviar|continuar|seguir)|gera|faz|fecha|fechou|manda|envia|confirmo|confirmado)(?:\s+(?:sim|ok|por\s+favor|pfv|ai|isso|orcamento))?$/i

  const isOnlyGreeting = words.length > 0 && words.every(w => GREETINGS.has(w))
  const isClosing = CLOSING_PATTERNS.some(p => p.test(msg))

  if (isClosing) {
    return withCustomerNameTool([], availableTools, options, true) // Encerramento interrompe o fluxo comercial
  }

  const hasConfirmationWord = words.some(w => CONFIRMATION_WORDS.has(w))
  const isShortConfirmation =
    (isOnlyGreeting && hasConfirmationWord) ||
    SHORT_COMMERCIAL_CONFIRMATION_REGEX.test(msg)

  if (isOnlyGreeting && !(isShortConfirmation && hasCommercialState)) {
    return withCustomerNameTool([], availableTools, options, false) // Retorna imediatamente sem acionar fallbacks comerciais
  }

  // Identifica presença de termos institucionais, perguntas de prazo/duração e pedido explícito de handoff
  const isInstitutional = words.some(w => INSTITUTIONAL_KEYWORDS.includes(w))
  const isAskingTimeDuration = isAskingDuration(msg)
  let hasHandoffIntent = HANDOFF_PATTERNS.some(p => p.test(msg))

  // 3. Extrair Intenções Específicas
  let hasTimeIntent = false
  let hasQuoteIntent = false
  let hasCatalogSearchIntent = false
  let hasProductPriceIntent = false
  let hasQuantityPriceIntent = false
  let hasRemovalIntent = false
  let hasModificationIntent = false
  let hasInclusionIntent = false

  const timeKeywords = ['hora', 'horas', 'horario', 'dia', 'hoje', 'data', 'agora', 'atualmente', 'funcionamento']
  const quoteKeywords = ['orcamento', 'cotacao', 'pedido', 'fechar', 'finalizar', 'resumo']

  // Intenção de preço comercial:
  const productPriceKeywords = ['preco', 'valor', 'custa', 'custam', 'fica', 'sair', 'cair']
  const quantityPriceKeywords = ['unidades', 'caixas', 'fardos', 'pacotes']

  const catalogSearchKeywords = [
    'tem', 'buscar', 'procura', 'catalogo', 'produto', 'marca',
    'opcao', 'opcoes', 'sabor', 'sabores', 'vende', 'vendem', 'temos', 'queria', 'quero', 'gostaria', 'trabalham'
  ]

  for (const w of words) {
    if (timeKeywords.includes(w)) hasTimeIntent = true
    if (quoteKeywords.includes(w)) hasQuoteIntent = true
    if (productPriceKeywords.includes(w)) hasProductPriceIntent = true
    if (!isAskingTimeDuration && w === 'quanto') hasProductPriceIntent = true
    if (quantityPriceKeywords.includes(w)) hasQuantityPriceIntent = true

    if (catalogSearchKeywords.includes(w)) {
      if (!hasHandoffIntent && (!isInstitutional || (w !== 'tem' && w !== 'temos'))) {
        hasCatalogSearchIntent = true
      }
    }
  }

  // "total" indica intenção de orçamento se houver contexto comercial ou menção a orçamento
  if (words.includes('total') && (hasCartOrQuote || hasQuoteIntent || hasProductPriceIntent || hasQuantityPriceIntent)) {
    hasQuoteIntent = true
  }

  // Padrões de regex para orçamento
  if (QUOTE_PATTERNS.some(p => p.test(msg))) {
    hasQuoteIntent = true
  }

  // Padrões de fechamento de pedido / checkout / retirada / pagamento
  const hasOrderClosureIntent = hasCartOrQuote && ORDER_CLOSURE_PATTERNS.some(p => p.test(msg))
  if (hasOrderClosureIntent) {
    hasQuoteIntent = true
    hasHandoffIntent = true
  }

  // Padrões de remoção (ignora conversas como "tira uma duvida", "tira duvida")
  const isQuestionHelp = /\b(?:duvida|foto|print)\b/i.test(msg)
  if (!isQuestionHelp) {
    if (REMOVAL_PATTERNS.some(p => p.test(msg))) {
      hasRemovalIntent = true
    } else if (hasCartOrQuote && /^(?:tira|retira|remove|exclui)(?:\s+(?:esse|essa|este|esta|ele|ela|isso))?$/i.test(msg)) {
      hasRemovalIntent = true
    }
  }

  // Padrões de alteração (apenas quando há quantidade ou alvo claro de orçamento/carrinho)
  if (MODIFICATION_PATTERNS.some(p => p.test(msg))) {
    hasModificationIntent = true
  } else if (hasCartOrQuote && /^(?:muda|mude|altera|altere|troca|troque)\s+(?:pra|para|por)\s+\d+$/i.test(msg)) {
    hasModificationIntent = true
  }

  // Padrões de inclusão
  if (INCLUSION_PATTERNS.some(p => p.test(msg))) {
    hasInclusionIntent = true
  }

  // Unidade de medida aciona intenção de catálogo
  if (UNIT_MEASURE_REGEX.test(userMessage)) {
    hasCatalogSearchIntent = true
  }

  // Se a mensagem for institucional e NÃO tiver intenções comerciais explícitas, bloqueia vazamento de tools comerciais
  if (isInstitutional && !hasProductPriceIntent && !hasQuantityPriceIntent && !hasRemovalIntent && !hasModificationIntent && !hasInclusionIntent && !hasQuoteIntent) {
    const allowedNonCommercial: ToolDefinition[] = []
    if (hasHandoffIntent) {
      const handoffTool = availableTools.find(t => t.name === 'transferir_para_humano')
      if (handoffTool) allowedNonCommercial.push(handoffTool)
    }
    // Apenas permite datetime se perguntou horário de funcionamento
    if (hasTimeIntent) {
      const dtTool = availableTools.find(t => t.name === 'get_current_datetime')
      if (dtTool) allowedNonCommercial.push(dtTool)
    }
    return withCustomerNameTool(allowedNonCommercial, availableTools, options, false)
  }

  // Confirmação curta em contexto comercial ativo preserva ferramentas de orçamento e recálculo
  if (isShortConfirmation && hasCommercialState) {
    if (hasCartOrQuote) {
      hasQuoteIntent = true
      hasProductPriceIntent = true
    } else if (hasActiveProduct || hasDiscoveredProducts) {
      hasProductPriceIntent = true
      hasQuantityPriceIntent = true
      hasQuoteIntent = true
    }
  }

  const selectedTools = new Set<ToolDefinition>()

  // 4. Mapeamento de Intenção para Capability
  for (const tool of availableTools) {
    const name = tool.name
    const category = tool.metadata?.category || 'general'

    if (category === 'datetime' && hasTimeIntent) {
      selectedTools.add(tool)
    }

    if (name === 'transferir_para_humano' && (hasHandoffIntent || hasOrderClosureIntent || hasCartOrQuote)) {
      selectedTools.add(tool)
    }
    
    // Ferramentas de orçamento (gerar_orcamento e consultar_orcamento)
    if (category === 'quotes') {
      if (hasQuoteIntent) {
        selectedTools.add(tool)
      } else if (hasRemovalIntent && hasCartOrQuote) {
        selectedTools.add(tool)
      } else if (hasModificationIntent && (hasActiveQuote || hasActiveCart)) {
        selectedTools.add(tool)
      } else if (hasInclusionIntent && (hasActiveQuote || hasActiveCart)) {
        selectedTools.add(tool)
      } else if (hasActiveCart && (hasQuantityPriceIntent || hasProductPriceIntent)) {
        selectedTools.add(tool)
      }
    }

    // Ferramenta Composta (consultar_produto_comercial)
    if (name === 'consultar_produto_comercial') {
      if (hasProductPriceIntent || hasQuantityPriceIntent || hasModificationIntent || hasInclusionIntent) {
        selectedTools.add(tool)
      } else if (hasRemovalIntent && hasCartOrQuote) {
        selectedTools.add(tool)
      } else if (hasCatalogSearchIntent && (history.length > 0 || !availableTools.some(t => t.name === 'buscar_produto'))) {
        selectedTools.add(tool)
      }
    }

    // Ferramentas de Preço Específico por ID
    if (name === 'consultar_preco') {
      if (hasProductPriceIntent || hasModificationIntent || hasInclusionIntent) {
        selectedTools.add(tool)
      }
    }

    if (name === 'calcular_preco_produto') {
      if (hasProductPriceIntent || hasQuantityPriceIntent || hasModificationIntent || hasInclusionIntent) {
        selectedTools.add(tool)
      }
    }

    // Ferramenta de Busca Simples
    if (name === 'buscar_produto') {
      if ((hasCatalogSearchIntent || hasInclusionIntent) && !hasProductPriceIntent && !hasQuantityPriceIntent && !hasQuoteIntent && !hasModificationIntent) {
        selectedTools.add(tool)
      }
    }
  }

  // 5. Fallback Seguro Contextual
  // Apenas aciona se houver histórico de conversa (continuação de atendimento) e NÃO for institucional, saudação, prazo/duração nem handoff
  if (selectedTools.size === 0 && !isOnlyGreeting && !isClosing && !isInstitutional && !isAskingTimeDuration && !hasHandoffIntent && history.length > 0) {
    const fallbackTool = availableTools.find(t => t.name === 'consultar_produto_comercial')
    if (fallbackTool) selectedTools.add(fallbackTool)
  }

  // 6. Otimização de Conflitos: Se a Composta for carregada, a busca simples perde necessidade
  const hasComercial = Array.from(selectedTools).some(t => t.name === 'consultar_produto_comercial')
  const finalTools = hasComercial
    ? Array.from(selectedTools).filter(t => t.name !== 'buscar_produto')
    : Array.from(selectedTools)

  return withCustomerNameTool(finalTools, availableTools, options, false)
}
