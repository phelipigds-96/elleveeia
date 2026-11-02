import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { resolveProductPrice } from './pricing.ts'
import { resetInMemoryDb, setInMemoryPrices } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 6.3 — Correção Determinística e Segura da Precificação', () => {
  const companyId = '00000000-0000-0000-0000-000000000001'
  const productId = 'prod-test-0001'

  beforeEach(() => {
    resetInMemoryDb()
  })

  // 1. Uma unidade com preço retail e club concorrentes
  it('1. Uma unidade com retail e club concorrentes deve selecionar retail e NUNCA club', async () => {
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
        price: 36.00,
        price_type: 'club',
        min_quantity: 1,
        active: true
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 1
    })

    assert.strictEqual(result.unitPrice, 38.50, 'Deve selecionar preço de varejo (38.50), não clube')
    assert.strictEqual(result.priceType, 'retail')
    assert.strictEqual(result.subtotal, 38.50)
  })

  // 2. Quantidade abaixo do mínimo de atacado
  it('2. Quantidade abaixo do lote mínimo de atacado deve selecionar varejo', async () => {
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
        id: 'p-wholesale',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        active: true
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 5 // abaixo de 10
    })

    assert.strictEqual(result.unitPrice, 38.50)
    assert.strictEqual(result.priceType, 'retail')
    assert.strictEqual(result.subtotal, 192.50)
  })

  // 3. Quantidade exatamente igual ao mínimo de atacado
  it('3. Quantidade exatamente igual ao mínimo de atacado deve selecionar atacado', async () => {
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
        id: 'p-wholesale',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        active: true
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 10 // exatamente igual a 10
    })

    assert.strictEqual(result.unitPrice, 34.00)
    assert.strictEqual(result.priceType, 'wholesale')
    assert.strictEqual(result.subtotal, 340.00)
  })

  // 4. Quantidade acima do mínimo de atacado
  it('4. Quantidade acima do mínimo de atacado deve selecionar atacado', async () => {
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
        id: 'p-wholesale',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        active: true
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 15 // acima de 10
    })

    assert.strictEqual(result.unitPrice, 34.00)
    assert.strictEqual(result.priceType, 'wholesale')
    assert.strictEqual(result.subtotal, 510.00)
  })

  // 5. Duas faixas concorrentes da mesma modalidade (Ambiguidade)
  it('5. Duas faixas concorrentes da mesma modalidade com preços distintos deve sinalizar ambiguidade', async () => {
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
        price: 40.00,
        price_type: 'retail',
        min_quantity: 1,
        active: true
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
      (err: any) => {
        assert.match(err.message, /Ambiguidade na precificação/i)
        assert.match(err.message, /múltiplas regras ativas/i)
        return true
      }
    )
  })

  // 6. Produto sem preço de varejo (somente atacado com quantidade suficiente)
  it('6. Produto sem preço de varejo mas com quantidade suficiente de atacado deve ser atendido com atacado', async () => {
    setInMemoryPrices([
      {
        id: 'p-wholesale-only',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        active: true
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 12
    })

    assert.strictEqual(result.unitPrice, 34.00)
    assert.strictEqual(result.priceType, 'wholesale')
    assert.strictEqual(result.subtotal, 408.00)
  })

  // 7. Produto somente com preço de atacado e quantidade insuficiente
  it('7. Produto somente com preço de atacado e quantidade insuficiente deve rejeitar informando o lote mínimo', async () => {
    setInMemoryPrices([
      {
        id: 'p-wholesale-only',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        active: true
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId,
          productId,
          quantity: 2 // insuficiente para atacado
        })
      },
      (err: any) => {
        assert.match(err.message, /não atinge o lote mínimo necessário para compra no atacado/i)
        assert.match(err.message, /mínimo: 10 unidades/i)
        return true
      }
    )
  })

  // 8. Preço de clube solicitado sem elegibilidade confirmada
  it('8. Preço de clube solicitado explicitamente sem elegibilidade comprovada deve ser bloqueado com segurança', async () => {
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
        price: 36.00,
        price_type: 'club',
        min_quantity: 1,
        active: true
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId,
          productId,
          quantity: 1,
          priceType: 'club' // sem isClubEligible
        })
      },
      (err: any) => {
        assert.match(err.message, /requer comprovação de elegibilidade de membro do Clube Sumel/i)
        return true
      }
    )
  })

  // 9. Preço de clube com elegibilidade comprovada
  it('9. Preço de clube com elegibilidade comprovada deve ser aplicado com sucesso', async () => {
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
        price: 36.00,
        price_type: 'club',
        min_quantity: 1,
        active: true
      }
    ])

    const result = await resolveProductPrice({
      companyId,
      productId,
      quantity: 1,
      priceType: 'club',
      isClubEligible: true
    })

    assert.strictEqual(result.unitPrice, 36.00)
    assert.strictEqual(result.priceType, 'club')
    assert.strictEqual(result.subtotal, 36.00)
  })

  // 10. max_quantity respeitado pelo modelo
  it('10. max_quantity deve ser estritamente respeitado nas faixas de quantidade', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail-tier1',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 5,
        active: true
      },
      {
        id: 'p-retail-tier2',
        company_id: companyId,
        product_id: productId,
        price: 37.00,
        price_type: 'retail',
        min_quantity: 6,
        max_quantity: 9,
        active: true
      },
      {
        id: 'p-wholesale',
        company_id: companyId,
        product_id: productId,
        price: 34.00,
        price_type: 'wholesale',
        min_quantity: 10,
        active: true
      }
    ])

    // Quantidade 5 -> Tier 1 (38.50)
    const res5 = await resolveProductPrice({ companyId, productId, quantity: 5 })
    assert.strictEqual(res5.unitPrice, 38.50)
    assert.strictEqual(res5.minQuantity, 1)
    assert.strictEqual(res5.maxQuantity, 5)

    // Quantidade 8 -> Tier 2 (37.00)
    const res8 = await resolveProductPrice({ companyId, productId, quantity: 8 })
    assert.strictEqual(res8.unitPrice, 37.00)
    assert.strictEqual(res8.minQuantity, 6)
    assert.strictEqual(res8.maxQuantity, 9)

    // Quantidade 12 -> Atacado (34.00)
    const res12 = await resolveProductPrice({ companyId, productId, quantity: 12 })
    assert.strictEqual(res12.unitPrice, 34.00)
    assert.strictEqual(res12.priceType, 'wholesale')

    // Se configurado apenas varejo com max_quantity: 5 e pedir 7 sem atacado:
    setInMemoryPrices([
      {
        id: 'p-retail-limited',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 5,
        active: true
      }
    ])

    await assert.rejects(
      async () => {
        await resolveProductPrice({ companyId, productId, quantity: 7 })
      },
      (err: any) => {
        assert.match(err.message, /excede o limite máximo configurado para varejo \(máximo: 5 unidades\)/i)
        return true
      }
    )
  })

  // 11. Quantidade inválida ou não positiva
  it('11. Quantidade inválida (0, negativa, fracionária ou NaN) deve ser rejeitada imediatamente', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail',
        company_id: companyId,
        product_id: productId,
        price: 38.50,
        price_type: 'retail',
        min_quantity: 1,
        active: true
      }
    ])

    const invalidQuantities = [0, -1, -5, 1.5, 2.7, NaN]

    for (const q of invalidQuantities) {
      await assert.rejects(
        async () => {
          await resolveProductPrice({
            companyId,
            productId,
            quantity: q
          })
        },
        (err: any) => {
          assert.match(err.message, /Quantidade inválida\. Informe um número inteiro maior que zero\./i)
          return true
        }
      )
    }
  })

  // 12. Preservação do cálculo de subtotal e arredondamento monetário
  it('12. Preservação do cálculo de subtotal com arredondamento monetário estrito em centavos', async () => {
    setInMemoryPrices([
      {
        id: 'p-retail-odd',
        company_id: companyId,
        product_id: productId,
        price: 38.33,
        price_type: 'retail',
        min_quantity: 1,
        active: true
      }
    ])

    const res = await resolveProductPrice({
      companyId,
      productId,
      quantity: 3
    })

    // 38.33 * 3 = 114.99 (exato)
    assert.strictEqual(res.unitPrice, 38.33)
    assert.strictEqual(res.quantity, 3)
    assert.strictEqual(res.subtotal, 114.99)

    // Testar com outra precisão monetária (12.45 * 7 = 87.15)
    setInMemoryPrices([
      {
        id: 'p-retail-2',
        company_id: companyId,
        product_id: productId,
        price: 12.45,
        price_type: 'retail',
        min_quantity: 1,
        active: true
      }
    ])

    const res2 = await resolveProductPrice({
      companyId,
      productId,
      quantity: 7
    })

    assert.strictEqual(res2.unitPrice, 12.45)
    assert.strictEqual(res2.quantity, 7)
    assert.strictEqual(res2.subtotal, 87.15)
  })
})
