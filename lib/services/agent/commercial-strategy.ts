import { StructuredSearchResponse, ProductSearchResult } from '../catalog/products'

export type CommercialResponseStrategy = 
  | 'generic_discovery'
  | 'brand_specific_discovery'
  | 'specific_product'
  | 'quantity_pricing'
  | 'ambiguous_product'
  | 'not_found'

export function extractUniqueBrands(matches: ProductSearchResult[]): string[] {
  const brands = new Set<string>()
  for (const match of matches) {
    if (match.brand && match.brand.trim() !== '') {
      brands.add(match.brand.trim())
    }
  }
  return Array.from(brands)
}

export function applyCommercialStrategy(
  query: string,
  searchResult: StructuredSearchResponse,
  hasPriceIntent: boolean = false,
  quantity: number = 1,
  pricingResult?: any
): any {
  if (searchResult.status === 'not_found' || searchResult.matches.length === 0) {
    return {
      strategy: 'not_found',
      instruction_for_agent: 'Diga que nao encontrou o produto. NUNCA diga que esta sem estoque.'
    }
  }

  // 1. EXACT MATCH / SPECIFIC PRODUCT
  if (searchResult.status === 'exact_match' || searchResult.matches.length === 1) {
    const bestProduct = searchResult.matches[0]
    
    if (hasPriceIntent && pricingResult) {
      if (quantity > 1) {
        return {
          strategy: 'quantity_pricing',
          instruction_for_agent: 'Mostre o valor unitario e o total. Nao liste outras opcoes.',
          product: { id: bestProduct.id, name: bestProduct.name },
          quantity,
          price: pricingResult
        }
      }
      return {
        strategy: 'specific_product',
        instruction_for_agent: 'Mostre o valor do produto encontrado de forma direta. Nao pergunte marca ou liste outras opcoes.',
        product: { id: bestProduct.id, name: bestProduct.name },
        price: pricingResult
      }
    }
    
    return {
      strategy: 'specific_product',
      instruction_for_agent: 'Mostre o produto encontrado.',
      product: { id: bestProduct.id, name: bestProduct.name }
    }
  }

  // 2. AMBIGUOUS (Mltiplos Resultados)
  const uniqueBrands = extractUniqueBrands(searchResult.matches)
  const normalizedQuery = query.toLowerCase()
  const mentionedBrand = uniqueBrands.find(b => normalizedQuery.includes(b.toLowerCase()))

  if (hasPriceIntent) {
    return {
      strategy: 'ambiguous_product',
      instruction_for_agent: 'O cliente pediu preco, mas ha varias opcoes semelhantes. Liste de forma compacta os nomes e peca para ele escolher um para que voce calcule o preco exato.',
      products: searchResult.matches.slice(0, 5).map(m => ({
        id: m.id,
        name: m.name
      }))
    }
  }

  // 3. BRAND SPECIFIC DISCOVERY
  if (mentionedBrand) {
    return {
      strategy: 'brand_specific_discovery',
      brand: mentionedBrand,
      instruction_for_agent: 'O cliente buscou uma marca especifica. Liste de forma amigavel ate 5 opcoes exatas dessa marca encontradas e peca para escolher. Nao ofereca outras marcas.',
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
      instruction_for_agent: 'Apenas uma marca relevante foi encontrada. Diga que encontrou opcoes dessa marca, liste as opcoes e pergunte a preferencia.',
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
      instruction_for_agent: 'Responda de forma vendedora: "Temos sim! Trabalhamos com diversas marcas, como X, Y...". Cite no maximo 4 marcas da lista. NAO mostre os nomes dos produtos ainda. Pergunte se ele procura alguma marca especifica.',
      category: query,
      brands: uniqueBrands.slice(0, 4),
      total_brands: uniqueBrands.length,
      has_more_brands: uniqueBrands.length > 4
    }
  }

  // Fallback
  return {
    strategy: 'ambiguous_product',
    instruction_for_agent: 'Liste os produtos de forma compacta e peca para ele escolher.',
    products: searchResult.matches.slice(0, 5).map(m => ({
      id: m.id,
      name: m.name
    }))
  }
}