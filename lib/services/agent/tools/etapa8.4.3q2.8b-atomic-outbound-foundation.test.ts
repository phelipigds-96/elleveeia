import test from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import {
  prepareOutboundMessage
} from '@/lib/services/outbound-internal'

test.describe('ETAPA 8.4.3Q.2.8B — Fundação do Pipeline Único de Mensagens de Saída', () => {
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSP_ID = '33333333-3333-3333-3333-333333333333'

  const CONV_A_ID = 'aaaaaaaa-1111-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_B_ID = 'bbbbbbbb-2222-bbbb-bbbb-bbbbbbbbbbbb'
  const CONV_SEM_CUST_ID = 'cccccccc-3333-cccc-cccc-cccccccccccc'

  const CUST_A_ID = '90000000-0000-0000-0000-000000000001'
  const CUST_B_ID = '90000000-0000-0000-0000-000000000002'

  const USER_A_ID = 'eeeeeeee-1111-eeee-eeee-eeeeeeeeeeee'
  const USER_B_ID = 'ffffffff-2222-ffff-ffff-ffffffffffff'

  const AGENT_A_ID = '88888888-1111-8888-8888-888888888888'

  function seedDb() {
    resetInMemoryDb()

    // 1. Empresas
    inMemoryDb.companies.set(TENANT_A_ID, {
      id: TENANT_A_ID,
      name: 'Empresa Alpha (Ativa)',
      status: 'active',
      plan_tier: 'pro'
    })
    inMemoryDb.companies.set(TENANT_B_ID, {
      id: TENANT_B_ID,
      name: 'Empresa Beta (Ativa)',
      status: 'active',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_SUSP_ID, {
      id: TENANT_SUSP_ID,
      name: 'Empresa Suspensa',
      status: 'suspended',
      plan_tier: 'free'
    })

    // 2. Clientes
    inMemoryDb.customers.set(CUST_A_ID, {
      id: CUST_A_ID,
      company_id: TENANT_A_ID,
      name: 'Cliente Alpha',
      phone: '5511999991111'
    })
    inMemoryDb.customers.set(CUST_B_ID, {
      id: CUST_B_ID,
      company_id: TENANT_B_ID,
      name: 'Cliente Beta',
      phone: '5511999992222'
    })

    // 3. Conversas
    inMemoryDb.conversations.set(CONV_A_ID, {
      id: CONV_A_ID,
      company_id: TENANT_A_ID,
      customer_id: CUST_A_ID,
      channel: 'whatsapp',
      status: 'open',
      unread_count: 0
    })
    inMemoryDb.conversations.set(CONV_B_ID, {
      id: CONV_B_ID,
      company_id: TENANT_B_ID,
      customer_id: CUST_B_ID,
      channel: 'whatsapp',
      status: 'open',
      unread_count: 0
    })
    inMemoryDb.conversations.set(CONV_SEM_CUST_ID, {
      id: CONV_SEM_CUST_ID,
      company_id: TENANT_A_ID,
      customer_id: null,
      channel: 'whatsapp',
      status: 'open',
      unread_count: 0
    })

    // 4. Profiles
    inMemoryDb.profiles.set(USER_A_ID, {
      id: USER_A_ID,
      company_id: TENANT_A_ID,
      full_name: 'Atendente Humano A',
      email: 'atendente@alpha.com',
      role: 'agent'
    })
    inMemoryDb.profiles.set(USER_B_ID, {
      id: USER_B_ID,
      company_id: TENANT_B_ID,
      full_name: 'Atendente Humano B',
      email: 'atendente@beta.com',
      role: 'agent'
    })

    // 5. Agents
    inMemoryDb.agents.set(AGENT_A_ID, {
      id: AGENT_A_ID,
      company_id: TENANT_A_ID,
      name: 'Agente Alpha IA',
      is_active: true
    })
  }

  // ---------------------------------------------------------------------------
  // 1. Criação de mensagem de IA
  // ---------------------------------------------------------------------------
  test('1. Criação de mensagem de IA com sender_type=agent', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Resposta gerada pelo agente IA.',
      idempotencyKey: 'ai-key-001',
      metadata: { agent_id: AGENT_A_ID }
    }, { adminClient: supabase })

    assert.equal(res.success, true)
    if (res.success) {
      assert.equal(res.duplicate, false)
      assert.ok(res.messageId, 'messageId deve ser gerado')
      assert.ok(res.outboxId, 'outboxId deve ser gerado')
      assert.equal(res.status, 'pending')

      const msg = inMemoryDb.messages.get(res.messageId)
      assert.ok(msg)
      assert.equal(msg.sender_type, 'agent')
      assert.equal(msg.content, 'Resposta gerada pelo agente IA.')
      assert.equal(msg.metadata.delivery_status, 'pending')
    }
  })

  // ---------------------------------------------------------------------------
  // 2. Criação de mensagem humana
  // ---------------------------------------------------------------------------
  test('2. Criação de mensagem humana com sender_type=human e sender_id', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'human',
      senderId: USER_A_ID,
      content: 'Mensagem de atendente humano.',
      idempotencyKey: 'human-key-001'
    }, { adminClient: supabase })

    assert.equal(res.success, true)
    if (res.success) {
      assert.equal(res.duplicate, false)
      const msg = inMemoryDb.messages.get(res.messageId)
      assert.ok(msg)
      assert.equal(msg.sender_type, 'human')
      assert.equal(msg.sender_id, USER_A_ID)
    }
  })

  // ---------------------------------------------------------------------------
  // 3. Criação correspondente de outbox
  // ---------------------------------------------------------------------------
  test('3. Criação correspondente de outbox vinculada com payload e recipient', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Verificação de outbox.',
      idempotencyKey: 'outbox-key-001'
    }, { adminClient: supabase })

    assert.equal(res.success, true)
    if (res.success) {
      const outbox = inMemoryDb.message_outbox.get(res.outboxId)
      assert.ok(outbox)
      assert.equal(outbox.message_id, res.messageId)
      assert.equal(outbox.status, 'pending')
      assert.equal(outbox.attempts, 0)
      assert.equal(outbox.recipient, '5511999991111')
      assert.equal(outbox.payload.message.content, 'Verificação de outbox.')
    }
  })

  // ---------------------------------------------------------------------------
  // 4. Duplicidade de chave idempotente
  // ---------------------------------------------------------------------------
  test('4. Duplicidade de chave idempotente retorna duplicate=true sem duplicar registros', async () => {
    seedDb()
    const supabase = createAdminClient()

    const first = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Primeira chamada.',
      idempotencyKey: 'dup-key-001'
    }, { adminClient: supabase })

    assert.equal(first.success, true)
    assert.equal(first.duplicate, false)

    const initialMsgCount = inMemoryDb.messages.size
    const initialOutCount = inMemoryDb.message_outbox.size

    const second = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Segunda chamada com mesma chave.',
      idempotencyKey: 'dup-key-001'
    }, { adminClient: supabase })

    assert.equal(second.success, true)
    assert.equal(second.duplicate, true)
    if (second.success && first.success) {
      assert.equal(second.messageId, first.messageId)
      assert.equal(second.outboxId, first.outboxId)
    }

    assert.equal(inMemoryDb.messages.size, initialMsgCount, 'Nenhuma mensagem extra deve ser criada')
    assert.equal(inMemoryDb.message_outbox.size, initialOutCount, 'Nenhuma outbox extra deve ser criada')
  })

  // ---------------------------------------------------------------------------
  // 5. Conversa pertencente a outra empresa
  // ---------------------------------------------------------------------------
  test('5. Rejeição de conversa pertencente a outro tenant (CROSS_TENANT_FORBIDDEN)', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_B_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Invasão cross-tenant.',
      idempotencyKey: 'cross-key-001'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'CROSS_TENANT_FORBIDDEN')
  })

  // ---------------------------------------------------------------------------
  // 6. Empresa suspensa
  // ---------------------------------------------------------------------------
  test('6. Bloqueio para empresa suspensa', async () => {
    seedDb()
    const supabase = createAdminClient()

    const CONV_SUSP_ID = '33333333-aaaa-3333-3333-333333333333'
    inMemoryDb.conversations.set(CONV_SUSP_ID, {
      id: CONV_SUSP_ID,
      company_id: TENANT_SUSP_ID,
      channel: 'whatsapp',
      status: 'open'
    })

    const res = await prepareOutboundMessage({
      companyId: TENANT_SUSP_ID,
      conversationId: CONV_SUSP_ID,
      senderType: 'agent',
      content: 'Envio empresa suspensa.',
      idempotencyKey: 'susp-key-001'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.ok(res.code.includes('TENANT_SUSPENDED') || res.code.includes('TENANT_NOT_ACTIVE'))
  })

  // ---------------------------------------------------------------------------
  // 7. Falha na criação da outbox com rollback da mensagem
  // ---------------------------------------------------------------------------
  test('7. Falha por falta de destinatário com rollback da mensagem', async () => {
    seedDb()
    const supabase = createAdminClient()

    const initialMsgCount = inMemoryDb.messages.size
    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_SEM_CUST_ID,
      senderType: 'agent',
      content: 'Sem destinatário.',
      idempotencyKey: 'missing-rec-key'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'RECIPIENT_MISSING')
    assert.equal(inMemoryDb.messages.size, initialMsgCount, 'Mensagem não pode ser persistida em caso de falha')
  })

  // ---------------------------------------------------------------------------
  // 8. Falha na criação da mensagem com rollback da operação
  // ---------------------------------------------------------------------------
  test('8. Falha de validação de conteúdo rejeita antes da persistência', async () => {
    seedDb()
    const supabase = createAdminClient()

    const initialMsgCount = inMemoryDb.messages.size
    const initialOutCount = inMemoryDb.message_outbox.size

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: '   ',
      idempotencyKey: 'blank-key'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'INVALID_CONTENT')
    assert.equal(inMemoryDb.messages.size, initialMsgCount)
    assert.equal(inMemoryDb.message_outbox.size, initialOutCount)
  })

  // ---------------------------------------------------------------------------
  // 9. Isolamento entre empresas
  // ---------------------------------------------------------------------------
  test('9. Isolamento multi-tenant: mesma chave de idempotência em empresas diferentes', async () => {
    seedDb()
    const supabase = createAdminClient()

    const resA = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Mensagem Empresa A.',
      idempotencyKey: 'shared-key-100'
    }, { adminClient: supabase })

    assert.equal(resA.success, true)
    assert.equal(resA.duplicate, false)

    const resB = await prepareOutboundMessage({
      companyId: TENANT_B_ID,
      conversationId: CONV_B_ID,
      senderType: 'agent',
      content: 'Mensagem Empresa B.',
      idempotencyKey: 'shared-key-100'
    }, { adminClient: supabase })

    assert.equal(resB.success, true)
    assert.equal(resB.duplicate, false)
    if (resA.success && resB.success) {
      assert.notEqual(resA.messageId, resB.messageId)
      assert.notEqual(resA.outboxId, resB.outboxId)
    }
  })

  // ---------------------------------------------------------------------------
  // 10. Preservação dos metadados e sender_type
  // ---------------------------------------------------------------------------
  test('10. Preservação de metadados complexos e sender_type', async () => {
    seedDb()
    const supabase = createAdminClient()

    const complexMeta = {
      working_memory: { cart: ['item_1', 'item_2'] },
      priority: 'high',
      custom_tags: ['lead_qualificado']
    }

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'human',
      senderId: USER_A_ID,
      content: 'Mensagem com metadados ricos.',
      idempotencyKey: 'meta-key-001',
      metadata: complexMeta
    }, { adminClient: supabase })

    assert.equal(res.success, true)
    if (res.success) {
      const msg = inMemoryDb.messages.get(res.messageId)
      assert.ok(msg)
      assert.equal(msg.metadata.priority, 'high')
      assert.deepEqual(msg.metadata.working_memory, { cart: ['item_1', 'item_2'] })
      assert.equal(msg.metadata.delivery_status, 'pending')

      const outbox = inMemoryDb.message_outbox.get(res.outboxId)
      assert.ok(outbox)
      assert.equal(outbox.payload.metadata.sender_type, 'human')
      assert.equal(outbox.payload.metadata.message_id, res.messageId)
    }
  })

  // ---------------------------------------------------------------------------
  // 11. Validações de Identidade do Remetente (F-02)
  // ---------------------------------------------------------------------------
  test('11. F-02: Human com sender_id nulo é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'human',
      senderId: null,
      content: 'Mensagem sem sender_id.',
      idempotencyKey: 'human-null-sender'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'SENDER_ID_REQUIRED_FOR_HUMAN')
  })

  test('12. F-02: Human com sender_id pertencente a outra empresa é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'human',
      senderId: USER_B_ID, // pertence a TENANT_B_ID
      content: 'Mensagem operador cross-tenant.',
      idempotencyKey: 'human-cross-sender'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'SENDER_TENANT_MISMATCH')
  })

  test('13. F-02: Human com UUID inexistente é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'human',
      senderId: '00000000-0000-0000-0000-000000000000',
      content: 'Mensagem operador fantasma.',
      idempotencyKey: 'human-ghost-sender'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'SENDER_PROFILE_NOT_FOUND')
  })

  test('14. F-02: Agent com sender_id definido é rejeitado (sender_id deve ser null)', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      senderId: USER_A_ID,
      content: 'Agente com senderId indevido.',
      idempotencyKey: 'agent-with-sender'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'AGENT_SENDER_ID_MUST_BE_NULL')
  })

  test('15. F-02: System com sender_id definido é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'system',
      senderId: USER_A_ID,
      content: 'Sistema tentando mascarar operador.',
      idempotencyKey: 'system-with-sender'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'SYSTEM_SENDER_ID_MUST_BE_NULL')
  })

  test('16. F-02: System válido com sender_id nulo é aceito', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'system',
      content: 'Notificação do sistema.',
      idempotencyKey: 'system-valid-001'
    }, { adminClient: supabase })

    assert.equal(res.success, true)
    assert.equal(res.duplicate, false)
  })

  // ---------------------------------------------------------------------------
  // 17. Validações de Limites de Entrada (F-03)
  // ---------------------------------------------------------------------------
  test('17. F-03: Chave de idempotência acima de 128 caracteres é rejeitada', async () => {
    seedDb()
    const supabase = createAdminClient()

    const longKey = 'a'.repeat(129)
    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Teste chave longa.',
      idempotencyKey: longKey
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'IDEMPOTENCY_KEY_TOO_LONG')
  })

  test('18. F-03: Conteúdo acima de 65.536 caracteres é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const hugeContent = 'c'.repeat(65537)
    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: hugeContent,
      idempotencyKey: 'huge-content-key'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'CONTENT_TOO_LONG')
  })

  test('19. F-03: Payload acima de 262.144 bytes é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const hugePayload = { large_data: 'x'.repeat(262200) }
    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Teste payload gigante.',
      idempotencyKey: 'huge-payload-key',
      payload: hugePayload
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'PAYLOAD_TOO_LARGE')
  })

  test('20. F-03: Metadata acima de 65.536 bytes é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const hugeMetadata = { large_meta: 'y'.repeat(65600) }
    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Teste metadata gigante.',
      idempotencyKey: 'huge-meta-key',
      metadata: hugeMetadata
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'METADATA_TOO_LARGE')
  })

  test('21. F-03: Canal inválido ou não suportado é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Canal inexistente.',
      idempotencyKey: 'invalid-channel-key',
      channel: 'carrier_pigeon'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'INVALID_CHANNEL')
  })

  test('22. F-03: Destinatário com formato inválido para WhatsApp é rejeitado', async () => {
    seedDb()
    const supabase = createAdminClient()

    const res = await prepareOutboundMessage({
      companyId: TENANT_A_ID,
      conversationId: CONV_A_ID,
      senderType: 'agent',
      content: 'Telefone inválido.',
      idempotencyKey: 'invalid-recip-key',
      recipient: 'abc-not-a-phone'
    }, { adminClient: supabase })

    assert.equal(res.success, false)
    assert.equal(res.code, 'INVALID_RECIPIENT')
  })
})
