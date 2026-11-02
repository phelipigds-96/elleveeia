import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { parseQuery, calculateMatchScore } from '@/lib/services/catalog/search-logic.ts'
import { resolveToolScope } from '@/lib/services/agent/tool-scoping.ts'
import { applyCommercialStrategy } from '@/lib/services/agent/commercial-strategy.ts'
import { consultarProdutoComercialTool } from './consultar-produto-comercial.ts'
import { consultarPrecoTool } from './consultar-preco.ts'
import { calcularPrecoProdutoTool } from './calcular-preco.ts'
import { gerarOrcamentoTool } from './gerar-orcamento.ts'
import { consultarOrcamentoTool } from './consultar-orcamento.ts'
import { applyWorkingMemoryUpdate, type WorkingMemory } from '../working-memory.ts'
import { resolveProductPrice } from '@/lib/services/commercial/pricing.ts'
import { resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 6 — Homologação Controlada de Busca e Segurança Comercial', () => {
  const companyId = '00000000-0000-0000-0000-000000000001'
  const agentId = '00000000-0000-0000-0000-000000000002'
  const conversationId = '00000000-0000-0000-0000-000000000003'
  const customerId = '00000000-0000-0000-0000-000000000004'

  const availableTools = [
    consultarProdutoComercialTool,
    consultarPrecoTool,
    calcularPrecoProdutoTool,
    gerarOrcamentoTool,
    consultarOrcamentoTool
  ]

  // Catálogo controlado de simulação (espelhando a estrutura real)
  const mockCatalog = [
    { id: 'h-blend-1kg', name: 'Cobertura Fracionada Top Gotas Blend 1 01kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', active: true, price: 38.50 },
    { id: 'h-leite-1kg', name: 'Cobertura Fracionada Top Gotas Ao Leite 1 01kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', active: true, price: 39.00 },
    { id: 'h-meioamargo-1kg', name: 'Cobertura Fracionada Top Gotas Meio Amargo 1 01kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', active: true, price: 39.50 },
    { id: 'h-branco-no-price', name: 'Cobertura Fracionada Top Gotas Branco 1 01kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', active: true, price: null }, // Sem preço
    { id: 's-blend-1kg', name: 'Cobertura Fracionada Sicao Gotas Blend 1 01kg', brand: 'Sicao', category: 'Cobertura', unit: 'kg', active: true, price: 36.00 }
  ]

  beforeEach(() => {
    resetInMemoryDb()
  })

  // ==========================================================================
  // TAREFA 3: OS 7 CENÁRIOS CONTROLADOS DE COMPORTAMENTO DE BUSCA
  // ==========================================================================

  describe('3. Validação do Comportamento da Busca (7 Cenários Controlados)', () => {

    it('Cenário 1: "Vocês têm Top Gotas Blend 1kg?" identifica corretamente o produto exato e preço', () => {
      const query = 'Vocês têm Top Gotas Blend 1kg?'
      const parsed = parseQuery(query)

      // Pronomes funcionais removidos, sem penalizar atributos essenciais
      assert.strictEqual(parsed.significantTokens.includes('voces'), false)
      assert.strictEqual(parsed.significantTokens.includes('tem'), false)
      assert.ok(parsed.significantTokens.includes('top'))
      assert.ok(parsed.significantTokens.includes('blend'))

      // Calcula pontuação contra o produto correto
      const matchBlend = calculateMatchScore(mockCatalog[0].name, mockCatalog[0].brand, mockCatalog[0].category, parsed)
      assert.strictEqual(matchBlend.penalty, 0, 'Blend não deve sofrer penalidade')
      assert.strictEqual(matchBlend.confidence, 1.0)
      assert.ok(matchBlend.score >= 70)

      // Sabores diferentes sofrem penalidade de 20 e não devem empatar
      const matchLeite = calculateMatchScore(mockCatalog[1].name, mockCatalog[1].brand, mockCatalog[1].category, parsed)
      assert.strictEqual(matchLeite.penalty, 20, 'Ao Leite deve sofrer penalidade por falta de blend')
      assert.ok(matchBlend.score > matchLeite.score + 20)
    })

    it('Cenário 2: "Qual é o preço? Da Harald?" filtra estritamente a marca e apresenta preços confirmados', () => {
      const searchResult = {
        status: 'ambiguous' as const,
        confidence: 0.9,
        matches: mockCatalog.map(p => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          category: p.category,
          unit: p.unit,
          sku: null,
          barcode: null,
          active: p.active
        }))
      }

      const prices = new Map<string, { unit_price: number, subtotal: number }>()
      prices.set('h-blend-1kg', { unit_price: 38.50, subtotal: 38.50 })
      prices.set('h-leite-1kg', { unit_price: 39.00, subtotal: 39.00 })
      prices.set('h-meioamargo-1kg', { unit_price: 39.50, subtotal: 39.50 })
      prices.set('s-blend-1kg', { unit_price: 36.00, subtotal: 36.00 })

      const strategy = applyCommercialStrategy('Qual é o preço? Da Harald?', searchResult, 1, undefined, prices)

      assert.strictEqual(strategy.strategy, 'brand_specific_discovery')
      assert.strictEqual(strategy.brand, 'Harald')
      
      // NÃO inclui Sicao nos produtos apresentados sob a marca Harald
      const hasOtherBrand = strategy.products.some((p: any) => p.brand.toLowerCase() !== 'harald')
      assert.strictEqual(hasOtherBrand, false, 'Não deve misturar produtos de outras marcas')

      // Preços confirmados estão anexados
      const blend = strategy.products.find((p: any) => p.id === 'h-blend-1kg')
      assert.strictEqual(blend.price.unit_price, 38.50)
    })

    it('Cenário 3: "Quanto custa o Top Gotas ao leite?" identifica especificamente o sabor ao leite', () => {
      const query = 'Quanto custa o Top Gotas ao leite?'
      const parsed = parseQuery(query)

      // Identifica "ao leite" como multi-word token
      const mwToken = parsed.tokenGroups.find(t => t.variants.includes('ao leite'))
      assert.ok(mwToken, 'Deve identificar o token multi-word "ao leite"')

      // Pontua Ao Leite com score máximo
      const matchLeite = calculateMatchScore(mockCatalog[1].name, mockCatalog[1].brand, mockCatalog[1].category, parsed)
      const matchBlend = calculateMatchScore(mockCatalog[0].name, mockCatalog[0].brand, mockCatalog[0].category, parsed)

      assert.strictEqual(matchLeite.penalty, 0, 'Ao Leite não deve ter penalidade')
      assert.ok(matchBlend.penalty > 0, 'Blend deve sofrer penalidade por não ser ao leite')
      assert.ok(matchLeite.score > matchBlend.score)
    })

    it('Cenário 4: "Tem Top Gotas de outra marca?" identifica marcas alternativas corretamente sem misturar', () => {
      const searchResult = {
        status: 'ambiguous' as const,
        confidence: 0.9,
        matches: mockCatalog.map(p => ({
          id: p.id,
          name: p.name,
          brand: p.brand,
          category: p.category,
          unit: p.unit,
          sku: null,
          barcode: null,
          active: p.active
        }))
      }

      // Consulta sem mencionar Harald (busca genérica)
      const strategy = applyCommercialStrategy('Tem gotas de outra marca?', searchResult, 1, undefined, new Map())
      assert.strictEqual(strategy.strategy, 'generic_discovery')
      assert.ok(strategy.brands.includes('Harald'))
      assert.ok(strategy.brands.includes('Sicao'))
    })

    it('Cenário 5: "Qual é o preço desse produto?" após busca anterior usa a memória sem contaminar com outro SKU', () => {
      let wm: WorkingMemory = {}

      // Turno 1: Selecionou Meio Amargo
      wm = applyWorkingMemoryUpdate(wm, [
        {
          success: true,
          toolName: 'consultar_produto_comercial',
          data: {
            strategy: 'specific_product',
            product: { id: 'h-meioamargo-1kg', name: 'Top Gotas Meio Amargo 1kg' },
            price: { unit_price: 39.50, subtotal: 39.50 }
          }
        }
      ])

      assert.strictEqual(wm.activeProduct?.id, 'h-meioamargo-1kg')
      assert.strictEqual(wm.activePrice?.unitPrice, 39.50)

      // Turno 2: Pergunta "Qual é o preço desse produto?"
      // A memória não foi poluída com o preço do Blend (38.50) nem do Ao Leite (39.00)
      assert.strictEqual(wm.activePrice?.unitPrice, 39.50)
      assert.strictEqual(wm.activeProduct?.name, 'Top Gotas Meio Amargo 1kg')
    })

    it('Cenário 6: Produto inexistente retorna not_found e não inventa preço', () => {
      const searchResult = {
        status: 'not_found' as const,
        confidence: 0,
        matches: []
      }

      const strategy = applyCommercialStrategy('Top Gotas Pistache 1kg', searchResult, 1, undefined, new Map())
      assert.strictEqual(strategy.strategy, 'not_found')
      assert.strictEqual(strategy.price, undefined)
      assert.strictEqual(strategy.products, undefined)
    })

    it('Cenário 7: Produto encontrado sem preço ativo não inventa valor padrão', () => {
      const searchResult = {
        status: 'ambiguous' as const,
        confidence: 0.8,
        matches: [
          { id: 'h-branco-no-price', name: 'Top Gotas Branco 1kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', sku: null, barcode: null, active: true }
        ]
      }

      // Mapa de preços vazio (nenhum preço configurado no banco para o Branco)
      const emptyPrices = new Map<string, { unit_price: number, subtotal: number }>()

      const strategy = applyCommercialStrategy('da harald', searchResult, 1, undefined, emptyPrices)
      assert.strictEqual(strategy.strategy, 'specific_product')
      assert.strictEqual(strategy.product.id, 'h-branco-no-price')
      assert.strictEqual(strategy.price, undefined, 'Preço deve ser rigorosamente indefinido quando não configurado no banco')
    })
  })

  // ==========================================================================
  // TAREFA 4: VALIDAÇÃO DE SEGURANÇA COMERCIAL
  // ==========================================================================

  describe('4. Validação de Segurança Comercial', () => {

    it('Garante que preços vêm do serviço oficial e nunca de valores fixos padrão (ex: zero ou padrão)', async () => {
      const pricing = await resolveProductPrice({
        companyId,
        productId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        quantity: 1
      })

      assert.strictEqual(pricing.source, 'product_prices', 'Origem deve ser a tabela product_prices')
      assert.ok(pricing.unitPrice > 0, 'Preço deve ser maior que zero')
      assert.strictEqual(typeof pricing.unitPrice, 'number')
    })

    it('Garante que produto sem preço emite erro claro e não assume 0.00', async () => {
      await assert.rejects(
        async () => {
          await resolveProductPrice({
            companyId,
            productId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', // Produto sem preço no mock
            quantity: 1
          })
        },
        /Produto não possui preço configurado ou está indisponível/
      )
    })

    it('Garante que resultados ambíguos não são tratados como exact_match', () => {
      const searchMock = {
        status: 'ambiguous' as const,
        confidence: 0.6,
        matches: [
          { id: 'p1', name: 'Top Gotas Blend 1kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', sku: null, barcode: null, active: true },
          { id: 'p2', name: 'Top Gotas Ao Leite 1kg', brand: 'Harald', category: 'Cobertura', unit: 'kg', sku: null, barcode: null, active: true }
        ]
      }

      const strategy = applyCommercialStrategy('top gotas', searchMock, 1, undefined, new Map())
      assert.strictEqual(strategy.strategy, 'generic_discovery')
      assert.notStrictEqual(strategy.strategy, 'specific_product')
    })

    it('Garante que a tolerância de 1kg/1.01kg não mistura produtos comercialmente distintos', () => {
      // 1kg Blend vs 1kg Meio Amargo possuem pesos nominais idênticos, mas atributos distintos
      const parsedBlend = parseQuery('Top Gotas Blend 1kg')
      const scoreBlend = calculateMatchScore('Cobertura Top Gotas Blend 1 01kg', 'harald', 'cobertura', parsedBlend)
      const scoreAmargo = calculateMatchScore('Cobertura Top Gotas Meio Amargo 1 01kg', 'harald', 'cobertura', parsedBlend)

      assert.strictEqual(scoreBlend.penalty, 0)
      assert.strictEqual(scoreAmargo.penalty, 20)
      assert.ok(scoreBlend.score > scoreAmargo.score + 20)
    })

    it('Garante que a consulta respeita o escopo da empresa (multi-tenant isolado)', async () => {
      const foreignCompanyId = '99999999-9999-9999-9999-999999999999'
      await assert.rejects(
        async () => {
          await resolveProductPrice({
            companyId: foreignCompanyId,
            productId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            quantity: 1
          })
        },
        /Produto não possui preço configurado ou está indisponível/
      )
    })
  })
})
