import { applyWorkingMemoryUpdate, WorkingMemory } from './working-memory'

describe('Working Memory Consolidation', () => {

  it('deve descartar preço e quantidade quando o produto muda (Cross Contamination)', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' },
      activePrice: { unitPrice: 29.99 },
      activeQuantity: 20
    }

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          status: 'exact_match',
          matches: [{ id: 'B', name: 'Produto B' }]
          // Sem price, sem quantity
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
      activeQuantity: 20
    }

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          status: 'exact_match',
          matches: [{ id: 'A', name: 'Produto A' }]
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('A')
    expect(next.activePrice?.unitPrice).toBe(29.99)
    expect(next.activeQuantity).toBe(20)
  })

  it('deve aplicar novo preo no produto B', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' },
      activePrice: { unitPrice: 29.99 }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          status: 'exact_match',
          matches: [{ id: 'B', name: 'Produto B' }],
          price: { unitPrice: 15.00 }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('B')
    expect(next.activePrice?.unitPrice).toBe(15.00)
  })

  it('deve atualizar apenas quantidade do produto B', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'A', name: 'Produto A' },
      activeQuantity: 20
    }

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          status: 'exact_match',
          matches: [{ id: 'B', name: 'Produto B' }]
        }
      },
      {
        success: true,
        toolName: 'calcular_preco_produto',
        data: {
          quantity: 5
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('B')
    expect(next.activeQuantity).toBe(5)
  })

  it('nǜo deve alterar produto se status for ambiguous', () => {
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

    // Produto ativo contnua sendo A porque X/Y sǜo ambguos
    expect(next.activeProduct?.id).toBe('A')
  })

  it('nǜo deve alterar produto se status for not_found', () => {
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
})
