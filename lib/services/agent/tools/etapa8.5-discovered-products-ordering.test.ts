import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  type WorkingMemory,
  applyWorkingMemoryUpdate
} from '../working-memory'

describe('ETAPA 8.5 — Buffer de Produtos Apresentados e Ordem de Recência', () => {
  it('1. Deve priorizar produtos recém-descobertos no início do buffer (LIFO / Mais recentes primeiro)', () => {
    let memory: WorkingMemory = {}

    // 1º turno: descobre 12 chocolates Nestlé
    const nestleResults = [
      {
        toolName: 'consultar_produto_comercial',
        success: true,
        data: {
          strategy: 'generic_discovery',
          products: Array.from({ length: 12 }, (_, i) => ({
            id: `nestle-choc-${i + 1}`,
            name: `CHOC. NESTLE ${i + 1} 1KG`,
            price: { unit_price: 89.99, subtotal: 89.99 }
          }))
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, nestleResults)
    assert.strictEqual(memory.discoveredProducts?.length, 12)
    assert.strictEqual(memory.discoveredProducts?.[0].id, 'nestle-choc-1')

    // 2º turno: descobre 3 leites condensados Tirol
    const tirolResults = [
      {
        toolName: 'consultar_produto_comercial',
        success: true,
        data: {
          strategy: 'brand_specific_discovery',
          products: [
            { id: 'tirol-zero-lac', name: 'LEITE CONDENSADO TIROL 0% LACTOSE 395G', price: { unit_price: 8.99, subtotal: 8.99 } },
            { id: 'tirol-semi', name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G', price: { unit_price: 5.49, subtotal: 5.49 } },
            { id: 'tirol-cx27', name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 27X', price: { unit_price: 145.99, subtotal: 145.99 } }
          ]
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, tirolResults)

    // O total deve ser 15 produtos (3 Tirol + 12 Nestlé)
    assert.strictEqual(memory.discoveredProducts?.length, 15)

    // Os itens da Tirol DEVEM estar no início do array para não serem cortados no prompt!
    assert.strictEqual(memory.discoveredProducts?.[0].id, 'tirol-zero-lac')
    assert.strictEqual(memory.discoveredProducts?.[1].id, 'tirol-semi')
    assert.strictEqual(memory.discoveredProducts?.[2].id, 'tirol-cx27')

    // Quando o context-builder fizer .slice(0, 15), os itens Tirol estarão obrigatoriamente inclusos!
    const promptSlice = memory.discoveredProducts.slice(0, 15)
    assert.ok(promptSlice.some(p => p.id === 'tirol-zero-lac'))
    assert.ok(promptSlice.some(p => p.id === 'tirol-semi'))
    assert.ok(promptSlice.some(p => p.id === 'tirol-cx27'))
  })

  it('2. Atualizar um produto existente deve movê-lo para o topo com dados atualizados', () => {
    let memory: WorkingMemory = {
      discoveredProducts: [
        { id: 'prod-a', name: 'Produto A', unitPrice: 10 },
        { id: 'prod-b', name: 'Produto B', unitPrice: 20 },
        { id: 'prod-c', name: 'Produto C', unitPrice: 30 }
      ]
    }

    const updateResults = [
      {
        toolName: 'consultar_produto_comercial',
        success: true,
        data: {
          strategy: 'quantity_pricing',
          product: { id: 'prod-c', name: 'Produto C' },
          price: { unit_price: 28, subtotal: 280 },
          quantity: 10
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, updateResults)

    // prod-c agora deve ser o primeiro item com preço atualizado
    assert.strictEqual(memory.discoveredProducts?.[0].id, 'prod-c')
    assert.strictEqual(memory.discoveredProducts?.[0].unitPrice, 28)
    assert.strictEqual(memory.discoveredProducts?.[1].id, 'prod-a')
    assert.strictEqual(memory.discoveredProducts?.[2].id, 'prod-b')
  })

  it('3. Deve limitar o buffer em no máximo 20 produtos mantendo os mais recentes', () => {
    let memory: WorkingMemory = {}

    // Descobre 25 produtos sequencialmente
    for (let batch = 0; batch < 5; batch++) {
      const batchResults = [
        {
          toolName: 'consultar_produto_comercial',
          success: true,
          data: {
            strategy: 'generic_discovery',
            products: Array.from({ length: 5 }, (_, i) => ({
              id: `prod-batch-${batch}-item-${i}`,
              name: `Produto Batch ${batch} Item ${i}`,
              price: { unit_price: 10, subtotal: 10 }
            }))
          }
        }
      ]
      memory = applyWorkingMemoryUpdate(memory, batchResults)
    }

    assert.strictEqual(memory.discoveredProducts?.length, 20)
    // Os produtos do último batch (batch 4) devem estar no topo!
    assert.strictEqual(memory.discoveredProducts?.[0].id, 'prod-batch-4-item-0')
    assert.strictEqual(memory.discoveredProducts?.[4].id, 'prod-batch-4-item-4')
  })
})
