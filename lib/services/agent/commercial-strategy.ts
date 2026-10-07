import { StructuredSearchResponse, ProductSearchResult } from '../catalog/products'

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

export function applyCommercialStrategy(
  query: string,
  searchResult: StructuredSearchResponse,
  quantity: number = 1,
  pricingResult?: any
): any {
  if (searchResult.status === 'not_found' || searchResult.matches.length === 0) {
    return {
      strategy: 'not_found'
    }
  }

  // 1. EXACT MATCH / SPECIFIC PRODUCT
  if (searchResult.status === 'exact_match' || searchResult.matches.length === 1) {
    const bestProduct = searchResult.matches[0]
    
    if (pricingResult) {
      if (quantity > 1) {
        return {
          strategy: 'quantity_pricing',
          product: { id: bestProduct.id, name: bestProduct.name },
          quantity,
          price: pricingResult
        }
      }
      return {
        strategy: 'specific_product',
        product: { id: bestProduct.id, name: bestProduct.name },
        price: pricingResult
      }
    }
    
    return {
      strategy: 'specific_product',
      product: { id: bestProduct.id, name: bestProduct.name }
    }
  }

  // 2. DISCOVERY & AMBIGUOUS
  const uniqueBrands = extractUniqueBrands(searchResult.matches)
  const normalizedQuery = query.toLowerCase()
  const mentionedBrand = uniqueBrands.find(b => normalizedQuery.includes(b.toLowerCase()))

  // 3. BRAND SPECIFIC DISCOVERY
  if (mentionedBrand) {
    return {
      strategy: 'brand_specific_discovery',
      brand: mentionedBrand,
      products: searchResult.matches.slice(0, 5).map(m => ({
        id: m.id,
        name: m.name
      }))
    }
  }

  if (uniqueBrands.length === 1) {
    return {
      strategy: 'brand_specific_discovery',
      brand: uniqueBrands[0],
      products: searchResult.matches.slice(0, 5).map(m => ({
        id: m.id,
        name: m.name
      }))
    }
  }

  // 4. GENERIC DISCOVERY
  if (uniqueBrands.length > 1) {
    return {
      strategy: 'generic_discovery',
      brands: uniqueBrands.slice(0, 4),
      product_count: searchResult.matches.length
    }
  }

  // Fallback
  return {
    strategy: 'ambiguous_product',
    products: searchResult.matches.slice(0, 5).map(m => ({
      id: m.id,
      name: m.name
    }))
  }
}