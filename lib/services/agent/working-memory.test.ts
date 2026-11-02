import { describe, it } from 'node:test'
import assert from 'node:assert'
import { applyWorkingMemoryUpdate, type WorkingMemory } from './working-memory.ts'

// Helper expect para execução isolada e compatibilidade nativa com Jest / Node test runner
const localExpect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeDefined: () => assert.notStrictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual)
})

const expect = typeof (globalThis as any).expect === 'function' ? (globalThis as any).expect : localExpect

describe('Working Memory Consolidation', () => {

  // --- CONTRATOS LEGADOS (COMPATIBILIDADE RETROATIVA) ---

  it('deve extrair produto e preco pelo contrato legado de consultar_produto_comercial (data.product e data.pricing)', () => {
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

  // --- NOVOS TESTES DE ESQUEMA REAL (COMMERCIAL STRATEGY) ---

  it('deve reconhecer resultado comercial com strategy: specific_product', () => {
    const previous: WorkingMemory = {}

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'specific_product',
          product: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' },
          price: { unit_price: 38.50, subtotal: 38.50 }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
    expect(next.activeProduct?.name).toBe('Top Gotas Blend 1kg')
    expect(next.activePrice?.unitPrice).toBe(38.50)
  })

  it('deve reconhecer resultado comercial com strategy: quantity_pricing e atualizar quantidade', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'quantity_pricing',
          product: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' },
          quantity: 2,
          price: { unit_price: 38.50, subtotal: 77.00 }
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
    expect(next.activeQuantity).toBe(2)
    expect(next.activePrice?.unitPrice).toBe(38.50)
  })

  it('não deve alterar produto nem descartar dados em busca genérica (generic_discovery)', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 2,
      activePrice: { unitPrice: 38.50 }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'generic_discovery',
          brands: ['Harald', 'Sicao'],
          product_count: 8
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
    expect(next.activeQuantity).toBe(2)
    expect(next.activePrice?.unitPrice).toBe(38.50)
  })

  it('não deve alterar produto nem descartar dados em busca por marca (brand_specific_discovery)', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 2
    }

    const toolResults = [
      {
        success: true,
        toolName: 'buscar_produto',
        data: {
          strategy: 'brand_specific_discovery',
          brand: 'Harald',
          products: [
            { id: 'h1', name: 'Harald Top Branco 1kg' },
            { id: 'h2', name: 'Harald Top Meio Amargo 1kg' }
          ]
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
    expect(next.activeQuantity).toBe(2)
  })

  it('não deve alterar produto se strategy for not_found', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' }
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'not_found'
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
  })

  it('não deve alterar memória quando a ferramenta falhar (success: false)', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 2,
      activePrice: { unitPrice: 38.50 }
    }

    const toolResults = [
      {
        success: false,
        toolName: 'consultar_produto_comercial',
        error: 'Timeout de conexao com banco'
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
    expect(next.activeQuantity).toBe(2)
    expect(next.activePrice?.unitPrice).toBe(38.50)
  })

  it('deve atualizar preço através de consultar_preco preservando produto e quantidade', () => {
    const previous: WorkingMemory = {
      activeProduct: { id: 'prod-top-blend', name: 'Top Gotas Blend 1kg' },
      activeQuantity: 5
    }

    const toolResults = [
      {
        success: true,
        toolName: 'consultar_preco',
        data: {
          product_id: 'prod-top-blend',
          unit_price: 36.00,
          price_type: 'wholesale'
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)

    expect(next.activeProduct?.id).toBe('prod-top-blend')
    expect(next.activeQuantity).toBe(5)
    expect(next.activePrice?.unitPrice).toBe(36.00)
    expect(next.activePrice?.priceType).toBe('wholesale')
  })

  // --- CENÁRIO OBRIGATÓRIO DE REGRESSÃO ---

  it('Cenário Obrigatório: Sequência Mensagem 1 -> Mensagem 2 -> Mensagem 3', () => {
    // Estado inicial: conversa recém-iniciada sem memória prévia
    let currentMemory: WorkingMemory = {}

    // Mensagem 1: "Top Gotas Blend 1kg"
    // A ferramenta comercial retorna o produto específico identificado
    const turn1ToolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'specific_product',
          product: { id: 'uuid-top-blend-1kg', name: 'Top Gotas Blend 1kg' },
          price: { unit_price: 38.50, subtotal: 38.50 }
        }
      }
    ]

    currentMemory = applyWorkingMemoryUpdate(currentMemory, turn1ToolResults)

    // Resultado esperado Mensagem 1: produto salvo na Working Memory
    expect(currentMemory.activeProduct?.id).toBe('uuid-top-blend-1kg')
    expect(currentMemory.activeProduct?.name).toBe('Top Gotas Blend 1kg')
    expect(currentMemory.activePrice?.unitPrice).toBe(38.50)
    expect(currentMemory.activeQuantity).toBeUndefined()

    // Mensagem 2: "Quero 2 pacotes"
    // A ferramenta comercial calcula o preço para a nova quantidade mantendo o produto
    const turn2ToolResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'quantity_pricing',
          product: { id: 'uuid-top-blend-1kg', name: 'Top Gotas Blend 1kg' },
          quantity: 2,
          price: { unit_price: 38.50, subtotal: 77.00 }
        }
      }
    ]

    currentMemory = applyWorkingMemoryUpdate(currentMemory, turn2ToolResults)

    // Resultado esperado Mensagem 2: quantidade atualizada para 2, mantendo produto
    expect(currentMemory.activeProduct?.id).toBe('uuid-top-blend-1kg')
    expect(currentMemory.activeProduct?.name).toBe('Top Gotas Blend 1kg')
    expect(currentMemory.activeQuantity).toBe(2)
    expect(currentMemory.activePrice?.unitPrice).toBe(38.50)

    // Mensagem 3: "Quero fazer um orçamento"
    // A tool gerar_orcamento é executada (ou o turno ocorre)
    const turn3ToolResults = [
      {
        success: true,
        toolName: 'gerar_orcamento',
        data: {
          id: 'ORC-9999',
          status: 'draft',
          total: 77.00
        }
      }
    ]

    currentMemory = applyWorkingMemoryUpdate(currentMemory, turn3ToolResults)

    // Resultado esperado Mensagem 3: o estado continua contendo o produto e a quantidade corretos
    expect(currentMemory.activeProduct?.id).toBe('uuid-top-blend-1kg')
    expect(currentMemory.activeProduct?.name).toBe('Top Gotas Blend 1kg')
    expect(currentMemory.activeQuantity).toBe(2)
    expect(currentMemory.activePrice?.unitPrice).toBe(38.50)
    expect(currentMemory.activeQuote?.id).toBe('ORC-9999')
    expect(currentMemory.activeQuote?.total).toBe(77.00)
  })

})
