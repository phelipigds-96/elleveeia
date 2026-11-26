import type { StructuredSearchResponse, ProductSearchResult } from '../catalog/products'

export type CommercialResponseStrategy = 
  | 'generic_discovery'
  | 'brand_specific_discovery'
  | 'brand_alternative'
  | 'specific_product'
  | 'quantity_pricing'
  | 'ambiguous_product'
  | 'not_found'

export interface ReferenceResolution {
  resolvedQuery: string
  isAnaphoric: boolean
  isAmbiguous: boolean
  ambiguityMessage?: string
  candidateOptions?: any[]
  excludeBrand?: string
  targetOrdinalIndex?: number
  resolvedProduct?: any
  isDifferentBrandRequest?: boolean
  isCostBenefitQuery?: boolean
  isCheapestQuery?: boolean
}

/**
 * Extrai o peso líquido aproximado em quilogramas a partir do nome do produto.
 * Utilizado para cálculo determinístico de preço por quilo (R$/kg) e comparação de custo-benefício.
 */
export function extractWeightInKg(productName: string): number | null {
  const norm = productName.toUpperCase()

  const matchKg = norm.match(/\b(\d+(?:[.,]\d+)?)\s*KG\b/)
  if (matchKg) {
    const val = parseFloat(matchKg[1].replace(',', '.'))
    return val > 0 ? val : null
  }

  const matchG = norm.match(/\b(\d+)\s*G\b/)
  if (matchG) {
    const valG = parseInt(matchG[1], 10)
    return valG > 0 ? valG / 1000 : null
  }

  const matchL = norm.match(/\b(\d+(?:[.,]\d+)?)\s*L\b/)
  if (matchL) {
    const valL = parseFloat(matchL[1].replace(',', '.'))
    return valL > 0 ? valL : null
  }

  const matchMl = norm.match(/\b(\d+)\s*ML\b/)
  if (matchMl) {
    const valMl = parseInt(matchMl[1], 10)
    return valMl > 0 ? valMl / 1000 : null
  }

  return null
}

/**
 * Resolve referências anafóricas ou ordinais a partir da Working Memory.
 * Trata consultas como:
 * - "Quero a mesma coisa de outra marca"
 * - "Quanto custa aquele primeiro?"
 * - "Tem uma embalagem maior?"
 * - "Quero dois desse e três do outro"
 */
