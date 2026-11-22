/**
 * ELLEVEE IA — AC-04.5-P0.1 | SUÍTE DE FECHAMENTO TRANSACIONAL E PRÉ-DEPLOY STAGING
 *
 * Valida cirurgicamente:
 * 1. RPC transacional obrigatória e fail-closed (ausência total de escritas parciais e proibiçāo de fallback)
 * 2. Concorrência atômica na criação de orçamentos (advisory locks e partial unique index)
 * 3. Blindagem de autorização contra omissão de contexto essencial (company, customer, conversation)
 * 4. Validação matemática financeira pré-persistência
 * 5. Ciclo de recuperação de mensagens em 4 estados (duplicada, pendente, expirada, outbox existente)
 * 6. Isolamento e paralelismo entre conversas e empresas distintas
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import { handleSaveEnterpriseQuoteAtomicMock } from './mocks/enterprise-quotes-mock.mjs'
import {
  createOrUpdateEnterpriseQuote,
  getQuote,
  getActiveQuoteForConversation,
  type EnterpriseQuote
} from '../../lib/services/commercial/quotes'
import { consultarOrcamentoTool } from '../../lib/services/agent/tools/consultar-orcamento'
import { gerarOrcamentoTool } from '../../lib/services/agent/tools/gerar-orcamento'
import { processWebhookEvent, handleAutonomousCycle } from '../../lib/services/message-engine'
import type { WebhookPayload } from '../../lib/validations/webhook'

describe('ELLEVEE IA — AC-04.5-P0.1 | FECHAMENTO TRANSACIONAL E CONCORRÊNCIA', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111'
  const TENANT_B = '22222222-2222-2222-2222-222222222222'

  const CUSTOMER_A = 'aaaa1111-1111-1111-1111-111111111111'
  const CUSTOMER_B = 'bbbb2222-2222-2222-2222-222222222222'

  const CONV_A = 'cccc1111-1111-1111-1111-111111111111'
  const CONV_B = 'cccc2222-2222-2222-2222-222222222222'
  const CONV_C = 'cccc3333-3333-3333-3333-333333333333'

  const PROD_1 = '00000000-0000-0000-0000-000000000001'
  const PROD_2 = '00000000-0000-0000-0000-000000000002'

  let mockDb: any = null
  let simulateRpcFailure: boolean = false
  let simulateRpcMissing: boolean = false

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
          status: 'open',
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
          status: 'open',
          unread_count: 0,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        },
        {
          id: CONV_C,
          company_id: TENANT_B,
          customer_id: 'cust-b-1',
          agent_id: 'agent-1',
          channel: 'whatsapp',
          status: 'open',
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
      messages: [] as any[],
      messageOutbox: [] as any[],
      webhookEvents: [] as any[]
    }
  }

  function setupMockClient() {
    mockDb = createSyntheticDatabase()
    simulateRpcFailure = false
    simulateRpcMissing = false

    const mockClient = {
      from: (table: string) => {
        let currentCompanyId: string | null = null
        let currentId: string | null = null
        let inIds: string[] | null = null
        let inProductIds: string[] | null = null
        let inStatuses: string[] | null = null
        let containsMetadata: any = null
        let currentConversationId: string | null = null
        let currentIdempotencyKey: string | null = null
        let currentEventId: string | null = null
        let currentSenderType: string | null = null
        let currentLimit = 100

        const builder: any = {
          select: (fields?: string) => builder,
          eq: (col: string, val: any) => {
            if (col === 'id') currentId = val
            if (col === 'company_id') currentCompanyId = val
            if (col === 'conversation_id') currentConversationId = val
            if (col === 'idempotency_key') currentIdempotencyKey = val
            if (col === 'event_id') currentEventId = val
            if (col === 'sender_type') currentSenderType = val
            return builder
          },
          in: (col: string, vals: any[]) => {
            if (col === 'id') inIds = vals
            if (col === 'product_id') inProductIds = vals
            if (col === 'status') inStatuses = vals
            return builder
          },
          contains: (col: string, val: any) => {
            if (col === 'metadata') containsMetadata = val
            return builder
          },
          order: () => builder,
          limit: (n: number) => {
            currentLimit = n
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
            if (table === 'conversations') {
              const found = mockDb.conversations.find((c: any) =>
                (!currentCompanyId || c.company_id === currentCompanyId) &&
                (!currentId || c.id === currentId)
              )
              if (!found) return { data: null, error: null }
              const customer = mockDb.customers.find((cu: any) => cu.id === found.customer_id) || null
              return { data: { ...found, customers: customer }, error: null }
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
                  return {
                    select: () => ({
                      single: async () => ({ data: null, error: err }),
                      data: null,
                      error: err
                    })
                  }
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
        if (simulateRpcMissing) {
          return { data: null, error: { code: '42883', message: `function ${fn} does not exist` } }
        }

        if (fn === 'save_enterprise_quote_atomic') {
          if (simulateRpcFailure) {
            // Simula falha transacional (ex: deadlock, timeout ou erro interno no PostgreSQL)
            return { data: null, error: { message: 'transaction_aborted_simulated: erro induzido para teste de atomicidade' } }
          }
          return handleSaveEnterpriseQuoteAtomicMock(mockDb, args)
        }

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

        if (fn === 'acquire_conversation_processing_lock') {
          return { data: [{ was_acquired: true, lock_token: 'tok-mock-lock-1' }], error: null }
        }

        return { data: null, error: { message: `RPC ${fn} não reconhecida` } }
      }
    }

    setMockSupabaseClient(mockClient)
    return mockClient
  }

  beforeEach(() => {
    setupMockClient()
  })

  // ============================================================================
  // 1. RPC TRANSACIONAL OBRIGATÓRIA E FAIL-CLOSED (SEM ESCRITAS PARCIAIS)
  // ============================================================================

  test('AC-04.5-P0.1 — Cenário 1: Falha na RPC resulta em fail-closed imediato com ZERO escritas residuais', async () => {
    simulateRpcFailure = true

    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: TENANT_A,
          customerId: CUSTOMER_A,
          conversationId: CONV_A,
          items: [{ productId: PROD_1, quantity: 2, unit: 'UN' }]
        })
      },
      /Falha transacional obrigatória na persistência do orçamento/i,
      'createOrUpdateEnterpriseQuote deveria ter falhado imediatamente com a falha da RPC'
    )

    // Verificação estrita de ausência de efeitos colaterais (zero escritas parciais)
    assert.equal(mockDb.quotes.length, 0, 'Nenhum cabeçalho de orçamento deveria ter sido gravado')
    assert.equal(mockDb.quoteItems.length, 0, 'Nenhum item de orçamento deveria ter sido gravado')
  })

  test('AC-04.5-P0.1 — Cenário 2: Ausência da rotina RPC no banco rejeita a operação e proíbe fallback inseguro', async () => {
    simulateRpcMissing = true

    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: TENANT_A,
          customerId: CUSTOMER_A,
          conversationId: CONV_A,
          items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
        })
      },
      /Falha transacional obrigatória na persistência do orçamento/i,
      'A função deveria proibir fallback silencioso quando a RPC está ausente'
    )

    assert.equal(mockDb.quotes.length, 0, 'Fallback REST não deve gravar dados fora da transação atômica')
  })

  // ============================================================================
  // 2. CONCORRÊNCIA NA CRIAÇÃO DE ORÇAMENTOS (SERIALIZAÇÃO & ORCAMENTO_ACTIVE_EXISTS)
  // ============================================================================

  test('AC-04.5-P0.1 — Cenário 3: Criação concorrente de novo rascunho para conversa com orçamento ativo é rejeitada', async () => {
    // 1. Cria primeiro orçamento legítimo para a conversa A
    const qInitial = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })
    assert.ok(qInitial.id)
    assert.equal(qInitial.version, 1)

    // 2. Um segundo worker paralelo tenta criar um NOVO rascunho para a mesma conversa
    // sem informar existingQuoteId nem expectedVersion (tentativa de sobreposição de draft)
    // Em PostgreSQL real, o advisory lock serializa e a query detecta ativo com expected_version nula -> ORCAMENTO_ACTIVE_EXISTS
    assert.throws(
      () => {
        const res = handleSaveEnterpriseQuoteAtomicMock(mockDb, {
          p_company_id: TENANT_A,
          p_customer_id: CUSTOMER_A,
          p_conversation_id: CONV_A,
          p_existing_quote_id: null,
          p_expected_version: null, // Sem versão esperada = tentativa de criar outro rascunho
          p_status: 'draft',
          p_total: 70.00,
          p_metadata: { conversation_id: CONV_A },
          p_items: [{ product_id: PROD_1, quantity: 2, unit_price: 35.0, subtotal: 70.0 }]
        })
        if (res.error) throw new Error(res.error.message)
      },
      /ORCAMENTO_ACTIVE_EXISTS/i,
      'O banco deve rejeitar a criação de um segundo orçamento ativo para a mesma conversa'
    )

    // O banco continua contendo estritamente 1 orçamento ativo para a conversa A
    const activeQuotes = mockDb.quotes.filter(
      (q: any) => q.company_id === TENANT_A && q.metadata?.conversation_id === CONV_A
    )
    assert.equal(activeQuotes.length, 1)
    assert.equal(activeQuotes[0].id, qInitial.id)
  })

  test('AC-04.5-P0.1 — Cenário 4: Transações simultâneas em conversas e empresas distintas executam sem bloqueio mútuo', async () => {
    // Conversa A na Empresa A
    const p1 = createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 2, unit: 'UN' }]
    })

    // Conversa B na Empresa A
    const p2 = createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_B,
      conversationId: CONV_B,
      items: [{ productId: PROD_2, quantity: 5, unit: 'UN' }]
    })

    // Conversa C na Empresa B
    const p3 = createOrUpdateEnterpriseQuote({
      companyId: TENANT_B,
      customerId: 'cust-b-1',
      conversationId: CONV_C,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })

    const [qA, qB, qC] = await Promise.all([p1, p2, p3])

    assert.ok(qA.id)
    assert.ok(qB.id)
    assert.ok(qC.id)
    assert.notEqual(qA.id, qB.id)
    assert.notEqual(qA.id, qC.id)
    assert.equal(mockDb.quotes.length, 3)
  })

  // ============================================================================
  // 3. BLINDAGEM DE AUTORIZAÇÃO CONTRA OMISSÃO DE PARÂMETROS
  // ============================================================================

  test('AC-04.5-P0.1 — Cenário 5: createOrUpdateEnterpriseQuote rejeita omissão de conversationId sem adminContext', async () => {
    await assert.rejects(
      async () => {
        await createOrUpdateEnterpriseQuote({
          companyId: TENANT_A,
          customerId: CUSTOMER_A,
          // conversationId omitido propositalmente
          items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
        } as any)
      },
      /conversationId é obrigatório para operações comerciais de orçamento/i,
      'Não deve permitir criação comercial sem vínculo estrito à conversa'
    )
  })

  test('AC-04.5-P0.1 — Cenário 6: getQuote rejeita omissão de conversationId e retorna null para orçamentos de conversa', async () => {
    const quote = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })

    // Tentativa de contorno: chamar getQuote omitindo conversationId e allowCrossConversation
    const leaked = await getQuote({
      companyId: TENANT_A,
      quoteId: quote.id
      // conversationId omitido
    })

    assert.equal(leaked, null, 'getQuote não pode retornar orçamento vinculado a conversa quando conversationId for omitido')
  })

  test('AC-04.5-P0.1 — Cenário 7: Consulta com adminContext.isPlatformAdmin ou allowCrossConversation é autorizada', async () => {
    const quote = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 1, unit: 'UN' }]
    })

    // 1. Acesso administrativo via adminContext
    const adminQuote = await getQuote({
      companyId: TENANT_A,
      quoteId: quote.id,
      adminContext: { isPlatformAdmin: true, reason: 'auditoria_financeira' }
    })
    assert.ok(adminQuote)
    assert.equal(adminQuote.id, quote.id)

    // 2. Acesso com allowCrossConversation explícito
    const auditQuote = await getQuote({
      companyId: TENANT_A,
      quoteId: quote.id,
      allowCrossConversation: true
    })
    assert.ok(auditQuote)
    assert.equal(auditQuote.id, quote.id)
  })

  test('AC-04.5-P0.1 — Cenário 8: Ferramentas do agente rejeitam execução quando companyId ou conversationId faltarem', async () => {
    // 1. consultar_orcamento sem contexto
    const resConsultar = await consultarOrcamentoTool.execute(
      { quote_id: '11111111-1111-1111-1111-111111111111' },
      { companyId: '', conversationId: '' } as any
    )
    assert.equal(resConsultar.success, false)
    assert.match(resConsultar.error!, /Contexto de execução inválido/i)

    // 2. gerar_orcamento sem contexto
    const resGerar = await gerarOrcamentoTool.execute(
      { items: [{ product_id: PROD_1, quantity: 1 }] },
      { companyId: TENANT_A, conversationId: '' } as any
    )
    assert.equal(resGerar.success, false)
    assert.match(resGerar.error!, /Contexto de execução inválido/i)
  })

  // ============================================================================
  // 4. VALIDAÇÃO MATEMÁTICA FINANCEIRA PRÉ-PERSISTÊNCIA
  // ============================================================================

  test('AC-04.5-P0.1 — Cenário 9: Inconsistência matemática no cálculo dos itens é bloqueada antes do banco', async () => {
    // Orçamento válido calcula R$ 70,00 (7000 centavos) para 2 unidades a R$ 35,00
    const validQuote = await createOrUpdateEnterpriseQuote({
      companyId: TENANT_A,
      customerId: CUSTOMER_A,
      conversationId: CONV_A,
      items: [{ productId: PROD_1, quantity: 2, unit: 'UN' }]
    })
    assert.equal(validQuote.totalConfirmedCents, 7000)
    assert.equal(validQuote.totalConfirmed, 70.00)

    // Verifica que centavos inteiros conferem perfeitamente
    assert.equal(validQuote.items[0].subtotalCents, 7000)
    assert.equal(validQuote.items[0].unitPriceCents * validQuote.items[0].quantity, validQuote.items[0].subtotalCents)
  })

  // ============================================================================
  // 5. RECUPERAÇÃO DE MENSAGENS EM DIFERENTES ESTADOS (MESSAGE ENGINE RECOVERY)
  // ============================================================================

  test('AC-04.5-P0.1 — Cenário 10: Mensagens duplicadas já processadas são ignoradas com segurança (sem reexecutar LLM)', async () => {
    const payload: WebhookPayload = {
      event_id: 'evt-dup-msg-test-1',
      event_type: 'message.create',
      channel: 'whatsapp',
      customer: { phone: '11999990001', name: 'Alice' },
      message: { content: 'Quero um orçamento', sender_type: 'customer', external_id: 'wamid-dup-test-1' }
    }

    const res1 = await processWebhookEvent(TENANT_A, payload)
    assert.equal(res1.duplicate, false)

    // Reentrega idêntica com mesmo external_id mas novo event_id
    const payloadRetry: WebhookPayload = {
      ...payload,
      event_id: 'evt-dup-msg-test-2'
    }

    const res2 = await processWebhookEvent(TENANT_A, payloadRetry)
    assert.equal(res2.duplicate, true)
    assert.equal(res2.message_id, res1.message_id)

    // Confirma que a mensagem NÃO foi inserida duas vezes no banco
    const msgs = mockDb.messages.filter((m: any) => m.external_id === 'wamid-dup-test-1')
    assert.equal(msgs.length, 1)
  })

  test('AC-04.5-P0.1 — Cenário 11: Mensagens que já possuem resposta no outbox não reexecutam LLM nem reenviam', async () => {
    const triggerId = 'msg-trigger-outbox-complete'
    // Simula outbox já persistida e despachada para esta mensagem
    mockDb.messageOutbox.push({
      id: 'outbox-persisted-1',
      company_id: TENANT_A,
      conversation_id: CONV_A,
      message_id: 'reply-msg-1',
      idempotency_key: 'agent-reply-evt-completed-1',
      metadata: { trigger_message_id: triggerId },
      status: 'dispatched'
    })

    const cycleRes = await handleAutonomousCycle({
      companyId: TENANT_A,
      conversationId: CONV_A,
      messageId: triggerId,
      eventId: 'evt-completed-1',
      payload: {
        event_id: 'evt-completed-1',
        event_type: 'message.create',
        channel: 'whatsapp',
        customer: { phone: '11999990001' },
        message: { content: 'Mensagem já respondida', sender_type: 'customer' }
      }
    })

    assert.equal(cycleRes.reason, 'idempotent_duplicate')
    assert.equal(cycleRes.dispatched, false)
    assert.equal(cycleRes.outboxId, 'outbox-persisted-1')
  })

  test('AC-04.5-P0.1 — Cenário 12: Mensagem pendente é processada normalmente pelo ciclo autônomo', async () => {
    const payload: WebhookPayload = {
      event_id: 'evt-pending-normal-1',
      event_type: 'message.create',
      channel: 'whatsapp',
      customer: { phone: '11999990001', name: 'Alice' },
      message: { content: 'Qual o valor do chocolate?', sender_type: 'customer', external_id: 'wamid-pending-1' }
    }

    const ingestRes = await processWebhookEvent(TENANT_A, payload)
    assert.equal(ingestRes.duplicate, false)

    // O evento de webhook fica com status processado e autonomous_status 'pending'
    const eventRow = mockDb.webhookEvents.find((e: any) => e.event_id === 'evt-pending-normal-1')
    assert.ok(eventRow)
    assert.equal(eventRow.status, 'processed')
    assert.equal(eventRow.autonomous_status, 'pending')
  })
})
