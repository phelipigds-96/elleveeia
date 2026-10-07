import { applyCommercialStrategy } from './commercial-strategy'
import { StructuredSearchResponse } from '../catalog/products'

describe('Commercial Response Strategy', () => {
  it('TESTE 1 e 2: Generic Discovery para busca sem marca e com multiplicidade', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'Cobertura X', brand: 'Ki-Kakau', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'Cobertura Y', brand: 'Jazam', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '3', name: 'Cobertura Z', brand: 'Lecacau', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '4', name: 'Cobertura W', brand: 'Harald', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '5', name: 'Cobertura V', brand: 'Sicao', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem cobertura branca?', searchResult)
    expect(result.strategy).toBe('generic_discovery')
    expect(result.brands.length).toBe(4) // capped
    expect(result.product_count).toBe(5)
    expect(result.products).toBeUndefined() // NUNCA deve enviar a lista de SKUs
  })

  it('TESTE 3 e 4: Brand Specific Discovery se a marca estiver na query', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.9,
      matches: [
        { id: '1', name: 'Cobertura Genuine 1', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'Cobertura Genuine 2', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem cobertura Genuine meio amarga?', searchResult)
    expect(result.strategy).toBe('brand_specific_discovery')
    expect(result.brand).toBe('Genuine')
    expect(result.products.length).toBe(2)
  })

  it('TESTE 5: Specific Product para match exato com preo', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'exact_match',
      confidence: 1.0,
      matches: [
        { id: '1', name: 'Cobertura Genuine', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Quanto custa cobertura Genuine', searchResult, 1, { unit_price: 29.99 })
    expect(result.strategy).toBe('specific_product')
    expect(result.price.unit_price).toBe(29.99)
  })

  it('TESTE 6: Quantity Pricing se quantity > 1 com match exato', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'exact_match',
      confidence: 1.0,
      matches: [
        { id: '1', name: 'Cobertura Genuine', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Se eu levar 20?', searchResult, 20, { unit_price: 29.99, subtotal: 599.80 })
    expect(result.strategy).toBe('quantity_pricing')
    expect(result.quantity).toBe(20)
    expect(result.price.subtotal).toBe(599.80)
  })

  it('TESTE 7: Ambiguous Product (fallback) sem preo, mas cai em brand_specific devido a mesma marca', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.7,
      matches: [
        { id: '1', name: 'Cobertura Genuine A', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'Cobertura Genuine B', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Quanto custa cobertura Genuine', searchResult)
    // S h uma marca no DB, ento mesmo sem inteno extra de preo, ele exibe os produtos.
    expect(result.strategy).toBe('brand_specific_discovery')
    expect(result.products.length).toBe(2)
  })

  it('TESTE 8: Not Found se vazio', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'not_found',
      confidence: 0,
      matches: []
    }
    const result = applyCommercialStrategy('Tem unicornio?', searchResult)
    expect(result.strategy).toBe('not_found')
  })

  it('TESTE 9: Marcas deduplicadas case-insensitive', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'A', brand: 'Ki-Kakau', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'B', brand: 'KI-KAKAU', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '3', name: 'C', brand: 'Jazam', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '4', name: 'D', brand: 'Lecacau', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem cobertura branca?', searchResult)
    expect(result.strategy).toBe('generic_discovery')
    // Ki-Kakau no pode estar duplicado
    expect(result.brands).toEqual(['Ki-Kakau', 'Jazam', 'Lecacau'])
  })
})