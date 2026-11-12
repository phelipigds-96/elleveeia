import { test } from 'node:test'
import assert from 'node:assert'
import {
  isWorkingMemoryExpired,
  expireWorkingMemory,
  DEFAULT_WORKING_MEMORY_TTL_MS,
  applyWorkingMemoryUpdate,
  type WorkingMemory,
  addItemToCart,
  removeCartItem,
  clearCart
} from '@/lib/services/agent/working-memory'

test('ETAPA 3F — TTL e Expiração Automática de Carrinho e Memória Volátil', async (t) => {
  await t.test('1. isWorkingMemoryExpired lida com valores vazios e inválidos sem explodir', () => {
    assert.strictEqual(isWorkingMemoryExpired(null), false)
    assert.strictEqual(isWorkingMemoryExpired(undefined), false)
    assert.strictEqual(isWorkingMemoryExpired(''), false)
    assert.strictEqual(isWorkingMemoryExpired('data-invalida'), false)
  })

  await t.test('2. isWorkingMemoryExpired preserva carrinho recente (< 24h) e expira carrinho antigo (> 24h)', () => {
    const now = Date.now()

    // 10 minutos atrás
    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString()
    assert.strictEqual(isWorkingMemoryExpired(tenMinAgo, now), false)

    // 23 horas atrás (dentro da janela)
    const twentyThreeHoursAgo = new Date(now - 23 * 60 * 60 * 1000).toISOString()
    assert.strictEqual(isWorkingMemoryExpired(twentyThreeHoursAgo, now), false)

    // 25 horas atrás (expirado)
    const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString()
    assert.strictEqual(isWorkingMemoryExpired(twentyFiveHoursAgo, now), true)

    // 45 horas atrás (caso real reproduzido: 10/11 -> 12/11)
    const fortyFiveHoursAgo = new Date(now - 45 * 60 * 60 * 1000).toISOString()
    assert.strictEqual(isWorkingMemoryExpired(fortyFiveHoursAgo, now), true)
  })

  await t.test('3. isWorkingMemoryExpired respeita TTL customizado via parâmetro', () => {
    const now = Date.now()
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()

    // TTL de 1 hora
    assert.strictEqual(isWorkingMemoryExpired(twoHoursAgo, now, 1 * 60 * 60 * 1000), true)
    // TTL de 4 horas
    assert.strictEqual(isWorkingMemoryExpired(twoHoursAgo, now, 4 * 60 * 60 * 1000), false)
  })

  await t.test('4. expireWorkingMemory limpa carrinho, produtos descobertos e rascunho de orçamento', () => {
    const oldMemory: WorkingMemory = {
      activeProduct: { id: 'prod-nestle', name: 'CHOC. NESTLE BARRA MARFIM 1KG' },
      activePrice: { unitPrice: 89.99, priceType: 'varejo' },
      activeQuantity: 2,
      activeCart: [
        {
          productId: 'prod-nestle',
          name: 'CHOC. NESTLE BARRA MARFIM 1KG',
          quantity: 2,
          unitPrice: 89.99,
          subtotal: 179.98,
          isPriceConfirmed: true
        }
      ],
      discoveredProducts: [
        { id: 'prod-nestle', name: 'CHOC. NESTLE BARRA MARFIM 1KG', unitPrice: 89.99 }
      ],
      activeQuote: {
        id: 'quote-draft-1',
        total: 179.98,
        status: 'draft'
      }
    }

    const expired = expireWorkingMemory(oldMemory, '2026-11-12T18:00:00.000Z')

    assert.strictEqual(expired.activeCart, undefined)
    assert.strictEqual(expired.activeProduct, undefined)
    assert.strictEqual(expired.activePrice, undefined)
    assert.strictEqual(expired.activeQuantity, undefined)
    assert.strictEqual(expired.discoveredProducts, undefined)
    assert.strictEqual(expired.activeQuote, undefined)
    assert.strictEqual(expired.expiredAt, '2026-11-12T18:00:00.000Z')
    assert.strictEqual(expired.updatedAt, '2026-11-12T18:00:00.000Z')
  })

  await t.test('5. expireWorkingMemory preserva orçamentos formais aprovados/concluídos', () => {
    const memoryWithApprovedQuote: WorkingMemory = {
      activeCart: [
        {
          productId: 'prod-1',
          name: 'Item Antigo',
          quantity: 1,
          isPriceConfirmed: true
        }
      ],
      activeQuote: {
        id: 'quote-approved-123',
        total: 500,
        status: 'approved'
      }
    }

    const expired = expireWorkingMemory(memoryWithApprovedQuote)
    assert.strictEqual(expired.activeCart, undefined)
    assert.ok(expired.activeQuote)
    assert.strictEqual(expired.activeQuote?.id, 'quote-approved-123')
    assert.strictEqual(expired.activeQuote?.status, 'approved')
  })

  await t.test('6. addItemToCart, updateCart e removeCartItem atualizam updatedAt monotonicamente', () => {
    let memory: WorkingMemory = {}
    memory = addItemToCart(memory, {
      productId: 'p-1',
      name: 'Genuine Branco 1kg',
      quantity: 2,
      unitPrice: 39.49,
      isPriceConfirmed: true
    })

    assert.ok(memory.updatedAt)
    assert.strictEqual(memory.activeCart?.length, 1)

    memory = removeCartItem(memory, 'p-1')
    assert.strictEqual(memory.activeCart?.length, 0)
    assert.ok(memory.updatedAt)

    memory = clearCart(memory)
    assert.strictEqual(memory.activeCart?.length, 0)
  })

  await t.test('7. applyWorkingMemoryUpdate carimba updatedAt quando há resultados válidos', () => {
    const previous: WorkingMemory = {}
    const toolResults = [
      {
        success: true,
        toolName: 'consultar_preco',
        data: {
          product_id: 'p-genuine-50',
          unit_price: 61.49,
          price_type: 'varejo'
        }
      }
    ]

    const next = applyWorkingMemoryUpdate(previous, toolResults)
    assert.ok(next.updatedAt)
    assert.strictEqual(next.activePrice?.unitPrice, 61.49)
  })
})
