/**
 * ELLEVEE IA — AC-04.4.1 | TESTES DE INTEGRIDADE COMERCIAL E PREPARAÇÃO DE STAGING
 *
 * Valida cirurgicamente os 4 riscos comerciais críticos identificados:
 * 1. Embalagens e Unidades: Caixa vs Unidade, Fator de Embalagem, bloqueio de conversão indevida
 * 2. Eliminação de Afirmações Falsas de Estoque: Sanitizador determinístico em engine.ts e prompt transparente
 * 3. Validade do Orçamento e Persistência: Horário de Brasília (23:59:59.999-03:00), concorrência otimista e recovery
 * 4. Idempotência Persistente: Prevenção de duplicidade pré-LLM no banco (outbox / messages)
 * 5. Precisão Financeira em Centavos e Multi-Tenant
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import { parseStructuredQuery, type CommercialSaleUnit } from '../../lib/services/catalog/query-parser'
import { extractProductPackageFactor } from '../../lib/services/catalog/products'
import { sanitizeStockAssertions } from '../../lib/services/agent/engine'
import { buildAgentContext } from '../../lib/services/agent/context-builder'
import {
  calculateQuoteValidityDate,
  isQuoteExpired,
  createOrUpdateEnterpriseQuote,
  getActiveQuoteForConversation,
  formatQuoteForWhatsApp
} from '../../lib/services/commercial/quotes'
import { processCustomerMessageToQuote } from '../../lib/services/commercial/quote-orchestrator'
import { addItemToCart, type WorkingMemory } from '../../lib/services/agent/working-memory'

describe('ELLEVEE IA — AC-04.4.1 | CORREÇÕES DE INTEGRIDADE COMERCIAL', () => {
  const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const CONV_ID = '22222222-2222-2222-2222-222222222222'

  function createSyntheticMockDatabase() {
    const companies = [
      {
        id: COMPANY_ID,
        name: 'Empresa Teste A',
        status: 'active',
        plan: 'enterprise',
        subscription_status: 'active',
        commercial_rules: {
          price_table_id: 'TAB-PADRAO-A',
          branch_id: 'MATRIZ-A',
          allow_wholesale_thresholds: true
        },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }
    ]

    const agents = [
      {
        id: 'agent-1',
        company_id: COMPANY_ID,
        name: 'Sofia Consultora Comercial',
        model: 'gemini-1.5-pro',
        status: 'active',
        is_active: true,
        personality: 'Consultiva, objetiva e transparente.',
        instructions: 'Atue como consultora especializada.',
        created_at: '2026-01-01T00:00:00Z'
      }
    ]

    const customers = [
      {
        id: 'cust-1',
        company_id: COMPANY_ID,
        name: 'Mariana Confeiteira',
        phone: '11999998888',
        name_confirmed: true,
        whatsapp_name: 'Mariana',
        created_at: '2026-01-01T00:00:00Z'
      }
    ]

    const conversations = [
      {
        id: CONV_ID,
        company_id: COMPANY_ID,
        agent_id: 'agent-1',
        customer_id: 'cust-1',
        channel: 'whatsapp',
        status: 'active',
        customers: customers[0],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      },
      {
        id: 'conv-recovery-test',
        company_id: COMPANY_ID,
        agent_id: 'agent-1',
        customer_id: 'cust-1',
        channel: 'whatsapp',
        status: 'active',
        customers: customers[0],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }
    ]

    const products = [
      {
        id: 'prod-tirol-395g',
        company_id: COMPANY_ID,
        name: 'LEITE CONDENSADO TIROL TP 395G',
        sku: 'SKU-TIR-001',
        barcode: '7891234567890',
        unit: 'UN',
        brand: 'Tirol',
        category: 'Confeitaria',
        normalized_name: 'leite condensado tirol tp 395g',
        active: true,
        metadata: {},
        package_description: null
      },
      {
        id: 'prod-1',
        company_id: COMPANY_ID,
        name: 'PRODUTO GENÉRICO TESTE',
        sku: 'SKU-GEN-001',
        barcode: '7891234567899',
        unit: 'UN',
        brand: 'Generico',
        category: 'Confeitaria',
        normalized_name: 'produto generico teste',
        active: true,
        metadata: {},
        package_description: null
      }
    ]

    const prices = [
      {
        id: 'price-tirol-retail',
        company_id: COMPANY_ID,
        product_id: 'prod-tirol-395g',
        price: 5.49,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: 49,
        active: true,
        valid_from: '2026-01-01',
        valid_until: '2026-12-31'
      },
      {
        id: 'price-tirol-wholesale',
        company_id: COMPANY_ID,
        product_id: 'prod-tirol-395g',
        price: 4.50,
        price_type: 'wholesale',
        min_quantity: 50,
        max_quantity: null,
        active: true,
        valid_from: '2026-01-01',
        valid_until: '2026-12-31'
      },
      {
        id: 'price-prod1-retail',
        company_id: COMPANY_ID,
        product_id: 'prod-1',
        price: 10.00,
        price_type: 'retail',
        min_quantity: 1,
        max_quantity: null,
        active: true,
        valid_from: '2026-01-01',
        valid_until: '2026-12-31'
      }
    ]

    const quotes: any[] = []
    const quoteItems: any[] = []
    const messages: any[] = []
    const messageOutbox: any[] = []

    return { companies, agents, conversations, customers, products, prices, quotes, quoteItems, messages, messageOutbox }
  }

  let mockDb = createSyntheticMockDatabase()

  function setupMockSupabase() {
    mockDb = createSyntheticMockDatabase()

    const mockClient = {
      from: (table: string) => {
        let currentCompanyId: string | null = null
        let currentId: string | null = null
        let currentConversationId: string | null = null
        let inIds: string[] | null = null
        let inProductIds: string[] | null = null
        let inStatuses: string[] | null = null
        let currentActive: boolean | null = null
        let containsMetadata: any = null
        let currentLimit: number = 500
        let currentOr: string | null = null
        let countOpt: any = null
        let headOpt: boolean = false

        const builder: any = {
          select: (_cols?: string, opts?: any) => {
            if (opts?.count) countOpt = opts.count
            if (opts?.head) headOpt = true
            return builder
          },
          eq: (col: string, val: any) => {
            if (col === 'company_id') currentCompanyId = val
            if (col === 'id') currentId = val
            if (col === 'conversation_id') currentConversationId = val
            if (col === 'active') currentActive = val
            return builder
          },
          in: (col: string, vals: any[]) => {
            if (col === 'id') inIds = vals
            if (col === 'product_id') inProductIds = vals
            if (col === 'status') inStatuses = vals
            return builder
          },
          or: (cond: string) => {
            currentOr = cond
            return builder
          },
          contains: (col: string, val: any) => {
            if (col === 'metadata') containsMetadata = val
            return builder
          },
          order: (_col: string, _opts?: any) => builder,
          limit: (l: number) => {
            currentLimit = l
            return builder
          },
          maybeSingle: async () => {
            if (table === 'companies') {
              const found = mockDb.companies.find(c => (!currentId || c.id === currentId))
              return { data: found || null, error: null }
            }
            if (table === 'agents') {
              const found = mockDb.agents.find(a =>
                (!currentCompanyId || a.company_id === currentCompanyId) &&
                (!currentId || a.id === currentId)
              )
              return { data: found || null, error: null }
            }
            if (table === 'conversations') {
              const found = mockDb.conversations.find(c =>
                (!currentCompanyId || c.company_id === currentCompanyId) &&
                (!currentId || c.id === currentId)
              )
              if (!found) return { data: null, error: null }
              const customer = mockDb.customers.find(cu => cu.id === found.customer_id) || null
              return { data: { ...found, customers: customer }, error: null }
            }
            if (table === 'customers') {
              const found = mockDb.customers.find(c => (!currentId || c.id === currentId))
              return { data: found || null, error: null }
            }
            if (table === 'products') {
              const found = mockDb.products.find(p =>
                (!currentCompanyId || p.company_id === currentCompanyId) &&
                (!currentId || p.id === currentId)
              )
              return { data: found || null, error: null }
            }
            if (table === 'quotes') {
              const found = mockDb.quotes.find(q => {
                if (currentCompanyId && q.company_id !== currentCompanyId) return false
                if (currentId && q.id !== currentId) return false
                if (inStatuses && !inStatuses.includes(q.status)) return false
                if (containsMetadata) {
                  for (const [k, v] of Object.entries(containsMetadata)) {
                    if (q.metadata?.[k] !== v) return false
                  }
                }
                return true
              })
              if (!found) return { data: null, error: null }
              const deepCopy = JSON.parse(JSON.stringify(found))
              deepCopy.quote_items = mockDb.quoteItems
                .filter(qi => qi.quote_id === found.id)
                .map(qi => ({
                  ...qi,
                  products: mockDb.products.find(p => p.id === qi.product_id) || null
                }))
              return { data: deepCopy, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => builder.maybeSingle(),
          insert: (payload: any) => {
            const items = Array.isArray(payload) ? payload : [payload]
            const inserted: any[] = []

            for (const item of items) {
              const row = {
                id: item.id || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...item
              }
              if (table === 'quotes') mockDb.quotes.push(row)
              if (table === 'quote_items') mockDb.quoteItems.push(row)
              if (table === 'messages') mockDb.messages.push(row)
              if (table === 'message_outbox') mockDb.messageOutbox.push(row)
              inserted.push(row)
            }

            const resBuilder: any = {
              select: () => ({
                single: async () => ({ data: inserted[0] || null, error: null }),
                data: inserted,
                error: null
              })
            }
            return resBuilder
          },
          update: (payload: any) => {
            const updateBuilder: any = {
              eq: (col: string, val: any) => {
                if (col === 'id') currentId = val
                if (col === 'company_id') currentCompanyId = val
                return updateBuilder
              },
              select: () => ({
                single: async () => {
                  let target: any = null
                  if (table === 'quotes') {
                    target = mockDb.quotes.find(q =>
                      (!currentCompanyId || q.company_id === currentCompanyId) &&
                      (!currentId || q.id === currentId)
                    )
                  }
                  if (target) {
                    Object.assign(target, payload, { updated_at: new Date().toISOString() })
                  }
                  return { data: target || null, error: null }
                }
              }),
              then: (resolve: any) => {
                let target: any = null
                if (table === 'quotes') {
                  target = mockDb.quotes.find(q =>
                    (!currentCompanyId || q.company_id === currentCompanyId) &&
                    (!currentId || q.id === currentId)
                  )
                }
                if (target) {
                  Object.assign(target, payload, { updated_at: new Date().toISOString() })
                }
                return resolve({ data: target, error: null })
              }
            }
            return updateBuilder
          },
          delete: () => {
            const delBuilder: any = {
              eq: (col: string, val: any) => {
                if (table === 'quote_items' && col === 'quote_id') {
                  mockDb.quoteItems = mockDb.quoteItems.filter(qi => qi.quote_id !== val)
                }
                return delBuilder
              },
              then: (resolve: any) => resolve({ data: null, error: null })
            }
            return delBuilder
          },
          then: (resolve: any) => {
            if (table === 'products') {
              let res = mockDb.products.filter(p => {
                if (currentCompanyId && p.company_id !== currentCompanyId) return false
                if (currentId && p.id !== currentId) return false
                if (inIds && !inIds.includes(p.id)) return false
                if (currentActive !== null && p.active !== currentActive) return false
                return true
              })

              if (headOpt) {
                return resolve({ data: null, error: null, count: res.length })
              }

              if (currentOr) {
                if (currentOr.includes('barcode.eq') || currentOr.includes('sku.ilike')) {
                  const matchId = currentOr.match(/"([^"]+)"/)
                  if (matchId) {
                    const targetId = matchId[1].toLowerCase()
                    res = res.filter(p => (p.barcode && p.barcode.toLowerCase() === targetId) || (p.sku && p.sku.toLowerCase() === targetId))
                  }
                } else if (currentOr.includes('normalized_name.ilike')) {
                  const tokens = [...currentOr.matchAll(/normalized_name\.ilike\."%([^%"]+)%"/g)].map(m => m[1].toLowerCase())
                  if (tokens.length > 0) {
                    res = res.filter(p => tokens.some(t => (p.normalized_name || p.name || '').toLowerCase().includes(t)))
                  }
                }
              }

              const mapped = res.map(p => ({
                ...p,
                product_brands: p.brand ? { name: p.brand } : null,
                product_categories: p.category ? { name: p.category } : null
              }))
              return resolve({ data: mapped.slice(0, currentLimit), error: null, count: res.length })
            }

            if (table === 'product_prices') {
              let res = mockDb.prices.filter(p => {
                if (currentCompanyId && p.company_id !== currentCompanyId) return false
                if (currentId && p.product_id !== currentId) return false
                if (inProductIds && !inProductIds.includes(p.product_id)) return false
                if (currentActive !== null && p.active !== currentActive) return false
                return true
              })
              return resolve({ data: res.slice(0, currentLimit), error: null })
            }

            if (table === 'messages') {
              let res = mockDb.messages.filter(m => {
                if (currentCompanyId && m.company_id !== currentCompanyId) return false
                if (currentConversationId && m.conversation_id !== currentConversationId) return false
                return true
              })
              return resolve({ data: res.slice(0, currentLimit), error: null })
            }

            return resolve({ data: [], error: null })
          }
        }

        return builder
      }
    }

    setMockSupabaseClient(mockClient)
    return mockClient
  }

  beforeEach(() => {
    setupMockSupabase()
  })

  // ============================================================================
  // DOMÍNIO 1: EMBALAGENS E UNIDADES (CX vs UN, FATOR DE EMBALAGEM)
  // ============================================================================

  test('Cenário 1: "5 caixas de leite condensado Tirol" sem fator cadastrado bloqueia conversão e marca pending_validation', async () => {
    // Produto cadastrado em UN sem package_factor
    const query = '5 caixas de leite condensado tirol'
    const parsed = parseStructuredQuery(query)

    assert.equal(parsed.quantity, 5)
    assert.equal(parsed.saleUnit, 'CX')

    // Executa no orchestrator simulando catálogo onde produto é vendido por UN e não tem fator cadastrado
    const result = await processCustomerMessageToQuote({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      message: query,
      workingMemory: {}
    })

    // Deve identificar que precisa de esclarecimento sobre o fator de embalagem
    assert.equal(result.status, 'pending_clarification')
    assert.equal(result.actionTaken, 'clarification_needed')
    assert.ok(result.differentiatingQuestion?.includes('caixa') || result.differentiatingQuestion?.includes('embalagem'))

    // O item no carrinho deve estar como pending e sem preço confirmado
    const cart = result.workingMemory.activeCart || []
    assert.equal(cart.length, 1)
    assert.equal(cart[0].status, 'pending')
    assert.equal(cart[0].isPriceConfirmed, false)
    assert.equal(cart[0].requestedUnit, 'CX')

    // O orçamento gerado NUNCA pode ser 'ready'
    assert.ok(result.quote)
    assert.equal(result.quote.status, 'pending_validation')
    assert.equal(result.quote.totalConfirmedCents, 0)
    assert.equal(result.quote.hasPendingItems, true)
  })

  test('Cenário 2: "2 caixas de leite condensado Tirol" com package_factor=27 converte para 54 unidades e precifica no atacado', async () => {
    // Simula produto com package_description="Caixa com 27 unidades"
    const productWithBox = {
      name: 'LEITE CONDENSADO TIROL TP 395G',
      unit: 'UN',
      package_description: 'Caixa com 27 unidades',
      metadata: { package_factor: 27 }
    }

    const factorInfo = extractProductPackageFactor(productWithBox)
    assert.equal(factorInfo.factor, 27)
    assert.equal(factorInfo.confidence, 'exact')

    const requestedBoxes = 2
    const internalUnits = requestedBoxes * factorInfo.factor!
    assert.equal(internalUnits, 54)

    // Cria orçamento formal com as 54 unidades resolvidas
    const quote = await createOrUpdateEnterpriseQuote({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      items: [{
        productId: 'prod-tirol-395g',
        quantity: internalUnits,
        unit: 'UN',
        requestedQuantity: requestedBoxes,
        requestedUnit: 'CX',
        packageFactor: 27,
        internalQuantity: internalUnits,
        internalUnit: 'UN'
      }]
    })

    assert.ok(quote.id)
    assert.equal(quote.status, 'ready')
    assert.equal(quote.items.length, 1)
    assert.equal(quote.items[0].requestedQuantity, 2)
    assert.equal(quote.items[0].requestedUnit, 'CX')
    assert.equal(quote.items[0].packageFactor, 27)
    assert.equal(quote.items[0].quantity, 54)
    assert.equal(quote.items[0].isConfirmed, true)
    assert.ok(quote.totalConfirmedCents > 0)
  })

  test('Cenário 3: Extração determinística de package_factor de múltiplas fontes confiáveis', () => {
    // 1. Metadata explícito
    const resMeta = extractProductPackageFactor({
      name: 'LEITE CONDENSADO TIROL 395G',
      metadata: { package_factor: 27 }
    })
    assert.equal(resMeta.factor, 27)
    assert.equal(resMeta.source, 'metadata')

    // 2. package_description com "Caixa com 24 unidades"
    const resDesc = extractProductPackageFactor({
      name: 'CREME DE LEITE NESTLE 200G',
      package_description: 'Caixa com 24 unidades'
    })
    assert.equal(resDesc.factor, 24)
    assert.equal(resDesc.source, 'package_description')

    // 3. Nome do produto com multiplicador "27X395G"
    const resMultName = extractProductPackageFactor({
      name: 'CX LEITE CONDENSADO TIROL 27X395G'
    })
    assert.equal(resMultName.factor, 27)
    assert.equal(resMultName.source, 'name')

    // 4. Nome do produto com "FD C/ 6 UN"
    const resFardoName = extractProductPackageFactor({
      name: 'FARINHA DE TRIGO TRADICIONAL FD C/ 6 UN'
    })
    assert.equal(resFardoName.factor, 6)
    assert.equal(resFardoName.source, 'name')

    // 5. Produto sem menção a fator de embalagem (unidade pura)
    const resNone = extractProductPackageFactor({
      name: 'CHOCOLATE EM PO SICAO 1KG',
      unit: 'UN'
    })
    assert.equal(resNone.factor, null)
    assert.equal(resNone.confidence, 'unconfirmed')
  })

  test('Cenário 4: Reconhecimento abrangente de unidades de venda comerciais (UN, CX, FD, PC, KG, L)', () => {
    const tests: Array<{ query: string; expectedQty: number; expectedUnit: CommercialSaleUnit }> = [
      { query: '10 unidades de fermento royal', expectedQty: 10, expectedUnit: 'UN' },
      { query: '5 caixas de leite condensado italac', expectedQty: 5, expectedUnit: 'CX' },
      { query: '2 fardos de farinha dona benta', expectedQty: 2, expectedUnit: 'FD' },
      { query: '3 pacotes de coco ralado', expectedQty: 3, expectedUnit: 'PC' },
      { query: '5 kg de cobertura fracionada', expectedQty: 5, expectedUnit: 'KG' },
      { query: '10 litros de chantilly vegetal', expectedQty: 10, expectedUnit: 'L' }
    ]

    for (const t of tests) {
      const parsed = parseStructuredQuery(t.query)
      assert.equal(parsed.quantity, t.expectedQty, `Falha na quantidade para "${t.query}"`)
      assert.equal(parsed.saleUnit, t.expectedUnit, `Falha na unidade para "${t.query}"`)
    }
  })

  // ============================================================================
  // DOMÍNIO 2: ELIMINAÇÃO DE AFIRMAÇÕES FALSAS DE ESTOQUE
  // ============================================================================

  test('Cenário 5: Sanitizador intercepta afirmações diretas de disponibilidade imediata', () => {
    const rawResponses = [
      'Temos sim as duas opções disponíveis: Sicao 1kg e Genuine 1kg.',
      'Temos sim! O Leite Condensado Italac 395g está R$ 5,69.',
      'O Chocolate Melken 1kg está disponível no estoque por R$ 42,90.',
      'Temos disponível a cobertura fracionada e o chocolate nobre.'
    ]

    for (const raw of rawResponses) {
      const sanitized = sanitizeStockAssertions(raw)
      assert.doesNotMatch(sanitized, /temos sim as duas opções disponíveis/i)
      assert.doesNotMatch(sanitized, /temos sim!/i)
      assert.doesNotMatch(sanitized, /disponível no estoque/i)
      assert.doesNotMatch(sanitized, /temos disponível/i)
      assert.match(sanitized, /consta(?:m)? (?:em nosso |no )?catálogo/i)
    }
  })

  test('Cenário 6: Sanitizador intercepta promessas indevidas de separação física e retirada', () => {
    const rawResponses = [
      'Já separei seu pedido aqui na loja! Pode vir retirar hoje!',
      'Já reservei seu pedido no estoque para retirada.',
      'Pode vir retirar quando for mais conveniente.'
    ]

    for (const raw of rawResponses) {
      const sanitized = sanitizeStockAssertions(raw)
      assert.doesNotMatch(sanitized, /já separei/i)
      assert.doesNotMatch(sanitized, /já reservei/i)
      assert.doesNotMatch(sanitized, /pode vir retirar hoje/i)
      assert.ok(sanitized.includes('conferência') || sanitized.includes('estoque') || sanitized.includes('registrei'))
    }
  })

  test('Cenário 7: Prompt do sistema em context-builder.ts não contém exemplos de "Temos sim!" e inclui transparência', async () => {
    const ctx = await buildAgentContext({
      companyId: COMPANY_ID,
      agentId: 'agent-1',
      conversationId: CONV_ID
    })

    const systemMsg = ctx.payloadMessages.find(m => m.role === 'system')?.content || ''
    
    // Confirma que o exemplo impróprio da linha 183 foi corrigido
    assert.doesNotMatch(systemMsg, /Temos sim! O Leite Condensado/i)
    assert.match(systemMsg, /Consta em nosso catálogo o Leite Condensado/i)

    // Confirma que a regra de transparência de estoque está presente no prompt
    assert.match(systemMsg, /TRANSPARÊNCIA DE ESTOQUE/i)
    assert.match(systemMsg, /NÃO comprovam estoque físico/i)
  })

  // ============================================================================
  // DOMÍNIO 3: VALIDADE DO ORÇAMENTO E PERSISTÊNCIA NO POSTGRESQL
  // ============================================================================

  test('Cenário 8: calculateQuoteValidityDate respeita expressamente America/Sao_Paulo (23:59:59.999-03:00) sem drift UTC', () => {
    // Simula execução às 22:30 BRT do dia 2026-11-22 (que em UTC já é 2026-11-23T01:30:00Z)
    const lateNightBrt = new Date('2026-11-22T22:30:00-03:00')
    const val3Days = calculateQuoteValidityDate(3, lateNightBrt)

    // 22 de novembro + 3 dias = 25 de novembro no calendário civil de Brasília
    assert.equal(val3Days, '2026-11-25T23:59:59.999-03:00')

    // Simula execução no início da manhã às 08:00 BRT
    const morningBrt = new Date('2026-11-22T08:00:00-03:00')
    const valMorning = calculateQuoteValidityDate(3, morningBrt)
    assert.equal(valMorning, '2026-11-25T23:59:59.999-03:00')

    // isQuoteExpired avalia corretamente antes e depois do vencimento
    const notExpired = isQuoteExpired({ validUntil: '2026-11-25T23:59:59.999-03:00' })
    assert.equal(notExpired, false)
    const expired = isQuoteExpired({ validUntil: '2026-11-20T23:59:59.999-03:00' })
    assert.equal(expired, true)
  })

  test('Cenário 9: Concorrência otimista (Optimistic Concurrency) rejeita versão defasada e aceita versão esperada', async () => {
    // Cria orçamento inicial (versão 1)
    const q1 = await createOrUpdateEnterpriseQuote({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      items: [{ productId: 'prod-1', quantity: 10, unit: 'UN' }]
    })
    assert.equal(q1.version, 1)

    // Tentativa de update com expectedVersion incompatível (ex: cliente tenta update baseado em versão 0)
    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: COMPANY_ID,
          conversationId: CONV_ID,
          existingQuoteId: q1.id,
          expectedVersion: 0, // Incorreto, banco está na versão 1
          items: [{ productId: 'prod-1', quantity: 15, unit: 'UN' }]
        })
      },
      /Conflito de concorrência no orçamento/
    )

    // Update com expectedVersion correto (versão 1 -> versão 2)
    const q2 = await createOrUpdateEnterpriseQuote({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      existingQuoteId: q1.id,
      expectedVersion: 1,
      items: [{ productId: 'prod-1', quantity: 20, unit: 'UN' }]
    })

    assert.equal(q2.version, 2)
    assert.equal(q2.changeHistory.length, 2)
    assert.equal(q2.changeHistory[1].version, 2)
  })

  test('Cenário 10: getActiveQuoteForConversation recupera orçamento ativo e seus itens após reinicialização', async () => {
    // Cria orçamento com metadados de embalagem
    const created = await createOrUpdateEnterpriseQuote({
      companyId: COMPANY_ID,
      conversationId: 'conv-recovery-test',
      items: [{
        productId: 'prod-tirol-395g',
        quantity: 54,
        unit: 'UN',
        requestedQuantity: 2,
        requestedUnit: 'CX',
        packageFactor: 27,
        internalQuantity: 54,
        internalUnit: 'UN'
      }]
    })

    // Recupera diretamente usando apenas companyId e conversationId
    const recovered = await getActiveQuoteForConversation(COMPANY_ID, 'conv-recovery-test')
    assert.ok(recovered)
    assert.equal(recovered.id, created.id)
    assert.equal(recovered.status, 'ready')
    assert.equal(recovered.items.length, 1)
    assert.equal(recovered.items[0].requestedQuantity, 2)
    assert.equal(recovered.items[0].requestedUnit, 'CX')
    assert.equal(recovered.items[0].packageFactor, 27)
  })

  // ============================================================================
  // DOMÍNIO 4: IDEMPOTÊNCIA PERSISTENTE E REPLAY DE EVENTOS
  // ============================================================================

  test('Cenário 11: Replay de evento duplicado em processCustomerMessageToQuote é idempotent_replay sem alteração', async () => {
    const memoryInitial: WorkingMemory = {
      activeCart: [{
        productId: 'prod-tirol-395g',
        name: 'Leite Condensado Tirol 395g',
        quantity: 5,
        unit: 'UN',
        isPriceConfirmed: true,
        status: 'confirmed'
      }],
      processedMessageIds: ['evt-idemp-1']
    }

    const replayRes = await processCustomerMessageToQuote({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      message: 'adiciona mais 2 leite condensado',
      eventId: 'evt-idemp-1', // Já processado
      workingMemory: memoryInitial
    })

    assert.equal(replayRes.actionTaken, 'idempotent_replay')
    assert.equal(replayRes.workingMemory.activeCart?.length, 1)
    assert.equal(replayRes.workingMemory.activeCart?.[0].quantity, 5) // Inalterado
  })

  // ============================================================================
  // DOMÍNIO 5: FORMATAÇÃO VISUAL E PRECISÃO FINANCEIRA
  // ============================================================================

  test('Cenário 12: formatQuoteForWhatsApp exibe conversão de embalagem para itens confirmados e alerta para pendentes', () => {
    const mockQuote: any = {
      id: 'quote-format-1',
      version: 2,
      validUntil: '2026-11-25T23:59:59.999-03:00',
      totalConfirmed: 243.00,
      hasPendingItems: true,
      items: [
        {
          name: 'Leite Condensado Tirol 395g',
          quantity: 54,
          unit: 'UN',
          requestedQuantity: 2,
          requestedUnit: 'CX',
          packageFactor: 27,
          unitPrice: 4.50,
          subtotal: 243.00,
          appliedRule: 'Atacado (faixa >= 50 un)',
          isConfirmed: true,
          status: 'confirmed'
        },
        {
          name: 'Creme de Leite Tirol 200g',
          quantity: 3,
          unit: 'CX',
          requestedQuantity: 3,
          requestedUnit: 'CX',
          unitPrice: 0,
          subtotal: 0,
          isConfirmed: false,
          status: 'pending',
          pendingReason: 'Fator de embalagem da caixa não cadastrado no catálogo'
        }
      ]
    }

    const formatted = formatQuoteForWhatsApp(mockQuote)

    // Item confirmado deve mostrar detalhe da conversão de caixa para unidades
    assert.match(formatted, /2 CX c\/ 27 un = 54 UN/i)
    assert.match(formatted, /R\$\s*243,00/i)

    // Item pendente deve exibir ícone de ampulheta e motivo de pendência
    assert.match(formatted, /⏳ Qtd: 3 CX — _Fator de embalagem da caixa não cadastrado no catálogo_/i)

    // Rodapé de segurança contra falsas promessas de estoque
    assert.match(formatted, /não reserva estoque/i)
    assert.match(formatted, /Alguns itens requerem validação comercial humana/i)
  })
})
