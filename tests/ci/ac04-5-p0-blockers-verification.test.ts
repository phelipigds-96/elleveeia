/**
 * ELLEVEE IA — AC-04.5-P0 | TESTES DE VERIFICAÇÃO DE BLOQUEADORES PARA HOMOLOGAÇÃO
 *
 * Valida cirurgicamente os três gates essenciais antes de AC-04.5:
 * Gate 1 — Autorização de Orçamentos (Isolamento entre clientes e conversas no mesmo tenant)
 * Gate 2 — Atomicidade Financeira (Transação atômica, concorrência otimista, rollback)
 * Gate 3 — Idempotência Pré-LLM (Replay atômico, mesmo external_id com event_ids distintos)
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import {
  createOrUpdateEnterpriseQuote,
  getQuote,
  getActiveQuoteForConversation
} from '../../lib/services/commercial/quotes'
import { consultarOrcamentoTool } from '../../lib/services/agent/tools/consultar-orcamento'
import { gerarOrcamentoTool } from '../../lib/services/agent/tools/gerar-orcamento'
import { processWebhookEvent, handleAutonomousCycle } from '../../lib/services/message-engine'
import { processCustomerMessageToQuote } from '../../lib/services/commercial/quote-orchestrator'
import type { WebhookPayload } from '../../lib/validations/webhook'

describe('ELLEVEE IA — AC-04.5-P0 | VERIFICAÇÃO DE BLOQUEADORES CRÍTICOS', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111'
  const TENANT_B = '22222222-2222-2222-2222-222222222222'

  const CUSTOMER_A = 'aaaa1111-1111-1111-1111-111111111111'
  const CUSTOMER_B = 'bbbb2222-2222-2222-2222-222222222222'

  const CONV_A = 'cccc1111-1111-1111-1111-111111111111'
  const CONV_B = 'cccc2222-2222-2222-2222-222222222222'

  const PROD_1 = '00000000-0000-0000-0000-000000000001'
  const PROD_2 = '00000000-0000-0000-0000-000000000002'

  let mockDb: any = null

  function createSyntheticDatabase() {
    return {
      companies: [
        {
          id: TENANT_A,
          name: 'Empresa Teste A',
          status: 'active',
          plan: 'enterprise',
          subscription_status: 'active',
          commercial_rules: { allow_wholesale_thresholds: true }
        },
        {
          id: TENANT_B,
          name: 'Empresa Teste B',
          status: 'active',
          plan: 'pro',
          subscription_status: 'active'
        }
      ],
      agents: [
        {
          id: 'agent-1',
          company_id: TENANT_A,
          name: 'Sofia Consultora',
          status: 'active',
          is_active: true
        }
      ],
      customers: [
        {
          id: CUSTOMER_A,
          company_id: TENANT_A,
          name: 'Cliente Alice',
          phone: '11999990001'
        },
        {
          id: CUSTOMER_B,
          company_id: TENANT_A,
          name: 'Cliente Bob',
          phone: '11999990002'
        }
      ],
      conversations: [
        {
          id: CONV_A,
          company_id: TENANT_A,
          customer_id: CUSTOMER_A,
          agent_id: 'agent-1',
          channel: 'whatsapp',
          status: 'active',
          unread_count: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          id: CONV_B,
          company_id: TENANT_A,
          customer_id: CUSTOMER_B,
          agent_id: 'agent-1',
          channel: 'whatsapp',
          status: 'active',
          unread_count: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        }
      ],
      products: [
        {
          id: PROD_1,
          company_id: TENANT_A,
          name: 'CHOCOLATE EM PO SICAO 1KG',
          sku: 'SKU-SIC-001',
          unit: 'UN',
          active: true,
          metadata: {}
        },
        {
          id: PROD_2,
          company_id: TENANT_A,
          name: 'LEITE CONDENSADO TIROL 395G',
          sku: 'SKU-TIR-001',
          unit: 'UN',
          active: true,
          metadata: {}
        }
      ],
      prices: [
        {
          id: 'price-1-retail',
          company_id: TENANT_A,
          product_id: PROD_1,
          price: 35.00,
          price_type: 'retail',
          min_quantity: 1,
          max_quantity: 9,
          active: true
        },
        {
          id: 'price-1-wholesale',
          company_id: TENANT_A,
          product_id: PROD_1,
          price: 30.00,
          price_type: 'wholesale',
          min_quantity: 10,
          max_quantity: null,
          active: true
        },
        {
          id: 'price-2-retail',
          company_id: TENANT_A,
          product_id: PROD_2,
          price: 5.50,
          price_type: 'retail',
          min_quantity: 1,
          max_quantity: null,
          active: true
        }
      ],
      quotes: [] as any[],
      quoteItems: [] as any[],
      webhookEvents: [] as any[],
      messages: [] as any[],
      messageOutbox: [] as any[]
    }
  }

  function setupMockClient() {
    mockDb = createSyntheticDatabase()

    const mockClient = {
      from: (table: string) => {
        let currentCompanyId: string | null = null
        let currentId: string | null = null
        let currentConversationId: string | null = null
        let currentCustomerId: string | null = null
        let inIds: string[] | null = null
        let inProductIds: string[] | null = null
        let inStatuses: string[] | null = null
        let currentActive: boolean | null = null
        let containsMetadata: any = null
        let currentLimit: number = 500
        let currentOr: string | null = null
        let currentEventId: string | null = null
        let currentIdempotencyKey: string | null = null
        let currentSenderType: string | null = null

        const builder: any = {
          select: () => builder,
          eq: (col: string, val: any) => {
            if (col === 'company_id') currentCompanyId = val
            if (col === 'id') currentId = val
            if (col === 'conversation_id') currentConversationId = val
            if (col === 'customer_id') currentCustomerId = val
            if (col === 'active') currentActive = val
            if (col === 'event_id') currentEventId = val
            if (col === 'idempotency_key') currentIdempotencyKey = val
            if (col === 'sender_type') currentSenderType = val
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
          order: () => builder,
          limit: (l: number) => {
            currentLimit = l
            return builder
          },
          maybeSingle: async () => {
            if (table === 'companies') {
              const found = mockDb.companies.find((c: any) => !currentId || c.id === currentId)
              return { data: found || null, error: null }
            }
            if (table === 'agents') {
              const found = mockDb.agents.find((a: any) => !currentId || a.id === currentId)
              return { data: found || null, error: null }
            }
            if (table === 'customers') {
              const found = mockDb.customers.find((c: any) => !currentId || c.id === currentId)
              return { data: found || null, error: null }
            }
            if (table === 'conversations') {
              const found = mockDb.conversations.find((c: any) => {
                if (currentCompanyId && c.company_id !== currentCompanyId) return false
                if (currentId && c.id !== currentId) return false
                return true
              })
              if (!found) return { data: null, error: null }
              const customer = mockDb.customers.find((cu: any) => cu.id === found.customer_id) || null
              return { data: { ...found, customers: customer }, error: null }
            }
            if (table === 'quotes') {
              const found = mockDb.quotes.find((q: any) => {
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
                .filter((qi: any) => qi.quote_id === found.id)
                .map((qi: any) => ({
                  ...qi,
                  products: mockDb.products.find((p: any) => p.id === qi.product_id) || null
                }))
              return { data: deepCopy, error: null }
            }
            if (table === 'message_outbox') {
              const found = mockDb.messageOutbox.find((o: any) => {
                if (currentCompanyId && o.company_id !== currentCompanyId) return false
                if (currentIdempotencyKey && o.idempotency_key !== currentIdempotencyKey) return false
                return true
              })
              return { data: found || null, error: null }
            }
            if (table === 'webhook_events') {
              const found = mockDb.webhookEvents.find((e: any) => {
                if (currentCompanyId && e.company_id !== currentCompanyId) return false
                if (currentEventId && e.event_id !== currentEventId) return false
                return true
              })
              return { data: found || null, error: null }
            }
            return { data: null, error: null }
          },
          single: async () => builder.maybeSingle(),
          insert: (payload: any) => {
            const items = Array.isArray(payload) ? payload : [payload]
            const inserted: any[] = []

            for (const item of items) {
              if (table === 'webhook_events') {
                const dup = mockDb.webhookEvents.find(
                  (e: any) => e.company_id === item.company_id && e.event_id === item.event_id
                )
                if (dup) {
                  const err: any = new Error('duplicate key value violates unique constraint "webhook_events_company_id_event_id_key"')
                  err.code = '23505'
                  const failBuilder: any = {
                    select: () => ({
                      single: async () => ({ data: null, error: err }),
                      data: null,
                      error: err
                    })
                  }
                  return failBuilder
                }
              }

              const row = {
                id: item.id || crypto.randomUUID(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...item
              }
              if (table === 'quotes') mockDb.quotes.push(row)
              if (table === 'quote_items') mockDb.quoteItems.push(row)
              if (table === 'messages') mockDb.messages.push(row)
              if (table === 'message_outbox') mockDb.messageOutbox.push(row)
              if (table === 'webhook_events') mockDb.webhookEvents.push(row)
              inserted.push(row)
            }

            return {
              select: () => ({
                single: async () => ({ data: inserted[0] || null, error: null }),
                data: inserted,
                error: null
              })
            }
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
                    target = mockDb.quotes.find((q: any) =>
                      (!currentCompanyId || q.company_id === currentCompanyId) &&
                      (!currentId || q.id === currentId)
                    )
                  }
                  if (table === 'conversations') {
                    target = mockDb.conversations.find((c: any) =>
                      (!currentCompanyId || c.company_id === currentCompanyId) &&
                      (!currentId || c.id === currentId)
                    )
                  }
                  if (table === 'webhook_events') {
                    target = mockDb.webhookEvents.find((e: any) =>
                      (!currentCompanyId || e.company_id === currentCompanyId) &&
                      (!currentId || e.id === currentId)
                    )
                  }
                  if (target) Object.assign(target, payload, { updated_at: new Date().toISOString() })
                  return { data: target || null, error: null }
                }
              }),
              then: (resolve: any) => {
                let target: any = null
                if (table === 'quotes') {
                  target = mockDb.quotes.find((q: any) =>
                    (!currentCompanyId || q.company_id === currentCompanyId) &&
                    (!currentId || q.id === currentId)
                  )
                }
                if (table === 'conversations') {
                  target = mockDb.conversations.find((c: any) =>
                    (!currentCompanyId || c.company_id === currentCompanyId) &&
                    (!currentId || c.id === currentId)
                  )
                }
                if (table === 'webhook_events') {
                  target = mockDb.webhookEvents.find((e: any) =>
                    (!currentCompanyId || e.company_id === currentCompanyId) &&
                    (!currentId || e.id === currentId)
                  )
                }
                if (target) Object.assign(target, payload, { updated_at: new Date().toISOString() })
                return resolve({ data: target, error: null })
              }
            }
            return updateBuilder
          },
          delete: () => ({
            eq: (col: string, val: any) => {
              if (table === 'quote_items' && col === 'quote_id') {
                mockDb.quoteItems = mockDb.quoteItems.filter((qi: any) => qi.quote_id !== val)
              }
              return {
                then: (resolve: any) => resolve({ data: null, error: null })
              }
            }
          }),
          then: (resolve: any) => {
            if (table === 'products') {
              let res = mockDb.products.filter((p: any) => {
                if (currentCompanyId && p.company_id !== currentCompanyId) return false
                if (currentId && p.id !== currentId) return false
                if (inIds && !inIds.includes(p.id)) return false
                if (currentActive !== null && p.active !== currentActive) return false
                return true
              })
              return resolve({ data: res.slice(0, currentLimit), error: null })
            }
            if (table === 'product_prices') {
              let res = mockDb.prices.filter((p: any) => {
                if (currentCompanyId && p.company_id !== currentCompanyId) return false
                if (inProductIds && !inProductIds.includes(p.product_id)) return false
                return true
              })
              return resolve({ data: res.slice(0, currentLimit), error: null })
            }
            if (table === 'messages') {
              let res = mockDb.messages.filter((m: any) => {
                if (currentCompanyId && m.company_id !== currentCompanyId) return false
                if (currentConversationId && m.conversation_id !== currentConversationId) return false
                if (currentSenderType && m.sender_type !== currentSenderType) return false
                return true
              })
              return resolve({ data: res.slice(0, currentLimit), error: null })
            }
            return resolve({ data: [], error: null })
          }
        }
        return builder
      },
      rpc: async (fn: string, args: any) => {
        if (fn === 'insert_message_idempotent') {
          const { p_company_id, p_conversation_id, p_external_id, p_sender_type, p_content, p_created_at, p_metadata, p_message_type } = args
          
          if (p_external_id) {
            const existing = mockDb.messages.find(
              (m: any) => m.conversation_id === p_conversation_id && m.external_id === p_external_id
            )
            if (existing) {
              return { data: [{ message_id: existing.id, was_inserted: false }], error: null }
            }
          }

          const newMsg = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            company_id: p_company_id,
            conversation_id: p_conversation_id,
            external_id: p_external_id,
            sender_type: p_sender_type,
            content: p_content,
            message_type: p_message_type || 'text',
            metadata: p_metadata || {},
            created_at: p_created_at || new Date().toISOString()
          }
          mockDb.messages.push(newMsg)
          return { data: [{ message_id: newMsg.id, was_inserted: true }], error: null }
        }

        if (fn === 'save_enterprise_quote_atomic') {
          const {
            p_company_id,
            p_customer_id,
            p_conversation_id,
            p_existing_quote_id,
            p_expected_version,
            p_status,
            p_total,
            p_metadata,
            p_items
          } = args

          let targetQuote = null
          if (p_existing_quote_id) {
            targetQuote = mockDb.quotes.find((q: any) => q.id === p_existing_quote_id && q.company_id === p_company_id)
            if (!targetQuote) {
              return { data: null, error: { message: `ORCAMENTO_NOT_FOUND_OR_FORBIDDEN: Orçamento ${p_existing_quote_id} não localizado.` } }
            }

            if (p_conversation_id && targetQuote.metadata?.conversation_id && targetQuote.metadata.conversation_id !== p_conversation_id) {
              return { data: null, error: { message: `ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN: Orçamento pertence à conversa ${targetQuote.metadata.conversation_id}.` } }
            }

            if (p_customer_id && targetQuote.customer_id && targetQuote.customer_id !== p_customer_id) {
              return { data: null, error: { message: `ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: Orçamento pertence a outro cliente.` } }
            }

            const currentVer = targetQuote.metadata?.version || 1
            if (p_expected_version !== null && p_expected_version !== undefined && currentVer !== p_expected_version) {
              return { data: null, error: { message: `ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada ${p_expected_version} difere da versão atual ${currentVer}.` } }
            }
          }

          const version = targetQuote ? (targetQuote.metadata?.version || 1) + 1 : 1
          const quoteId = targetQuote ? targetQuote.id : crypto.randomUUID()

          if (targetQuote) {
            targetQuote.total = p_total
            targetQuote.status = p_status
            targetQuote.metadata = { ...p_metadata, version }
            targetQuote.updated_at = new Date().toISOString()
            mockDb.quoteItems = mockDb.quoteItems.filter((qi: any) => qi.quote_id !== targetQuote.id)
          } else {
            const newQ = {
              id: quoteId,
              company_id: p_company_id,
              customer_id: p_customer_id,
              status: p_status,
              total: p_total,
              metadata: { ...p_metadata, version: 1 },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
            mockDb.quotes.push(newQ)
          }

          for (const it of p_items) {
            mockDb.quoteItems.push({
              id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              quote_id: quoteId,
              company_id: p_company_id,
              product_id: it.product_id,
              quantity: it.quantity,
              unit_price: it.unit_price,
              subtotal: it.subtotal,
              metadata: it.metadata || {}
            })
          }

          return {
            data: {
              id: quoteId,
              version,
              status: p_status,
              total: p_total
            },
            error: null
          }
        }

        if (fn === 'acquire_conversation_processing_lock') {
          return { data: [{ was_acquired: true, lock_token: 'tok-mock-lock-1' }], error: null }
        }

        if (fn === 'release_conversation_processing_lock') {
          return { data: true, error: null }
        }

        return { data: null, error: null }
      }
    }

    setMockSupabaseClient(mockClient)
    return mockClient
  }

  beforeEach(() => {
    setupMockClient()
  })

  // ============================================================================
  // GATE 1 — AUTORIZAÇÃO DE ORÇAMENTOS (ISOLAMENTO MULTI-CLIENTE E MULTI-CONVERSA)
  // ============================================================================

  test('Gate 1 — Cenário 1: Cliente A não pode consultar orçamento do Cliente B (mesmo tenant)', async () => {
    // Cria orçamento legítimo para Cliente A na Conversa A
    const quoteA = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 2, unit: 'UN' }]
    })
    assert.ok(quoteA.id)

    // Tentativa 1: getQuote com customerId do Cliente B deve retornar null
    const crossCustomerQuote = await getQuote({
      companyId: TENANT_A,
      quoteId: quoteA.id,
      customerId: CUSTOMER_B,
      conversationId: CONV_B
    })
    assert.equal(crossCustomerQuote, null, 'getQuote permitiu acesso cruzado a cliente não autorizado')

    // Tentativa 2: Tool consultar_orcamento invocada no contexto da Conversa B
    const toolResult = await consultarOrcamentoTool.execute(
      { quote_id: quoteA.id },
      {
        companyId: TENANT_A,
        conversationId: CONV_B,
        customerId: CUSTOMER_B
      }
    )
    assert.equal(toolResult.success, false)
    assert.match(toolResult.error!, /não localizado ou acesso não autorizado/i)
  })

  test('Gate 1 — Cenário 2: Conversa A é expressamente bloqueada de atualizar orçamento da Conversa B', async () => {
    // Cria orçamento inicial na Conversa B
    const quoteB = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_B,
      conversationId: CONV_B,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })

    // Conversa A tenta sobrescrever o orçamento da Conversa B via existingQuoteId
    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: TENANT_A,
          customerId: CUSTOMER_A,
          conversationId: CONV_A,
          existingQuoteId: quoteB.id,
          items: [{ productId: PROD_2, quantity: 5, unit: 'UN' }]
        })
      },
      /Acesso negado: o orçamento .* pertence/i,
      'createOrUpdateEnterpriseQuote permitiu sequestro de orçamento entre conversas'
    )

    // Confirma que os itens e totais do orçamento original de B permanecem intocados
    const pristineB = await getQuote({
      companyId: TENANT_A,
      quoteId: quoteB.id,
      conversationId: CONV_B,
      customerId: CUSTOMER_B
    })
    assert.ok(pristineB)
    assert.equal(pristineB.items.length, 1)
    assert.equal(pristineB.items[0].productId, PROD_1)
  })

  test('Gate 1 — Cenário 3: Working Memory adulterada com activeQuote.id de outra conversa é rejeitada', async () => {
    // Orçamento legítimo da Conversa B
    const quoteB = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_B,
      conversationId: CONV_B,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })

    // Conversa A tenta forjar memória com o ID de B
    const toolResult = await gerarOrcamentoTool.execute(
      { items: [{ product_id: PROD_2, quantity: 10 }] },
      {
        companyId: TENANT_A,
        conversationId: CONV_A,
        customerId: CUSTOMER_A,
        workingMemory: {
          activeQuote: { id: quoteB.id, total: 35.0, status: 'ready', version: 1 }
        }
      }
    )

    assert.equal(toolResult.success, false)
    assert.match(toolResult.error!, /Acesso negado/i)
  })

  test('Gate 1 — Cenário 4: Orçamento legado sem conversation_id é protegido contra clientes divergentes', async () => {
    const legacyId = '00000000-0000-0000-0000-000000000099'
    // Simula orçamento legado inserido sem conversation_id
    mockDb.quotes.push({
      id: legacyId,
      company_id: TENANT_A,
      customer_id: CUSTOMER_A,
      status: 'ready',
      total: 70.00,
      metadata: { version: 1 },
      created_at: new Date().toISOString()
    })

    // Cliente B não pode consultar nem atualizar o orçamento legado de Cliente A
    const crossGet = await getQuote({
      companyId: TENANT_A,
      quoteId: legacyId,
      customerId: CUSTOMER_B
    })
    assert.equal(crossGet, null)

    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: TENANT_A,
          customerId: CUSTOMER_B,
          conversationId: CONV_B,
          existingQuoteId: legacyId,
          items: [{ productId: PROD_2, quantity: 1, unit: 'UN' }]
        })
      },
      /Acesso negado/i
    )
  })

  // ============================================================================
  // GATE 2 — ATOMICIDADE FINANCEIRA E TRANSAÇÕES NO POSTGRESQL
  // ============================================================================

  test('Gate 2 — Cenário 5: Transação atômica executa cabeçalho, versão e itens em bloco único', async () => {
    const quote = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [
        { productId: PROD_1, quantity: 2, unit: 'UN' },
        { productId: PROD_2, quantity: 10, unit: 'UN' }
      ]
    })

    assert.ok(quote.id)
    assert.equal(quote.version, 1)
    assert.equal(quote.items.length, 2)
    assert.equal(quote.totalConfirmedCents, (2 * 3500) + (10 * 550)) // 70,00 + 55,00 = 125,00 (12500 cents)

    // Valida integridade referencial física no banco mock
    const dbQuote = mockDb.quotes.find((q: any) => q.id === quote.id)
    const dbItems = mockDb.quoteItems.filter((i: any) => i.quote_id === quote.id)

    assert.ok(dbQuote)
    assert.equal(dbItems.length, 2)
    assert.equal(dbQuote.total, 125.00)
  })

  test('Gate 2 — Cenário 6: Concorrência simultânea com a mesma expectedVersion rejeita a segunda mutação', async () => {
    const q1 = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })
    assert.equal(q1.version, 1)

    // Worker 1 atualiza esperando versão 1 -> sucesso para versão 2
    const q2 = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      existingQuoteId: q1.id,
      expectedVersion: 1,
      items: [{ productId: PROD_1, quantity: 3, unit: 'UN' }]
    })
    assert.equal(q2.version, 2)

    // Worker 2 (concorrente defasado) tenta atualizar esperando versão 1 -> DEVE FALHAR
    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: TENANT_A,
          customerId: CUSTOMER_A,
          conversationId: CONV_A,
          existingQuoteId: q1.id,
          expectedVersion: 1, // Conflito: banco já está na versão 2!
          items: [{ productId: PROD_1, quantity: 4, unit: 'UN' }]
        })
      },
      /Conflito de concorrência no orçamento/i
    )
  })

  test('Gate 2 — Cenário 7: Alteração de faixa de preço recalcula centavos e preserva monotonicidade de versões', async () => {
    // 2 unidades de SICAO -> faixa varejo (R$ 35,00 cada = R$ 70,00)
    const qVarejo = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 2, unit: 'UN' }]
    })
    assert.equal(qVarejo.totalConfirmedCents, 7000)

    // Atualiza para 10 unidades de SICAO -> ativa faixa atacado (R$ 30,00 cada = R$ 300,00)
    const qAtacado = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      existingQuoteId: qVarejo.id,
      expectedVersion: qVarejo.version,
      items: [{ productId: PROD_1, quantity: 10, unit: 'UN' }]
    })

    assert.equal(qAtacado.version, 2)
    assert.equal(qAtacado.totalConfirmedCents, 30000)
    assert.equal(qAtacado.items[0].priceType, 'wholesale')
    assert.ok(qAtacado.items[0].appliedRule.includes('10'))
  })

  test('Gate 2 — Cenário 8: getActiveQuoteForConversation recupera com precisão pós-reinício', async () => {
    await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_2, quantity: 6, unit: 'UN' }]
    })

    // Recupera diretamente sem passar IDs em memória
    const recovered = await getActiveQuoteForConversation(TENANT_A, CONV_A)
    assert.ok(recovered)
    assert.equal(recovered.status, 'ready')
    assert.equal(recovered.totalConfirmedCents, 3300) // 6 * 5.50 = 33.00
    assert.equal(recovered.items.length, 1)
  })

  // ============================================================================
  // GATE 3 — IDEMPOTÊNCIA PRÉ-LLM E DEDUPLICAÇÃO
  // ============================================================================

  test('Gate 3 — Cenário 9: Inserção concorrente com o mesmo event_id é deduplicada atomicamente via unique constraint', async () => {
    const payload: WebhookPayload = {
      event_id: 'evt-unique-test-1',
      event_type: 'message.create',
      channel: 'whatsapp',
      customer: { phone: '11999990001', name: 'Alice' },
      message: { content: 'Olá', sender_type: 'customer', external_id: 'ext-unique-1' }
    }

    // Primeiro worker insere com sucesso
    const res1 = await processWebhookEvent(TENANT_A, payload)
    assert.equal(res1.duplicate, false)
    assert.ok(res1.message_id)

    // Segundo worker tenta com o mesmo event_id -> constraint 23505 intercepta e retorna duplicate: true
    const res2 = await processWebhookEvent(TENANT_A, payload)
    assert.equal(res2.duplicate, true)
    assert.equal(res2.event_id, 'evt-unique-test-1')
  })

  test('Gate 3 — Cenário 10: Mesmo external_id com event_ids distintos é detectado pelo RPC e marca duplicate: true', async () => {
    const payloadA: WebhookPayload = {
      event_id: 'evt-first-delivery',
      event_type: 'message.create',
      channel: 'whatsapp',
      customer: { phone: '11999990001', name: 'Alice' },
      message: { content: 'Quero 5 chocolates', sender_type: 'customer', external_id: 'wamid-shared-external-id' }
    }

    const resA = await processWebhookEvent(TENANT_A, payloadA)
    assert.equal(resA.duplicate, false)
    assert.ok(resA.message_id)

    // Chega reentrega do WhatsApp com NOVO event_id mas MESMO external_id
    const payloadB: WebhookPayload = {
      event_id: 'evt-second-delivery-retry',
      event_type: 'message.create',
      channel: 'whatsapp',
      customer: { phone: '11999990001', name: 'Alice' },
      message: { content: 'Quero 5 chocolates', sender_type: 'customer', external_id: 'wamid-shared-external-id' }
    }

    const resB = await processWebhookEvent(TENANT_A, payloadB)
    assert.equal(resB.duplicate, true, 'Mensagem com mesmo external_id não foi marcada como duplicate')
    assert.equal(resB.message_id, resA.message_id)
  })

  test('Gate 3 — Cenário 11: handleAutonomousCycle deduplica pré-LLM se outbox já existe para trigger_message_id', async () => {
    const testMsgId = 'msg-existing-outbox-test'
    // Pré-cria outbox vinculada à mensagem
    mockDb.messageOutbox.push({
      id: 'outbox-1',
      company_id: TENANT_A,
      conversation_id: CONV_A,
      message_id: 'reply-msg-1',
      idempotency_key: 'agent-reply-evt-prior',
      metadata: { trigger_message_id: testMsgId },
      status: 'dispatched'
    })

    const cycleRes = await handleAutonomousCycle({
      companyId: TENANT_A,
      conversationId: CONV_A,
      messageId: testMsgId,
      eventId: 'evt-prior-retry',
      payload: {
        event_id: 'evt-prior-retry',
        event_type: 'message.create',
        channel: 'whatsapp',
        customer: { phone: '11999990001' },
        message: { content: 'Olá de novo', sender_type: 'customer' }
      }
    })

    assert.equal(cycleRes.reason, 'idempotent_duplicate')
    assert.equal(cycleRes.dispatched, false)
  })

  test('Gate 3 — Cenário 12: processCustomerMessageToQuote rejeita replay duplicado sem mutação no carrinho', async () => {
    const memory = {
      activeCart: [{ productId: PROD_1, name: 'Sicao 1kg', quantity: 2, unit: 'UN', isPriceConfirmed: true, status: 'confirmed' as const }],
      processedMessageIds: ['evt-replay-commercial-1']
    }

    const replayResult = await processCustomerMessageToQuote({
      companyId: TENANT_A,
      conversationId: CONV_A,
      message: 'adiciona mais 1 sicao',
      eventId: 'evt-replay-commercial-1', // Já processado
      workingMemory: memory
    })

    assert.equal(replayResult.actionTaken, 'idempotent_replay')
    assert.equal(replayResult.workingMemory.activeCart?.length, 1)
    assert.equal(replayResult.workingMemory.activeCart?.[0].quantity, 2) // Inalterado
  })
})
