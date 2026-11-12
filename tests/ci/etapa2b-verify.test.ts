// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import {
  processWebhookEvent,
  handleAutonomousCycle,
  updateMessageDeliveryStatus
} from '@/lib/services/message-engine'
import { reconcileStalledWebhookEventsBatch } from '@/lib/services/outbox-worker'
import { GET as cronGet } from '@/app/api/cron/outbox-worker/route'
import { setMockHttpHandler } from '@/lib/services/n8n-internal'
import { resolveToolScope, hasClearProductIntent } from '@/lib/services/agent/tool-scoping'
import { transferirParaHumanoTool } from '@/lib/services/agent/tools/transferir-para-humano'
import { buildAgentContext } from '@/lib/services/agent/context-builder'
import { maybeRefreshConversationSummary } from '@/lib/services/agent/conversation-summary'
import { runAgentEngine } from '@/lib/services/agent/engine'

const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
const CONV_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
const AGENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'
const CUST_ID = 'ffffffff-ffff-ffff-ffff-fffffffffff1'
const MSG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
const EVT_ROW_ID = '99999999-9999-9999-9999-999999999991'

function create2BMockSupabase(overrides = {}) {
  const rpcCalls = []
  const updates = {
    webhook_events: [],
    conversations: [],
    message_outbox: [],
    gateway_outbound_locks: []
  }
  const inserts = {
    webhook_events: [],
    messages: [],
    agent_runs: []
  }

  const state = {
    conversationStatus: 'open',
    conversationSummary: null,
    conversationSummaryCount: 0,
    messages: new Map([
      [MSG_ID, {
        id: MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONV_ID,
        external_id: null,
        metadata: { delivery_status: 'pending' }
      }]
    ]),
    outboxByProviderId: new Map(),
    webhookEvents: new Map([
      [EVT_ROW_ID, {
        id: EVT_ROW_ID,
        company_id: COMPANY_ID,
        event_id: 'evt-retry-1',
        event_type: 'message.received',
        status: 'error',
        payload: {
          event_id: 'evt-retry-1',
          event_type: 'message.received',
          channel: 'whatsapp',
          customer: { phone: '5511999990001', name: 'Ana Silva' },
          message: { content: 'Quero ajuda humana', message_type: 'text', sender_type: 'customer' }
        }
      }]
    ]),
    rpcCalls,
    updates,
    inserts
  }

  function makeQuery(table) {
    const filters = {}
    let pendingUpdate = null
    let pendingInsert = null
    let selectCols = '*'
    let selectOpts = null

    const chain = {
      select(cols = '*', opts = null) {
        selectCols = cols
        selectOpts = opts
        return chain
      },
      eq(col, val) { filters[col] = val; return chain },
      in(col, val) { filters[`__in_${col}`] = val; return chain },
      not() { return chain },
      order() { return chain },
      limit() { return chain },
      update(payload) { pendingUpdate = payload; return chain },
      insert(payload) { pendingInsert = payload; return chain },
      async single() {
        if (overrides.onTable) {
          const r = await overrides.onTable(table, 'single', { filters, pendingUpdate, pendingInsert, state })
          if (r !== undefined) return r
        }
        if (table === 'companies') {
          return { data: { id: COMPANY_ID, status: 'active', name: 'Ellevée Loja' }, error: null }
        }
        if (table === 'integrations') {
          return {
            data: {
              id: 'int-1',
              company_id: COMPANY_ID,
              type: 'n8n',
              status: 'active',
              config: { webhook_url: 'https://n8n.example.com/webhook/send' },
              credentials: { webhook_secret: 'sec-123' }
            },
            error: null
          }
        }
        if (table === 'webhook_events' && pendingInsert) {
          const rec = { id: EVT_ROW_ID, ...pendingInsert }
          inserts.webhook_events.push(rec)
          return { data: rec, error: null }
        }
        if (table === 'customers') {
          return {
            data: { id: CUST_ID, company_id: COMPANY_ID, name: 'Ana Silva', phone: '5511999990001', name_confirmed: true },
            error: null
          }
        }
        if (table === 'conversations') {
          return {
            data: {
              id: filters.id || CONV_ID,
              company_id: COMPANY_ID,
              status: state.conversationStatus,
              channel: 'whatsapp',
              agent_id: AGENT_ID,
              customer_id: CUST_ID,
              workflow_stage_id: 'wf-1',
              summary: state.conversationSummary,
              summary_message_count: state.conversationSummaryCount,
              customers: { id: CUST_ID, name: 'Ana Silva', phone: '5511999990001', name_confirmed: true }
            },
            error: null
          }
        }
        if (table === 'agents') {
          return {
            data: { id: AGENT_ID, company_id: COMPANY_ID, name: 'Bot', is_active: true, provider: 'openai', model: 'gpt-4o-mini' },
            error: null
          }
        }
        if (table === 'messages' && pendingInsert) {
          const rec = { id: 'msg-inserted-1', ...pendingInsert }
          inserts.messages.push(rec)
          return { data: rec, error: null }
        }
        return { data: null, error: null }
      },
      async maybeSingle() {
        if (overrides.onTable) {
          const r = await overrides.onTable(table, 'maybeSingle', { filters, pendingUpdate, pendingInsert, state })
          if (r !== undefined) return r
        }
        if (table === 'companies') {
          return { data: { id: COMPANY_ID, status: 'active', name: 'Ellevée Loja' }, error: null }
        }
        if (table === 'customers') {
          return {
            data: { id: CUST_ID, name: 'Ana Silva', phone: '5511999990001', name_confirmed: true, name_source: 'whatsapp_push' },
            error: null
          }
        }
        if (table === 'conversations') {
          return {
            data: {
              id: filters.id || CONV_ID,
              company_id: COMPANY_ID,
              status: state.conversationStatus,
              channel: 'whatsapp',
              agent_id: AGENT_ID,
              customer_id: CUST_ID,
              workflow_stage_id: 'wf-1'
            },
            error: null
          }
        }
        if (table === 'webhook_events') {
          return { data: state.webhookEvents.get(filters.id) || null, error: null }
        }
        if (table === 'messages') {
          if (filters.id && state.messages.has(filters.id)) {
            return { data: state.messages.get(filters.id), error: null }
          }
          return { data: null, error: null }
        }
        if (table === 'message_outbox') {
          if (filters.provider_message_id && state.outboxByProviderId.has(filters.provider_message_id)) {
            return { data: state.outboxByProviderId.get(filters.provider_message_id), error: null }
          }
          return { data: null, error: null }
        }
        return { data: null, error: null }
      },
      then(resolve, reject) {
        Promise.resolve().then(async () => {
          if (overrides.onTable) {
            const r = await overrides.onTable(table, 'then', { filters, pendingUpdate, pendingInsert, selectOpts, state })
            if (r !== undefined) return r
          }
          if (pendingUpdate) {
            if (table === 'webhook_events') updates.webhook_events.push({ filters: { ...filters }, payload: pendingUpdate })
            if (table === 'conversations') {
              updates.conversations.push({ filters: { ...filters }, payload: pendingUpdate })
              if (pendingUpdate.status) state.conversationStatus = pendingUpdate.status
              if (pendingUpdate.summary !== undefined) {
                state.conversationSummary = pendingUpdate.summary
                state.conversationSummaryCount = pendingUpdate.summary_message_count
              }
            }
            if (table === 'message_outbox') updates.message_outbox.push({ filters: { ...filters }, payload: pendingUpdate })
            if (table === 'gateway_outbound_locks') updates.gateway_outbound_locks.push({ filters: { ...filters }, payload: pendingUpdate })
            return { data: null, error: null }
          }
          if (pendingInsert) {
            if (table === 'messages') inserts.messages.push(pendingInsert)
            if (table === 'agent_runs') inserts.agent_runs.push(pendingInsert)
            return { data: pendingInsert, error: null }
          }
          if (table === 'products' && selectOpts?.head) {
            return { count: 0, data: null, error: null }
          }
          if (table === 'messages' && selectOpts?.head) {
            return { count: overrides.messageCount ?? 5, data: null, error: null }
          }
          if (table === 'messages') {
            return { data: overrides.historyMessages || [], error: null }
          }
          return { data: [], error: null }
        }).then(resolve, reject)
      }
    }
    return chain
  }

  const client = {
    state,
    from(table) {
      return makeQuery(table)
    },
    async rpc(fnName, args) {
      rpcCalls.push({ fnName, args })
      if (overrides.onRpc) {
        const r = await overrides.onRpc(fnName, args, state)
        if (r !== undefined) return r
      }
      if (fnName === 'insert_message_idempotent') {
        return { data: [{ message_id: MSG_ID, was_inserted: true }], error: null }
      }
      if (fnName === 'acquire_conversation_processing_lock') {
        return { data: [{ was_acquired: true, lock_token: 'lock-tok-1', locked_until: new Date(Date.now() + 65000).toISOString() }], error: null }
      }
      if (fnName === 'release_conversation_processing_lock') {
        return { data: true, error: null }
      }
      if (fnName === 'complete_webhook_autonomous_event') {
        return { data: true, error: null }
      }
      if (fnName === 'claim_stalled_outbox_batch') {
        return { data: [], error: null }
      }
      if (fnName === 'claim_stalled_webhook_events_batch') {
        return { data: [], error: null }
      }
      if (fnName === 'create_outbound_message_atomic') {
        return { data: [{ was_inserted: true, duplicate: false, message_id: 'reply-msg-1', outbox_id: 'outbox-1', status: 'pending' }], error: null }
      }
      if (fnName === 'claim_outbox_message') {
        return { data: [{ was_claimed: true, claim_token: 'claim-1', claim_version: 1, payload: args.payload || null }], error: null }
      }
      if (fnName === 'complete_outbox_message') {
        return { data: [{ was_completed: true }], error: null }
      }
      if (fnName === 'acquire_gateway_outbound_lock') {
        return { data: [{ was_acquired: true, claim_token: 'gw-1', status: 'in_flight' }], error: null }
      }
      if (fnName === 'complete_gateway_outbound_lock') {
        return { data: [{ was_completed: true }], error: null }
      }
      if (fnName === 'merge_message_metadata_monotonic') {
        const msg = state.messages.get(args.p_message_id)
        const merged = { ...(msg?.metadata || {}), ...(args.p_metadata_patch || {}) }
        if (msg) msg.metadata = merged
        return { data: [{ was_updated: true, final_metadata: merged, current_status: merged.delivery_status }], error: null }
      }
      return { data: null, error: null }
    }
  }

  return client
}

