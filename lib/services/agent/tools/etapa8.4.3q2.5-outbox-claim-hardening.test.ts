import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import {
  createAdminClient,
  resetInMemoryDb,
  inMemoryDb
} from '@supabase/supabase-js'

import {
  retryOutboxMessage,
  isAmbiguousGatewayOutcome,
  isValidUuid
} from '@/lib/services/message-engine'

test.describe('ETAPA 8.4.3Q.2.5 — Fundação Transacional e Reivindicação Atômica da Outbox', () => {
  // Tenants de Teste
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const TENANT_SUSPENDED_ID = '33333333-3333-3333-3333-333333333333'

  // Mensagens
  const MSG_A1_ID = '10000000-1111-0000-0000-000000000001'

  // Outbox IDs
  const OUTBOX_A1 = '90000000-aaaa-0000-0000-000000000001'
  const OUTBOX_A2 = '90000000-aaaa-0000-0000-000000000002'
  const OUTBOX_A3 = '90000000-aaaa-0000-0000-000000000003'
  const OUTBOX_SUSP = '90000000-cccc-0000-0000-000000000001'

  let fetchCallCount = 0
  let fetchHistory: any[] = []
  let originalFetch: any

  function seedDb() {
    resetInMemoryDb()
    fetchCallCount = 0
    fetchHistory = []

    // 1. Tenants
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
      name: 'Empresa Gamma (Suspensa)',
      status: 'suspended',
      plan_tier: 'standard'
    })

    // 2. Integrações n8n
    inMemoryDb.integrations.set('int-alpha-n8n', {
      id: 'int-alpha-n8n',
      company_id: TENANT_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-alpha-123' }
    })
    inMemoryDb.integrations.set('int-beta-n8n', {
      id: 'int-beta-n8n',
      company_id: TENANT_B_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-beta-123' }
    })
    inMemoryDb.integrations.set('int-susp-n8n', {
      id: 'int-susp-n8n',
      company_id: TENANT_SUSPENDED_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' },
      credentials: { webhook_secret: 'sec-susp-123' }
    })

    // 3. Conversas e Mensagens
    inMemoryDb.conversations.set('conv-a1', {
      id: 'conv-a1',
      company_id: TENANT_A_ID,
      title: 'Conversa Alpha'
    })
    inMemoryDb.messages.set(MSG_A1_ID, {
      id: MSG_A1_ID,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      sender_type: 'agent',
      content: 'Resposta de teste',
      metadata: {}
    })
  }

  test.beforeEach(() => {
    seedDb()
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (url: any, init: any) => {
      fetchCallCount++
      fetchHistory.push({ url: String(url), init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'success' }),
        text: async () => JSON.stringify({ status: 'success' })
      } as any
    }) as any
  })

  test.afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ---------------------------------------------------------------------------
  // TESTE 1: Dois retries simultâneos no mesmo registro
  // Somente um processo recebe a reivindicação; o segundo é recusado e não gera HTTP duplicado
  // ---------------------------------------------------------------------------
  test('1. Dois retries simultâneos no mesmo registro: somente um recebe a reivindicação', async () => {
    const supabase = createAdminClient()

    inMemoryDb.message_outbox.set(OUTBOX_A1, {
      id: OUTBOX_A1,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      message_id: MSG_A1_ID,
      idempotency_key: 'idem-a1',
      status: 'failed',
      attempts: 1,
      payload: { event_id: 'evt-1', text: 'Olá' }
    })

    // Dispara dois retries simultâneos
    const [res1, res2] = await Promise.all([
      retryOutboxMessage(TENANT_A_ID, OUTBOX_A1, { adminClient: supabase }),
      retryOutboxMessage(TENANT_A_ID, OUTBOX_A1, { adminClient: supabase })
    ])

    // Exatamente uma chamada obteve sucesso com gateway_accepted
    const successCount = [res1, res2].filter(r => r.success && r.outcome === 'gateway_accepted').length
    assert.strictEqual(successCount, 1, 'Exatamente um retry deve ser bem-sucedido')

    // O outro deve falhar por claim_lost / active_lease ou already_sent
    const rejectedCount = [res1, res2].filter(r => !r.success || r.alreadySent).length
    assert.strictEqual(rejectedCount, 1, 'Exatamente um retry concorrente deve ser rejeitado ou marcado alreadySent')

    // Somente 1 requisição HTTP externa disparada
    assert.strictEqual(fetchCallCount, 1, 'Apenas 1 disparo HTTP externo deve ocorrer para o mesmo registro')

    // O registro final no banco deve estar 'sent' com attempts = 2
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_A1)
    assert.strictEqual(outbox.status, 'sent')
    assert.strictEqual(outbox.attempts, 2)
  })

  // ---------------------------------------------------------------------------
  // TESTE 2: Retry em empresa diferente
  // Não acessa o registro de outro tenant (isolamento estrito multi-tenant)
  // ---------------------------------------------------------------------------
  test('2. Retry em empresa diferente: não acessa o registro de outro tenant', async () => {
    const supabase = createAdminClient()

    inMemoryDb.message_outbox.set(OUTBOX_A1, {
      id: OUTBOX_A1,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      message_id: MSG_A1_ID,
      idempotency_key: 'idem-a1',
      status: 'failed',
      attempts: 1,
      payload: { event_id: 'evt-1', text: 'Tenant A msg' }
    })

    // Tenant B tenta reprocessar a outbox de Tenant A
    const res = await retryOutboxMessage(TENANT_B_ID, OUTBOX_A1, { adminClient: supabase })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.error, 'Registro não encontrado')
    assert.strictEqual(fetchCallCount, 0, 'Nenhum HTTP deve ser disparado em tentativa cross-tenant')

    // O registro de Tenant A permanece intacto
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_A1)
    assert.strictEqual(outbox.status, 'failed')
    assert.strictEqual(outbox.attempts, 1)
  })

  // ---------------------------------------------------------------------------
  // TESTE 3: Lease vigente
  // Impede nova reivindicação enquanto a mensagem está em processing com lease válido
  // ---------------------------------------------------------------------------
  test('3. Lease vigente: impede nova reivindicação', async () => {
    const supabase = createAdminClient()

    const futureLockedUntil = new Date(Date.now() + 60 * 1000).toISOString()
    inMemoryDb.message_outbox.set(OUTBOX_A1, {
      id: OUTBOX_A1,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      message_id: MSG_A1_ID,
      idempotency_key: 'idem-a1',
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_until: futureLockedUntil,
      claim_token: '11111111-0000-0000-0000-000000000001',
      claim_version: 1,
      attempts: 1,
      payload: { event_id: 'evt-1', text: 'Em processamento' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A1, { adminClient: supabase })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.outcome, 'claim_lost')
    assert.match(res.error || '', /Registro em processamento por outro processo com lease ativo/)
    assert.strictEqual(fetchCallCount, 0, 'Nenhum HTTP deve ser disparado com lease ativo')

    // Attempts não deve ter sido incrementado
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_A1)
    assert.strictEqual(outbox.attempts, 1)
  })

  // ---------------------------------------------------------------------------
  // TESTE 4: Lease vencido
  // Permite recuperação operacional após expiração do lease
  // ---------------------------------------------------------------------------
  test('4. Lease vencido: permite recuperação operacional', async () => {
    const supabase = createAdminClient()

    // Lease expirado há 10 segundos
    const pastLockedUntil = new Date(Date.now() - 10 * 1000).toISOString()
    inMemoryDb.message_outbox.set(OUTBOX_A1, {
      id: OUTBOX_A1,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      message_id: MSG_A1_ID,
      idempotency_key: 'idem-a1',
      status: 'processing',
      locked_at: new Date(Date.now() - 70 * 1000).toISOString(),
      locked_until: pastLockedUntil,
      claim_token: 'old-token-0000-0000-0000-000000000001',
      claim_version: 1,
      attempts: 1,
      payload: { event_id: 'evt-1', text: 'Recuperando mensagem' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A1, { adminClient: supabase })

    assert.strictEqual(res.success, true)
    assert.strictEqual(res.outcome, 'gateway_accepted')
    assert.strictEqual(fetchCallCount, 1, 'HTTP deve ser executado para recuperar lease expirado')

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_A1)
    assert.strictEqual(outbox.status, 'sent')
    assert.strictEqual(outbox.attempts, 2, 'attempts deve ser incrementado para 2')
    assert.notStrictEqual(outbox.claim_token, 'old-token-0000-0000-0000-000000000001')
    assert.strictEqual(outbox.claim_version, 2, 'claim_version deve ser incrementado para 2')
  })

  // ---------------------------------------------------------------------------
  // TESTE 5: Processo antigo com claim_token inválido (Fencing)
  // Processo zumbi cujo lease expirou não consegue sobrescrever estado com complete_outbox_message
  // ---------------------------------------------------------------------------
  test('5. Processo antigo com claim_token inválido: não consegue concluir atualização (Fencing)', async () => {
    const supabase = createAdminClient()

    // Estado atual no banco: a mensagem foi reivindicada por um novo processo (Versão 2, Token Novo)
    const validToken = '22222222-2222-2222-2222-222222222222'
    inMemoryDb.message_outbox.set(OUTBOX_A1, {
      id: OUTBOX_A1,
      company_id: TENANT_A_ID,
      status: 'processing',
      claim_token: validToken,
      claim_version: 2,
      attempts: 2,
      payload: { event_id: 'evt-1' }
    })

    // Processo antigo/zumbi tenta finalizar com claim_token e versão defasados
    const zombieToken = '11111111-1111-1111-1111-111111111111'
    const { data: completeData } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_A1,
      p_claim_token: zombieToken,
      p_claim_version: 1,
      p_status: 'sent'
    })

    const complete = completeData?.[0]
    assert.strictEqual(complete?.was_completed, false, 'Processo zumbi não deve conseguir completar a outbox')
    assert.strictEqual(complete?.error_reason, 'fencing_token_mismatch', 'Motivo deve ser fencing_token_mismatch')

    // O status no banco permanece 'processing' sob o token válido
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_A1)
    assert.strictEqual(outbox.status, 'processing')
    assert.strictEqual(outbox.claim_token, validToken)
    assert.strictEqual(outbox.claim_version, 2)
  })

  // ---------------------------------------------------------------------------
  // TESTE 6: attempts incrementado apenas na reivindicação efetiva
  // Se não foi concedida a reivindicação, attempts NÃO é incrementado
  // ---------------------------------------------------------------------------
  test('6. attempts incrementado apenas na reivindicação efetiva', async () => {
    const supabase = createAdminClient()

    inMemoryDb.message_outbox.set(OUTBOX_A2, {
      id: OUTBOX_A2,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      idempotency_key: 'idem-a2',
      status: 'sent', // Já enviada
      attempts: 3,
      payload: { event_id: 'evt-2' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A2, { adminClient: supabase })

    assert.strictEqual(res.success, true)
    assert.strictEqual(res.alreadySent, true)
    assert.strictEqual(fetchCallCount, 0)

    // attempts permanece exatamente 3
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_A2)
    assert.strictEqual(outbox.attempts, 3, 'Attempts não pode ser alterado para registro não elegível')
  })

  // ---------------------------------------------------------------------------
  // TESTE 7: Empresa suspensa: não permite reivindicação
  // Bloqueio fail-closed antes do despacho HTTP
  // ---------------------------------------------------------------------------
  test('7. Empresa suspensa: não permite reivindicação', async () => {
    const supabase = createAdminClient()

    inMemoryDb.message_outbox.set(OUTBOX_SUSP, {
      id: OUTBOX_SUSP,
      company_id: TENANT_SUSPENDED_ID,
      conversation_id: 'conv-susp',
      idempotency_key: 'idem-susp',
      status: 'failed',
      attempts: 1,
      payload: { event_id: 'evt-susp' }
    })

    const res = await retryOutboxMessage(TENANT_SUSPENDED_ID, OUTBOX_SUSP, { adminClient: supabase })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.suppressed, true)
    assert.strictEqual(res.code, 'TENANT_SUSPENDED')
    assert.strictEqual(fetchCallCount, 0, 'Nenhum HTTP deve ser disparado para empresa suspensa')

    // Registro deve ser marcado como suppressed
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_SUSP)
    assert.strictEqual(outbox.status, 'suppressed')
  })

  // ---------------------------------------------------------------------------
  // TESTE 8: idempotency_key igual em empresas diferentes: permitido
  // Unicidade multi-tenant garante que empresas não colidem entre si
  // ---------------------------------------------------------------------------
  test('8. idempotency_key igual em empresas diferentes: permitido', async () => {
    const supabase = createAdminClient()
    const sharedIdempotencyKey = 'shared-order-evt-12345'

    // Inserção para Empresa Alpha
    const { data: dataA, error: errA } = await supabase.from('message_outbox').insert({
      id: '80000000-aaaa-0000-0000-000000000001',
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      idempotency_key: sharedIdempotencyKey,
      status: 'pending',
      payload: { tenant: 'alpha' }
    })
    assert.strictEqual(errA, null, 'Inserção para Empresa A deve ter sucesso')

    // Inserção para Empresa Beta com a mesma idempotency_key
    const { data: dataB, error: errB } = await supabase.from('message_outbox').insert({
      id: '80000000-bbbb-0000-0000-000000000001',
      company_id: TENANT_B_ID,
      conversation_id: 'conv-b1',
      idempotency_key: sharedIdempotencyKey,
      status: 'pending',
      payload: { tenant: 'beta' }
    })
    assert.strictEqual(errB, null, 'Inserção para Empresa B com mesma chave deve ter sucesso')

    assert.ok(inMemoryDb.message_outbox.has('80000000-aaaa-0000-0000-000000000001'))
    assert.ok(inMemoryDb.message_outbox.has('80000000-bbbb-0000-0000-000000000001'))
  })

  // ---------------------------------------------------------------------------
  // TESTE 9: idempotency_key duplicado dentro da mesma empresa: bloqueado
  // Constraint composta (company_id, idempotency_key) impede duplicação interna
  // ---------------------------------------------------------------------------
  test('9. idempotency_key duplicado dentro da mesma empresa: bloqueado', async () => {
    const supabase = createAdminClient()
    const duplicateKey = 'single-tenant-key-999'

    // Primeira inserção: sucesso
    const { error: err1 } = await supabase.from('message_outbox').insert({
      id: '80000000-aaaa-0000-0000-000000000010',
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      idempotency_key: duplicateKey,
      status: 'pending',
      payload: { attempt: 1 }
    })
    assert.strictEqual(err1, null)

    // Segunda inserção com mesma chave para a mesma empresa: erro de unicidade
    const { error: err2 } = await supabase.from('message_outbox').insert({
      id: '80000000-aaaa-0000-0000-000000000011',
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      idempotency_key: duplicateKey,
      status: 'pending',
      payload: { attempt: 2 }
    })

    assert.notStrictEqual(err2, null, 'Segunda inserção com mesma chave na mesma empresa deve falhar')
    assert.strictEqual(err2?.code, '23505', 'Código de erro deve ser violação de unicidade (23505)')
    assert.match(err2?.message || '', /uq_outbox_company_idempotency/)
  })

  // ---------------------------------------------------------------------------
  // TESTE 10: Erro da RPC: nenhum HTTP é disparado
  // Fail-closed absoluto: falha no banco aborta o despacho externo imediatamente
  // ---------------------------------------------------------------------------
  test('10. Erro da RPC: nenhum HTTP é disparado', async () => {
    // Mock do adminClient que simula erro de conexão ou falha na RPC
    const failingAdminClient = {
      ...createAdminClient(),
      rpc: async (fn: string) => {
        if (fn === 'claim_outbox_message') {
          return { data: null, error: { message: 'Database connection failed: 57P01', code: '57P01' } }
        }
        return { data: null, error: null }
      }
    }

    inMemoryDb.message_outbox.set(OUTBOX_A1, {
      id: OUTBOX_A1,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      message_id: MSG_A1_ID,
      status: 'failed',
      payload: { event_id: 'evt-1' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A1, { adminClient: failingAdminClient })

    assert.strictEqual(res.success, false)
    assert.match(res.error || '', /Falha na reivindicação da outbox/)
    assert.strictEqual(fetchCallCount, 0, 'Nenhum HTTP deve ser disparado em caso de erro na RPC')
  })

  // ---------------------------------------------------------------------------
  // TESTE ADICIONAL: Distinção de Outcomes
  // gateway_accepted, confirmed_failure, unknown_outcome, claim_lost
  // ---------------------------------------------------------------------------
  test('11. Contrato interno: classificação estrita de outcomes (gateway_accepted, confirmed_failure, unknown_outcome, claim_lost)', async () => {
    const supabase = createAdminClient()

    // Cenário A: Timeout do gateway (unknown_outcome) -> NÃO marca failed
    globalThis.fetch = (async () => {
      fetchCallCount++
      throw new Error('The operation was aborted due to timeout')
    }) as any

    inMemoryDb.message_outbox.set(OUTBOX_A3, {
      id: OUTBOX_A3,
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      idempotency_key: 'idem-a3',
      status: 'failed',
      attempts: 1,
      payload: { event_id: 'evt-timeout' }
    })

    const timeoutRes = await retryOutboxMessage(TENANT_A_ID, OUTBOX_A3, { adminClient: supabase })

    assert.strictEqual(timeoutRes.success, false)
    assert.strictEqual(timeoutRes.outcome, 'unknown_outcome', 'Deve ser classificado como unknown_outcome')
    
    // Status NÃO pode ser marcado como failed! Permanece em processing (com lease para expirar)
    const outboxTimeout = inMemoryDb.message_outbox.get(OUTBOX_A3)
    assert.strictEqual(outboxTimeout.status, 'processing', 'Mensagem com resultado ambíguo NÃO pode ser convertida automaticamente em falha comprovada')

    // Cenário B: Falha confirmada (ex: HTTP 404 retornado pelo gateway)
    globalThis.fetch = (async () => {
      fetchCallCount++
      return {
        ok: false,
        status: 404,
        text: async () => 'Workflow Not Found'
      } as any
    }) as any

    inMemoryDb.message_outbox.set('90000000-aaaa-0000-0000-000000000099', {
      id: '90000000-aaaa-0000-0000-000000000099',
      company_id: TENANT_A_ID,
      conversation_id: 'conv-a1',
      status: 'failed',
      attempts: 1,
      payload: { event_id: 'evt-404' }
    })

    const failRes = await retryOutboxMessage(TENANT_A_ID, '90000000-aaaa-0000-0000-000000000099', { adminClient: supabase })
    assert.strictEqual(failRes.success, false)
    assert.strictEqual(failRes.outcome, 'confirmed_failure')

    const outboxFailed = inMemoryDb.message_outbox.get('90000000-aaaa-0000-0000-000000000099')
    assert.strictEqual(outboxFailed.status, 'failed')
  })
})