export function resolveReferenceQuery(query: string, workingMemory?: any): ReferenceResolution {
  const norm = query.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  const defaultResult: ReferenceResolution = {
    resolvedQuery: query,
    isAnaphoric: false,
    isAmbiguous: false
  }

  if (!query || query.trim() === '') return defaultResult

  const activeProd = workingMemory?.activeProduct
  const discovered = Array.isArray(workingMemory?.discoveredProducts) ? workingMemory.discoveredProducts : []

  // 1. "Outra marca" / "Mesma coisa de outra marca" / "Tem de outra marca?"
  const isDifferentBrandPattern = /\b(?:outra\s+marca|outras\s+marcas|mesma\s+coisa(?:\s+de\s+outra\s+marca)?|tem\s+(?:de\s+)?outra\s+marca|muda\s+a\s+marca|marca\s+diferente|outra\s+opcao\s+de\s+marca)\b/i.test(norm) ||
    /^(?:quero|tem|mostra|ve)\s+(?:a\s+)?mesma\s+coisa$/i.test(norm)

  if (isDifferentBrandPattern) {
    const refProduct = activeProd || (discovered.length > 0 ? discovered[0] : null)

    if (refProduct && refProduct.name) {
      const refNameNorm = refProduct.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      let detectedBrand: string | undefined

      for (const b of KNOWN_MARKET_BRANDS) {
        const bNorm = b.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const regex = new RegExp(`\\b${bNorm}\\b`, 'i')
        if (regex.test(refNameNorm)) {
          detectedBrand = b
          break
        }
      }

      // Remove a marca detectada para construir busca genérica da mesma categoria/linha
      let genericDescriptor = refNameNorm
      if (detectedBrand) {
        genericDescriptor = genericDescriptor.replace(new RegExp(`\\b${detectedBrand}\\b`, 'gi'), ' ')
      }
      genericDescriptor = genericDescriptor.replace(/\s+/g, ' ').trim()

      return {
        resolvedQuery: genericDescriptor || refProduct.name,
        isAnaphoric: true,
        isAmbiguous: false,
        excludeBrand: detectedBrand,
        isDifferentBrandRequest: true
      }
    }

    return {
      resolvedQuery: query,
      isAnaphoric: true,
      isAmbiguous: true,
      ambiguityMessage: 'Você gostaria de ver opções de outra marca para qual produto? Me diga qual item você tem em mente para eu consultar no estoque! 😊'
    }
  }

  // 2. Referências Ordinais ("aquele primeiro", "o segundo", "o terceiro", "o último")
  const ordinalPatterns = [
    { regex: /\b(?:aquele\s+)?(?:primeir[oa]|1[oºaª]|opcao\s+1|o\s+1)\b/i, index: 0 },
    { regex: /\b(?:aquele\s+)?(?:segund[oa]|2[oºaª]|opcao\s+2|o\s+2)\b/i, index: 1 },
    { regex: /\b(?:aquele\s+)?(?:terceir[oa]|3[oºaª]|opcao\s+3|o\s+3)\b/i, index: 2 },
    { regex: /\b(?:aquele\s+)?(?:quart[oa]|4[oºaª]|opcao\s+4|o\s+4)\b/i, index: 3 },
    { regex: /\b(?:aquele\s+)?(?:ultim[oa]|ultima\s+opcao)\b/i, index: -1 }
  ]

  for (const { regex, index } of ordinalPatterns) {
    if (regex.test(norm)) {
      if (discovered.length === 0) {
        return {
          resolvedQuery: query,
          isAnaphoric: true,
          isAmbiguous: true,
          ambiguityMessage: 'Não encontrei produtos recém-apresentados para identificar essa opção. Pode me dizer o nome do produto que você deseja consultar? 😊'
        }
      }

      const targetIdx = index === -1 ? discovered.length - 1 : index
      if (targetIdx >= 0 && targetIdx < discovered.length) {
        const item = discovered[targetIdx]
        return {
          resolvedQuery: item.name,
          isAnaphoric: true,
          isAmbiguous: false,
          targetOrdinalIndex: targetIdx,
          resolvedProduct: item
        }
      }

      return {
        resolvedQuery: query,
        isAnaphoric: true,
        isAmbiguous: true,
        candidateOptions: discovered,
        ambiguityMessage: `Apresentamos anteriormente ${discovered.length} ${discovered.length === 1 ? 'opção' : 'opções'}. Qual delas você gostaria de verificar? 😊`
      }
    }
  }

  // 3. Multi-item referencial: "dois desse e três do outro" / "2 desse e 3 do outro"
  const WORD_NUMS: Record<string, number> = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5, seis: 6, dez: 10
  }
  const numRegexStr = '(?:\\d+|um|uma|dois|duas|tres|três|quatro|cinco|seis|dez)'
  const multiItemPattern = new RegExp(`\\b(${numRegexStr})\\s*(?:deste|desse|desta|dessa|dele|dela)\\s*(?:e|\\+|,)?\\s*(${numRegexStr})\\s*(?:do\\s+outro|da\\s+outra|do\\s+segundo|do\\s+demais)\\b`, 'i')
  const multiMatch = norm.match(multiItemPattern)
  if (multiMatch) {
    const parseQty = (s: string) => {
      const clean = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (WORD_NUMS[clean]) return WORD_NUMS[clean]
      const n = parseInt(s, 10)
      return isNaN(n) ? 1 : n
    }
    const q1 = parseQty(multiMatch[1])
    const q2 = parseQty(multiMatch[2])

    if (discovered.length === 2) {
      return {
        resolvedQuery: `${q1}x ${discovered[0].name} + ${q2}x ${discovered[1].name}`,
        isAnaphoric: true,
        isAmbiguous: false,
        candidateOptions: [
          { product: discovered[0], quantity: q1 },
          { product: discovered[1], quantity: q2 }
        ]
      }
    }

    if (discovered.length > 2) {
      return {
        resolvedQuery: query,
        isAnaphoric: true,
        isAmbiguous: true,
        candidateOptions: discovered,
        ambiguityMessage: `Apresentamos ${discovered.length} opções anteriormente. Para eu lançar com precisão no seu pedido: qual produto você gostaria de ${q1} unidades e qual de ${q2} unidades? 😊`
      }
    }
  }

  // 4. "Tem embalagem maior?" ou "Tem menor?"
  const sizeChangePattern = /\b(?:embalagem|tamanho|pacote|barra)?\s*(maior|menor)\b/i
  const sizeMatch = norm.match(sizeChangePattern)
  if (sizeMatch && (activeProd || discovered.length > 0)) {
    const refProduct = activeProd || discovered[0]
    const wantsBigger = /maior/i.test(sizeMatch[1])
    const currentWeight = extractWeightInKg(refProduct.name)

    // Se temos o produto base, orienta busca no tamanho oposto
    let targetSize = wantsBigger ? '2kg' : '500g'
    if (currentWeight && currentWeight >= 2) {
      targetSize = wantsBigger ? '5kg' : '1kg'
    } else if (currentWeight && currentWeight <= 0.5) {
      targetSize = wantsBigger ? '1kg' : '200g'
    }

    const cleanBaseName = refProduct.name
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      resolvedQuery: `${cleanBaseName} ${targetSize}`,
      isAnaphoric: true,
      isAmbiguous: false
    }
  }

  return defaultResult
}

