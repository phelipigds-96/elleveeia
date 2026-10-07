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
    expect(result.total_brands).toBe(5)
    expect(result.has_more_brands).toBe(true)
  })

  it('TESTE 3: Brand Specific Discovery se a marca estiver na query', () => {
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

  it('TESTE 4: Specific Product para match exato com preo', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'exact_match',
      confidence: 1.0,
      matches: [
        { id: '1', name: 'Cobertura Genuine', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Quanto custa cobertura Genuine', searchResult, true, 1, { unit_price: 29.99 })
    expect(result.strategy).toBe('specific_product')
    expect(result.price.unit_price).toBe(29.99)
  })

  it('TESTE 5: Quantity Pricing se quantity > 1 com match exato', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'exact_match',
      confidence: 1.0,
      matches: [
        { id: '1', name: 'Cobertura Genuine', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Se eu levar 20?', searchResult, true, 20, { unit_price: 29.99, subtotal: 599.80 })
    expect(result.strategy).toBe('quantity_pricing')
    expect(result.quantity).toBe(20)
    expect(result.price.subtotal).toBe(599.80)
  })

  it('TESTE 6: Ambiguous Product se inteno de preco em mltiplos produtos sem match exato', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.7,
      matches: [
        { id: '1', name: 'Cobertura Genuine A', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'Cobertura Genuine B', brand: 'Genuine', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Quanto custa cobertura Genuine', searchResult, true)
    expect(result.strategy).toBe('ambiguous_product')
    expect(result.products.length).toBe(2)
  })

  it('TESTE 7: Not Found se vazio', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'not_found',
      confidence: 0,
      matches: []
    }
    const result = applyCommercialStrategy('Tem unicornio?', searchResult)
    expect(result.strategy).toBe('not_found')
  })

  it('TESTE 8 e 9: Marcas deduplicadas e max limit', () => {
    // Coberto no Teste 1 (que recebe 5, dedup seria o mesmo set se duplicados)
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'A', brand: 'X', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'B', brand: 'X', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '3', name: 'C', brand: 'Y', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem?', searchResult)
    expect(result.brands).toEqual(['X', 'Y'])
  })

  it('TESTE 10: Somente uma marca identificada leva a brand specific discovery mesmo sem mencionar', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'A', brand: 'Sumel', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'B', brand: 'Sumel', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem?', searchResult)
    expect(result.strategy).toBe('brand_specific_discovery')
    expect(result.brand).toBe('Sumel')
  })
})