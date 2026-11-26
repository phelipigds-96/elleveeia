/**
 * tests/ci/ac04-6-1-catalog-pricing-safety.test.ts
 * 
 * ELLEVEE IA — AC-04.6.1 | COMPATIBILIDADE DE PREÇOS E SEGURANÇA DO SEED QA
 * 
 * Valida cirurgicamente:
 * 1. Leitura real de product_prices.price e conversão precisa para centavos.
 * 2. Seleção de regras retail vs wholesale com base em min_quantity.
 * 3. Cálculo matemático exato para 54 unidades a R$ 5,80 = R$ 313,20.
 * 4. Resolução de preços para os produtos sintéticos Tirol Integral, Leite UHT e Melken.
 * 5. Prioridade determinística para faixas de maior volume.
 * 6. Guardas de integridade do script manage-synthetic-catalog-ac046.mjs:
 *    - Bloqueio imediato diante do identificador de produção (ipxhkwirzrigttpwzwbl).
 *    - Proteção estrita contra sobrescrita de dados alienígenas (anti-collision).
 *    - Proteção contra exclusão dos 9 produtos pré-existentes da etapa H4.
 *    - Validação de escopo restrito ao tenant QA oficial (9845d5da-2cee-4ae2-ba88-d0e9ce5b00ad).
 */

import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { evaluateItemPricing } from '../../lib/services/commercial/pricing'
import {
  QA_COMPANY_ID,
  QA_COMPANY_NAME,
  PRODUCTION_PROJECT_ID,
  H4_PRODUCT_ID_PREFIX,
  H4_PRICE_ID_PREFIX,
  SYNTHETIC_PRODUCTS,
  SYNTHETIC_PRICES,
  seedFixtures,
  teardownFixtures,
  recoverInterruptedRun,
  reconcileOrphanedFixtures
} from '../../scripts/manage-synthetic-catalog-ac046.mjs'

const ROOT = process.cwd()
const MANAGE_SCRIPT = path.join(ROOT, 'scripts', 'manage-synthetic-catalog-ac046.mjs')

