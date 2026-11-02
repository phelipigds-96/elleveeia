import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { consultarPrecoTool } from './consultar-preco.ts'
import { calcularPrecoProdutoTool } from './calcular-preco.ts'
import { consultarProdutoComercialTool } from './consultar-produto-comercial.ts'
import { gerarOrcamentoTool } from './gerar-orcamento.ts'
import { consultarOrcamentoTool } from './consultar-orcamento.ts'
import { applyWorkingMemoryUpdate, type WorkingMemory } from '../working-memory.ts'
import { resetInMemoryDb, setInMemoryPrices } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 6.4 — Auditoria de Integração e Segurança Comercial', () => {
  const companyId = '00000000-0000-0000-0000-000000000001'
  const agentId = '00000000-0000-0000-0000-000000000002'
  const conversationId = '00000000-0000-0000-0000-000000000003'
  const customerId = '00000000-0000-0000-0000-000000000004'
  const productId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' // Top Gotas Blend 1kg

  const mockContext = {
    companyId,
    agentId,
    conversationId,
    customerId,
    workingMemory: {} as WorkingMemory
  }

  beforeEach(() => {
    resetInMemoryDb()
  })

  // ==========================================================================
  // 1. AUDITORIA DE PROTEÇÃO DE ELEGIBILIDADE DO CLUBE SUMEL
  // ==========================================================================
  describe('1. Proteção de Elegibilidade do Clube Sumel contra Injeção / Manipulação', () => {
    it('1.1. consultar_preco bloqueia tentativa de forçar price_type "club" sem autenticação', async () => {
      setInMemoryPrices([
        {
          id: 'p-retail',
          company_id: companyId,
          product_id: productId,
          price: 38.50,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        },
        {
          id: 'p-club',
          company_id: companyId,
          product_id: productId,
          price: 32.00,
          price_type: 'club',
          min_quantity: 1,
          active: true
        }
      ])

      const res = await consultarPrecoTool.execute({
        product_id: productId,
        price_type: 'club'
      }, mockContext)

      assert.strictEqual(res.success, false)
      assert.match(res.error, /requer comprovação de elegibilidade de membro do Clube Sumel/i)
      assert.strictEqual(res.data, undefined)
    })

    it('1.2. calcular_preco_produto bloqueia tentativa de forçar price_type "club" sem autenticação', async () => {
      setInMemoryPrices([
        {
          id: 'p-retail',
          company_id: companyId,
          product_id: productId,
          price: 38.50,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        },
        {
          id: 'p-club',
          company_id: companyId,
          product_id: productId,
          price: 32.00,
          price_type: 'club',
          min_quantity: 1,
          active: true
        }
      ])

      const res = await calcularPrecoProdutoTool.execute({
        product_id: productId,
        quantity: 2,
        price_type: 'club'
      }, mockContext)

      assert.strictEqual(res.success, false)
      assert.match(res.error, /requer comprovação de elegibilidade de membro do Clube Sumel/i)
      assert.strictEqual(res.data, undefined)
    })

    it('1.3. Injeção de isClubEligible não confiável em argumentos de ferramentas é descartada pelo Zod', async () => {
      setInMemoryPrices([
        {
          id: 'p-retail',
          company_id: companyId,
          product_id: productId,
          price: 38.50,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        },
        {
          id: 'p-club',
          company_id: companyId,
          product_id: productId,
          price: 32.00,
          price_type: 'club',
          min_quantity: 1,
          active: true
        }
      ])

      // Tenta forjar isClubEligible: true nos argumentos
      const maliciousPayload: any = {
        product_id: productId,
        price_type: 'club',
        isClubEligible: true
      }

      const res = await consultarPrecoTool.execute(maliciousPayload, mockContext)

      assert.strictEqual(res.success, false)
      assert.match(res.error, /requer comprovação de elegibilidade de membro do Clube Sumel/i)
    })

    it('1.4. gerar_orcamento não permite selecionar preço de clube e aplica estritamente tabela pública', async () => {
      setInMemoryPrices([
        {
          id: 'p-retail',
          company_id: companyId,
          product_id: productId,
          price: 38.50,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        },
        {
          id: 'p-club',
          company_id: companyId,
          product_id: productId,
          price: 25.00,
          price_type: 'club',
          min_quantity: 1,
          active: true
        }
      ])

      const quoteRes = await gerarOrcamentoTool.execute({
        items: [{ product_id: productId, quantity: 1 }]
      }, mockContext)

      assert.strictEqual(quoteRes.success, true)
      assert.strictEqual(quoteRes.data.total, 38.50, 'Orçamento deve usar R$ 38.50 (varejo) e nunca o preço de clube R$ 25.00')
      assert.strictEqual(quoteRes.data.items[0].priceType, 'retail')
    })
  })

  // ==========================================================================
  // 2. AUDITORIA DE TRATAMENTO DE ERROS DE PRECIFICAÇÃO
  // ==========================================================================
  describe('2. Tratamento Seguro e Informativo de Erros de Precificação', () => {
    it('2.1. Lote mínimo de atacado não atingido emite erro comercial claro e não mascara falha', async () => {
      // Produto só possui atacado (mínimo 10 pacotes)
      setInMemoryPrices([
        {
          id: 'p-wholesale-only',
          company_id: companyId,
          product_id: productId,
          price: 32.00,
          price_type: 'wholesale',
          min_quantity: 10,
          active: true
        }
      ])

      // 1. Via consultar_produto_comercial
      const searchRes = await consultarProdutoComercialTool.execute({
        product_query: 'Top Gotas Blend 1kg',
        quantity: 2
      }, mockContext)

      assert.strictEqual(searchRes.success, false)
      assert.match(searchRes.error, /não atinge o lote mínimo necessário para compra no atacado \(mínimo: 10 unidades\)/i)

      // 2. Via gerar_orcamento
      const quoteRes = await gerarOrcamentoTool.execute({
        items: [{ product_id: productId, quantity: 2 }]
      }, mockContext)

      assert.strictEqual(quoteRes.success, false)
      assert.match(quoteRes.error, /não atinge o lote mínimo necessário para compra no atacado \(mínimo: 10 unidades\)/i)
    })

    it('2.2. Ambiguidade de regras no banco emite alerta seguro de ambiguidade sem expor stack trace', async () => {
      // Duas regras ativas de varejo com preços conflitantes
      setInMemoryPrices([
        {
          id: 'p-retail-1',
          company_id: companyId,
          product_id: productId,
          price: 38.50,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        },
        {
          id: 'p-retail-2',
          company_id: companyId,
          product_id: productId,
          price: 42.00,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        }
      ])

      const res = await consultarProdutoComercialTool.execute({
        product_query: 'Top Gotas Blend 1kg',
        quantity: 1
      }, mockContext)

      assert.strictEqual(res.success, false)
      assert.match(res.error, /Ambiguidade na precificação/i)
      assert.match(res.error, /múltiplas regras ativas/i)
      assert.doesNotMatch(res.error, /at\s|node_modules|file:\/\//i, 'Não deve conter stack trace')
    })

    it('2.3. Falha de precificação não corrompe a Working Memory anterior', () => {
      const priorMemory: WorkingMemory = {
        activeProduct: { id: productId, name: 'Top Gotas Blend 1kg' },
        activePrice: { unitPrice: 38.50, priceType: 'retail' },
        activeQuantity: 1
      }

      // Simula uma resposta de ferramenta com falha
      const failedResult = {
        toolName: 'consultar_produto_comercial',
        success: false,
        error: 'Falha ao calcular preco: Produto não possui preço ativo ou vigente.',
        data: { strategy: 'specific_product', product: { id: productId, name: 'Top Gotas Blend 1kg' } }
      }

      const updated = applyWorkingMemoryUpdate(priorMemory, [failedResult])

      // Deve preservar a memória original sem sobrescrever com erro
      assert.strictEqual(updated.activePrice?.unitPrice, 38.50)
      assert.strictEqual(updated.activeQuantity, 1)
      assert.strictEqual(updated.activeProduct?.id, productId)
    })
  })

  // ==========================================================================
  // 3. AUDITORIA DE FAIXAS E CÁLCULOS FINANCEIROS
  // ==========================================================================
  describe('3. Auditoria de Faixas (min/max) e Precisão Financeira em Centavos', () => {
    it('3.1. Orçamento composto com preços decimais ímpares calcula total exato em centavos', async () => {
      const prod2 = 'b1b2c3d4-e5f6-7890-abcd-ef1234567891'
      setInMemoryPrices([
        {
          id: 'p-1',
          company_id: companyId,
          product_id: productId,
          price: 38.33,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        },
        {
          id: 'p-2',
          company_id: companyId,
          product_id: prod2,
          price: 19.99,
          price_type: 'retail',
          min_quantity: 1,
          active: true
        }
      ])

      // Item 1: 3 x 38.33 = 114.99
      // Item 2: 7 x 19.99 = 139.93
      // Total esperado: 114.99 + 139.93 = 254.92
      const quoteRes = await gerarOrcamentoTool.execute({
        items: [
          { product_id: productId, quantity: 3 },
          { product_id: prod2, quantity: 7 }
        ]
      }, mockContext)

      assert.strictEqual(quoteRes.success, true)
      assert.strictEqual(quoteRes.data.items[0].subtotal, 114.99)
      assert.strictEqual(quoteRes.data.items[1].subtotal, 139.93)
      assert.strictEqual(quoteRes.data.total, 254.92)

      // Consulta de orçamento confirma os mesmos centavos exatos
      const getRes = await consultarOrcamentoTool.execute({
        quote_id: quoteRes.data.id
      }, mockContext)

      assert.strictEqual(getRes.success, true)
      assert.strictEqual(getRes.data.total, 254.92)
      assert.strictEqual(getRes.data.items[0].subtotal, 114.99)
      assert.strictEqual(getRes.data.items[1].subtotal, 139.93)
    })
  })
})
