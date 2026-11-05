// @ts-nocheck
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

// ==============================================================================
// HOMOLOGAÇÃO FINAL — PRODUÇÃO ELLEVÉE IA
// Etapa 8.4.3H — Testes Físicos de Segurança e Resiliência (100% PostgreSQL Real)
// ==============================================================================

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

describe('HOMOLOGAÇÃO FINAL — Backend Ellevée IA (PostgreSQL Físico / Zero Mocks)', () => {
  // Cliente administrativo restrito a setup, teardown e checagens de integridade
  const adminClient = createClient(LOCAL_SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // Clientes autenticados dos tenants (para testes de RLS)
  let clientA = null
  let clientB = null

  // Snapshots de integridade preexistente (baseline)
  let baselineCompanies = []
  let baselineMessages = []

  // Identificadores exclusivos desta execução
  const runTag = `homolog-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  const companyIdA = crypto.randomUUID()
  const companyIdB = crypto.randomUUID()
  const conversationIdB = crypto.randomUUID()
  const messageIdB = crypto.randomUUID()
  const contentOriginalB = `Confidential Data Company B [${runTag}]`

  let userIdA = null
  let userIdB = null
  const emailA = `tenant-a-${runTag}@test.local`
  const emailB = `tenant-b-${runTag}@test.local`
  const passwordUniversal = 'HomologacaoFisica2026!#Safe'

  // IDs para testes de Outbox
  const outboxConvId = crypto.randomUUID()
  const outboxMsgIdStalled = crypto.randomUUID()
  const outboxEntryIdStalled = crypto.randomUUID()
  const outboxMsgIdPoison = crypto.randomUUID()
  const outboxEntryIdPoison = crypto.randomUUID()

  before(async () => {
    // --------------------------------------------------------------------------
    // 1. Validação Criptográfica e Air-Gap de Conexão Local (Regra Inegociável)
    // --------------------------------------------------------------------------
    if (!LOCAL_SUPABASE_URL.includes('127.0.0.1:54321') && !LOCAL_SUPABASE_URL.includes('localhost:54321')) {
      throw new Error(`ABORTADO: O endpoint (${LOCAL_SUPABASE_URL}) não corresponde ao PostgreSQL local obrigatório.`)
    }

    try {
      const jwtParts = SERVICE_ROLE_KEY.split('.')
      if (jwtParts.length < 2) {
        throw new Error('Chave de serviço em formato JWT inválido.')
      }
      const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString('utf8'))
      if (jwtPayload.iss !== 'supabase-demo') {
        throw new Error(`AIR-GAP VIOLATION: Emissor inválido (${jwtPayload.iss}). Testes físicos só podem ser executados com iss: supabase-demo.`)
      }
      if (jwtPayload.role !== 'service_role') {
        throw new Error(`AIR-GAP VIOLATION: Role da chave (${jwtPayload.role}) não é service_role.`)
      }
    } catch (jwtErr) {
      throw new Error(`ABORTADO: Falha na validação da chave do ambiente local: ${jwtErr.message}`)
    }

    const { count: companyProbe, error: probeError } = await adminClient
      .from('companies')
      .select('count', { count: 'exact', head: true })

    if (probeError) {
      throw new Error(`ABORTADO: Falha de conexão com o Supabase local: ${probeError.message}`)
    }

    // --------------------------------------------------------------------------
    // 2. Snapshot de Integridade de Dados Preexistentes (Baseline Protection)
    // --------------------------------------------------------------------------
    const { data: initCompanies, error: initCompErr } = await adminClient
      .from('companies')
      .select('id, name, slug')
      .order('id')
    if (initCompErr) throw new Error(`Falha ao obter snapshot de companies: ${initCompErr.message}`)
    baselineCompanies = initCompanies || []

    const { data: initMessages, error: initMsgErr } = await adminClient
      .from('messages')
      .select('id, company_id, content')
      .order('id')
    if (initMsgErr) throw new Error(`Falha ao obter snapshot de messages: ${initMsgErr.message}`)
    baselineMessages = initMessages || []

    try {
      // ------------------------------------------------------------------------
      // 3. Criação de Usuários Auth Reais no GoTrue
      // ------------------------------------------------------------------------
      const { data: userResA, error: errUserA } = await adminClient.auth.admin.createUser({
        email: emailA,
        password: passwordUniversal,
        email_confirm: true
      })
      if (errUserA || !userResA?.user?.id) throw new Error(`Falha ao criar User A: ${errUserA?.message}`)
      userIdA = userResA.user.id

      const { data: userResB, error: errUserB } = await adminClient.auth.admin.createUser({
        email: emailB,
        password: passwordUniversal,
        email_confirm: true
      })
      if (errUserB || !userResB?.user?.id) throw new Error(`Falha ao criar User B: ${errUserB?.message}`)
      userIdB = userResB.user.id

      // ------------------------------------------------------------------------
      // 4. Criação de Empresas Reais (Empresa A e Empresa B)
      // ------------------------------------------------------------------------
      const { error: errComp } = await adminClient.from('companies').insert([
        { id: companyIdA, name: `Empresa A [${runTag}]`, slug: `empresa-a-${runTag}`, status: 'active', plan_tier: 'pro' },
        { id: companyIdB, name: `Empresa B [${runTag}]`, slug: `empresa-b-${runTag}`, status: 'active', plan_tier: 'enterprise' }
      ])
      if (errComp) throw new Error(`Falha ao criar empresas: ${errComp.message}`)

      // ------------------------------------------------------------------------
      // 5. Criação dos Perfis (Profiles) Vinculados
      // ------------------------------------------------------------------------
      const { error: errProf } = await adminClient.from('profiles').insert([
        { id: userIdA, company_id: companyIdA, full_name: 'Operador Empresa A', role: 'user' },
        { id: userIdB, company_id: companyIdB, full_name: 'Operador Empresa B', role: 'user' }
      ])
      if (errProf) throw new Error(`Falha ao criar profiles: ${errProf.message}`)

      // ------------------------------------------------------------------------
      // 6. Autenticação e Geração de Clientes com JWT Real para cada Usuário
      // ------------------------------------------------------------------------
      clientA = createClient(LOCAL_SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error: signErrA } = await clientA.auth.signInWithPassword({ email: emailA, password: passwordUniversal })
      if (signErrA) throw new Error(`Falha no sign-in de Client A: ${signErrA.message}`)

      clientB = createClient(LOCAL_SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error: signErrB } = await clientB.auth.signInWithPassword({ email: emailB, password: passwordUniversal })
      if (signErrB) throw new Error(`Falha no sign-in de Client B: ${signErrB.message}`)

      // ------------------------------------------------------------------------
      // 7. Criação de Conversa e Mensagem Pertencentes à Empresa B
      // ------------------------------------------------------------------------
      const { error: errConvB } = await adminClient.from('conversations').insert({
        id: conversationIdB,
        company_id: companyIdB,
        channel: 'whatsapp',
        status: 'open'
      })
      if (errConvB) throw new Error(`Falha ao criar conversa B: ${errConvB.message}`)

      const { error: errMsgB } = await adminClient.from('messages').insert({
        id: messageIdB,
        company_id: companyIdB,
        conversation_id: conversationIdB,
        sender_type: 'customer',
        content: contentOriginalB,
        metadata: { delivery_status: 'delivered' }
      })
      if (errMsgB) throw new Error(`Falha ao criar mensagem B: ${errMsgB.message}`)

      // ------------------------------------------------------------------------
      // 8. Preparação dos Registros de Teste da Outbox (Empresa B)
      // ------------------------------------------------------------------------
      const { error: errOutConv } = await adminClient.from('conversations').insert({
        id: outboxConvId,
        company_id: companyIdB,
        channel: 'whatsapp',
        status: 'open'
      })
      if (errOutConv) throw new Error(`Falha ao criar conversa outbox: ${errOutConv.message}`)

      // Mensagem 1: Stalled (elegível para recuperação) - Verificação Explícita de Erro
      const { error: errOutMsg1 } = await adminClient.from('messages').insert({
        id: outboxMsgIdStalled,
        company_id: companyIdB,
        conversation_id: outboxConvId,
        sender_type: 'system',
        content: 'Mensagem Stalled Recuperavel'
      })
      if (errOutMsg1) throw new Error(`Falha ao criar mensagem outbox stalled: ${errOutMsg1.message}`)

      const pastLockedUntil = new Date(Date.now() - 90000).toISOString() // 90s no passado
      const { error: errOut1 } = await adminClient.from('message_outbox').insert({
        id: outboxEntryIdStalled,
        company_id: companyIdB,
        conversation_id: outboxConvId,
        message_id: outboxMsgIdStalled,
        idempotency_key: `stalled-key-${runTag}`,
        channel: 'whatsapp',
        recipient: '+5511999887766',
        payload: { event: 'outbox_stalled_test' },
        status: 'processing',
        attempts: 1,
        max_attempts: 5,
        locked_at: new Date(Date.now() - 150000).toISOString(),
        locked_until: pastLockedUntil,
        claim_token: crypto.randomUUID(),
        claim_version: 1
      })
      if (errOut1) throw new Error(`Falha ao criar outbox stalled: ${errOut1.message}`)

      // Mensagem 2: Poison Pill (atingiu limite max_attempts = 5) - Verificação Explícita de Erro
      const { error: errOutMsg2 } = await adminClient.from('messages').insert({
        id: outboxMsgIdPoison,
        company_id: companyIdB,
        conversation_id: outboxConvId,
        sender_type: 'system',
        content: 'Mensagem Poison Pill'
      })
      if (errOutMsg2) throw new Error(`Falha ao criar mensagem outbox poison: ${errOutMsg2.message}`)

      const { error: errOutPoison } = await adminClient.from('message_outbox').insert({
        id: outboxEntryIdPoison,
        company_id: companyIdB,
        conversation_id: outboxConvId,
        message_id: outboxMsgIdPoison,
        idempotency_key: `poison-key-${runTag}`,
        channel: 'whatsapp',
        recipient: '+5511999887766',
        payload: { event: 'outbox_poison_pill_test' },
        status: 'processing',
        attempts: 5,
        max_attempts: 5,
        locked_at: new Date(Date.now() - 150000).toISOString(),
        locked_until: pastLockedUntil,
        claim_token: crypto.randomUUID(),
        claim_version: 1
      })
      if (errOutPoison) throw new Error(`Falha ao criar outbox poison: ${errOutPoison.message}`)

    } catch (setupError) {
      // Limpeza imediata em caso de falha no setup (respeitando ON DELETE RESTRICT de profiles)
      if (userIdA) {
        await adminClient.from('profiles').delete().eq('id', userIdA)
        await adminClient.auth.admin.deleteUser(userIdA)
      }
      if (userIdB) {
        await adminClient.from('profiles').delete().eq('id', userIdB)
        await adminClient.auth.admin.deleteUser(userIdB)
      }
      await adminClient.from('companies').delete().in('id', [companyIdA, companyIdB])
      throw setupError
    }
  })

  after(async () => {
    // --------------------------------------------------------------------------
    // Limpeza Estrita e Rastreável (Respeitando dependências referenciais)
    // --------------------------------------------------------------------------
    // 1. Remove profiles e usuários auth primeiro (evita violação de RESTRICT em profiles_company_id_fkey)
    if (userIdA) {
      await adminClient.from('profiles').delete().eq('id', userIdA)
      await adminClient.auth.admin.deleteUser(userIdA)
    }
    if (userIdB) {
      await adminClient.from('profiles').delete().eq('id', userIdB)
      await adminClient.auth.admin.deleteUser(userIdB)
    }

    // 2. Remove empresas de teste (Cascade remove conversas, mensagens e outbox)
    const { error: delCompErr } = await adminClient
      .from('companies')
      .delete()
      .in('id', [companyIdA, companyIdB])

    assert.equal(delCompErr, null, `Erro ao limpar empresas de teste: ${delCompErr?.message}`)

    // 3. Confirmação física de remoção dos registros gerados pelo teste
    const { count: remainingMsgs } = await adminClient
      .from('messages')
      .select('count', { count: 'exact', head: true })
      .in('id', [messageIdB, outboxMsgIdStalled, outboxMsgIdPoison])

    assert.equal(remainingMsgs, 0, 'Limpeza falhou: registros de mensagens do teste ainda residem no banco')

    // --------------------------------------------------------------------------
    // 4. Verificação de Integridade dos Dados Preexistentes (Baseline Intacto)
    // --------------------------------------------------------------------------
    const { data: finalCompanies, error: finalCompErr } = await adminClient
      .from('companies')
      .select('id, name, slug')
      .order('id')
    assert.equal(finalCompErr, null, `Erro ao verificar companies baseline: ${finalCompErr?.message}`)
    assert.deepEqual(
      finalCompanies,
      baselineCompanies,
      'VIOLAÇÃO DE DADOS: O conjunto de companies preexistentes foi modificado ou corrompido!'
    )

    const { data: finalMessages, error: finalMsgErr } = await adminClient
      .from('messages')
      .select('id, company_id, content')
      .order('id')
    assert.equal(finalMsgErr, null, `Erro ao verificar messages baseline: ${finalMsgErr?.message}`)
    assert.deepEqual(
      finalMessages,
      baselineMessages,
      'VIOLAÇÃO DE DADOS: O conjunto de messages preexistentes foi modificado ou corrompido!'
    )
  })

  // ============================================================================
  // SEÇÃO 3: TESTE FÍSICO DE ISOLAMENTO MULTI-TENANT (RLS ESTREITO)
  // ============================================================================

  test('3.A [RLS SELECT]: Empresa A não visualiza mensagem da Empresa B (Zero Vazamento)', async () => {
    const { data: crossSelect, error: selectErr } = await clientA
      .from('messages')
      .select('*')
      .eq('id', messageIdB)

    assert.equal(selectErr, null, `Select falhou com erro inesperado: ${selectErr?.message}`)
    assert.ok(Array.isArray(crossSelect), 'Retorno deve ser um array')
    assert.equal(crossSelect.length, 0, 'VIOLAÇÃO RLS: Empresa A conseguiu consultar registro da Empresa B!')
  })

  test('3.B [RLS UPDATE]: Empresa A não consegue alterar mensagem da Empresa B', async () => {
    const { data: updateData, error: updateErr } = await clientA
      .from('messages')
      .update({ content: 'CONTEUDO ADULTERADO MALICIOSAMENTE' })
      .eq('id', messageIdB)
      .select()

    assert.equal(updateErr, null, `Update falhou com erro inesperado: ${updateErr?.message}`)
    assert.ok(Array.isArray(updateData), 'Retorno do update deve ser array')
    assert.equal(updateData.length, 0, 'VIOLAÇÃO RLS: Empresa A conseguiu modificar registro da Empresa B!')
  })

  test('3.C [RLS DELETE]: Empresa A não consegue excluir mensagem da Empresa B', async () => {
    const { data: deleteData, error: deleteErr } = await clientA
      .from('messages')
      .delete()
      .eq('id', messageIdB)
      .select()

    assert.equal(deleteErr, null, `Delete falhou com erro inesperado: ${deleteErr?.message}`)
    assert.ok(Array.isArray(deleteData), 'Retorno do delete deve ser array')
    assert.equal(deleteData.length, 0, 'VIOLAÇÃO RLS: Empresa A conseguiu excluir registro da Empresa B!')
  })

  test('3.D [Auditoria Administrativa]: Mensagem da Empresa B permanece 100% íntegra', async () => {
    const { data: msgAdmin, error: adminErr } = await adminClient
      .from('messages')
      .select('id, company_id, content')
      .eq('id', messageIdB)
      .single()

    assert.equal(adminErr, null, `Erro ao consultar mensagem administrativamente: ${adminErr?.message}`)
    assert.equal(msgAdmin.id, messageIdB)
    assert.equal(msgAdmin.company_id, companyIdB)
    assert.equal(msgAdmin.content, contentOriginalB, 'A mensagem foi corrompida durante tentativas de mutação cross-tenant!')
  })

  test('3.E [Controle Positivo]: Usuário da Empresa B consulta com sucesso seu próprio registro', async () => {
    const { data: msgOwner, error: ownerErr } = await clientB
      .from('messages')
      .select('id, content')
      .eq('id', messageIdB)
      .single()

    assert.equal(ownerErr, null, `Controle positivo falhou: ${ownerErr?.message}`)
    assert.equal(msgOwner.id, messageIdB)
    assert.equal(msgOwner.content, contentOriginalB)
  })

  // ============================================================================
  // SEÇÃO 4: TESTE DE RECUPERAÇÃO FÍSICA DA OUTBOX & CONCORRÊNCIA DE WORKERS
  // ============================================================================

  test('4. Recuperação Física e Reivindicação Concorrente da Outbox (SKIP LOCKED)', async () => {
    // Dispara dois workers concorrentes simultâneos tentando reivindicar o lote
    const [worker1Result, worker2Result] = await Promise.all([
      adminClient.rpc('claim_stalled_outbox_batch', { p_batch_size: 10, p_lease_seconds: 120 }),
      adminClient.rpc('claim_stalled_outbox_batch', { p_batch_size: 10, p_lease_seconds: 120 })
    ])

    assert.equal(worker1Result.error, null, `Worker 1 RPC Error: ${worker1Result.error?.message}`)
    assert.equal(worker2Result.error, null, `Worker 2 RPC Error: ${worker2Result.error?.message}`)

    const w1Claimed = (worker1Result.data || []).filter(r => r.outbox_id === outboxEntryIdStalled)
    const w2Claimed = (worker2Result.data || []).filter(r => r.outbox_id === outboxEntryIdStalled)

    // Asserção Concorrente: Exatamente um worker deve ter recebido a mensagem (SKIP LOCKED comprovado)
    const totalDeliveries = w1Claimed.length + w2Claimed.length
    assert.equal(totalDeliveries, 1, `FALHA DE CONCORRÊNCIA: Mensagem entregue a ${totalDeliveries} workers simultaneamente!`)

    const claimRecord = w1Claimed[0] || w2Claimed[0]
    assert.equal(claimRecord.outbox_id, outboxEntryIdStalled)
    assert.equal(claimRecord.company_id, companyIdB)
    assert.equal(claimRecord.attempts, 2, 'Contador de tentativas deve ter sido incrementado de 1 para 2')
    assert.equal(claimRecord.claim_version, 2, 'claim_version deve ter sido incrementado de 1 para 2')
    assert.ok(claimRecord.claim_token, 'Deve possuir novo claim_token')

    // Consulta física direta no PostgreSQL
    const { data: dbEntry, error: dbErr } = await adminClient
      .from('message_outbox')
      .select('status, attempts, claim_version, claim_token, locked_until')
      .eq('id', outboxEntryIdStalled)
      .single()

    assert.equal(dbErr, null, `Erro ao verificar outbox no banco: ${dbErr?.message}`)
    assert.equal(dbEntry.status, 'processing')
    assert.equal(dbEntry.attempts, 2)
    assert.equal(dbEntry.claim_version, 2)

    // O novo lease DEVE estar no futuro (aproximadamente +120s)
    const leaseTime = new Date(dbEntry.locked_until).getTime()
    const nowTime = Date.now()
    assert.ok(leaseTime > nowTime + 30000, 'Novo lease deve ser válido no futuro (> 30s a partir de agora)')
  })

  // ============================================================================
  // SEÇÃO 5: TESTE DE POISON PILL (ENCERRAMENTO DEFINITIVO)
  // ============================================================================

  test('5. Poison Pill: Mensagem com limite de tentativas esgotado é marcada como failed definitivo', async () => {
    // Executa varredura de reconciliação
    const { data: sweepBatch, error: sweepErr } = await adminClient.rpc('claim_stalled_outbox_batch', {
      p_batch_size: 10,
      p_lease_seconds: 120
    })

    assert.equal(sweepErr, null, `Erro na varredura: ${sweepErr?.message}`)

    // A mensagem Poison Pill NÃO pode ter sido devolvida no lote para processamento
    const wasDeliveredToProcess = (sweepBatch || []).some(r => r.outbox_id === outboxEntryIdPoison)
    assert.equal(wasDeliveredToProcess, false, 'POISON PILL FALHOU: Mensagem esgotada foi devolvida para processamento!')

    // Inspeção física direta na tabela message_outbox do PostgreSQL
    const { data: poisonDb, error: poisonDbErr } = await adminClient
      .from('message_outbox')
      .select('status, last_error, attempts, max_attempts')
      .eq('id', outboxEntryIdPoison)
      .single()

    assert.equal(poisonDbErr, null, `Erro ao consultar poison pill no banco: ${poisonDbErr?.message}`)
    assert.equal(poisonDb.status, 'failed', 'Poison pill deve estar estritamente no estado failed')
    assert.equal(poisonDb.last_error, 'max_attempts_reached', 'Motivo de falha deve ser max_attempts_reached')
    assert.equal(poisonDb.attempts, 5)
  })
})