describe('ELLEVEE IA — AC-04.6.1 | COMPATIBILIDADE DO PRICING ENGINE E FIXTURES QA', () => {

  const tirolPrices = [
    {
      id: 'f2000000-0000-0000-0000-000000000001',
      company_id: QA_COMPANY_ID,
      product_id: 'e2000000-0000-0000-0000-000000000001',
      price_type: 'retail',
      price: 6.50,
      min_quantity: 1,
      max_quantity: null,
      active: true,
      metadata: { is_synthetic: true }
    },
    {
      id: 'f2000000-0000-0000-0000-000000000002',
      company_id: QA_COMPANY_ID,
      product_id: 'e2000000-0000-0000-0000-000000000001',
      price_type: 'wholesale',
      price: 5.80,
      min_quantity: 10,
      max_quantity: null,
      active: true,
      metadata: { is_synthetic: true }
    }
  ]

  const tirolProductInfo = {
    name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G CX C/ 27',
    unit: 'UN',
    package_description: 'Caixa com 27 unidades',
    metadata: { units_per_package: 27 }
  }

  test('Cenário 1: Conversão correta de product_prices.price para centavos inteiros sem perda de precisão', () => {
    const res = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000001', quantity: 1 },
      tirolPrices,
      tirolProductInfo
    )

    assert.equal(res.status, 'confirmed')
    assert.equal(res.unitPrice, 6.50)
    assert.equal(res.unitPriceCents, 650)
    assert.equal(res.subtotal, 6.50)
    assert.equal(res.subtotalCents, 650)
    assert.equal(res.priceType, 'retail')
  })

  test('Cenário 2: Aplicação da regra retail para quantidades abaixo da faixa de atacado (9 UN < 10 UN)', () => {
    const res = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000001', quantity: 9 },
      tirolPrices,
      tirolProductInfo
    )

    assert.equal(res.status, 'confirmed')
    assert.equal(res.unitPrice, 6.50)
    assert.equal(res.unitPriceCents, 650)
    assert.equal(res.subtotal, 58.50)
    assert.equal(res.subtotalCents, 5850)
    assert.equal(res.priceType, 'retail')
  })

  test('Cenário 3: Seleção automática da regra wholesale a partir de min_quantity (10 UN)', () => {
    const res = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000001', quantity: 10 },
      tirolPrices,
      tirolProductInfo
    )

    assert.equal(res.status, 'confirmed')
    assert.equal(res.unitPrice, 5.80)
    assert.equal(res.unitPriceCents, 580)
    assert.equal(res.subtotal, 58.00)
    assert.equal(res.subtotalCents, 5800)
    assert.equal(res.priceType, 'wholesale')
  })

  test('Cenário 4 (Requisito Obrigatório): Cálculo exato para 54 unidades (2 caixas) a R$ 5,80 = R$ 313,20', () => {
    const res = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000001', quantity: 54 },
      tirolPrices,
      tirolProductInfo
    )

    assert.equal(res.status, 'confirmed')
    assert.equal(res.priceType, 'wholesale')
    assert.equal(res.unitPrice, 5.80)
    assert.equal(res.unitPriceCents, 580)
    assert.equal(res.subtotalCents, 31320, '54 * 580 centavos deve ser exatamente 31320')
    assert.equal(res.subtotal, 313.20, 'Subtotal formatado deve ser exatamente R$ 313,20')
  })

  test('Cenário 5: Resolução correta para Leite UHT 1L (1 UN R$ 4,80 retail / 1 FD com 12 UN R$ 4,20 wholesale = R$ 50,40)', () => {
    const uhtPrices = [
      {
        id: 'f2000000-0000-0000-0000-000000000005',
        company_id: QA_COMPANY_ID,
        product_id: 'e2000000-0000-0000-0000-000000000003',
        price_type: 'retail',
        price: 4.80,
        min_quantity: 1,
        active: true,
        metadata: { is_synthetic: true }
      },
      {
        id: 'f2000000-0000-0000-0000-000000000006',
        company_id: QA_COMPANY_ID,
        product_id: 'e2000000-0000-0000-0000-000000000003',
        price_type: 'wholesale',
        price: 4.20,
        min_quantity: 12,
        active: true,
        metadata: { is_synthetic: true }
      }
    ]

    const retailRes = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000003', quantity: 5 },
      uhtPrices,
      { unit: 'UN' }
    )
    assert.equal(retailRes.unitPrice, 4.80)
    assert.equal(retailRes.subtotal, 24.00)
    assert.equal(retailRes.priceType, 'retail')

    const wholesaleRes = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000003', quantity: 12 },
      uhtPrices,
      { unit: 'UN' }
    )
    assert.equal(wholesaleRes.unitPrice, 4.20)
    assert.equal(wholesaleRes.subtotal, 50.40)
    assert.equal(wholesaleRes.subtotalCents, 5040)
    assert.equal(wholesaleRes.priceType, 'wholesale')
  })

  test('Cenário 6: Resolução correta para Chocolate Melken 50% 1kg (1 UN R$ 42,00 / 5 UN R$ 38,00 = R$ 190,00)', () => {
    const melkenPrices = [
      {
        id: 'f2000000-0000-0000-0000-000000000007',
        company_id: QA_COMPANY_ID,
        product_id: 'e2000000-0000-0000-0000-000000000004',
        price_type: 'retail',
        price: 42.00,
        min_quantity: 1,
        active: true,
        metadata: { is_synthetic: true }
      },
      {
        id: 'f2000000-0000-0000-0000-000000000008',
        company_id: QA_COMPANY_ID,
        product_id: 'e2000000-0000-0000-0000-000000000004',
        price_type: 'wholesale',
        price: 38.00,
        min_quantity: 5,
        active: true,
        metadata: { is_synthetic: true }
      }
    ]

    const wholesaleRes = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000004', quantity: 5 },
      melkenPrices,
      { unit: 'UN' }
    )
    assert.equal(wholesaleRes.unitPrice, 38.00)
    assert.equal(wholesaleRes.subtotal, 190.00)
    assert.equal(wholesaleRes.subtotalCents, 19000)
    assert.equal(wholesaleRes.priceType, 'wholesale')
  })

  test('Cenário 7: Priorização de faixa de maior volume quando múltiplas faixas de atacado são elegíveis', () => {
    const tieredPrices = [
      {
        id: 'price-1',
        company_id: QA_COMPANY_ID,
        product_id: 'prod-tiered',
        price_type: 'retail',
        price: 10.00,
        min_quantity: 1,
        active: true
      },
      {
        id: 'price-10',
        company_id: QA_COMPANY_ID,
        product_id: 'prod-tiered',
        price_type: 'wholesale',
        price: 9.00,
        min_quantity: 10,
        active: true
      },
      {
        id: 'price-50',
        company_id: QA_COMPANY_ID,
        product_id: 'prod-tiered',
        price_type: 'wholesale',
        price: 8.00,
        min_quantity: 50,
        active: true
      }
    ]

    const res = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'prod-tiered', quantity: 60 },
      tieredPrices,
      { unit: 'UN' }
    )

    assert.equal(res.status, 'confirmed')
    assert.equal(res.priceType, 'wholesale')
    assert.equal(res.unitPrice, 8.00, 'Deve selecionar a faixa de 50 UN (R$ 8,00), e não a de 10 UN')
    assert.equal(res.subtotal, 480.00)
  })

  test('Cenário 8: Produto com package_factor explícito (embalagem fechada) bloqueia compras fracionadas e aprova múltiplos exatos', () => {
    const closedBoxProductInfo = {
      name: 'LEITE CONDENSADO TIROL CX C/ 27 (EMBALAGEM FECHADA)',
      unit: 'UN',
      package_description: 'Caixa com 27 unidades',
      metadata: { package_factor: 27 }
    }

    // 1 unidade: não é múltipla de 27 -> deve ser rejeitada fail-closed
    const rejectedRes = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000001', quantity: 1 },
      tirolPrices,
      closedBoxProductInfo
    )
    assert.equal(rejectedRes.status, 'unavailable')
    assert.match(rejectedRes.unavailableReason || '', /múltipla de 27 unidades/)

    // 54 unidades: múltipla exata de 27 (2 caixas) -> deve ser aprovada
    const approvedRes = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000001', quantity: 54 },
      tirolPrices,
      closedBoxProductInfo
    )
    assert.equal(approvedRes.status, 'confirmed')
    assert.equal(approvedRes.subtotal, 313.20)
  })

  test('Cenário 9: Produto sem preços cadastrados retorna status unavailable de forma graciosa sem exception', () => {
    const res = evaluateItemPricing(
      { companyId: QA_COMPANY_ID, productId: 'e2000000-0000-0000-0000-000000000005', quantity: 1 },
      [],
      { unit: 'UN' }
    )
    assert.equal(res.status, 'unavailable')
    assert.equal(res.unitPrice, 0)
    assert.equal(res.subtotal, 0)
  })
})

