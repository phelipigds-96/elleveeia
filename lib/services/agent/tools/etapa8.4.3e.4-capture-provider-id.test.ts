// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  handleAutonomousCycle,
  retryOutboxMessage,
  updateMessageMetadataSafe,
  updateMessageDeliveryStatus
} from '@/lib/services/message-engine'
import {
  sendOutboundMessage,
  setMockHttpHandler
} from '@/lib/services/n8n-internal'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

describe('ETAPA E.4 — Fase 2: Captura do provider_message_id no Retorno Síncrono', () => {
  const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const CONVERSATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const AGENT_ID = 'agent-1111-aaaa'
  const INBOUND_MSG_ID = '10000000-0000-0000-0000-000000000001'

  function createValidPayload(eventId = 'evt-cap-001', content = 'Olá assistente'): any {
    return {
      event_id: eventId,
      channel: 'whatsapp',
      company_id: COMPANY_ID,
      customer: {
        phone: '5511999998888',
        name: 'Cliente Teste'
      },
      message: {
        id: `msg-${eventId}`,
        content,
        sender_type: 'customer',
        created_at: new Date().toISOString()
      }
    }
  }

  function createMockLLMProvider(replyContent = 'Resposta automática gerada pelo agente.') {
    return {
      generateResponse: async () => ({
        content: replyContent,
        tool_calls: null,
        metadata: {
          confidence_score: 0.98,
          detected_intent: 'greeting',
          working_memory: { stage: 'initial_contact' }
        },
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
      })
    }
  }

  beforeEach(() => {
    resetInMemoryDb()
    setMockHttpHandler(null)

    // 1. Cadastrar Empresa
    inMemoryDb.companies.set(COMPANY_ID, {
      id: COMPANY_ID,
      name: 'Empresa Alpha Test',
      slug: 'empresa-alpha-test',
      status: 'active',
      plan_tier: 'pro',
      created_at: new Date().toISOString()
    })

    // 2. Cadastrar Integração n8n
    inMemoryDb.integrations.set('int-alpha-001', {
      id: 'int-alpha-001',
      company_id: COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: {
        webhook_url: 'https://n8n.externo-confiavel.com/webhook/msg'
      },
      credentials: {
        webhook_secret: 'sec-alpha-secret'
      }
    })

    // 3. Cadastrar Agente
    inMemoryDb.agents.set(AGENT_ID, {
      id: AGENT_ID,
      company_id: COMPANY_ID,
      name: 'Agente de Testes',
      role: 'vendedor',
      is_active: true,
      is_default: true,
      llm_provider: 'gemini',
      llm_model: 'gemini-2.5-flash',
      prompt_template: 'Você é um assistente comercial.'
    })

    // 4. Cadastrar Conversa
    inMemoryDb.conversations.set(CONVERSATION_ID, {
      id: CONVERSATION_ID,
      company_id: COMPANY_ID,
      status: 'open',
      channel: 'whatsapp',
      agent_id: AGENT_ID,
      customer_id: 'cust-001'
    })
  })

  afterEach(() => {
    setMockHttpHandler(null)
  })

  // ============================================================================
  // GRUPO 1: Caminho Feliz — Captura do provider_message_id e Merge Perfeito de JSONB
  // ============================================================================
  describe('1. Caminho Feliz: Captura do provider_message_id', () => {
    test('1.1. Gateway retorna HTTP 200 com provider_message_id -> persiste ID e preserva metadados', async () => {
      const EXPECTED_PROVIDER_ID = 'wamid.HBgLMjA5NTg3NTU4MzAVAgARGBIyMzk5OTU0RUIxOUQ3OThBAA=='

      // Mock do gateway HTTP retornando 200 com JSON contendo provider_message_id
      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            success: true,
            provider_message_id: EXPECTED_PROVIDER_ID,
            message: 'Message queued and delivered to WhatsApp'
          }),
          json: async () => ({
            success: true,
            provider_message_id: EXPECTED_PROVIDER_ID,
            message: 'Message queued and delivered to WhatsApp'
          })
        }
      })

      const cycleResult = await handleAutonomousCycle({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        messageId: INBOUND_MSG_ID,
        eventId: 'evt-happy-001',
        payload: createValidPayload('evt-happy-001'),
        llmProvider: createMockLLMProvider('Olá! Como posso ajudar você?')
      })

      assert.equal(cycleResult.executed, true, 'Ciclo deve ter sido executado')
      assert.equal(cycleResult.dispatched, true, 'Mensagem deve ter sido despachada')
      assert.equal(cycleResult.providerMessageId, EXPECTED_PROVIDER_ID, 'Deve devolver providerMessageId no resultado')
      assert.ok(cycleResult.replyMessageId, 'Deve possuir ID de mensagem de resposta')
      assert.ok(cycleResult.outboxId, 'Deve possuir ID de outbox')

      // Validação no Banco: tabela message_outbox
      const outbox = inMemoryDb.message_outbox.get(cycleResult.outboxId)
      assert.ok(outbox, 'Registro de outbox deve existir')
      assert.equal(outbox.status, 'sent', 'Status da outbox deve ser sent')
      // Nota: coluna provider_message_id na message_outbox não existe no SQL atual (prevista para Fase 3)

      // Validação no Banco: tabela messages (Merge perfeito de JSONB)
      const message = inMemoryDb.messages.get(cycleResult.replyMessageId)
      assert.ok(message, 'Mensagem de resposta deve existir')
      assert.equal(message.metadata.delivery_status, 'sent', 'delivery_status deve ser sent')
      assert.equal(message.metadata.provider_message_id, EXPECTED_PROVIDER_ID, 'provider_message_id deve estar no metadata')

      // Preservação estrita dos metadados anteriores (Defesa contra sobrescrita)
      assert.equal(message.metadata.agent_id, AGENT_ID, 'agent_id anterior deve ser preservado')
      assert.equal(message.metadata.trigger_event_id, 'evt-happy-001', 'trigger_event_id anterior deve ser preservado')
      assert.equal(message.metadata.trigger_message_id, INBOUND_MSG_ID, 'trigger_message_id anterior deve ser preservado')

      // external_id de idempotência preservado
      assert.equal(message.external_id, 'agent-reply-evt-happy-001', 'external_id de idempotência deve ser preservado')
    })

    test('1.2. Gateway retorna formato alternativo com providerMessageId camelCase', async () => {
      const EXPECTED_PROVIDER_ID = 'wamid.CAMEL_CASE_PROVIDER_ID_999'

      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            status: 'sent',
            providerMessageId: EXPECTED_PROVIDER_ID
          }),
          json: async () => ({
            status: 'sent',
            providerMessageId: EXPECTED_PROVIDER_ID
          })
        }
      })

      const sendRes = await sendOutboundMessage(COMPANY_ID, {
        event_id: 'evt-camel-1',
        message: { content: 'Teste camelCase' }
      })

      assert.equal(sendRes.success, true)
      assert.equal((sendRes as any).provider_message_id, EXPECTED_PROVIDER_ID)
    })
  })

  // ============================================================================
  // GRUPO 2: Degradação Graciosa 1 — HTTP 200 com HTML ou Corpo Malformado
  // ============================================================================
  describe('2. Degradação Graciosa 1: Resposta 200 OK com Corpo Inválido/HTML', () => {
    test('2.1. Gateway retorna 200 com HTML (proxy reverso) -> Conclui outbox como enviada sem lançar erro', async () => {
      const HTML_RESPONSE = '<!DOCTYPE html><html><body><h1>200 OK from Cloudflare / Nginx</h1></body></html>'

      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => HTML_RESPONSE
        }
      })

      const cycleResult = await handleAutonomousCycle({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        messageId: INBOUND_MSG_ID,
        eventId: 'evt-html-001',
        payload: createValidPayload('evt-html-001'),
        llmProvider: createMockLLMProvider('Resposta tolerante a falhas.')
      })

      // Regra de ouro: HTTP response.ok === true significa envio aceito -> NÃO PODE FALHAR
      assert.equal(cycleResult.executed, true)
      assert.equal(cycleResult.dispatched, true, 'Deve considerar despachada para evitar reenvio/duplicação')
      assert.equal(cycleResult.providerMessageId, undefined, 'Sem providerMessageId extraído')

      // Outbox concluída com sent
      const outbox = inMemoryDb.message_outbox.get(cycleResult.outboxId)
      assert.ok(outbox)
      assert.equal(outbox.status, 'sent', 'Outbox deve ser concluída como sent normalmente')

      // Mensagem no banco: delivery_status sent, sem provider_message_id, preservando metadados
      const message = inMemoryDb.messages.get(cycleResult.replyMessageId)
      assert.ok(message)
      assert.equal(message.metadata.delivery_status, 'sent')
      assert.equal(message.metadata.provider_message_id, undefined)
      assert.equal(message.metadata.agent_id, AGENT_ID)
      assert.equal(message.metadata.trigger_event_id, 'evt-html-001')
      assert.equal(message.metadata.trigger_message_id, INBOUND_MSG_ID)
    })

    test('2.2. sendOutboundMessage com corpo vazio ou text() rejeitado não lança exceção', async () => {
      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => {
            throw new Error('Stream read error')
          }
        }
      })

      const sendRes = await sendOutboundMessage(COMPANY_ID, {
        event_id: 'evt-stream-err',
        message: { content: 'Teste stream' }
      })

      assert.equal(sendRes.success, true, 'Mesmo com falha de leitura do corpo, HTTP ok confirma sucesso de envio')
      assert.equal((sendRes as any).provider_message_id, null)
    })
  })

  // ============================================================================
  // GRUPO 3: Degradação Graciosa 2 — JSON Válido sem provider_message_id
  // ============================================================================
  describe('3. Degradação Graciosa 2: JSON Válido sem chave provider_message_id', () => {
    test('3.1. Gateway retorna { status: "queued" } -> Conclui outbox e não polui metadata com undefined', async () => {
      setMockHttpHandler(async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            status: 'queued',
            recipient: '5511999998888',
            timestamp: new Date().toISOString()
          }),
          json: async () => ({
            status: 'queued',
            recipient: '5511999998888',
            timestamp: new Date().toISOString()
          })
        }
      })

      const cycleResult = await handleAutonomousCycle({
        companyId: COMPANY_ID,
        conversationId: CONVERSATION_ID,
        messageId: INBOUND_MSG_ID,
        eventId: 'evt-no-id-001',
        payload: createValidPayload('evt-no-id-001'),
        llmProvider: createMockLLMProvider('Resposta com JSON sem ID.')
      })

      assert.equal(cycleResult.executed, true)
      assert.equal(cycleResult.dispatched, true)
      assert.equal(cycleResult.providerMessageId, undefined)

      const outbox = inMemoryDb.message_outbox.get(cycleResult.outboxId)
      assert.ok(outbox)
      assert.equal(outbox.status, 'sent')

      const message = inMemoryDb.messages.get(cycleResult.replyMessageId)
      assert.ok(message)
      assert.equal(message.metadata.delivery_status, 'sent')

      // Verificação estrita: chave provider_message_id NÃO deve existir como undefined no objeto
      assert.equal(
        Object.prototype.hasOwnProperty.call(message.metadata, 'provider_message_id'),
        false,
        'provider_message_id não deve constar no metadata quando ausente no retorno'
      )

      // Metadados anteriores devem estar 100% íntegros
      assert.equal(message.metadata.agent_id, AGENT_ID)
      assert.equal(message.metadata.trigger_event_id, 'evt-no-id-001')
      assert.equal(message.metadata.trigger_message_id, INBOUND_MSG_ID)
    })
  })

  // ============================================================================
  // GRUPO 4: Teste Direto de updateMessageMetadataSafe (Merge Seguro JSONB)
  // ============================================================================
  describe('4. Mecanismo Seguro de Merge JSONB (updateMessageMetadataSafe)', () => {
    test('4.1. Preserva chaves arbitrárias existentes e ignora chaves undefined', async () => {
      const MSG_ID = '20000000-0000-0000-0000-000000000001'
      const adminClient = createAdminClient()

      // Mensagem prévia com metadados ricos
      inMemoryDb.messages.set(MSG_ID, {
        id: MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem existente',
        metadata: {
          original_prompt_version: 'v2.1',
          custom_crm_lead_id: 'lead-9876',
          user_tags: ['vip', 'recorrente'],
          delivery_status: 'pending'
        }
      })

      // Executa merge seguro injetando provider_message_id e chave com undefined proposital
      const updateRes = await updateMessageMetadataSafe(
        adminClient,
        COMPANY_ID,
        MSG_ID,
        {
          delivery_status: 'sent',
          provider_message_id: 'wamid.DIRECT_MERGE_TEST_123',
          undefined_key: undefined
        }
      )

      assert.equal(updateRes.success, true)

      const savedMsg = inMemoryDb.messages.get(MSG_ID)
      assert.ok(savedMsg)

      // 1. Chaves antigas mantidas
      assert.equal(savedMsg.metadata.original_prompt_version, 'v2.1')
      assert.equal(savedMsg.metadata.custom_crm_lead_id, 'lead-9876')
      assert.deepEqual(savedMsg.metadata.user_tags, ['vip', 'recorrente'])

      // 2. Chaves novas mescladas
      assert.equal(savedMsg.metadata.delivery_status, 'sent')
      assert.equal(savedMsg.metadata.provider_message_id, 'wamid.DIRECT_MERGE_TEST_123')

      // 3. Chave undefined descartada
      assert.equal(Object.prototype.hasOwnProperty.call(savedMsg.metadata, 'undefined_key'), false)

      // 4. external_id atualizado
      assert.equal(savedMsg.external_id, 'wamid.DIRECT_MERGE_TEST_123')
    })

    test('4.2. Isolamento de Tenant: updateMessageMetadataSafe rejeita ID de outra empresa', async () => {
      const OTHER_COMPANY_ID = '99999999-9999-9999-9999-999999999999'
      const MSG_ID = '30000000-0000-0000-0000-000000000001'
      const adminClient = createAdminClient()

      inMemoryDb.messages.set(MSG_ID, {
        id: MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem da Empresa Alpha',
        metadata: { delivery_status: 'pending' }
      })

      // Tenta atualizar usando OTHER_COMPANY_ID
      const updateRes = await updateMessageMetadataSafe(
        adminClient,
        OTHER_COMPANY_ID,
        MSG_ID,
        { provider_message_id: 'hack-id' }
      )

      assert.equal(updateRes.success, false)
      assert.equal(updateRes.error, 'Mensagem não encontrada.')

      const msg = inMemoryDb.messages.get(MSG_ID)
      assert.equal(msg.metadata.provider_message_id, undefined)
    })
  })

  // ============================================================================
  // GRUPO 5: Reconciliação no Fluxo de Retry (retryOutboxMessage)
  // ============================================================================
  describe('5. Captura no Fluxo de Retry (retryOutboxMessage)', () => {
    test('5.1. retryOutboxMessage captura provider_message_id e mescla metadados', async () => {
      const OUTBOX_RETRY_ID = '40000000-0000-0000-0000-000000000001'
      const RETRY_MSG_ID = '50000000-0000-0000-0000-000000000001'
      const RETRY_PROVIDER_ID = 'wamid.RETRY_SUCCESS_ID_777'

      inMemoryDb.messages.set(RETRY_MSG_ID, {
        id: RETRY_MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem aguardando retry',
        metadata: {
          retry_attempt: 1,
          original_agent_id: AGENT_ID,
          delivery_status: 'failed'
        }
      })

      inMemoryDb.message_outbox.set(OUTBOX_RETRY_ID, {
        id: OUTBOX_RETRY_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        message_id: RETRY_MSG_ID,
        idempotency_key: 'agent-retry-key-001',
        channel: 'whatsapp',
        recipient: '5511999998888',
        payload: {
          event_id: 'agent-retry-key-001',
          event_type: 'message.send',
          message: { content: 'Mensagem aguardando retry' }
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
          text: async () => JSON.stringify({
            provider_message_id: RETRY_PROVIDER_ID
          }),
          json: async () => ({
            provider_message_id: RETRY_PROVIDER_ID
          })
        }
      })

      const retryRes = await retryOutboxMessage(COMPANY_ID, OUTBOX_RETRY_ID)
      assert.equal(retryRes.success, true)
      assert.equal(retryRes.outcome, 'gateway_accepted')
      assert.equal(retryRes.providerMessageId, RETRY_PROVIDER_ID)

      // Valida message_outbox atualizada
      const outbox = inMemoryDb.message_outbox.get(OUTBOX_RETRY_ID)
      assert.equal(outbox.status, 'sent')

      // Valida messages com metadados mesclados
      const msg = inMemoryDb.messages.get(RETRY_MSG_ID)
      assert.equal(msg.metadata.delivery_status, 'sent')
      assert.equal(msg.metadata.provider_message_id, RETRY_PROVIDER_ID)
      assert.equal(msg.metadata.retry_attempt, 1, 'retry_attempt deve ser preservado')
      assert.equal(msg.metadata.original_agent_id, AGENT_ID, 'original_agent_id deve ser preservado')
    })
  })

  // ============================================================================
  // GRUPO 6: Prevenção de Lost Update em Concorrência (Retorno Síncrono vs Callback Assíncrono)
  // ============================================================================
  describe('6. Concorrência: Prevenção de Lost Update entre Retorno Síncrono e Callback', () => {
    test('6.1. Chamadas intercaladas/simultâneas entre updateMessageMetadataSafe e updateMessageDeliveryStatus preservam ambos os campos', async () => {
      const CONCURRENT_MSG_ID = '60000000-0000-0000-0000-000000000001'
      const PROVIDER_ID = 'wamid.CONCURRENT_TEST_999'
      const adminClient = createAdminClient()

      // Mensagem inicial no banco antes de qualquer retorno
      inMemoryDb.messages.set(CONCURRENT_MSG_ID, {
        id: CONCURRENT_MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem concorrente',
        metadata: {
          agent_id: AGENT_ID,
          trigger_event_id: 'evt-conc-001'
        }
      })

      // Simula a chegada quase simultânea:
      // Operação A: Retorno HTTP 200 síncrono do gateway tentando salvar provider_message_id e delivery_status: 'sent'
      const opA = updateMessageMetadataSafe(adminClient, COMPANY_ID, CONCURRENT_MSG_ID, {
        delivery_status: 'sent',
        provider_message_id: PROVIDER_ID
      })

      // Operação B: Webhook assíncrono de status da Evolution API entregando delivery_status: 'delivered'
      const opB = updateMessageDeliveryStatus(COMPANY_ID, CONCURRENT_MSG_ID, 'delivered', {
        adminClient
      })

      // Executa ambas de forma intercalada/concorrente
      const [resA, resB] = await Promise.all([opA, opB])

      assert.equal(resA.success, true, 'Operação A deve ter sucesso')
      assert.equal(resB.success, true, 'Operação B deve ter sucesso')

      // Verificação do estado final no banco de dados:
      const finalMsg = inMemoryDb.messages.get(CONCURRENT_MSG_ID)
      assert.ok(finalMsg, 'Mensagem deve existir no banco')

      // 1. provider_message_id NÃO foi perdido pelo update de status
      assert.equal(
        finalMsg.metadata.provider_message_id,
        PROVIDER_ID,
        'provider_message_id deve estar preservado no metadata'
      )

      // 2. delivery_status é 'delivered' (não foi regredido para 'sent' pela resposta síncrona)
      assert.equal(
        finalMsg.metadata.delivery_status,
        'delivered',
        'delivery_status deve ser delivered e não pode ter regredido para sent'
      )

      // 3. Metadados preexistentes íntegros
      assert.equal(finalMsg.metadata.agent_id, AGENT_ID)
      assert.equal(finalMsg.metadata.trigger_event_id, 'evt-conc-001')
    })

    test('6.2. Ordem invertida: callback delivered registrado primeiro não é regredido por retorno síncrono tardio', async () => {
      const INVERTED_MSG_ID = '70000000-0000-0000-0000-000000000001'
      const PROVIDER_ID = 'wamid.INVERTED_ORDER_777'
      const adminClient = createAdminClient()

      inMemoryDb.messages.set(INVERTED_MSG_ID, {
        id: INVERTED_MSG_ID,
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        sender_type: 'agent',
        content: 'Mensagem com callback adiantado',
        metadata: {
          agent_id: AGENT_ID,
          trigger_event_id: 'evt-inv-001',
          delivery_status: 'delivered',
          delivery_updated_at: new Date().toISOString()
        }
      })

      // Retorno síncrono do gateway chega com atraso contendo delivery_status: 'sent' e provider_message_id
      const resSafe = await updateMessageMetadataSafe(adminClient, COMPANY_ID, INVERTED_MSG_ID, {
        delivery_status: 'sent',
        provider_message_id: PROVIDER_ID
      })

      assert.equal(resSafe.success, true)

      const finalMsg = inMemoryDb.messages.get(INVERTED_MSG_ID)
      assert.ok(finalMsg)

      // Status 'delivered' prevaleceu sobre 'sent' (máquina de estados monotônica)
      assert.equal(finalMsg.metadata.delivery_status, 'delivered', 'Status não deve regredir de delivered para sent')
      // provider_message_id foi devidamente incorporado
      assert.equal(finalMsg.metadata.provider_message_id, PROVIDER_ID, 'provider_message_id deve ter sido incorporado')
      // external_id foi atualizado
      assert.equal(finalMsg.external_id, PROVIDER_ID)
      // Metadados anteriores íntegros
      assert.equal(finalMsg.metadata.agent_id, AGENT_ID)
      assert.equal(finalMsg.metadata.trigger_event_id, 'evt-inv-001')
    })
  })
})
