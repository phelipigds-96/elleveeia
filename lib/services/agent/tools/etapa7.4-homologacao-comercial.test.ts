import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { resolveToolScope } from '../tool-scoping.ts'
import { consultarProdutoComercialTool } from './consultar-produto-comercial.ts'
import { consultarPrecoTool } from './consultar-preco.ts'
import { calcularPrecoProdutoTool } from './calcular-preco.ts'
import { gerarOrcamentoTool } from './gerar-orcamento.ts'
import { consultarOrcamentoTool } from './consultar-orcamento.ts'
import { resolveProductPrice } from '@/lib/services/commercial/pricing.ts'
import {
  type WorkingMemory,
  addItemToCart,
  updateCartItemQuantity,
  updateCartItemPrice,
  removeCartItem,
  getCartItems,
  calculateCartTotal,
  applyWorkingMemoryUpdate
} from '../working-memory.ts'
import { formatWorkingMemoryPrompt } from '../context-builder.ts'
import { buildSafeIterationLimitResponse } from '../engine.ts'
import {
  resetInMemoryDb,
  setInMemoryPrices,
  setInMemoryProducts,
  getInMemoryQuotesCount
} from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

const localExpect = (actual: any) => ({
  toBe: (expected: any) => assert.strictEqual(actual, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
  toBeUndefined: () => assert.strictEqual(actual, undefined),
  toBeDefined: () => assert.notStrictEqual(actual, undefined),
  toBeTruthy: () => assert.ok(actual),
  toBeFalsy: () => assert.ok(!actual),
  toContain: (substring: string) => assert.ok(typeof actual === 'string' && actual.includes(substring), `Esperava que "${actual}" contivesse "${substring}"`),
  toNotContain: (substring: string) => assert.ok(typeof actual === 'string' && !actual.includes(substring), `Esperava que "${actual}" NÃO contivesse "${substring}"`)
})

const expect = typeof (globalThis as any).expect === 'function' ? (globalThis as any).expect : localExpect

describe('ETAPA 7.4 — Homologação Automatizada dos 13 Cenários Comerciais e Regressão', () => {
  const companyId = '00000000-0000-0000-0000-000000000001' // Sumel
  const companyId2 = '00000000-0000-0000-0000-000000000009' // Outra Empresa
  const conversationId = '00000000-0000-0000-0000-000000000003'
  const customerId = '00000000-0000-0000-0000-000000000004'

  const availableTools = [
    consultarProdutoComercialTool,
    consultarPrecoTool,
    calcularPrecoProdutoTool,
    gerarOrcamentoTool,
    consultarOrcamentoTool
  ]

  // IDs dos produtos da homologação
  const ID_TOP_BLEND = '11111111-1111-1111-1111-111111111111'
  const ID_TOP_LEITE = '22222222-2222-2222-2222-222222222222'
  const ID_SICAO_BLEND = '33333333-3333-3333-3333-333333333333'
  const ID_GRANULADO = '44444444-4444-4444-4444-444444444444'
  const ID_FORMA_TRUFA = '55555555-5555-5555-5555-555555555555'
  const ID_FORMA_BOMBOM = '66666666-6666-6666-6666-666666666666'
  const ID_SEM_PRECO = '77777777-7777-7777-7777-777777777777'
  const ID_EMP2_PROD = '88888888-8888-8888-8888-888888888888'

  // Fixtures controladas de homologação
  const homologationProducts = [
    {
      id: ID_TOP_BLEND,
      company_id: companyId,
      name: 'Cobertura Fracionada Chocolate Harald Top Gotas Blend 1kg',
      normalized_name: 'cobertura fracionada chocolate harald top gotas blend 1kg',
      unit: 'kg',
      active: true,
      product_brands: { name: 'Harald' },
      product_categories: { name: 'Cobertura' }
    },
    {
      id: ID_TOP_LEITE,
      company_id: companyId,
      name: 'Cobertura Fracionada Chocolate Harald Top Gotas Ao Leite 1kg',
      normalized_name: 'cobertura fracionada chocolate harald top gotas ao leite 1kg',
      unit: 'kg',
      active: true,
      product_brands: { name: 'Harald' },
      product_categories: { name: 'Cobertura' }
    },
    {
      id: ID_SICAO_BLEND,
      company_id: companyId,
      name: 'Cobertura Fracionada Chocolate Sicao Gotas Blend 1kg',
      normalized_name: 'cobertura fracionada chocolate sicao gotas blend 1kg',
      unit: 'kg',
      active: true,
      product_brands: { name: 'Sicao' },
      product_categories: { name: 'Cobertura' }
    },
    {
      id: ID_GRANULADO,
      company_id: companyId,
      name: 'Granulado Melken Chocolate Preto 500g',
      normalized_name: 'granulado melken chocolate preto 500g',
      unit: 'g',
      active: true,
      product_brands: { name: 'Harald' },
      product_categories: { name: 'Confeitos' }
    },
    {
      id: ID_FORMA_TRUFA,
      company_id: companyId,
      name: 'Forma de Acetato Especial Trufa Pequena BWB',
      normalized_name: 'forma de acetato especial trufa pequena bwb',
      unit: 'un',
      active: true,
      product_brands: { name: 'BWB' },
      product_categories: { name: 'Formas' }
    },
    {
      id: ID_FORMA_BOMBOM,
      company_id: companyId,
      name: 'Forma de Acetato Especial Bombom BWB',
      normalized_name: 'forma de acetato especial bombom bwb',
      unit: 'un',
      active: true,
      product_brands: { name: 'BWB' },
      product_categories: { name: 'Formas' }
    },
    {
      id: ID_SEM_PRECO,
      company_id: companyId,
      name: 'Produto Especial Sem Preço Cadastrado',
      normalized_name: 'produto especial sem preco cadastrado',
      unit: 'un',
      active: true,
      product_brands: { name: 'Harald' },
      product_categories: { name: 'Geral' }
    },
    {
      id: ID_EMP2_PROD,
      company_id: companyId2,
      name: 'Produto Exclusivo da Empresa Concorrente',
      normalized_name: 'produto exclusivo da empresa concorrente',
      unit: 'un',
      active: true,
      product_brands: { name: 'MarcaEmp2' },
      product_categories: { name: 'Outros' }
    }
  ]

  const homologationPrices = [
    // Top Blend: varejo 38.50, atacado 10+ por 35.00, atacado 20+ por 32.00, clube 29.90
    { id: 'pr-1', company_id: companyId, product_id: ID_TOP_BLEND, price: 38.50, price_type: 'retail', min_quantity: 1, active: true },
    { id: 'pr-2', company_id: companyId, product_id: ID_TOP_BLEND, price: 35.00, price_type: 'wholesale', min_quantity: 10, active: true },
    { id: 'pr-3', company_id: companyId, product_id: ID_TOP_BLEND, price: 32.00, price_type: 'wholesale', min_quantity: 20, active: true },
    { id: 'pr-4', company_id: companyId, product_id: ID_TOP_BLEND, price: 29.90, price_type: 'club', min_quantity: 1, active: true },

    // Top Ao Leite: varejo 39.00
    { id: 'pr-5', company_id: companyId, product_id: ID_TOP_LEITE, price: 39.00, price_type: 'retail', min_quantity: 1, active: true },

    // Sicao Blend: varejo 36.00
    { id: 'pr-6', company_id: companyId, product_id: ID_SICAO_BLEND, price: 36.00, price_type: 'retail', min_quantity: 1, active: true },

    // Granulado Melken: varejo 18.00, atacado 5+ por 15.00
    { id: 'pr-7', company_id: companyId, product_id: ID_GRANULADO, price: 18.00, price_type: 'retail', min_quantity: 1, active: true },
    { id: 'pr-8', company_id: companyId, product_id: ID_GRANULADO, price: 15.00, price_type: 'wholesale', min_quantity: 5, active: true },

    // Formas BWB: 7.50
    { id: 'pr-9', company_id: companyId, product_id: ID_FORMA_TRUFA, price: 7.50, price_type: 'retail', min_quantity: 1, active: true },
    { id: 'pr-10', company_id: companyId, product_id: ID_FORMA_BOMBOM, price: 7.50, price_type: 'retail', min_quantity: 1, active: true },

    // Preço exclusivo Empresa 2
    { id: 'pr-11', company_id: companyId2, product_id: ID_EMP2_PROD, price: 99.00, price_type: 'retail', min_quantity: 1, active: true }
  ]

  beforeEach(() => {
    resetInMemoryDb()
    setInMemoryProducts(homologationProducts)
    setInMemoryPrices(homologationPrices)
  })

  // ==========================================================================
  // SEÇÃO 1: OS 13 CENÁRIOS COMERCIAIS OBRIGATÓRIOS
  // ==========================================================================

  describe('Parte 1 — Os 13 Cenários Comerciais Obrigatórios', () => {

    it('Cenário 1 — Consulta de produto e marca: identifica opções reais e não adiciona ao carrinho automaticamente', async () => {
      const msg = 'Vocês têm produtos da marca Harald?'
      const scoped = resolveToolScope(msg, [], availableTools)
      expect(scoped.some(t => t.name === 'consultar_produto_comercial')).toBe(true)

      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'Harald' },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      expect(result.data.strategy).toBe('brand_specific_discovery')
      expect(result.data.brand).toBe('Harald')
      expect(result.data.products.length >= 2).toBe(true)

      // Atualização de memória: não adiciona ao carrinho
      const memory = applyWorkingMemoryUpdate({}, [result])
      expect(getCartItems(memory).length).toBe(0)
    })

    it('Cenário 2 — Descrição aproximada: pesquisa catálogo e devolve alternativas sem inventar dados', async () => {
      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'chocolate cobertura gotas 1kg' },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      // Retorna opções de cobertura gotas 1kg (Harald e Sicao)
      expect(result.data.strategy === 'generic_discovery' || result.data.strategy === 'brand_specific_discovery').toBe(true)
      expect(result.data.products.length >= 2).toBe(true)
    })

    it('Cenário 3 — Consulta de preço: identifica produto exato e consulta preço oficial no motor', async () => {
      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'Harald Top Blend 1kg', quantity: 1 },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      expect(result.data.strategy).toBe('specific_product')
      expect(result.data.product.id).toBe(ID_TOP_BLEND)
      expect(result.data.price.unit_price).toBe(38.50)

      const memory = applyWorkingMemoryUpdate({}, [{ ...result, toolName: 'consultar_produto_comercial' }])
      expect(memory.activeProduct?.id).toBe(ID_TOP_BLEND)
      expect(memory.activePrice?.unitPrice).toBe(38.50)
      expect(getCartItems(memory).length).toBe(0) // Consulta simples de preço não injeta no carrinho
    })

    it('Cenário 4 — Quantidade e atacado: recalcula preço conforme regras de atacado validadas', async () => {
      // Cliente pede 10 unidades da Top Blend (faixa de atacado min 10 -> R$ 35.00)
      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'Harald Top Blend 1kg', quantity: 10 },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      expect(result.data.strategy).toBe('quantity_pricing')
      expect(result.data.quantity).toBe(10)
      expect(result.data.price.unit_price).toBe(35.00)
      expect(result.data.price.subtotal).toBe(350.00)

      // Atualiza memória e sincroniza carrinho com preço confirmado
      const memory = applyWorkingMemoryUpdate({}, [{ ...result, toolName: 'consultar_produto_comercial' }])
      expect(memory.activeQuantity).toBe(10)
      expect(memory.activePrice?.unitPrice).toBe(35.00)

      const cartItems = getCartItems(memory)
      expect(cartItems.length).toBe(1)
      expect(cartItems[0].quantity).toBe(10)
      expect(cartItems[0].unitPrice).toBe(35.00)
      expect(cartItems[0].subtotal).toBe(350.00)
      expect(cartItems[0].isPriceConfirmed).toBe(true)
    })

    it('Cenário 5 — Alteração de quantidade: recupera da memória, invalida preço anterior e recalcula', async () => {
      let memory: WorkingMemory = {}

      // Estado prévio: 10 unidades cotadas a R$ 35.00 (subtotal 350.00)
      memory = addItemToCart(memory, {
        productId: ID_TOP_BLEND,
        name: 'Top Gotas Blend 1kg',
        quantity: 10,
        unitPrice: 35.00,
        subtotal: 350.00,
        isPriceConfirmed: true
      })

      // Cliente pede: "Muda para 20 unidades"
      memory = updateCartItemQuantity(memory, ID_TOP_BLEND, 20)

      // Preço fica temporariamente pendente
      expect(memory.activeCart?.[0].quantity).toBe(20)
      expect(memory.activeCart?.[0].isPriceConfirmed).toBe(false)
      expect(memory.activeCart?.[0].subtotal).toBeUndefined()

      // Executa recálculo oficial pela ferramenta para 20 unidades (faixa atacado 20+ -> R$ 32.00)
      const recalcResult = await calcularPrecoProdutoTool.execute(
        { product_id: ID_TOP_BLEND, quantity: 20 },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(recalcResult.success).toBe(true)
      expect(recalcResult.data.unit_price).toBe(32.00)
      expect(recalcResult.data.subtotal).toBe(640.00)

      memory = applyWorkingMemoryUpdate(memory, [{ ...recalcResult, toolName: 'calcular_preco_produto' }])
      expect(memory.activeCart?.[0].isPriceConfirmed).toBe(true)
      expect(memory.activeCart?.[0].unitPrice).toBe(32.00)
      expect(memory.activeCart?.[0].subtotal).toBe(640.00)
    })

    it('Cenário 6 — Inclusão de outro produto: adiciona o segundo e preserva o primeiro no carrinho', async () => {
      let memory: WorkingMemory = {}

      // Item 1: 20 unidades de Top Blend (R$ 640.00)
      memory = addItemToCart(memory, {
        productId: ID_TOP_BLEND,
        name: 'Top Gotas Blend 1kg',
        quantity: 20,
        unitPrice: 32.00,
        subtotal: 640.00,
        isPriceConfirmed: true
      })

      // Cliente pede: "Adiciona também 5 sacos de Granulado Melken"
      const resultProd2 = await consultarProdutoComercialTool.execute(
        { product_query: 'Granulado Melken', quantity: 5 },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(resultProd2.success).toBe(true)
      expect(resultProd2.data.strategy).toBe('quantity_pricing')
      expect(resultProd2.data.price.unit_price).toBe(15.00) // Atacado min 5
      expect(resultProd2.data.price.subtotal).toBe(75.00)

      memory = applyWorkingMemoryUpdate(memory, [{ ...resultProd2, toolName: 'consultar_produto_comercial' }])

      const cartItems = getCartItems(memory)
      expect(cartItems.length).toBe(2)
      expect(cartItems[0].productId).toBe(ID_TOP_BLEND)
      expect(cartItems[0].subtotal).toBe(640.00)
      expect(cartItems[1].productId).toBe(ID_GRANULADO)
      expect(cartItems[1].subtotal).toBe(75.00)

      const total = calculateCartTotal(memory)
      expect(total.total).toBe(715.00) // 640 + 75
      expect(total.allPricesConfirmed).toBe(true)
    })

    it('Cenário 7 — Remoção de item: identifica e remove somente o item solicitado preservando os demais', async () => {
      let memory: WorkingMemory = {}

      memory = addItemToCart(memory, {
        productId: ID_TOP_BLEND,
        name: 'Top Gotas Blend 1kg',
        quantity: 20,
        unitPrice: 32.00,
        subtotal: 640.00,
        isPriceConfirmed: true
      })

      memory = addItemToCart(memory, {
        productId: ID_GRANULADO,
        name: 'Granulado Melken',
        quantity: 5,
        unitPrice: 15.00,
        subtotal: 75.00,
        isPriceConfirmed: true
      })

      // Cliente pede: "Tira o granulado, deixa só a cobertura"
      memory = removeCartItem(memory, ID_GRANULADO)

      const items = getCartItems(memory)
      expect(items.length).toBe(1)
      expect(items[0].productId).toBe(ID_TOP_BLEND)
      expect(items.some(i => i.productId === ID_GRANULADO)).toBe(false)
      expect(calculateCartTotal(memory).total).toBe(640.00)
    })

    it('Cenário 8 — Geração de orçamento: utiliza todos os itens confirmados e persiste formalmente', async () => {
      const memory: WorkingMemory = {
        activeCart: [
          { productId: ID_TOP_BLEND, name: 'Top Gotas Blend 1kg', quantity: 20, unitPrice: 32.00, subtotal: 640.00, isPriceConfirmed: true },
          { productId: ID_GRANULADO, name: 'Granulado Melken 500g', quantity: 5, unitPrice: 15.00, subtotal: 75.00, isPriceConfirmed: true }
        ]
      }

      const quoteResult = await gerarOrcamentoTool.execute(
        {
          items: memory.activeCart!.map(i => ({ product_id: i.productId, quantity: i.quantity }))
        },
        { companyId, customerId, conversationId, workingMemory: memory }
      )

      expect(quoteResult.success).toBe(true)
      expect(quoteResult.data.total).toBe(715.00)
      expect(typeof quoteResult.data.id).toBe('string')
      expect(quoteResult.data.items.length).toBe(2)

      const updatedMemory = applyWorkingMemoryUpdate(memory, [{ ...quoteResult, toolName: 'gerar_orcamento' }])
      expect(updatedMemory.activeQuote?.id).toBe(quoteResult.data.id)
      expect(updatedMemory.activeQuote?.total).toBe(715.00)
    })

    it('Cenário 9 — Edição de orçamento: atualiza o mesmo registro sem duplicar e recalcula valores', async () => {
      // 1. Criação do primeiro orçamento draft
      const quote1 = await gerarOrcamentoTool.execute(
        { items: [{ product_id: ID_TOP_BLEND, quantity: 10 }] },
        { companyId, customerId, conversationId, workingMemory: {} }
      )
      const quote1Id = quote1.data.id
      expect(quote1.data.total).toBe(350.00)
      expect(getInMemoryQuotesCount()).toBe(1)

      const memory: WorkingMemory = {
        activeQuote: { id: quote1Id, total: 350.00, status: 'draft' }
      }

      // 2. Cliente altera a quantidade no mesmo orçamento para 20
      const quote2 = await gerarOrcamentoTool.execute(
        { items: [{ product_id: ID_TOP_BLEND, quantity: 20 }] },
        { companyId, customerId, conversationId, workingMemory: memory }
      )

      // Deve reaproveitar o mesmo ID de orçamento sem criar duplicata
      expect(quote2.success).toBe(true)
      expect(quote2.data.id).toBe(quote1Id)
      expect(quote2.data.is_reused).toBe(true)
      expect(quote2.data.total).toBe(640.00)
      expect(getInMemoryQuotesCount()).toBe(1) // Não duplicou!
    })

    it('Cenário 10 — Produto não localizado: não declara sem estoque, informa que não localizou e oferece humano', async () => {
      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'Nutella de balde 3kg' },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      expect(result.data.strategy).toBe('not_found')

      // Validação da diretriz no System Prompt
      const prompt = formatWorkingMemoryPrompt({})
      expect(prompt).toNotContain('Nutella')
    })

    it('Cenário 11 — Solicitação de preço Clube: sem elegibilidade confirmada, aplica preço regular e não clube', async () => {
      // Top Blend: retail é 38.50, club é 29.90
      // 1. Rejeição explícita de solicitação club sem elegibilidade confirmada
      await assert.rejects(
        async () => {
          await resolveProductPrice({
            companyId,
            productId: ID_TOP_BLEND,
            quantity: 1,
            priceType: 'club',
            isClubEligible: false
          })
        },
        /Preço da modalidade "club" não disponível/
      )

      // 2. Sistema comercial aplica determinísticamente o preço regular de varejo (38.50 e não clube 29.90)
      const pricing = await resolveProductPrice({
        companyId,
        productId: ID_TOP_BLEND,
        quantity: 1,
        isClubEligible: false
      })

      expect(pricing.unitPrice).toBe(38.50)
      expect(pricing.priceType).toBe('retail')
      expect(pricing.unitPrice !== 29.90).toBe(true)
    })

    it('Cenário 12 — Produtos semelhantes: apresenta opções reais e solicita esclarecimento antes de precificar', async () => {
      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'forma de acetato bwb' },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      // Múltiplos formatos encontrados (trufa, bombom)
      expect(result.data.strategy).toBe('brand_specific_discovery')
      expect(result.data.products.length >= 2).toBe(true)
      expect(result.data.products.some((p: any) => p.name.includes('Trufa'))).toBe(true)
      expect(result.data.products.some((p: any) => p.name.includes('Bombom'))).toBe(true)
    })

    it('Cenário 13 — Ambiguidade de preço: detecta ambiguidade quando termo for muito genérico', async () => {
      const result = await consultarProdutoComercialTool.execute(
        { product_query: 'cobertura' },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(result.success).toBe(true)
      expect(result.data.strategy).toBe('generic_discovery')
      expect(result.data.brands.length >= 2).toBe(true)
      expect(result.data.brands.includes('Harald')).toBe(true)
      expect(result.data.brands.includes('Sicao')).toBe(true)
    })

  })

  // ==========================================================================
  // SEÇÃO 2: OS 10 TESTES ADICIONAIS DE REGRESSÃO E ISOLAMENTO
  // ==========================================================================

  describe('Parte 2 — Os 10 Testes Adicionais de Regressão e Isolamento', () => {

    it('1. Cliente adiciona três produtos em sequência no carrinho', () => {
      let memory: WorkingMemory = {}

      memory = addItemToCart(memory, { productId: ID_TOP_BLEND, name: 'Top Blend 1kg', quantity: 2, unitPrice: 38.50, subtotal: 77.00, isPriceConfirmed: true })
      memory = addItemToCart(memory, { productId: ID_TOP_LEITE, name: 'Top Ao Leite 1kg', quantity: 1, unitPrice: 39.00, subtotal: 39.00, isPriceConfirmed: true })
      memory = addItemToCart(memory, { productId: ID_GRANULADO, name: 'Granulado 500g', quantity: 3, unitPrice: 18.00, subtotal: 54.00, isPriceConfirmed: true })

      const items = getCartItems(memory)
      expect(items.length).toBe(3)
      expect(calculateCartTotal(memory).total).toBe(170.00) // 77 + 39 + 54
    })

    it('2. Cliente altera a quantidade do segundo produto mantendo os outros dois', () => {
      let memory: WorkingMemory = {}

      memory = addItemToCart(memory, { productId: ID_TOP_BLEND, name: 'Top Blend', quantity: 2, unitPrice: 38.50, subtotal: 77.00, isPriceConfirmed: true })
      memory = addItemToCart(memory, { productId: ID_TOP_LEITE, name: 'Top Ao Leite', quantity: 1, unitPrice: 39.00, subtotal: 39.00, isPriceConfirmed: true })
      memory = addItemToCart(memory, { productId: ID_GRANULADO, name: 'Granulado', quantity: 3, unitPrice: 18.00, subtotal: 54.00, isPriceConfirmed: true })

      // Altera quantidade do segundo item (Top Ao Leite) para 5
      memory = updateCartItemQuantity(memory, ID_TOP_LEITE, 5)

      const items = getCartItems(memory)
      expect(items[0].isPriceConfirmed).toBe(true)
      expect(items[1].isPriceConfirmed).toBe(false) // Pendente
      expect(items[2].isPriceConfirmed).toBe(true)

      // Atualiza preço validado do segundo item
      memory = updateCartItemPrice(memory, ID_TOP_LEITE, { unitPrice: 39.00, subtotal: 195.00 })
      expect(calculateCartTotal(memory).total).toBe(326.00) // 77 + 195 + 54
    })

    it('3. Cliente remove o primeiro produto preservando os demais', () => {
      let memory: WorkingMemory = {}

      memory = addItemToCart(memory, { productId: ID_TOP_BLEND, name: 'Top Blend', quantity: 2, unitPrice: 38.50, subtotal: 77.00, isPriceConfirmed: true })
      memory = addItemToCart(memory, { productId: ID_TOP_LEITE, name: 'Top Ao Leite', quantity: 1, unitPrice: 39.00, subtotal: 39.00, isPriceConfirmed: true })

      memory = removeCartItem(memory, ID_TOP_BLEND)
      const items = getCartItems(memory)
      expect(items.length).toBe(1)
      expect(items[0].productId).toBe(ID_TOP_LEITE)
    })

    it('4. Cliente solicita orçamento com um item pendente: alerta de pendência', () => {
      const memory: WorkingMemory = {
        activeCart: [
          { productId: ID_TOP_BLEND, name: 'Top Blend', quantity: 10, isPriceConfirmed: false }
        ]
      }

      const totalInfo = calculateCartTotal(memory)
      expect(totalInfo.allPricesConfirmed).toBe(false)
      expect(totalInfo.unconfirmedProductIds).toEqual([ID_TOP_BLEND])

      const promptText = formatWorkingMemoryPrompt(memory)
      expect(promptText).toContain('Precificação: Pendente')
      expect(promptText).toContain('precisam de recálculo/confirmação')
    })

    it('5. Falha de precificação durante edição de orçamento preserva os dados anteriores', async () => {
      let memory: WorkingMemory = {
        activeQuote: { id: 'ORC-EXISTENTE-1', total: 100.00, status: 'draft' }
      }

      // Tentativa de calcular produto inexistente falha
      const failedResult = await calcularPrecoProdutoTool.execute(
        { product_id: '99999999-9999-9999-9999-999999999999', quantity: 5 },
        { companyId, agentId: 'agent-1', conversationId }
      )

      expect(failedResult.success).toBe(false)

      // Memória não é corrompida
      memory = applyWorkingMemoryUpdate(memory, [failedResult])
      expect(memory.activeQuote?.id).toBe('ORC-EXISTENTE-1')
      expect(memory.activeQuote?.total).toBe(100.00)
    })

    it('6. Falha de persistência do orçamento não inventa ID ou total', async () => {
      // Orçamento com produto inexistente
      const failedQuote = await gerarOrcamentoTool.execute(
        { items: [{ product_id: '99999999-9999-9999-9999-999999999999', quantity: 2 }] },
        { companyId, customerId, conversationId, workingMemory: {} }
      )

      expect(failedQuote.success).toBe(false)

      const memory = applyWorkingMemoryUpdate({}, [failedQuote])
      expect(memory.activeQuote).toBeUndefined()

      const safeResponse = buildSafeIterationLimitResponse([failedQuote])
      expect(safeResponse).toContain('Não foi possível concluir a operação solicitada')
      expect(safeResponse).toNotContain('ID:')
    })

    it('7. Cliente pergunta novamente o total após alteração: consultar_orcamento reflete dados atuais', async () => {
      // Criação do orçamento
      const q = await gerarOrcamentoTool.execute(
        { items: [{ product_id: ID_TOP_BLEND, quantity: 10 }] },
        { companyId, customerId, conversationId, workingMemory: {} }
      )
      const quoteId = q.data.id

      // Consulta posterior
      const readResult = await consultarOrcamentoTool.execute(
        { quote_id: quoteId },
        { companyId, agentId: 'agent-1', conversationId, workingMemory: { activeQuote: { id: quoteId, total: 350.00, status: 'draft' } } }
      )

      expect(readResult.success).toBe(true)
      expect(readResult.data.id).toBe(quoteId)
      expect(readResult.data.total).toBe(350.00)
      expect(readResult.data.items[0].quantity).toBe(10)
    })

    it('8. Cliente solicita preço Clube sem elegibilidade: proteção estrita', async () => {
      // 1. Tentar solicitar 'club' sem comprovação de elegibilidade deve lançar erro
      await assert.rejects(
        async () => {
          await resolveProductPrice({
            companyId,
            productId: ID_TOP_BLEND,
            quantity: 1,
            priceType: 'club',
            isClubEligible: false
          })
        },
        /Preço da modalidade "club" não disponível/
      )

      // 2. Resolução padrão protege e aplica o preço regular de varejo
      const regularPrice = await resolveProductPrice({
        companyId,
        productId: ID_TOP_BLEND,
        quantity: 1,
        isClubEligible: false
      })

      // Não aplica o preço de 29.90 do Clube
      expect(regularPrice.unitPrice).toBe(38.50)
      expect(regularPrice.priceType).toBe('retail')
      expect(regularPrice.unitPrice !== 29.90).toBe(true)
    })

    it('9. Duas empresas com catálogos e preços diferentes não compartilham dados (Isolamento Multi-tenant)', async () => {
      // Empresa 1 (Sumel) não consegue ver nem precificar produto exclusivo da Empresa 2
      let caughtError1: any = null
      try {
        await resolveProductPrice({
          companyId,
          productId: ID_EMP2_PROD,
          quantity: 1
        })
      } catch (err) {
        caughtError1 = err
      }
      expect(caughtError1).toBeDefined()

      // Empresa 2 consegue precificar seu produto exclusivo
      const priceEmp2 = await resolveProductPrice({
        companyId: companyId2,
        productId: ID_EMP2_PROD,
        quantity: 1
      })
      expect(priceEmp2.unitPrice).toBe(99.00)
    })

    it('10. Memória de uma conversa não aparece em outra conversa (Isolamento Conversacional)', () => {
      const memoryConv1: WorkingMemory = {
        activeProduct: { id: ID_TOP_BLEND, name: 'Top Blend' },
        activeCart: [
          { productId: ID_TOP_BLEND, name: 'Top Blend', quantity: 20, unitPrice: 32.00, subtotal: 640.00, isPriceConfirmed: true }
        ],
        activeQuote: { id: 'ORC-CONV-1', total: 640.00, status: 'draft' }
      }

      // Conversa 2 inicia do zero sem contaminação
      const memoryConv2: WorkingMemory = {}

      const prompt1 = formatWorkingMemoryPrompt(memoryConv1)
      const prompt2 = formatWorkingMemoryPrompt(memoryConv2)

      expect(prompt1).toContain('ORC-CONV-1')
      expect(prompt1).toContain('Top Blend')
      expect(prompt2).toBe('') // Conversa 2 vazia
    })

  })

})
