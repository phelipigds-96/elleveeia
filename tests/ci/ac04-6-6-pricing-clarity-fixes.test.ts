import test from 'node:test'
import assert from 'node:assert/strict'
import { parseStructuredQuery } from '@/lib/services/catalog/query-parser'
import { rankProductsIntelligently, type StructuredProductCandidate } from '@/lib/services/catalog/search-engine'
import { consultarProdutoComercialTool } from '@/lib/services/agent/tools/consultar-produto-comercial'
import { calcularPrecoProdutoTool } from '@/lib/services/agent/tools/calcular-preco'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

const mockProducts: any[] = [
  {
    id: 'e2000000-0000-0000-0000-000000000003',
    name: 'LEITE UHT INTEGRAL TIROL 1L FD C/ 12',
    sku: 'SYNTH-AC046-03',
    barcode: '7891234000035',
    unit: 'UN',
    brand: 'Tirol',
    product_brands: { name: 'Tirol' },
    product_categories: { name: 'Laticínios' },
    package_description: 'Fardo com 12 unidades',
    metadata: { units_per_package: 12, is_synthetic: true, suite: 'AC-04.6' },
    active: true,
    normalized_name: 'leite uht integral tirol 1l fd c 12',
    company_id: 'qa-tenant'
  },
  {
    id: 'e2000000-0000-0000-0000-000000000001',
    name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
    sku: 'SYNTH-AC046-01',
    barcode: '7891234000011',
    unit: 'UN',
    brand: 'Tirol',
    product_brands: { name: 'Tirol' },
    product_categories: { name: 'Laticínios' },
    package_description: 'Caixa com 27 unidades',
    metadata: { units_per_package: 27, is_synthetic: true, suite: 'AC-04.6' },
    active: true,
    normalized_name: 'leite condensado semidesnatado tirol 395g cx c 27',
    company_id: 'qa-tenant'
  },
  {
    id: 'e2000000-0000-0000-0000-000000000002',
    name: 'LEITE CONDENSADO INTEGRAL TIROL 395G CX C/ 27',
    sku: 'SYNTH-AC046-02',
    barcode: '7891234000028',
    unit: 'UN',
    brand: 'Tirol',
    product_brands: { name: 'Tirol' },
    product_categories: { name: 'Laticínios' },
    package_description: 'Caixa com 27 unidades',
    metadata: { units_per_package: 27, is_synthetic: true, suite: 'AC-04.6' },
    active: true,
    normalized_name: 'leite condensado integral tirol 395g cx c 27',
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
    metadata: {},
    active: true,
    normalized_name: 'leite condensado semidesnatado tirol 395g',
    company_id: 'qa-tenant'
  }
]

const mockProductPrices: any[] = [
  { id: 'f2000000-0000-0000-0000-000000000005', product_id: 'e2000000-0000-0000-0000-000000000003', company_id: 'qa-tenant', price_type: 'retail', price: 4.80, min_quantity: 1, max_quantity: null, active: true },
  { id: 'f2000000-0000-0000-0000-000000000006', product_id: 'e2000000-0000-0000-0000-000000000003', company_id: 'qa-tenant', price_type: 'wholesale', price: 4.20, min_quantity: 12, max_quantity: null, active: true },
  { id: 'f2000000-0000-0000-0000-000000000001', product_id: 'e2000000-0000-0000-0000-000000000001', company_id: 'qa-tenant', price_type: 'retail', price: 6.50, min_quantity: 1, max_quantity: null, active: true },
  { id: 'f2000000-0000-0000-0000-000000000002', product_id: 'e2000000-0000-0000-0000-000000000001', company_id: 'qa-tenant', price_type: 'wholesale', price: 5.80, min_quantity: 10, max_quantity: null, active: true },
  { id: 'f2000000-0000-0000-0000-000000000003', product_id: 'e2000000-0000-0000-0000-000000000002', company_id: 'qa-tenant', price_type: 'retail', price: 7.20, min_quantity: 1, max_quantity: null, active: true },
  { id: 'f2000000-0000-0000-0000-000000000004', product_id: 'e2000000-0000-0000-0000-000000000002', company_id: 'qa-tenant', price_type: 'wholesale', price: 6.40, min_quantity: 10, max_quantity: null, active: true },
  { id: 'f1000000-0000-0000-0000-000000000002', product_id: 'e1000000-0000-0000-0000-000000000002', company_id: 'qa-tenant', price_type: 'retail', price: 5.49, min_quantity: 1, max_quantity: null, active: true }
]

