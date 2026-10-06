import { STOP_WORDS, MULTI_WORD_TOKENS, ALIASES } from './aliases'

export interface TokenGroup {
  original: string
  variants: string[]
  isGeneric: boolean
  isUnit: boolean
}

export type ParsedProductQuery = {
  originalQuery: string
  normalizedQuery: string
  weight?: number
  unit?: string
  identifiers: string[]
  significantTokens: string[]
  genericTokens: string[]
  tokenGroups: TokenGroup[]
}

const GENERICS = new Set(['cobertura', 'chocolate', 'recheio', 'pasta', 'creme', 'po', 'gota', 'gotas', 'barra', 'pacote', 'caixa', 'unidade'])

export function parseQuery(query: string): ParsedProductQuery {
  let normalizedQuery = query.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const groups: TokenGroup[] = []
  let text = normalizedQuery

  // 1. Identificadores exatos (SKU, EAN)
  const identifiers: string[] = []
  if (/^[a-z0-9]+$/.test(normalizedQuery) && normalizedQuery.length >= 4) {
    identifiers.push(normalizedQuery)
  }

  // 2. Extrair multi-word tokens
  for (const mw of MULTI_WORD_TOKENS) {
    for (const variant of mw.variants) {
      if (text.includes(variant)) {
        groups.push({
          original: mw.canonical,
          variants: mw.variants,
          isGeneric: false,
          isUnit: false
        })
        text = text.replace(variant, ' ')
      }
    }
  }

  // 3. Extrair pesos colados (ex: 1kg, 500g)
  let weightValue: number | undefined
  let unitValue: string | undefined
  
  const weightMatches = text.match(/\b\d+(?:[\.,]\d+)?\s*(?:kg|g|ml|l|un|und)\b/g)
  if (weightMatches) {
    for (const w of weightMatches) {
      const normalizedW = w.replace(/\s+/g, '').replace(',', '.')
      groups.push({
        original: normalizedW,
        variants: [normalizedW, w, normalizedW.replace('.', ' ')],
        isGeneric: false,
        isUnit: true
      })
      text = text.replace(w, ' ')
      
      // Parse for structured attributes
      const numMatch = normalizedW.match(/(\d+(?:\.\d+)?)/)
      const unitMatch = normalizedW.match(/[a-z]+$/)
      if (numMatch) weightValue = parseFloat(numMatch[1])
      if (unitMatch) unitValue = unitMatch[0]
    }
  }

  // 4. Processar palavras restantes
  const words = text.split(' ').filter(w => w.length > 0 && !STOP_WORDS.has(w))
  
  for (const word of words) {
    const isGeneric = GENERICS.has(word)
    
    let variants = [word]
    for (const [canonical, aliases] of Object.entries(ALIASES)) {
      if (canonical === word || aliases.includes(word)) {
        variants = Array.from(new Set([canonical, ...aliases]))
        break
      }
    }

    groups.push({
      original: word,
      variants,
      isGeneric,
      isUnit: false
    })
  }

  const significantTokens = groups.filter(g => !g.isGeneric && !g.isUnit).map(g => g.original)
  const genericTokens = groups.filter(g => g.isGeneric).map(g => g.original)

  return {
    originalQuery: query,
    normalizedQuery,
    weight: weightValue,
    unit: unitValue,
    identifiers,
    significantTokens,
    genericTokens,
    tokenGroups: groups
  }
}

export interface MatchScoreResult {
  score: number
  penalty: number
  confidence: number
}

export function calculateMatchScore(
  productName: string, 
  productBrand: string | null, 
  productCategory: string | null,
  parsed: ParsedProductQuery
): MatchScoreResult {
  let score = 0
  let penalty = 0
  
  const paddedName = ` ${productName} `
  const brandNorm = productBrand ? productBrand.toLowerCase() : null
  const catNorm = productCategory ? productCategory.toLowerCase() : null

  for (const group of parsed.tokenGroups) {
    let matchedInName = false
    
    const matchedBrand = brandNorm && group.variants.some(v => brandNorm.includes(v))
    const matchedCat = catNorm && group.variants.some(v => catNorm.includes(v))

    for (const variant of group.variants) {
      if (paddedName.includes(` ${variant} `)) {
        matchedInName = true
        break
      }
    }

    const matched = matchedInName || matchedBrand || matchedCat

    if (matched) {
      if (group.isUnit) score += 30
      else if (matchedBrand) score += 40
      else if (matchedCat) score += 25
      else if (!group.isGeneric) score += 20
      else score += 5
    } else {
      if (!group.isGeneric && !group.isUnit) {
        penalty += 20 // Penaliza fortemente falta de termos importantes (ex: branco vs meio amargo)
      } else if (group.isUnit) {
        penalty += 10 // Penaliza tamanho incorreto
      } else {
        penalty += 2 // Penaliza levemente termos genericos faltando
      }
    }
  }

  // Calcula confiana (1.0 = sem penalidades, reduz conforme a penalidade cresce)
  // Penalidade de 20 jǭ derruba a confiana para 0.60
  const confidence = Math.max(0, 1.0 - (penalty / 50))

  return {
    score: score - penalty,
    penalty,
    confidence
  }
}
