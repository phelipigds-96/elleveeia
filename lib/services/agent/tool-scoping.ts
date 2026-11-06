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
 * Verifica se a mensagem possui intenção clara de produto ou consulta comercial.
 * Usado pelo engine para evitar disparar fallbacks determinísticos em mensagens
 * puramente institucionais, encerramentos ou dúvidas gerais.
 */
export function hasClearProductIntent(userMessage: string | undefined): boolean {
  if (!userMessage) return false

  const msg = normalizeText(userMessage)
  if (!msg) return false

  // Se for encerramento ou apenas saudação, nunca é intenção de produto
  if (CLOSING_PATTERNS.some(p => p.test(msg))) return false

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
  const hasCatalogKeyword = words.some(w => catalogKeywords.includes(w))

  // Unidade de medida explícita (ex: 1kg, 1 kg, 500g, 500 g, 1,5kg, 10 un)
  const hasUnitMeasure = UNIT_MEASURE_REGEX.test(userMessage)

  // Intenções de edição comercial
  const hasEditIntent = REMOVAL_PATTERNS.some(p => p.test(msg)) ||
                        MODIFICATION_PATTERNS.some(p => p.test(msg)) ||
                        INCLUSION_PATTERNS.some(p => p.test(msg)) ||
                        QUOTE_PATTERNS.some(p => p.test(msg))

  const hasExplicitCommercialIntent = hasPriceIntent || hasQuantityIntent || hasCatalogKeyword || hasUnitMeasure || hasEditIntent

  // Se contiver termos institucionais e NÃO houver intenção comercial explícita, nunca é intenção de produto
  const isInstitutional = words.some(w => INSTITUTIONAL_KEYWORDS.includes(w))
  if (isInstitutional && !hasExplicitCommercialIntent) return false

  return hasExplicitCommercialIntent
}

/**
 * Resolve quais ferramentas devem ser enviadas ao LLM com base na mensagem atual,
 * no histórico e na Working Memory (activeCart e activeQuote), reduzindo cirurgicamente o consumo de tokens.
 */
export function resolveToolScope(
  userMessage: string | undefined,
  history: any[],
  availableTools: ToolDefinition[],
  workingMemory?: any
): ToolDefinition[] {
  if (!userMessage) return availableTools

  const msg = normalizeText(userMessage)
  const words = msg.split(/\s+/)

  // 1. Identificar se é apenas Greeting/Confirmação/Encerramento (NÃO precisa de tools, mesmo com histórico)
  const GREETINGS = new Set([
    'ola', 'oi', 'tudo', 'bem', 'bom', 'dia', 'boa', 'tarde', 'noite',
    'opa', 'eae', 'obrigado', 'obrigada', 'valeu', 'tchau', 'ate', 'logo',
    'beleza', 'ok', 'certo', 'entendi', 'sim', 'nao', 'aham', 'isso', 'perfeito'
  ])
  
  const isOnlyGreeting = words.length > 0 && words.every(w => GREETINGS.has(w))
  const isClosing = CLOSING_PATTERNS.some(p => p.test(msg))

  if (isOnlyGreeting || isClosing) {
    return [] // Retorna imediatamente sem acionar fallbacks
  }

  // Identifica presença de termos institucionais e perguntas de prazo/duração
  const isInstitutional = words.some(w => INSTITUTIONAL_KEYWORDS.includes(w))
  const isAskingTimeDuration = isAskingDuration(msg)

  // 2. Extrair Working Memory Operacional (via parâmetro direto ou histórico de mensagens)
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
  const hasCartOrQuote = hasActiveCart || hasActiveQuote

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
      if (!isInstitutional || (w !== 'tem' && w !== 'temos')) {
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

  // Se a mensagem for institucional e NÃO tiver intenções comerciais explícitas, bloqueia vazamento de tools
  if (isInstitutional && !hasProductPriceIntent && !hasQuantityPriceIntent && !hasRemovalIntent && !hasModificationIntent && !hasInclusionIntent && !hasQuoteIntent) {
    // Apenas permite datetime se perguntou horário de funcionamento
    if (hasTimeIntent) {
      const dtTool = availableTools.find(t => t.name === 'get_current_datetime')
      return dtTool ? [dtTool] : []
    }
    return []
  }

  const selectedTools = new Set<ToolDefinition>()

  // 4. Mapeamento de Intenção para Capability
  for (const tool of availableTools) {
    const name = tool.name
    const category = tool.metadata?.category || 'general'

    if (category === 'datetime' && hasTimeIntent) {
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
  // Apenas aciona se houver histórico de conversa (continuação de atendimento) e NÃO for institucional, saudação nem prazo/duração
  if (selectedTools.size === 0 && !isOnlyGreeting && !isClosing && !isInstitutional && !isAskingTimeDuration && history.length > 0) {
    const fallbackTool = availableTools.find(t => t.name === 'consultar_produto_comercial')
    if (fallbackTool) selectedTools.add(fallbackTool)
  }

  // 6. Otimização de Conflitos: Se a Composta for carregada, a busca simples perde necessidade
  const hasComercial = Array.from(selectedTools).some(t => t.name === 'consultar_produto_comercial')
  if (hasComercial) {
    return Array.from(selectedTools).filter(t => t.name !== 'buscar_produto')
  }

  return Array.from(selectedTools)
}
