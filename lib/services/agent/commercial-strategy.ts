import type { StructuredSearchResponse, ProductSearchResult } from '../catalog/products'

export type CommercialResponseStrategy = 
  | 'generic_discovery'
  | 'brand_specific_discovery'
  | 'specific_product'
  | 'quantity_pricing'
  | 'ambiguous_product'
  | 'not_found'

export function extractUniqueBrands(matches: ProductSearchResult[]): string[] {
  const brandMap = new Map<string, string>() // lowercase -> original
  for (const match of matches) {
    if (match.brand && match.brand.trim() !== '') {
      const original = match.brand.trim()
      const lower = original.toLowerCase()
      if (!brandMap.has(lower)) {
        brandMap.set(lower, original)
      }
    }
  }
  return Array.from(brandMap.values())
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
    const brandMatches = searchResult.matches.filter(m => 
      m.brand && m.brand.toLowerCase() === mentionedBrand.toLowerCase()
    )
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

    const segments = detectProductSegments(targetMatches)
    const isBroadSegmented = segments.segmentLabels.length > 1 && !/\b(?:1kg|2kg|cx|caixa|\d+g|barra|tablete)\b/i.test(normalizedQuery)

    const payload: any = {
      strategy: 'brand_specific_discovery',
      brand: mentionedBrand,
      is_broad_query: isBroadSegmented,
      products: targetMatches.slice(0, 5).map(m => {
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
  const segments = detectProductSegments(searchResult.matches)
  const isBroadSegmented = segments.segmentLabels.length > 1 && !/\b(?:1kg|2kg|cx|caixa|\d+g|barra|tablete)\b/i.test(normalizedQuery)

  const payload: any = {
    strategy: 'generic_discovery',
    brands: uniqueBrands.slice(0, 4),
    product_count: searchResult.matches.length,
    is_broad_query: isBroadSegmented,
    products: searchResult.matches.slice(0, 5).map(m => {
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

  if (isBroadSegmented) {
    payload.available_segments = segments.segmentLabels
    payload.consultative_hint = 'A consulta do cliente é ampla e o catálogo possui opções com finalidades distintas: ' +
      segments.segmentLabels.join(', ') + '. Não jogue a lista de preços completa. Faça uma pergunta consultiva amigável perguntando se ele procura para confeitaria/receitas ou para consumo próprio/docinho.'
  }

  return payload
}
