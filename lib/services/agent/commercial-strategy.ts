import type { StructuredSearchResponse, ProductSearchResult } from '../catalog/products'

export type CommercialResponseStrategy = 
  | 'generic_discovery'
  | 'brand_specific_discovery'
  | 'specific_product'
  | 'quantity_pricing'
  | 'ambiguous_product'
  | 'not_found'

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
  candidatePrices?: Map<string, { unit_price: number, subtotal: number }>
): any {
  if (searchResult.status === 'not_found' || searchResult.matches.length === 0) {
    return {
      strategy: 'not_found'
    }
  }

  // 1. EXACT MATCH / SPECIFIC PRODUCT OU MATCH EXATO DE NOME
  const normalizedQuery = query.toLowerCase().trim()
  const exactNameMatch = searchResult.matches.find(
    m => m.name.toLowerCase().trim() === normalizedQuery
  )
  const isExactOrSingle = searchResult.status === 'exact_match' || searchResult.matches.length === 1 || Boolean(exactNameMatch)

  if (isExactOrSingle) {
    const bestProduct = exactNameMatch || searchResult.matches[0]
    const resolvedPrice = pricingResult || candidatePrices?.get(bestProduct.id)
    
    if (resolvedPrice) {
      if (quantity > 1) {
        return {
          strategy: 'quantity_pricing',
          product: { id: bestProduct.id, name: bestProduct.name },
          quantity,
          price: resolvedPrice
        }
      }
      return {
        strategy: 'specific_product',
        product: { id: bestProduct.id, name: bestProduct.name },
        price: resolvedPrice
      }
    }
    
    return {
      strategy: 'specific_product',
      product: { id: bestProduct.id, name: bestProduct.name }
    }
  }

  // 2. DISCOVERY (Múltiplos candidatos)
  const uniqueBrands = extractUniqueBrands(searchResult.matches)
  const mentionedBrand = uniqueBrands.find(b => normalizedQuery.includes(b.toLowerCase()))

  // 3. BRAND SPECIFIC DISCOVERY
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
      if (resolvedPrice) {
        if (quantity > 1) {
          return {
            strategy: 'quantity_pricing',
            product: { id: bestProduct.id, name: bestProduct.name },
            quantity,
            price: resolvedPrice
          }
        }
        return {
          strategy: 'specific_product',
          product: { id: bestProduct.id, name: bestProduct.name },
          price: resolvedPrice
        }
      }
      return {
        strategy: 'specific_product',
        product: { id: bestProduct.id, name: bestProduct.name }
      }
    }

    const isWholesaleQuery = /\b(?:caixa|caixas|cx|cxs|fardo|fardos|display|displays|atacado|revenda)\b|\b\d+\s*x\b/i.test(normalizedQuery)
    const nonWholesaleMatches = targetMatches.filter(m => !/\b\d+\s*x\s*\d+|\b(?:cx|caixa|fardo|display|fd)\b/i.test(m.name || ''))
    const displayMatches = (!isWholesaleQuery && nonWholesaleMatches.length > 0) ? nonWholesaleMatches : targetMatches

    const segments = detectProductSegments(targetMatches)
    const isBroadSegmented = segments.segmentLabels.length > 1 && !/\b(?:1kg|2kg|cx|caixa|\d+g|barra|tablete)\b/i.test(normalizedQuery)

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

    return payload
  }

  // 4. GENERIC DISCOVERY
  const isGeneric = isGenericProductQuery(normalizedQuery, uniqueBrands)
  const isWholesaleQuery = /\b(?:caixa|caixas|cx|cxs|fardo|fardos|display|displays|atacado|revenda)\b|\b\d+\s*x\b/i.test(normalizedQuery)
  const nonWholesaleMatches = searchResult.matches.filter(m => !/\b\d+\s*x\s*\d+|\b(?:cx|caixa|fardo|display|fd)\b/i.test(m.name || ''))
  const displayMatches = (!isWholesaleQuery && nonWholesaleMatches.length > 0) ? nonWholesaleMatches : searchResult.matches

  const segments = detectProductSegments(searchResult.matches)
  const availableSizes = extractAvailableSizes(displayMatches)

  // É consulta ampla se o cliente fez uma pergunta genérica (sem marca/tamanho) E há mais de 2 produtos,
  // ou se o catálogo possui segmentos com finalidades distintas
  const isBroadQuery = (isGeneric && searchResult.matches.length > 2) || (segments.segmentLabels.length > 1 && !/\b(?:1kg|2kg|cx|caixa|\d+g|barra|tablete)\b/i.test(normalizedQuery))

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
      `e OBRIGATORIAMENTE PERGUNTE ao cliente se ele tem preferência por marca e/ou tamanho da embalagem antes de listar preços.`
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

  return payload
}
