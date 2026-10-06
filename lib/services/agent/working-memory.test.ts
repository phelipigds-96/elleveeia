import { applyWorkingMemoryUpdate, WorkingMemory } from './working-memory'

describe('Working Memory Consolidation', () => {

  it('deve extrair produto e preco pelo contrato de consultar_produto_comercial (data.product e data.pricing)', () => {
    const previous: WorkingMemory = {}

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          status: 'exact_match',
          product: { id: 'product-b', name: 'Cobertura Genuine M/Amargo 1kg' },
          pricing: { unit_price: 35.90, price_type: 'retail' }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('product-b')
    expect(next.activeProduct?.name).toBe('Cobertura Genuine M/Amargo 1kg')
    expect(next.activePrice?.unitPrice).toBe(35.90)
    expect(next.activePrice?.priceType).toBe('retail')
  })

  it('deve extrair produto e preco pelo contrato de buscar_produto (data.matches e data.price)', () => {
    const previous: WorkingMemory = {}

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          status: 'exact_match',
          matches: [{ id: 'product-a', name: 'Sicao 1kg' }],
          price: { unitPrice: 20.00, priceType: 'wholesale' }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('product-a')
    expect(next.activePrice?.unitPrice).toBe(20.00)
    expect(next.activePrice?.priceType).toBe('wholesale')
  })

  it('deve descartar preço e quantidade quando o produto muda (Cross Contamination)', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' },
      activePrice: { unitPrice: 29.99 },
      activeQuantity: 10
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          status: 'exact_match',
          product: { id: 'B', name: 'Produto B' }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('B')
    expect(next.activePrice).toBeUndefined()
    expect(next.activeQuantity).toBeUndefined()
  })

  it('deve preservar estado quando o produto for o mesmo', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' },
      activePrice: { unitPrice: 29.99 },
      activeQuantity: 10
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          status: 'exact_match',
          product: { id: 'A', name: 'Produto A' }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('A')
    expect(next.activePrice?.unitPrice).toBe(29.99)
    expect(next.activeQuantity).toBe(10)
  })

  it('não deve alterar produto se status for ambiguous', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          status: 'ambiguous',
          matches: [{ id: 'X', name: 'Candidato X' }, { id: 'Y', name: 'Candidato Y' }]
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('A')
  })

  it('não deve alterar produto se status for not_found', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          status: 'not_found',
          matches: []
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('A')
  })

  it('deve atualizar preço e quantidade a partir de calcular_preco_produto', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'calcular_preco_produto',
        data: {
          quantity: 20,
          unit_price: 49.99,
          price_type: 'wholesale'
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('A')
    expect(next.activeQuantity).toBe(20)
    expect(next.activePrice?.unitPrice).toBe(49.99)
    expect(next.activePrice?.priceType).toBe('wholesale')
  })
})
