// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import { GET as legacyGet, POST as legacyPost } from '@/app/api/outbox/process/route'
import { GET as cronGet, POST as cronPost } from '@/app/api/cron/outbox-worker/route'
import { reconcileStalledOutboxBatch } from '@/lib/services/outbox-worker'
import { retryOutboxMessage, handleAutonomousCycle } from '@/lib/services/message-engine'
import { setMockHttpHandler } from '@/lib/services/n8n-internal'

const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
const CONV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
const CONV_B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
const CONV_C = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
const MSG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'

function createFlexibleMockSupabase(handlers = {}) {
  const rpcCalls = []
  const messageUpdates = []
  const outboxUpdates = []

  const state = {
    rpcCalls,
    messageUpdates,
    outboxUpdates,
    messages: new Map([
      [MSG_ID, {
        id: MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONV_A,
        metadata: {
          delivery_status: 'pending',
          working_memory: {
            activeCart: [{ product_id: 'p1', name: 'Chocolate 1kg', quantity: 2 }]
          }
        },
        external_id: null
      }]
    ]),
    outbox: new Map()
  }

  function makeTableQuery(table) {
    const filters = {}
    let pendingUpdate = null
    let pendingInsert = null

    const chain = {
      select() { return chain },
      eq(col, val) { filters[col] = val; return chain },
      in() { return chain },
      is() { return chain },
      order() { return chain },
      limit() { return chain },
      update(payload) { pendingUpdate = payload; return chain },
      insert(payload) { pendingInsert = payload; return chain },
      async single() {
        if (handlers.onTable) {
          const custom = await handlers.onTable(table, 'single', { filters, pendingUpdate, pendingInsert, state })
          if (custom !== undefined) return custom
        }
        if (table === 'companies') {
          return { data: { id: COMPANY_ID, status: 'active', name: 'Empresa Teste' }, error: null }
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
        if (table === 'conversations') {
          return {
            data: {
              id: filters.id || CONV_A,
              status: 'open',
              channel: 'whatsapp',
              agent_id: 'agent-1',
              customer_id: 'cust-1',
              customers: { id: 'cust-1', phone: '5511999990000', name: 'Maria' }
            },
            error: null
          }
        }
        if (table === 'agents') {
          return {
            data: { id: 'agent-1', company_id: COMPANY_ID, is_active: true, name: 'Agente' },
            error: null
          }
        }
        return { data: null, error: null }
      },
      async maybeSingle() {
        if (handlers.onTable) {
          const custom = await handlers.onTable(table, 'maybeSingle', { filters, pendingUpdate, pendingInsert, state })
          if (custom !== undefined) return custom
        }
        if (table === 'companies') {
          return { data: { id: COMPANY_ID, status: 'active', name: 'Empresa Teste' }, error: null }
        }
        if (table === 'messages') {
          const msg = state.messages.get(filters.id)
          return { data: msg || null, error: null }
        }
        if (table === 'message_outbox') {
          const row = state.outbox.get(filters.id)
          return { data: row || null, error: null }
        }
        return { data: null, error: null }
      },
      then(resolve, reject) {
        Promise.resolve().then(async () => {
          if (pendingUpdate) {
            if (table === 'messages') {
              messageUpdates.push({ filters: { ...filters }, payload: pendingUpdate })
            }
            if (table === 'message_outbox') {
              outboxUpdates.push({ filters: { ...filters }, payload: pendingUpdate })
            }
          }
          if (pendingInsert) {
            return { data: pendingInsert, error: null }
          }
          return { data: null, error: null }
        }).then(resolve, reject)
      }
    }
    return chain
  }

  const client = {
    state,
    from(table) {
      return makeTableQuery(table)
    },
    async rpc(fnName, args) {
      rpcCalls.push({ fnName, args })
      if (handlers.onRpc) {
        const custom = await handlers.onRpc(fnName, args, state)
        if (custom !== undefined) return custom
      }
      if (fnName === 'claim_stalled_outbox_batch') {
        return { data: [], error: null }
      }
      if (fnName === 'acquire_gateway_outbound_lock') {
        return {
          data: [{ was_acquired: true, claim_token: 'gw-tok-1', status: 'in_flight' }],
          error: null
        }
      }
      if (fnName === 'complete_gateway_outbound_lock') {
        return { data: [{ was_completed: true }], error: null }
      }
      if (fnName === 'complete_outbox_message') {
        return { data: [{ was_completed: true }], error: null }
      }
      if (fnName === 'create_outbound_message_atomic') {
        return {
          data: [{
            was_inserted: true,
            duplicate: false,
            message_id: MSG_ID,
            outbox_id: 'cccccccc-cccc-cccc-cccc-ccccccccccc1',
            status: 'pending'
          }],
          error: null
        }
      }
      if (fnName === 'claim_outbox_message') {
        return {
          data: [{
            was_claimed: true,
            claim_token: 'outbox-tok-1',
            claim_version: 1,
            payload: args.payload || null
          }],
          error: null
        }
      }
      if (fnName === 'merge_message_metadata_monotonic') {
        const msg = state.messages.get(args.p_message_id)
        if (!msg) {
          return { data: [{ was_updated: false, error_reason: 'message_not_found' }], error: null }
        }
        const merged = { ...(msg.metadata || {}), ...(args.p_metadata_patch || {}) }
        msg.metadata = merged
        return {
          data: [{ was_updated: true, final_metadata: merged, current_status: merged.delivery_status }],
          error: null
        }
      }
      return { data: null, error: null }
    }
  }

  return client
}

describe('ETAPA 1 — Validação Cirúrgica do Worker, Endpoint Legado e Lease Consistency', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'super-secret-cron-token'
    setMockHttpHandler(null)
  })

  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('1. /api/outbox/process bloqueia GET e POST com 410 Gone mesmo sem CRON_SECRET ou com ?secret=', async () => {
    const prevSecret = process.env.CRON_SECRET
    delete process.env.CRON_SECRET

    const resGet = await legacyGet(new Request('http://localhost:3000/api/outbox/process?mock=true'))
    assert.equal(resGet.status, 410)
    const bodyGet = await resGet.json()
    assert.equal(bodyGet.success, false)
    assert.equal(bodyGet.code, 'LEGACY_ENDPOINT_GONE')

    process.env.CRON_SECRET = 'abc'
    const resPost = await legacyPost(new Request('http://localhost:3000/api/outbox/process?secret=abc', { method: 'POST' }))
    assert.equal(resPost.status, 410)
    const bodyPost = await resPost.json()
    assert.equal(bodyPost.code, 'LEGACY_ENDPOINT_GONE')

    process.env.CRON_SECRET = prevSecret
  })

  test('2. /api/cron/outbox-worker rejeita auth inválida e retorna HTTP 500 se claim_stalled_outbox_batch falhar', async () => {
    const prevSecret = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    const resNoSecret = await cronGet(new Request('http://localhost:3000/api/cron/outbox-worker'))
    assert.equal(resNoSecret.status, 401)

    process.env.CRON_SECRET = 'super-secret-cron-token'
    const resWrongLen = await cronGet(new Request('http://localhost:3000/api/cron/outbox-worker', {
      headers: { Authorization: 'Bearer errado' }
    }))
    assert.equal(resWrongLen.status, 401)

    const failingClient = createFlexibleMockSupabase({
      onRpc(fnName) {
        if (fnName === 'claim_stalled_outbox_batch') {
          return { data: null, error: { message: 'connection timeout' } }
        }
      }
    })
    setMockSupabaseClient(failingClient)

    const resRpcFail = await cronGet(new Request('http://localhost:3000/api/cron/outbox-worker', {
      headers: { Authorization: 'Bearer super-secret-cron-token' }
    }))
    assert.equal(resRpcFail.status, 500)
    const errJson = await resRpcFail.json()
    assert.equal(errJson.success, false)
    assert.match(errJson.error, /connection timeout/)

    process.env.CRON_SECRET = prevSecret
  })

  test('3. reconcileStalledOutboxBatch usa defaults seguros (batch=5, lease=120) e executa conversas distintas em paralelo + FIFO por conversa', async () => {
    const startEvents = []
    const finishEvents = []

    const batchItems = [
      {
        outbox_id: '00000000-0000-0000-0000-000000000001',
        company_id: COMPANY_ID,
        conversation_id: CONV_A,
        claim_token: 'tok-1',
        claim_version: 1,
        attempts: 2,
        payload: { event_id: 'evt-1', recipient: '5511999990001', content: 'A1' }
      },
      {
        outbox_id: '00000000-0000-0000-0000-000000000002',
        company_id: COMPANY_ID,
        conversation_id: CONV_A,
        claim_token: 'tok-2',
        claim_version: 1,
        attempts: 1,
        payload: { event_id: 'evt-2', recipient: '5511999990001', content: 'A2' }
      },
      {
        outbox_id: '00000000-0000-0000-0000-000000000003',
        company_id: COMPANY_ID,
        conversation_id: CONV_B,
        claim_token: 'tok-3',
        claim_version: 1,
        attempts: 1,
        payload: { event_id: 'evt-3', recipient: '5511999990002', content: 'B1' }
      },
      {
        outbox_id: '00000000-0000-0000-0000-000000000004',
        company_id: COMPANY_ID,
        conversation_id: CONV_C,
        claim_token: 'tok-4',
        claim_version: 1,
        attempts: 3,
        payload: { event_id: 'evt-4', recipient: '5511999990003', content: 'C1' }
      }
    ]

    const client = createFlexibleMockSupabase({
      onRpc(fnName) {
        if (fnName === 'claim_stalled_outbox_batch') {
          return { data: batchItems, error: null }
        }
      }
    })

    setMockHttpHandler(async (_url, opts) => {
      const body = JSON.parse(opts.body)
      startEvents.push(body.event_id)
      await new Promise(r => setTimeout(r, 100))
      finishEvents.push(body.event_id)
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ provider_message_id: `wamid.${body.event_id}` })
      }
    })

    const t0 = Date.now()
    const result = await reconcileStalledOutboxBatch({ adminClient: client })
    const wallMs = Date.now() - t0

    // Confirma defaults RPC
    const claimCall = client.state.rpcCalls.find(c => c.fnName === 'claim_stalled_outbox_batch')
    assert.equal(claimCall.args.p_batch_size, 5)
    assert.equal(claimCall.args.p_lease_seconds, 120)

    // 4 itens x 70ms sequencial = >=280ms; paralelo entre CONV_A (2 itens = ~140ms), CONV_B (~70ms), CONV_C (~70ms) deve ser < 340ms!
    assert.equal(result.processed, 4)
    assert.equal(result.succeeded, 4)
    assert.equal(result.failed, 0)
    assert.equal(result.deferred, 0)
    assert.ok(wallMs < 600, `Esperava paralelismo (< 600ms), mas levou ${wallMs}ms`)

    // FIFO dentro de CONV_A: evt-1 PRECISA terminar antes de evt-2 iniciar!
    const finishIdx1 = finishEvents.indexOf('evt-1')
    const startIdx2 = startEvents.indexOf('evt-2')
    assert.ok(finishIdx1 !== -1 && startIdx2 !== -1)
    assert.ok(finishEvents.indexOf('evt-1') < finishEvents.indexOf('evt-2'))
    // Como evt-2 só inicia após evt-1 terminar, a 2a rodada no mesmo array startEvents vê evt-2 depois de evt-1, evt-3 e evt-4!
    assert.equal(startEvents[3], 'evt-2', `evt-2 deveria iniciar apenas após evt-1; ordem de início: ${startEvents.join(',')}`)

    // Attempts preservado na telemetria e propagado ao outboxUpdate
    assert.equal(result.items[0].attempts, 2)
    assert.equal(result.items[3].attempts, 3)
    const firstOutboxPatch = client.state.outboxUpdates.find(u => u.filters.id === '00000000-0000-0000-0000-000000000001')
    assert.equal(firstOutboxPatch.payload.attempts, 2)
  })

  test('4. Time budget interrompe fila restante antes de estourar 30s e marca deferred=true', async () => {
    const batchItems = [
      {
        outbox_id: '00000000-0000-0000-0000-000000000011',
        company_id: COMPANY_ID,
        conversation_id: CONV_A,
        claim_token: 'tok-11',
        claim_version: 1,
        attempts: 1,
        payload: { event_id: 'evt-11', recipient: '5511999990001', content: 'M1' }
      },
      {
        outbox_id: '00000000-0000-0000-0000-000000000012',
        company_id: COMPANY_ID,
        conversation_id: CONV_A,
        claim_token: 'tok-12',
        claim_version: 1,
        attempts: 1,
        payload: { event_id: 'evt-12', recipient: '5511999990001', content: 'M2' }
      },
      {
        outbox_id: '00000000-0000-0000-0000-000000000013',
        company_id: COMPANY_ID,
        conversation_id: CONV_A,
        claim_token: 'tok-13',
        claim_version: 1,
        attempts: 2,
        payload: { event_id: 'evt-13', recipient: '5511999990001', content: 'M3' }
      }
    ]

    let httpCalls = 0
    const client = createFlexibleMockSupabase({
      onRpc(fnName) {
        if (fnName === 'claim_stalled_outbox_batch') {
          return { data: batchItems, error: null }
        }
      }
    })

    setMockHttpHandler(async () => {
      httpCalls++
      await new Promise(r => setTimeout(r, 45))
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ provider_message_id: `wamid.${httpCalls}` })
      }
    })

    const result = await reconcileStalledOutboxBatch({
      adminClient: client,
      timeBudgetMs: 35
    })

    assert.equal(httpCalls, 1)
    assert.equal(result.processed, 3)
    assert.equal(result.succeeded, 1)
    assert.equal(result.deferred, 2)
    assert.equal(result.items[1].deferred, true)
    assert.equal(result.items[1].code, 'TIME_BUDGET_EXCEEDED')
    assert.equal(result.items[2].deferred, true)
    assert.equal(result.items[2].attempts, 2)
  })

  test('5. retryOutboxMessage em falha determinística preserva working_memory via merge_message_metadata_monotonic', async () => {
    const client = createFlexibleMockSupabase()

    setMockHttpHandler(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: 'Número inválido' })
    }))

    const res = await retryOutboxMessage(
      COMPANY_ID,
      '00000000-0000-0000-0000-000000000099',
      {
        adminClient: client,
        leaseSeconds: 120,
        claim: {
          claim_token: 'tok-fail-1',
          claim_version: 2,
          message_id: MSG_ID,
          attempts: 2,
          payload: {
            event_id: 'evt-fail-preserve-wm',
            recipient: '5511999990001',
            content: 'Olá'
          }
        }
      }
    )

    assert.equal(res.success, false)
    assert.equal(res.outcome, 'confirmed_failure')

    const msg = client.state.messages.get(MSG_ID)
    assert.equal(msg.metadata.delivery_status, 'failed')
    assert.ok(msg.metadata.working_memory, 'working_memory deve ser preservada após falha no worker!')
    assert.equal(msg.metadata.working_memory.activeCart[0].name, 'Chocolate 1kg')
    assert.equal(client.state.messageUpdates.length, 0, 'Não deve fazer .update direto sobrescrevendo JSONB')
  })

  test('6. handleAutonomousCycle envia leaseSeconds=120 unificado para acquire_gateway_outbound_lock', async () => {
    const client = createFlexibleMockSupabase()
    setMockSupabaseClient(client)

    setMockHttpHandler(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ provider_message_id: 'wamid.auto.120' })
    }))

    const res = await handleAutonomousCycle({
      companyId: COMPANY_ID,
      conversationId: CONV_A,
      messageId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      eventId: 'evt-auto-lease-check',
      payload: {
        event_id: 'evt-auto-lease-check',
        channel: 'whatsapp',
        customer: { phone: '5511999990000', name: 'Maria' },
        message: { content: 'Oi', message_type: 'text', sender_type: 'customer' }
      }
    }, { adminClient: client })

    assert.equal(res.dispatched, true)

    const outboxClaim = client.state.rpcCalls.find(c => c.fnName === 'claim_outbox_message')
    const gwLock = client.state.rpcCalls.find(c => c.fnName === 'acquire_gateway_outbound_lock')

    assert.equal(outboxClaim.args.p_lease_seconds, 120)
    assert.equal(gwLock.args.p_lease_seconds, 120, 'acquire_gateway_outbound_lock deve usar p_lease_seconds=120')
  })

  test('7. /api/cron/outbox-worker aceita GET e POST autenticados, aplica clamp seguro e retorna lote vazio corretamente', async () => {
    const client = createFlexibleMockSupabase()
    setMockSupabaseClient(client)

    const resGet = await cronGet(new Request('http://localhost:3000/api/cron/outbox-worker?batch_size=15&lease_seconds=60', {
      method: 'GET',
      headers: { Authorization: 'Bearer super-secret-cron-token' }
    }))
    assert.equal(resGet.status, 200)
    const getJson = await resGet.json()
    assert.equal(getJson.success, true)
    assert.equal(getJson.processed, 0)
    const outboxClaimsAfterGet = client.state.rpcCalls.filter(c => c.fnName === 'claim_stalled_outbox_batch')
    assert.equal(outboxClaimsAfterGet[0].args.p_batch_size, 15)
    assert.equal(outboxClaimsAfterGet[0].args.p_lease_seconds, 60)

    const resPost = await cronPost(new Request('http://localhost:3000/api/cron/outbox-worker', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer super-secret-cron-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ batch_size: 999, lease_seconds: 5 })
    }))
    assert.equal(resPost.status, 200)
    const postJson = await resPost.json()
    assert.equal(postJson.success, true)
    const outboxClaimsAfterPost = client.state.rpcCalls.filter(c => c.fnName === 'claim_stalled_outbox_batch')
    assert.equal(outboxClaimsAfterPost[1].args.p_batch_size, 100)
    assert.equal(outboxClaimsAfterPost[1].args.p_lease_seconds, 15)
  })
})
