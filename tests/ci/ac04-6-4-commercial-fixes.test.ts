import test from 'node:test'
import assert from 'node:assert/strict'
import { rankProductsIntelligently, type StructuredProductCandidate } from '@/lib/services/catalog/search-engine'
import { consultarProdutoComercialTool } from '@/lib/services/agent/tools/consultar-produto-comercial'
import { gerenciarCarrinhoTool } from '@/lib/services/agent/tools/gerenciar-carrinho'
import { gerarOrcamentoTool } from '@/lib/services/agent/tools/gerar-orcamento'
import { resolveToolScope, isOrderClosureIntent } from '@/lib/services/agent/tool-scoping'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

// Produtos sintéticos oficiais AC-04.6 e produtos H4 de referência
const mockProducts: any[] = [
  {
    id: 'e2000000-0000-0000-0000-000000000001',
    name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
    sku: 'SYNTH-AC046-01',
    barcode: '7891234000011',
    unit: 'UN',
    brand: 'Tirol',
    product_brands: { name: 'Tirol' },
    product_categories: { name: 'Laticínios' },
    package_description: 'Caixa com 27 latas de 395g',
    units_per_package: 27,
    metadata: { units_per_package: 27, is_synthetic: true, suite: 'AC-04.6' },
    active: true,
    normalized_name: 'leite condensado semidesnatado tirol 395g cx c 27',
    company_id: 'qa-tenant'
  },
  {
    id: 'e1000000-0000-0000-0000-000000000002',
    name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G',
    sku: 'SYNTH-LEITE-TIROL-395G',
    barcode: '7891234567806',
    unit: 'UN',
    brand: 'Tirol',
    product_brands: { name: 'Tirol' },
    product_categories: { name: 'Laticínios' },
    package_description: null,
    units_per_package: null,
    metadata: {},
    active: true,
    normalized_name: 'leite condensado semidesnatado tirol 395g',
    company_id: 'qa-tenant'
  },
  {
    id: 'e2000000-0000-0000-0000-000000000002',
    name: 'LEITE UHT INTEGRAL TIROL 1L FARDO C/ 12',
    sku: 'SYNTH-AC046-02',
    barcode: '7891234000028',
    unit: 'UN',
    brand: 'Tirol',
    product_brands: { name: 'Tirol' },
    product_categories: { name: 'Laticínios' },
    package_description: 'Fardo com 12 unidades de 1L',
    units_per_package: 12,
    metadata: { units_per_package: 12, is_synthetic: true, suite: 'AC-04.6' },
    active: true,
    normalized_name: 'leite uht integral tirol 1l fardo c 12',
    company_id: 'qa-tenant'
  },
  {
    id: 'e2000000-0000-0000-0000-000000000004',
    name: 'CHOCOLATE EM PO 50% CACAU MELKEN 1KG CX C/ 10',
    sku: 'SYNTH-AC046-04',
    barcode: '7891234000042',
    unit: 'UN',
    brand: 'Harald',
    product_brands: { name: 'Harald' },
    product_categories: { name: 'Confeitaria' },
    package_description: 'Pacote 1kg / Caixa com 10 unidades',
    units_per_package: 10,
    metadata: { units_per_package: 10, is_synthetic: true, suite: 'AC-04.6' },
    active: true,
    normalized_name: 'chocolate em po 50 cacau melken 1kg cx c 10',
    company_id: 'qa-tenant'
  },
  {
    id: 'e1000000-0000-0000-0000-000000000009',
    name: 'GRANULADO DE CHOCOLATE HARALD MELKEN 500G',
    sku: 'SYNTH-GRANULADO-HARALD-500G',
    barcode: '7891234567822',
    unit: 'UN',
    brand: 'Harald',
    product_brands: { name: 'Harald' },
    product_categories: { name: 'Confeitaria' },
    package_description: 'Pacote de 500g',
    units_per_package: null,
    metadata: {},
    active: true,
    normalized_name: 'granulado de chocolate harald melken 500g',
    company_id: 'qa-tenant'
  }
]

