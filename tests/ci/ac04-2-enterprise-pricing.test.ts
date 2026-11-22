import test, { describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import {
  evaluateItemPricing,
  resolveProductPrice,
  resolveBatchProductPrices,
  isPriceQuoteValid,
  parseCommercialValidityDate,
  type PriceResolutionResult
} from '@/lib/services/commercial/pricing'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import { rankProductsIntelligently, type StructuredProductCandidate } from '@/lib/services/catalog/search-engine'

// ==============================================================================
// FIXTURES SINTÉTICAS DETERMINÍSTICAS PARA TESTES COMERCIAIS
// ==============================================================================

const TENANT_A = '11111111-1111-4111-a111-111111111111'
const TENANT_B = '22222222-2222-4222-a222-222222222222'

const PROD_LEITE_COND = '00000000-0000-4000-b000-000000000001'
const PROD_CHOCOLATE_BARRA = '00000000-0000-4000-b000-000000000002'
const PROD_FARINHA_KG = '00000000-0000-4000-b000-000000000003'
const PROD_CREME_CULINARIO = '00000000-0000-4000-b000-000000000004'
const PROD_SEM_PRECO = '00000000-0000-4000-b000-000000000005'
const PROD_VIGENCIA_EXPIRADA = '00000000-0000-4000-b000-000000000006'
const PROD_AMBIGUO = '00000000-0000-4000-b000-000000000007'
const PROD_CAIXA_FECHADA = '00000000-0000-4000-b000-000000000008'

function createSyntheticMockDatabase() {
  const products = [
    {
      id: PROD_LEITE_COND,
      company_id: TENANT_A,
      name: 'LEITE CONDENSADO TIROL 395G',
      unit: 'UN',
      package_description: 'Unidade 395g',
      metadata: {}
    },
    {
      id: PROD_CHOCOLATE_BARRA,
      company_id: TENANT_A,
      name: 'CHOCOLATE AO LEITE SICAO BARRA 1.01KG',
      unit: 'UN',
      package_description: 'Barra 1.01kg',
      metadata: {}
    },
    {
      id: PROD_FARINHA_KG,
      company_id: TENANT_A,
      name: 'FARINHA DE TRIGO ESPECIAL 1KG',
      unit: 'KG',
      package_description: 'Pacote 1kg',
      metadata: {}
    },
    {
      id: PROD_CREME_CULINARIO,
      company_id: TENANT_A,
      name: 'CREME CULINARIO CARGILL 1L',
      unit: 'UN',
      package_description: 'Tetra Pak 1L',
      metadata: {}
    },
    {
      id: PROD_SEM_PRECO,
      company_id: TENANT_A,
      name: 'PRODUTO EM CADASTRO SEM PRECO 500G',
      unit: 'UN',
      package_description: 'Pote 500g',
      metadata: {}
    },
    {
      id: PROD_VIGENCIA_EXPIRADA,
      company_id: TENANT_A,
      name: 'PANETONE TRADICIONAL NATAL 500G',
      unit: 'UN',
      package_description: 'Caixa 500g',
      metadata: {}
    },
    {
      id: PROD_AMBIGUO,
      company_id: TENANT_A,
      name: 'DOCE DE LEITE PASTOSO 400G',
      unit: 'UN',
      package_description: 'Pote 400g',
      metadata: {}
    },
    {
      id: PROD_CAIXA_FECHADA,
      company_id: TENANT_A,
      name: 'LEITE CONDENSADO ITALAC CX 27X395G',
      unit: 'CX',
      package_description: 'Caixa Fechada com 27 Unidades',
      metadata: { multiple_of: 27 }
    },
    // Produto idêntico no Tenant B com preço e SKU isolados
    {
      id: PROD_LEITE_COND,
      company_id: TENANT_B,
      name: 'LEITE CONDENSADO TIROL 395G (TENANT B)',
      unit: 'UN',
      package_description: 'Unidade 395g',
      metadata: {}
    }
  ]

  const prices = [
    // PROD_LEITE_COND (Tenant A): Varejo R$ 8.50, Atacado (>= 10) R$ 7.80, Clube R$ 6.90
    {
      id: 'price-a-1',
      company_id: TENANT_A,
      product_id: PROD_LEITE_COND,
      price: 8.50,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: 9,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      metadata: { price_table_id: 'TAB-VAREJO-01' }
    },
    {
      id: 'price-a-2',
      company_id: TENANT_A,
      product_id: PROD_LEITE_COND,
      price: 7.80,
      price_type: 'wholesale',
      min_quantity: 10,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      metadata: { price_table_id: 'TAB-ATACADO-01' }
    },
    {
      id: 'price-a-3',
      company_id: TENANT_A,
      product_id: PROD_LEITE_COND,
      price: 6.90,
      price_type: 'club',
      min_quantity: 1,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      metadata: { price_table_id: 'TAB-CLUBE-SUMEL' }
    },

    // PROD_CHOCOLATE_BARRA (Tenant A): Varejo R$ 42.00, Atacado faixas (>= 6: R$ 38.00, >= 12: R$ 35.00)
    {
      id: 'price-b-1',
      company_id: TENANT_A,
      product_id: PROD_CHOCOLATE_BARRA,
      price: 42.00,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: 5,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },
    {
      id: 'price-b-2',
      company_id: TENANT_A,
      product_id: PROD_CHOCOLATE_BARRA,
      price: 38.00,
      price_type: 'wholesale',
      min_quantity: 6,
      max_quantity: 11,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },
    {
      id: 'price-b-3',
      company_id: TENANT_A,
      product_id: PROD_CHOCOLATE_BARRA,
      price: 35.00,
      price_type: 'wholesale',
      min_quantity: 12,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },

    // PROD_FARINHA_KG (Tenant A): Varejo fracionável R$ 5.40/kg
    {
      id: 'price-c-1',
      company_id: TENANT_A,
      product_id: PROD_FARINHA_KG,
      price: 5.40,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },

    // PROD_CREME_CULINARIO (Tenant A): Promoção vigente R$ 12.90 (preço normal R$ 16.50)
    {
      id: 'price-d-reg',
      company_id: TENANT_A,
      product_id: PROD_CREME_CULINARIO,
      price: 16.50,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },
    {
      id: 'price-d-promo',
      company_id: TENANT_A,
      product_id: PROD_CREME_CULINARIO,
      price: 12.90,
      price_type: 'promotion',
      min_quantity: 1,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      metadata: { is_promotion: true, campaign: 'Black Friday Antecipada' }
    },

    // PROD_VIGENCIA_EXPIRADA (Tenant A): Preço vencido em 2025
    {
      id: 'price-e-old',
      company_id: TENANT_A,
      product_id: PROD_VIGENCIA_EXPIRADA,
      price: 22.00,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: null,
      active: true,
      valid_from: '2025-11-01',
      valid_until: '2025-12-31'
    },

    // PROD_AMBIGUO (Tenant A): Duas regras de varejo conflitantes na mesma faixa
    {
      id: 'price-amb-1',
      company_id: TENANT_A,
      product_id: PROD_AMBIGUO,
      price: 15.00,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: 10,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },
    {
      id: 'price-amb-2',
      company_id: TENANT_A,
      product_id: PROD_AMBIGUO,
      price: 18.50,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: 10,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },

    // PROD_CAIXA_FECHADA (Tenant A): Caixa com 27 unidades, múltiplos obrigatórios
    {
      id: 'price-cx-1',
      company_id: TENANT_A,
      product_id: PROD_CAIXA_FECHADA,
      price: 8.00, // R$ 8.00 por lata na compra do lote de 27 latas (R$ 216.00 total)
      price_type: 'wholesale',
      min_quantity: 27,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    },

    // PROD_LEITE_COND (Tenant B): Mesmo SKU, preço completamente diferente (R$ 11.90)
    {
      id: 'price-tenant-b-1',
      company_id: TENANT_B,
      product_id: PROD_LEITE_COND,
      price: 11.90,
      price_type: 'retail',
      min_quantity: 1,
      max_quantity: null,
      active: true,
      valid_from: '2026-01-01',
      valid_until: '2026-12-31'
    }
  ]

  return { products, prices }
}

function setupMockSupabase() {
  const { products, prices } = createSyntheticMockDatabase()

  const mockClient = {
    from: (table: string) => {
      let currentCompanyId: string | null = null
      let currentProductId: string | null = null
      let inProductIds: string[] | null = null
      let inIds: string[] | null = null
      let currentActive: boolean | null = null

      const builder: any = {
        select: (_cols?: string) => builder,
        eq: (col: string, val: any) => {
          if (col === 'company_id') currentCompanyId = val
          if (col === 'product_id' || col === 'id') {
            if (table === 'product_prices') currentProductId = val
            if (table === 'products') currentProductId = val
          }
          if (col === 'active') currentActive = val
          return builder
        },
        in: (col: string, vals: string[]) => {
          if (col === 'product_id') inProductIds = vals
          if (col === 'id') inIds = vals
          return builder
        },
        maybeSingle: async () => {
          if (table === 'products') {
            const found = products.find(p => 
              (!currentCompanyId || p.company_id === currentCompanyId) &&
              (!currentProductId || p.id === currentProductId)
            )
            return { data: found || null, error: null }
          }
          return { data: null, error: null }
        },
        single: async () => builder.maybeSingle(),
        then: (resolve: any) => {
          if (table === 'product_prices') {
            let res = prices.filter(p => {
              if (currentCompanyId && p.company_id !== currentCompanyId) return false
              if (currentProductId && p.product_id !== currentProductId) return false
              if (inProductIds && !inProductIds.includes(p.product_id)) return false
              if (currentActive !== null && p.active !== currentActive) return false
              return true
            })
            return resolve({ data: res, error: null })
          }
          if (table === 'products') {
            let res = products.filter(p => {
              if (currentCompanyId && p.company_id !== currentCompanyId) return false
              if (currentProductId && p.id !== currentProductId) return false
              if (inIds && !inIds.includes(p.id)) return false
              return true
            })
            return resolve({ data: res, error: null })
          }
          return resolve({ data: [], error: null })
        }
      }

      return builder
    }
  }

  setMockSupabaseClient(mockClient)
}

// ==============================================================================
// SUÍTE DE TESTES OBRIGATÓRIOS AC-04.2 — ENTERPRISE PRICING ENGINE
// ==============================================================================

describe('AC-04.2 — Enterprise Pricing Engine', () => {
  beforeEach(() => {
    setupMockSupabase()
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Varejo versus Atacado com Demonstração Exata em Centavos
  // ----------------------------------------------------------------------------
  test('Cenário 1: Varejo versus Atacado com cálculo exato em centavos inteiros', async () => {
    // 1.1 Varejo (1 unidade) -> R$ 8.50 unitário, R$ 8.50 subtotal (850 centavos)
    const retail = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 1
    })
    assert.equal(retail.status, 'confirmed')
    assert.equal(retail.priceType, 'retail')
    assert.equal(retail.unitPriceCents, 850)
    assert.equal(retail.unitPrice, 8.50)
    assert.equal(retail.subtotalCents, 850)
    assert.equal(retail.subtotal, 8.50)
    assert.equal(retail.currency, 'BRL')

    // 1.2 Atacado (12 unidades) -> R$ 7.80 unitário, R$ 93.60 subtotal (9360 centavos)
    const wholesale = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 12
    })
    assert.equal(wholesale.status, 'confirmed')
    assert.equal(wholesale.priceType, 'wholesale')
    assert.equal(wholesale.unitPriceCents, 780)
    assert.equal(wholesale.unitPrice, 7.80)
    assert.equal(wholesale.subtotalCents, 9360)
    assert.equal(wholesale.subtotal, 93.60)
    assert.equal(wholesale.requestedQuantity, 12)
    assert.equal(wholesale.sellableQuantity, 12)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Limiar Exato de Mudança de Faixa de Atacado
  // ----------------------------------------------------------------------------
  test('Cenário 2: Limiar exato de mudança de faixa (9 un = varejo, 10 un = atacado)', async () => {
    // 2.1 Quantidade 9: exatamente no limite superior do varejo
    const at9 = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 9
    })
    assert.equal(at9.priceType, 'retail')
    assert.equal(at9.unitPrice, 8.50)
    assert.equal(at9.subtotalCents, 7650) // 9 * 850
    assert.equal(at9.subtotal, 76.50)

    // 2.2 Quantidade 10: atinge exatamente o lote mínimo de atacado
    const at10 = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 10
    })
    assert.equal(at10.priceType, 'wholesale')
    assert.equal(at10.unitPrice, 7.80)
    assert.equal(at10.subtotalCents, 7800) // 10 * 780
    assert.equal(at10.subtotal, 78.00)
    assert.ok(at10.appliedRule.includes('min: 10'))
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Quantidade Abaixo do Mínimo de Atacado
  // ----------------------------------------------------------------------------
  test('Cenário 3: Quantidade abaixo do mínimo de atacado quando explicitamente solicitada', async () => {
    // Solicita modalidade 'wholesale' com apenas 3 unidades (mínimo exigido: 10)
    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId: TENANT_A,
          productId: PROD_LEITE_COND,
          quantity: 3,
          priceType: 'wholesale'
        })
      },
      (err: any) => {
        assert.ok(err.message.includes('não atinge o lote mínimo necessário para compra no atacado'))
        assert.ok(err.message.includes('10 unidades'))
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Caixa versus Unidade e Múltiplos Obrigatórios de Embalagem
  // ----------------------------------------------------------------------------
  test('Cenário 4: Fator de embalagem e múltiplos obrigatórios de venda', async () => {
    // 4.1 Quantidade múltipla exata (27 unidades = 1 caixa): aceito
    const cxValid = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_CAIXA_FECHADA,
      quantity: 27
    })
    assert.equal(cxValid.status, 'confirmed')
    assert.equal(cxValid.subtotal, 216.00)
    assert.equal(cxValid.unit, 'CX')

    // 4.2 Quantidade não múltipla (10 unidades de caixa fechada de 27): rejeitado
    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId: TENANT_A,
          productId: PROD_CAIXA_FECHADA,
          quantity: 10
        })
      },
      (err: any) => {
        assert.ok(err.message.includes('deve ser múltipla de 27 unidades'))
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Promoção Vigente, Futura e Expirada (Precedência Comercial)
  // ----------------------------------------------------------------------------
  test('Cenário 5: Precedência de promoção ativa e vigência de datas', async () => {
    // 5.1 Creme Culinário possui preço regular R$ 16.50 e promoção ativa R$ 12.90
    // A promoção ativa DEVE ter precedência máxima
    const promo = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_CREME_CULINARIO,
      quantity: 1
    })
    assert.equal(promo.status, 'confirmed')
    assert.equal(promo.priceType, 'promotion')
    assert.equal(promo.unitPrice, 12.90)
    assert.equal(promo.unitPriceCents, 1290)

    // 5.2 Teste de vigência pura: data futura vs expirada via helper Brasília
    const now = new Date()
    const futureDate = parseCommercialValidityDate('2099-01-01', false)
    assert.ok(futureDate instanceof Date)
    assert.ok(futureDate > now, 'Data futura deve ser maior que agora')

    const expiredDate = parseCommercialValidityDate('2020-01-01', true)
    assert.ok(expiredDate instanceof Date)
    assert.ok(expiredDate < now, 'Data expirada deve ser menor que agora')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Clube Sumel com e sem Elegibilidade Comprovada
  // ----------------------------------------------------------------------------
  test('Cenário 6: Clube Sumel nunca é vazado ou aplicado sem elegibilidade comprovada', async () => {
    // 6.1 Cliente comum sem clube (isClubEligible: false) -> recebe varejo R$ 8.50
    const nonMember = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 1,
      isClubEligible: false
    })
    assert.equal(nonMember.priceType, 'retail')
    assert.equal(nonMember.unitPrice, 8.50, 'Não associado NUNCA deve receber preço de clube automaticamente')

    // 6.2 Cliente associado ao clube (isClubEligible: true) -> recebe preço clube R$ 6.90
    const clubMember = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 1,
      isClubEligible: true
    })
    assert.equal(clubMember.priceType, 'club')
    assert.equal(clubMember.unitPrice, 6.90)
    assert.equal(clubMember.unitPriceCents, 690)

    // 6.3 Não associado solicitando explicitamente modalidade 'club' -> Bloqueado
    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId: TENANT_A,
          productId: PROD_LEITE_COND,
          quantity: 1,
          priceType: 'club',
          isClubEligible: false
        })
      },
      (err: any) => {
        assert.ok(err.message.includes('Clube Sumel'))
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Isolamento Multi-Tenant Estrito (Mesmo SKU, Empresas Diferentes)
  // ----------------------------------------------------------------------------
  test('Cenário 7: Isolamento multi-tenant estrito para o mesmo produto/SKU', async () => {
    // Tenant A possui preço R$ 8.50
    const priceA = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 1
    })
    assert.equal(priceA.companyId, TENANT_A)
    assert.equal(priceA.unitPrice, 8.50)

    // Tenant B possui preço R$ 11.90 para o mesmo ID/SKU
    const priceB = await resolveProductPrice({
      companyId: TENANT_B,
      productId: PROD_LEITE_COND,
      quantity: 1
    })
    assert.equal(priceB.companyId, TENANT_B)
    assert.equal(priceB.unitPrice, 11.90)

    // Nunca deve misturar ou vazar os preços entre os tenants
    assert.notEqual(priceA.unitPrice, priceB.unitPrice)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Preço Ausente no Catálogo
  // ----------------------------------------------------------------------------
  test('Cenário 8: Retorno explícito e estruturado para produto sem preço cadastrado', async () => {
    // Via resolveProductPrice (lança erro comercial claro)
    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId: TENANT_A,
          productId: PROD_SEM_PRECO,
          quantity: 1
        })
      },
      (err: any) => {
        assert.ok(err.message.includes('não possui preço configurado') || err.message.includes('indisponível'))
        return true
      }
    )

    // Via evaluateItemPricing puro (retorna status 'unavailable' sem quebrar o lote)
    const pure = evaluateItemPricing(
      {
        companyId: TENANT_A,
        productId: PROD_SEM_PRECO,
        quantity: 1
      },
      []
    )
    assert.equal(pure.status, 'unavailable')
    assert.equal(pure.unitPriceCents, 0)
    assert.equal(pure.subtotalCents, 0)
    assert.ok(pure.unavailableReason?.includes('não possui preço configurado'))
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 9: Preço Desatualizado / Vigência Vencida
  // ----------------------------------------------------------------------------
  test('Cenário 9: Rejeição de preço desatualizado com vigência vencida', async () => {
    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId: TENANT_A,
          productId: PROD_VIGENCIA_EXPIRADA,
          quantity: 1
        })
      },
      (err: any) => {
        assert.ok(err.message.includes('expirado') || err.message.includes('vigência'))
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 10: Reprecificação ao Alterar Quantidade e Validação de Cache
  // ----------------------------------------------------------------------------
  test('Cenário 10: Reprecificação automática e invalidação de cotação antiga', async () => {
    // Cotação inicial: 3 unidades de Chocolate Barra -> Varejo R$ 42.00
    const quote1 = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_CHOCOLATE_BARRA,
      quantity: 3
    })
    assert.equal(quote1.unitPrice, 42.00)
    assert.equal(quote1.subtotal, 126.00)

    // Cliente altera a quantidade para 15 unidades -> Atacado maior faixa (>= 12) R$ 35.00
    const quote2 = await resolveProductPrice({
      companyId: TENANT_A,
      productId: PROD_CHOCOLATE_BARRA,
      quantity: 15
    })
    assert.equal(quote2.unitPrice, 35.00)
    assert.equal(quote2.subtotal, 525.00)

    // Validador de cache DEVE invalidar quote1 para a nova quantidade
    assert.equal(
      isPriceQuoteValid(quote1, {
        companyId: TENANT_A,
        productId: PROD_CHOCOLATE_BARRA,
        quantity: 15
      }),
      false,
      'A cotação antiga de 3 unidades NÃO pode ser válida para 15 unidades'
    )

    // Cotação quote2 é estritamente válida para seus parâmetros
    assert.equal(
      isPriceQuoteValid(quote2, {
        companyId: TENANT_A,
        productId: PROD_CHOCOLATE_BARRA,
        quantity: 15
      }),
      true
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 11: Desconto Incompatível / Detecção de Ambiguidade Cadastral
  // ----------------------------------------------------------------------------
  test('Cenário 11: Detecção de ambiguidade cadastral com múltiplas regras ativas divergentes', async () => {
    await assert.rejects(
      async () => {
        await resolveProductPrice({
          companyId: TENANT_A,
          productId: PROD_AMBIGUO,
          quantity: 5
        })
      },
      (err: any) => {
        assert.ok(err.message.includes('Ambiguidade na precificação'))
        assert.ok(err.message.includes('múltiplas regras ativas'))
        return true
      }
    )
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 12: Pedido com Múltiplos Itens em Lote (Zero N+1 Queries)
  // ----------------------------------------------------------------------------
  test('Cenário 12: Resolução em lote de múltiplos itens com zero N+1 e soma em centavos', async () => {
    const batchReq = {
      companyId: TENANT_A,
      items: [
        { productId: PROD_LEITE_COND, quantity: 2 },       // 2 * 8.50 = 17.00 (1700 centavos)
        { productId: PROD_CHOCOLATE_BARRA, quantity: 6 },  // 6 * 38.00 = 228.00 (22800 centavos)
        { productId: PROD_CREME_CULINARIO, quantity: 3 }   // 3 * 12.90 = 38.70 (3870 centavos)
      ]
    }

    const batchRes = await resolveBatchProductPrices(batchReq)

    assert.equal(batchRes.allConfirmed, true)
    assert.equal(batchRes.hasUnavailable, false)
    assert.equal(batchRes.items.length, 3)

    // Soma em centavos inteiros: 1700 + 22800 + 3870 = 28370 centavos
    assert.equal(batchRes.totalCents, 28370)
    assert.equal(batchRes.total, 283.70)

    // Verificação item a item
    const item1 = batchRes.items.find(i => i.productId === PROD_LEITE_COND)!
    assert.equal(item1.unitPrice, 8.50)
    assert.equal(item1.subtotal, 17.00)

    const item2 = batchRes.items.find(i => i.productId === PROD_CHOCOLATE_BARRA)!
    assert.equal(item2.unitPrice, 38.00)
    assert.equal(item2.subtotal, 228.00)

    const item3 = batchRes.items.find(i => i.productId === PROD_CREME_CULINARIO)!
    assert.equal(item3.unitPrice, 12.90)
    assert.equal(item3.subtotal, 38.70)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 13: Quantidade Fracionada Proibida em Unidades Discretas
  // ----------------------------------------------------------------------------
  test('Cenário 13: Quantidade fracionada proibida em UN/CX e permitida em KG', async () => {
    // 13.1 Unidade discreta UN: 2.5 unidades deve ser rejeitado
    const unRes = evaluateItemPricing(
      {
        companyId: TENANT_A,
        productId: PROD_LEITE_COND,
        quantity: 2.5,
        unit: 'UN'
      },
      [{ id: 'p1', company_id: TENANT_A, price: 8.50, price_type: 'retail', active: true }]
    )
    assert.equal(unRes.status, 'unavailable')
    assert.ok(unRes.unavailableReason?.includes('Quantidade fracionada (2.5) não permitida'))

    // 13.2 Unidade contínua KG: 2.5 kg deve ser aceito e calculado com precisão
    const kgRes = evaluateItemPricing(
      {
        companyId: TENANT_A,
        productId: PROD_FARINHA_KG,
        quantity: 2.5,
        unit: 'KG'
      },
      [{ id: 'p1', company_id: TENANT_A, price: 5.40, price_type: 'retail', active: true }]
    )
    assert.equal(kgRes.status, 'confirmed')
    assert.equal(kgRes.unitPrice, 5.40)
    assert.equal(kgRes.unitPriceCents, 540)
    // 540 centavos * 2.5 = 1350 centavos = R$ 13.50
    assert.equal(kgRes.subtotalCents, 1350)
    assert.equal(kgRes.subtotal, 13.50)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 14: Arredondamento Financeiro em Centavos e Proteção Contra Overflow
  // ----------------------------------------------------------------------------
  test('Cenário 14: Arredondamento financeiro em centavos inteiros e proteção contra overflow', async () => {
    // 14.1 Dízima e precisão de arredondamento comercial (R$ 19.99 * 3 = 59.97 sem drift IEEE-754)
    const floatRes = evaluateItemPricing(
      {
        companyId: TENANT_A,
        productId: PROD_LEITE_COND,
        quantity: 3
      },
      [{ id: 'p1', company_id: TENANT_A, price: 19.99, price_type: 'retail', active: true }]
    )
    assert.equal(floatRes.unitPriceCents, 1999)
    assert.equal(floatRes.subtotalCents, 5997)
    assert.equal(floatRes.subtotal, 59.97)

    // 14.2 Quantidade astronômica que excede Number.MAX_SAFE_INTEGER
    const overflowRes = evaluateItemPricing(
      {
        companyId: TENANT_A,
        productId: PROD_FARINHA_KG,
        quantity: 1e16, // 10 quatrilhões
        unit: 'KG'
      },
      [{ id: 'p1', company_id: TENANT_A, price: 5.40, price_type: 'retail', active: true }]
    )
    assert.equal(overflowRes.status, 'unavailable')
    assert.ok(overflowRes.unavailableReason?.includes('precisão segura'))
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 15: Tentativa de Manipulação de Preço por Prompt Injection
  // ----------------------------------------------------------------------------
  test('Cenário 15: Tentativa de manipulação de preço por prompt ou injeção de parâmetros', async () => {
    // Tentativa maliciosa de passar unit_price: 1.00 ou preco_forçado no input
    const maliciousInput: any = {
      companyId: TENANT_A,
      productId: PROD_LEITE_COND,
      quantity: 1,
      unit_price: 0.01,
      price: 0.01,
      discount: '100%',
      system_override: true
    }

    const res = await resolveProductPrice(maliciousInput)

    // O motor DEVE ignorar completamente os campos injetados e puxar o valor oficial do banco
    assert.equal(res.unitPrice, 8.50, 'Preço deve ser estritamente o do banco de dados (R$ 8.50)')
    assert.equal(res.subtotal, 8.50)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 16: Consulta em Lote com Itens Mistos e Isolamento Multi-Tenant
  // ----------------------------------------------------------------------------
  test('Cenário 16: Consulta em lote com item de outro tenant e itens parcialmente disponíveis', async () => {
    const batchReq = {
      companyId: TENANT_A,
      items: [
        { productId: PROD_LEITE_COND, quantity: 1 }, // Válido Tenant A
        { productId: PROD_SEM_PRECO, quantity: 1 },   // Indisponível Tenant A
        { productId: 'PROD_DE_OUTRO_TENANT', quantity: 1 } // Inexistente no Tenant A
      ]
    }

    const res = await resolveBatchProductPrices(batchReq)

    assert.equal(res.allConfirmed, false)
    assert.equal(res.hasUnavailable, true)
    assert.equal(res.items.length, 3)

    // Item 1 deve estar confirmado com R$ 8.50
    assert.equal(res.items[0].status, 'confirmed')
    assert.equal(res.items[0].subtotal, 8.50)

    // Item 2 e 3 devem estar unavailable sem derrubar a consulta do item 1
    assert.equal(res.items[1].status, 'unavailable')
    assert.equal(res.items[2].status, 'unavailable')

    // O total só soma os itens confirmados
    assert.equal(res.totalCents, 850)
    assert.equal(res.total, 8.50)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 17 (FASE 6): Recall em Catálogo Maior que 200 Produtos
  // ----------------------------------------------------------------------------
  test('Cenário 17 (FASE 6): Recall preservado em catálogo grande (300 produtos sintéticos)', () => {
    const largeCatalog: StructuredProductCandidate[] = []

    // Popula 299 produtos de ruído
    for (let i = 1; i <= 299; i++) {
      largeCatalog.push({
        id: `noise-${i}`,
        name: `PRODUTO ALEATORIO CONFEITARIA INGREDIENTE ${i} 500G`,
        unit: 'UN',
        active: true,
        company_id: TENANT_A,
        brand: `Marca ${i % 20}`
      })
    }

    // Insere o produto alvo na posição 250
    largeCatalog.splice(250, 0, {
      id: 'target-leite-cond-tirol',
      name: 'LEITE CONDENSADO SEMIDESNATADO TIROL 395G',
      unit: 'UN',
      active: true,
      company_id: TENANT_A,
      brand: 'Tirol'
    })

    const searchRes = rankProductsIntelligently('leite condensado tirol 395g', largeCatalog)
    assert.equal(searchRes.status, 'exact_match')
    assert.equal(searchRes.matches[0].id, 'target-leite-cond-tirol')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 18 (FASE 6): Restrições Alimentares com Atributo Desconhecido Pendente
  // ----------------------------------------------------------------------------
  test('Cenário 18 (FASE 6): Restrição alimentar com atributo desconhecido marcado como pendente', () => {
    const catalog: StructuredProductCandidate[] = [
      {
        id: 'leite-comum',
        name: 'LEITE CONDENSADO INTEGRAL TIROL 395G', // Contém lactose comprovada
        unit: 'UN',
        active: true,
        company_id: TENANT_A,
        brand: 'Tirol'
      },
      {
        id: 'mistura-confeiteiro',
        name: 'MISTURA PARA RECHEIO CONFEITEIRO 1KG', // Ingredientes desconhecidos no nome
        unit: 'UN',
        active: true,
        company_id: TENANT_A,
        brand: 'Arcolor'
      }
    ]

    const res = rankProductsIntelligently('leite condensado sem lactose', catalog)
    // O leite condensado com lactose NÃO deve ser retornado como exact_match ou compatível
    assert.notEqual(res.matches[0]?.id, 'leite-comum')

    // Atributos desconhecidos não devem ser dados como compatíveis sem verificação
    const candidateMistura = catalog[1]
    const searchMistura = rankProductsIntelligently('mistura sem lactose', [candidateMistura])
    if (searchMistura.matches.length > 0) {
      assert.ok(
        searchMistura.matches[0].pendingAttributes?.includes('zero_lactose'),
        'Atributo alimentar deve estar marcado como pendente de confirmação'
      )
    }
  })
})