export const KNOWN_MARKET_BRANDS = [
  'moca', 'leite moca', 'garoto', 'lacta', 'melken', 'harald', 'sicao', 
  'barry', 'callebaut', 'mavalerio', 'piracanjuba', 'itambe', 'tirol', 
  'italac', 'nestle', 'nestlé', 'parmalat', 'elege',
  'genuine', 'dona jura', 'selecta', 'namur', 'guimaraes', 'guimarães',
  'bunge', 'richs', 'norcau', 'puratos', 'fleischmann', 'dona benta',
  'qualimax', 'arcolor', 'mix', 'triangulo', 'triângulo'
]

export function extractUniqueBrands(matches: ProductSearchResult[]): string[] {
  const brandMap = new Map<string, string>() // lowercase -> original
  for (const match of matches) {
    if (match.brand && match.brand.trim() !== '') {
      const original = match.brand.trim()
      const lower = original.toLowerCase()
      if (!brandMap.has(lower)) {
        brandMap.set(lower, original)
      }
    } else if (match.name) {
      // Se a coluna brand for nula (comum em ERPs como Sumel), extrai marca conhecida do nome do produto
      const nameNorm = match.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      for (const b of KNOWN_MARKET_BRANDS) {
        const bNorm = b.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const regex = new RegExp(`\\b${bNorm}\\b`, 'i')
        if (regex.test(nameNorm)) {
          const cap = b.charAt(0).toUpperCase() + b.slice(1).toLowerCase()
          if (!brandMap.has(bNorm)) {
            brandMap.set(bNorm, cap)
          }
        }
      }
    }
  }
  return Array.from(brandMap.values())
}

/**
 * Extrai tamanhos / pesos de embalagem disponíveis a partir dos nomes dos produtos.
 */
export function extractAvailableSizes(matches: ProductSearchResult[]): string[] {
  const sizeMap = new Map<string, string>()
  for (const m of matches) {
    const text = (m.name || '').toUpperCase()
    const matchKg = text.match(/\b(\d+(?:[.,]\d+)?)\s*KG\b/)
    if (matchKg) {
      const clean = `${matchKg[1].replace(',', '.')}kg`
      sizeMap.set(clean, clean)
    }
    const matchG = text.match(/\b(\d+)\s*G\b/)
    if (matchG && !text.includes('1KG') && !text.includes('2KG')) {
      const clean = `${matchG[1]}g`
      sizeMap.set(clean, clean)
    }
    const matchL = text.match(/\b(\d+(?:[.,]\d+)?)\s*L\b/)
    if (matchL) {
      const clean = `${matchL[1].replace(',', '.')}L`
      sizeMap.set(clean, clean)
    }
  }
  return Array.from(sizeMap.values())
}

/**
 * Detecta se a consulta do cliente é ampla/genérica (sem especificação de marca e/ou tamanho).
 */
export function isGenericProductQuery(query: string, uniqueBrands: string[]): boolean {
  const norm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // Se o cliente mencionou uma marca conhecida ou marca presente nos resultados
  const mentionsBrand = uniqueBrands.some(b => {
    const bNorm = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return new RegExp(`\\b${bNorm}\\b`, 'i').test(norm)
  }) || KNOWN_MARKET_BRANDS.some(b => {
    const bNorm = b.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return new RegExp(`\\b${bNorm}\\b`, 'i').test(norm)
  })

  // Se o cliente especificou tamanho, peso ou formato claro de embalagem
  const mentionsSizeOrFormat = /\b(?:\d+(?:[.,]\d+)?\s*(?:kg|kilos?|g|gramas?|ml|l|litros?)|barra|tablete|gotas|bloco|cx|caixa|fardo|fracionad[ao])\b/i.test(norm)

  return !mentionsBrand && !mentionsSizeOrFormat
}

