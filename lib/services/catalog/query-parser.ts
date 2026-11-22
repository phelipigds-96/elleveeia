import { 
  STOP_WORDS, 
  MULTI_WORD_TOKENS, 
  CANONICAL_BRANDS, 
  POPULAR_PRODUCT_MAPPINGS,
  KNOWN_FLAVORS,
  KNOWN_FORMS,
  ALIASES
} from './aliases'
import { encodePtBrPhonetic, areTokensEquivalent } from './phonetics'

export type CommercialIntent = 
  | 'exact_search'
  | 'generic_discovery'
  | 'cost_benefit_comparison'
  | 'cheapest_search'
  | 'recipe_yield_estimate'
  | 'multi_item_order'

export interface StructuredParsedQuery {
  originalQuery: string
  normalizedQuery: string
  intent: CommercialIntent
  identifiers: string[]
  brand: string | null
  requestedBrandUnavailable?: string | null
  category: string | null
  quantity: number
  saleUnit: 'UN' | 'CX' | 'FD' | 'KG' | 'L'
  weight?: {
    value: number
    unit: 'g' | 'kg' | 'ml' | 'l'
    inGramsOrMl: number
  }
  targetCount?: {
    count: number
    itemType: string
  }
  flavor: string | null
  form: string | null
  application: 'casquinha' | 'recheio' | 'cobertura' | 'receita_festa' | 'geral' | 'consumo_individual' | 'revenda'
  restrictions: string[]
  missingAttributes: string[]
  ambiguityLevel: 'none' | 'low' | 'medium' | 'high'
  significantTokens: string[]
  phoneticTokens: string[]
  isCostBenefitQuery: boolean
  isCheapestQuery: boolean
  multiProducts?: StructuredParsedQuery[]
}

const GENERICS = new Set([
  'cobertura', 'chocolate', 'recheio', 'pasta', 'creme', 'po', 'gota', 'gotas',
  'barra', 'pacote', 'caixa', 'unidade', 'fardo', 'produto', 'item', 'lata', 'leite'
])

/**
 * Sanitiza a entrada contra tentativas de prompt injection e caracteres de controle
 */
