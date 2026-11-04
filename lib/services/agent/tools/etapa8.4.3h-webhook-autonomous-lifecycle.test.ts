// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'mock-gemini-key'

import { POST } from '@/app/api/webhooks/messages/route'
import { processWebhookEvent, handleAutonomousCycle } from '@/lib/services/message-engine'
import { inMemoryDb, resetInMemoryDb, createAdminClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { TenantAccessError } from '@/lib/services/platform/tenant-access'

describe('ETAPA 8.4.3H — Integração do Ciclo de Vida do Tenant nos Webhooks e no Ciclo Autônomo', () => {
  // IDs de Empresas
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'
  const PROVISIONING_COMPANY_ID = '55555555-5555-5555-5555-555555555555'
  const CORRUPTED_COMPANY_ID = '66666666-6666-6666-6666-666666666666'

  // Secrets de Autenticação de Webhook
  const SECRET_ACTIVE = 'sec_active_1111'
  const SECRET_SUSPENDED = 'sec_suspended_3333'
  const SECRET_CANCELLED = 'sec_cancelled_4444'
  const SECRET_PROVISIONING = 'sec_provisioning_5555'
  const SECRET_CORRUPTED = 'sec_corrupted_6666'

  // IDs de Conversas, Clientes e Agentes
  const CONV_ACTIVE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CUST_ACTIVE_ID = 'cccccccc-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const AGENT_ACTIVE_ID = 'agent-1111-aaaa'

  const SENSITIVE_SUSPENSION_REASON = 'Bloqueio administrativo por suspeita de fraude fiscal e chargeback não autorizado'

  let fetchCallCount = 0
  let originalFetch: any

  function createMockLLMProvider(options: {
    replyContent?: string
    onGenerate?: () => void
  } = {}) {
    return {
      generateResponse: async () => {
        if (options.onGenerate) {
          options.onGenerate()
        }
        return {
          content: options.replyContent || 'Resposta comercial oficial gerada pela IA.',
          tool_calls: null,
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
        }
      }
    }
  }

  beforeEach(() => {
    resetInMemoryDb()
    fetchCallCount = 0
    originalFetch = globalThis.fetch

    globalThis.fetch = async (url: any, options: any) => {
      fetchCallCount++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully' })
      } as any
    }

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(ACTIVE_COMPANY_ID, {
      id: ACTIVE_COMPANY_ID,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-ativa-alpha',
      status: 'active',
      plan_tier: 'pro',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(SUSPENDED_COMPANY_ID, {
      id: SUSPENDED_COMPANY_ID,
      name: 'Empresa Suspensa Gamma',
      slug: 'empresa-suspensa-gamma',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: SENSITIVE_SUSPENSION_REASON,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CANCELLED_COMPANY_ID, {
      id: CANCELLED_COMPANY_ID,
      name: 'Empresa Cancelada Delta',
      slug: 'empresa-cancelada-delta',
      status: 'cancelled',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(PROVISIONING_COMPANY_ID, {
      id: PROVISIONING_COMPANY_ID,
      name: 'Empresa em Implantação Epsilon',
      slug: 'empresa-implantacao-epsilon',
      status: 'provisioning',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CORRUPTED_COMPANY_ID, {
      id: CORRUPTED_COMPANY_ID,
      name: 'Empresa Status Corrompido Zeta',
      slug: 'empresa-corrompida-zeta',
      status: 'status_desconhecido_invalido',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Credenciais de Webhook (api_keys)
    inMemoryDb.api_keys.set('key-active', {
      id: 'key-active',
      company_id: ACTIVE_COMPANY_ID,
      key: SECRET_ACTIVE,
      is_active: true
    })

    inMemoryDb.api_keys.set('key-suspended', {
      id: 'key-suspended',
      company_id: SUSPENDED_COMPANY_ID,
      key: SECRET_SUSPENDED,
      is_active: true
    })

    inMemoryDb.api_keys.set('key-cancelled', {
      id: 'key-cancelled',
      company_id: CANCELLED_COMPANY_ID,
      key: SECRET_CANCELLED,
      is_active: true
    })

    inMemoryDb.api_keys.set('key-provisioning', {
      id: 'key-provisioning',
      company_id: PROVISIONING_COMPANY_ID,
      key: SECRET_PROVISIONING,
      is_active: true
    })

    inMemoryDb.api_keys.set('key-corrupted', {
      id: 'key-corrupted',
      company_id: CORRUPTED_COMPANY_ID,
      key: SECRET_CORRUPTED,
      is_active: true
    })

    // Integrações n8n para envio externo
    inMemoryDb.integrations.set('int-active', {
      id: 'int-active',
      company_id: ACTIVE_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/active' },
      credentials: { webhook_secret: SECRET_ACTIVE }
    })

    // Agente elegível para a empresa ativa (usando Gemini mock)
    inMemoryDb.agents.set(AGENT_ACTIVE_ID, {
      id: AGENT_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      name: 'Agente Ativo',
      model: 'gemini-1.5-flash',
      provider: 'gemini',
      is_active: true,
      metadata: { is_default: true }
    })

    // Cliente e Conversa padrão para testes do ciclo autônomo
    inMemoryDb.customers.set(CUST_ACTIVE_ID, {
      id: CUST_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      name: 'Cliente Padrão',
      phone: '5511999991234'
    })

    inMemoryDb.conversations.set(CONV_ACTIVE_ID, {
      id: CONV_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      customer_id: CUST_ACTIVE_ID,
      channel: 'whatsapp',
      status: 'open',
      agent_id: AGENT_ACTIVE_ID
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // Utilitário auxiliar para criar Request de teste
  function createWebhookRequest(secret: string | null, body: any, headers: Record<string, string> = {}) {
    const reqHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...headers
    }
    if (secret) {
      reqHeaders['x-ellevee-webhook-secret'] = secret
    }
    return new Request('http://localhost:3000/api/webhooks/messages', {
      method: 'POST',
      headers: reqHeaders,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  }

  function createValidPayload(eventId = 'evt-test-1', phone = '5511999990001') {
    return {
      event_id: eventId,
      event_type: 'message.received',
      channel: 'whatsapp',
      customer: {
        name: 'Cliente Teste',
        phone: phone
      },
      message: {
        sender_type: 'customer',
        content: 'Olá, gostaria de consultar o preço de barras de chocolate',
        message_type: 'text'
      }
    }
  }

  // =========================================================================
  // SEÇÃO A: TESTES DO WEBHOOK DE ENTRADA (app/api/webhooks/messages/route.ts)
  // =========================================================================

  test('1. Webhook - Empresa ativa: evento segue o fluxo normal com sucesso', async () => {
    const payload = createValidPayload('evt-act-1', '5511999991111')
    const req = createWebhookRequest(SECRET_ACTIVE, payload)

    const res = await POST(req)
    assert.equal(res.status, 200)

    const json = await res.json()
    assert.equal(json.success, true)
    assert.equal(json.duplicate, false)
    assert.ok(json.conversation_id)
    assert.ok(json.message_id)

    // Confirma criação dos registros operacionais no banco
    assert.equal(inMemoryDb.webhook_events.size, 1)
    assert.ok(inMemoryDb.customers.size >= 1)
    assert.ok(inMemoryDb.conversations.size >= 1)
    assert.ok(inMemoryDb.messages.size >= 1)
  })

  test('2. Webhook - Empresa suspensa: HTTP 200 com accepted: false e reason: tenant_suspended, sem gravações operacionais', async () => {
    const initialEvents = inMemoryDb.webhook_events.size
    const initialCustomers = inMemoryDb.customers.size
    const initialConversations = inMemoryDb.conversations.size
    const initialMessages = inMemoryDb.messages.size
    const initialOutbox = inMemoryDb.message_outbox.size

    const payload = createValidPayload('evt-susp-1', '5511999993333')
    const req = createWebhookRequest(SECRET_SUSPENDED, payload)

    const res = await POST(req)
    assert.equal(res.status, 200)

    const json = await res.json()
    assert.equal(json.accepted, false)
    assert.equal(json.reason, 'tenant_suspended')

    // NUNCA deve vazar o motivo sensível de suspensão nem detalhes internos
    assert.equal((json as any).suspensionReason, undefined)
    assert.equal((json as any).suspension_reason, undefined)
    assert.equal((json as any).error, undefined)

    // NENHUM registro operacional deve ter sido gerado
    assert.equal(inMemoryDb.webhook_events.size, initialEvents, 'Nenhum webhook_event deve ser persistido')
    assert.equal(inMemoryDb.customers.size, initialCustomers, 'Nenhum customer deve ser persistido')
    assert.equal(inMemoryDb.conversations.size, initialConversations, 'Nenhuma conversa deve ser criada')
    assert.equal(inMemoryDb.messages.size, initialMessages, 'Nenhuma mensagem deve ser persistida')
    assert.equal(inMemoryDb.message_outbox.size, initialOutbox, 'Nenhuma outbox deve ser criada')
    assert.equal(fetchCallCount, 0, 'Nenhum disparo externo pode ser feito')
  })

  test('3. Webhook - Empresa cancelada: HTTP 200 com accepted: false e reason: tenant_cancelled, sem gravações operacionais', async () => {
    const initialEvents = inMemoryDb.webhook_events.size
    const payload = createValidPayload('evt-canc-1', '5511999994444')
    const req = createWebhookRequest(SECRET_CANCELLED, payload)

    const res = await POST(req)
    assert.equal(res.status, 200)

    const json = await res.json()
    assert.equal(json.accepted, false)
    assert.equal(json.reason, 'tenant_cancelled')

    assert.equal(inMemoryDb.webhook_events.size, initialEvents)
    assert.equal(fetchCallCount, 0)
  })

  test('4. Webhook - Empresa em provisioning: HTTP 200 com accepted: false e reason: tenant_provisioning, sem gravações operacionais', async () => {
    const initialEvents = inMemoryDb.webhook_events.size
    const payload = createValidPayload('evt-prov-1', '5511999995555')
    const req = createWebhookRequest(SECRET_PROVISIONING, payload)

    const res = await POST(req)
    assert.equal(res.status, 200)

    const json = await res.json()
    assert.equal(json.accepted, false)
    assert.equal(json.reason, 'tenant_provisioning')

    assert.equal(inMemoryDb.webhook_events.size, initialEvents)
    assert.equal(fetchCallCount, 0)
  })

  test('5. Webhook - Falha na consulta de status: fail-closed HTTP 503, sem processamento', async () => {
    const initialEvents = inMemoryDb.webhook_events.size
    const payload = createValidPayload('evt-corr-1', '5511999996666')
    const req = createWebhookRequest(SECRET_CORRUPTED, payload)

    const res = await POST(req)
    assert.equal(res.status, 503)

    const json = await res.json()
    assert.equal(json.accepted, false)
    assert.match(json.error, /Serviço temporariamente indisponível|Falha ao verificar autorização/i)

    assert.equal(inMemoryDb.webhook_events.size, initialEvents)
    assert.equal(fetchCallCount, 0)
  })

  test('6. Webhook - Credencial inválida ou empresa não identificada: preserva comportamento de autenticação (HTTP 401 e 400)', async () => {
    // 6a. Sem credenciais
    const reqNoAuth = createWebhookRequest(null, createValidPayload())
    const resNoAuth = await POST(reqNoAuth)
    assert.equal(resNoAuth.status, 401)
    const jsonNoAuth = await resNoAuth.json()
    assert.match(jsonNoAuth.error, /Credenciais de Webhook ausentes/i)

    // 6b. Credencial inexistente
    const reqBadAuth = createWebhookRequest('secret_completamente_inexistente_123', createValidPayload())
    const resBadAuth = await POST(reqBadAuth)
    assert.equal(resBadAuth.status, 401)
    const jsonBadAuth = await resBadAuth.json()
    assert.match(jsonBadAuth.error, /Credenciais de Webhook invalidas/i)

    // 6c. JSON quebrado
    const reqBadJson = createWebhookRequest(SECRET_ACTIVE, '{ invalid json syntax !!!')
    const resBadJson = await POST(reqBadJson)
    assert.equal(resBadJson.status, 400)
    const jsonBadJson = await resBadJson.json()
    assert.match(jsonBadJson.error, /Formato de Payload invalido/i)

    // 6d. Estrutura não suportada
    const reqBadPayload = createWebhookRequest(SECRET_ACTIVE, { unsupported_event: true })
    const resBadPayload = await POST(reqBadPayload)
    assert.equal(resBadPayload.status, 400)
    const jsonBadPayload = await resBadPayload.json()
    assert.match(jsonBadPayload.error, /Estrutura de evento nao suportada/i)
  })

  test('7. Webhook - processWebhookEvent chamado diretamente: bloqueia gravação sem validar o tenant (defesa em profundidade)', async () => {
    const payload = createValidPayload('evt-direct-1', '5511999993333')

    const initialEvents = inMemoryDb.webhook_events.size

    await assert.rejects(
      async () => {
        await processWebhookEvent(SUSPENDED_COMPANY_ID, payload)
      },
      (err: any) => {
        assert.ok(err instanceof TenantAccessError)
        assert.equal(err.code, 'TENANT_SUSPENDED')
        return true
      }
    )

    // Confirma que nenhuma gravação ocorreu mesmo chamando a função de persistência diretamente
    assert.equal(inMemoryDb.webhook_events.size, initialEvents)
  })

  test('8. Webhook - Evento duplicado: idempotência existente é preservada para empresa ativa', async () => {
    const payload = createValidPayload('evt-duplicate-idempotency', '5511999991111')
    
    // 1ª chamada
    const res1 = await POST(createWebhookRequest(SECRET_ACTIVE, payload))
    assert.equal(res1.status, 200)
    const json1 = await res1.json()
    assert.equal(json1.success, true)
    assert.equal(json1.duplicate, false)

    const eventsCountAfter1st = inMemoryDb.webhook_events.size

    // 2ª chamada com o mesmo event_id
    const res2 = await POST(createWebhookRequest(SECRET_ACTIVE, payload))
    assert.equal(res2.status, 200)
    const json2 = await res2.json()
    assert.equal(json2.success, true)
    assert.equal(json2.duplicate, true)
    assert.equal(json2.event_id, payload.event_id)

    // Permanece exatamente o mesmo número de webhook_events registrados
    assert.equal(inMemoryDb.webhook_events.size, eventsCountAfter1st)
  })

  // =========================================================================
  // SEÇÃO B: TESTES DO CICLO AUTÔNOMO (handleAutonomousCycle)
  // =========================================================================

  test('9. Ciclo Autônomo - Tenant bloqueado no início: não chama Agent Engine, LLM ou gateway', async () => {
    const payload = createValidPayload('evt-cycle-block-1', '5511999993333')

    const res = await handleAutonomousCycle({
      companyId: SUSPENDED_COMPANY_ID,
      conversationId: 'some-conv-id',
      messageId: 'some-msg-id',
      eventId: payload.event_id,
      payload
    })

    assert.equal(res.executed, false)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'tenant_blocked')
    assert.match(res.error, /acesso da empresa suspenso pela plataforma/i)
    assert.equal(fetchCallCount, 0, 'Fetch nunca deve ser executado')
    assert.equal(inMemoryDb.message_outbox.size, 0, 'Nenhuma outbox deve ser gerada')
  })

  test('10. Ciclo Autônomo - Tenant ativo no início, mas suspenso antes do despacho: 2ª validação bloqueia o envio e marca suppressed', async () => {
    const msgId = 'msg-toctou-1'
    inMemoryDb.messages.set(msgId, {
      id: msgId,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      sender_type: 'customer',
      content: 'Quanto custa chocolate 1kg?',
      created_at: new Date().toISOString()
    })

    // LLM provider que, durante a inferência (janela TOCTOU), simula a suspensão concorrente da empresa
    const mockLLM = createMockLLMProvider({
      replyContent: 'Resposta gerada antes da suspensão',
      onGenerate: () => {
        const comp = inMemoryDb.companies.get(ACTIVE_COMPANY_ID)
        comp.status = 'suspended'
        comp.suspension_reason = 'Suspensão concorrente durante inferência'
      }
    })

    const payload = createValidPayload('evt-toctou-1', '5511999991234')
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_ID,
      conversationId: CONV_ACTIVE_ID,
      messageId: msgId,
      eventId: payload.event_id,
      payload,
      llmProvider: mockLLM
    })

    // Validações estritas:
    assert.equal(res.executed, true, 'Agent engine foi executado')
    assert.equal(res.dispatched, false, 'O despacho DEVE ser bloqueado')
    assert.equal(res.reason, 'tenant_blocked', 'Motivo do bloqueio deve ser tenant_blocked')
    assert.equal(fetchCallCount, 0, 'Nenhum disparo externo pode ocorrer para a empresa suspensa')

    // Confirma supressão nos registros
    assert.ok(res.outboxId)
    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outboxRecord?.status, 'suppressed', 'A outbox deve ter sido atualizada para suppressed')
    assert.match(outboxRecord?.last_error, /Despacho suprimido antes do envio/i)

    // Confirma supressão na mensagem
    assert.ok(res.replyMessageId)
    const replyMsg = inMemoryDb.messages.get(res.replyMessageId)
    assert.equal(replyMsg?.metadata?.delivery_status, 'suppressed')
  })

  test('11. Ciclo Autônomo - Falha na 2ª consulta de status: fail-closed impede o envio externo', async () => {
    const msgId = 'msg-check2-fail-1'
    inMemoryDb.messages.set(msgId, {
      id: msgId,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      sender_type: 'customer',
      content: 'Mensagem teste',
      created_at: new Date().toISOString()
    })

    const mockLLM = createMockLLMProvider({
      onGenerate: () => {
        // Altera o status da empresa para um status inválido que dispara TENANT_STATUS_UNAVAILABLE
        const comp = inMemoryDb.companies.get(ACTIVE_COMPANY_ID)
        comp.status = 'status_invalido_corrompido'
      }
    })

    const payload = createValidPayload('evt-check2-fail-1', '5511999991234')
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_ID,
      conversationId: CONV_ACTIVE_ID,
      messageId: msgId,
      eventId: payload.event_id,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'tenant_blocked')
    assert.equal(fetchCallCount, 0, 'Em caso de falha de consulta, o envio DEVE ser bloqueado fail-closed')
  })

  test('12. Ciclo Autônomo - Falha ao persistir suppressed retornando { error }: mantém o envio rigorosamente bloqueado', async () => {
    const msgId = 'msg-up-err-1'
    inMemoryDb.messages.set(msgId, {
      id: msgId,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      sender_type: 'customer',
      content: 'Mensagem teste update error',
      created_at: new Date().toISOString()
    })

    const mockLLM = createMockLLMProvider({
      onGenerate: () => {
        inMemoryDb.companies.get(ACTIVE_COMPANY_ID).status = 'suspended'
      }
    })

    const baseClient = createAdminClient()
    let updateAttempted = false
    const proxyClient = {
      ...baseClient,
      from: (table: string) => {
        const builder = baseClient.from(table)
        if (table === 'message_outbox') {
          return {
            ...builder,
            update: (data: any) => ({
              eq: async (col: string, val: string) => {
                updateAttempted = true
                return { data: null, error: { message: 'Lock deadlock on outbox (40P01)', code: '40P01' } }
              }
            })
          }
        }
        return builder
      }
    }

    const payload = createValidPayload('evt-up-err-1', '5511999991234')
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_ID,
      conversationId: CONV_ACTIVE_ID,
      messageId: msgId,
      eventId: payload.event_id,
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(updateAttempted, true)
    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'tenant_blocked')
    assert.equal(fetchCallCount, 0, 'Falha ao persistir status suppressed NUNCA pode liberar o envio externo')
  })

  test('13. Ciclo Autônomo - Falha ao persistir suppressed por exceção: mantém o envio rigorosamente bloqueado', async () => {
    const msgId = 'msg-exc-1'
    inMemoryDb.messages.set(msgId, {
      id: msgId,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      sender_type: 'customer',
      content: 'Mensagem teste exception',
      created_at: new Date().toISOString()
    })

    const mockLLM = createMockLLMProvider({
      onGenerate: () => {
        inMemoryDb.companies.get(ACTIVE_COMPANY_ID).status = 'suspended'
      }
    })

    const baseClient = createAdminClient()
    let updateAttempted = false
    const proxyClient = {
      ...baseClient,
      from: (table: string) => {
        const builder = baseClient.from(table)
        if (table === 'message_outbox') {
          return {
            ...builder,
            update: (data: any) => ({
              eq: async (col: string, val: string) => {
                updateAttempted = true
                throw new Error('Falha catastrófica de socket no update')
              }
            })
          }
        }
        return builder
      }
    }

    const payload = createValidPayload('evt-exc-1', '5511999991234')
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_ID,
      conversationId: CONV_ACTIVE_ID,
      messageId: msgId,
      eventId: payload.event_id,
      payload,
      adminClient: proxyClient,
      llmProvider: mockLLM
    })

    assert.equal(updateAttempted, true)
    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(res.reason, 'tenant_blocked')
    assert.equal(fetchCallCount, 0, 'Exceção ao persistir status suppressed NUNCA pode liberar o envio externo')
  })

  test('14. Ciclo Autônomo - Gateway retorna success: false: não marca mensagem ou outbox como sent', async () => {
    globalThis.fetch = async () => {
      fetchCallCount++
      return {
        ok: false,
        status: 502,
        text: async () => 'n8n Bad Gateway'
      } as any
    }

    const msgId = 'msg-gw-fail-1'
    inMemoryDb.messages.set(msgId, {
      id: msgId,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      sender_type: 'customer',
      content: 'Pergunta teste gateway fail',
      created_at: new Date().toISOString()
    })

    const mockLLM = createMockLLMProvider({ replyContent: 'Resposta do agente' })
    const payload = createValidPayload('evt-gw-fail-1', '5511999991234')
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_ID,
      conversationId: CONV_ACTIVE_ID,
      messageId: msgId,
      eventId: payload.event_id,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, false)
    assert.equal(fetchCallCount, 1)

    // A outbox criada no ciclo deve estar com status 'failed' e NUNCA 'sent'
    assert.ok(res.outboxId)
    const outbox = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outbox?.status, 'failed')
    assert.notEqual(outbox?.status, 'sent')
  })

  test('15. Ciclo Autônomo - Tenant ativo durante todo o fluxo: comportamento normal preservado com entrega com sucesso', async () => {
    const msgId = 'msg-full-active-1'
    inMemoryDb.messages.set(msgId, {
      id: msgId,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      sender_type: 'customer',
      content: 'Qual o valor do chocolate blend?',
      created_at: new Date().toISOString()
    })

    const mockLLM = createMockLLMProvider({ replyContent: 'Olá! Temos chocolate blend a partir de R$ 35,00.' })
    const payload = createValidPayload('evt-full-active-1', '5511999991234')
    const res = await handleAutonomousCycle({
      companyId: ACTIVE_COMPANY_ID,
      conversationId: CONV_ACTIVE_ID,
      messageId: msgId,
      eventId: payload.event_id,
      payload,
      llmProvider: mockLLM
    })

    assert.equal(res.executed, true)
    assert.equal(res.dispatched, true)
    assert.equal(fetchCallCount, 1)
    assert.ok(res.outboxId)
    assert.ok(res.replyMessageId)

    const outboxRecord = inMemoryDb.message_outbox.get(res.outboxId)
    assert.equal(outboxRecord?.status, 'sent')
    assert.ok(outboxRecord?.sent_at)
  })
})