export interface DiscoveredProductSegments {
  hasProfessionalBaking: boolean
  hasIndividualSnack: boolean
  hasWholesaleBoxes: boolean
  segmentLabels: string[]
}

export function detectProductSegments(matches: ProductSearchResult[]): DiscoveredProductSegments {
  let hasProfessionalBaking = false
  let hasIndividualSnack = false
  let hasWholesaleBoxes = false

  for (const m of matches) {
    const nameUpper = (m.name || '').toUpperCase()
    if (/\b\d+\s*X\s*\d+/i.test(nameUpper) || /\b(?:CX|CAIXA|FARDO|DISPLAY|FD)\b/i.test(nameUpper)) {
      hasWholesaleBoxes = true
    }
    if (
      /\b(?:1KG|1\.0|1\.01|1\.05|2KG|2\.1KG|BARRA|COBERTURA|GOTAS|RECHEIO|PASTA|BLOCO|CULINARIO|CULINARIA)\b/i.test(nameUpper) ||
      (m.unit && /kg/i.test(m.unit))
    ) {
      hasProfessionalBaking = true
    }
    if (
      /\b(?:\d{2,3}G|TABLETE|BOMBOM|SNACK|KIT\s*KAT|BIS|TUBINHO)\b/i.test(nameUpper) &&
      !/\b(?:1KG|1\.0|2KG|CX|CAIXA|12X|14X|54X)\b/i.test(nameUpper)
    ) {
      hasIndividualSnack = true
    }
  }

  const segmentLabels: string[] = []
  if (hasProfessionalBaking) segmentLabels.push('confeitaria_e_receitas (ex: barras culinárias de 1kg, coberturas e gotas)')
  if (hasIndividualSnack) segmentLabels.push('consumo_individual (ex: tabletes menores de 80g/90g, snacks e bombons)')
  if (hasWholesaleBoxes) segmentLabels.push('atacado_e_caixas (ex: caixas fechadas e fardos para revenda)')

  return { hasProfessionalBaking, hasIndividualSnack, hasWholesaleBoxes, segmentLabels }
}

