// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'
process.env.CRON_SECRET = 'test-cron-secret-super-secure'

import {
  reconcileStalledOutboxBatch
} from '@/lib/services/outbox-worker'
import {
  retryOutboxMessage
} from '@/lib/services/message-engine'
import {
  setMockHttpHandler
} from '@/lib/services/n8n-internal'
import {
  inMemoryDb,
  resetInMemoryDb
} from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

// Route Handlers
import { GET as cronGet, POST as cronPost } from '@/app/api/cron/outbox-worker/route'

describe('ETAPA E.5 — Parte B: Worker Assíncrono de Reconciliação e Cron HTTP', () => {
  const COMPANY_ACTIVE = '11111111-1111-1111-1111-111111111111'
  const COMPANY_SUSPENDED = '22222222-2222-2222-2222-222222222222'
  const CONVERSATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const AGENT_ID = 'agent-worker-001'

  beforeEach(() => {
    resetInMemoryDb()
    setMockHttpHandler(null)

    // Configurar empresas
    inMemoryDb.companies.set(COMPANY_ACTIVE, {
      id: COMPANY_ACTIVE,
      name: 'Empresa Ativa Worker',
      slug: 'empresa-ativa-worker',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(COMPANY_SUSPENDED, {
      id: COMPANY_SUSPENDED,
      name: 'Empresa Suspensa Worker',
      slug: 'empresa-suspensa-worker',
      status: 'suspended',
      suspension_reason: 'Inadimplência',
      plan_tier: 'free',
      created_at: new Date().toISOString()
    })

    // Configurar integração n8n ativa para a empresa ativa
    inMemoryDb.integrations.set('int-worker-001', {
      id: 'int-worker-001',
      company_id: COMPANY_ACTIVE,
      type: 'n8n',
      status: 'active',
      config: {
        webhook_url: 'https://n8n.externo-confiavel.com/webhook/msg'
      },
      credentials: {
        webhook_secret: 'sec-worker-001'
      }
    })

    // Configurar agente
    inMemoryDb.agents.set(AGENT_ID, {
      id: AGENT_ID,
      company_id: COMPANY_ACTIVE,
      name: 'Agente Worker Test',
      role: 'vendedor',
      is_active: true
    })

    // Configurar conversa
    inMemoryDb.conversations.set(CONVERSATION_ID, {
      id: CONVERSATION_ID,
      company_id: COMPANY_ACTIVE,
      channel: 'whatsapp',
      status: 'open',
      assigned_agent_id: AGENT_ID
    })
  })

  afterEach(() => {
    setMockHttpHandler(null)
  })

  describe('1. RPC claim_stalled_outbox_batch — Reivindicação Correta e Elegibilidade', () => {
    test('1.1. Resgata mensagem em processing cujo lease expirou no passado', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000001'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990001',
        payload: { text: 'Olá do passado' },
        status: 'processing',
        locked_at: new Date(now - 150000).toISOString(),
        locked_until: new Date(now - 30000).toISOString(), // expirou há 30s
        claim_version: 1,
        attempts: 1,
        max_attempts: 5,
        created_at: new Date(now - 150000).toISOString(),
        updated_at: new Date(now - 150000).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 1)
      assert.equal(batch[0].outbox_id, outboxId)
      assert.equal(batch[0].attempts, 2)
      assert.ok(batch[0].claim_token)
      assert.equal(batch[0].claim_version, 2)

      // Verifica estado no banco simulado
      const saved = inMemoryDb.message_outbox.get(outboxId)
      assert.equal(saved.status, 'processing')
      assert.ok(new Date(saved.locked_until).getTime() > now)
    })

    test('1.2. Resgata mensagem em pending abandonada (> 30s)', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000002'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990002',
        payload: { text: 'Mensagem pendente antiga' },
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date(now - 45000).toISOString(), // criada há 45s (> 30s)
        updated_at: new Date(now - 45000).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 1)
      assert.equal(batch[0].outbox_id, outboxId)
      assert.equal(batch[0].old_status, 'pending')
    })

    test('1.3. Resgata mensagem em failed cujo backoff exponencial já decorreu', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000003'
      const now = Date.now()
      // attempts = 1 -> backoff = 2^1 * 15s = 30s
      const updatedTime = now - 35000 // 35s atrás (> 30s)

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990003',
        payload: { text: 'Falha com backoff vencido' },
        status: 'failed',
        attempts: 1,
        max_attempts: 5,
        created_at: new Date(now - 100000).toISOString(),
        updated_at: new Date(updatedTime).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 1)
      assert.equal(batch[0].outbox_id, outboxId)
      assert.equal(batch[0].attempts, 2)
    })

    test('1.4. IGNORA mensagem em processing com lock ativo no futuro (lease não expirou)', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000004'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990004',
        payload: { text: 'Lock ativo' },
        status: 'processing',
        locked_at: new Date(now - 10000).toISOString(),
        locked_until: new Date(now + 90000).toISOString(), // ativo por mais 90s!
        claim_version: 1,
        attempts: 1,
        max_attempts: 5,
        created_at: new Date(now - 10000).toISOString(),
        updated_at: new Date(now - 10000).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 0, 'Não deve resgatar registros com lease ativo')
    })

    test('1.5. IGNORA mensagem em pending recente (< 30s)', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000005'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990005',
        payload: { text: 'Recente' },
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date(now - 5000).toISOString(), // criada há apenas 5 segundos
        updated_at: new Date(now - 5000).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 0, 'Mensagem recente não deve ser capturada pelo worker')
    })

    test('1.6. Poison Pill Protection: Mensagem com attempts >= max_attempts é marcada como failed definitiva', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000006'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990006',
        payload: { text: 'Poison Pill' },
        status: 'processing',
        locked_at: new Date(now - 120000).toISOString(),
        locked_until: new Date(now - 10000).toISOString(), // expirada
        attempts: 5,
        max_attempts: 5, // Atingiu o teto!
        created_at: new Date(now - 300000).toISOString(),
        updated_at: new Date(now - 120000).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 0, 'Mensagens que atingiram max_attempts não devem ser reivindicadas')

      const saved = inMemoryDb.message_outbox.get(outboxId)
      assert.equal(saved.status, 'failed')
      assert.equal(saved.last_error, 'max_attempts_reached')
    })

    test('1.7. Isolamento Multi-Tenant: Mensagens de tenant inativo/suspenso não são reivindicadas', async () => {
      const outboxId = '10000000-0000-0000-0000-000000000007'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_SUSPENDED,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990007',
        payload: { text: 'Tenant suspenso' },
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date(now - 60000).toISOString(),
        updated_at: new Date(now - 60000).toISOString()
      })

      const client = createAdminClient()
      const { data: batch, error } = await client.rpc('claim_stalled_outbox_batch', {
        p_batch_size: 10,
        p_lease_seconds: 120
      })

      assert.equal(error, null)
      assert.equal(batch.length, 0, 'Empresa suspensa não deve ter lote retornado')
    })
  })

  describe('2. Worker reconcileStalledOutboxBatch — Execução e Reenvio Idempotente', () => {
    test('2.1. Executa reconciliação de ponta a ponta com sucesso via sendOutboundMessage', async () => {
      const outboxId = '20000000-0000-0000-0000-000000000001'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990010',
        payload: {
          event_id: 'evt-worker-01',
          recipient: '5511999990010',
          channel: 'whatsapp',
          content: { type: 'text', text: 'Mensagem reconciliada com sucesso' }
        },
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date(now - 40000).toISOString(),
        updated_at: new Date(now - 40000).toISOString()
      })

      // Mock de envio HTTP do n8n com sucesso
      let networkCalls = 0
      setMockHttpHandler(async (url, opts) => {
        networkCalls++
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, provider_message_id: 'wamid.worker.test.999' }),
          json: async () => ({ success: true, provider_message_id: 'wamid.worker.test.999' })
        }
      })

      const result = await reconcileStalledOutboxBatch({ batchSize: 5 })

      assert.equal(result.processed, 1)
      assert.equal(result.succeeded, 1)
      assert.equal(result.failed, 0)
      assert.equal(networkCalls, 1)

      const saved = inMemoryDb.message_outbox.get(outboxId)
      assert.equal(saved.status, 'sent')
      assert.ok(saved.sent_at)
    })

    test('2.2. Falha de rede determinística marca outbox como failed', async () => {
      const outboxId = '20000000-0000-0000-0000-000000000002'
      const now = Date.now()

      inMemoryDb.message_outbox.set(outboxId, {
        id: outboxId,
        company_id: COMPANY_ACTIVE,
        conversation_id: CONVERSATION_ID,
        channel: 'whatsapp',
        recipient: '5511999990020',
        payload: {
          event_id: 'evt-worker-fail',
          recipient: '5511999990020',
          channel: 'whatsapp',
          content: { type: 'text', text: 'Mensagem com falha' }
        },
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        created_at: new Date(now - 50000).toISOString(),
        updated_at: new Date(now - 50000).toISOString()
      })

      setMockHttpHandler(async (url, opts) => {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: 'Número inválido' }),
          json: async () => ({ error: 'Número inválido' })
        }
      })

      const result = await reconcileStalledOutboxBatch({ batchSize: 5 })

      assert.equal(result.processed, 1)
      assert.equal(result.succeeded, 0)
      assert.equal(result.failed, 1)

      const saved = inMemoryDb.message_outbox.get(outboxId)
      assert.equal(saved.status, 'failed')
    })

    test('2.3. Lote vazio retorna zero processados sem erros', async () => {
      const result = await reconcileStalledOutboxBatch({ batchSize: 10 })

      assert.equal(result.processed, 0)
      assert.equal(result.succeeded, 0)
      assert.equal(result.failed, 0)
      assert.equal(result.suppressed, 0)
      assert.equal(result.items.length, 0)
    })

    test('2.4. Respeita estritamente o limite batch_size quando há mais candidatos elegíveis', async () => {
      const now = Date.now()

      for (let i = 1; i <= 6; i++) {
        const id = `30000000-0000-0000-0000-00000000000${i}`
        inMemoryDb.message_outbox.set(id, {
          id,
          company_id: COMPANY_ACTIVE,
          conversation_id: CONVERSATION_ID,
          channel: 'whatsapp',
          recipient: `551199999003${i}`,
          payload: { text: `Item ${i}` },
          status: 'pending',
          attempts: 0,
          max_attempts: 5,
          created_at: new Date(now - 60000 - i * 1000).toISOString(),
          updated_at: new Date(now - 60000 - i * 1000).toISOString()
        })
      }

      setMockHttpHandler(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, provider_message_id: 'wamid.batch' }),
        json: async () => ({ success: true, provider_message_id: 'wamid.batch' })
      }))

      // Requisitamos batchSize = 3
      const result = await reconcileStalledOutboxBatch({ batchSize: 3 })

      assert.equal(result.processed, 3, 'Deve processar exatamente o batchSize solicitado')
      assert.equal(result.succeeded, 3)

      // 3 foram enviadas, 3 continuam pendentes
      let pendingCount = 0
      let sentCount = 0
      for (let i = 1; i <= 6; i++) {
        const id = `30000000-0000-0000-0000-00000000000${i}`
        const st = inMemoryDb.message_outbox.get(id).status
        if (st === 'pending') pendingCount++
        if (st === 'sent') sentCount++
      }
      assert.equal(sentCount, 3)
      assert.equal(pendingCount, 3)
    })
  })

  describe('3. Route Handler HTTP (/api/cron/outbox-worker) — Segurança e Invocação', () => {
    test('3.1. Rejeita requisição GET sem header Authorization com 401 Unauthorized', async () => {
      const req = new Request('http://localhost:3000/api/cron/outbox-worker', {
        method: 'GET'
      })

      const res = await cronGet(req)
      assert.equal(res.status, 401)
      const data = await res.json()
      assert.equal(data.error, 'Não autorizado')
    })

    test('3.2. Rejeita requisição POST com Bearer token incorreto com 401 Unauthorized', async () => {
      const req = new Request('http://localhost:3000/api/cron/outbox-worker', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer token-falso-e-invalido',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ batch_size: 10 })
      })

      const res = await cronPost(req)
      assert.equal(res.status, 401)
      const data = await res.json()
      assert.equal(data.error, 'Não autorizado')
    })

    test('3.3. Aceita GET com Authorization Bearer correto e executa reconciliação (HTTP 200)', async () => {
      const req = new Request('http://localhost:3000/api/cron/outbox-worker?batch_size=15&lease_seconds=60', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET}`
        }
      })

      const res = await cronGet(req)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.success, true)
      assert.equal(typeof data.processed, 'number')
      assert.equal(typeof data.elapsed_ms, 'number')
      assert.ok(Array.isArray(data.items))
    })

    test('3.4. Aceita POST com Authorization Bearer correto e body JSON (HTTP 200)', async () => {
      const req = new Request('http://localhost:3000/api/cron/outbox-worker', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          batch_size: 20,
          lease_seconds: 90
        })
      })

      const res = await cronPost(req)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.success, true)
      assert.equal(typeof data.processed, 'number')
      assert.ok(Array.isArray(data.items))
    })
  })
})
