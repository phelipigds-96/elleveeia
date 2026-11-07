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

  // 3. Extrair pesos e unidades (ex: 1kg, 500g, 395g, 200ml, 1l, 395gr, 5k)
  let weightValue: number | undefined
  let unitValue: string | undefined
  
  const weightMatches = text.match(/\b\d+(?:[\.,]\d+)?\s*(?:kg|k|g|gr|gramas?|ml|l|lt|litros?|un|und)\b/gi)
  if (weightMatches) {
    for (const w of weightMatches) {
      const normalizedW = w.toLowerCase().replace(/\s+/g, '').replace(',', '.')
      const numMatch = normalizedW.match(/^(\d+(?:\.\d+)?)/)
      const rawUnitMatch = normalizedW.match(/[a-z]+$/)

      if (numMatch && rawUnitMatch) {
        const num = parseFloat(numMatch[1])
        const rawUnit = rawUnitMatch[0]
        const variants = new Set<string>()

        variants.add(normalizedW)
        variants.add(w.toLowerCase())
        variants.add(normalizedW.replace('.', ' '))

        if (['g', 'gr', 'grama', 'gramas'].includes(rawUnit)) {
          variants.add(`${num}g`)
          variants.add(`${num} g`)
          variants.add(`${num}gr`)
          variants.add(`${num} gr`)
          variants.add(`${num}`)
          if (num === 395) {
            variants.add('39')
          }
          if (num >= 1000 && num % 1000 === 0) {
            const inKg = num / 1000
            variants.add(`${inKg}kg`)
            variants.add(`${inKg} kg`)
            variants.add(`${inKg}k`)
            variants.add(`${inKg} k`)
          }
          weightValue = num
          unitValue = 'g'
        } else if (['kg', 'k', 'quilo', 'quilos'].includes(rawUnit)) {
          variants.add(`${num}kg`)
          variants.add(`${num} kg`)
          variants.add(`${num}k`)
          variants.add(`${num} k`)
          const inGrams = Math.round(num * 1000)
          variants.add(`${inGrams}g`)
          variants.add(`${inGrams} g`)
          variants.add(`${inGrams}gr`)
          variants.add(`${inGrams} gr`)
          if (num === 1) {
            variants.add('1 01kg')
            variants.add('1.01kg')
            variants.add('1 05kg')
            variants.add('1.05kg')
            variants.add('1 01 kg')
            variants.add('1 05 kg')
            variants.add('1.0kg')
            variants.add('1 0kg')
          } else if (num === 2.5) {
            variants.add('2 5kg')
            variants.add('2.5kg')
            variants.add('2 5 kg')
          }
          weightValue = num
          unitValue = 'kg'
        } else if (['l', 'lt', 'litro', 'litros'].includes(rawUnit)) {
          variants.add(`${num}l`)
          variants.add(`${num} l`)
          variants.add(`${num}lt`)
          variants.add(`${num} lt`)
          if (num === 1) {
            variants.add('1000ml')
            variants.add('1000 ml')
          }
          weightValue = num
          unitValue = 'l'
        } else if (rawUnit === 'ml') {
          variants.add(`${num}ml`)
          variants.add(`${num} ml`)
          if (num === 1000) {
            variants.add('1l')
            variants.add('1 l')
            variants.add('1lt')
            variants.add('1 lt')
          }
          weightValue = num
          unitValue = 'ml'
        } else if (['un', 'und'].includes(rawUnit)) {
          variants.add(`${num}un`)
          variants.add(`${num} un`)
          variants.add(`${num}und`)
          variants.add(`${num} und`)
          weightValue = num
          unitValue = 'un'
        }

        groups.push({
          original: normalizedW,
          variants: Array.from(variants),
          isGeneric: false,
          isUnit: true
        })
      }
      text = text.replace(w, ' ')
    }
  }

  // 3.1 Extrair números isolados que representam gramagens no varejo (ex: 395, 400, 900, 200, 500, 126, 90)
  // quando o cliente não digita a unidade 'g' (ex: "leite condensado italac 395")
  const standaloneWeightMatches = text.match(/\b(?:395|400|900|200|500|126|90|80|60|40|32|150|250|300|350|750|800|1000)\b/g)
  if (standaloneWeightMatches) {
    for (const numStr of standaloneWeightMatches) {
      const num = parseInt(numStr, 10)
      const variants = [
        numStr,
        `${num}g`,
        `${num} g`,
        `${num}gr`,
        `${num} gr`
      ]
      if (num === 395) {
        variants.push('39')
      }
      if (num === 1000) {
        variants.push('1kg', '1 kg', '1k', '1 k')
      }
      groups.push({
        original: `${num}g`,
        variants,
        isGeneric: false,
        isUnit: true
      })
      if (!weightValue) {
        weightValue = num
        unitValue = 'g'
      }
      text = text.replace(new RegExp(`\\b${numStr}\\b`, 'g'), ' ')
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
  
  // Normaliza pontuação e espaços no nome do produto para conferência de tokens
  const cleanProductName = productName.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const paddedName = ` ${cleanProductName} `
  const brandNorm = productBrand ? productBrand.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : null
  const catNorm = productCategory ? productCategory.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : null

  for (const group of parsed.tokenGroups) {
    let matchedInName = false
    
    const matchedBrand = Boolean(brandNorm && group.variants.some(v => brandNorm.includes(v) || v === brandNorm))
    const matchedCat = Boolean(catNorm && group.variants.some(v => catNorm.includes(v) || v === catNorm))

    for (const variant of group.variants) {
      if (paddedName.includes(` ${variant} `)) {
        matchedInName = true
        break
      }
    }

    const matched = matchedInName || matchedBrand || matchedCat

    if (matched) {
      if (group.isUnit) score += 60 // Gramagem/peso é o fator decisivo #1 nas buscas
      else if (matchedBrand) score += 40
      else if (matchedCat) score += 25
      else if (!group.isGeneric) score += 20
      else score += 5
    } else {
      if (group.isUnit) {
        penalty += 35 // Penaliza severamente quando o produto não atende a gramagem solicitada
      } else if (!group.isGeneric) {
        penalty += 20 // Penaliza fortemente falta de termos importantes (ex: branco vs meio amargo)
      } else {
        penalty += 2 // Penaliza levemente termos genéricos faltando
      }
    }
  }

  // Verificação de embalagem de atacado ou granel industrial (caixa fechada, fardo, display, balde, bag, 5k/10k, multiplicador numérico como 12X, 14X, 54X)
  const isWholesalePack = /\b\d+\s*x\s*\d+|\b(?:cx|caixa|caixas|fardo|fardos|display|displays|fd|bag|balde)\b|\b(?:5kg|5k|10kg|10k|20kg|20k)\b/i.test(productName)
  const queryAskedWholesale = /\b(?:caixa|caixas|cx|cxs|fardo|fardos|display|displays|atacado|revenda|bag|balde|5kg|5k|10kg|10k)\b|\b\d+\s*x\b/i.test(parsed.originalQuery)

  if (isWholesalePack && !queryAskedWholesale) {
    penalty += 35 // Penaliza caixas fechadas e embalagens industriais/balde quando o cliente busca produto avulso ou em geral
  } else if (!isWholesalePack && queryAskedWholesale) {
    penalty += 25 // Penaliza unidades avulsas quando o cliente pediu especificamente caixa fechada/atacado/industrial
  }

  // Verificação de produtos derivados (bombons, balas, cocadas, fondants, biscoitos com sabor de ingrediente)
  // Exemplo: se o cliente busca "leite condensado", não deve trazer "bombom de leite condensado" ou "cocada de leite condensado"
  const DERIVATIVE_PREFIXES = /\b(?:bombom|bombons|bala|balas|cocada|cocadas|fondant|picole|picoles|ducrem|bisc|biscoito|biscoitos|cookies|carmed|geladinho)\b/i
  const isDerivativeProduct = DERIVATIVE_PREFIXES.test(productName)
  const queryAskedDerivative = DERIVATIVE_PREFIXES.test(parsed.originalQuery)

  if (isDerivativeProduct && !queryAskedDerivative) {
    penalty += 35 // Penaliza derivados quando a busca é pelo insumo primário
  }

  // Calcula confiança (1.0 = sem penalidades, reduz conforme a penalidade cresce)
  const confidence = Math.max(0, 1.0 - (penalty / 50))

  return {
    score: score - penalty,
    penalty,
    confidence
  }
}
