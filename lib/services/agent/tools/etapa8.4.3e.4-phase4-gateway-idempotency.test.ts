// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  handleAutonomousCycle,
  retryOutboxMessage
} from '@/lib/services/message-engine'
import {
  sendOutboundMessage,
  setMockHttpHandler,
  isAmbiguousNetworkError
} from '@/lib/services/n8n-internal'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

describe('ETAPA E.4 — Fase 4: Idempotência e Tratamento de Timeout no Gateway n8n', () => {
  const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const CONVERSATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const AGENT_ID = 'agent-phase4-001'
  const OUTBOX_ID = '44444444-4444-4444-4444-444444444444'
  const MESSAGE_ID = '55555555-5555-5555-5555-555555555555'

  beforeEach(() => {
    resetInMemoryDb()
    setMockHttpHandler(null)

    // 1. Cadastrar Empresa
    inMemoryDb.companies.set(COMPANY_ID, {
      id: COMPANY_ID,
      name: 'Empresa Phase 4 Test',
      slug: 'empresa-phase4-test',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Integração n8n ativa
    inMemoryDb.integrations.set('int-phase4-001', {
      id: 'int-phase4-001',
      company_id: COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: {
        webhook_url: 'https://n8n.externo-confiavel.com/webhook/msg'
      },
      credentials: {
        webhook_secret: 'sec-phase4-secret'
      }
    })

    // 3. Cadastrar Agente
    inMemoryDb.agents.set(AGENT_ID, {
      id: AGENT_ID,
      company_id: COMPANY_ID,
      name: 'Agente de Testes Phase 4',
      role: 'vendedor',
      is_active: true,
      is_default: true,
      config: {}
    })

    // 4. Cadastrar Conversa
    inMemoryDb.conversations.set(CONVERSATION_ID, {
      id: CONVERSATION_ID,
      company_id: COMPANY_ID,
      status: 'open',
      channel: 'whatsapp',
      agent_id: AGENT_ID,
      customer_id: 'cust-p4-001'
    })
  })

  afterEach(() => {
    setMockHttpHandler(null)
  })

  // ============================================================================
  // REGRA DE OURO 1: Caminho Feliz
  // ============================================================================
  describe('1. Caminho Feliz: Adquire Lock -> Envia HTTP -> Conclui Lock como completed', () => {
    test('1.1. sendOutboundMessage adquire lock, despacha HTTP e conclui lock como completed com provider_message_id', async () => {
      const EVENT_ID = 'evt-p4-happy-001'
      const EXPECTED_PROVIDER_ID = 'wamid.PHASE4_HAPPY_999'
      let fetchCallCount = 0

      setMockHttpHandler(async (_url, _options) => {
        fetchCallCount++
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            success: true,
            provider_message_id: EXPECTED_PROVIDER_ID
          })
        }
      })

      const payload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        customer: { phone: '5511999998888', name: 'Cliente Feliz' },
        message: { content: 'Olá, envio feliz', message_type: 'text' }
      }

      const res = await sendOutboundMessage(COMPANY_ID, payload, {
        outboxId: OUTBOX_ID,
        messageId: MESSAGE_ID
      })

      assert.equal(res.success, true, 'Envio deve ser bem-sucedido')
      assert.equal(res.provider_message_id, EXPECTED_PROVIDER_ID, 'Deve retornar o provider_message_id extraído')
      assert.equal(fetchCallCount, 1, 'Deve ter disparado exatamente uma chamada HTTP')

      // Validação no Banco/Mock de gateway_outbound_locks
      const locks = Array.from(inMemoryDb.gateway_outbound_locks.values())
      const lock = locks.find(l => l.company_id === COMPANY_ID && l.event_id === EVENT_ID)

      assert.ok(lock, 'Registro de lock de gateway deve existir')
      assert.equal(lock.status, 'completed', 'Status do lock deve ser completed')
      assert.equal(lock.provider_message_id, EXPECTED_PROVIDER_ID, 'provider_message_id deve estar salvo no lock')
      assert.equal(lock.outbox_id, OUTBOX_ID, 'outbox_id deve ser vinculado')
      assert.equal(lock.message_id, MESSAGE_ID, 'message_id deve ser vinculado')
      assert.ok(lock.completed_at, 'completed_at deve estar preenchido')
    })
  })

  // ============================================================================
  // REGRA DE OURO 2: Short-circuit (Idempotência Estrita no Gateway)
  // ============================================================================
  describe('2. Short-circuit: Envio com lock já concluído pula chamada HTTP e retorna ID em cache', () => {
    test('2.1. Segundo envio para o mesmo event_id retorna sucesso instantâneo com ZERO chamadas ao fetch', async () => {
      const EVENT_ID = 'evt-p4-shortcircuit-001'
      const CACHED_PROVIDER_ID = 'wamid.CACHED_ID_123'
      let fetchCallCount = 0

      // Pré-insere lock em estado completed (simulando que disparo anterior já concluiu)
      const lockKey = crypto.randomUUID()
      inMemoryDb.gateway_outbound_locks.set(lockKey, {
        id: lockKey,
        company_id: COMPANY_ID,
        event_id: EVENT_ID,
        status: 'completed',
        claim_token: crypto.randomUUID(),
        provider_message_id: CACHED_PROVIDER_ID,
        locked_at: new Date().toISOString(),
        locked_until: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      setMockHttpHandler(async (_url, _options) => {
        fetchCallCount++
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ provider_message_id: 'wamid.NEVER_CALLED' })
        }
      })

      const payload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        customer: { phone: '5511999998888' },
        message: { content: 'Mensagem idempotente repetida' }
      }

      const res = await sendOutboundMessage(COMPANY_ID, payload)

      assert.equal(res.success, true, 'Envio deve reportar sucesso via short-circuit')
      assert.equal(res.provider_message_id, CACHED_PROVIDER_ID, 'Deve retornar o provider_message_id que já estava em cache')
      assert.equal((res as any).cached, true, 'Deve indicar que o resultado veio de cache')
      assert.equal(fetchCallCount, 0, 'A contagem de chamadas ao mock do fetch DEVE ser estritamente ZERO')
    })
  })

  // ============================================================================
  // REGRA DE OURO 3: Proteção Concorrente
  // ============================================================================
  describe('3. Proteção Concorrente: Lock in_flight com lease ativo bloqueia envio duplicado', () => {
    test('3.1. Tentativa de envio com lock concorrente in_flight aborta com concurrency_active_lease e ZERO chamadas ao fetch', async () => {
      const EVENT_ID = 'evt-p4-concurrency-001'
      let fetchCallCount = 0

      // Pré-insere lock em estado in_flight com lease válido para daqui a 50 segundos
      const activeLockKey = crypto.randomUUID()
      const futureDate = new Date(Date.now() + 50000).toISOString()
      inMemoryDb.gateway_outbound_locks.set(activeLockKey, {
        id: activeLockKey,
        company_id: COMPANY_ID,
        event_id: EVENT_ID,
        status: 'in_flight',
        claim_token: crypto.randomUUID(),
        provider_message_id: null,
        locked_at: new Date().toISOString(),
        locked_until: futureDate,
        completed_at: null,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      setMockHttpHandler(async (_url, _options) => {
        fetchCallCount++
        return { ok: true, status: 200, text: async () => '{}' }
      })

      const payload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        customer: { phone: '5511999998888' },
        message: { content: 'Mensagem disputando com thread ativa' }
      }

      const res = await sendOutboundMessage(COMPANY_ID, payload)

      assert.equal(res.success, false, 'Envio deve ser rejeitado para prevenir duplicidade no WhatsApp')
      assert.equal(res.reason, 'concurrency_active_lease', 'Motivo deve ser concurrency_active_lease')
      assert.equal(fetchCallCount, 0, 'Zero chamadas ao fetch devem ter ocorrido')
    })
  })

  // ============================================================================
  // REGRA DE OURO 4: Fallback de Timeout e Falhas Ambíguas de Rede
  // ============================================================================
  describe('4. Fallback de Timeout: AbortError ou falha de rede abandona o lock mantendo in_flight', () => {
    test('4.1. AbortError no fetch captura o erro, NÃO conclui o lock (deixando expirar) e retorna fetch_error', async () => {
      const EVENT_ID = 'evt-p4-timeout-001'

      setMockHttpHandler(async (_url, _options) => {
        const timeoutErr = new Error('The operation was aborted due to timeout (8000ms)')
        timeoutErr.name = 'AbortError'
        throw timeoutErr
      })

      const payload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        customer: { phone: '5511999998888' },
        message: { content: 'Mensagem sofrendo timeout' }
      }

      const res = await sendOutboundMessage(COMPANY_ID, payload, { leaseSeconds: 60 })

      assert.equal(res.success, false, 'Envio deve falhar por timeout')
      assert.equal(res.reason, 'fetch_error', 'Motivo deve ser fetch_error')
      assert.ok(res.error?.includes('timeout'), 'Mensagem de erro deve refletir o timeout')

      // Validação Crítica no Banco/Mock:
      // O lock NÃO PODE ter sido concluído com status 'failed' nem 'completed'!
      // Ele deve permanecer como 'in_flight' para que o lease segure concorrência cega
      const locks = Array.from(inMemoryDb.gateway_outbound_locks.values())
      const lock = locks.find(l => l.company_id === COMPANY_ID && l.event_id === EVENT_ID)

      assert.ok(lock, 'Registro de lock de gateway deve existir')
      assert.equal(lock.status, 'in_flight', 'Status do lock DEVE permanecer in_flight (lock abandonado para expirar)')
      assert.equal(lock.completed_at, null, 'completed_at deve permanecer null')
    })

    test('4.2. ECONNRESET ou socket hang up também é classificado como ambíguo e abandona o lock', async () => {
      const EVENT_ID = 'evt-p4-econnreset-001'

      setMockHttpHandler(async (_url, _options) => {
        throw new Error('read ECONNRESET socket hang up')
      })

      const payload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        customer: { phone: '5511999998888' },
        message: { content: 'Mensagem com queda de conexão' }
      }

      const res = await sendOutboundMessage(COMPANY_ID, payload)

      assert.equal(res.success, false)
      assert.equal(res.reason, 'fetch_error')

      const locks = Array.from(inMemoryDb.gateway_outbound_locks.values())
      const lock = locks.find(l => l.company_id === COMPANY_ID && l.event_id === EVENT_ID)

      assert.ok(lock)
      assert.equal(lock.status, 'in_flight', 'Status do lock deve permanecer in_flight para falha ambígua')
      assert.equal(lock.completed_at, null)
    })
  })

  // ============================================================================
  // CENÁRIO 5: Falha Determinística (HTTP 4xx / Erro do Servidor Nítido)
  // ============================================================================
  describe('5. Falha Determinística: HTTP 4xx conclui o lock como failed permitindo retry futuro', () => {
    test('5.1. Gateway retorna HTTP 400 Bad Request -> lock é marcado como failed', async () => {
      const EVENT_ID = 'evt-p4-http400-001'

      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: false,
          status: 400,
          text: async () => '{"error": "Invalid phone number format"}'
        }
      })

      const payload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        customer: { phone: 'invalid-phone' },
        message: { content: 'Mensagem com payload inválido' }
      }

      const res = await sendOutboundMessage(COMPANY_ID, payload)

      assert.equal(res.success, false)
      assert.equal(res.reason, 'fetch_error')
      assert.equal(res.statusCode, 400)

      // Validação no Banco/Mock:
      // O lock DEVE ser marcado como 'failed' com last_error preenchido
      const locks = Array.from(inMemoryDb.gateway_outbound_locks.values())
      const lock = locks.find(l => l.company_id === COMPANY_ID && l.event_id === EVENT_ID)

      assert.ok(lock)
      assert.equal(lock.status, 'failed', 'Lock deve ser marcado como failed para erro determinístico')
      assert.ok(lock.last_error?.includes('HTTP 400'), 'last_error deve conter o status HTTP')
    })
  })

  // ============================================================================
  // CENÁRIO 6: Integração Ponta a Ponta com handleAutonomousCycle
  // ============================================================================
  describe('6. Integração com handleAutonomousCycle: Rastreabilidade rica e Short-circuit', () => {
    test('6.1. Ciclo autônomo popula outbox_id e message_id no gateway_outbound_locks', async () => {
      const EVENT_ID = 'evt-p4-cycle-001'
      const INBOUND_MSG_ID = '20000000-0000-0000-0000-000000000001'
      const EXPECTED_PROVIDER_ID = 'wamid.CYCLE_LOCK_SUCCESS_777'

      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ provider_message_id: EXPECTED_PROVIDER_ID })
        }
      })

      const mockLlm = {
        generateResponse: async () => ({
          content: 'Resposta gerada para teste de lock.',
          tool_calls: null,
          metadata: { confidence_score: 0.99 },
          usage: { prompt_tokens: 50, completion_tokens: 15, total_tokens: 65 }
        })
      }

      const inboundPayload = {
        event_id: EVENT_ID,
        channel: 'whatsapp',
        company_id: COMPANY_ID,
        customer: { phone: '5511999998888', name: 'Cliente Lock' },
        message: {
          id: INBOUND_MSG_ID,
          content: 'Olá, teste de lock no ciclo autônomo',
          sender_type: 'customer',
          created_at: new Date().toISOString()
        }
      }

      const cycleRes = await handleAutonomousCycle({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        eventId: EVENT_ID,
        messageId: INBOUND_MSG_ID,
        payload: inboundPayload,
        llmProvider: mockLlm as any
      })

      assert.equal(cycleRes.executed, true)
      assert.equal(cycleRes.dispatched, true)
      assert.equal(cycleRes.providerMessageId, EXPECTED_PROVIDER_ID)

      // Validação de rastreabilidade completa no lock de gateway
      const locks = Array.from(inMemoryDb.gateway_outbound_locks.values())
      const lock = locks.find(l => l.company_id === COMPANY_ID && l.event_id === `agent-reply-${EVENT_ID}`)

      assert.ok(lock, 'Lock de gateway deve existir com a chave de idempotência da outbox')
      assert.equal(lock.status, 'completed')
      assert.equal(lock.provider_message_id, EXPECTED_PROVIDER_ID)
      assert.equal(lock.outbox_id, cycleRes.outboxId, 'outbox_id deve bater com o retorno do ciclo')
      assert.equal(lock.message_id, cycleRes.replyMessageId, 'message_id deve bater com o reply do ciclo')
    })

    test('6.2. retryOutboxMessage adquire lock de gateway com outboxId e messageId vinculados', async () => {
      const RETRY_OUTBOX_ID = '77777777-7777-7777-7777-777777777777'
      const RETRY_MSG_ID = '88888888-8888-8888-8888-888888888888'
      const RETRY_EVENT_ID = 'evt-p4-retry-001'
      const RETRY_PROVIDER_ID = 'wamid.RETRY_LOCK_SUCCESS_888'

      inMemoryDb.messages.set(RETRY_MSG_ID, {
        id: RETRY_MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem de retry com lock',
        metadata: { delivery_status: 'failed' }
      })

      inMemoryDb.message_outbox.set(RETRY_OUTBOX_ID, {
        id: RETRY_OUTBOX_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        message_id: RETRY_MSG_ID,
        idempotency_key: RETRY_EVENT_ID,
        channel: 'whatsapp',
        recipient: '5511999998888',
        payload: {
          event_id: RETRY_EVENT_ID,
          channel: 'whatsapp',
          customer: { phone: '5511999998888' },
          message: { content: 'Mensagem de retry com lock' }
        },
        status: 'pending',
        attempts: 1,
        max_attempts: 5,
        claim_version: 0
      })

      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ provider_message_id: RETRY_PROVIDER_ID })
        }
      })

      const retryRes = await retryOutboxMessage(COMPANY_ID, RETRY_OUTBOX_ID)
      assert.equal(retryRes.success, true)

      // Validação do lock gerado no retry
      const locks = Array.from(inMemoryDb.gateway_outbound_locks.values())
      const lock = locks.find(l => l.company_id === COMPANY_ID && l.event_id === RETRY_EVENT_ID)

      assert.ok(lock, 'Lock de gateway deve ter sido criado para o retry')
      assert.equal(lock.status, 'completed')
      assert.equal(lock.provider_message_id, RETRY_PROVIDER_ID)
      assert.equal(lock.outbox_id, RETRY_OUTBOX_ID)
      assert.equal(lock.message_id, RETRY_MSG_ID)
    })
  })
})
