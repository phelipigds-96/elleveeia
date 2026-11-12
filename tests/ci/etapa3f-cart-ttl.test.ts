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
import {
  isGenericProductQuery,
  extractAvailableSizes,
  applyCommercialStrategy
} from '@/lib/services/agent/commercial-strategy'
import {
  resolveToolScope,
  hasClearProductIntent,
  COMPLAINT_AND_FRUSTRATION_PATTERNS
} from '@/lib/services/agent/tool-scoping'

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

  await t.test('8. isGenericProductQuery detecta perguntas amplas vs específicas', () => {
    const brands = ['Sicao', 'Genuine', 'Dona Jura', 'Harald']

    // Perguntas genéricas (sem marca nem tamanho)
    assert.strictEqual(isGenericProductQuery('E chocolate em pó?', brands), true)
    assert.strictEqual(isGenericProductQuery('Tem cobertura?', brands), true)
    assert.strictEqual(isGenericProductQuery('Quais granulados você tem?', brands), true)
    assert.strictEqual(isGenericProductQuery('Tem leite condensado?', brands), true)

    // Perguntas específicas (com marca ou tamanho)
    assert.strictEqual(isGenericProductQuery('Tem chocolate da Genuine?', brands), false)
    assert.strictEqual(isGenericProductQuery('Quero cobertura barra 1kg', brands), false)
    assert.strictEqual(isGenericProductQuery('Chocolate em pó 500g', brands), false)
  })

  await t.test('9. extractAvailableSizes extrai pesos e gramagens das embalagens', () => {
    const sample = [
      { id: '1', name: 'CHOC. EM PO SICAO 50% (1.01KG)' },
      { id: '2', name: 'CHOC. EM PO SELECTA NAMUR 50% (200G)' },
      { id: '3', name: 'COB. GENUINE GTS BRANCO (2.05KG)' }
    ] as any

    const sizes = extractAvailableSizes(sample)
    assert.ok(sizes.includes('1.01kg'))
    assert.ok(sizes.includes('200g'))
    assert.ok(sizes.includes('2.05kg'))
  })

  await t.test('10. applyCommercialStrategy gera consultative_hint e is_broad_query para busca genérica', () => {
    const searchMock = {
      status: 'success',
      matches: [
        { id: '1', name: 'CHOC. EM PO SICAO 50% (1.01KG)', brand: 'Sicao' },
        { id: '2', name: 'CHOC. EM PO GENUINE 50% (1.05KG)', brand: 'Genuine' },
        { id: '3', name: 'CHOC. EM PO DONA JURA 55% (1.005KG)', brand: 'Dona Jura' },
        { id: '4', name: 'CHOC. EM PO HARALD MELKEN 50% (200G)', brand: 'Harald' }
      ]
    } as any

    const strategy = applyCommercialStrategy('E chocolate em pó?', searchMock, 1, undefined, new Map())
    assert.strictEqual(strategy.strategy, 'generic_discovery')
    assert.strictEqual(strategy.is_broad_query, true)
    assert.ok(strategy.consultative_hint)
    assert.match(strategy.consultative_hint, /GENÉRICA/)
    assert.match(strategy.consultative_hint, /PERGUNTE/)
    assert.ok(strategy.available_brands.includes('Sicao'))
    assert.ok(strategy.available_brands.includes('Genuine'))
  })

  await t.test('11. resolveToolScope disponibiliza transferir_para_humano no fechamento do orçamento', () => {
    const allTools = [
      { name: 'consultar_produto_comercial', metadata: { category: 'commercial' } },
      { name: 'gerar_orcamento', metadata: { category: 'quotes' } },
      { name: 'transferir_para_humano', metadata: { category: 'general' } }
    ] as any

    const cartMemory: WorkingMemory = {
      activeCart: [
        {
          productId: 'prod-genuine',
          name: 'COB. GENUINE BARRA BRANCO (1KG)',
          quantity: 2,
          unitPrice: 39.49,
          subtotal: 78.98,
          isPriceConfirmed: true
        }
      ]
    }

    // Mensagem de fechamento informando retirada e pagamento
    const tools = resolveToolScope(
      'Ok, vou retirar na loja, dai ja pago no ato da retirada',
      [],
      allTools,
      cartMemory
    )
    const names = tools.map((t: any) => t.name)

    assert.ok(names.includes('transferir_para_humano'), 'Deve disponibilizar transferir_para_humano no checkout')
    assert.ok(names.includes('gerar_orcamento'), 'Deve disponibilizar gerar_orcamento no checkout')
  })

  await t.test('12. hasClearProductIntent retorna false para reclamações, termos de SAC e clientes nervosos', () => {
    // Mesmo contendo palavras de produtos ("chocolate", "sicao", "leite"), não deve tratar como intenção de compra
    assert.strictEqual(
      hasClearProductIntent('comprei um chocolate sicao ontem e veio estragado, que absurdo'),
      false,
      'Produto estragado é reclamação, não busca comercial'
    )
    assert.strictEqual(
      hasClearProductIntent('veio faltando duas barras de chocolate na entrega, quero meu dinheiro de volta'),
      false,
      'Item faltando / estorno é reclamação'
    )
    assert.strictEqual(
      hasClearProductIntent('esse robo inútil não resolve nada, vou no procon'),
      false,
      'Frustração com robô e menção a procon não é busca de catálogo'
    )
    assert.strictEqual(
      hasClearProductIntent('estou muito irritado com esse atendimento péssimo'),
      false,
      'Cliente irritado não é busca de catálogo'
    )
  })

  await t.test('13. resolveToolScope isola transferir_para_humano e bloqueia ferramentas comerciais em reclamações', () => {
    const allTools = [
      { name: 'consultar_produto_comercial', metadata: { category: 'commercial' } },
      { name: 'calcular_preco_produto', metadata: { category: 'commercial' } },
      { name: 'gerar_orcamento', metadata: { category: 'quotes' } },
      { name: 'transferir_para_humano', metadata: { category: 'general' } }
    ] as any

    const cartMemory: WorkingMemory = {
      activeCart: [
        {
          productId: 'prod-genuine',
          name: 'COB. GENUINE BARRA BRANCO (1KG)',
          quantity: 2,
          unitPrice: 39.49,
          subtotal: 78.98,
          isPriceConfirmed: true
        }
      ]
    }

    // Caso 1: Reclamação com menção a produto
    const tools1 = resolveToolScope(
      'Comprei um chocolate sicao e veio estragado, quero falar com o gerente',
      [],
      allTools,
      cartMemory
    )
    const names1 = tools1.map((t: any) => t.name)
    assert.deepStrictEqual(names1, ['transferir_para_humano'], 'Deve conter apenas transferir_para_humano')
    assert.strictEqual(names1.includes('consultar_produto_comercial'), false, 'Não pode vazar busca de produto')
    assert.strictEqual(names1.includes('gerar_orcamento'), false, 'Não pode gerar orçamento')

    // Caso 2: Irritação com atendimento e ameaça de procon
    const tools2 = resolveToolScope(
      'Que atendimento horrível, atendimento de robô inútil, vou entrar no procon!',
      [],
      allTools
    )
    const names2 = tools2.map((t: any) => t.name)
    assert.deepStrictEqual(names2, ['transferir_para_humano'], 'Deve conter apenas transferir_para_humano')
  })
})
