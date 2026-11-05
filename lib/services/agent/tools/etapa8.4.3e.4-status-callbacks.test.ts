// @ts-nocheck
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  validateWebhookStatusPayload,
  webhookStatusSchema,
  DELIVERY_STATUSES
} from '@/lib/validations/webhook'
import {
  updateMessageDeliveryStatus,
  DELIVERY_STATUS_RANK
} from '@/lib/services/message-engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { createAdminClient } from '@/lib/supabase/service'

// Rotas HTTP Next.js
import { POST as statusRoutePost } from '@/app/api/webhooks/status/route'
import { POST as messagesRoutePost } from '@/app/api/webhooks/messages/route'

describe('ETAPA E.4 — Fase 1: Suporte a Callbacks de Status no Ellevee IA', () => {
  const COMPANY_A_ID = '11111111-1111-1111-1111-111111111111'
  const COMPANY_B_ID = '22222222-2222-2222-2222-222222222222'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'

  const CONV_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const MSG_1_ID = '10000000-1111-1111-1111-111111111111'
  const MSG_B_ID = '20000000-2222-2222-2222-222222222222'
  const OUTBOX_1_ID = '30000000-1111-1111-1111-111111111111'

  const VALID_SECRET_A = 'secret-alpha-valid'

  beforeEach(() => {
    resetInMemoryDb()

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(COMPANY_A_ID, {
      id: COMPANY_A_ID,
      name: 'Empresa Alpha',
      slug: 'empresa-alpha',
      status: 'active'
    })

    inMemoryDb.companies.set(COMPANY_B_ID, {
      id: COMPANY_B_ID,
      name: 'Empresa Beta',
      slug: 'empresa-beta',
      status: 'active'
    })

    inMemoryDb.companies.set(SUSPENDED_COMPANY_ID, {
      id: SUSPENDED_COMPANY_ID,
      name: 'Empresa Suspensa',
      slug: 'empresa-suspensa',
      status: 'suspended',
      suspension_reason: 'Inadimplência'
    })

    // 2. Chaves de API
    inMemoryDb.api_keys.set('key-a', {
      id: 'key-a',
      company_id: COMPANY_A_ID,
      key: VALID_SECRET_A,
      description: 'Chave Primária Alpha'
    })

    // 3. Conversas e Mensagens
    inMemoryDb.conversations.set(CONV_A_ID, {
      id: CONV_A_ID,
      company_id: COMPANY_A_ID,
      status: 'open'
    })

    inMemoryDb.messages.set(MSG_1_ID, {
      id: MSG_1_ID,
      company_id: COMPANY_A_ID,
      conversation_id: CONV_A_ID,
      sender_type: 'agent',
      content: 'Olá! Mensagem de teste.',
      external_id: 'agent-reply-evt-001',
      metadata: {
        delivery_status: 'pending'
      }
    })

    inMemoryDb.messages.set(MSG_B_ID, {
      id: MSG_B_ID,
      company_id: COMPANY_B_ID,
      conversation_id: 'conv-b',
      sender_type: 'agent',
      content: 'Mensagem da Empresa B',
      external_id: 'agent-reply-evt-b',
      metadata: {
        delivery_status: 'pending'
      }
    })

    // 4. Outbox vinculada à mensagem 1
    inMemoryDb.message_outbox.set(OUTBOX_1_ID, {
      id: OUTBOX_1_ID,
      company_id: COMPANY_A_ID,
      conversation_id: CONV_A_ID,
      message_id: MSG_1_ID,
      idempotency_key: 'agent-reply-evt-001',
      status: 'processing',
      attempts: 1
    })
  })

  // ============================================================================
  // GRUPO 1: Validação do Schema Zod / TypeScript de Status Callbacks
  // ============================================================================
  describe('1. Validação de Schema (webhookStatusSchema)', () => {
    test('1.1. Payload válido com message_id e status sent é aceito', () => {
      const payload = {
        event_id: 'evt-stat-1',
        event_type: 'message.status',
        channel: 'whatsapp',
        message_id: MSG_1_ID,
        status: 'sent',
        timestamp: new Date().toISOString()
      }
      assert.equal(validateWebhookStatusPayload(payload), true)
    })

    test('1.2. Payload válido com provider_message_id e status delivered é aceito', () => {
      const payload = {
        event_id: 'evt-stat-2',
        event_type: 'message.status',
        provider_message_id: 'wamid.HBgLMjA5NTg3...',
        status: 'delivered',
        recipient_phone: '5511999998888'
      }
      assert.equal(validateWebhookStatusPayload(payload), true)
    })

    test('1.3. Payload sem message_id e sem provider_message_id é rejeitado', () => {
      const payload = {
        event_id: 'evt-stat-3',
        event_type: 'message.status',
        status: 'read'
      }
      assert.equal(validateWebhookStatusPayload(payload), false)
      const parse = webhookStatusSchema.safeParse(payload)
      assert.equal(parse.success, false)
    })

    test('1.4. Status desconhecido (ex: "viewed", "typing") é rejeitado', () => {
      const payload = {
        event_id: 'evt-stat-4',
        event_type: 'message.status',
        message_id: MSG_1_ID,
        status: 'viewed'
      }
      assert.equal(validateWebhookStatusPayload(payload), false)
    })

    test('1.5. event_type diferente de "message.status" é rejeitado', () => {
      const payload = {
        event_id: 'evt-stat-5',
        event_type: 'message.received',
        message_id: MSG_1_ID,
        status: 'sent'
      }
      assert.equal(validateWebhookStatusPayload(payload), false)
    })
  })

  // ============================================================================
  // GRUPO 2: Máquina de Estados Monotônica (updateMessageDeliveryStatus)
  // ============================================================================
  describe('2. Máquina de Estados Monotônica (updateMessageDeliveryStatus)', () => {
    test('2.1. Transição válida pending -> sent atualiza o metadata', async () => {
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'sent')
      assert.equal(res.success, true)
      assert.equal(res.updated, true)
      assert.equal(res.previousStatus, 'pending')
      assert.equal(res.currentStatus, 'sent')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'sent')
    })

    test('2.2. Transição válida sent -> delivered atualiza para delivered', async () => {
      // Primeiro define sent
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'sent')
      
      // Depois avança para delivered
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')
      assert.equal(res.success, true)
      assert.equal(res.updated, true)
      assert.equal(res.previousStatus, 'sent')
      assert.equal(res.currentStatus, 'delivered')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'delivered')
    })

    test('2.3. Transição válida delivered -> read atualiza para read', async () => {
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'read')
      assert.equal(res.success, true)
      assert.equal(res.updated, true)
      assert.equal(res.previousStatus, 'delivered')
      assert.equal(res.currentStatus, 'read')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'read')
    })

    test('2.4. Salto direto permitido pending -> delivered (skip-hop forward)', async () => {
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')
      assert.equal(res.success, true)
      assert.equal(res.updated, true)
      assert.equal(res.currentStatus, 'delivered')
    })

    test('2.5. Regressão bloqueada: delivered -> sent não altera o status', async () => {
      // Avança para delivered
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')

      // Chega callback atrasado com 'sent'
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'sent')
      assert.equal(res.success, true)
      assert.equal(res.updated, false, 'Não deve efetuar update em caso de regressão')
      assert.equal(res.reason, 'status_regression_ignored')
      assert.equal(res.currentStatus, 'delivered')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'delivered', 'Status no banco deve ser preservado como delivered')
    })

    test('2.6. Regressão bloqueada: read -> delivered ou read -> sent não altera', async () => {
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'read')

      const res1 = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')
      assert.equal(res1.updated, false)
      assert.equal(res1.reason, 'status_regression_ignored')

      const res2 = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'sent')
      assert.equal(res2.updated, false)
      assert.equal(res2.reason, 'status_regression_ignored')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'read')
    })

    test('2.7. Idempotência: delivered -> delivered retorna sucesso sem alteração no banco', async () => {
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')

      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')
      assert.equal(res.success, true)
      assert.equal(res.updated, false)
      assert.equal(res.reason, 'idempotent_no_change')
      assert.equal(res.currentStatus, 'delivered')
    })

    test('2.8. Transição para failed a partir de pending ou sent é permitida', async () => {
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, {
        messageId: MSG_1_ID,
        status: 'failed',
        error: 'Número de telefone inexistente no WhatsApp'
      })
      assert.equal(res.success, true)
      assert.equal(res.updated, true)
      assert.equal(res.currentStatus, 'failed')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'failed')
      assert.match(msg?.metadata?.delivery_error, /inexistente/i)
    })

    test('2.9. Regressão bloqueada: delivered ou read não regride para failed por erro tardio', async () => {
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')

      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, {
        messageId: MSG_1_ID,
        status: 'failed',
        error: 'Timeout após entrega'
      })
      assert.equal(res.updated, false)
      assert.equal(res.reason, 'status_regression_ignored')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'delivered', 'Mensagem entregue não pode ser revertida para failed')
    })

    test('2.10. Isolamento Multi-tenant: tentar atualizar mensagem de outro tenant falha', async () => {
      // MSG_B_ID pertence a COMPANY_B_ID; tenta atualizar usando COMPANY_A_ID
      const res = await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_B_ID, 'delivered')
      assert.equal(res.success, false)
      assert.equal(res.updated, false)
      assert.equal(res.reason, 'message_not_found')

      // Mensagem da Empresa B permanece intacta
      const msgB = inMemoryDb.messages.get(MSG_B_ID)
      assert.equal(msgB?.metadata?.delivery_status, 'pending')
    })

    test('2.11. Reconciliação com Outbox: callback de sent ou delivered transiciona outbox processing para sent', async () => {
      // Confirma que a outbox estava em 'processing'
      const outboxBefore = inMemoryDb.message_outbox.get(OUTBOX_1_ID)
      assert.equal(outboxBefore?.status, 'processing')

      // Recebe callback confirmando 'delivered'
      await updateMessageDeliveryStatus(COMPANY_A_ID, MSG_1_ID, 'delivered')

      // Outbox correspondente foi reconciliada para 'sent'
      const outboxAfter = inMemoryDb.message_outbox.get(OUTBOX_1_ID)
      assert.equal(outboxAfter?.status, 'sent')
      assert.ok(outboxAfter?.sent_at)
    })
  })

  // ============================================================================
  // GRUPO 3: Endpoint HTTP /api/webhooks/status
  // ============================================================================
  describe('3. Rota HTTP POST /api/webhooks/status', () => {
    test('3.1. Rejeita requisição sem credenciais com HTTP 401', async () => {
      const req = new Request('http://localhost:3000/api/webhooks/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: '1', event_type: 'message.status' })
      })

      const res = await statusRoutePost(req)
      assert.equal(res.status, 401)
      const data = await res.json()
      assert.match(data.error, /Credenciais.*ausentes/i)
    })

    test('3.2. Rejeita secret inválido com HTTP 401', async () => {
      const req = new Request('http://localhost:3000/api/webhooks/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ellevee-webhook-secret': 'secret-totalmente-errado'
        },
        body: JSON.stringify({ event_id: '1', event_type: 'message.status' })
      })

      const res = await statusRoutePost(req)
      assert.equal(res.status, 401)
      const data = await res.json()
      assert.match(data.error, /invalidas/i)
    })

    test('3.3. Tenant suspenso é bloqueado com accepted: false', async () => {
      inMemoryDb.api_keys.set('key-susp', {
        id: 'key-susp',
        company_id: SUSPENDED_COMPANY_ID,
        key: 'secret-susp'
      })

      const req = new Request('http://localhost:3000/api/webhooks/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ellevee-webhook-secret': 'secret-susp'
        },
        body: JSON.stringify({
          event_id: 'evt-susp',
          event_type: 'message.status',
          message_id: 'any',
          status: 'sent'
        })
      })

      const res = await statusRoutePost(req)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.accepted, false)
      assert.equal(data.reason, 'tenant_suspended')
    })

    test('3.4. Payload inválido retorna HTTP 400', async () => {
      const req = new Request('http://localhost:3000/api/webhooks/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ellevee-webhook-secret': VALID_SECRET_A
        },
        body: JSON.stringify({
          event_id: 'evt-inv',
          event_type: 'message.status',
          // sem message_id e sem provider_message_id
          status: 'sent'
        })
      })

      const res = await statusRoutePost(req)
      assert.equal(res.status, 400)
      const data = await res.json()
      assert.match(data.error, /invalida/i)
    })

    test('3.5. Callback válido processa e atualiza mensagem com HTTP 200', async () => {
      const req = new Request('http://localhost:3000/api/webhooks/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ellevee-webhook-secret': VALID_SECRET_A
        },
        body: JSON.stringify({
          event_id: 'evt-stat-valid',
          event_type: 'message.status',
          message_id: MSG_1_ID,
          status: 'delivered',
          timestamp: new Date().toISOString()
        })
      })

      const res = await statusRoutePost(req)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.success, true)
      assert.equal(data.updated, true)
      assert.equal(data.currentStatus, 'delivered')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'delivered')
    })
  })

  // ============================================================================
  // GRUPO 4: Suporte Unificado em /api/webhooks/messages
  // ============================================================================
  describe('4. Suporte Unificado de Status na Rota /api/webhooks/messages', () => {
    test('4.1. Payload com event_type "message.status" é aceito na rota principal sem erro 400', async () => {
      const req = new Request('http://localhost:3000/api/webhooks/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ellevee-webhook-secret': VALID_SECRET_A
        },
        body: JSON.stringify({
          event_id: 'evt-msg-status',
          event_type: 'message.status',
          message_id: MSG_1_ID,
          status: 'read'
        })
      })

      const res = await messagesRoutePost(req)
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.success, true)
      assert.equal(data.currentStatus, 'read')

      const msg = inMemoryDb.messages.get(MSG_1_ID)
      assert.equal(msg?.metadata?.delivery_status, 'read')
    })
  })
})
