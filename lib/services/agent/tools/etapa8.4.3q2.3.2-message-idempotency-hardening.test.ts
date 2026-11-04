import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { inMemoryDb, resetInMemoryDb, createAdminClient, createAuthenticatedClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { processWebhookEvent } from '../../message-engine.ts'
import { validateWebhookPayload, type WebhookPayload } from '@/lib/validations/webhook'

const COMPANY_A = '11111111-1111-1111-1111-111111111111'
const COMPANY_B = '22222222-2222-2222-2222-222222222222'

function setupMockDatabase() {
  resetInMemoryDb()

  inMemoryDb.companies.set(COMPANY_A, {
    id: COMPANY_A,
    name: 'Empresa Alpha',
    slug: 'empresa-alpha',
    status: 'active',
    plan_tier: 'standard',
    created_at: new Date().toISOString()
  })

  inMemoryDb.companies.set(COMPANY_B, {
    id: COMPANY_B,
    name: 'Empresa Beta',
    slug: 'empresa-beta',
    status: 'active',
    plan_tier: 'standard',
    created_at: new Date().toISOString()
  })

  inMemoryDb.company_limits.set('lim-a', {
    id: 'lim-a',
    company_id: COMPANY_A,
    max_agents: 5,
    max_monthly_messages: 5000,
    max_monthly_quotes: 1000,
    max_catalog_items: 50000,
    allowed_llm_providers: ['gemini']
  })

  inMemoryDb.company_limits.set('lim-b', {
    id: 'lim-b',
    company_id: COMPANY_B,
    max_agents: 5,
    max_monthly_messages: 5000,
    max_monthly_quotes: 1000,
    max_catalog_items: 50000,
    allowed_llm_providers: ['gemini']
  })
}

function makeWebhookPayload(params: {
  eventId: string
  externalMsgId?: string
  externalConvId?: string
  senderType?: 'customer' | 'agent' | 'human' | 'system'
  content?: string
  phone?: string
  channel?: string
  createdAt?: string
}): WebhookPayload {
  return {
    event_id: params.eventId,
    event_type: 'message.received',
    channel: params.channel || 'whatsapp',
    customer: {
      phone: params.phone || '+5511999990001',
      name: 'Cliente Teste'
    },
    conversation: params.externalConvId ? { external_id: params.externalConvId } : undefined,
    message: {
      content: params.content || 'Olá, preciso de um orçamento',
      sender_type: params.senderType || 'customer',
      message_type: 'text',
      external_id: params.externalMsgId,
      created_at: params.createdAt || new Date().toISOString()
    }
  }
}

describe('ETAPA 8.4.3Q.2.3.2 — Correção da Chave de Idempotência e Hardening da RPC', () => {
  beforeEach(() => {
    setupMockDatabase()
  })

  it('1. Primeira mensagem de uma conversa é inserida com sucesso', async () => {
    const adminClient = createAdminClient()
    const payload = makeWebhookPayload({
      eventId: 'evt-q232-001',
      externalMsgId: 'ext-msg-001',
      externalConvId: 'conv-001',
      createdAt: new Date().toISOString()
    })

    const result = await processWebhookEvent(COMPANY_A, payload, { adminClient })
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.duplicate, false)
    assert.ok(result.message_id)
    assert.ok(result.conversation_id)

    const msg = inMemoryDb.messages.get(result.message_id)
    assert.ok(msg)
    assert.strictEqual(msg.conversation_id, result.conversation_id)
    assert.strictEqual(msg.external_id, 'ext-msg-001')

    const conv = inMemoryDb.conversations.get(result.conversation_id)
    assert.strictEqual(conv.unread_count, 1)
  })

  it('2. Reenvio da mesma mensagem não duplica registro', async () => {
    const adminClient = createAdminClient()
    const payload = makeWebhookPayload({
      eventId: 'evt-q232-002',
      externalMsgId: 'ext-msg-002',
      externalConvId: 'conv-002'
    })

    const res1 = await processWebhookEvent(COMPANY_A, payload, { adminClient })
    assert.strictEqual(res1.duplicate, false)

    // Reenvio imediato do mesmo evento
    const res2 = await processWebhookEvent(COMPANY_A, payload, { adminClient })
    assert.strictEqual(res2.duplicate, true)

    let msgCount = 0
    for (const msg of inMemoryDb.messages.values()) {
      if (msg.external_id === 'ext-msg-002') msgCount++
    }
    assert.strictEqual(msgCount, 1)
  })

  it('3. Mesmo external_id em conversas diferentes da mesma empresa é aceito (Telegram / Chat IDs sequenciais)', async () => {
    const adminClient = createAdminClient()

    // Conversa 1 da Empresa A (ex: Chat Telegram com Cliente 1) -> mensagem ID "1"
    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-telegram-chat1-msg1',
      externalConvId: 'telegram-chat-001',
      externalMsgId: '1', // Telegram sequencial inicia em 1
      phone: '+5511988880001',
      channel: 'telegram',
      content: 'Olá do Cliente 1'
    }), { adminClient })

    // Conversa 2 da Empresa A (ex: Chat Telegram com Cliente 2) -> mensagem ID "1"
    const res2 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-telegram-chat2-msg1',
      externalConvId: 'telegram-chat-002',
      externalMsgId: '1', // Telegram sequencial também inicia em 1!
      phone: '+5511988880002',
      channel: 'telegram',
      content: 'Olá do Cliente 2'
    }), { adminClient })

    assert.strictEqual(res1.success, true)
    assert.strictEqual(res2.success, true)
    assert.notStrictEqual(res1.conversation_id, res2.conversation_id)
    assert.notStrictEqual(res1.message_id, res2.message_id, 'Mensagens de conversas diferentes com mesmo external_id NÃO podem colidir')

    // Ambas as conversas devem ter recebido suas mensagens e seus respectivos unread_count = 1
    const conv1 = inMemoryDb.conversations.get(res1.conversation_id!)
    const conv2 = inMemoryDb.conversations.get(res2.conversation_id!)
    assert.strictEqual(conv1.unread_count, 1)
    assert.strictEqual(conv2.unread_count, 1)
  })

  it('4. Mesmo external_id em empresas diferentes continua estritamente isolado', async () => {
    const adminClient = createAdminClient()
    const payloadA = makeWebhookPayload({
      eventId: 'evt-compA-msg',
      externalConvId: 'conv-shared-id',
      externalMsgId: 'wamid-shared-123'
    })
    const payloadB = makeWebhookPayload({
      eventId: 'evt-compB-msg',
      externalConvId: 'conv-shared-id',
      externalMsgId: 'wamid-shared-123'
    })

    const resA = await processWebhookEvent(COMPANY_A, payloadA, { adminClient })
    const resB = await processWebhookEvent(COMPANY_B, payloadB, { adminClient })

    assert.strictEqual(resA.success, true)
    assert.strictEqual(resB.success, true)
    assert.notStrictEqual(resA.message_id, resB.message_id)

    const msgA = inMemoryDb.messages.get(resA.message_id!)
    const msgB = inMemoryDb.messages.get(resB.message_id!)
    assert.strictEqual(msgA.company_id, COMPANY_A)
    assert.strictEqual(msgB.company_id, COMPANY_B)
  })

  it('5. Mesmo external_id em canais/provedores diferentes da mesma empresa coexistem sem colisão', async () => {
    const adminClient = createAdminClient()

    // Mensagem no WhatsApp com external_id "msg-100"
    const resWpp = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-wpp-100',
      externalConvId: 'conv-wpp',
      externalMsgId: 'msg-100',
      channel: 'whatsapp'
    }), { adminClient })

    // Mensagem no Webchat com MESMO external_id "msg-100"
    const resWeb = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-web-100',
      externalConvId: 'conv-webchat',
      externalMsgId: 'msg-100',
      channel: 'webchat'
    }), { adminClient })

    assert.strictEqual(resWpp.success, true)
    assert.strictEqual(resWeb.success, true)
    assert.notStrictEqual(resWpp.message_id, resWeb.message_id, 'Mensagens de canais/conversas diferentes não colidem')
  })

  it('6. Duplicata na mesma conversa não incrementa unread_count', async () => {
    const adminClient = createAdminClient()
    const convExternalId = 'conv-dup-counter'

    // 1ª entrega
    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-dup-cnt-1',
      externalConvId: convExternalId,
      externalMsgId: 'ext-dup-cnt'
    }), { adminClient })

    const convId = res1.conversation_id!
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 1)

    // 2ª entrega com event_id diferente mas mesmo external_id na mesma conversa
    const res2 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-dup-cnt-2', // Event ID diferente
      externalConvId: convExternalId,
      externalMsgId: 'ext-dup-cnt' // Mesmo external_id
    }), { adminClient })

    assert.strictEqual(res2.message_id, res1.message_id)
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 1, 'unread_count não deve ser incrementado')
  })

  it('7. Conflito de chave recupera estritamente a mensagem da MESMA conversa', async () => {
    const adminClient = createAdminClient()
    const convId1 = 'cccccccc-0001-0000-0000-000000000001'
    const convId2 = 'cccccccc-0002-0000-0000-000000000002'

    // Cria duas conversas na mesma empresa
    inMemoryDb.conversations.set(convId1, {
      id: convId1,
      company_id: COMPANY_A,
      channel: 'whatsapp',
      status: 'open',
      unread_count: 0,
      last_message_at: new Date().toISOString()
    })
    inMemoryDb.conversations.set(convId2, {
      id: convId2,
      company_id: COMPANY_A,
      channel: 'whatsapp',
      status: 'open',
      unread_count: 0,
      last_message_at: new Date().toISOString()
    })

    // Insere mensagem na conversa 1
    const rpcRes1 = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId1,
      p_external_id: 'shared-ext-id',
      p_sender_type: 'customer',
      p_content: 'Mensagem Conv 1',
      p_created_at: new Date().toISOString()
    })
    assert.strictEqual(rpcRes1.data[0].was_inserted, true)
    const msgIdConv1 = rpcRes1.data[0].message_id

    // Reenvio para a mesma conversa 1 (deve recuperar msgIdConv1)
    const rpcResDup = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId1,
      p_external_id: 'shared-ext-id',
      p_sender_type: 'customer',
      p_content: 'Mensagem Conv 1 Dup',
      p_created_at: new Date().toISOString()
    })
    assert.strictEqual(rpcResDup.data[0].was_inserted, false)
    assert.strictEqual(rpcResDup.data[0].message_id, msgIdConv1)

    // Inserção na conversa 2 com MESMO external_id (deve ser inserida como NOVA e não recuperar msg da conv 1)
    const rpcResConv2 = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId2,
      p_external_id: 'shared-ext-id',
      p_sender_type: 'customer',
      p_content: 'Mensagem Conv 2',
      p_created_at: new Date().toISOString()
    })
    assert.strictEqual(rpcResConv2.data[0].was_inserted, true)
    assert.notStrictEqual(rpcResConv2.data[0].message_id, msgIdConv1)
  })

  it('8. Conversa não existente ou incompatível com a empresa do chamador é rejeitada', async () => {
    const adminClient = createAdminClient()
    const nonExistentConv = '00000000-ffff-ffff-ffff-000000000000'

    const res = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: nonExistentConv,
      p_external_id: 'msg-err',
      p_sender_type: 'customer',
      p_content: 'Teste',
      p_created_at: new Date().toISOString()
    })

    assert.ok(res.error)
    assert.match(res.error.message, /não encontrada ou não pertence à empresa/)
  })

  it('9. sender_type inválido é rejeitado pela RPC e pelo validador', async () => {
    const adminClient = createAdminClient()
    const convId = 'cccccccc-0001-0000-0000-000000000001'
    inMemoryDb.conversations.set(convId, {
      id: convId,
      company_id: COMPANY_A,
      status: 'open',
      unread_count: 0,
      last_message_at: new Date().toISOString()
    })

    // Validador rejeita sender_type inválido
    const invalidPayload = makeWebhookPayload({
      eventId: 'evt-bad-sender',
      senderType: 'hacker' as any
    })
    assert.strictEqual(validateWebhookPayload(invalidPayload), false)

    // RPC também rejeita defensivamente
    const rpcRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId,
      p_external_id: 'msg-bad-sender',
      p_sender_type: 'invalid_type',
      p_content: 'Teste',
      p_created_at: new Date().toISOString()
    })

    assert.ok(rpcRes.error)
    assert.match(rpcRes.error.message, /p_sender_type inválido/)
  })

  it('10. Timestamp inválido (string não data) é rejeitado', async () => {
    const adminClient = createAdminClient()
    const convId = 'cccccccc-0001-0000-0000-000000000001'
    inMemoryDb.conversations.set(convId, {
      id: convId,
      company_id: COMPANY_A,
      status: 'open',
      unread_count: 0,
      last_message_at: new Date().toISOString()
    })

    // Validador do webhook rejeita data inválida
    const invalidDatePayload: any = makeWebhookPayload({
      eventId: 'evt-bad-date',
      createdAt: 'data-invalida-nao-iso'
    })
    assert.strictEqual(validateWebhookPayload(invalidDatePayload), false)

    // RPC rejeita data inválida
    const rpcRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId,
      p_external_id: 'msg-bad-date',
      p_sender_type: 'customer',
      p_content: 'Teste',
      p_created_at: 'nao-e-uma-data'
    })

    assert.ok(rpcRes.error)
    assert.strictEqual(rpcRes.error.code, '22007')
  })

  it('11. Timestamp futuro preserva o valor original na mensagem sem permitir que last_message_at avance para o futuro distante', async () => {
    const adminClient = createAdminClient()
    const convId = 'cccccccc-0001-0000-0000-000000000001'
    const pastTime = new Date(Date.now() - 3600000).toISOString()
    inMemoryDb.conversations.set(convId, {
      id: convId,
      company_id: COMPANY_A,
      status: 'open',
      unread_count: 0,
      last_message_at: pastTime
    })

    // Data 30 dias no futuro (relógio com ano/mês errado do remetente)
    const thirtyDaysFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    // 1. Validador de webhook rejeita data que exceda a tolerância máxima (48h)
    const futurePayload = makeWebhookPayload({
      eventId: 'evt-future-30d',
      createdAt: thirtyDaysFuture
    })
    assert.strictEqual(validateWebhookPayload(futurePayload), false, 'Webhook deve rejeitar timestamps que excedam 48h no futuro')

    // 2. Chamada direta à RPC insere a mensagem com fidelidade histórica, mas limita last_message_at a 48h
    const rpcRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId,
      p_external_id: 'msg-future-date',
      p_sender_type: 'customer',
      p_content: 'Mensagem com relógio adiantado',
      p_created_at: thirtyDaysFuture
    })

    assert.strictEqual(rpcRes.data[0].was_inserted, true)
    const msgId = rpcRes.data[0].message_id

    // Mensagem original preserva o timestamp informado (fidelidade de auditoria)
    const msg = inMemoryDb.messages.get(msgId)
    assert.strictEqual(msg.created_at, thirtyDaysFuture)

    // Conversa é protegida: last_message_at não avança 30 dias, ficando dentro do teto de 48h
    const conv = inMemoryDb.conversations.get(convId)
    const maxAllowedFuture = Date.now() + 48 * 60 * 60 * 1000 + 2000
    assert.ok(new Date(conv.last_message_at).getTime() <= maxAllowedFuture, 'last_message_at não pode avançar além de 48h no futuro')
    assert.strictEqual(conv.unread_count, 1)
  })

  it('12. Mensagens antigas legítimas não retrocedem last_message_at', async () => {
    const adminClient = createAdminClient()
    const nowMs = Date.now()
    const timeNewer = new Date(nowMs - 5 * 60 * 1000).toISOString() // 5 minutos atrás
    const timeOlder = new Date(nowMs - 30 * 60 * 1000).toISOString() // 30 minutos atrás (atrasada)

    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-order-new',
      externalConvId: 'conv-order-check',
      externalMsgId: 'msg-new',
      createdAt: timeNewer
    }), { adminClient })
    const convId = res1.conversation_id!

    // Mensagem atrasada chega depois
    await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-order-old',
      externalConvId: 'conv-order-check',
      externalMsgId: 'msg-old',
      createdAt: timeOlder
    }), { adminClient })

    const conv = inMemoryDb.conversations.get(convId)
    assert.strictEqual(conv.last_message_at, timeNewer, 'last_message_at deve permanecer timeNewer')
    assert.strictEqual(conv.unread_count, 2)
  })

  it('13. Falha na RPC não deixa mensagem parcialmente inserida', async () => {
    const adminClient = createAdminClient()
    const badConvId = '00000000-0000-0000-0000-000000000000'

    const rpcRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: badConvId,
      p_external_id: 'msg-rollback-test',
      p_sender_type: 'customer',
      p_content: 'Falha',
      p_created_at: new Date().toISOString()
    })

    assert.ok(rpcRes.error)
    // Nenhuma mensagem gravada
    let found = false
    for (const msg of inMemoryDb.messages.values()) {
      if (msg.external_id === 'msg-rollback-test') found = true
    }
    assert.strictEqual(found, false)
  })

  it('14. Regressão dos fluxos de atendimento e comerciais (reabertura de conversa fechada)', async () => {
    const adminClient = createAdminClient()

    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-reopen-1',
      externalConvId: 'conv-reopen',
      externalMsgId: 'msg-reopen-1'
    }), { adminClient })
    const convId = res1.conversation_id!

    // Atendente fecha a conversa
    inMemoryDb.conversations.set(convId, {
      ...inMemoryDb.conversations.get(convId),
      status: 'closed'
    })
    assert.strictEqual(inMemoryDb.conversations.get(convId).status, 'closed')

    // Cliente envia nova mensagem na mesma conversa
    await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-reopen-2',
      externalConvId: 'conv-reopen',
      externalMsgId: 'msg-reopen-2',
      content: 'Preciso de mais informações'
    }), { adminClient })

    assert.strictEqual(inMemoryDb.conversations.get(convId).status, 'open', 'Conversa fechada deve ser reaberta')
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 2)
  })

  it('15. Regressão do isolamento multi-tenant (tentativa cross-tenant barrada)', async () => {
    const adminClient = createAdminClient()

    // Cria conversa na Empresa A
    const resA = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-tenant-A',
      externalConvId: 'conv-tenant-A',
      externalMsgId: 'msg-tenant-A'
    }), { adminClient })
    const convIdA = resA.conversation_id!

    // Injeção com tenant cruzado (Empresa B tentando inserir na conversa da Empresa A)
    const crossRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_B,
      p_conversation_id: convIdA,
      p_external_id: 'msg-cross-attack',
      p_sender_type: 'customer',
      p_content: 'Injeção cross-tenant',
      p_created_at: new Date().toISOString()
    })

    assert.ok(crossRes.error)
    assert.match(crossRes.error.message, /não encontrada ou não pertence à empresa/)
  })
})