// Preços cadastrados na tabela oficial 'product_prices'
const mockProductPrices: any[] = [
  // Tirol cx c/ 27 (SYNTH-AC046-01)
  { id: 'pr-01-ret', product_id: 'e2000000-0000-0000-0000-000000000001', company_id: 'qa-tenant', price_type: 'retail', price: 6.50, min_quantity: 1, max_quantity: 9, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  { id: 'pr-01-who', product_id: 'e2000000-0000-0000-0000-000000000001', company_id: 'qa-tenant', price_type: 'wholesale', price: 5.80, min_quantity: 10, max_quantity: null, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  // Tirol H4 un (SYNTH-LEITE-TIROL-395G)
  { id: 'pr-h4-ret', product_id: 'e1000000-0000-0000-0000-000000000002', company_id: 'qa-tenant', price_type: 'retail', price: 5.49, min_quantity: 1, max_quantity: null, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  // Leite UHT Tirol fardo c/ 12 (SYNTH-AC046-02)
  { id: 'pr-02-ret', product_id: 'e2000000-0000-0000-0000-000000000002', company_id: 'qa-tenant', price_type: 'retail', price: 4.80, min_quantity: 1, max_quantity: 9, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  { id: 'pr-02-who', product_id: 'e2000000-0000-0000-0000-000000000002', company_id: 'qa-tenant', price_type: 'wholesale', price: 4.20, min_quantity: 10, max_quantity: null, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  // Melken 50% 1kg (SYNTH-AC046-04)
  { id: 'pr-04-ret', product_id: 'e2000000-0000-0000-0000-000000000004', company_id: 'qa-tenant', price_type: 'retail', price: 42.00, min_quantity: 1, max_quantity: 4, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  { id: 'pr-04-who', product_id: 'e2000000-0000-0000-0000-000000000004', company_id: 'qa-tenant', price_type: 'wholesale', price: 38.00, min_quantity: 5, max_quantity: null, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' },
  // Granulado Harald 500g (SYNTH-GRANULADO-HARALD-500G)
  { id: 'pr-09-ret', product_id: 'e1000000-0000-0000-0000-000000000009', company_id: 'qa-tenant', price_type: 'retail', price: 18.90, min_quantity: 1, max_quantity: null, active: true, valid_from: '2026-01-01', valid_until: '2026-12-31' }
]

function setupMockDatabase() {
  const mockQuotes = new Map()

  setMockSupabaseClient({
    from: (table: string) => {
      let filteredData: any[] = []
      if (table === 'products') filteredData = [...mockProducts]
      else if (table === 'product_prices' || table === 'pricing_rules') filteredData = [...mockProductPrices]
      else if (table === 'quotes') filteredData = Array.from(mockQuotes.values())
      else filteredData = []

      const chain: any = {
        select: (cols: string) => chain,
        eq: (col: string, val: any) => {
          filteredData = filteredData.filter(item => item[col] === val)
          return chain
        },
        in: (col: string, vals: any[]) => {
          filteredData = filteredData.filter(item => vals.includes(item[col]))
          return chain
        },
        contains: (col: string, val: any) => {
          if (col === 'metadata' && val.conversation_id) {
            filteredData = filteredData.filter(q => q.metadata?.conversation_id === val.conversation_id)
          }
          return chain
        },
        or: (cond: string) => {
          const parts = cond.split(',')
          filteredData = filteredData.filter(item => {
            return parts.some(part => {
              const segs = part.split('.')
              if (segs.length < 3) return false
              const field = segs[0]
              const op = segs[1]
              const rawVal = segs.slice(2).join('.')
              const val = rawVal.replace(/^"|"$/g, '').replace(/%/g, '')
              const itemVal = item[field]
              if (itemVal == null) return false
              if (op === 'eq') return String(itemVal).toLowerCase() === val.toLowerCase()
              if (op === 'ilike') return String(itemVal).toLowerCase().includes(val.toLowerCase())
              return false
            })
          })
          return chain
        },
        order: (col: string, opts: any) => chain,
        limit: (n: number) => {
          filteredData = filteredData.slice(0, n)
          return chain
        },
        maybeSingle: async () => ({
          data: filteredData.length > 0 ? filteredData[0] : null,
          error: null
        }),
        single: async () => ({
          data: filteredData[0] || null,
          error: filteredData.length === 0 ? { message: 'Not found' } : null
        }),
        then: (resolve: any) => resolve({ data: filteredData, error: null })
      }
      return chain
    },
    rpc: async (fnName: string, args: any) => {
      if (fnName === 'save_enterprise_quote_atomic') {
        const quoteId = args.p_existing_quote_id || 'quote-test-uuid'
        const existing = mockQuotes.get(quoteId)
        const version = existing ? (existing.metadata?.version || 1) + 1 : 1
        const record = {
          id: quoteId,
          company_id: args.p_company_id,
          customer_id: args.p_customer_id,
          status: args.p_status,
          total: args.p_total,
          metadata: {
            ...args.p_metadata,
            version,
            conversation_id: args.p_conversation_id
          }
        }
        mockQuotes.set(quoteId, record)
        return {
          data: {
            id: quoteId,
            version,
            status: args.p_status,
            total: args.p_total
          },
          error: null
        }
      }
      return { data: null, error: null }
    }
  })
}

// ============================================================================
// SUITE DE REGRESSÃO AC-04.6.4 — CORREÇÃO DOS DEFEITOS COMERCIAIS REAIS
// ============================================================================

test('AC-04.6.4 — Defeito 1: Busca seleciona caixa c/ 27 (SYNTH-AC046-01) e penaliza unidade avulsa H4 quando cliente pede caixas', () => {
  const candidates: StructuredProductCandidate[] = [
    {
      id: 'e2000000-0000-0000-0000-000000000001',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
      brand: 'Tirol',
      sku: 'SYNTH-AC046-01',
      barcode: '7891234000011',
      unit: 'UN',
      package_description: 'Caixa com 27 latas de 395g',
      package_factor: 27,
      metadata: { package_factor: 27 },
      active: true,
      company_id: 'qa-tenant'
    },
    {
      id: 'e1000000-0000-0000-0000-000000000002',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G',
      brand: 'Tirol',
      sku: 'SYNTH-LEITE-TIROL-395G',
      barcode: '7891234567806',
      unit: 'UN',
      package_description: null,
      package_factor: null,
      metadata: {},
      active: true,
      company_id: 'qa-tenant'
    }
  ]

  const ranked = rankProductsIntelligently('Quero 2 caixas de leite condensado tirol', candidates)
  assert.ok(ranked.matches.length > 0)
  assert.equal(ranked.matches[0].id, 'e2000000-0000-0000-0000-000000000001', 'Produto em caixa deve vencer produto avulso H4')
  assert.equal(ranked.matches[0].sku, 'SYNTH-AC046-01')
  assert.equal(ranked.matches[0].packageFactor, 27)
})

test('AC-04.6.4 — Defeito 2 & Cenário 3: 2 caixas de 27 são convertidas em 54 unidades com preço de atacado R$ 313,20', async () => {
  setupMockDatabase()

  const res = await consultarProdutoComercialTool.execute({
    product_query: 'leite condensado tirol',
    quantity: 2,
    unit: 'caixas'
  }, {
    companyId: 'qa-tenant',
    agentId: 'agent-qa',
    conversationId: 'conv-c3-test'
  })

  assert.equal(res.success, true)
  assert.equal(res.data.product?.id, 'e2000000-0000-0000-0000-000000000001')
  assert.equal(res.data.requested_quantity, 2, 'Quantidade solicitada pelo cliente preservada')
  assert.equal(res.data.requested_unit, 'CX')
  assert.equal(res.data.package_factor, 27)
  assert.equal(res.data.base_quantity, 54, '2 caixas de 27 convertidas em 54 unidades base')
  assert.equal(res.data.price?.unit_price, 5.80, 'Preço de atacado (min: 10) aplicado')
  assert.equal(res.data.price?.subtotal, 313.20, 'Critério financeiro obrigatório: 54 un * R$ 5,80 = R$ 313,20')
})

test('AC-04.6.4 — Defeito 4 & Cenário 5: Chocolate em pó Melken 50% é selecionado (não granulado) e pedido combinado totaliza R$ 503,20', async () => {
  setupMockDatabase()

  // 1. Testa que a busca por "5 pacotes de chocolate melken" escolhe o chocolate em pó e penaliza o granulado
  const candidates: StructuredProductCandidate[] = [
    {
      id: 'e2000000-0000-0000-0000-000000000004',
      name: 'CHOCOLATE EM PO 50% CACAU MELKEN 1KG CX C/ 10',
      brand: 'Harald',
      sku: 'SYNTH-AC046-04',
      barcode: '7891234000042',
      unit: 'UN',
      package_description: 'Pacote 1kg / Caixa com 10 unidades',
      package_factor: 10,
      metadata: { package_factor: 10 },
      active: true,
      company_id: 'qa-tenant'
    },
    {
      id: 'e1000000-0000-0000-0000-000000000009',
      name: 'GRANULADO DE CHOCOLATE HARALD MELKEN 500G',
      brand: 'Harald',
      sku: 'SYNTH-GRANULADO-HARALD-500G',
      barcode: '7891234567822',
      unit: 'UN',
      package_description: 'Pacote de 500g',
      package_factor: null,
      metadata: {},
      active: true,
      company_id: 'qa-tenant'
    }
  ]

  const rankedMelken = rankProductsIntelligently('5 pacotes de chocolate melken', candidates)
  assert.ok(rankedMelken.matches.length > 0)
  assert.equal(rankedMelken.matches[0].id, 'e2000000-0000-0000-0000-000000000004', 'Chocolate em pó deve vencer confeito granulado')
  assert.equal(rankedMelken.matches[0].sku, 'SYNTH-AC046-04')

  // 2. Consulta combinada (multi-produto)
  const resMulti = await consultarProdutoComercialTool.execute({
    product_query: 'Coloca 2 caixas de leite condensado e 5 pacotes de chocolate melken'
  }, {
    companyId: 'qa-tenant',
    agentId: 'agent-qa',
    conversationId: 'conv-c5-test'
  })

  assert.equal(resMulti.success, true)
  assert.equal(resMulti.data.strategy, 'multi_product_pricing')
  assert.equal(resMulti.data.items?.length, 2)

  // Item 1: Leite Condensado (2 cx c/ 27 = 54 un @ R$ 5,80 = R$ 313,20)
  const itemLeite = resMulti.data.items[0]
  assert.equal(itemLeite.productId, 'e2000000-0000-0000-0000-000000000001')
  assert.equal(itemLeite.quantity, 54)
  assert.equal(itemLeite.unitPrice, 5.80)
  assert.equal(itemLeite.subtotal, 313.20)

  // Item 2: Chocolate Melken 50% 1kg (5 pacotes de 1kg @ R$ 38,00 = R$ 190,00)
  const itemChoc = resMulti.data.items[1]
  assert.equal(itemChoc.productId, 'e2000000-0000-0000-0000-000000000004')
  assert.equal(itemChoc.quantity, 5)
  assert.equal(itemChoc.unitPrice, 38.00)
  assert.equal(itemChoc.subtotal, 190.00)

  // Total combinado financeiro obrigatório: R$ 313,20 + R$ 190,00 = R$ 503,20
  assert.equal(resMulti.data.total, 503.20, 'Critério financeiro obrigatório: R$ 503,20')
})

test('AC-04.6.4 — Defeito 3 & Cenário 6: Alteração de quantidade de 2 para 3 caixas resulta em 81 unidades e R$ 469,80 sem duplicar itens', async () => {
  setupMockDatabase()

  // Carrinho inicial com 2 caixas (54 un = R$ 313,20)
  const initialMemory = {
    activeCart: [{
      productId: 'e2000000-0000-0000-0000-000000000001',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
      sku: 'SYNTH-AC046-01',
      quantity: 54,
      unit: 'UN',
      requestedQuantity: 2,
      requestedUnit: 'CX',
      packageFactor: 27,
      internalQuantity: 54,
      unitPrice: 5.80,
      subtotal: 313.20,
      unitPriceCents: 580,
      subtotalCents: 31320,
      isPriceConfirmed: true,
      status: 'confirmed'
    }]
  }

  // Executa update_quantity para 3 caixas
  const resUpdate = await gerenciarCarrinhoTool.execute({
    action: 'update_quantity',
    product_reference: 'leite condensado tirol',
    quantity: 3
  }, {
    companyId: 'qa-tenant',
    agentId: 'agent-qa',
    conversationId: 'conv-c6-test',
    workingMemory: initialMemory
  })

  assert.equal(resUpdate.success, true)
  assert.equal(resUpdate.data.updated_item.quantity, 81, '3 caixas x 27 convertidas em 81 unidades')
  assert.equal(resUpdate.data.updated_item.requestedQuantity, 3)
  assert.equal(resUpdate.data.updated_item.requestedUnit, 'CX')
  assert.equal(resUpdate.data.updated_item.unitPrice, 5.80, 'Preço atacado mantido (81 >= 10)')
  assert.equal(resUpdate.data.updated_item.subtotal, 469.80, 'Critério financeiro obrigatório: 81 * 5,80 = R$ 469,80')
  assert.equal(resUpdate.data.total_confirmed, 469.80)
})

test('AC-04.6.4 — Defeito 5 & Cenário 7: Orçamento valida carrinho, rejeita itens pendentes e gera orçamento formal de R$ 313,20', async () => {
  setupMockDatabase()

  // 1. Carrinho com item pendente deve ser REJEITADO
  const memoryPending = {
    activeCart: [{
      productId: 'e2000000-0000-0000-0000-000000000001',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
      quantity: 54,
      isPriceConfirmed: false,
      status: 'pending'
    }]
  }
  const resPending = await gerarOrcamentoTool.execute({}, {
    companyId: 'qa-tenant',
    conversationId: 'conv-c7-pending',
    customerId: 'cust-qa',
    workingMemory: memoryPending
  })
  assert.equal(resPending.success, false, 'Deve recusar orçamento formal com itens pendentes')
  assert.ok(resPending.error?.includes('pendência'))

  // 2. Carrinho confirmado com 2 caixas (54 un = R$ 313,20) deve gerar orçamento
  const memoryConfirmed = {
    activeCart: [{
      productId: 'e2000000-0000-0000-0000-000000000001',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
      sku: 'SYNTH-AC046-01',
      quantity: 54,
      internalQuantity: 54,
      requestedQuantity: 2,
      requestedUnit: 'CX',
      packageFactor: 27,
      unitPrice: 5.80,
      subtotal: 313.20,
      unitPriceCents: 580,
      subtotalCents: 31320,
      isPriceConfirmed: true,
      status: 'confirmed'
    }]
  }

  const resQuote = await gerarOrcamentoTool.execute({}, {
    companyId: 'qa-tenant',
    conversationId: 'conv-c7-success',
    customerId: 'cust-qa',
    workingMemory: memoryConfirmed
  })

  assert.equal(resQuote.success, true)
  assert.equal(resQuote.data.total, 313.20)
  assert.equal(resQuote.data.version, 1)
  assert.equal(resQuote.data.status, 'ready')
  assert.equal(resQuote.data.items[0].quantity, 54)
})

test('AC-04.6.4 — Defeito 6 & Cenário 8: Fechamento de orçamento não transfere para humano e gera versão 2 com novo item (R$ 363,60)', async () => {
  setupMockDatabase()

  // 1. "Pode fechar o orçamento pra mim?" NÃO é intenção de encerramento com transferência humana imediata
  const isClosure = isOrderClosureIntent('Pode fechar o orçamento pra mim?', true)
  assert.equal(isClosure, false, 'Pedido de fechar orçamento não deve acionar transferência humana obrigatória')

  const availableTools: any[] = [
    { name: 'gerar_orcamento', metadata: { category: 'quotes' } },
    { name: 'consultar_orcamento', metadata: { category: 'quotes' } },
    { name: 'gerenciar_carrinho', metadata: { category: 'cart' } },
    { name: 'transferir_para_humano', metadata: { category: 'general' } }
  ]

  const scopedTools = resolveToolScope('Pode fechar o orçamento pra mim?', [], availableTools, {
    activeCart: [{ productId: 'e2000000-0000-0000-0000-000000000001', quantity: 54, isPriceConfirmed: true }]
  })
  assert.ok(scopedTools.some(t => t.name === 'gerar_orcamento'), 'gerar_orcamento deve estar disponível')
  assert.ok(!scopedTools.some(t => t.name === 'transferir_para_humano'), 'transferir_para_humano NÃO deve ser disparado')

  // 2. Geração da versão 1 do orçamento
  const memoryV1 = {
    activeCart: [{
      productId: 'e2000000-0000-0000-0000-000000000001',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
      sku: 'SYNTH-AC046-01',
      quantity: 54,
      unitPrice: 5.80,
      subtotal: 313.20,
      unitPriceCents: 580,
      isPriceConfirmed: true,
      status: 'confirmed'
    }]
  }

  const quoteV1 = await gerarOrcamentoTool.execute({}, {
    companyId: 'qa-tenant',
    conversationId: 'conv-c8-multi-turn',
    customerId: 'cust-qa',
    workingMemory: memoryV1
  })
  assert.equal(quoteV1.data.version, 1)
  assert.equal(quoteV1.data.total, 313.20)

  // 3. Turno 3: Adiciona 1 fardo de leite (12 un @ R$ 4,20 = R$ 50,40) e gera versão 2
  const memoryV2 = {
    activeQuote: { id: quoteV1.data.id, total: quoteV1.data.total, status: 'ready' },
    activeCart: [
      ...memoryV1.activeCart,
      {
        productId: 'e2000000-0000-0000-0000-000000000002',
        name: 'LEITE UHT INTEGRAL TIROL 1L FARDO C/ 12',
        sku: 'SYNTH-AC046-02',
        quantity: 12,
        unitPrice: 4.20,
        subtotal: 50.40,
        unitPriceCents: 420,
        isPriceConfirmed: true,
        status: 'confirmed'
      }
    ]
  }

  const quoteV2 = await gerarOrcamentoTool.execute({}, {
    companyId: 'qa-tenant',
    conversationId: 'conv-c8-multi-turn',
    customerId: 'cust-qa',
    workingMemory: memoryV2
  })

  assert.equal(quoteV2.data.id, quoteV1.data.id, 'Mesmo orçamento deve ser reaproveitado')
  assert.equal(quoteV2.data.version, 2, 'Orçamento deve ser versionado para a versão 2')
  // Total atualizado: R$ 313,20 + R$ 50,40 = R$ 363,60
  assert.equal(quoteV2.data.total, 363.60, 'Total da versão 2 deve consolidar ambos os itens: R$ 363,60')
})

test('AC-04.6.4 — Critérios Financeiros Estritos de Catálogo Homologados', async () => {
  setupMockDatabase()

  // 1. Tirol 1 un: R$ 6,50
  const res1Un = await consultarProdutoComercialTool.execute({
    product_query: 'SYNTH-AC046-01',
    quantity: 1,
    unit: 'unidade'
  }, { companyId: 'qa-tenant', agentId: 'agent-qa', conversationId: 'c-fin-1' })
  assert.equal(res1Un.data.price?.unit_price, 6.50, '1 unidade de Tirol deve custar R$ 6,50 no varejo')

  // 2. Tirol 2 caixas (54 un): R$ 313,20
  const res2Cx = await consultarProdutoComercialTool.execute({
    product_query: 'SYNTH-AC046-01',
    quantity: 2,
    unit: 'caixas'
  }, { companyId: 'qa-tenant', agentId: 'agent-qa', conversationId: 'c-fin-2' })
  assert.equal(res2Cx.data.price?.subtotal, 313.20, '2 caixas de Tirol (54 un) = R$ 313,20')

  // 3. Tirol 3 caixas (81 un): R$ 469,80
  const res3Cx = await consultarProdutoComercialTool.execute({
    product_query: 'SYNTH-AC046-01',
    quantity: 3,
    unit: 'caixas'
  }, { companyId: 'qa-tenant', agentId: 'agent-qa', conversationId: 'c-fin-3' })
  assert.equal(res3Cx.data.price?.subtotal, 469.80, '3 caixas de Tirol (81 un) = R$ 469,80')

  // 4. Melken 50% 5 unidades: R$ 190,00
  const resMelken = await consultarProdutoComercialTool.execute({
    product_query: 'SYNTH-AC046-04',
    quantity: 5,
    unit: 'pacotes'
  }, { companyId: 'qa-tenant', agentId: 'agent-qa', conversationId: 'c-fin-4' })
  assert.equal(resMelken.data.price?.unit_price, 38.00, '5 un Melken = R$ 38,00 un no atacado')
  assert.equal(resMelken.data.price?.subtotal, 190.00, '5 un Melken = R$ 190,00')
})
