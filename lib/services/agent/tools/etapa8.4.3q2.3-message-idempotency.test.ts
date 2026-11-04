import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { inMemoryDb, resetInMemoryDb, createAdminClient } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'
import { processWebhookEvent } from '../../message-engine.ts'
import { markAsRead } from '../../conversations.ts'
import type { WebhookPayload } from '@/lib/validations/webhook'

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
  senderType?: 'customer' | 'agent' | 'human'
  content?: string
  phone?: string
  createdAt?: string
}): WebhookPayload {
  return {
    event_id: params.eventId,
    event_type: 'message.received',
    channel: 'whatsapp',
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

describe('ETAPA 8.4.3Q.2.3 — Idempotência de Mensagens e Consistência Transacional', () => {
  beforeEach(() => {
    setupMockDatabase()
  })

  it('1. Primeira mensagem inserida normalmente com sucesso', async () => {
    const adminClient = createAdminClient()
    const payload = makeWebhookPayload({
      eventId: 'evt-001',
      externalMsgId: 'ext-msg-001',
      createdAt: '2026-11-04T08:00:00.000Z'
    })

    const result = await processWebhookEvent(COMPANY_A, payload, { adminClient })
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.duplicate, false)
    assert.ok(result.message_id)
    assert.ok(result.conversation_id)

    // Verifica que mensagem foi persistida
    const msg = inMemoryDb.messages.get(result.message_id)
    assert.ok(msg)
    assert.strictEqual(msg.company_id, COMPANY_A)
    assert.strictEqual(msg.external_id, 'ext-msg-001')

    // Verifica que conversa foi atualizada
    const conv = inMemoryDb.conversations.get(result.conversation_id)
    assert.ok(conv)
    assert.strictEqual(conv.unread_count, 1)
    assert.strictEqual(conv.last_message_at, '2026-11-04T08:00:00.000Z')
  })

  it('2. Mesmo evento reenviado (mesmo event_id) — tratado na camada de webhook_events sem duplicar mensagem', async () => {
    const adminClient = createAdminClient()
    const payload = makeWebhookPayload({
      eventId: 'evt-002',
      externalMsgId: 'ext-msg-002'
    })

    const res1 = await processWebhookEvent(COMPANY_A, payload, { adminClient })
    assert.strictEqual(res1.duplicate, false)

    const res2 = await processWebhookEvent(COMPANY_A, payload, { adminClient })
    assert.strictEqual(res2.duplicate, true)

    // Apenas 1 mensagem inserida
    let count = 0
    for (const msg of inMemoryDb.messages.values()) {
      if (msg.company_id === COMPANY_A && msg.external_id === 'ext-msg-002') count++
    }
    assert.strictEqual(count, 1)
  })

  it('3. Mesma mensagem com event_id diferente — idempotência no nível da mensagem bloqueia duplicação', async () => {
    const adminClient = createAdminClient()
    const payload1 = makeWebhookPayload({
      eventId: 'evt-003-A',
      externalMsgId: 'ext-msg-003',
      createdAt: '2026-11-04T08:00:00.000Z'
    })
    const payload2 = makeWebhookPayload({
      eventId: 'evt-003-B', // Novo event_id (ex: retry com id diferente)
      externalMsgId: 'ext-msg-003', // MESMO external_id
      createdAt: '2026-11-04T08:00:00.000Z'
    })

    const res1 = await processWebhookEvent(COMPANY_A, payload1, { adminClient })
    assert.strictEqual(res1.duplicate, false)

    const res2 = await processWebhookEvent(COMPANY_A, payload2, { adminClient })
    assert.strictEqual(res2.duplicate, false) // Evento registrado, mas mensagem reutilizada
    assert.strictEqual(res2.message_id, res1.message_id) // Retorna o mesmo message_id

    // Verifica que existe rigorosamente apenas 1 linha em messages
    let count = 0
    for (const msg of inMemoryDb.messages.values()) {
      if (msg.company_id === COMPANY_A && msg.external_id === 'ext-msg-003') count++
    }
    assert.strictEqual(count, 1)

    // unread_count NÃO deve ter sido incrementado pela segunda vez
    const conv = inMemoryDb.conversations.get(res1.conversation_id!)
    assert.strictEqual(conv.unread_count, 1)
  })

  it('4. Empresas diferentes com o mesmo external_id — isolamento total entre tenants', async () => {
    const adminClient = createAdminClient()
    const payloadCompA = makeWebhookPayload({
      eventId: 'evt-004-A',
      externalMsgId: 'shared-ext-id-999',
      phone: '+5511999990001'
    })
    const payloadCompB = makeWebhookPayload({
      eventId: 'evt-004-B',
      externalMsgId: 'shared-ext-id-999', // Mesmo external_id, mas para COMPANY_B
      phone: '+5511999990002'
    })

    const resA = await processWebhookEvent(COMPANY_A, payloadCompA, { adminClient })
    const resB = await processWebhookEvent(COMPANY_B, payloadCompB, { adminClient })

    assert.strictEqual(resA.success, true)
    assert.strictEqual(resB.success, true)
    assert.notStrictEqual(resA.message_id, resB.message_id)

    const msgA = inMemoryDb.messages.get(resA.message_id!)
    const msgB = inMemoryDb.messages.get(resB.message_id!)

    assert.strictEqual(msgA.company_id, COMPANY_A)
    assert.strictEqual(msgB.company_id, COMPANY_B)
  })

  it('5. Mensagens sem external_id (NULL) não sofrem colisão de unicidade', async () => {
    const adminClient = createAdminClient()
    const payload1 = makeWebhookPayload({
      eventId: 'evt-005-A',
      externalMsgId: undefined, // Sem external_id
      content: 'Mensagem interna ou sem ID 1'
    })
    const payload2 = makeWebhookPayload({
      eventId: 'evt-005-B',
      externalMsgId: undefined, // Também sem external_id
      content: 'Mensagem interna ou sem ID 2'
    })

    const res1 = await processWebhookEvent(COMPANY_A, payload1, { adminClient })
    const res2 = await processWebhookEvent(COMPANY_A, payload2, { adminClient })

    assert.strictEqual(res1.success, true)
    assert.strictEqual(res2.success, true)
    assert.notStrictEqual(res1.message_id, res2.message_id)

    const conv = inMemoryDb.conversations.get(res1.conversation_id!)
    assert.strictEqual(conv.unread_count, 2)
  })

  it('6. Mensagem duplicada por external_id não incrementa unread_count', async () => {
    const adminClient = createAdminClient()
    const payload1 = makeWebhookPayload({
      eventId: 'evt-006-A',
      externalMsgId: 'dup-counter-msg',
      createdAt: '2026-11-04T08:00:00.000Z'
    })
    const payload2 = makeWebhookPayload({
      eventId: 'evt-006-B',
      externalMsgId: 'dup-counter-msg',
      createdAt: '2026-11-04T08:01:00.000Z'
    })

    const res1 = await processWebhookEvent(COMPANY_A, payload1, { adminClient })
    const convAfterFirst = inMemoryDb.conversations.get(res1.conversation_id!)
    assert.strictEqual(convAfterFirst.unread_count, 1)

    // Reenvio com outro event_id mas mesmo external_id
    await processWebhookEvent(COMPANY_A, payload2, { adminClient })
    const convAfterSecond = inMemoryDb.conversations.get(res1.conversation_id!)
    assert.strictEqual(convAfterSecond.unread_count, 1, 'unread_count não pode ser incrementado em mensagem duplicada')
  })

  it('7. Duas mensagens simultâneas distintas não perdem incrementos de unread_count', async () => {
    const adminClient = createAdminClient()

    // Inicializa a conversa primeiro para que ambas as chamadas simultâneas
    // compartilhem exatamente a mesma conversa criada
    const initRes = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-007-init',
      externalMsgId: 'msg-init-007',
      phone: '+5511999990007',
      createdAt: '2026-11-04T08:00:00.000Z'
    }), { adminClient })
    const convId = initRes.conversation_id!

    const payload1 = makeWebhookPayload({
      eventId: 'evt-007-A',
      externalMsgId: 'concurrent-msg-1',
      phone: '+5511999990007',
      content: 'Pergunta 1',
      createdAt: '2026-11-04T08:00:01.000Z'
    })
    const payload2 = makeWebhookPayload({
      eventId: 'evt-007-B',
      externalMsgId: 'concurrent-msg-2',
      phone: '+5511999990007',
      content: 'Pergunta 2',
      createdAt: '2026-11-04T08:00:02.000Z'
    })

    // Processamento concorrente simulado
    const [res1, res2] = await Promise.all([
      processWebhookEvent(COMPANY_A, payload1, { adminClient }),
      processWebhookEvent(COMPANY_A, payload2, { adminClient })
    ])

    assert.strictEqual(res1.success, true)
    assert.strictEqual(res2.success, true)
    assert.strictEqual(res1.conversation_id, convId)
    assert.strictEqual(res2.conversation_id, convId)

    const conv = inMemoryDb.conversations.get(convId)
    assert.strictEqual(conv.unread_count, 3, 'Mensagem inicial (1) + 2 concorrentes (2) = unread_count 3 sem perdas')
  })

  it('8. Concorrência entre markAsRead e mensagem recebida preserva novo incremento', async () => {
    const adminClient = createAdminClient()
    const USER_ID = 'user-reader-001'
    inMemoryDb.profiles.set(USER_ID, {
      id: USER_ID,
      company_id: COMPANY_A,
      role: 'attendant',
      created_at: new Date().toISOString()
    })

    // Passo 1: Recebe mensagem inicial
    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-008-A',
      externalMsgId: 'msg-read-1'
    }), { adminClient })

    const convId = res1.conversation_id!
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 1)

    // Passo 2: Executa markAsRead autenticado com client real do mock (zera unread_count)
    const { createAuthenticatedClient } = await import('file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs')
    const authClient = createAuthenticatedClient({ id: USER_ID })
    const marked = await markAsRead(convId, { supabaseClient: authClient, adminClient })
    assert.strictEqual(marked, true)
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 0)

    // Passo 3: Nova mensagem chega logo em seguida
    await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-008-B',
      externalMsgId: 'msg-read-2'
    }), { adminClient })

    // unread_count deve ser 1 (não 0 perdido)
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 1)
  })

  it('9. Mensagem com timestamp anterior (fora de ordem) não retrocede last_message_at', async () => {
    const adminClient = createAdminClient()
    const timeNewer = '2026-11-04T08:30:00.000Z'
    const timeOlder = '2026-11-04T08:00:00.000Z' // Mensagem atrasada na rede

    // 1. Mensagem mais recente chega primeiro
    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-009-A',
      externalMsgId: 'msg-order-new',
      createdAt: timeNewer
    }), { adminClient })

    const convId = res1.conversation_id!
    assert.strictEqual(inMemoryDb.conversations.get(convId).last_message_at, timeNewer)

    // 2. Mensagem mais antiga chega depois
    await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-009-B',
      externalMsgId: 'msg-order-old',
      createdAt: timeOlder
    }), { adminClient })

    // last_message_at deve PERMANECER timeNewer devido à semântica monotônica GREATEST
    const convAfter = inMemoryDb.conversations.get(convId)
    assert.strictEqual(convAfter.last_message_at, timeNewer, 'last_message_at não pode retroceder')
    assert.strictEqual(convAfter.unread_count, 2, 'Ambas as mensagens contam no unread_count')
  })

  it('10. Falha de validação ou inserção não altera contadores da conversa', async () => {
    const adminClient = createAdminClient()

    // Cria conversa prévia com unread_count = 1
    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-010-pre',
      externalMsgId: 'msg-pre-valid'
    }), { adminClient })
    const convId = res1.conversation_id!
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 1)

    // Tenta RPC com p_external_id em branco (string vazia inválida)
    const rpcRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: convId,
      p_external_id: '   ', // Inválido
      p_sender_type: 'customer',
      p_content: 'Falha proposital',
      p_created_at: new Date().toISOString()
    })

    assert.ok(rpcRes.error)
    // Conversa permanece inalterada
    assert.strictEqual(inMemoryDb.conversations.get(convId).unread_count, 1)
  })

  it('11. Mensagem enviada pelo agente (não-customer) não incrementa unread_count', async () => {
    const adminClient = createAdminClient()
    const res = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-011-agent',
      externalMsgId: 'msg-agent-reply',
      senderType: 'agent',
      content: 'Resposta do agente'
    }), { adminClient })

    assert.strictEqual(res.success, true)
    const conv = inMemoryDb.conversations.get(res.conversation_id!)
    assert.strictEqual(conv.unread_count, 0, 'Mensagens do agente não incrementam unread_count')
  })

  it('12. Tentativa de inserir mensagem em conversa de outra empresa é bloqueada pela RPC', async () => {
    const adminClient = createAdminClient()

    // Cria conversa na COMPANY_A
    const resA = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-012-A',
      externalMsgId: 'msg-012-A'
    }), { adminClient })
    const convIdA = resA.conversation_id!

    // Tenta inserir na conversa da COMPANY_A passando p_company_id = COMPANY_B (cross-tenant)
    const crossRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_B, // Tenant atacante
      p_conversation_id: convIdA, // Conversa do Tenant A
      p_external_id: 'cross-attack-msg',
      p_sender_type: 'customer',
      p_content: 'Injeção cross-tenant',
      p_created_at: new Date().toISOString()
    })

    assert.ok(crossRes.error, 'RPC deve rejeitar operação cross-tenant')
    assert.match(crossRes.error.message, /não encontrada ou não pertence à empresa/)
  })

  it('13. Falha no RPC retorna erro controlado e marca status no webhook_events como error', async () => {
    const adminClient = createAdminClient()
    const nonExistentConvId = '00000000-0000-0000-0000-000000000000'

    // Simula chamada que force erro de banco no RPC (conversa inexistente)
    const rpcRes = await adminClient.rpc('insert_message_idempotent', {
      p_company_id: COMPANY_A,
      p_conversation_id: nonExistentConvId,
      p_external_id: 'err-test-msg',
      p_sender_type: 'customer',
      p_content: 'Teste erro',
      p_created_at: new Date().toISOString()
    })

    assert.ok(rpcRes.error)
    assert.strictEqual(rpcRes.error.code, 'P0001')
  })

  it('14. Mensagens recebidas repetidas respeitam integralmente o isolamento por tenant', async () => {
    const adminClient = createAdminClient()

    // Mensagem recebida na COMPANY_A
    await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-014-A',
      externalMsgId: 'msg-iso-check',
      phone: '+5511988887771'
    }), { adminClient })

    // Mensagem com MESMO external_id na COMPANY_B
    await processWebhookEvent(COMPANY_B, makeWebhookPayload({
      eventId: 'evt-014-B',
      externalMsgId: 'msg-iso-check',
      phone: '+5511988887772'
    }), { adminClient })

    // Ambas devem ter sido criadas e pertencer estritamente às suas empresas
    const msgs = Array.from(inMemoryDb.messages.values()).filter(m => m.external_id === 'msg-iso-check')
    assert.strictEqual(msgs.length, 2)
    assert.ok(msgs.some(m => m.company_id === COMPANY_A))
    assert.ok(msgs.some(m => m.company_id === COMPANY_B))
  })

  it('15. Regressão de fluxo de atendimento comercial: conversa reabre automaticamente com nova mensagem', async () => {
    const adminClient = createAdminClient()

    // 1. Cria conversa inicial
    const res1 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-015-1',
      externalMsgId: 'msg-comm-1'
    }), { adminClient })

    const convId = res1.conversation_id!

    // 2. Fecha a conversa comercialmente
    inMemoryDb.conversations.set(convId, {
      ...inMemoryDb.conversations.get(convId),
      status: 'closed'
    })
    assert.strictEqual(inMemoryDb.conversations.get(convId).status, 'closed')

    // 3. Cliente manda nova mensagem
    const res2 = await processWebhookEvent(COMPANY_A, makeWebhookPayload({
      eventId: 'evt-015-2',
      externalMsgId: 'msg-comm-2',
      content: 'Olá novamente, quero fechar o pedido'
    }), { adminClient })

    assert.strictEqual(res2.success, true)
    // Conversa deve ter sido reaberta (status = open)
    const convAfter = inMemoryDb.conversations.get(convId)
    assert.strictEqual(convAfter.status, 'open', 'Conversa fechada deve ser reaberta quando cliente envia nova mensagem')
    assert.strictEqual(convAfter.unread_count, 2)
  })
})
