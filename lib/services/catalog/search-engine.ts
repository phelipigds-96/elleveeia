import { 
  parseStructuredQuery, 
  type StructuredParsedQuery,
  sanitizeSearchInput,
  normalizeSearchText 
} from './query-parser'
import { areTokensEquivalent, extractTrigrams, calculateTrigramSimilarity } from './phonetics'
import { extractWeightInKg } from '../agent/commercial-strategy'

export interface StructuredProductCandidate {
  id: string
  name: string
  brand: string | null
  category: string | null
  unit: string | null
  sku?: string | null
  barcode?: string | null
  active?: boolean
  company_id?: string
}

export interface VerifiedAttributes {
  brand?: string
  weight?: { value: number; unit: string }
  flavor?: string
  form?: string
  packaging?: 'unit' | 'wholesale'
}

export interface StructuredProductMatch {
  id: string
  name: string
  officialName: string
  brand: string | null
  category: string | null
  unit: string | null
  sku: string | null
  barcode: string | null
  companyId?: string
  active: boolean
  matchType: 'exact_match' | 'probable_match' | 'compatible_alternative' | 'ambiguous' | 'not_found'
  score: number
  confidence: number
  justification: string
  verifiedAttributes: VerifiedAttributes
  pendingAttributes?: string[]
  match_score?: number // compatibilidade retroativa
}

export interface IntelligentSearchResponse {
  status: 'exact_match' | 'probable_match' | 'compatible_alternative' | 'ambiguous' | 'not_found'
  confidence: number
  parsedQuery: StructuredParsedQuery
  matches: StructuredProductMatch[]
  differentiatingQuestion?: string
  alternativeRecommendation?: {
    originalBrandRequested: string
    suggestedAlternative: StructuredProductMatch
    reason: string
  }
}

/**
 * Normaliza o nome do produto no catálogo, corrigindo truncamentos clássicos de ERPs
 */
export function normalizeCatalogName(name: string): string {
  if (!name) return ''
  let fixed = name.trim()
  if (fixed.length >= 37) {
    if (fixed.endsWith(' 39')) fixed += '5G'
    else if (fixed.endsWith(' 395')) fixed += 'G'
    else if (fixed.endsWith(' 27X395')) fixed += 'G'
    else if (fixed.endsWith(' 27')) fixed += 'X395G'
    else if (fixed.endsWith(' 2.')) fixed += '5KG'
    else if (fixed.endsWith(' 200')) fixed += 'G'
    else if (fixed.endsWith(' 90')) fixed += 'G'
  }
  return fixed
}

/**
 * Extrai gramagem/mililitros aproximados do nome do produto no catálogo
 */
export function extractProductWeightInGrams(name: string): number | null {
  const norm = name.toUpperCase()
  const matchKg = norm.match(/\b(\d+(?:[.,]\d+)?)\s*KG\b/)
  if (matchKg) {
    return Math.round(parseFloat(matchKg[1].replace(',', '.')) * 1000)
  }
  const matchG = norm.match(/\b(\d+)\s*G\b/)
  if (matchG) {
    return parseInt(matchG[1], 10)
  }
  const matchL = norm.match(/\b(\d+(?:[.,]\d+)?)\s*L\b/)
  if (matchL) {
    return Math.round(parseFloat(matchL[1].replace(',', '.')) * 1000)
  }
  const matchMl = norm.match(/\b(\d+)\s*ML\b/)
  if (matchMl) {
    return parseInt(matchMl[1], 10)
  }
  return null
}

/**
 * Avalia e pontua um produto contra a consulta estruturada de forma interpretável e determinística
 */