function setupMockDatabase() {
  setMockSupabaseClient({
    from: (table: string) => {
      let filteredData: any[] = []
      if (table === 'products') filteredData = [...mockProducts]
      else if (table === 'product_prices') filteredData = [...mockProductPrices]

      const chain: any = {
        select: () => chain,
        eq: (col: string, val: any) => {
          filteredData = filteredData.filter(item => item[col] === val)
          return chain
        },
        in: (col: string, vals: any[]) => {
          filteredData = filteredData.filter(item => vals.includes(item[col]))
          return chain
        },
        or: (cond: string) => {
          const parts = cond.split(',')
          filteredData = filteredData.filter(item => {
            return parts.some(part => {
              const segs = part.split('.')
              if (segs.length < 3) return false
              const [field, op, ...rest] = segs
              const val = rest.join('.').replace(/^"|"$/g, '').replace(/%/g, '').toLowerCase()
              const itemVal = item[field]
              if (itemVal == null) return false
              if (op === 'eq') return String(itemVal).toLowerCase() === val
              if (op === 'ilike') return String(itemVal).toLowerCase().includes(val)
              return false
            })
          })
          return chain
        },
        limit: (n: number) => {
          filteredData = filteredData.slice(0, n)
          return chain
        },
        maybeSingle: async () => ({ data: filteredData[0] ?? null, error: null }),
        single: async () => ({ data: filteredData[0] ?? null, error: filteredData.length === 0 ? { message: 'Not found' } : null }),
        then: (resolve: any) => resolve({ data: filteredData, error: null })
      }
      return chain
    }
  })
}

test('AC-04.6.6 — Correção 1.1: "atacado" isoladamente não força saleUnit CX/FD e query "varejo e atacado" ativa comparação de faixas', () => {
  const parsedAtacado = parseStructuredQuery('Quanto custa leite uht no atacado?')
  assert.equal(parsedAtacado.saleUnit, 'UN', 'A palavra "atacado" isolada não deve ser interpretada como CX/FD')

  const parsedBoth = parseStructuredQuery('Qual o valor do leite UHT no varejo e atacado?')
  assert.equal(parsedBoth.saleUnit, 'UN')
  assert.equal(parsedBoth.isPriceTierComparison, true)
  assert.ok(parsedBoth.significantTokens.includes('leite'))
  assert.ok(parsedBoth.significantTokens.includes('uht'))
  assert.ok(!parsedBoth.significantTokens.includes('varejo'))
  assert.ok(!parsedBoth.significantTokens.includes('atacado'))
})

test('AC-04.6.6 — Correção 1.2: Busca por "leite UHT" prioriza SYNTH-AC046-03 e não retorna leite condensado como equivalente', () => {
  const candidates: StructuredProductCandidate[] = mockProducts.map(p => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: 'Laticínios',
    unit: p.unit,
    sku: p.sku,
    barcode: p.barcode,
    package_description: p.package_description,
    package_factor: p.metadata?.units_per_package || null,
    metadata: p.metadata,
    active: true,
    company_id: 'qa-tenant'
  }))

  const res = rankProductsIntelligently('Qual o valor do leite UHT no varejo e atacado?', candidates)
  assert.equal(res.status, 'exact_match')
  assert.equal(res.matches.length, 1, 'Leite condensado não deve aparecer como equivalente para leite UHT')
  assert.equal(res.matches[0].sku, 'SYNTH-AC046-03')
})