export function sanitizeSearchInput(input: string): string {
  if (!input) return ''
  return input
    .replace(/\[\s*(?:SISTEMA|SYSTEM|INSTRUCOES|INSTRUCTIONS|PROMPT|OVERRIDE)[^\]]*\]/gi, ' ')
    .replace(/(?:ignore\s+(?:todas?\s+as?\s+)?instruco(?:es|ões)|libere\s+desconto|voce\s+agora\s+e\s+um|esqueca\s+regras)/gi, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normaliza o texto removendo acentos e pontuações
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Segmenta possíveis consultas multi-produto (ex: "2 leite condensado e 1 creme de leite")
 */
export function splitMultiProductQuery(rawQuery: string): string[] {
  const norm = normalizeSearchText(rawQuery)
  
  // Padrão de múltiplos itens unidos por "e", "+", ",", "tambem"
  // Ex: "2 leite condensado italac e 3 creme de leite nestle" ou "1 barra sicao + 2 caixas italac"
  const multiItemPattern = /\b(?:\d+\s*(?:unidades?|un|und|caixas?|cx|barras?|latas?|pcts?)?\s+[a-z0-9\s]+?)\s*(?:e|\+|e\s+tambem|,)\s*(?:\d+\s*(?:unidades?|un|und|caixas?|cx|barras?|latas?|pcts?)?\s+[a-z0-9\s]+)\b/i

  if (!multiItemPattern.test(norm)) {
    return [rawQuery]
  }

  // Divide mantendo as cláusulas
  const parts = norm.split(/\s*(?:\be\s+tambem\b|\be\b|\+|\bmais\b|,)\s*/i)
    .map(p => p.trim())
    .filter(p => p.length > 2)

  // Se cada parte tiver indício de produto/quantidade, retorna as partes
  if (parts.length > 1 && parts.every(p => /\b(?:\d+|leite|choc|barra|creme|cobertura|pacote|caixa)\b/i.test(p))) {
    return parts
  }

  return [rawQuery]
}

/**
 * Parser estruturado e determinístico para consultas comerciais
 */
export function parseStructuredQuery(query: string): StructuredParsedQuery {
  const sanitized = sanitizeSearchInput(query)
  const normalized = normalizeSearchText(sanitized)
  let workingText = normalized

  // 1. Identificadores exatos (Código de barras numérico ou SKU alfanumérico)
  const identifiers: string[] = []
  const rawClean = sanitized.trim()
  const cleanId = rawClean.replace(/\s+/g, '')
  if (/^\d{8,14}$/.test(cleanId)) {
    // Código de barras (EAN-8, EAN-13, EAN-14)
    identifiers.push(cleanId)
  } else if (/^[a-z0-9]{2,}-[a-z0-9\-]+$/i.test(rawClean) || (/^[a-z0-9]{4,15}$/i.test(cleanId) && cleanId.length >= 6 && /\d/.test(cleanId))) {
    identifiers.push(cleanId.toLowerCase())
  }

  // 2. Extração de Quantidade Solicitada (ex: "quero 2 caixas", "3 barras", "5 unidades")
  let quantity = 1
  const qtyMatch = workingText.match(/\b(?:quero|me\s+ve|separa|adiciona|vou\s+querer|preciso\s+de)?\s*(\d+)\s*(?:unidades?|un|und|pecas?|pçs?|itens?|barras?|latas?|pacotes?|pcts?)\b/i)
  if (qtyMatch) {
    const qVal = parseInt(qtyMatch[1], 10)
    if (qVal > 0 && qVal < 10000) {
      quantity = qVal
    }
  }

  // 3. Detecção de Contagem de Receitas / Peças para Festas (ex: "200 doces", "100 brigadeiros", "50 pessoas")
  // REGRA DE OURO: NUNCA confundir contagem de doces com peso em gramas (200 doces NÃO É 200g!)
  let targetCount: { count: number; itemType: string } | undefined
  const countPattern = /\b(\d+)\s*(doces?|brigadeiros?|salgados?|pessoas?|convidados?|lembrancinhas?|trufas?|bombons?|bolos?|ovos?)\b/i
  const countMatch = workingText.match(countPattern)
  if (countMatch) {
    targetCount = {
      count: parseInt(countMatch[1], 10),
      itemType: countMatch[2].toLowerCase()
    }
    workingText = workingText.replace(countMatch[0], ' ')
  }

  const recipeActionPattern = /\b(?:fazer|preparar|produzir|atender|servir|encomenda\s+de)\s+(\d+)\b/i
  const recipeActionMatch = workingText.match(recipeActionPattern)
  if (recipeActionMatch && !targetCount) {
    targetCount = {
      count: parseInt(recipeActionMatch[1], 10),
      itemType: 'doces'
    }
    workingText = workingText.replace(recipeActionMatch[0], ' ')
  }

  // 4. Detecção de Intenções Especiais (Custo-Benefício, Mais Barato, Casquinha/Aplicação)
  const isCostBenefitQuery = /\b(?:qual\s+compensa\s+mais|compensa\s+mais|mais\s+em\s+conta|melhor\s+custo\s+beneficio|mais\s+economico|economizar|qual\s+compensa)\b/i.test(normalized)
  const isCheapestQuery = /\b(?:o\s+mais\s+barato|mais\s+barato|mais\s+barata|menor\s+preco|mais\s+em\s+conta)\b/i.test(normalized)

  let application: StructuredParsedQuery['application'] = 'geral'
  if (/\b(?:casquinha|casquinhas|ovo\s+de\s+pascoa|ovos\s+de\s+pascoa|moldar|moldagem|banhar|banho)\b/i.test(normalized)) {
    application = 'casquinha'
  } else if (/\b(?:recheio|rechear|recheios|para\s+recheio)\b/i.test(normalized)) {
    application = 'recheio'
  } else if (/\b(?:cobertura|cobrir|decorar|decoracao)\b/i.test(normalized)) {
    application = 'cobertura'
  } else if (targetCount || /\b(?:festa|doces\s+para\s+festa|receita|producao)\b/i.test(normalized)) {
    application = 'receita_festa'
  }

  // 5. Unidade de Venda e Intenção de Atacado / Caixa Fechada vs Varejo
  let saleUnit: StructuredParsedQuery['saleUnit'] = 'UN'
  if (/\b(?:caixa\s+fechada|fardo|fardos|display|displays|atacado|revenda)\b/i.test(normalized) || /\b(?:cx|caixa|caixas)\b/i.test(normalized)) {
    saleUnit = 'CX'
  }

  // 6. Expansão de Nomes Populares (ex: "leite moça" -> Leite Condensado Nestlé, "pó royal" -> Fermento Royal)
  let brand: string | null = null
  let category: string | null = null

  for (const [popularKey, mapping] of Object.entries(POPULAR_PRODUCT_MAPPINGS)) {
    if (workingText.includes(popularKey)) {
      if (mapping.brand) brand = mapping.brand
      if (mapping.category) category = mapping.category
      workingText = workingText.replace(new RegExp(`\\b${popularKey}\\b`, 'g'), mapping.queryExpansion)
    }
  }

  // 7. Extração de Multi-Word Tokens conhecidos
  for (const mw of MULTI_WORD_TOKENS) {
    for (const variant of mw.variants) {
      if (workingText.includes(variant)) {
        if (mw.brand && !brand) brand = mw.brand
        if (mw.category && !category) category = mw.category
        workingText = workingText.replace(new RegExp(`\\b${variant}\\b`, 'g'), ` ${mw.canonical} `)
      }
    }
  }

  // 8. Extração de Marca Canônica (com suporte a variantes e tolerância fonética/typo)
  if (!brand) {
    for (const [key, bData] of Object.entries(CANONICAL_BRANDS)) {
      // Checagem de variantes diretas
      for (const v of bData.variants) {
        if (new RegExp(`\\b${v}\\b`, 'i').test(workingText)) {
          brand = bData.canonical
          workingText = workingText.replace(new RegExp(`\\b${v}\\b`, 'gi'), ' ')
          break
        }
      }
      if (brand) break

      // Checagem fonética e typo em cada palavra do workingText
      const words = workingText.split(/\s+/).filter(w => w.length >= 4)
      for (const w of words) {
        const eq = areTokensEquivalent(w, key)
        if (eq.isMatch) {
          brand = bData.canonical
          workingText = workingText.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ')
          break
        }
      }
      if (brand) break
    }
  }

  // 9. Extração de Peso e Volume (com conversão padronizada g <-> kg, ml <-> l)
  let weight: StructuredParsedQuery['weight'] | undefined
  const weightMatches = workingText.match(/\b(\d+(?:[.,]\d+)?)\s*(kg|k|g|gr|gramas?|ml|l|lt|litros?)\b/i)
  if (weightMatches) {
    const rawNum = parseFloat(weightMatches[1].replace(',', '.'))
    const rawUnit = weightMatches[2].toLowerCase()

    if (['kg', 'k', 'quilo', 'quilos'].includes(rawUnit)) {
      weight = {
        value: rawNum,
        unit: 'kg',
        inGramsOrMl: Math.round(rawNum * 1000)
      }
    } else if (['g', 'gr', 'grama', 'gramas'].includes(rawUnit)) {
      weight = {
        value: rawNum,
        unit: 'g',
        inGramsOrMl: rawNum
      }
    } else if (['l', 'lt', 'litro', 'litros'].includes(rawUnit)) {
      weight = {
        value: rawNum,
        unit: 'l',
        inGramsOrMl: Math.round(rawNum * 1000)
      }
    } else if (rawUnit === 'ml') {
      weight = {
        value: rawNum,
        unit: 'ml',
        inGramsOrMl: rawNum
      }
    }

    workingText = workingText.replace(weightMatches[0], ' ')
  }

  // Números isolados que representam gramagens típicas no varejo (395, 400, 800, 1000, 200, 500)
  if (!weight && !targetCount) {
    const isolatedNumMatch = workingText.match(/\b(395|400|800|1000|200|250|500|126|90|80|1050|2050)\b/)
    if (isolatedNumMatch) {
      const val = parseInt(isolatedNumMatch[1], 10)
      weight = {
        value: val,
        unit: 'g',
        inGramsOrMl: val
      }
      workingText = workingText.replace(isolatedNumMatch[0], ' ')
    }
  }

  // 10. Extração de Sabor / Variante
  let flavor: string | null = null
  for (const f of KNOWN_FLAVORS) {
    if (new RegExp(`\\b${f}\\b`, 'i').test(workingText)) {
      flavor = f
      workingText = workingText.replace(new RegExp(`\\b${f}\\b`, 'gi'), ' ')
      break
    }
  }

  // 11. Extração de Forma / Apresentação
  let form: string | null = null
  for (const fm of KNOWN_FORMS) {
    if (new RegExp(`\\b${fm}\\b`, 'i').test(workingText)) {
      form = fm
      workingText = workingText.replace(new RegExp(`\\b${fm}\\b`, 'gi'), ' ')
      break
    }
  }

  // 12. Extração de Restrições Explícitas (ex: "sem lactose", "sem açúcar", "não pode ser fracionada")
  const restrictions: string[] = []
  if (/\b(?:sem\s+lactose|zero\s+lactose)\b/i.test(normalized)) {
    restrictions.push('zero_lactose')
  }
  if (/\b(?:sem\s+acucar|zero\s+acucar|diet)\b/i.test(normalized)) {
    restrictions.push('zero_acucar')
  }
  if (/\b(?:nao\s+pode\s+ser\s+fracionad[ao]|sem\s+fracionad[ao]|nobre\s+puro)\b/i.test(normalized)) {
    restrictions.push('somente_nobre')
  }

  // 13. Tokens Significativos e Fonéticos Restantes
  const words = workingText
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0 && !STOP_WORDS.has(w))

  const significantTokens: string[] = []
  const phoneticTokens: string[] = []

  for (const w of words) {
    significantTokens.push(w)
    const ph = encodePtBrPhonetic(w)
    if (ph) phoneticTokens.push(ph)
  }

  // 14. Classificação de Intenção Comercial
  let intent: CommercialIntent = 'exact_search'
  if (identifiers.length > 0) {
    intent = 'exact_search'
  } else if (isCostBenefitQuery) {
    intent = 'cost_benefit_comparison'
  } else if (isCheapestQuery) {
    intent = 'cheapest_search'
  } else if (targetCount && !brand && !weight) {
    intent = 'recipe_yield_estimate'
  } else if (!brand && !weight && !flavor && significantTokens.length <= 2 && (significantTokens.every(t => GENERICS.has(t)) || significantTokens.length === 0)) {
    intent = 'generic_discovery'
  }

  // 15. Atributos Faltantes e Grau de Ambiguidade
  const missingAttributes: string[] = []
  if (!brand) missingAttributes.push('brand')
  if (!weight) missingAttributes.push('weight')
  if (!flavor && (category === 'Chocolate Nobre' || category === 'Cobertura' || category === 'Laticínios')) {
    missingAttributes.push('flavor')
  }

  let ambiguityLevel: StructuredParsedQuery['ambiguityLevel'] = 'none'
  if (intent === 'generic_discovery') {
    ambiguityLevel = 'high'
  } else if (missingAttributes.length >= 2) {
    ambiguityLevel = 'medium'
  } else if (missingAttributes.length === 1) {
    ambiguityLevel = 'low'
  }

  // 16. Sub-consultas multi-produto
  const subQueries = splitMultiProductQuery(query)
  let multiProducts: StructuredParsedQuery[] | undefined
  if (subQueries.length > 1) {
    multiProducts = subQueries.map(sq => parseStructuredQuery(sq))
    intent = 'multi_item_order'
  }

  return {
    originalQuery: query,
    normalizedQuery: normalized,
    intent,
    identifiers,
    brand,
    category,
    quantity,
    saleUnit,
    weight,
    targetCount,
    flavor,
    form,
    application,
    restrictions,
    missingAttributes,
    ambiguityLevel,
    significantTokens,
    phoneticTokens,
    isCostBenefitQuery,
    isCheapestQuery,
    multiProducts
  }
}
