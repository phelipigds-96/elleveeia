import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  type WorkingMemory,
  type CartItem,
  addItemToCart,
  updateCartItemQuantity,
  updateCartItemPrice,
  removeCartItem,
  getCartItems,
  calculateCartTotal,
  clearCart,
  applyWorkingMemoryUpdate
} from '../working-memory.ts'

const localExpect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeDefined: () => assert.notStrictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual)
})

const expect = typeof (globalThis as any).expect === 'function' ? (globalThis as any).expect : localExpect

describe('ETAPA 7.1 — Working Memory Multi-Item (Carrinho Comercial)', () => {

  it('1. Deve adicionar o primeiro produto ao carrinho com preço validado', () => {
    let memory: WorkingMemory = {}

    memory = addItemToCart(memory, {
      productId: 'prod-top-blend-1kg',
      name: 'Cobertura Harald Top Blend 1kg',
      quantity: 2,
      unitPrice: 38.50,
      subtotal: 77.00,
      priceType: 'retail',
      isPriceConfirmed: true
    })

    const items = getCartItems(memory)
    expect(items.length).toBe(1)
    expect(items[0].productId).toBe('prod-top-blend-1kg')
    expect(items[0].name).toBe('Cobertura Harald Top Blend 1kg')
    expect(items[0].quantity).toBe(2)
    expect(items[0].unitPrice).toBe(38.50)
    expect(items[0].subtotal).toBe(77.00)
    expect(items[0].isPriceConfirmed).toBe(true)

    const calc = calculateCartTotal(memory)
    expect(calc.total).toBe(77.00)
    expect(calc.itemCount).toBe(1)
    expect(calc.allPricesConfirmed).toBe(true)
    expect(calc.unconfirmedProductIds.length).toBe(0)
  })

  it('2. Deve adicionar um segundo produto sem apagar nem sobrescrever o primeiro', () => {
    let memory: WorkingMemory = {}

    // Item 1
    memory = addItemToCart(memory, {
      productId: 'prod-top-blend-1kg',
      name: 'Cobertura Harald Top Blend 1kg',
      quantity: 2,
      unitPrice: 38.50,
      subtotal: 77.00,
      priceType: 'retail',
      isPriceConfirmed: true
    })

    // Item 2
    memory = addItemToCart(memory, {
      productId: 'prod-granulado-melken',
      name: 'Granulado Melken Preto 500g',
      quantity: 5,
      unitPrice: 18.00,
      subtotal: 90.00,
      priceType: 'wholesale',
      isPriceConfirmed: true
    })

    const items = getCartItems(memory)
    expect(items.length).toBe(2)

    // Primeiro item intacto
    expect(items[0].productId).toBe('prod-top-blend-1kg')
    expect(items[0].quantity).toBe(2)
    expect(items[0].unitPrice).toBe(38.50)
    expect(items[0].subtotal).toBe(77.00)

    // Segundo item adicionado
    expect(items[1].productId).toBe('prod-granulado-melken')
    expect(items[1].quantity).toBe(5)
    expect(items[1].unitPrice).toBe(18.00)
    expect(items[1].subtotal).toBe(90.00)

    const calc = calculateCartTotal(memory)
    expect(calc.total).toBe(167.00) // 77.00 + 90.00
    expect(calc.itemCount).toBe(2)
    expect(calc.allPricesConfirmed).toBe(true)
  })

  it('3. Adicionar novamente o mesmo produto deve atualizar a quantidade sem duplicar o item', () => {
    let memory: WorkingMemory = {}

    memory = addItemToCart(memory, {
      productId: 'prod-top-blend-1kg',
      name: 'Cobertura Harald Top Blend 1kg',
      quantity: 2,
      unitPrice: 38.50,
      subtotal: 77.00,
      isPriceConfirmed: true
    })

    // Re-adicionando com nova quantidade e novo preço confirmado
    memory = addItemToCart(memory, {
      productId: 'prod-top-blend-1kg',
      name: 'Cobertura Harald Top Blend 1kg',
      quantity: 10,
      unitPrice: 35.00,
      subtotal: 350.00,
      priceType: 'wholesale',
      isPriceConfirmed: true
    })

    const items = getCartItems(memory)
    expect(items.length).toBe(1) // Não duplica!
    expect(items[0].quantity).toBe(10)
    expect(items[0].unitPrice).toBe(35.00)
    expect(items[0].subtotal).toBe(350.00)
    expect(items[0].priceType).toBe('wholesale')
  })

  it('4. Alterar a quantidade diretamente deve invalidar o preço anterior como definitivo', () => {
    let memory: WorkingMemory = {}

    memory = addItemToCart(memory, {
      productId: 'prod-top-blend-1kg',
      name: 'Cobertura Harald Top Blend 1kg',
      quantity: 2,
      unitPrice: 38.50,
      subtotal: 77.00,
      isPriceConfirmed: true
    })

    // Cliente mudou a quantidade para 15 sem que nova precificação tenha sido executada
    memory = updateCartItemQuantity(memory, 'prod-top-blend-1kg', 15)

    const items = getCartItems(memory)
    expect(items[0].quantity).toBe(15)
    expect(items[0].isPriceConfirmed).toBe(false)
    expect(items[0].subtotal).toBeUndefined()

    // O total consolidado avisa que os preços não estão todos confirmados
    const calc = calculateCartTotal(memory)
    expect(calc.allPricesConfirmed).toBe(false)
    expect(calc.unconfirmedProductIds).toEqual(['prod-top-blend-1kg'])
  })

  it('5. Atualizar o preço validado após mudança de quantidade restaura a confirmação do item', () => {
    let memory: WorkingMemory = {}

    memory = addItemToCart(memory, {
      productId: 'prod-top-blend-1kg',
      name: 'Cobertura Harald Top Blend 1kg',
      quantity: 2,
      unitPrice: 38.50,
      subtotal: 77.00,
      isPriceConfirmed: true
    })

    // Altera quantidade para 15 (invalida preço)
    memory = updateCartItemQuantity(memory, 'prod-top-blend-1kg', 15)
    expect(calculateCartTotal(memory).allPricesConfirmed).toBe(false)

    // Ferramenta comercial roda e valida o preço para a faixa de 15 unidades
    memory = updateCartItemPrice(memory, 'prod-top-blend-1kg', {
      unitPrice: 34.50,
      priceType: 'wholesale'
    })

    const items = getCartItems(memory)
    expect(items[0].quantity).toBe(15)
    expect(items[0].unitPrice).toBe(34.50)
    expect(items[0].subtotal).toBe(517.50) // 15 * 34.50
    expect(items[0].isPriceConfirmed).toBe(true)

    const calc = calculateCartTotal(memory)
    expect(calc.allPricesConfirmed).toBe(true)
    expect(calc.total).toBe(517.50)
  })

  it('6. Remover um produto deve preservar os demais produtos do carrinho', () => {
    let memory: WorkingMemory = {}

    memory = addItemToCart(memory, {
      productId: 'prod-1',
      name: 'Produto 1',
      quantity: 2,
      unitPrice: 10.00,
      subtotal: 20.00,
      isPriceConfirmed: true
    })

    memory = addItemToCart(memory, {
      productId: 'prod-2',
      name: 'Produto 2',
      quantity: 3,
      unitPrice: 15.00,
      subtotal: 45.00,
      isPriceConfirmed: true
    })

    memory = addItemToCart(memory, {
      productId: 'prod-3',
      name: 'Produto 3',
      quantity: 1,
      unitPrice: 50.00,
      subtotal: 50.00,
      isPriceConfirmed: true
    })

    expect(getCartItems(memory).length).toBe(3)

    // Remove apenas o produto 2
    memory = removeCartItem(memory, 'prod-2')

    const items = getCartItems(memory)
    expect(items.length).toBe(2)
    expect(items.some(i => i.productId === 'prod-1')).toBe(true)
    expect(items.some(i => i.productId === 'prod-2')).toBe(false)
    expect(items.some(i => i.productId === 'prod-3')).toBe(true)

    const calc = calculateCartTotal(memory)
    expect(calc.total).toBe(70.00) // 20.00 + 50.00
  })

  it('7. Preservar total compatibilidade com memórias antigas que não possuem activeCart', () => {
    // Memória legada apenas com os campos antigos
    const legacyMemory: WorkingMemory = {
      activeProduct: { id: 'prod-legado', name: 'Chocolate Legado 1kg' },
      activePrice: { unitPrice: 29.90, priceType: 'retail' },
      activeQuantity: 1
    }

    // Consulta de itens no carrinho retorna vazio de forma segura
    const items = getCartItems(legacyMemory)
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBe(0)

    // Cálculo consolidado trata com segurança
    const calc = calculateCartTotal(legacyMemory)
    expect(calc.total).toBe(0)
    expect(calc.itemCount).toBe(0)
    expect(calc.allPricesConfirmed).toBe(true)

    // Invocação de applyWorkingMemoryUpdate preserva os campos legados
    const updated = applyWorkingMemoryUpdate(legacyMemory, [])
    expect(updated.activeProduct?.id).toBe('prod-legado')
    expect(updated.activePrice?.unitPrice).toBe(29.90)
    expect(updated.activeQuantity).toBe(1)
  })

  it('8. Não aceitar preço arbitrário do LLM como confirmado sem validação', () => {
    let memory: WorkingMemory = {}

    // Tentativa de adicionar item com isPriceConfirmed: false
    memory = addItemToCart(memory, {
      productId: 'prod-alucinado',
      name: 'Produto com Preço Duvidoso',
      quantity: 5,
      unitPrice: 10.00,
      isPriceConfirmed: false
    })

    const items = getCartItems(memory)
    expect(items[0].isPriceConfirmed).toBe(false)

    // O total consolidado recusa calcular preços não confirmados
    const calc = calculateCartTotal(memory)
    expect(calc.allPricesConfirmed).toBe(false)
    expect(calc.unconfirmedProductIds).toEqual(['prod-alucinado'])
  })

  it('9. Preservar activeQuote durante alterações do carrinho', () => {
    let memory: WorkingMemory = {
      activeQuote: {
        id: 'ORC-DRAFT-888',
        total: 150.00,
        status: 'draft'
      }
    }

    // Adiciona ao carrinho
    memory = addItemToCart(memory, {
      productId: 'prod-1',
      name: 'Item 1',
      quantity: 1,
      unitPrice: 20.00,
      subtotal: 20.00,
      isPriceConfirmed: true
    })

    // Altera quantidade
    memory = updateCartItemQuantity(memory, 'prod-1', 4)

    // Remove do carrinho
    memory = removeCartItem(memory, 'prod-1')

    // activeQuote permanece inalterado!
    expect(memory.activeQuote?.id).toBe('ORC-DRAFT-888')
    expect(memory.activeQuote?.total).toBe(150.00)
    expect(memory.activeQuote?.status).toBe('draft')
  })

  it('10. Consulta de produto (buscar_produto ou specific_product) NÃO adiciona automaticamente ao carrinho', () => {
    let memory: WorkingMemory = {}

    // Consulta de catálogo simples apenas para verificar disponibilidade
    const searchResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'specific_product',
          product: { id: 'prod-apenas-consulta', name: 'Cobertura Branca 1kg' },
          price: { unit_price: 40.00, subtotal: 40.00 }
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, searchResults)

    // Produto ativo foi registrado para a conversa
    expect(memory.activeProduct?.id).toBe('prod-apenas-consulta')
    expect(memory.activePrice?.unitPrice).toBe(40.00)

    // Mas o carrinho continua vazio! (Cliente apenas pesquisou, não comprou nem solicitou quantidade)
    const items = getCartItems(memory)
    expect(items.length).toBe(0)
  })

  it('11. Consulta com quantidade confirmada (quantity_pricing) sincroniza o item no carrinho', () => {
    let memory: WorkingMemory = {}

    // Cliente pede explicitamente: "Quero 3 pacotes da cobertura branca"
    const quantityResults = [
      {
        success: true,
        toolName: 'consultar_produto_comercial',
        data: {
          strategy: 'quantity_pricing',
          product: { id: 'prod-branca-1kg', name: 'Cobertura Branca 1kg' },
          quantity: 3,
          price: { unit_price: 40.00, subtotal: 120.00 }
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, quantityResults)

    expect(memory.activeProduct?.id).toBe('prod-branca-1kg')
    expect(memory.activeQuantity).toBe(3)
    expect(memory.activePrice?.unitPrice).toBe(40.00)

    const items = getCartItems(memory)
    expect(items.length).toBe(1)
    expect(items[0].productId).toBe('prod-branca-1kg')
    expect(items[0].quantity).toBe(3)
    expect(items[0].unitPrice).toBe(40.00)
    expect(items[0].subtotal).toBe(120.00)
    expect(items[0].isPriceConfirmed).toBe(true)
  })

  it('12. Sincronização automática do carrinho ao gerar orçamento com múltiplos itens', () => {
    let memory: WorkingMemory = {}

    const quoteToolResults = [
      {
        success: true,
        toolName: 'gerar_orcamento',
        data: {
          id: 'ORC-MULTI-100',
          status: 'draft',
          total: 250.00,
          items: [
            { productId: 'prod-1', productName: 'Cobertura Top 1kg', quantity: 4, unitPrice: 35.00, subtotal: 140.00 },
            { productId: 'prod-2', productName: 'Granulado Melken 500g', quantity: 5, unitPrice: 22.00, subtotal: 110.00 }
          ]
        }
      }
    ]

    memory = applyWorkingMemoryUpdate(memory, quoteToolResults)

    expect(memory.activeQuote?.id).toBe('ORC-MULTI-100')
    expect(memory.activeQuote?.total).toBe(250.00)
    expect(memory.activeQuote?.status).toBe('draft')

    const items = getCartItems(memory)
    expect(items.length).toBe(2)
    expect(items[0].productId).toBe('prod-1')
    expect(items[0].quantity).toBe(4)
    expect(items[0].subtotal).toBe(140.00)
    expect(items[1].productId).toBe('prod-2')
    expect(items[1].quantity).toBe(5)
    expect(items[1].subtotal).toBe(110.00)

    const calc = calculateCartTotal(memory)
    expect(calc.total).toBe(250.00)
    expect(calc.allPricesConfirmed).toBe(true)
  })

  it('13. Limpar carrinho esvazia itens sem remover produto ativo ou activeQuote', () => {
    let memory: WorkingMemory = {
      activeProduct: { id: 'prod-1', name: 'Produto 1' },
      activeQuote: { id: 'ORC-1', total: 100, status: 'draft' }
    }

    memory = addItemToCart(memory, {
      productId: 'prod-1',
      name: 'Produto 1',
      quantity: 2,
      unitPrice: 50.00,
      subtotal: 100.00,
      isPriceConfirmed: true
    })

    expect(getCartItems(memory).length).toBe(1)

    memory = clearCart(memory)

    expect(getCartItems(memory).length).toBe(0)
    expect(memory.activeProduct?.id).toBe('prod-1')
    expect(memory.activeQuote?.id).toBe('ORC-1')
  })

})
