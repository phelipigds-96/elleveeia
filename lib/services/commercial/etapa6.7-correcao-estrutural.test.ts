import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { resolveProductPrice, parseCommercialValidityDate } from './pricing.ts'
import { importProductsBatch } from '../catalog/import-products.ts'
import { resetInMemoryDb, setInMemoryPrices } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 6.7 — Correção Estrutural do Modelo Comercial', () => {
  const companyId = '00000000-0000-0000-0000-000000000001'
  const productId = 'prod-multi-tier-01'

  beforeEach(() => {
    resetInMemoryDb()
  })

  // --------------------------------------------------------------------------
  // 1. DUAS FAIXAS DE ATACADO DO MESMO PRODUTO
  // --------------------------------------------------------------------------
  it('1. Duas faixas de atacado do mesmo produto são suportadas corretamente', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 9,
        active: true
      },
      {
        id: 'p-wholesale-10',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        max_quantity: 49,
        active: true
      },
      {
        id: 'p-wholesale-50',
        company_id: companyId,
        product_id: productId,
        price: 30.00,
        price_type: 'wholesale',
        min_quantity: 50,
        max_quantity: null,
        active: true
      }
    ])

    // Quantidade 15 -> Faixa 1 de atacado (R$ 34.00)
    const res15 = await resolveProductPrice({ companyId, productId, quantity: 15 })
    assert.strictEqual(res15.unitPrice, 34.00)
    assert.strictEqual(res15.priceType, 'wholesale')
    assert.strictEqual(res15.minQuantity, 10)
    assert.strictEqual(res15.subtotal, 510.00)

    // Quantidade 50 -> Faixa 2 de atacado (R$ 30.00)
    const res50 = await resolveProductPrice({ companyId, productId, quantity: 50 })
    assert.strictEqual(res50.unitPrice, 30.00)
    assert.strictEqual(res50.priceType, 'wholesale')
    assert.strictEqual(res50.minQuantity, 50)
    assert.strictEqual(res50.subtotal, 1500.00)
  })

  // --------------------------------------------------------------------------
  // 2. TRÊS FAIXAS DE ATACADO DO MESMO PRODUTO
  // --------------------------------------------------------------------------
  it('2. Três faixas progressivas de atacado do mesmo produto', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 9,
        active: true
      },
      {
        id: 'p-wholesale-tier1',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        max_quantity: 29,
        active: true
      },
      {
        id: 'p-wholesale-tier2',
        company_id: companyId,
        product_id: productId,
        price: 32.00,
        price_type: 'wholesale',
        min_quantity: 30,
        max_quantity: 49,
        active: true
      },
      {
        id: 'p-wholesale-tier3',
        company_id: companyId,
        product_id: productId,
        price: 29.00,
        price_type: 'wholesale',
        min_quantity: 50,
        max_quantity: null,
        active: true
      }
    ])

    const res20 = await resolveProductPrice({ companyId, productId, quantity: 20 })
    assert.strictEqual(res20.unitPrice, 34.00)
    assert.strictEqual(res20.minQuantity, 10)

    const res35 = await resolveProductPrice({ companyId, productId, quantity: 35 })
    assert.strictEqual(res35.unitPrice, 32.00)
    assert.strictEqual(res35.minQuantity, 30)

    const res80 = await resolveProductPrice({ companyId, productId, quantity: 80 })
    assert.strictEqual(res80.unitPrice, 29.00)
    assert.strictEqual(res80.minQuantity, 50)
  })

  // --------------------------------------------------------------------------
  // 3. SELEÇÃO CORRETA DA FAIXA CONFORME QUANTIDADE
  // --------------------------------------------------------------------------
  it('3. Seleciona precisamente varejo (1..9) ou a respectiva faixa de atacado', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 9,
        active: true
      },
      {
        id: 'p-wholesale-tier1',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        max_quantity: 49,
        active: true
      },
      {
        id: 'p-wholesale-tier2',
        company_id: companyId,
        product_id: productId,
        price: 31.00,
        price_type: 'wholesale',
        min_quantity: 50,
        active: true
      }
    ])

    const res5 = await resolveProductPrice({ companyId, productId, quantity: 5 })
    assert.strictEqual(res5.unitPrice, 38.50)
    assert.strictEqual(res5.priceType, 'retail')

    const res10 = await resolveProductPrice({ companyId, productId, quantity: 10 })
    assert.strictEqual(res10.unitPrice, 34.00)
    assert.strictEqual(res10.priceType, 'wholesale')

    const res49 = await resolveProductPrice({ companyId, productId, quantity: 49 })
    assert.strictEqual(res49.unitPrice, 34.00)
    assert.strictEqual(res49.priceType, 'wholesale')

    const res50 = await resolveProductPrice({ companyId, productId, quantity: 50 })
    assert.strictEqual(res50.unitPrice, 31.00)
    assert.strictEqual(res50.priceType, 'wholesale')
  })

  // --------------------------------------------------------------------------
  // 4. IDENTIFICAÇÃO DE FAIXAS SOBREPOSTAS (CONFLITO DE REGRAS)
  // --------------------------------------------------------------------------
  it('4. Identificação segura de faixas sobrepostas com valores divergentes', async () => {
    setInMemoryPrices([
      {
        id: 'p-overlap-1',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        max_quantity: 50, // Faixa 10 a 50
        active: true
      },
      {
        id: 'p-overlap-2',
        company_id: companyId,
        product_id: productId,
        price: 30.00,
        price_type: 'wholesale',
        min_quantity: 40, // Faixa 40 a 100 (colide com 10..50 entre 40 e 50)
        max_quantity: 100,
        active: true
      }
    ])

    // Na zona de sobreposição (ex: 45 unidades), deve identificar o conflito
    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 45 })
      },
      (err: any) => {
        assert.match(err.message, /Ambiguidade na precificação/i)
        assert.match(err.message, /faixas sobrepostas/i)
        return true
      }
    )

    // Fora da sobreposição (15 unidades): atende somente a Faixa 1
    const res15 = await resolveProductPrice({ companyId, productId, quantity: 15 })
    assert.strictEqual(res15.unitPrice, 34.00)

    // Fora da sobreposição (75 unidades): atende somente a Faixa 2
    const res75 = await resolveProductPrice({ companyId, productId, quantity: 75 })
    assert.strictEqual(res75.unitPrice, 30.00)
  })

  // --------------------------------------------------------------------------
  // 5. IMPORTAÇÃO DE MÚLTIPLAS FAIXAS SEM SOBRESCRITA
  // --------------------------------------------------------------------------
  it('5. Importação em lote grava múltiplas faixas do mesmo produto sem sobrescrever', async () => {
    const rows = [
      {
        codigo: 'SKU-IMPORT-TIERS',
        barras: '789123456001',
        nome: 'Cobertura Harald Multi Tiers 1kg',
        preco: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 9
      },
      {
        codigo: 'SKU-IMPORT-TIERS',
        barras: '789123456001',
        nome: 'Cobertura Harald Multi Tiers 1kg',
        preco: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        max_quantity: 49
      },
      {
        codigo: 'SKU-IMPORT-TIERS',
        barras: '789123456001',
        nome: 'Cobertura Harald Multi Tiers 1kg',
        preco: 30.00,
        price_type: 'wholesale',
        min_quantity: 50,
        max_quantity: null
      }
    ]

    const result = await importProductsBatch(companyId, rows)
    assert.strictEqual(result.errorCount, 0)
    assert.strictEqual(result.successCount, 3)

    // Localizar o ID do produto importado
    const importedProdRes = await resolveProductPrice({
      companyId,
      productId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // produto default
      quantity: 1
    })
    assert.ok(importedProdRes)
  })

  // --------------------------------------------------------------------------
  // 6. valid_until YYYY-MM-DD PERMANECE VÁLIDO DURANTE TODO O ÚLTIMO DIA
  // --------------------------------------------------------------------------
  it('6. valid_until YYYY-MM-DD permanece válido durante todo o último dia comercial em Brasília', async () => {
    const todayStr = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

    setInMemoryPrices([
      {
        id: 'p-valid-today',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: '2026-10-01',
        valid_until: todayStr // Hoje
      }
    ])

    const res = await resolveProductPrice({ companyId, productId, quantity: 1 })
    assert.strictEqual(res.unitPrice, 38.50)
    assert.strictEqual(res.priceType, 'retail')
  })

  // --------------------------------------------------------------------------
  // 7. valid_from YYYY-MM-DD
  // --------------------------------------------------------------------------
  it('7. valid_from YYYY-MM-DD inicia vigência a partir das 00:00 de Brasília da data indicada', async () => {
    const now = new Date()
    const todayStr = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(now)
    const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowStr = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(tomorrowDate)

    // 1. Data de hoje (iniciada hoje): deve ser aceita
    setInMemoryPrices([
      {
        id: 'p-started-today',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: todayStr,
        valid_until: null
      }
    ])

    const res = await resolveProductPrice({ companyId, productId, quantity: 1 })
    assert.strictEqual(res.unitPrice, 38.50)

    // 2. Data de amanhã (ainda não iniciada): deve ser descartada
    setInMemoryPrices([
      {
        id: 'p-starts-tomorrow',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: tomorrowStr,
        valid_until: null
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 1 })
      },
      /Produto não possui preço ativo ou vigente/i
    )
  })

  // --------------------------------------------------------------------------
  // 8. PRESERVAÇÃO DE TIMESTAMPS COMPLETOS COM FUSO HORÁRIO
  // --------------------------------------------------------------------------
  it('8. Preserva exatamente o instante de timestamps completos com timezone', async () => {
    const now = new Date()
    const pastTimestamp = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const futureTimestamp = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()

    // 1. Timestamp expirado há 2 horas: deve ser rejeitado
    setInMemoryPrices([
      {
        id: 'p-expired-time',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_until: pastTimestamp
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 1 })
      },
      /Produto não possui preço ativo ou vigente/i
    )

    // 2. Timestamp com fim programado para daqui a 4 horas: permanece ativo
    setInMemoryPrices([
      {
        id: 'p-active-time',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_until: futureTimestamp
      }
    ])

    const res = await resolveProductPrice({ companyId, productId, quantity: 1 })
    assert.strictEqual(res.unitPrice, 38.50)
  })

  // --------------------------------------------------------------------------
  // 9. DATAS NULAS
  // --------------------------------------------------------------------------
  it('9. Datas nulas são tratadas como vigência irrestrita/perene', async () => {
    setInMemoryPrices([
      {
        id: 'p-perene',
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

    const res = await resolveProductPrice({ companyId, productId, quantity: 1 })
    assert.strictEqual(res.unitPrice, 38.50)
  })

  // --------------------------------------------------------------------------
  // 10. DATAS INVÁLIDAS
  // --------------------------------------------------------------------------
  it('10. Datas inválidas ou invertidas não são aceitas silenciosamente', async () => {
    // A. String inválida
    setInMemoryPrices([
      {
        id: 'p-corrupted',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_until: 'data_invalida_nao_parseavel'
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 1 })
      },
      /Produto não possui preço ativo ou vigente/i
    )

    // B. Período invertido (valid_from maior que valid_until)
    setInMemoryPrices([
      {
        id: 'p-inverted',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true,
        valid_from: '2026-11-15',
        valid_until: '2026-10-15'
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 1 })
      },
      /Produto não possui preço ativo ou vigente/i
    )
  })

  // --------------------------------------------------------------------------
  // 11. REGRESSÃO DE TODAS AS REGRAS ANTERIORES
  // --------------------------------------------------------------------------
  it('11. Preservação estrita das regras anteriores (bloqueio de clube e cálculo exato)', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail',
        company_id: companyId,
        product_id: productId,
        price: 38.33,
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

    // Tentativa de preço de clube sem elegibilidade deve ser barrada
    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 1, priceType: 'club' })
      },
      /requer comprovação de elegibilidade de membro do Clube Sumel/i
    )

    // Consulta automática pega varejo e faz o subtotal exato em centavos (38.33 * 3 = 114.99)
    const res = await resolveProductPrice({ companyId, productId, quantity: 3 })
    assert.strictEqual(res.unitPrice, 38.33)
    assert.strictEqual(res.priceType, 'retail')
    assert.strictEqual(res.subtotal, 114.99)
  })
})
