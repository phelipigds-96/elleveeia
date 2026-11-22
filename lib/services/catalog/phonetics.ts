/**
 * Algoritmo fonético especializado para o português brasileiro e varejo comercial.
 * Converte palavras para uma representação fonética canônica e calcula distância de edição.
 */

/**
 * Codificador fonético para português brasileiro (especializado em termos de confeitaria e varejo)
 */
export function encodePtBrPhonetic(input: string): string {
  if (!input) return ''
  
  let s = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, '')      // apenas alfanuméricos
    .trim()

  if (s.length === 0) return ''

  // 1. Substituições preliminares de dígrafos e encontros consonantais
  s = s.replace(/ph/g, 'f')
  s = s.replace(/sh/g, 'x')
  s = s.replace(/ch/g, 'x')
  s = s.replace(/ck/g, 'k')
  s = s.replace(/qu([ei])/g, 'k$1')
  s = s.replace(/qu([ao])/g, 'k$1')
  s = s.replace(/w/g, 'v')
  s = s.replace(/y/g, 'i')

  // 2. Consoantes antes de vogais específicas
  // 'c' antes de e, i vira 's'; antes de a, o, u vira 'k'
  s = s.replace(/c([ei])/g, 's$1')
  s = s.replace(/c([aou])/g, 'k$1')
  s = s.replace(/c$/g, 'k')
  s = s.replace(/c([^aeiou])/g, 'k$1')

  // 'g' antes de e, i vira 'j'; antes de a, o, u vira 'g'
  s = s.replace(/g([ei])/g, 'j$1')
  s = s.replace(/gu([ei])/g, 'g$1')

  // 'ç' ou 'ss' vira 's'
  s = s.replace(/ss/g, 's')
  s = s.replace(/sc([ei])/g, 's$1')
  s = s.replace(/xc([ei])/g, 's$1')

  // 'z' em posição intervocálica ou inicial vira 's'
  s = s.replace(/z/g, 's')

  // 'x' em contextos com som de 's' ou 'ks' -> normalizado para 'x'
  // 'lh' vira 'li', 'nh' vira 'ni'
  s = s.replace(/lh/g, 'li')
  s = s.replace(/nh/g, 'ni')

  // 'ei' no final ou meio vira 'e' (ex: "leiti" -> "leti", "leite" -> "lete")
  s = s.replace(/ei/g, 'e')
  s = s.replace(/ou/g, 'o')

  // 'e' final átono muitas vezes pronunciado como 'i'
  s = s.replace(/e$/g, 'i')

  // 'm' final vira 'n'
  s = s.replace(/m$/g, 'n')

  // 3. Reduzir consoantes duplicadas
  let collapsed = ''
  let lastChar = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== lastChar) {
      collapsed += c
      lastChar = c
    }
  }

  return collapsed.toUpperCase()
}

/**
 * Calcula a distância de Damerau-Levenshtein (com suporte a transposição de caracteres adjacentes).
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  const lenA = a.length
  const lenB = b.length
  if (lenA === 0) return lenB
  if (lenB === 0) return lenA

  const matrix: number[][] = []

  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,       // deleção
        matrix[i][j - 1] + 1,       // inserção
        matrix[i - 1][j - 1] + cost // substituição
      )

      // Transposição
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost)
      }
    }
  }

  return matrix[lenA][lenB]
}

/**
 * Extrai trigramas de uma string
 */
export function extractTrigrams(str: string): Set<string> {
  const norm = `  ${str.toLowerCase().trim()}  `
  const trigrams = new Set<string>()
  for (let i = 0; i < norm.length - 2; i++) {
    trigrams.add(norm.substring(i, i + 3))
  }
  return trigrams
}

/**
 * Calcula a similaridade trigram (coeficiente de Dice / Jaccard n-gram) entre duas strings.
 * Retorna valor entre 0.0 (sem similaridade) e 1.0 (idêntico).
 */
export function calculateTrigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (!a || !b) return 0.0

  const triA = extractTrigrams(a)
  const triB = extractTrigrams(b)

  let intersection = 0
  for (const t of triA) {
    if (triB.has(t)) intersection++
  }

  const total = triA.size + triB.size
  if (total === 0) return 0.0

  return (2 * intersection) / total
}

/**
 * Verifica se dois tokens são equivalentes considerando tolerância a erros e fonética.
 */
export function areTokensEquivalent(tokenA: string, tokenB: string): { isMatch: boolean; confidence: number; method: 'exact' | 'typo' | 'phonetic' | 'none' } {
  const a = tokenA.toLowerCase().trim()
  const b = tokenB.toLowerCase().trim()

  if (a === b) {
    return { isMatch: true, confidence: 1.0, method: 'exact' }
  }

  // Se tokens forem curtos (< 4 caracteres), não aplica tolerância a typos para evitar falsos positivos
  if (a.length < 4 || b.length < 4) {
    return { isMatch: false, confidence: 0, method: 'none' }
  }

  // Distância de edição limitada
  const dist = damerauLevenshteinDistance(a, b)
  const maxLen = Math.max(a.length, b.length)

  if (dist === 1) {
    return { isMatch: true, confidence: 0.92, method: 'typo' }
  }

  if (dist === 2 && maxLen >= 6) {
    return { isMatch: true, confidence: 0.82, method: 'typo' }
  }

  // Fallback fonético
  const phoneA = encodePtBrPhonetic(a)
  const phoneB = encodePtBrPhonetic(b)

  if (phoneA.length >= 3 && phoneA === phoneB) {
    return { isMatch: true, confidence: 0.88, method: 'phonetic' }
  }

  // Similaridade trigram para palavras longas (>= 5 caracteres)
  if (maxLen >= 5) {
    const sim = calculateTrigramSimilarity(a, b)
    if (sim >= 0.70) {
      return { isMatch: true, confidence: sim, method: 'typo' }
    }
  }

  return { isMatch: false, confidence: 0, method: 'none' }
}