test('AC-04.6.6 — Correção 1.3 (Cenário 4): consultar_produto_comercial retorna faixas varejo (R$ 4,80 de 1-11), atacado (R$ 4,20 a partir de 12) e fardo (R$ 50,40)', async () => {
  setupMockDatabase()

  const res = await consultarProdutoComercialTool.execute({
    product_query: 'leite uht'
  }, {
    companyId: 'qa-tenant',
    agentId: 'agent-qa',
    conversationId: 'conv-c4-tiers',
    currentUserMessage: 'Qual o valor do leite UHT no varejo e atacado?'
  })

  assert.equal(res.success, true)
  assert.equal(res.data.strategy, 'price_tier_comparison')
  assert.equal(res.data.product?.id, 'e2000000-0000-0000-0000-000000000003')

  const tiers = res.data.price_tiers
  assert.ok(Array.isArray(tiers) && tiers.length === 2)
  assert.deepEqual(tiers[0], { price_type: 'retail', min_quantity: 1, max_quantity: 11, unit_price: 4.80 })
  assert.deepEqual(tiers[1], { price_type: 'wholesale', min_quantity: 12, max_quantity: null, unit_price: 4.20 })

  assert.deepEqual(res.data.package_option, {
    unit_label: 'Fardo',
    units_per_package: 12,
    unit_price: 4.20,
    package_total: 50.40
  })

  assert.ok(res.data.consultative_hint.includes('4,80'))
  assert.ok(res.data.consultative_hint.includes('4,20'))
  assert.ok(res.data.consultative_hint.includes('50,40'))
})

test('AC-04.6.6 — Correção 2 (Cenário 3): clareza entre preço unitário (R$ 5,80), por caixa (R$ 156,60) e total das 2 caixas (R$ 313,20 / 54 un)', async () => {
  setupMockDatabase()

  // Turno 1: Desambiguação entre 2 variantes Tirol para 2 caixas
  const resDiscovery = await consultarProdutoComercialTool.execute({
    product_query: 'leite condensado tirol',
    quantity: 2,
    unit: 'caixas'
  }, {
    companyId: 'qa-tenant',
    agentId: 'agent-qa',
    conversationId: 'conv-c3-clarity',
    currentUserMessage: 'Quero 2 caixas de leite condensado tirol'
  })

  assert.equal(resDiscovery.success, true)
  assert.equal(resDiscovery.data.strategy, 'brand_specific_discovery')
  const semiOption = resDiscovery.data.products.find((p: any) => p.id === 'e2000000-0000-0000-0000-000000000001')
  assert.ok(semiOption)
  assert.equal(semiOption.price.unit_price, 5.80)
  assert.equal(semiOption.price.package_price, 156.60)
  assert.equal(semiOption.price.subtotal, 313.20)
  assert.equal(semiOption.total_units, 54)
  assert.ok(resDiscovery.data.consultative_hint.includes('156,60'))
  assert.ok(resDiscovery.data.consultative_hint.includes('313,20'))

  // Turno 1b: Cálculo direto com calcular_preco_produto após escolha da variante
  const resCalc = await calcularPrecoProdutoTool.execute({
    product_id: 'e2000000-0000-0000-0000-000000000001',
    product_name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
    quantity: 2,
    unit: 'caixa'
  }, {
    companyId: 'qa-tenant',
    agentId: 'agent-qa',
    conversationId: 'conv-c3-clarity',
    currentUserMessage: 'Pode ser o semidesnatado, 2 caixas por favor'
  })

  assert.equal(resCalc.success, true)
  assert.equal(resCalc.data.requested_quantity, 2)
  assert.equal(resCalc.data.package_factor, 27)
  assert.equal(resCalc.data.base_quantity, 54)
  assert.equal(resCalc.data.unit_price, 5.80)
  assert.equal(resCalc.data.package_price, 156.60)
  assert.equal(resCalc.data.subtotal, 313.20)
  assert.ok(resCalc.data.consultative_hint.includes('São 2 caixas, com 27 unidades cada'))
  assert.ok(resCalc.data.consultative_hint.includes('totalizando 54 unidades'))
  assert.ok(resCalc.data.consultative_hint.includes('R$ 5,80 por unidade'))
  assert.ok(resCalc.data.consultative_hint.includes('R$ 313,20 pelas 2 caixas'))
})