export function evaluateCandidateScore(
  candidate: StructuredProductCandidate,
  parsed: StructuredParsedQuery,
  allCatalogBrands: Set<string>
): { score: number; confidence: number; justification: string; verifiedAttributes: VerifiedAttributes; isCompatibleAlternative: boolean; isBrandMismatch: boolean } {
  const cleanName = normalizeCatalogName(candidate.name)
  // Higieniza contra prompt injection no nome do produto
  const sanitizedName = sanitizeSearchInput(cleanName)
  const normName = normalizeSearchText(sanitizedName)
  const paddedName = ` ${normName} `
  
  const brandNorm = candidate.brand ? normalizeSearchText(candidate.brand) : ''
  const catNorm = candidate.category ? normalizeSearchText(candidate.category) : ''

  let score = 0
  let penalty = 0
  const reasons: string[] = []
  const verifiedAttributes: VerifiedAttributes = {}
  let isCompatibleAlternative = false
  let isBrandMismatch = false

  // 1. Identificadores exatos (Código de barras ou SKU)
  if (parsed.identifiers.length > 0) {
    const id = parsed.identifiers[0].toLowerCase()
    const matchBarcode = candidate.barcode && candidate.barcode.toLowerCase() === id
    const matchSku = candidate.sku && candidate.sku.toLowerCase() === id
    if (matchBarcode || matchSku) {
      return {
        score: 100,
        confidence: 1.0,
        justification: `Correspondência exata por código (${matchBarcode ? 'Código de barras' : 'SKU'}: ${id})`,
        verifiedAttributes: { brand: candidate.brand || undefined },
        isCompatibleAlternative: false,
        isBrandMismatch: false
      }
    }
  }

  // 2. Avaliação de Marca Solicitada
  if (parsed.brand) {
    const requestedBrandNorm = normalizeSearchText(parsed.brand)
    const brandMatches = brandNorm.includes(requestedBrandNorm) || paddedName.includes(` ${requestedBrandNorm} `)
    
    if (brandMatches) {
      score += 40
      verifiedAttributes.brand = parsed.brand
      reasons.push(`Marca ${parsed.brand} confirmada (+40)`)
    } else {
      isBrandMismatch = true
      // O cliente pediu uma marca explícita, mas o produto é de outra marca
      const isBrandAvailableInCatalog = allCatalogBrands.has(requestedBrandNorm)
      
      if (!isBrandAvailableInCatalog) {
        // A marca solicitada não existe na loja -> Pode ser alternativa comercial compatível
        isCompatibleAlternative = true
        penalty += 15 // Leve penalidade para permitir apresentação como alternativa
        reasons.push(`Marca solicitada (${parsed.brand}) não disponível no catálogo; avaliado como alternativa (-15)`)
      } else {
        // A marca solicitada EXISTE na loja, mas este produto é de outra -> Penaliza severamente
        penalty += 50
        reasons.push(`Marca divergente (solicitado: ${parsed.brand}, produto: ${candidate.brand || 'outra'}) (-50)`)
      }
    }
  } else if (candidate.brand) {
    score += 10
    verifiedAttributes.brand = candidate.brand
  }

  // 3. Avaliação de Categoria / Insumo Primário
  if (parsed.category) {
    const requestedCatNorm = normalizeSearchText(parsed.category)
    if (catNorm.includes(requestedCatNorm) || paddedName.includes(` ${requestedCatNorm} `)) {
      score += 25
      reasons.push(`Categoria ${parsed.category} confirmada (+25)`)
    }
  }

  // 4. Avaliação de Sabor / Variante
  if (parsed.flavor) {
    const reqFlavorNorm = normalizeSearchText(parsed.flavor)
    const flavorMatches = paddedName.includes(` ${reqFlavorNorm} `)
    
    if (flavorMatches) {
      score += 35
      verifiedAttributes.flavor = parsed.flavor
      reasons.push(`Sabor/variante ${parsed.flavor} confirmado (+35)`)
    } else {
      // Se o cliente pediu sabor específico (ex: meio amargo, branco, zero lactose) e o produto é outro
      penalty += 40
      reasons.push(`Sabor/variante divergente (solicitado: ${parsed.flavor}) (-40)`)
    }
  }

  // 5. Restrições Explícitas (ex: Zero Lactose)
  if (parsed.restrictions.includes('zero_lactose')) {
    const isZeroLactose = /\b(?:zero\s+lactose|0\s+lactose|sem\s+lactose|0%\s+lactose)\b/i.test(cleanName)
    if (isZeroLactose) {
      score += 40
      verifiedAttributes.flavor = 'zero lactose'
      reasons.push(`Restrição alimentar Zero Lactose atendida (+40)`)
    } else {
      penalty += 60 // Penalidade extrema: produto convencional NÃO atende restrição médica/dietética
      reasons.push(`Não atende restrição médica Zero Lactose (-60)`)
    }
  }

  // 6. Avaliação de Forma / Apresentação (Barra vs Gotas vs Pó vs Fracionada vs Nobre)
  if (parsed.form) {
    const reqFormNorm = normalizeSearchText(parsed.form)
    const formMatches = paddedName.includes(` ${reqFormNorm} `)

    if (formMatches) {
      score += 30
      verifiedAttributes.form = parsed.form
      reasons.push(`Formato ${parsed.form} confirmado (+30)`)
    } else {
      // Conflito entre Nobre e Fracionada
      const isReqNobre = parsed.form === 'nobre' || parsed.restrictions.includes('somente_nobre')
      const isProdFracionada = /\b(?:fracionad[ao]|cobertura)\b/i.test(cleanName)
      const isProdNobre = /\b(?:nobre|puro)\b/i.test(cleanName) || catNorm.includes('nobre')

      if (isReqNobre && isProdFracionada) {
        penalty += 55 // Nobre x Fracionada não pode misturar
        reasons.push(`Solicitado chocolate nobre, mas produto é cobertura fracionada (-55)`)
      } else if (parsed.form === 'fracionada' && isProdNobre) {
        penalty += 40
        reasons.push(`Solicitada cobertura fracionada, mas produto é chocolate nobre (-40)`)
      } else if (parsed.form === 'po' && /\b(?:barra|gotas?|tablete)\b/i.test(cleanName)) {
        penalty += 50 // Solicitado em pó, produto em barra/gotas
        reasons.push(`Solicitado produto em pó, mas o produto é ${cleanName.includes('barra') ? 'em barra' : 'em gotas'} (-50)`)
      } else if ((parsed.form === 'barra' || parsed.form === 'gotas') && /\bpo\b/i.test(cleanName)) {
        penalty += 50
        reasons.push(`Solicitado produto sólido, mas produto é em pó (-50)`)
      } else if (parsed.form === 'barra' && /\bgotas?\b/i.test(cleanName)) {
        penalty += 25
        reasons.push(`Solicitada barra, produto em gotas (-25)`)
      } else if (parsed.form === 'gotas' && /\bbarra\b/i.test(cleanName)) {
        penalty += 25
        reasons.push(`Solicitadas gotas, produto em barra (-25)`)
      }
    }
  }

  // 7. Avaliação de Peso / Volume (com conversão padronizada 1kg = 1000g, 1L = 1000ml)
  if (parsed.weight) {
    const prodWeightGrams = extractProductWeightInGrams(cleanName)

    if (prodWeightGrams !== null) {
      const reqGrams = parsed.weight.inGramsOrMl
      const delta = Math.abs(prodWeightGrams - reqGrams)

      if (delta === 0) {
        score += 40
        verifiedAttributes.weight = { value: parsed.weight.value, unit: parsed.weight.unit }
        reasons.push(`Peso exato (${parsed.weight.value}${parsed.weight.unit}) confirmado (+40)`)
      } else if (delta <= 50 && reqGrams >= 900) {
        // Tolerância de mercado para embalagens comerciais (1.01kg, 1.05kg para 1kg)
        score += 35
        verifiedAttributes.weight = { value: parsed.weight.value, unit: parsed.weight.unit }
        reasons.push(`Peso compatível de mercado (~${parsed.weight.value}${parsed.weight.unit}) (+35)`)
      } else if (delta <= 15 && reqGrams <= 400) {
        // Reduflação de mercado: 390g, 395g, 400g
        score += 35
        verifiedAttributes.weight = { value: parsed.weight.value, unit: parsed.weight.unit }
        reasons.push(`Gramagem comercial próxima (${prodWeightGrams}g) (+35)`)
      } else {
        penalty += 35
        reasons.push(`Divergência de peso (solicitado: ${reqGrams}g, produto: ${prodWeightGrams}g) (-35)`)
      }
    }
  }

  // 8. Avaliação de Embalagem (Unidade Avulsa vs Caixa Fechada / Atacado)
  const isWholesalePack = /\b\d+\s*x\s*\d+|\b(?:cx|caixa|caixas|fardo|fardos|display|displays|fd)\b/i.test(cleanName)
  const requestedWholesale = parsed.saleUnit === 'CX'

  if (isWholesalePack && !requestedWholesale) {
    penalty += 45 // Penaliza caixa fechada para cliente de varejo
    reasons.push(`Embalagem de atacado/caixa para solicitação de unidade avulsa (-45)`)
  } else if (!isWholesalePack && requestedWholesale) {
    penalty += 30 // Penaliza unidade avulsa para cliente que pediu caixa fechada
    reasons.push(`Unidade avulsa para solicitação de caixa/atacado (-30)`)
  } else if (isWholesalePack && requestedWholesale) {
    score += 30
    verifiedAttributes.packaging = 'wholesale'
    reasons.push(`Embalagem de atacado/caixa confirmada (+30)`)
  }

  // 9. Aplicação Pretendida (Casquinha de Páscoa / Moldagem vs Recheio)
  if (parsed.application === 'casquinha') {
    const isCoverage = /\b(?:cobertura|fracionad[ao]|top|sicao\s+mais)\b/i.test(cleanName)
    const isNobre = /\b(?:nobre|callebaut|melken)\b/i.test(cleanName) || catNorm.includes('nobre')

    if (isCoverage) {
      score += 40
      reasons.push(`Adequado para casquinhas e moldagem rápida sem têmpera (cobertura fracionada) (+40)`)
    } else if (isNobre) {
      penalty += 35
      reasons.push(`Chocolate nobre requer têmpera para casquinha (-35)`)
    }
  }

  // 10. Produtos Derivados Indesejados (ex: "bombom de leite condensado" para busca "leite condensado")
  const DERIVATIVE_PREFIXES = /\b(?:bombom|bombons|bala|balas|cocada|cocadas|fondant|picole|picoles|biscoito|biscoitos|cookies)\b/i
  const isDerivative = DERIVATIVE_PREFIXES.test(cleanName)
  const requestedDerivative = DERIVATIVE_PREFIXES.test(parsed.originalQuery)

  if (isDerivative && !requestedDerivative) {
    penalty += 50
    reasons.push(`Produto derivado/doce pronto para busca de ingrediente básico (-50)`)
  }

  // 11. Bônus por Tokens Significativos / Tolerância Fonética / Typos
  for (const token of parsed.significantTokens) {
    const wordsInName = normName.split(/\s+/).filter(w => w.length >= 3)
    let tokenMatched = false

    for (const w of wordsInName) {
      const eq = areTokensEquivalent(token, w)
      if (eq.isMatch) {
        tokenMatched = true
        if (eq.method === 'exact') {
          score += 15
        } else if (eq.method === 'typo' || eq.method === 'phonetic') {
          score += 12
          reasons.push(`Token "${token}" reconhecido via correção (${eq.method}: "${w}") (+12)`)
        }
        break
      }
    }

    if (!tokenMatched && !isCompatibleAlternative) {
      // Se o token for longo (>= 4 caracteres) e não bateu em nada
      if (token.length >= 4) {
        penalty += 10
      }
    }
  }

  const finalScore = score - penalty
  const confidence = Math.max(0, Math.min(1.0, 1.0 - (penalty / 60)))

  return {
    score: finalScore,
    confidence,
    justification: reasons.join('; '),
    verifiedAttributes,
    isCompatibleAlternative,
    isBrandMismatch
  }
}

