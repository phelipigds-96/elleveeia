import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { resolveProductPrice } from './pricing.ts'
import { resetInMemoryDb, setInMemoryPrices } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 6.6 — Auditoria e Reprodução de Vigências de Preço', () => {
  const companyId = '00000000-0000-0000-0000-000000000001'
  const productId = 'prod-vigencia-test'

  beforeEach(() => {
    resetInMemoryDb()
  })

  // 1. VALIDAÇÃO DA CORREÇÃO: Formato de Data Pura YYYY-MM-DD
  it('1. Correção confirmada: valid_until como "YYYY-MM-DD" com a data de hoje permanece ativo durante todo o dia', async () => {
    // Data de hoje no fuso de Brasília recebida do ERP como string de data pura YYYY-MM-DD
    const todayStr = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

    setInMemoryPrices([
      {
        id: 'p-today-dateonly',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: '2026-10-01',
        valid_until: todayStr // Intenção comercial: válido até o final do dia de hoje
      }
    ])

    // Com a correção da Etapa 6.7: valid_until 'YYYY-MM-DD' é interpretado como 23:59:59.999-03:00 (Brasília),
    // portanto permanece ativo durante o expediente comercial do dia de hoje!
    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 1
    })

    assert.strictEqual(result.unitPrice, 38.50)
    assert.strictEqual(result.priceType, 'retail')
    assert.strictEqual(result.subtotal, 38.50)
  })

  // 2. COMPORTAMENTO QUANDO valid_until POSSUI HORÁRIO COMPLETO COM TIMEZONE
  it('2. valid_until com timestamp completo no final do dia (23:59:59-03:00) permanece ativo', async () => {
    const todayStr = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

    setInMemoryPrices([
      {
        id: 'p-today-endofday',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: '2026-10-01T00:00:00-03:00',
        valid_until: `${todayStr}T23:59:59-03:00` // Final do dia no horário de Brasília
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 1
    })

    assert.strictEqual(result.unitPrice, 38.50)
    assert.strictEqual(result.priceType, 'retail')
  })

  // 3. COMPORTAMENTO QUANDO AS VIGÊNCIAS SÃO NULAS (PREÇOS PERENES)
  it('3. Preços com valid_from e valid_until nulos são considerados perenes e permanecem ativos', async () => {
    setInMemoryPrices([
      {
        id: 'p-no-validity',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: null,
        valid_until: null
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 1
    })

    assert.strictEqual(result.unitPrice, 38.50)
  })

  // 4. PREÇO FUTURO (valid_from maior que now)
  it('4. Preço com valid_from no futuro é descartado corretamente', async () => {
    setInMemoryPrices([
      {
        id: 'p-future',
        company_id: companyId,
        product_id: productId,
        price: 35.00,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: '2026-11-10T00:00:00-03:00',
        valid_until: null
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId,
          productId,
          quantity: 1
        })
      },
      /Produto não possui preço ativo ou vigente/i
    )
  })

  // 5. PREÇO PASSADO (valid_until menor que now)
  it('5. Preço com valid_until no passado é descartado corretamente', async () => {
    setInMemoryPrices([
      {
        id: 'p-expired',
        company_id: companyId,
        product_id: productId,
        price: 35.00,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: null,
        valid_until: '2026-10-15T23:59:59-03:00'
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId,
          productId,
          quantity: 1
        })
      },
      /Produto não possui preço ativo ou vigente/i
    )
  })
})
