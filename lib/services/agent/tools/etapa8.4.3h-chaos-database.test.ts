// @ts-nocheck
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ------------------------------------------------------------------------------
// ETAPA 8.4.3H — SUÍTE DE CAOS NO POSTGRESQL REAL (ZERO MOCKS)
// Conexão estrita ao container PostgreSQL local gerenciado pelo Supabase CLI
// ------------------------------------------------------------------------------
const REAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const REAL_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const supabase = createClient(REAL_SUPABASE_URL, REAL_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
})

describe('ETAPA 8.4.3H — Chaos Engineering: Prova Física no Banco de Dados (Zero Mocks)', () => {
  const companyId = crypto.randomUUID()
  const conversationId = crypto.randomUUID()
  let authUserId = null

  before(async () => {
    // 1. Cria usuário auth real
    const email = `chaos-${Date.now()}-${Math.floor(Math.random() * 10000)}@test.local`
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password: 'ChaosPassword123!',
      email_confirm: true
    })
    if (userError || !userData?.user?.id) {
      throw new Error(`Falha ao provisionar usuário auth para teste de caos: ${userError?.message}`)
    }
    authUserId = userData.user.id

    // 2. Cria empresa real no banco
    const { error: compError } = await supabase
      .from('companies')
      .insert({
        id: companyId,
        name: 'Empresa Teste de Caos Real',
        slug: `chaos-co-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        status: 'active',
        plan_tier: 'enterprise'
      })
    if (compError) {
      throw new Error(`Falha ao provisionar empresa de caos: ${compError.message}`)
    }

    // 3. Cria perfil real vinculado à empresa e ao usuário auth
    const { error: profError } = await supabase
      .from('profiles')
      .insert({
        id: authUserId,
        company_id: companyId,
        full_name: 'Chaos Engineer Profile'
      })
    if (profError) {
      throw new Error(`Falha ao provisionar profile de caos: ${profError.message}`)
    }

    // 4. Cria conversa real no canal WhatsApp
    const { error: convError } = await supabase
      .from('conversations')
      .insert({
        id: conversationId,
        company_id: companyId,
        channel: 'whatsapp',
        status: 'open'
      })
    if (convError) {
      throw new Error(`Falha ao provisionar conversa de caos: ${convError.message}`)
    }
  })

  after(async () => {
    // Limpeza rigorosa: Cascade no PostgreSQL remove conversations, messages, outbox e gateway locks
    if (companyId) {
      await supabase.from('companies').delete().eq('id', companyId)
    }
    if (authUserId) {
      await supabase.auth.admin.deleteUser(authUserId)
    }
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Bombardeio de Duplo Clique (Idempotência Física Concorrente)
  // ----------------------------------------------------------------------------
  test('Cenário 1: 15 chamadas concorrentes à RPC create_outbound_message_atomic resultam em exatamente 1 insert e 14 duplicates', async () => {
    const idemKey = `chaos-bombardment-${Date.now()}`

    // Dispara 15 chamadas concorrentes simultâneas via Promise.all
    const promises = Array.from({ length: 15 }, (_, i) => {
      return supabase.rpc('create_outbound_message_atomic', {
        p_company_id: companyId,
        p_conversation_id: conversationId,
        p_sender_type: 'human',
        p_sender_id: authUserId,
        p_content: `Mensagem de bombardeio concorrente #${i + 1}`,
        p_idempotency_key: idemKey,
        p_channel: 'whatsapp',
        p_recipient: '+5511999887766'
      })
    })

    const responses = await Promise.all(promises)

    // Todas as chamadas devem ter sido aceitas pelo PostgreSQL sem erro de rede ou falha não tratada
    for (let i = 0; i < responses.length; i++) {
      assert.equal(responses[i].error, null, `Chamada #${i} retornou erro inesperado: ${responses[i].error?.message}`)
      assert.ok(responses[i].data && responses[i].data.length > 0, `Chamada #${i} retornou data vazio`)
    }

    const rows = responses.map(r => r.data[0])
    const inserted = rows.filter(r => r.was_inserted === true)
    const duplicates = rows.filter(r => r.duplicate === true)

    // Asserção: Exatamente 1 chamada venceu
    assert.equal(inserted.length, 1, `Esperava exatamente 1 insert, obteve ${inserted.length}`)
    // Asserção: As outras 14 chamadas receberam duplicate: true
    assert.equal(duplicates.length, 14, `Esperava exatamente 14 duplicates, obteve ${duplicates.length}`)

    const winner = inserted[0]
    assert.ok(winner.message_id, 'Vencedor deve possuir message_id')
    assert.ok(winner.outbox_id, 'Vencedor deve possuir outbox_id')
    assert.equal(winner.status, 'pending')

    // Todas as 14 duplicatas devem apontar para o mesmo message_id e outbox_id da vencedora
    for (const dup of duplicates) {
      assert.equal(dup.message_id, winner.message_id, 'Duplicata deve referenciar o mesmo message_id do vencedor')
      assert.equal(dup.outbox_id, winner.outbox_id, 'Duplicata deve referenciar o mesmo outbox_id do vencedor')
    }

    // Asserção Física no Banco: Apenas 1 registro na tabela messages e 1 na tabela message_outbox
    const { count: msgCount } = await supabase
      .from('messages')
      .select('count', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('external_id', idemKey)

    const { count: outboxCount } = await supabase
      .from('message_outbox')
      .select('count', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('idempotency_key', idemKey)

    assert.equal(msgCount, 1, 'Banco físico deve conter exatamente 1 linha na tabela messages')
    assert.equal(outboxCount, 1, 'Banco físico deve conter exatamente 1 linha na tabela message_outbox')
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Contenção Distribuída no Gateway Lock
  // ----------------------------------------------------------------------------
  test('Cenário 2: 3 chamadas concorrentes à RPC acquire_gateway_outbound_lock concedem apenas 1 lease e rejeitam 2 com concurrency_active_lease', async () => {
    const gwEventId = `chaos-gw-${Date.now()}`

    // 1. Cria uma mensagem e outbox real
    const { data: createData, error: createError } = await supabase.rpc('create_outbound_message_atomic', {
      p_company_id: companyId,
      p_conversation_id: conversationId,
      p_sender_type: 'system',
      p_content: 'Mensagem para teste de gateway lock',
      p_idempotency_key: gwEventId,
      p_channel: 'whatsapp',
      p_recipient: '+5511999887766'
    })

    assert.equal(createError, null, `Erro ao criar mensagem: ${createError?.message}`)
    const msgId = createData[0].message_id
    const outboxId = createData[0].outbox_id

    // 2. Dispara 3 chamadas concorrentes para acquire_gateway_outbound_lock
    const lockPromises = Array.from({ length: 3 }, () => {
      return supabase.rpc('acquire_gateway_outbound_lock', {
        p_company_id: companyId,
        p_event_id: gwEventId,
        p_outbox_id: outboxId,
        p_message_id: msgId,
        p_lease_seconds: 60
      })
    })

    const lockResponses = await Promise.all(lockPromises)

    for (let i = 0; i < lockResponses.length; i++) {
      assert.equal(lockResponses[i].error, null, `Chamada de lock #${i} falhou com erro de banco: ${lockResponses[i].error?.message}`)
      assert.ok(lockResponses[i].data && lockResponses[i].data.length > 0, `Chamada #${i} retornou data vazio`)
    }

    const lockRows = lockResponses.map(r => r.data[0])
    const acquired = lockRows.filter(r => r.was_acquired === true)
    const rejected = lockRows.filter(r => r.was_acquired === false && r.error_reason === 'concurrency_active_lease')

    // Asserção: Apenas 1 chamada obteve o lock
    assert.equal(acquired.length, 1, `Esperava exatamente 1 lock adquirido, obteve ${acquired.length}`)
    assert.ok(acquired[0].claim_token, 'O lock adquirido deve possuir claim_token')
    assert.equal(acquired[0].status, 'in_flight')

    // Asserção: As outras 2 chamadas foram rejeitadas por lease ativo concorrente
    assert.equal(rejected.length, 2, `Esperava exatamente 2 rejeições com concurrency_active_lease, obteve ${rejected.length}`)
  })

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Máquina de Estados SQL (Lost Update Físico)
  // ----------------------------------------------------------------------------
  test('Cenário 3: 2 chamadas concorrentes à RPC merge_message_metadata_monotonic convergem para delivered sem regredir para sent', async () => {
    const msgId = crypto.randomUUID()

    // 1. Insere mensagem física diretamente com status 'pending'
    const { error: insError } = await supabase
      .from('messages')
      .insert({
        id: msgId,
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'system',
        content: 'Mensagem para teste de concorrência monotônica',
        metadata: { delivery_status: 'pending' }
      })

    assert.equal(insError, null, `Erro ao inserir mensagem base: ${insError?.message}`)

    // 2. Dispara concorrentemente uma atualização para 'delivered' e outra para 'sent'
    const callDelivered = supabase.rpc('merge_message_metadata_monotonic', {
      p_company_id: companyId,
      p_message_id: msgId,
      p_metadata_patch: { delivery_status: 'delivered', delivered_at: new Date().toISOString() }
    })

    const callSent = supabase.rpc('merge_message_metadata_monotonic', {
      p_company_id: companyId,
      p_message_id: msgId,
      p_metadata_patch: { delivery_status: 'sent', sent_at: new Date().toISOString() }
    })

    const [resDelivered, resSent] = await Promise.all([callDelivered, callSent])

    assert.equal(resDelivered.error, null, `Erro em update delivered: ${resDelivered.error?.message}`)
    assert.equal(resSent.error, null, `Erro em update sent: ${resSent.error?.message}`)

    // 3. Consulta física do registro na tabela messages
    const { data: finalMsg, error: selectError } = await supabase
      .from('messages')
      .select('metadata')
      .eq('id', msgId)
      .single()

    assert.equal(selectError, null, `Erro ao consultar mensagem final: ${selectError?.message}`)
    assert.ok(finalMsg?.metadata, 'Mensagem deve possuir metadados')

    // Asserção: O status final DEVE ser 'delivered' devido à proteção de ordem monotônica e FOR UPDATE
    assert.equal(
      finalMsg.metadata.delivery_status,
      'delivered',
      `Status final violou monotonia! Esperava 'delivered', obteve '${finalMsg.metadata.delivery_status}'`
    )
  })
})