describe('ELLEVEE IA — AC-04.6.1 | GUARDAS DE SEGURANÇA DO SEED E TEARDOWN DO CATÁLOGO', () => {

  test('Guarda 1: Aborta imediatamente se qualquer variável contiver o ID de Produção (ipxhkwirzrigttpwzwbl)', () => {
    const res = spawnSync(process.execPath, [MANAGE_SCRIPT, '--dry-run'], {
      env: {
        ...process.env,
        DANGEROUS_VAR: PRODUCTION_PROJECT_ID
      },
      encoding: 'utf8'
    })

    assert.equal(res.status, 1, 'Deve abortar com status 1')
    assert.match(
      res.stderr + res.stdout,
      /CRITICAL_SECURITY.*PRODUÇÃO.*ipxhkwirzrigttpwzwbl/,
      'Deve emitir erro de segurança contra contaminação de produção'
    )
  })

  test('Guarda 2: Constantes do catálogo protegem IDs da etapa H4 (e1000000-* e f1000000-*)', () => {
    // Garante que nenhum produto novo possua o prefixo protegido H4
    for (const p of SYNTHETIC_PRODUCTS) {
      assert.ok(!p.id.startsWith(H4_PRODUCT_ID_PREFIX), `Produto ${p.sku} não pode usar prefixo protegido H4`)
      assert.ok(p.sku.startsWith('SYNTH-AC046-'), `Produto ${p.sku} deve usar prefixo da suíte AC-04.6`)
      assert.equal(p.metadata.suite, 'AC-04.6', `Produto ${p.sku} deve ter tag da suíte`)
      assert.equal(p.metadata.is_synthetic, true, `Produto ${p.sku} deve ser marcado como sintético`)
    }

    // Garante que nenhum preço novo possua o prefixo protegido H4
    for (const pr of SYNTHETIC_PRICES) {
      assert.ok(!pr.id.startsWith(H4_PRICE_ID_PREFIX), `Preço ${pr.id} não pode usar prefixo protegido H4`)
      assert.equal(pr.metadata.suite, 'AC-04.6', `Preço ${pr.id} deve ter tag da suíte`)
      assert.equal(pr.metadata.is_synthetic, true, `Preço ${pr.id} deve ser marcado como sintético`)
    }
  })

  test('Guarda 3: Todos os produtos e preços sintéticos são restritos exclusivamente ao tenant QA autorizado', () => {
    for (const p of SYNTHETIC_PRODUCTS) {
      assert.equal(p.company_id, QA_COMPANY_ID, `Produto ${p.sku} deve pertencer exclusivamente ao tenant QA`)
    }
    for (const pr of SYNTHETIC_PRICES) {
      assert.equal(pr.company_id, QA_COMPANY_ID, `Preço ${pr.id} deve pertencer exclusivamente ao tenant QA`)
    }
  })
})