describe('ETAPA 2B — Resiliência, Lock de Conversa, Handoff Real, Reconciliação Outbox e Memória Persistente', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-2b-secret'
    setMockHttpHandler(null)
  })

  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('1. Degradação graciosa se migration 2B ainda não rodou (42703 / 42883 / PGRST202)', async () => {
    let attemptedRichWebhookUpdate = false
    const client = create2BMockSupabase({
      messageCount: 15,
      historyMessages: [{ sender_type: 'customer', content: 'Oi, quero um orçamento.', created_at: new Date().toISOString() }],
      onTable(table, op, { pendingUpdate }) {
        if (table === 'webhook_events' && op === 'then' && pendingUpdate && 'autonomous_status' in pendingUpdate) {
          attemptedRichWebhookUpdate = true
          return { data: null, error: { code: '42703', message: 'column "autonomous_status" does not exist' } }
        }
        if (table === 'conversations' && op === 'then' && pendingUpdate && 'summary' in pendingUpdate) {
          return { data: null, error: { code: '42703', message: 'column "summary" does not exist' } }
        }
      },
      onRpc(fnName) {
        if (fnName === 'acquire_conversation_processing_lock') {
          return { data: null, error: { code: '42883', message: 'function acquire_conversation_processing_lock does not exist' } }
        }
        if (fnName === 'claim_stalled_webhook_events_batch') {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.claim_stalled_webhook_events_batch' } }
        }
      }
    })
    setMockSupabaseClient(client)

    const ingestRes = await processWebhookEvent(COMPANY_ID, {
      event_id: 'evt-pre-mig-1',
      event_type: 'message.received',
      channel: 'whatsapp',
      customer: { phone: '5511999990001', name: 'Ana Silva' },
      message: { content: 'Oi', message_type: 'text', sender_type: 'customer' }
    }, { adminClient: client })

    assert.equal(ingestRes.success, true)
    assert.equal(attemptedRichWebhookUpdate, true, 'Deve tentar patch rico inicialmente')
    assert.equal(client.state.updates.webhook_events.length, 1, 'Deve aplicar patch legado fallback sem erro após 42703')
    assert.equal(client.state.updates.webhook_events[0].payload.status, 'processed')

    const recoveryRes = await reconcileStalledWebhookEventsBatch({ adminClient: client })
    assert.equal(recoveryRes.processed, 0)
    assert.equal(recoveryRes.skipped_rpc_unavailable, true)

    const summaryRes = await maybeRefreshConversationSummary({
      supabase: client,
      provider: { generateResponse: async () => ({ content: 'Resumo curto da conversa.', usage: {} }) },
      model: 'gpt-4o-mini',
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      previousSummary: null,
      previousSummaryMessageCount: 0,
      availableRecentCount: 15,
      remainingBudgetMs: 12000
    })
    assert.equal(summaryRes.updated, false)
    assert.equal(summaryRes.reason, 'column_missing')

    client.state.conversationStatus = 'human'
    const cycleRes = await handleAutonomousCycle({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      messageId: MSG_ID,
      eventId: 'evt-pre-mig-cycle',
      payload: {
        event_id: 'evt-pre-mig-cycle',
        event_type: 'message.received',
        channel: 'whatsapp',
        customer: { phone: '5511999990001', name: 'Ana Silva' },
        message: { content: 'Oi', message_type: 'text', sender_type: 'customer' }
      }
    }, { adminClient: client })
    assert.equal(cycleRes.reason, 'human_mode_active')
  })

  test('2. Lock de conversa serializa concorrência: lock ocupado adia para pending sem chamar LLM e release ocorre em finally mesmo em erro', async () => {
    let lockMode = 'busy'
    const client = create2BMockSupabase({
      onRpc(fnName) {
        if (fnName === 'acquire_conversation_processing_lock') {
          if (lockMode === 'busy') {
            return { data: [{ was_acquired: false, lock_token: null, locked_until: new Date(Date.now() + 30000).toISOString() }], error: null }
          }
          return { data: [{ was_acquired: true, lock_token: 'tok-err-99', locked_until: new Date(Date.now() + 65000).toISOString() }], error: null }
        }
      }
    })
    setMockSupabaseClient(client)

    let llmCalled = 0
    const mockLLM = {
      generateResponse: async () => {
        llmCalled++
        return { content: 'Olá', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
      }
    }

    const busyRes = await handleAutonomousCycle({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      messageId: MSG_ID,
      eventId: 'evt-lock-busy',
      webhookEventRowId: EVT_ROW_ID,
      autonomousClaimToken: 'claim-worker-1',
      payload: {
        event_id: 'evt-lock-busy',
        event_type: 'message.received',
        channel: 'whatsapp',
        customer: { phone: '5511999990001', name: 'Ana Silva' },
        message: { content: 'Segunda msg rápida', message_type: 'text', sender_type: 'customer' }
      },
      llmProvider: mockLLM
    }, { adminClient: client })

    assert.equal(busyRes.executed, false)
    assert.equal(busyRes.reason, 'conversation_lock_busy')
    assert.equal(llmCalled, 0, 'Não pode invocar LLM quando outro worker detém o lock da conversa')

    const deferredWebhookComplete = client.state.rpcCalls.find(c => c.fnName === 'complete_webhook_autonomous_event')
    assert.equal(deferredWebhookComplete.args.p_autonomous_status, 'pending')
    assert.equal(deferredWebhookComplete.args.p_last_error, 'conversation_lock_busy')

    // Agora o lock é adquirido, porém ocorre erro inesperado em executeLockedAutonomousCycle -> lock precisa ser liberado no finally
    lockMode = 'acquire'
    const clientThrows = create2BMockSupabase({
      onTable(table, op) {
        if (table === 'conversations' && op === 'single') {
          throw new Error('Falha inesperada simulada de rede no meio do ciclo')
        }
      }
    })
    setMockSupabaseClient(clientThrows)

    await assert.rejects(
      () => handleAutonomousCycle({
        companyId: COMPANY_ID,
        conversationId: CONV_ID,
        messageId: MSG_ID,
        eventId: 'evt-lock-throw',
        webhookEventRowId: EVT_ROW_ID,
        payload: {
          event_id: 'evt-lock-throw',
          event_type: 'message.received',
          channel: 'whatsapp',
          customer: { phone: '5511999990001', name: 'Ana Silva' },
          message: { content: 'Oi', message_type: 'text', sender_type: 'customer' }
        }
      }, { adminClient: clientThrows }),
      /Falha inesperada simulada/
    )

    const releaseCall = clientThrows.state.rpcCalls.find(c => c.fnName === 'release_conversation_processing_lock')
    assert.ok(releaseCall, 'Lock deve ser liberado obrigatoriamente no bloco finally')
    assert.equal(releaseCall.args.p_lock_token, 'lock-tok-1')
  })

  test('3. Handoff real (transferir_para_humano): scoping cirúrgico + envio da despedida sem supressão + bloqueio no próximo turno', async () => {
    const toolsPool = [
      { name: 'consultar_produto_comercial', description: 'busca', schema: {} , metadata: { category: 'commercial' }, execute: async () => {} },
      { name: 'get_current_datetime', description: 'hora', schema: {}, metadata: { category: 'datetime' }, execute: async () => {} },
      transferirParaHumanoTool
    ]

    assert.equal(hasClearProductIntent('Quero falar com um atendente humano'), false)
    assert.equal(hasClearProductIntent('Me passa para um vendedor'), false)

    const handoffScoped = resolveToolScope('Quero falar com um atendente humano por favor', [], toolsPool, null, { hasConfirmedCustomerName: true })
    assert.deepEqual(handoffScoped.map(t => t.name), ['transferir_para_humano'])

    const institutionalSupport = resolveToolScope('Qual o telefone do suporte?', [], toolsPool, null, { hasConfirmedCustomerName: true })
    assert.deepEqual(institutionalSupport, [], 'Pergunta institucional sem pedido de transferência continua com []')

    const client = create2BMockSupabase()
    setMockSupabaseClient(client)

    let httpSentText = null
    setMockHttpHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body)
      httpSentText = body?.message?.content
      return { ok: true, status: 200, text: async () => JSON.stringify({ provider_message_id: 'wamid.handoff.1' }) }
    })

    let round = 0
    const mockLLM = {
      generateResponse: async () => {
        round++
        if (round === 1) {
          return {
            content: null,
            tool_calls: [{ callId: 'tc-handoff', toolName: 'transferir_para_humano', arguments: { reason: 'Cliente solicitou atendente', department: 'vendas' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }
        }
        return {
          content: 'Certo! Já transferi seu atendimento para um de nossos atendentes humanos, que responderá em instantes.',
          tool_calls: [],
          usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 }
        }
      }
    }

    const cycle1 = await handleAutonomousCycle({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      messageId: MSG_ID,
      eventId: 'evt-handoff-turn-1',
      webhookEventRowId: EVT_ROW_ID,
      payload: {
        event_id: 'evt-handoff-turn-1',
        event_type: 'message.received',
        channel: 'whatsapp',
        customer: { phone: '5511999990001', name: 'Ana Silva' },
        message: { content: 'Quero falar com um atendente humano por favor', message_type: 'text', sender_type: 'customer' }
      },
      llmProvider: mockLLM
    }, { adminClient: client })

    assert.equal(cycle1.dispatched, true, 'Despedida da própria IA após transferir_para_humano NÃO deve ser suprimida')
    assert.ok(httpSentText.includes('transferi seu atendimento'))
    assert.equal(client.state.conversationStatus, 'human', 'Conversa deve ter migrado para status=human no banco')
    assert.ok(client.state.inserts.messages.some(m => m.sender_type === 'system' && m.message_type === 'event'))

    // Próxima mensagem do cliente não recebe resposta autônoma porque agora está em human mode
    const cycle2 = await handleAutonomousCycle({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      messageId: MSG_ID,
      eventId: 'evt-handoff-turn-2',
      payload: {
        event_id: 'evt-handoff-turn-2',
        event_type: 'message.received',
        channel: 'whatsapp',
        customer: { phone: '5511999990001', name: 'Ana Silva' },
        message: { content: 'Oi, tem alguém aí?', message_type: 'text', sender_type: 'customer' }
      },
      llmProvider: mockLLM
    }, { adminClient: client })
    assert.equal(cycle2.executed, false)
    assert.equal(cycle2.reason, 'human_mode_active')

    // Agora garante que se um HUMANO assumir externamente no dashboard (sem tool da IA), a resposta continua suprimida
    const clientHumanTakeover = create2BMockSupabase()
    setMockSupabaseClient(clientHumanTakeover)
    const mockLLMSimple = {
      generateResponse: async () => {
        clientHumanTakeover.state.conversationStatus = 'human' // Humano clicou Assumir Conversa durante inferência
        return { content: 'Oi, em que posso ajudar?', tool_calls: [], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }
      }
    }
    const cycleRace = await handleAutonomousCycle({
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      messageId: MSG_ID,
      eventId: 'evt-external-takeover-race',
      payload: {
        event_id: 'evt-external-takeover-race',
        event_type: 'message.received',
        channel: 'whatsapp',
        customer: { phone: '5511999990001', name: 'Ana Silva' },
        message: { content: 'Oi', message_type: 'text', sender_type: 'customer' }
      },
      llmProvider: mockLLMSimple
    }, { adminClient: clientHumanTakeover })
    assert.equal(cycleRace.reason, 'suppressed_by_handoff')
    assert.equal(cycleRace.dispatched, false)
  })

  test('4. Callback updateMessageDeliveryStatus localiza via outbox fallback e reconcilia message_outbox + gateway_outbound_locks', async () => {
    const client = create2BMockSupabase()
    client.state.outboxByProviderId.set('wamid.fallback.77', { id: 'outbox-77', message_id: MSG_ID })

    const resDelivered = await updateMessageDeliveryStatus(COMPANY_ID, {
      providerMessageId: 'wamid.fallback.77',
      status: 'delivered',
      timestamp: '2026-11-12T03:00:00.000Z',
      adminClient: client
    })

    assert.equal(resDelivered.success, true)
    assert.equal(resDelivered.updated, true)
    assert.equal(client.state.messages.get(MSG_ID).metadata.delivery_status, 'delivered')

    assert.equal(client.state.updates.message_outbox.length, 1)
    assert.equal(client.state.updates.message_outbox[0].payload.status, 'sent')
    assert.equal(client.state.updates.message_outbox[0].payload.provider_message_id, 'wamid.fallback.77')
    assert.equal(client.state.updates.message_outbox[0].payload.locked_until, null)
    assert.equal(client.state.updates.message_outbox[0].payload.claim_token, null)

    assert.equal(client.state.updates.gateway_outbound_locks.length, 1)
    assert.equal(client.state.updates.gateway_outbound_locks[0].payload.status, 'completed')

    // Callback de falha (de status pending -> failed) reconcilia ambos como failed
    const msgFailId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
    client.state.messages.set(msgFailId, {
      id: msgFailId,
      company_id: COMPANY_ID,
      conversation_id: CONV_ID,
      external_id: 'wamid.fail.88',
      metadata: { delivery_status: 'sent' }
    })

    const resFailed = await updateMessageDeliveryStatus(COMPANY_ID, {
      messageId: msgFailId,
      status: 'failed',
      error: 'Número inexistente no WhatsApp',
      adminClient: client
    })
    assert.equal(resFailed.updated, true)
    assert.equal(client.state.updates.message_outbox[1].payload.status, 'failed')
    assert.equal(client.state.updates.gateway_outbound_locks[1].payload.status, 'failed')
  })

  test('5. Memória resumida persistente (conversations.summary): injeção no contexto + geração incremental controlada', async () => {
    const longHistory = Array.from({ length: 16 }, (_, idx) => ({
      sender_type: idx % 2 === 0 ? 'customer' : 'agent',
      content: `Mensagem histórica número ${idx + 1} sobre chocolates para confeitaria.`,
      created_at: new Date(Date.now() - (20 - idx) * 60000).toISOString()
    }))

    const client = create2BMockSupabase({
      messageCount: 18,
      historyMessages: longHistory
    })
    client.state.conversationSummary = 'Cliente busca chocolates 1kg para confeitaria.'
    client.state.conversationSummaryCount = 8
    setMockSupabaseClient(client)

    const ctx = await buildAgentContext({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      conversationId: CONV_ID
    })

    const sysMsg = ctx.payloadMessages.find(m => m.role === 'system')?.content || ''
    assert.ok(sysMsg.includes('[RESUMO ANTERIOR DA CONVERSA]'))
    assert.ok(sysMsg.includes('Cliente busca chocolates 1kg para confeitaria.'))

    // Testa atualização incremental: 18 - 8 = 10 >= 8 mensagens novas e remainingBudgetMs = 15000 > 6000
    let summaryCalls = 0
    const mockProvider = {
      generateResponse: async () => {
        summaryCalls++
        return {
          content: '- Interesse em barras de chocolate 1kg para confeitaria.\n- Em avaliação de opções.',
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
        }
      }
    }

    const resUpdated = await maybeRefreshConversationSummary({
      supabase: client,
      provider: mockProvider,
      model: 'gpt-4o-mini',
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      previousSummary: client.state.conversationSummary,
      previousSummaryMessageCount: client.state.conversationSummaryCount,
      availableRecentCount: 16,
      remainingBudgetMs: 15000
    })

    assert.equal(resUpdated.updated, true)
    assert.equal(summaryCalls, 1)
    assert.equal(client.state.conversationSummaryCount, 18)
    assert.ok(client.state.conversationSummary.includes('barras de chocolate 1kg'))

    // Não deve regenerar logo em seguida quando delta < 8 nem quando orçamento restante <= 6000ms
    const resSkippedDelta = await maybeRefreshConversationSummary({
      supabase: client,
      provider: mockProvider,
      model: 'gpt-4o-mini',
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      previousSummary: client.state.conversationSummary,
      previousSummaryMessageCount: 15,
      availableRecentCount: 18,
      remainingBudgetMs: 15000
    })
    assert.equal(resSkippedDelta.updated, false)
    assert.equal(resSkippedDelta.reason, 'delta_below_threshold')

    const resSkippedBudget = await maybeRefreshConversationSummary({
      supabase: client,
      provider: mockProvider,
      model: 'gpt-4o-mini',
      companyId: COMPANY_ID,
      conversationId: CONV_ID,
      previousSummary: client.state.conversationSummary,
      previousSummaryMessageCount: 0,
      availableRecentCount: 16,
      remainingBudgetMs: 4000
    })
    assert.equal(resSkippedBudget.updated, false)
    assert.equal(resSkippedBudget.reason, 'insufficient_time_budget')
    assert.equal(summaryCalls, 1)
  })

  test('6. Worker oficial recupera eventos travados de ingest e autonomous + invariantes SQL da migration 2026111201', async () => {
    const client = create2BMockSupabase({
      onRpc(fnName) {
        if (fnName === 'claim_stalled_webhook_events_batch') {
          return {
            data: [
              {
                webhook_event_id: 'eeeeeeee-1111-1111-1111-111111111111',
                company_id: COMPANY_ID,
                event_id: 'evt-stalled-ingest',
                recovery_mode: 'ingest',
                conversation_id: null,
                message_id: null,
                payload: {
                  event_id: 'evt-stalled-ingest',
                  event_type: 'message.received',
                  channel: 'whatsapp',
                  customer: { phone: '5511999990001', name: 'Ana Silva' },
                  message: { content: 'Quero ajuda humana', message_type: 'text', sender_type: 'customer' }
                },
                attempts: 1,
                claim_token: 'claim-ingest-1'
              },
              {
                webhook_event_id: 'eeeeeeee-2222-2222-2222-222222222222',
                company_id: COMPANY_ID,
                event_id: 'evt-stalled-auto',
                recovery_mode: 'autonomous',
                conversation_id: CONV_ID,
                message_id: MSG_ID,
                payload: {
                  event_id: 'evt-stalled-auto',
                  event_type: 'message.received',
                  channel: 'whatsapp',
                  customer: { phone: '5511999990001', name: 'Ana Silva' },
                  message: { content: 'Oi', message_type: 'text', sender_type: 'customer' }
                },
                attempts: 2,
                claim_token: 'claim-auto-2'
              }
            ],
            error: null
          }
        }
      }
    })
    // Marca conversa como human para o recovery testar execução rápida e limpeza determinística de complete_webhook_autonomous_event sem LLM real
    client.state.conversationStatus = 'human'
    client.state.webhookEvents.set('eeeeeeee-1111-1111-1111-111111111111', {
      id: 'eeeeeeee-1111-1111-1111-111111111111',
      company_id: COMPANY_ID,
      event_id: 'evt-stalled-ingest',
      event_type: 'message.received',
      status: 'processing'
    })
    setMockSupabaseClient(client)

    const workerRes = await reconcileStalledWebhookEventsBatch({
      adminClient: client,
      batchSize: 5,
      leaseSeconds: 90,
      timeBudgetMs: 18000
    })

    assert.equal(workerRes.processed, 2)
    assert.equal(workerRes.recovered_ingest, 1, 'Ingest travado deve ser retomado via retryWebhookEventRowId sem insert duplicado')
    assert.equal(workerRes.recovered_autonomous, 2, 'Tanto ingest recuperado quanto autonomous pendente completam o ciclo')
    assert.equal(workerRes.failed, 0)
    assert.equal(client.state.inserts.webhook_events.length, 0, 'Não pode re-inserir webhook_events ao recuperar ingest')

    const autoCompletion = client.state.rpcCalls.find(
      c => c.fnName === 'complete_webhook_autonomous_event' && c.args.p_webhook_event_id === 'eeeeeeee-2222-2222-2222-222222222222'
    )
    assert.ok(autoCompletion)
    assert.equal(autoCompletion.args.p_claim_token, 'claim-auto-2')

    // Invariantes críticos do arquivo SQL da Etapa 2B
    const sqlPath = path.join(process.cwd(), 'supabase/migrations/2026111201_engine_reliability_2b.sql')
    const sqlText = fs.readFileSync(sqlPath, 'utf8')
    assert.ok(sqlText.includes('WHERE conversation_id IS NULL'), 'Deve conter backfill histórico imediato')
    assert.ok(sqlText.includes('we.conversation_id IS NOT NULL'), 'Worker autônomo só reivindica linhas pós-2B com conversation_id preenchido')
    assert.ok(sqlText.includes("INTERVAL '24 hours'"), 'Janela máxima de 24h aplicada')
    assert.ok(sqlText.includes('FOR UPDATE OF we SKIP LOCKED'), 'Lock concorrente SKIP LOCKED obrigatório')
    assert.ok(sqlText.includes('SET search_path = pg_catalog, public, pg_temp'), 'search_path travado nas RPCs')
    assert.ok(!sqlText.includes('pg_advisory_lock'), 'Proibido pg_advisory_lock de sessão no PgBouncer/Supavisor')
    assert.ok(sqlText.includes('GRANT EXECUTE ON FUNCTION public.acquire_conversation_processing_lock(UUID, UUID, INT) TO service_role'))
    assert.ok(sqlText.includes('GRANT EXECUTE ON FUNCTION public.claim_stalled_webhook_events_batch(INT, INT) TO service_role'))

    // Verifica que cron GET inclui webhook_recovery no JSON final
    const emptyClient = create2BMockSupabase()
    setMockSupabaseClient(emptyClient)
    const cronRes = await cronGet(new Request('http://localhost:3000/api/cron/outbox-worker', {
      method: 'GET',
      headers: { Authorization: 'Bearer cron-2b-secret' }
    }))
    assert.equal(cronRes.status, 200)
    const cronJson = await cronRes.json()
    assert.equal(cronJson.success, true)
    assert.ok(cronJson.webhook_recovery && typeof cronJson.webhook_recovery.processed === 'number')
  })
})
