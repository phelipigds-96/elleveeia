import { STOP_WORDS, MULTI_WORD_TOKENS, ALIASES } from './aliases'

export interface TokenGroup {
  original: string
  variants: string[]
  isGeneric: boolean
  isUnit: boolean
}

const GENERICS = new Set(['cobertura', 'chocolate', 'recheio', 'pasta', 'creme', 'po', 'gota', 'gotas', 'barra', 'pacote', 'caixa', 'unidade'])

export function tokenizeQuery(query: string): TokenGroup[] {
  let text = query.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const groups: TokenGroup[] = []

  // 1. Extrair multi-word tokens primeiro
  for (const mw of MULTI_WORD_TOKENS) {
    for (const variant of mw.variants) {
      if (text.includes(variant)) {
        groups.push({
          original: mw.canonical,
          variants: mw.variants,
          isGeneric: false,
          isUnit: false
        })
        text = text.replace(variant, ' ') // Remove from text so we don't process it again
      }
    }
  }

  // 2. Extrair pesos colados (ex: 1kg, 500g)
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
    }
  }

  // 3. Processar palavras restantes
  const words = text.split(' ').filter(w => w.length > 0 && !STOP_WORDS.has(w))
  
  for (const word of words) {
    // Se a palavra jǭ foi processada (ex: parte de um multi-word que falhou no replace por algum motivo), pular
    const isGeneric = GENERICS.has(word)
    
    // Find aliases where this word is a key or a variant
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

  return groups
}

export function calculateMatchScore(normalizedProductName: string, tokenGroups: TokenGroup[]): number {
  let score = 0
  const paddedName = ` ${normalizedProductName} `

  for (const group of tokenGroups) {
    let matched = false
    
    // Exact variant match in the string with word boundaries
    for (const variant of group.variants) {
      if (paddedName.includes(` ${variant} `)) {
        matched = true
        break
      }
    }

    if (matched) {
      if (group.isUnit) score += 30
      else if (!group.isGeneric) score += 20
      else score += 5
    } else {
      // Penalty for missing
      if (!group.isGeneric && !group.isUnit) {
        score -= 10 // Missing a specific term is bad
      }
    }
  }

  return score
}