describe('ELLEVEE IA — AC-04.6.1 | COMPROVAÇÃO OFFLINE DAS 3 CORREÇÕES OPERACIONAIS DO SEED QA', () => {

  function createMockSupabase({ companies = [], products = [], prices = [] } = {}) {
    const state = {
      companies: [...companies],
      products: [...products],
      prices: [...prices],
      deletedProducts: [],
      deletedPrices: [],
      insertedProducts: [],
      insertedPrices: []
    }

    return {
      state,
      from(table) {
        let filters = []
        let selectFields = '*'

        const builder = {
          select(fields = '*') {
            selectFields = fields
            return builder
          },
          eq(col, val) {
            filters.push({ type: 'eq', col, val })
            return builder
          },
          in(col, vals) {
            filters.push({ type: 'in', col, vals })
            return builder
          },
          or(clause) {
            filters.push({ type: 'or', clause })
            return builder
          },
          like(col, pattern) {
            filters.push({ type: 'like', col, pattern })
            return builder
          },
          async single() {
            const list = getFilteredData()
            return { data: list[0] || null, error: list.length > 0 ? null : { message: 'Not found' } }
          },
          async insert(records) {
            const arr = Array.isArray(records) ? records : [records]
            if (table === 'products') {
              state.products.push(...arr)
              state.insertedProducts.push(...arr)
            } else if (table === 'product_prices') {
              state.prices.push(...arr)
              state.insertedPrices.push(...arr)
            }
            return { data: arr, error: null }
          },
          delete() {
            const deleteFilters = []
            return {
              eq(col, val) {
                deleteFilters.push({ type: 'eq', col, val })
                return this
              },
              in(col, vals) {
                deleteFilters.push({ type: 'in', col, vals })
                return this
              },
              then(resolve) {
                if (table === 'product_prices') {
                  const inFilter = deleteFilters.find(f => f.type === 'in' && f.col === 'id')
                  const idsToDelete = new Set(inFilter ? inFilter.vals : [])
                  state.deletedPrices.push(...state.prices.filter(p => idsToDelete.has(p.id)))
                  state.prices = state.prices.filter(p => !idsToDelete.has(p.id))
                } else if (table === 'products') {
                  const inFilter = deleteFilters.find(f => f.type === 'in' && f.col === 'id')
                  const idsToDelete = new Set(inFilter ? inFilter.vals : [])
                  state.deletedProducts.push(...state.products.filter(p => idsToDelete.has(p.id)))
                  state.products = state.products.filter(p => !idsToDelete.has(p.id))
                }
                resolve({ data: null, error: null })
              }
            }
          },
          then(resolve, reject) {
            try {
              const data = getFilteredData()
              resolve({ data, count: data.length, error: null })
            } catch (err) {
              reject(err)
            }
          }
        }

        function getFilteredData() {
          let rows = table === 'companies' ? state.companies
            : table === 'products' ? state.products
            : table === 'product_prices' ? state.prices
            : []

          for (const f of filters) {
            if (f.type === 'eq') {
              rows = rows.filter(r => r[f.col] === f.val)
            } else if (f.type === 'in') {
              const set = new Set(f.vals)
              rows = rows.filter(r => set.has(r[f.col]))
            } else if (f.type === 'like') {
              const prefix = f.pattern.replace(/%/g, '')
              rows = rows.filter(r => String(r[f.col] || '').startsWith(prefix))
            } else if (f.type === 'or') {
              rows = rows.filter(r => {
                if (table === 'products') {
                  return SYNTHETIC_PRODUCTS.some(sp => sp.id === r.id || sp.sku === r.sku)
                }
                if (table === 'product_prices') {
                  const plannedPriceIds = new Set(SYNTHETIC_PRICES.map(p => p.id))
                  const plannedProductIds = new Set(SYNTHETIC_PRODUCTS.map(p => p.id))
                  return plannedPriceIds.has(r.id) || plannedProductIds.has(r.product_id)
                }
                return true
              })
            }
          }
          return rows
        }

        return builder
      }
    }
  }

  const defaultCompany = {
    id: QA_COMPANY_ID,
    name: QA_COMPANY_NAME,
    slug: 'ellevee-homologacao-qa'
  }

  test('Correção 1: --dry-run NUNCA modifica arquivos locais no disco, mesmo com catálogo 100% completo no banco', async () => {
    const tmpManifestPath = path.join(os.tmpdir(), `test-manifest-dryrun-${crypto.randomUUID()}.json`)
    assert.equal(fs.existsSync(tmpManifestPath), false, 'Arquivo temporário não deve existir previamente')

    const mockSupabaseFull = createMockSupabase({
      companies: [defaultCompany],
      products: SYNTHETIC_PRODUCTS,
      prices: SYNTHETIC_PRICES
    })

    // Executa seedFixtures em modo dry-run com catálogo 100% presente no banco
    const result = await seedFixtures(true, mockSupabaseFull, tmpManifestPath)

    assert.equal(result.dryRun, true, 'Deve confirmar execução dryRun')
    assert.equal(result.alreadySeeded, true, 'Deve identificar que o catálogo já estava completo')
    assert.equal(fs.existsSync(tmpManifestPath), false, 'Arquivo de manifesto NÃO deve ter sido criado em dry-run')
    assert.equal(mockSupabaseFull.state.insertedProducts.length, 0, 'Zero produtos devem ter sido inseridos no banco')
    assert.equal(mockSupabaseFull.state.insertedPrices.length, 0, 'Zero preços devem ter sido inseridos no banco')
  })

  test('Correção 2.1: --teardown NUNCA usa IDs planejados como fallback quando o manifesto está AUSENTE', async () => {
    const missingManifestPath = path.join(os.tmpdir(), `test-missing-manifest-${crypto.randomUUID()}.json`)
    assert.equal(fs.existsSync(missingManifestPath), false)

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: SYNTHETIC_PRODUCTS,
      prices: SYNTHETIC_PRICES
    })

    await assert.rejects(
      async () => {
        await teardownFixtures(false, mockSupabase, missingManifestPath)
      },
      {
        message: /\[TEARDOWN GUARD\] Manifesto de execução ausente.*Proibido utilizar IDs planejados como fallback/
      }
    )

    assert.equal(mockSupabase.state.deletedProducts.length, 0, 'Nenhum produto deve ter sido excluído')
    assert.equal(mockSupabase.state.deletedPrices.length, 0, 'Nenhum preço deve ter sido excluído')
  })

  test('Correção 2.2: --teardown NUNCA usa IDs planejados como fallback quando o manifesto está CORROMPIDO ou INVÁLIDO', async () => {
    const corruptManifestPath = path.join(os.tmpdir(), `test-corrupt-manifest-${crypto.randomUUID()}.json`)
    fs.writeFileSync(corruptManifestPath, '{ invalid json content !!!', 'utf8')

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: SYNTHETIC_PRODUCTS,
      prices: SYNTHETIC_PRICES
    })

    try {
      await assert.rejects(
        async () => {
          await teardownFixtures(false, mockSupabase, corruptManifestPath)
        },
        {
          message: /\[TEARDOWN GUARD\] Manifesto corrompido ou formato JSON inválido.*Proibido utilizar IDs planejados como fallback/
        }
      )
      assert.equal(mockSupabase.state.deletedProducts.length, 0, 'Nenhum produto deve ter sido excluído')
      assert.equal(mockSupabase.state.deletedPrices.length, 0, 'Nenhum preço deve ter sido excluído')
    } finally {
      if (fs.existsSync(corruptManifestPath)) fs.unlinkSync(corruptManifestPath)
    }
  })

  test('Correção 2.3: --teardown NUNCA usa IDs planejados como fallback quando o manifesto está VAZIO (sem IDs criados)', async () => {
    const emptyManifestPath = path.join(os.tmpdir(), `test-empty-manifest-${crypto.randomUUID()}.json`)
    fs.writeFileSync(emptyManifestPath, JSON.stringify({
      suite: 'AC-04.6',
      runId: crypto.randomUUID(),
      companyId: QA_COMPANY_ID,
      createdProductIds: [],
      createdPriceIds: []
    }, null, 2), 'utf8')

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: SYNTHETIC_PRODUCTS,
      prices: SYNTHETIC_PRICES
    })

    try {
      await assert.rejects(
        async () => {
          await teardownFixtures(false, mockSupabase, emptyManifestPath)
        },
        {
          message: /\[TEARDOWN GUARD\] O manifesto não contém nenhum ID registrado como criado pela suíte AC-04.6.*Proibido utilizar IDs planejados como fallback/
        }
      )
      assert.equal(mockSupabase.state.deletedProducts.length, 0, 'Nenhum produto deve ter sido excluído')
      assert.equal(mockSupabase.state.deletedPrices.length, 0, 'Nenhum preço deve ter sido excluído')
    } finally {
      if (fs.existsSync(emptyManifestPath)) fs.unlinkSync(emptyManifestPath)
    }
  })

  test('Ajuste 1: No caminho alreadySeeded, NÃO atribui registros encontrados a createdProductIds e createdPriceIds', async () => {
    const tmpManifestPath = path.join(os.tmpdir(), `test-manifest-alreadyseeded-${crypto.randomUUID()}.json`)
    assert.equal(fs.existsSync(tmpManifestPath), false)

    const mockSupabaseFull = createMockSupabase({
      companies: [defaultCompany],
      products: SYNTHETIC_PRODUCTS,
      prices: SYNTHETIC_PRICES
    })

    // Executa seedFixtures em modo real (isDryRun = false) com banco já 100% populado
    const res = await seedFixtures(false, mockSupabaseFull, tmpManifestPath)

    assert.equal(res.alreadySeeded, true)
    assert.equal(res.createdProductIdsCount, 0, 'Zero produtos devem ser atribuídos como criados')
    assert.equal(res.discoveredProductIdsCount, 6, 'Todos os 6 produtos devem ser marcados como descobertos')

    const savedManifest = JSON.parse(fs.readFileSync(tmpManifestPath, 'utf8'))
    assert.equal(savedManifest.status, 'already_seeded')
    assert.deepEqual(savedManifest.createdProductIds, [], 'createdProductIds deve permanecer vazio')
    assert.deepEqual(savedManifest.createdPriceIds, [], 'createdPriceIds deve permanecer vazio')
    assert.equal(savedManifest.discoveredProductIds.length, 6, 'discoveredProductIds deve conter os 6 IDs')
    assert.equal(savedManifest.discoveredPriceIds.length, 10, 'discoveredPriceIds deve conter os 10 IDs')
    assert.equal(savedManifest.authorizedForDeletion, false, 'Não deve autorizar exclusão de dados não criados')

    // Tentativa de teardown neste manifesto deve falhar (preservando os dados pré-existentes)
    await assert.rejects(
      async () => {
        await teardownFixtures(false, mockSupabaseFull, tmpManifestPath)
      },
      {
        message: /\[TEARDOWN GUARD\] Teardown bloqueado: authorizedForDeletion é false/
      }
    )

    assert.equal(mockSupabaseFull.state.deletedProducts.length, 0, 'Zero produtos excluídos')
    assert.equal(mockSupabaseFull.state.deletedPrices.length, 0, 'Zero preços excluídos')

    if (fs.existsSync(tmpManifestPath)) fs.unlinkSync(tmpManifestPath)
  })

  test('Ajuste 2: Em reconcileOrphanedFixtures(), recupera inserções com evidência persistida de intenção anterior à escrita', async () => {
    const recoverManifestPath = path.join(os.tmpdir(), `test-recover-proven-${crypto.randomUUID()}.json`)
    const activeRunId = crypto.randomUUID()

    // Cria manifesto prévio simulando que o processo iniciou a escrita antes de cair (evidência persistida de intenção)
    const initialManifest = {
      suite: 'AC-04.6',
      runId: activeRunId,
      companyId: QA_COMPANY_ID,
      status: 'in_progress',
      authorizedForDeletion: true,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plannedProducts: [
        { id: SYNTHETIC_PRODUCTS[0].id, sku: SYNTHETIC_PRODUCTS[0].sku },
        { id: SYNTHETIC_PRODUCTS[1].id, sku: SYNTHETIC_PRODUCTS[1].sku }
      ],
      createdProductIds: [],
      plannedPrices: [
        { id: SYNTHETIC_PRICES[0].id, product_id: SYNTHETIC_PRICES[0].product_id, price_type: SYNTHETIC_PRICES[0].price_type, min_quantity: SYNTHETIC_PRICES[0].min_quantity },
        { id: SYNTHETIC_PRICES[1].id, product_id: SYNTHETIC_PRICES[1].product_id, price_type: SYNTHETIC_PRICES[1].price_type, min_quantity: SYNTHETIC_PRICES[1].min_quantity }
      ],
      createdPriceIds: [],
      errors: []
    }
    fs.writeFileSync(recoverManifestPath, JSON.stringify(initialManifest, null, 2), 'utf8')

    // Registros no Supabase com metadados vinculados ao runId ativo
    const h4Products = Array.from({ length: 9 }, (_, i) => ({
      id: `e1000000-0000-0000-0000-00000000000${i + 1}`,
      company_id: QA_COMPANY_ID,
      sku: `H4-${i + 1}`,
      metadata: { suite: 'H4' }
    }))
    const orphanProds = [
      { ...SYNTHETIC_PRODUCTS[0], metadata: { ...SYNTHETIC_PRODUCTS[0].metadata, run_id: activeRunId } },
      { ...SYNTHETIC_PRODUCTS[1], metadata: { ...SYNTHETIC_PRODUCTS[1].metadata, run_id: activeRunId } }
    ]
    const orphanPrices = [
      { ...SYNTHETIC_PRICES[0], metadata: { ...SYNTHETIC_PRICES[0].metadata, run_id: activeRunId } },
      { ...SYNTHETIC_PRICES[1], metadata: { ...SYNTHETIC_PRICES[1].metadata, run_id: activeRunId } }
    ]

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [...h4Products, ...orphanProds],
      prices: orphanPrices
    })

    try {
      const reconcileResult = await recoverInterruptedRun(false, { clean: false }, mockSupabase, recoverManifestPath)

      assert.equal(reconcileResult.provenCreatedProductsCount, 2, '2 produtos devem ter propriedade comprovada')
      assert.equal(reconcileResult.provenCreatedPricesCount, 2, '2 preços devem ter propriedade comprovada')
      assert.equal(reconcileResult.discoveredUnownedProductsCount, 0, 'Zero produtos não reconhecidos')
      assert.equal(reconcileResult.status, 'reconciled_partial')
      assert.equal(reconcileResult.authorizedForDeletion, true, 'Exclusão deve ser autorizada para registros comprovados')

      // Teardown com o manifesto reconciliado deve excluir apenas os 2 itens
      const teardownRes = await teardownFixtures(false, mockSupabase, recoverManifestPath)
      assert.equal(teardownRes.success, true)
      assert.equal(teardownRes.deletedProductsCount, 2)
      assert.equal(teardownRes.deletedPricesCount, 2)
    } finally {
      if (fs.existsSync(recoverManifestPath)) fs.unlinkSync(recoverManifestPath)
    }
  })

  test('Ajuste 2.1: Em reconcileOrphanedFixtures(), registros sem evidência persistida de intenção são sinalizados para revisão manual sem autorizar exclusão', async () => {
    const unownedManifestPath = path.join(os.tmpdir(), `test-recover-unowned-${crypto.randomUUID()}.json`)
    assert.equal(fs.existsSync(unownedManifestPath), false, 'Sem manifesto anterior em disco')

    // Registros no Supabase sem run_id e sem manifesto ativo prévio
    const orphanProds = [SYNTHETIC_PRODUCTS[0]]
    const orphanPrices = [SYNTHETIC_PRICES[0]]

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: orphanProds,
      prices: orphanPrices
    })

    try {
      const reconcileResult = await recoverInterruptedRun(false, { clean: false }, mockSupabase, unownedManifestPath)

      assert.equal(reconcileResult.discoveredUnownedProductsCount, 1, 'Deve marcar o produto como não comprovado')
      assert.equal(reconcileResult.discoveredUnownedPricesCount, 1, 'Deve marcar o preço como não comprovado')
      assert.equal(reconcileResult.provenCreatedProductsCount, 0, 'Zero produtos comprovados como criados')
      assert.equal(reconcileResult.provenCreatedPricesCount, 0, 'Zero preços comprovados como criados')
      assert.equal(reconcileResult.status, 'requires_manual_review')
      assert.equal(reconcileResult.authorizedForDeletion, false, 'Exclusão NÃO autorizada')

      // Valida que o manifesto em disco foi gravado com requires_manual_review e authorizedForDeletion: false
      const savedManifest = JSON.parse(fs.readFileSync(unownedManifestPath, 'utf8'))
      assert.equal(savedManifest.status, 'requires_manual_review')
      assert.equal(savedManifest.authorizedForDeletion, false)
      assert.deepEqual(savedManifest.createdProductIds, [])
      assert.deepEqual(savedManifest.createdPriceIds, [])

      // Teardown deve ser terminantemente rejeitado fail-closed
      await assert.rejects(
        async () => {
          await teardownFixtures(false, mockSupabase, unownedManifestPath)
        },
        {
          message: /\[TEARDOWN GUARD\] Teardown bloqueado: o manifesto está marcado como 'requires_manual_review'/
        }
      )

      // --recover --clean também deve ser bloqueado
      await assert.rejects(
        async () => {
          await recoverInterruptedRun(false, { clean: true }, mockSupabase, unownedManifestPath)
        },
        {
          message: /\[RECOVER CLEAN BLOCKED\] Limpeza automática recusada.*Revisão manual necessária/
        }
      )

      assert.equal(mockSupabase.state.deletedProducts.length, 0, 'Nenhum registro pode ter sido excluído')
      assert.equal(mockSupabase.state.deletedPrices.length, 0, 'Nenhum registro pode ter sido excluído')
    } finally {
      if (fs.existsSync(unownedManifestPath)) fs.unlinkSync(unownedManifestPath)
    }
  })

  test('Ajuste 4.1: Verificação de colisão de preços pela chave de negócio única (company_id, product_id, price_type, min_quantity) rejeita registros alienígenas', async () => {
    const tmpManifestPath = path.join(os.tmpdir(), `test-price-collision-${crypto.randomUUID()}.json`)

    // Preço no banco com a mesma chave de negócio do SYNTH-AC046-01 (company_id, product_id, retail, min_qty=1), mas SEM tag da suíte (alienígena)
    const alienPrice = {
      id: 'f9999999-0000-0000-0000-000000000001',
      company_id: QA_COMPANY_ID,
      product_id: SYNTHETIC_PRODUCTS[0].id,
      price_type: 'retail',
      min_quantity: 1,
      price: 9.99,
      metadata: { is_synthetic: false, suite: 'LEGACY' }
    }

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [],
      prices: [alienPrice]
    })

    await assert.rejects(
      async () => {
        await seedFixtures(false, mockSupabase, tmpManifestPath)
      },
      {
        message: /\[ALIEN DATA COLLISION\] Preço pré-existente.*chave.*NÃO pertence à suíte AC-04.6/
      }
    )

    if (fs.existsSync(tmpManifestPath)) fs.unlinkSync(tmpManifestPath)
  })

  test('Ajuste 4.2: Verificação de colisão de preços rejeita conflito quando chave de negócio existe com ID divergente do planejado', async () => {
    const tmpManifestPath = path.join(os.tmpdir(), `test-price-id-mismatch-${crypto.randomUUID()}.json`)

    // Preço no banco com a mesma chave de negócio e suite AC-04.6, mas ID diferente do fixo f2000000-0000-0000-0000-000000000001
    const mismatchedPrice = {
      id: 'f8888888-0000-0000-0000-000000000001', // Divergente do planejado f2000000-...
      company_id: QA_COMPANY_ID,
      product_id: SYNTHETIC_PRODUCTS[0].id,
      price_type: 'retail',
      min_quantity: 1,
      price: 6.50,
      metadata: { is_synthetic: true, suite: 'AC-04.6' }
    }

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [],
      prices: [mismatchedPrice]
    })

    await assert.rejects(
      async () => {
        await seedFixtures(false, mockSupabase, tmpManifestPath)
      },
      {
        message: /\[BUSINESS KEY ID MISMATCH\] Conflito de chave única.*divergindo do ID planejado/
      }
    )

    if (fs.existsSync(tmpManifestPath)) fs.unlinkSync(tmpManifestPath)
  })

  test('Ajuste 5: Registro preexistente com mesmo ID e marcadores da suíte, porém run_id diferente, NUNCA é autorizado para exclusão', async () => {
    const testManifestPath = path.join(os.tmpdir(), `test-divergent-run-id-${crypto.randomUUID()}.json`)
    const currentRunId = crypto.randomUUID()
    const priorRunId = crypto.randomUUID() // run_id diferente!

    // Manifesto da execução atual em andamento (com intenção planejada para SYNTHETIC_PRODUCTS[0])
    const currentManifest = {
      suite: 'AC-04.6',
      runId: currentRunId,
      companyId: QA_COMPANY_ID,
      status: 'in_progress',
      authorizedForDeletion: false,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plannedProducts: [
        { id: SYNTHETIC_PRODUCTS[0].id, sku: SYNTHETIC_PRODUCTS[0].sku }
      ],
      createdProductIds: [],
      plannedPrices: [
        { id: SYNTHETIC_PRICES[0].id, product_id: SYNTHETIC_PRICES[0].product_id, price_type: SYNTHETIC_PRICES[0].price_type, min_quantity: SYNTHETIC_PRICES[0].min_quantity }
      ],
      createdPriceIds: [],
      errors: []
    }
    fs.writeFileSync(testManifestPath, JSON.stringify(currentManifest, null, 2), 'utf8')

    // Registro no banco com MESMO ID e marcadores da suíte, porém run_id DIFERENTE (pertencente a execução anterior/outra)
    const preExistingProduct = {
      ...SYNTHETIC_PRODUCTS[0],
      metadata: {
        ...SYNTHETIC_PRODUCTS[0].metadata,
        suite: 'AC-04.6',
        is_synthetic: true,
        run_id: priorRunId // Divergente do currentRunId!
      }
    }
    const preExistingPrice = {
      ...SYNTHETIC_PRICES[0],
      metadata: {
        ...SYNTHETIC_PRICES[0].metadata,
        suite: 'AC-04.6',
        is_synthetic: true,
        run_id: priorRunId // Divergente do currentRunId!
      }
    }

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [preExistingProduct],
      prices: [preExistingPrice]
    })

    try {
      // 1. Tentar reconciliação: deve classificar como unowned e marcar requires_manual_review
      const reconcileResult = await recoverInterruptedRun(false, { clean: false }, mockSupabase, testManifestPath)

      assert.equal(reconcileResult.provenCreatedProductsCount, 0, 'Registro com run_id divergente NÃO pode ser classificado como comprovado')
      assert.equal(reconcileResult.provenCreatedPricesCount, 0, 'Preço com run_id divergente NÃO pode ser classificado como comprovado')
      assert.equal(reconcileResult.discoveredUnownedProductsCount, 1, 'Deve ser categorizado como discoveredUnowned')
      assert.equal(reconcileResult.discoveredUnownedPricesCount, 1, 'Deve ser categorizado como discoveredUnowned')
      assert.equal(reconcileResult.status, 'requires_manual_review', 'Status deve ser obrigatoriamente requires_manual_review')
      assert.equal(reconcileResult.authorizedForDeletion, false, 'authorizedForDeletion deve ser false')

      // 2. Tentar teardown: deve falhar fechado com TEARDOWN GUARD
      await assert.rejects(
        async () => {
          await teardownFixtures(false, mockSupabase, testManifestPath)
        },
        {
          message: /\[TEARDOWN GUARD\] Teardown bloqueado: o manifesto está marcado como 'requires_manual_review'/
        }
      )

      // 3. Mesmo que um manifesto forçado tente listar o ID em createdProductIds com o runId atual,
      // a auditoria prévia do teardown verifica metadata.run_id no banco e rejeita a exclusão
      const forcedManifestPath = path.join(os.tmpdir(), `test-forced-manifest-${crypto.randomUUID()}.json`)
      fs.writeFileSync(forcedManifestPath, JSON.stringify({
        suite: 'AC-04.6',
        runId: currentRunId,
        companyId: QA_COMPANY_ID,
        status: 'completed',
        authorizedForDeletion: true,
        createdProductIds: [preExistingProduct.id],
        createdPriceIds: [preExistingPrice.id]
      }, null, 2), 'utf8')

      try {
        await assert.rejects(
          async () => {
            await teardownFixtures(false, mockSupabase, forcedManifestPath)
          },
          {
            message: /\[TEARDOWN GUARD\] Nenhum dos registros alvo possui propriedade comprovada correspondente ao runId do manifesto/
          }
        )
      } finally {
        if (fs.existsSync(forcedManifestPath)) fs.unlinkSync(forcedManifestPath)
      }

      // 4. Confirmação absoluta de preservação: registros permanecem intactos no banco
      assert.equal(mockSupabase.state.deletedProducts.length, 0, 'O produto preexistente NUNCA pode ser excluído')
      assert.equal(mockSupabase.state.deletedPrices.length, 0, 'O preço preexistente NUNCA pode ser excluído')

    } finally {
      if (fs.existsSync(testManifestPath)) fs.unlinkSync(testManifestPath)
    }
  })

  test('Correção 3.2: --recover --dry-run NÃO altera arquivos em disco', async () => {
    const dryRunManifestPath = path.join(os.tmpdir(), `test-recover-dryrun-${crypto.randomUUID()}.json`)
    assert.equal(fs.existsSync(dryRunManifestPath), false)

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [SYNTHETIC_PRODUCTS[0]],
      prices: [SYNTHETIC_PRICES[0]]
    })

    const dryRes = await recoverInterruptedRun(true, { clean: false }, mockSupabase, dryRunManifestPath)

    assert.equal(fs.existsSync(dryRunManifestPath), false, 'Em dry-run, NENHUM arquivo deve ser criado ou alterado no disco')
  })

  test('Correção Estrita run_id: Registros com run_id ausente no banco bloqueiam teardown e acionam manual review sem exclusões', async () => {
    const currentRunId = crypto.randomUUID()
    const testManifestPath = path.join(os.tmpdir(), `test-missing-runid-db-${crypto.randomUUID()}.json`)

    // Manifesto com runId válido e intenção ativa
    fs.writeFileSync(testManifestPath, JSON.stringify({
      suite: 'AC-04.6',
      runId: currentRunId,
      companyId: QA_COMPANY_ID,
      status: 'in_progress',
      authorizedForDeletion: false,
      plannedProducts: [{ id: SYNTHETIC_PRODUCTS[0].id, sku: SYNTHETIC_PRODUCTS[0].sku }],
      createdProductIds: [SYNTHETIC_PRODUCTS[0].id],
      plannedPrices: [{ id: SYNTHETIC_PRICES[0].id }],
      createdPriceIds: [SYNTHETIC_PRICES[0].id],
      errors: []
    }, null, 2), 'utf8')

    // Registros no banco com metadata SEM run_id
    const recordWithoutRunId = {
      ...SYNTHETIC_PRODUCTS[0],
      metadata: {
        ...SYNTHETIC_PRODUCTS[0].metadata,
        suite: 'AC-04.6',
        is_synthetic: true
        // run_id ausente!
      }
    }
    const priceWithoutRunId = {
      ...SYNTHETIC_PRICES[0],
      metadata: {
        ...SYNTHETIC_PRICES[0].metadata,
        suite: 'AC-04.6',
        is_synthetic: true
        // run_id ausente!
      }
    }

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [recordWithoutRunId],
      prices: [priceWithoutRunId]
    })

    try {
      // 1. Reconciliação: deve classificar como unowned e marcar requires_manual_review
      const reconcileResult = await recoverInterruptedRun(false, { clean: false }, mockSupabase, testManifestPath)

      assert.equal(reconcileResult.provenCreatedProductsCount, 0, 'Registro com run_id ausente NÃO pode ser classificado como comprovado')
      assert.equal(reconcileResult.provenCreatedPricesCount, 0, 'Preço com run_id ausente NÃO pode ser classificado como comprovado')
      assert.equal(reconcileResult.discoveredUnownedProductsCount, 1, 'Deve ser categorizado como discoveredUnowned')
      assert.equal(reconcileResult.discoveredUnownedPricesCount, 1, 'Deve ser categorizado como discoveredUnowned')
      assert.equal(reconcileResult.status, 'requires_manual_review', 'Status deve ser obrigatoriamente requires_manual_review')
      assert.equal(reconcileResult.authorizedForDeletion, false, 'authorizedForDeletion deve ser false')

      // 2. Teardown bloqueado pelo status requires_manual_review
      await assert.rejects(
        async () => {
          await teardownFixtures(false, mockSupabase, testManifestPath)
        },
        {
          message: /\[TEARDOWN GUARD\] Teardown bloqueado: o manifesto está marcado como 'requires_manual_review'/
        }
      )

      // 3. Mesmo que um manifesto tente forçar autorização de exclusão, a auditoria no banco detecta run_id ausente
      const forcedManifestPath = path.join(os.tmpdir(), `test-forced-missing-runid-${crypto.randomUUID()}.json`)
      fs.writeFileSync(forcedManifestPath, JSON.stringify({
        suite: 'AC-04.6',
        runId: currentRunId,
        companyId: QA_COMPANY_ID,
        status: 'completed',
        authorizedForDeletion: true,
        createdProductIds: [recordWithoutRunId.id],
        createdPriceIds: [priceWithoutRunId.id]
      }, null, 2), 'utf8')

      try {
        await assert.rejects(
          async () => {
            await teardownFixtures(false, mockSupabase, forcedManifestPath)
          },
          {
            message: /\[TEARDOWN GUARD\] Nenhum dos registros alvo possui propriedade comprovada correspondente ao runId do manifesto/
          }
        )
      } finally {
        if (fs.existsSync(forcedManifestPath)) fs.unlinkSync(forcedManifestPath)
      }

      // 4. Zero exclusões efetuadas
      assert.equal(mockSupabase.state.deletedProducts.length, 0, 'Zero produtos excluídos')
      assert.equal(mockSupabase.state.deletedPrices.length, 0, 'Zero preços excluídos')
    } finally {
      if (fs.existsSync(testManifestPath)) fs.unlinkSync(testManifestPath)
    }
  })

  test('Correção Estrita run_id: Manifesto com runId ausente ou vazio bloqueia teardown e reconciliação sem exclusões', async () => {
    const invalidManifestPath = path.join(os.tmpdir(), `test-missing-runid-manifest-${crypto.randomUUID()}.json`)

    // Manifesto sem runId (runId ausente / vazio)
    fs.writeFileSync(invalidManifestPath, JSON.stringify({
      suite: 'AC-04.6',
      runId: '', // Vazio / ausente
      companyId: QA_COMPANY_ID,
      status: 'completed',
      authorizedForDeletion: true,
      createdProductIds: [SYNTHETIC_PRODUCTS[0].id],
      createdPriceIds: [SYNTHETIC_PRICES[0].id]
    }, null, 2), 'utf8')

    const mockSupabase = createMockSupabase({
      companies: [defaultCompany],
      products: [SYNTHETIC_PRODUCTS[0]],
      prices: [SYNTHETIC_PRICES[0]]
    })

    try {
      // 1. Teardown deve ser imediatamente bloqueado pela guarda estrita de runId
      await assert.rejects(
        async () => {
          await teardownFixtures(false, mockSupabase, invalidManifestPath)
        },
        {
          message: /\[TEARDOWN GUARD\] O manifesto não possui um runId válido/
        }
      )

      // 2. Reconciliação deve ser imediatamente bloqueada pela guarda estrita de runId
      await assert.rejects(
        async () => {
          await reconcileOrphanedFixtures(mockSupabase, false, invalidManifestPath)
        },
        {
          message: /\[RECONCILE GUARD\] O manifesto não possui um runId válido/
        }
      )

      // 3. Garantia de integridade: zero exclusões
      assert.equal(mockSupabase.state.deletedProducts.length, 0, 'Zero produtos excluídos')
      assert.equal(mockSupabase.state.deletedPrices.length, 0, 'Zero preços excluídos')
    } finally {
      if (fs.existsSync(invalidManifestPath)) fs.unlinkSync(invalidManifestPath)
    }
  })
})