/**
 * Motor Principal de Busca Inteligente de Produtos da Ellevee IA
 */
export function rankProductsIntelligently(
  query: string,
  candidates: StructuredProductCandidate[]
): IntelligentSearchResponse {
  const parsed = parseStructuredQuery(query)

  if (!candidates || candidates.length === 0) {
    return {
      status: 'not_found',
      confidence: 0,
      parsedQuery: parsed,
      matches: []
    }
  }

  // Mapeia todas as marcas existentes no catálogo desta empresa
  const catalogBrands = new Set<string>()
  for (const c of candidates) {
    if (c.brand) catalogBrands.add(normalizeSearchText(c.brand))
  }

  // 1. Identificador exato imediato
  if (parsed.identifiers.length > 0) {
    const rawId = parsed.identifiers[0].toLowerCase()
    const exact = candidates.find(
      c => (c.barcode && c.barcode.toLowerCase() === rawId) || 
           (c.sku && c.sku.toLowerCase() === rawId)
    )

    if (exact) {
      const cleanName = sanitizeSearchInput(normalizeCatalogName(exact.name))
      const match: StructuredProductMatch = {
        id: exact.id,
        name: cleanName,
        officialName: cleanName,
        brand: exact.brand,
        category: exact.category,
        unit: exact.unit,
        sku: exact.sku || null,
        barcode: exact.barcode || null,
        companyId: exact.company_id,
        active: exact.active !== false,
        matchType: 'exact_match',
        score: 100,
        confidence: 1.0,
        justification: `Correspondência exata por código (${exact.barcode?.toLowerCase() === rawId ? 'Código de barras' : 'SKU'}: ${rawId})`,
        verifiedAttributes: { brand: exact.brand || undefined },
        match_score: 100
      }

      return {
        status: 'exact_match',
        confidence: 1.0,
        parsedQuery: parsed,
        matches: [match]
      }
    }
  }

  // 2. Pontuação de todos os candidatos
  const evaluated = candidates.map(c => {
    const res = evaluateCandidateScore(c, parsed, catalogBrands)
    const cleanName = sanitizeSearchInput(normalizeCatalogName(c.name))
    return {
      candidate: c,
      officialName: cleanName,
      ...res
    }
  })

  // Filtra apenas com score positivo e ordena descrescente
  const positive = evaluated.filter(e => e.score > 0 && e.confidence >= 0.40)
  positive.sort((a, b) => b.score - a.score)

  if (positive.length === 0) {
    return {
      status: 'not_found',
      confidence: 0,
      parsedQuery: parsed,
      matches: []
    }
  }

  const top = positive[0]

  // 3. Classificação do Status Geral e Resolução de Ambiguidade
  let overallStatus: IntelligentSearchResponse['status'] = 'exact_match'
  let differentiatingQuestion: string | undefined
  let alternativeRecommendation: IntelligentSearchResponse['alternativeRecommendation'] | undefined

  // Caso A: Marca solicitada não existe no catálogo, mas encontramos alternativas compatíveis
  if (top.isCompatibleAlternative && parsed.brand) {
    overallStatus = 'compatible_alternative'
    alternativeRecommendation = {
      originalBrandRequested: parsed.brand,
      suggestedAlternative: {
        id: top.candidate.id,
        name: top.officialName,
        officialName: top.officialName,
        brand: top.candidate.brand,
        category: top.candidate.category,
        unit: top.candidate.unit,
        sku: top.candidate.sku || null,
        barcode: top.candidate.barcode || null,
        companyId: top.candidate.company_id,
        active: top.candidate.active !== false,
        matchType: 'compatible_alternative',
        score: top.score,
        confidence: top.confidence,
        justification: top.justification,
        verifiedAttributes: top.verifiedAttributes,
        match_score: top.score
      },
      reason: `A marca "${parsed.brand}" não consta no catálogo desta loja. Sugerida opção equivalente da marca ${top.candidate.brand || 'disponível'}.`
    }
  } 
  // Caso B: Ambiguidade Real (Múltiplos produtos excelentes disputando com diferença de score <= 8)
  else if (positive.length > 1 && (top.score - positive[1].score) <= 8 && (!parsed.flavor || !parsed.brand || top.confidence < 0.95)) {
    const candidateA = top
    const candidateB = positive[1]

    // Identifica o que diferencia os dois produtos (Sabor? Peso? Marca?)
    const extractFlavorFromName = (name: string) => {
      const n = name.toLowerCase()
      const flavors = ['ao leite', 'meio amargo', 'amargo', 'branco', 'blend', 'zero lactose', 'semidesnatado', 'integral']
      for (const f of flavors) {
        if (n.includes(f)) return f
      }
      return undefined
    }

    const flavorA = candidateA.verifiedAttributes.flavor || extractFlavorFromName(candidateA.candidate.name)
    const flavorB = candidateB.verifiedAttributes.flavor || extractFlavorFromName(candidateB.candidate.name)
    const brandA = candidateA.candidate.brand
    const brandB = candidateB.candidate.brand

    if (flavorA && flavorB && flavorA !== flavorB) {
      differentiatingQuestion = `Você tem preferência pelo sabor **${flavorA}** ou **${flavorB}**? 😊`
      overallStatus = 'ambiguous'
    } else if (brandA && brandB && brandA !== brandB) {
      differentiatingQuestion = `Temos opções das marcas **${brandA}** e **${brandB}**. Você prefere alguma delas? 😊`
      overallStatus = 'ambiguous'
    } else {
      overallStatus = 'ambiguous'
      differentiatingQuestion = 'Temos diferentes opções disponíveis. Qual delas melhor atende a sua receita? 😊'
    }
  }
  // Caso C: Match Provável (boa confiança, mas falta atributo ou pontuação média)
  else if (top.confidence < 0.85 || top.score < 50) {
    overallStatus = 'probable_match'
  }

  // 4. Mapeamento dos resultados com contratos tipados
  const formattedMatches: StructuredProductMatch[] = positive.slice(0, 10).map((p, idx) => {
    let matchType: StructuredProductMatch['matchType'] = 'probable_match'
    if (idx === 0) {
      matchType = overallStatus
    } else if (p.isCompatibleAlternative) {
      matchType = 'compatible_alternative'
    } else if (overallStatus === 'ambiguous') {
      matchType = 'ambiguous'
    }

    return {
      id: p.candidate.id,
      name: p.officialName,
      officialName: p.officialName,
      brand: p.candidate.brand,
      category: p.candidate.category,
      unit: p.candidate.unit,
      sku: p.candidate.sku || null,
      barcode: p.candidate.barcode || null,
      companyId: p.candidate.company_id,
      active: p.candidate.active !== false,
      matchType,
      score: p.score,
      confidence: p.confidence,
      justification: p.justification,
      verifiedAttributes: p.verifiedAttributes,
      match_score: p.score
    }
  })

  return {
    status: overallStatus,
    confidence: top.confidence,
    parsedQuery: parsed,
    matches: formattedMatches,
    differentiatingQuestion,
    alternativeRecommendation
  }
}
