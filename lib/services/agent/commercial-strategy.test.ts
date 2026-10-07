import { applyCommercialStrategy } from './commercial-strategy'
import { StructuredSearchResponse } from '../catalog/products'

describe('Commercial Response Strategy', () => {
  it('TESTE 1 e 2: Generic Discovery para busca sem marca', () => {
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

  it('TESTE 6: Caso sem marcas identificadas no banco', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'A', brand: null, sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'B', brand: null, sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem cobertura branca?', searchResult)
    expect(result.strategy).toBe('generic_discovery')
    expect(result.brands.length).toBe(0)
    expect(result.product_count).toBe(2)
    expect(result.products).toBeUndefined()
  })

  it('TESTE 7: Apenas uma marca identificada, mas NAO mencionada pelo usuario', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'A', brand: 'Ki-Kakau', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'B', brand: null, sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem cobertura branca?', searchResult)
    expect(result.strategy).toBe('generic_discovery')
    expect(result.brands).toEqual(['Ki-Kakau'])
    expect(result.product_count).toBe(2)
    expect(result.products).toBeUndefined()
  })

  it('TESTE 8: Marca explicitamente mencionada (mesmo com apenas 1 marca encontrada)', () => {
    const searchResult: StructuredSearchResponse = {
      status: 'ambiguous',
      confidence: 0.8,
      matches: [
        { id: '1', name: 'A', brand: 'Ki-Kakau', sku: null, barcode: null, category: null, unit: null, active: true },
        { id: '2', name: 'B', brand: 'Ki-Kakau', sku: null, barcode: null, category: null, unit: null, active: true }
      ]
    }
    const result = applyCommercialStrategy('Tem cobertura Ki-Kakau?', searchResult)
    expect(result.strategy).toBe('brand_specific_discovery')
    expect(result.brand).toBe('Ki-Kakau')
    expect(result.products.length).toBe(2)
  })
})