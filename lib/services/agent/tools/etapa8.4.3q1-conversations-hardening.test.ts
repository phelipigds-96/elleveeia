import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAuthenticatedClient,
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import {
  getCompanyId,
  getConversations,
  getConversation,
  getMessages,
  updateConversationStatus,
  markAsRead
} from '@/lib/services/conversations'

test.describe('ETAPA 8.4.3Q.1 — Hardening das Server Actions e Integridade das Conversas', () => {
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED_ID = '33333333-3333-3333-3333-333333333333'
  const TENANT_CANCELLED_ID = '44444444-4444-4444-4444-444444444444'
  const TENANT_PROVISIONING_ID = '55555555-5555-5555-5555-555555555555'

  const USER_A_ID = 'user-tenant-a-1'
  const USER_B_ID = 'user-tenant-b-1'
  const USER_NO_PROFILE_ID = 'user-no-profile'
  const USER_SUSPENDED_ID = 'user-tenant-suspended'
  const USER_CANCELLED_ID = 'user-tenant-cancelled'
  const USER_PROVISIONING_ID = 'user-tenant-provisioning'

  const CUST_A1_ID = 'aaaaaaaa-0001-0000-0000-000000000001'
  const CUST_A2_ID = 'aaaaaaaa-0002-0000-0000-000000000002'
  const CUST_B1_ID = 'bbbbbbbb-0001-0000-0000-000000000001'

  const CONV_A1_ID = 'cccccccc-0001-0000-0000-000000000001'
  const CONV_A2_ID = 'cccccccc-0002-0000-0000-000000000002'
  const CONV_B1_ID = 'cccccccc-0003-0000-0000-000000000001'

  const MSG_A1_ID = 'dddddddd-0001-0000-0000-000000000001'
  const MSG_B1_ID = 'dddddddd-0002-0000-0000-000000000001'

  function seedDb() {
    resetInMemoryDb()

    // 1. Tenants (Companies)
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
    inMemoryDb.companies.set(TENANT_SUSPENDED_ID, {
      id: TENANT_SUSPENDED_ID,
      name: 'Empresa Suspenso',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: 'Inadimplência financeira'
    })
    inMemoryDb.companies.set(TENANT_CANCELLED_ID, {
      id: TENANT_CANCELLED_ID,
      name: 'Empresa Cancelada',
      status: 'cancelled',
      plan_tier: 'standard'
    })
    inMemoryDb.companies.set(TENANT_PROVISIONING_ID, {
      id: TENANT_PROVISIONING_ID,
      name: 'Empresa Provisioning',
      status: 'provisioning',
      plan_tier: 'standard'
    })

    // 2. Perfis de Usuários
    inMemoryDb.profiles.set(USER_A_ID, {
      id: USER_A_ID,
      company_id: TENANT_A_ID,
      role: 'attendant'
    })
    inMemoryDb.profiles.set(USER_B_ID, {
      id: USER_B_ID,
      company_id: TENANT_B_ID,
      role: 'attendant'
    })
    inMemoryDb.profiles.set(USER_SUSPENDED_ID, {
      id: USER_SUSPENDED_ID,
      company_id: TENANT_SUSPENDED_ID,
      role: 'attendant'
    })
    inMemoryDb.profiles.set(USER_CANCELLED_ID, {
      id: USER_CANCELLED_ID,
      company_id: TENANT_CANCELLED_ID,
      role: 'attendant'
    })
    inMemoryDb.profiles.set(USER_PROVISIONING_ID, {
      id: USER_PROVISIONING_ID,
      company_id: TENANT_PROVISIONING_ID,
      role: 'attendant'
    })

    // 3. Clientes (Customers)
    inMemoryDb.customers.set(CUST_A1_ID, {
      id: CUST_A1_ID,
      company_id: TENANT_A_ID,
      name: 'João Silva',
      phone: '+5511999990001'
    })
    inMemoryDb.customers.set(CUST_A2_ID, {
      id: CUST_A2_ID,
      company_id: TENANT_A_ID,
      name: 'Maria Santos',
      phone: '+5511999990002'
    })
    inMemoryDb.customers.set(CUST_B1_ID, {
      id: CUST_B1_ID,
      company_id: TENANT_B_ID,
      name: 'Carlos Ferreira',
      phone: '+5521999990003'
    })

    // 4. Conversas
    inMemoryDb.conversations.set(CONV_A1_ID, {
      id: CONV_A1_ID,
      company_id: TENANT_A_ID,
      customer_id: CUST_A1_ID,
      status: 'open',
      channel: 'whatsapp',
      unread_count: 3,
      last_message_at: '2026-11-05T10:00:00Z',
      created_at: '2026-11-05T09:00:00Z',
      closed_at: null
    })
    inMemoryDb.conversations.set(CONV_A2_ID, {
      id: CONV_A2_ID,
      company_id: TENANT_A_ID,
      customer_id: CUST_A2_ID,
      status: 'human',
      channel: 'whatsapp',
      unread_count: 0,
      last_message_at: '2026-11-05T08:00:00Z',
      created_at: '2026-11-05T07:00:00Z',
      closed_at: null
    })
    inMemoryDb.conversations.set(CONV_B1_ID, {
      id: CONV_B1_ID,
      company_id: TENANT_B_ID,
      customer_id: CUST_B1_ID,
      status: 'open',
      channel: 'whatsapp',
      unread_count: 2,
      last_message_at: '2026-11-05T11:00:00Z',
      created_at: '2026-11-05T10:30:00Z',
      closed_at: null
    })

    // 5. Mensagens
    inMemoryDb.messages.set(MSG_A1_ID, {
      id: MSG_A1_ID,
      conversation_id: CONV_A1_ID,
      company_id: TENANT_A_ID,
      content: 'Olá João, como posso ajudar?',
      sender_type: 'agent',
      created_at: '2026-11-05T10:00:00Z'
    })
    inMemoryDb.messages.set(MSG_B1_ID, {
      id: MSG_B1_ID,
      conversation_id: CONV_B1_ID,
      company_id: TENANT_B_ID,
      content: 'Olá Carlos da Empresa Beta',
      sender_type: 'agent',
      created_at: '2026-11-05T11:00:00Z'
    })
  }

  // ============================================================================
  // CENÁRIO 1: Rejeição de getConversations sem autenticação
  // ============================================================================
  test('1. Rejeição de getConversations sem autenticação (retorna [])', async () => {
    seedDb()
    const anonClient = createAuthenticatedClient(null)
    const result = await getConversations('all', '', { supabaseClient: anonClient })
    assert.deepEqual(result, [], 'Deve retornar array vazio para chamador não autenticado')
  })

  // ============================================================================
  // CENÁRIO 2: Rejeição de getConversations com usuário sem profile / company_id
  // ============================================================================
  test('2. Rejeição de getConversations com usuário sem profile / sem company_id (retorna [])', async () => {
    seedDb()
    const userClient = createAuthenticatedClient({ id: USER_NO_PROFILE_ID })
    const result = await getConversations('all', '', { supabaseClient: userClient })
    assert.deepEqual(result, [], 'Deve retornar array vazio quando usuário não possui registro em profiles')
  })

  // ============================================================================
  // CENÁRIO 3: Rejeição de getConversations para empresa com status 'suspended'
  // ============================================================================
  test('3. Rejeição de getConversations para empresa com status "suspended" (retorna [])', async () => {
    seedDb()
    const client = createAuthenticatedClient({ id: USER_SUSPENDED_ID })
    const result = await getConversations('all', '', { supabaseClient: client })
    assert.deepEqual(result, [], 'Deve bloquear fail-closed empresa suspensa')
  })

  // ============================================================================
  // CENÁRIO 4: Rejeição de getConversations para empresa com status 'cancelled'
  // ============================================================================
  test('4. Rejeição de getConversations para empresa com status "cancelled" (retorna [])', async () => {
    seedDb()
    const client = createAuthenticatedClient({ id: USER_CANCELLED_ID })
    const result = await getConversations('all', '', { supabaseClient: client })
    assert.deepEqual(result, [], 'Deve bloquear fail-closed empresa cancelada')
  })

  // ============================================================================
  // CENÁRIO 5: Rejeição de getConversations para empresa com status 'provisioning'
  // ============================================================================
  test('5. Rejeição de getConversations para empresa com status "provisioning" (retorna [])', async () => {
    seedDb()
    const client = createAuthenticatedClient({ id: USER_PROVISIONING_ID })
    const result = await getConversations('all', '', { supabaseClient: client })
    assert.deepEqual(result, [], 'Deve bloquear fail-closed empresa em implantação')
  })

  // ============================================================================
  // CENÁRIO 6: Isolamento multi-tenant estrito em getConversations
  // ============================================================================
  test('6. Isolamento multi-tenant estrito em getConversations: Empresa A não vê Empresa B', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })
    const convsA = await getConversations('all', '', { supabaseClient: clientA })

    assert.equal(convsA.length, 2, 'Deve retornar as 2 conversas da Empresa A')
    const ids = convsA.map((c: any) => c.id)
    assert.ok(ids.includes(CONV_A1_ID))
    assert.ok(ids.includes(CONV_A2_ID))
    assert.ok(!ids.includes(CONV_B1_ID), 'JAMAIS deve conter conversas da Empresa B')
    for (const c of convsA) {
      assert.equal(c.company_id, TENANT_A_ID, 'Todas as conversas devem pertencer estritamente ao Tenant A')
    }

    const clientB = createAuthenticatedClient({ id: USER_B_ID })
    const convsB = await getConversations('all', '', { supabaseClient: clientB })
    assert.equal(convsB.length, 1, 'Deve retornar a conversa da Empresa B')
    assert.equal(convsB[0].id, CONV_B1_ID)
    assert.equal(convsB[0].company_id, TENANT_B_ID)
  })

  // ============================================================================
  // CENÁRIO 7: Validação sintática de UUID em getConversation
  // ============================================================================
  test('7. Validação sintática de UUID em getConversation (rejeita sem chamar banco)', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    const res1 = await getConversation('invalid-uuid-format', { supabaseClient: clientA })
    assert.equal(res1, null, 'Deve retornar null para UUID inválido')

    const res2 = await getConversation('', { supabaseClient: clientA })
    assert.equal(res2, null, 'Deve retornar null para string vazia')

    const res3 = await getConversation('1; DROP TABLE conversations;', { supabaseClient: clientA })
    assert.equal(res3, null, 'Deve retornar null para injeção SQL')

    const res4 = await getConversation('12345678-1234-1234-1234-12345678901z', { supabaseClient: clientA })
    assert.equal(res4, null, 'Deve retornar null para UUID com caractere não-hexadecimal')
  })

  // ============================================================================
  // CENÁRIO 8: Isolamento multi-tenant estrito em getConversation
  // ============================================================================
  test('8. Isolamento multi-tenant estrito em getConversation: Empresa A recebe null ao consultar conversa da Empresa B', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    // Tenta acessar conversa da Empresa B
    const crossTenant = await getConversation(CONV_B1_ID, { supabaseClient: clientA })
    assert.equal(crossTenant, null, 'Deve retornar null ao consultar conversa de outro tenant')

    // Consulta legítima da sua própria conversa
    const ownConv = await getConversation(CONV_A1_ID, { supabaseClient: clientA })
    assert.ok(ownConv, 'Deve encontrar a própria conversa')
    assert.equal(ownConv.id, CONV_A1_ID)
    assert.equal(ownConv.company_id, TENANT_A_ID)
    assert.equal(ownConv.customers?.name, 'João Silva', 'Deve trazer os dados do cliente vinculado')
  })

  // ============================================================================
  // CENÁRIO 9: Validação sintática de UUID em getMessages
  // ============================================================================
  test('9. Validação sintática de UUID em getMessages (rejeita sem chamar banco)', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    const res1 = await getMessages('not-a-uuid', { supabaseClient: clientA })
    assert.deepEqual(res1, [], 'Deve retornar array vazio para UUID inválido')

    const res2 = await getMessages('', { supabaseClient: clientA })
    assert.deepEqual(res2, [], 'Deve retornar array vazio para string vazia')
  })

  // ============================================================================
  // CENÁRIO 10: Isolamento multi-tenant estrito em getMessages
  // ============================================================================
  test('10. Isolamento multi-tenant estrito em getMessages: Empresa A não recebe mensagens da Empresa B', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    // Tenta obter mensagens de conversa da Empresa B
    const crossMessages = await getMessages(CONV_B1_ID, { supabaseClient: clientA })
    assert.deepEqual(crossMessages, [], 'JAMAIS deve retornar mensagens de conversa de outro tenant')

    // Consulta legítima da sua própria conversa
    const ownMessages = await getMessages(CONV_A1_ID, { supabaseClient: clientA })
    assert.equal(ownMessages.length, 1)
    assert.equal(ownMessages[0].id, MSG_A1_ID)
    assert.equal(ownMessages[0].company_id, TENANT_A_ID)
    assert.equal(ownMessages[0].content, 'Olá João, como posso ajudar?')
  })

  // ============================================================================
  // CENÁRIO 11: Whitelist estrita em updateConversationStatus
  // ============================================================================
  test('11. Whitelist estrita em updateConversationStatus: rejeitar status inválido', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    const invalidStatuses = ['archived', 'pending', 'deleted', 'OPEN', 'closed; DROP TABLE conversations;', '']
    for (const st of invalidStatuses) {
      const ok = await updateConversationStatus(CONV_A1_ID, st, { supabaseClient: clientA })
      assert.equal(ok, false, `Status "${st}" deve ser rejeitado imediatamente`)
    }

    // Garante que o status no banco permanece intacto
    const rawConv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(rawConv.status, 'open', 'Status não deve ter sido alterado após tentativas inválidas')
  })

  // ============================================================================
  // CENÁRIO 12: Sucesso em updateConversationStatus com persistência de closed_at
  // ============================================================================
  test('12. Sucesso em updateConversationStatus para status válidos com closed_at', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    // 1. Fechar conversa: define status = 'closed' e closed_at não-nulo
    const okClose = await updateConversationStatus(CONV_A1_ID, 'closed', { supabaseClient: clientA })
    assert.equal(okClose, true, 'Deve atualizar com sucesso para closed')
    let conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.status, 'closed')
    assert.ok(conv.closed_at, 'closed_at deve ser preenchido ao fechar conversa')

    // 2. Transferir para human: status = 'human' e limpa closed_at = null
    const okHuman = await updateConversationStatus(CONV_A1_ID, 'human', { supabaseClient: clientA })
    assert.equal(okHuman, true, 'Deve atualizar com sucesso para human')
    conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.status, 'human')
    assert.equal(conv.closed_at, null, 'closed_at deve ser anulado ao reabrir para atendimento humano')

    // 3. Reabrir para bot: status = 'open' e limpa closed_at = null
    const okOpen = await updateConversationStatus(CONV_A1_ID, 'open', { supabaseClient: clientA })
    assert.equal(okOpen, true, 'Deve atualizar com sucesso para open')
    conv = inMemoryDb.conversations.get(CONV_A1_ID)
    assert.equal(conv.status, 'open')
    assert.equal(conv.closed_at, null, 'closed_at deve ser nulo para status open')
  })

  // ============================================================================
  // CENÁRIO 13: Impedir updateConversationStatus em conversa de outro tenant
  // ============================================================================
  test('13. Impedir updateConversationStatus em conversa de outro tenant (retorna false sem mutação)', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    const ok = await updateConversationStatus(CONV_B1_ID, 'closed', { supabaseClient: clientA })
    assert.equal(ok, false, 'Deve falhar e retornar false para conversa de outro tenant')

    // Garante que o registro da Empresa B permaneceu inalterado
    const convB = inMemoryDb.conversations.get(CONV_B1_ID)
    assert.equal(convB.status, 'open', 'Conversa da Empresa B deve permanecer inalterada')
    assert.equal(convB.closed_at, null)
  })

  // ============================================================================
  // CENÁRIO 14: markAsRead com isolamento multi-tenant
  // ============================================================================
  test('14. markAsRead com isolamento multi-tenant: zerar unread_count apenas da empresa autenticada', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    // Operação legítima na conversa da Empresa A
    const okOwn = await markAsRead(CONV_A1_ID, { supabaseClient: clientA })
    assert.equal(okOwn, true, 'Deve marcar com sucesso conversa própria')
    assert.equal(inMemoryDb.conversations.get(CONV_A1_ID).unread_count, 0)

    // Tentativa maliciosa ou inadvertida na conversa da Empresa B
    const okOther = await markAsRead(CONV_B1_ID, { supabaseClient: clientA })
    assert.equal(okOther, false, 'Deve retornar false para conversa de outro tenant')
    assert.equal(inMemoryDb.conversations.get(CONV_B1_ID).unread_count, 2, 'Contador de mensagens da Empresa B não pode sofrer alteração')
  })

  // ============================================================================
  // CENÁRIO 15: markAsRead rejeitando UUID inválido
  // ============================================================================
  test('15. markAsRead rejeitando UUID inválido (retorna false sem chamar banco)', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    const ok1 = await markAsRead('bad-uuid', { supabaseClient: clientA })
    assert.equal(ok1, false)

    const ok2 = await markAsRead('', { supabaseClient: clientA })
    assert.equal(ok2, false)
  })

  // ============================================================================
  // CENÁRIO 16: Bounded queries em getConversations (limite padrão e teto máximo)
  // ============================================================================
  test('16. Bounded queries em getConversations: limite respeitado e com teto máximo (<= 50)', async () => {
    seedDb()
    // Criar 60 conversas para o Tenant A
    for (let i = 10; i < 70; i++) {
      const convId = `cccccccc-0000-0000-0000-0000000000${i}`
      inMemoryDb.conversations.set(convId, {
        id: convId,
        company_id: TENANT_A_ID,
        customer_id: CUST_A1_ID,
        status: 'open',
        channel: 'whatsapp',
        unread_count: 0,
        last_message_at: `2026-11-05T01:${i < 60 ? i : 59}:00Z`,
        created_at: '2026-11-05T00:00:00Z',
        closed_at: null
      })
    }

    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    // Teste A: Solicitar 100 itens deve ser limitado ao teto máximo de 50
    const listOverLimit = await getConversations('all', '', { supabaseClient: clientA, limit: 100 })
    assert.equal(listOverLimit.length, 50, 'Deve truncar no teto de 50 registros mesmo se limite solicitado for 100')

    // Teste B: Chamada padrão sem parâmetro limit
    const listDefault = await getConversations('all', '', { supabaseClient: clientA })
    assert.equal(listDefault.length, 50, 'Limite padrão deve ser 50')

    // Teste C: Limite explícito menor (ex: 5)
    const listFive = await getConversations('all', '', { supabaseClient: clientA, limit: 5 })
    assert.equal(listFive.length, 5, 'Deve respeitar limite explícito menor')

    // Teste D: Ordenação determinística decrescente por last_message_at
    for (let i = 0; i < listFive.length - 1; i++) {
      const current = new Date(listFive[i].last_message_at).getTime()
      const next = new Date(listFive[i + 1].last_message_at).getTime()
      assert.ok(current >= next, 'Conversas devem ser ordenadas de forma decrescente por last_message_at')
    }
  })

  // ============================================================================
  // CENÁRIO 17: Busca (search) em getConversations no escopo da empresa
  // ============================================================================
  test('17. Busca (search) em getConversations: filtragem correta por nome/telefone no escopo da empresa', async () => {
    seedDb()
    const clientA = createAuthenticatedClient({ id: USER_A_ID })

    // Busca por nome de cliente da Empresa A
    const byName = await getConversations('all', 'Maria', { supabaseClient: clientA })
    assert.equal(byName.length, 1)
    assert.equal(byName[0].id, CONV_A2_ID)
    assert.equal(byName[0].customers?.name, 'Maria Santos')

    // Busca por telefone de cliente da Empresa A
    const byPhone = await getConversations('all', '999990001', { supabaseClient: clientA })
    assert.equal(byPhone.length, 1)
    assert.equal(byPhone[0].id, CONV_A1_ID)
    assert.equal(byPhone[0].customers?.phone, '+5511999990001')

    // Busca por cliente da Empresa B a partir do cliente da Empresa A (deve retornar [])
    const crossSearch = await getConversations('all', 'Carlos', { supabaseClient: clientA })
    assert.deepEqual(crossSearch, [], 'Busca não deve retornar conversas com clientes de outro tenant')

    // Busca com caracteres especiais SQL sanitizados
    const specialChars = await getConversations('all', '%_', { supabaseClient: clientA })
    assert.deepEqual(specialChars, [], 'Busca com curingas não deve quebrar nem vazar dados')
  })

  // ============================================================================
  // CENÁRIO 18: Análise estática da migration 20261105_conversations_security_hardening.sql
  // ============================================================================
  test('18. Análise estática da migration 20261105: DO $$, CHECK status, tenant trigger e RLS WITH CHECK', () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261105_conversations_security_hardening.sql')
    assert.ok(fs.existsSync(migrationPath), 'Migration 20261105 deve existir fisicamente')

    const sql = fs.readFileSync(migrationPath, 'utf8')

    // 1. DO $$ pré-auditoria de status
    assert.match(sql, /DO\s+\$\$/i, 'Deve conter bloco procedural DO $$ para pré-auditoria')
    assert.match(sql, /SELECT\s+COUNT\(\*\)\s+INTO\s+v_invalid_count\s+FROM\s+public\.conversations\s+WHERE\s+status\s+NOT\s+IN/i, 'Deve checar registros existentes com status inválido')
    assert.match(sql, /RAISE\s+EXCEPTION/i, 'Deve abortar a migration caso haja status inválidos sem mutação silenciosa')

    // 2. Constraint CHECK chk_conversations_status
    assert.match(sql, /CONSTRAINT\s+chk_conversations_status/i, 'Deve adicionar constraint chk_conversations_status')
    assert.match(sql, /CHECK\s*\(\s*status\s+IN\s*\(\s*'open'\s*,\s*'closed'\s*,\s*'human'\s*\)\s*\)/i, 'Deve restringir status a open, closed e human')

    // 3. Trigger de imutabilidade de tenant (company_id)
    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.protect_conversation_and_message_tenant\(\)/i, 'Deve criar função de proteção de tenant')
    assert.match(sql, /NEW\.company_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.company_id/i, 'Deve bloquear alterações em company_id')
    assert.match(sql, /CREATE\s+TRIGGER\s+trg_protect_conversation_tenant/i, 'Deve criar trigger na tabela conversations')
    assert.match(sql, /CREATE\s+TRIGGER\s+trg_protect_message_tenant/i, 'Deve criar trigger na tabela messages')

    // 4. Policies RLS com USING e WITH CHECK explícitos
    assert.match(sql, /CREATE\s+POLICY\s+"Conversations:\s+update\s+for\s+company\s+users"/i, 'Deve criar policy de UPDATE em conversations')
    assert.match(sql, /CREATE\s+POLICY\s+"Messages:\s+update\s+for\s+company\s+users"/i, 'Deve criar policy de UPDATE em messages')
    assert.match(sql, /USING\s*\(\s*company_id\s*=\s*public\.get_auth_company_id\(\)\s*\)/i, 'Deve conter USING com get_auth_company_id')
    assert.match(sql, /WITH\s+CHECK\s*\(\s*company_id\s*=\s*public\.get_auth_company_id\(\)\s*\)/i, 'Deve conter WITH CHECK explícito')
  })

  // ============================================================================
  // CENÁRIO COMPLEMENTAR: getCompanyId com tenant lifecycle e autenticação
  // ============================================================================
  test('Complementar: getCompanyId respeita autenticação e ciclo de vida do tenant', async () => {
    seedDb()

    const clientA = createAuthenticatedClient({ id: USER_A_ID })
    const compA = await getCompanyId({ supabaseClient: clientA })
    assert.equal(compA, TENANT_A_ID, 'Deve retornar o company_id para usuário e tenant válidos')

    const clientSusp = createAuthenticatedClient({ id: USER_SUSPENDED_ID })
    const compSusp = await getCompanyId({ supabaseClient: clientSusp })
    assert.equal(compSusp, null, 'Deve retornar null se a empresa estiver suspensa')

    const clientAnon = createAuthenticatedClient(null)
    const compAnon = await getCompanyId({ supabaseClient: clientAnon })
    assert.equal(compAnon, null, 'Deve retornar null para usuário não autenticado')
  })
})