export function applyCommercialStrategy(
  query: string,
  searchResult: StructuredSearchResponse,
  quantity: number = 1,
  pricingResult?: any,
  candidatePrices?: Map<string, { unit_price: number, subtotal: number }>,
  refResolution?: ReferenceResolution,
  parsedQuery?: any
): any {
  if (searchResult.status === 'not_found' || searchResult.matches.length === 0) {
    return {
      strategy: 'not_found'
    }
  }

  // 1. BRAND ALTERNATIVE STRATEGY ("outra marca")
  if (refResolution?.isDifferentBrandRequest) {
    const exclude = refResolution.excludeBrand ? refResolution.excludeBrand.toLowerCase() : ''
    let altMatches = searchResult.matches
    if (exclude) {
      altMatches = searchResult.matches.filter(m => {
        const b = (m.brand || '').toLowerCase()
        const n = (m.name || '').toLowerCase()
        return !b.includes(exclude) && !n.includes(exclude)
      })
    }
    const targetMatches = altMatches.length > 0 ? altMatches : searchResult.matches
    const altBrands = extractUniqueBrands(targetMatches)

    const payload: any = {
      strategy: 'brand_alternative',
      original_brand_excluded: refResolution.excludeBrand || null,
      brands: altBrands,
      products: targetMatches.slice(0, 5).map(m => {
        const item: any = { id: m.id, name: m.name, brand: m.brand || null }
        if (m.unit) item.unit = m.unit
        const p = candidatePrices?.get(m.id)
        if (p) item.price = { unit_price: p.unit_price, subtotal: p.subtotal }
        return item
      }),
      consultative_hint: `O cliente solicitou a mesma categoria de outra marca${refResolution.excludeBrand ? ` (marca anterior: ${refResolution.excludeBrand})` : ''}. Apresente as opções alternativas disponíveis no catálogo (${altBrands.join(', ')}), destacando características e preços de forma consultiva.`
    }
    return decorateConsultativePayload(payload, searchResult, candidatePrices, parsedQuery)
  }

  // 1.1 COMPATIBLE ALTERNATIVE (Marca solicitada não disponível no catálogo da loja)
  if (searchResult.status === 'compatible_alternative') {
    const altBrands = extractUniqueBrands(searchResult.matches)
    const originalBrand = (searchResult as any).alternativeRecommendation?.originalBrandRequested || 'solicitada'
    const payload: any = {
      strategy: 'brand_alternative',
      original_brand_excluded: originalBrand,
      brands: altBrands,
      products: searchResult.matches.slice(0, 5).map((m: any) => {
        const item: any = { id: m.id, name: m.name, brand: m.brand || null }
        if (m.unit) item.unit = m.unit
        const p = candidatePrices?.get(m.id)
        if (p) item.price = { unit_price: p.unit_price, subtotal: p.subtotal }
        return item
      }),
      consultative_hint: `A marca "${originalBrand}" não consta no catálogo desta loja. Informe com simpatia que não trabalhamos com a marca ${originalBrand}, e apresente de imediato as ótimas opções disponíveis da mesma linha (${altBrands.join(', ')}).`
    }
    return decorateConsultativePayload(payload, searchResult, candidatePrices, parsedQuery)
  }

  // 2. EXACT MATCH / SPECIFIC PRODUCT OU MATCH EXATO DE NOME
  const normalizedQuery = query.toLowerCase().trim()
  const exactNameMatch = searchResult.matches.find(
    m => m.name.toLowerCase().trim() === normalizedQuery
  )
  const isExactOrSingle = searchResult.status === 'exact_match' || searchResult.matches.length === 1 || Boolean(exactNameMatch)

  if (isExactOrSingle) {
    const bestProduct = exactNameMatch || searchResult.matches[0]
    const resolvedPrice = pricingResult || candidatePrices?.get(bestProduct.id)
    
    let basePayload: any
    if (resolvedPrice) {
      if (quantity > 1) {
        basePayload = {
          strategy: 'quantity_pricing',
          product: { id: bestProduct.id, name: bestProduct.name },
          quantity,
          price: resolvedPrice
        }
      } else {
        basePayload = {
          strategy: 'specific_product',
          product: { id: bestProduct.id, name: bestProduct.name },
          price: resolvedPrice
        }
      }
    } else {
      basePayload = {
        strategy: 'specific_product',
        product: { id: bestProduct.id, name: bestProduct.name }
      }
    }
    return decorateConsultativePayload(basePayload, searchResult, candidatePrices, parsedQuery)
  }

  // 3. DISCOVERY (Múltiplos candidatos)
  const uniqueBrands = extractUniqueBrands(searchResult.matches)
  const mentionedBrand = uniqueBrands.find(b => normalizedQuery.includes(b.toLowerCase()))

  // 4. BRAND SPECIFIC DISCOVERY
  if (mentionedBrand) {
    const bNorm = mentionedBrand.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const brandMatches = searchResult.matches.filter(m => {
      if (m.brand && m.brand.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(bNorm)) return true
      if (m.name) {
        const nNorm = m.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return new RegExp(`\\b${bNorm}\\b`, 'i').test(nNorm)
      }
      return false
    })
    const targetMatches = brandMatches.length > 0 ? brandMatches : searchResult.matches

    // Se o filtro de marca desambiguou para exatamente 1 produto
    if (targetMatches.length === 1) {
      const bestProduct = targetMatches[0]
      const resolvedPrice = candidatePrices?.get(bestProduct.id) || pricingResult
      let basePayload: any
      if (resolvedPrice) {
        if (quantity > 1) {
          basePayload = {
            strategy: 'quantity_pricing',
            product: { id: bestProduct.id, name: bestProduct.name },
            quantity,
            price: resolvedPrice
          }
        } else {
          basePayload = {
            strategy: 'specific_product',
            product: { id: bestProduct.id, name: bestProduct.name },
            price: resolvedPrice
          }
        }
      } else {
        basePayload = {
          strategy: 'specific_product',
          product: { id: bestProduct.id, name: bestProduct.name }
        }
      }
      return decorateConsultativePayload(basePayload, searchResult, candidatePrices, parsedQuery)
    }

    const isTierComparison = Boolean(searchResult.parsedQuery?.isPriceTierComparison || parsedQuery?.isPriceTierComparison)
    const effectiveSaleUnit = searchResult.parsedQuery?.saleUnit || parsedQuery?.saleUnit
    const isWholesaleQuery =
      effectiveSaleUnit === 'CX' ||
      effectiveSaleUnit === 'FD' ||
      /\b(?:caixa|caixas|cx|cxs|fardo|fardos|display|displays|revenda)\b|\b\d+\s*x\b/i.test(normalizedQuery)
    const isWholesaleName = (name: string) => /\b\d+\s*x\s*\d+|\b(?:cx|caixa|fardo|display|fd)\b/i.test(name || '')
    const wholesaleMatches = targetMatches.filter(m => isWholesaleName(m.name || '') || (m.packageFactor && m.packageFactor > 1))
    const nonWholesaleMatches = targetMatches.filter(m => !isWholesaleName(m.name || ''))
    const displayMatches = isTierComparison
      ? targetMatches
      : isWholesaleQuery
      ? (wholesaleMatches.length > 0 ? wholesaleMatches : targetMatches)
      : (nonWholesaleMatches.length > 0 ? nonWholesaleMatches : targetMatches)

    const segments = detectProductSegments(displayMatches)
    const isBroadSegmented = !isWholesaleQuery && !isTierComparison && segments.segmentLabels.length > 1 && !/\b(?:1kg|2kg|cx|caixa|\d+g|barra|tablete|uht)\b/i.test(normalizedQuery)

    const payload: any = {
      strategy: 'brand_specific_discovery',
      brand: mentionedBrand,
      is_broad_query: isBroadSegmented,
      products: displayMatches.slice(0, 10).map(m => {
        const item: any = {
          id: m.id,
          name: m.name,
          brand: m.brand || mentionedBrand
        }
        if (m.unit) item.unit = m.unit
        const p = candidatePrices?.get(m.id)
        if (p) {
          item.price = {
            unit_price: p.unit_price,
            subtotal: p.subtotal
          }
        }
        return item
      })
    }

    if (isBroadSegmented) {
      payload.available_segments = segments.segmentLabels
      payload.consultative_hint = 'A consulta do cliente é ampla e o catálogo possui opções com finalidades distintas: ' +
        segments.segmentLabels.join(', ') + '. Não jogue a lista de preços completa. Faça uma pergunta consultiva amigável perguntando se ele procura para confeitaria/receitas ou para consumo próprio/docinho.'
    }

    return decorateConsultativePayload(payload, searchResult, candidatePrices, parsedQuery)
  }

  // 5. GENERIC DISCOVERY
  const isGeneric = isGenericProductQuery(normalizedQuery, uniqueBrands)
  const isTierComparisonGeneric = Boolean(searchResult.parsedQuery?.isPriceTierComparison || parsedQuery?.isPriceTierComparison)
  const effectiveSaleUnitGeneric = searchResult.parsedQuery?.saleUnit || parsedQuery?.saleUnit
  const isWholesaleQuery =
    effectiveSaleUnitGeneric === 'CX' ||
    effectiveSaleUnitGeneric === 'FD' ||
    /\b(?:caixa|caixas|cx|cxs|fardo|fardos|display|displays|revenda)\b|\b\d+\s*x\b/i.test(normalizedQuery)
  const isWholesaleName = (name: string) => /\b\d+\s*x\s*\d+|\b(?:cx|caixa|fardo|display|fd)\b/i.test(name || '')
  const wholesaleMatches = searchResult.matches.filter(m => isWholesaleName(m.name || '') || (m.packageFactor && m.packageFactor > 1))
  const nonWholesaleMatches = searchResult.matches.filter(m => !isWholesaleName(m.name || ''))
  const displayMatches = isTierComparisonGeneric
    ? searchResult.matches
    : isWholesaleQuery
    ? (wholesaleMatches.length > 0 ? wholesaleMatches : searchResult.matches)
    : (nonWholesaleMatches.length > 0 ? nonWholesaleMatches : searchResult.matches)

  const segments = detectProductSegments(displayMatches)
  const availableSizes = extractAvailableSizes(displayMatches)

  // É consulta ampla se o cliente fez uma pergunta genérica (sem marca/tamanho) E há mais de 2 produtos,
  // ou se o catálogo possui segmentos com finalidades distintas
  const isBroadQuery = !isWholesaleQuery && !isTierComparisonGeneric && ((isGeneric && searchResult.matches.length > 2) || (segments.segmentLabels.length > 1 && !/\b(?:1kg|2kg|cx|caixa|\d+g|barra|tablete|uht)\b/i.test(normalizedQuery)))

  const payload: any = {
    strategy: 'generic_discovery',
    brands: uniqueBrands.slice(0, 5),
    product_count: searchResult.matches.length,
    is_broad_query: isBroadQuery,
    available_sizes: availableSizes,
    products: displayMatches.slice(0, 10).map(m => {
      const item: any = {
        id: m.id,
        name: m.name,
        brand: m.brand || null
      }
      if (m.unit) item.unit = m.unit
      const p = candidatePrices?.get(m.id)
      if (p) {
        item.price = {
          unit_price: p.unit_price,
          subtotal: p.subtotal
        }
      }
      return item
    })
  }

  if (isBroadQuery) {
    const brandsList = uniqueBrands.slice(0, 5).join(', ')
    const sizesList = availableSizes.length > 0 ? ` (tamanhos disponíveis: ${availableSizes.slice(0, 4).join(', ')})` : ''
    payload.available_brands = uniqueBrands.slice(0, 5)
    payload.available_segments = segments.segmentLabels
    payload.consultative_hint = `ATENÇÃO: A pergunta do cliente é GENÉRICA (sem marca ou tamanho especificado). É ESTRITAMENTE PROIBIDO listar 5 a 10 produtos com preços de uma vez! ` +
      `Responda de forma humana, calorosa e consultiva: confirme que temos excelentes opções, mencione as marcas disponíveis em negrito (${brandsList})${sizesList} ` +
      `e OBRIGATORIAMENTE PERGUNTE em UMA ÚNICA pergunta amigável se ele tem preferência por marca ou tamanho da embalagem antes de listar preços.`
  }

  // Verifica se o cliente buscou uma marca de mercado não disponível, mas temos opções equivalentes
  const askedBrand = KNOWN_MARKET_BRANDS.find(b => {
    const bNorm = b.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return normalizedQuery.includes(bNorm)
  })
  const foundAskedBrand = askedBrand 
    ? (uniqueBrands.some(ub => ub.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(askedBrand)) ||
       searchResult.matches.some(m => {
         const mNorm = (m.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
         const bNorm = askedBrand.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
         return new RegExp(`\\b${bNorm}\\b`, 'i').test(mNorm)
       }))
    : true

  if (askedBrand && !foundAskedBrand && searchResult.matches.length > 0) {
    payload.is_alternative_brand_recommendation = true
    payload.requested_brand_missing = askedBrand
    payload.consultative_hint = `O cliente solicitou a marca "${askedBrand.toUpperCase()}", porém não a temos em estoque no momento. Temos disponíveis excelentes opções equivalentes das marcas: ${uniqueBrands.join(', ')}. Avise com simpatia que não temos ${askedBrand.toUpperCase()} no momento e ofereça as opções disponíveis como alternativa.`
  }

  return decorateConsultativePayload(payload, searchResult, candidatePrices, parsedQuery)
}

/**
 * Decora o payload da estratégia comercial com inteligência de custo-benefício,
 * sugestão de aplicação técnica (ex: casquinhas de ovo) e rendimento de receita.
 */
function decorateConsultativePayload(
  payload: any,
  searchResult: StructuredSearchResponse,
  candidatePrices?: Map<string, { unit_price: number, subtotal: number }>,
  parsedQuery?: any
): any {
  if (!parsedQuery) return payload

  // 1. CUSTO-BENEFÍCIO (R$/KG)
  if (parsedQuery.isCostBenefitQuery) {
    const costBenefitList: Array<{
      id: string
      name: string
      weight_kg: number
      unit_price: number
      price_per_kg: number
      formatted_price_per_kg: string
    }> = []

    for (const m of searchResult.matches) {
      const p = candidatePrices?.get(m.id)
      const weight = extractWeightInKg(m.name)
      if (p && weight && weight > 0) {
        const ppk = p.unit_price / weight
        costBenefitList.push({
          id: m.id,
          name: m.name,
          weight_kg: weight,
          unit_price: p.unit_price,
          price_per_kg: Math.round(ppk * 100) / 100,
          formatted_price_per_kg: `R$ ${(ppk).toFixed(2).replace('.', ',')}/kg`
        })
      }
    }

    costBenefitList.sort((a, b) => a.price_per_kg - b.price_per_kg)

    if (costBenefitList.length > 0) {
      payload.cost_benefit_analysis = costBenefitList
      payload.best_cost_benefit = costBenefitList[0]
      const extraHint = `ANÁLISE DE CUSTO-BENEFÍCIO (R$/KG): A opção com melhor custo-benefício é ${costBenefitList[0].name} custando ${costBenefitList[0].formatted_price_per_kg}. Destaque esse cálculo consultivo para o cliente.`
      payload.consultative_hint = payload.consultative_hint
        ? `${payload.consultative_hint}\n${extraHint}`
        : extraHint
    }
  }

  // 2. OPÇÃO MAIS BARATA (MENOR VALOR ABSOLUTO)
  if (parsedQuery.isCheapestQuery) {
    const priced = searchResult.matches
      .map(m => ({ match: m, price: candidatePrices?.get(m.id) }))
      .filter(item => Boolean(item.price))
      .sort((a, b) => (a.price?.unit_price || 0) - (b.price?.unit_price || 0))

    if (priced.length > 0) {
      const cheapest = priced[0]
      payload.cheapest_option = {
        id: cheapest.match.id,
        name: cheapest.match.name,
        price: cheapest.price
      }
      const extraHint = `OPÇÃO MAIS ECONÔMICA: A opção com menor valor unitário é ${cheapest.match.name} por R$ ${cheapest.price?.unit_price.toFixed(2).replace('.', ',')}.`
      payload.consultative_hint = payload.consultative_hint
        ? `${payload.consultative_hint}\n${extraHint}`
        : extraHint
    }
  }

  // 3. ORIENTAÇÃO DE APLICAÇÃO (CASQUINHA / MOLDAGEM)
  if (parsedQuery.applicationNeed === 'casquinha') {
    payload.application_guidance = 'casquinha_de_ovo'
    const extraHint = 'ORIENTAÇÃO TÉCNICA (CASQUINHA / MOLDAGEM): Para casquinha de ovo de Páscoa, a Cobertura Fracionada (ex: Sicao Mais, Harald Top/Melken Cobertura) é a mais prática pois dispensa têmpera/choque térmico e seca com brilho firme. Já o Chocolate Nobre entrega sabor superior, mas exige pré-cristalização (temperagem). Apresente as opções e pergunte se o cliente prefere a praticidade da cobertura fracionada ou o sabor puro do chocolate nobre.'
    payload.consultative_hint = payload.consultative_hint
      ? `${payload.consultative_hint}\n${extraHint}`
      : extraHint
  } else if (parsedQuery.applicationNeed === 'recheio') {
    payload.application_guidance = 'recheio'
    const extraHint = 'ORIENTAÇÃO TÉCNICA (RECHEIO): Para recheio de ovos, trufas e bolos, o Chocolate Nobre e pastas/recheios cremosos fornecem cremosidade e sabor excepcionais, pois não necessitam de têmpera quando emulsionados com creme de leite.'
    payload.consultative_hint = payload.consultative_hint
      ? `${payload.consultative_hint}\n${extraHint}`
      : extraHint
  }

  // 4. RENDIMENTO DE RECEITA / FESTA (CONTAGEM DE DOCES)
  if (parsedQuery.targetCount) {
    payload.recipe_yield = {
      target_count: parsedQuery.targetCount,
      target_unit: parsedQuery.targetCountUnit
    }
    const target = parsedQuery.targetCount
    const estCansMin = Math.ceil(target / 30)
    const estCansMax = Math.ceil(target / 25)
    const extraHint = `CÁLCULO DE RENDIMENTO DE FESTA: O cliente mencionou produzir ${target} ${parsedQuery.targetCountUnit || 'doces'}. Na confeitaria, 1 lata de leite condensado (395g) rende em média 25 a 30 brigadeiros tradicionais de 15g-20g. Portanto, para ${target} doces são necessárias aproximadamente de ${estCansMin} a ${estCansMax} latas/caixas de leite condensado. Oriente essa quantidade e ofereça adicionar as latas ao pedido!`
    payload.consultative_hint = payload.consultative_hint
      ? `${payload.consultative_hint}\n${extraHint}`
      : extraHint
  }

  return payload
}
