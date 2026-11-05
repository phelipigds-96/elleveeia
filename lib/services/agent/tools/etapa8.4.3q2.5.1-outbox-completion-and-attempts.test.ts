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
  retryOutboxMessage
} from '@/lib/services/message-engine'

test.describe('ETAPA 8.4.3Q.2.5.1 — Correção do Ciclo de Conclusão e Limite de Tentativas da Outbox', () => {
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111'
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222'
  const OUTBOX_1 = '90000000-aaaa-0000-0000-000000000001'
  const OUTBOX_2 = '90000000-aaaa-0000-0000-000000000002'

  let fetchCallCount = 0
  let originalFetch: any

  function seedDb() {
    resetInMemoryDb()
    fetchCallCount = 0

    // Tenants
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

    // Integrações
    inMemoryDb.integrations.set('int-alpha-n8n', {
      id: 'int-alpha-n8n',
      company_id: TENANT_A_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' }
    })
    inMemoryDb.integrations.set('int-beta-n8n', {
      id: 'int-beta-n8n',
      company_id: TENANT_B_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.ellevee.ai/outbound' }
    })
  }

  test.beforeEach(() => {
    seedDb()
    originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      fetchCallCount++
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
  // TESTE 1: Concluir uma mensagem com sucesso e tentar concluí-la novamente com o mesmo token
  // ---------------------------------------------------------------------------
  test('1. Concluir uma mensagem com sucesso e tentar concluí-la novamente com o mesmo token', async () => {
    const supabase = createAdminClient()
    const validToken = 'aaaaaaaa-1111-2222-3333-444444444444'

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      claim_token: validToken,
      claim_version: 1,
      attempts: 1,
      payload: { text: 'Olá' }
    })

    // 1ª Conclusão: deve ser bem-sucedida
    const { data: res1 } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: validToken,
      p_claim_version: 1,
      p_status: 'sent'
    })
    assert.strictEqual(res1?.[0]?.was_completed, true, 'Primeira conclusão deve ter sucesso')
    assert.strictEqual(res1?.[0]?.current_status, 'sent')

    // 2ª Conclusão com o mesmo token: deve ser rejeitada
    const { data: res2 } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: validToken,
      p_claim_version: 1,
      p_status: 'sent'
    })
    assert.strictEqual(res2?.[0]?.was_completed, false, 'Segunda chamada com mesmo token deve falhar')
    assert.strictEqual(res2?.[0]?.error_reason, 'already_completed')
  })

  // ---------------------------------------------------------------------------
  // TESTE 2: Confirmar que a segunda conclusão não altera sent para failed
  // ---------------------------------------------------------------------------
  test('2. Confirmar que a segunda conclusão não altera sent para failed', async () => {
    const supabase = createAdminClient()
    const validToken = 'aaaaaaaa-1111-2222-3333-444444444444'

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      claim_token: validToken,
      claim_version: 1,
      attempts: 1,
      payload: { text: 'Teste sent' }
    })

    // Conclui como sent
    await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: validToken,
      p_claim_version: 1,
      p_status: 'sent'
    })

    // Tenta re-concluir como failed com o mesmo token
    const { data: resReplay } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: validToken,
      p_claim_version: 1,
      p_status: 'failed',
      p_last_error: 'Simulação de erro replay'
    })

    assert.strictEqual(resReplay?.[0]?.was_completed, false)
    assert.strictEqual(resReplay?.[0]?.error_reason, 'already_completed')

    // O status no banco permanece estritamente 'sent'
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'sent', 'O status NÃO pode ser regredido de sent para failed')
    assert.strictEqual(outbox.claim_token, null, 'claim_token deve estar invalidado (NULL)')
    assert.strictEqual(outbox.last_error, null)
  })

  // ---------------------------------------------------------------------------
  // TESTE 3: Tentar concluir com token incorreto
  // ---------------------------------------------------------------------------
  test('3. Tentar concluir com token incorreto', async () => {
    const supabase = createAdminClient()

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      claim_token: '11111111-1111-1111-1111-111111111111',
      claim_version: 1,
      attempts: 1,
      payload: { text: 'Teste' }
    })

    const { data: res } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: '99999999-9999-9999-9999-999999999999', // Token errado
      p_claim_version: 1,
      p_status: 'sent'
    })

    assert.strictEqual(res?.[0]?.was_completed, false)
    assert.strictEqual(res?.[0]?.error_reason, 'fencing_token_mismatch')

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'processing')
  })

  // ---------------------------------------------------------------------------
  // TESTE 4: Tentar concluir com versão incorreta
  // ---------------------------------------------------------------------------
  test('4. Tentar concluir com versão incorreta', async () => {
    const supabase = createAdminClient()
    const validToken = '11111111-1111-1111-1111-111111111111'

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      claim_token: validToken,
      claim_version: 3,
      attempts: 3,
      payload: { text: 'Teste' }
    })

    const { data: res } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: validToken,
      p_claim_version: 2, // Versão defasada
      p_status: 'sent'
    })

    assert.strictEqual(res?.[0]?.was_completed, false)
    assert.strictEqual(res?.[0]?.error_reason, 'fencing_token_mismatch')

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'processing')
    assert.strictEqual(outbox.claim_version, 3)
  })

  // ---------------------------------------------------------------------------
  // TESTE 5: Tentar concluir um registro que não esteja em processing
  // ---------------------------------------------------------------------------
  test('5. Tentar concluir um registro que não esteja em processing', async () => {
    const supabase = createAdminClient()
    const anyToken = '11111111-1111-1111-1111-111111111111'

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed', // Não está em processing!
      claim_token: anyToken,
      claim_version: 1,
      attempts: 1,
      payload: { text: 'Failed state' }
    })

    const { data: res } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: anyToken,
      p_claim_version: 1,
      p_status: 'sent'
    })

    assert.strictEqual(res?.[0]?.was_completed, false)
    assert.strictEqual(res?.[0]?.error_reason, 'already_completed')

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'failed')
  })

  // ---------------------------------------------------------------------------
  // TESTE 6: Reivindicar registro com attempts = max_attempts - 1
  // ---------------------------------------------------------------------------
  test('6. Reivindicar registro com attempts = max_attempts - 1', async () => {
    const supabase = createAdminClient()

    // max_attempts = 5, attempts = 4 (última tentativa válida permitida)
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed',
      attempts: 4,
      max_attempts: 5,
      payload: { text: 'Última tentativa' }
    })

    const { data: claimData } = await supabase.rpc('claim_outbox_message', {
      p_company_id: TENANT_A_ID,
      p_outbox_id: OUTBOX_1,
      p_lease_seconds: 120
    })

    const claim = claimData?.[0]
    assert.strictEqual(claim?.was_claimed, true, 'Deve conceder a reivindicação para a última tentativa')
    assert.strictEqual(claim?.attempts, 5, 'Contador de attempts deve ser incrementado para 5')
    assert.strictEqual(claim?.status, 'processing')
  })

  // ---------------------------------------------------------------------------
  // TESTE 7: Confirmar que a reivindicação final incrementa o contador exatamente uma vez
  // ---------------------------------------------------------------------------
  test('7. Confirmar que a reivindicação final incrementa o contador exatamente uma vez', async () => {
    const supabase = createAdminClient()

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed',
      attempts: 2,
      max_attempts: 3,
      payload: { text: 'Tentativa 3 de 3' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })
    assert.strictEqual(res.success, true)
    assert.strictEqual(res.outcome, 'gateway_accepted')
    assert.strictEqual(fetchCallCount, 1)

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.attempts, 3, 'Attempts deve ter sido incrementado de 2 para 3 exatamente uma vez')
    assert.strictEqual(outbox.status, 'sent')
  })

  // ---------------------------------------------------------------------------
  // TESTE 8: Tentar reivindicar registro com attempts = max_attempts
  // ---------------------------------------------------------------------------
  test('8. Tentar reivindicar registro com attempts = max_attempts', async () => {
    const supabase = createAdminClient()

    // attempts já atingiu max_attempts (5 de 5)
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed',
      attempts: 5,
      max_attempts: 5,
      payload: { text: 'Esgotado' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.outcome, 'claim_lost')
    assert.match(res.error || '', /max_attempts_reached/)
    assert.strictEqual(fetchCallCount, 0, 'Nenhum HTTP deve ser disparado com limite de tentativas esgotado')

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'failed')
    assert.strictEqual(outbox.last_error, 'max_attempts_reached')
    assert.strictEqual(outbox.attempts, 5, 'Attempts NÃO pode ultrapassar max_attempts')
    assert.strictEqual(outbox.claim_token, null)
  })

  // ---------------------------------------------------------------------------
  // TESTE 9: Recuperar registro processing com lease expirado e limite atingido
  // ---------------------------------------------------------------------------
  test('9. Recuperar registro processing com lease expirado e limite atingido', async () => {
    const supabase = createAdminClient()

    // Registro em processing com lease vencido (-10s) mas attempts já em 5 de 5
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      locked_at: new Date(Date.now() - 60000).toISOString(),
      locked_until: new Date(Date.now() - 10000).toISOString(),
      claim_token: 'old-token-expired',
      claim_version: 5,
      attempts: 5,
      max_attempts: 5,
      payload: { text: 'Expirado no limite' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.outcome, 'claim_lost')
    assert.match(res.error || '', /max_attempts_reached/)
    assert.strictEqual(fetchCallCount, 0, 'Nenhum HTTP deve ser disparado')

    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'failed', 'Deve ser marcado como failed ao expirar no limite de tentativas')
    assert.strictEqual(outbox.last_error, 'max_attempts_reached')
    assert.strictEqual(outbox.claim_token, null, 'Token antigo deve ser invalidado')
    assert.strictEqual(outbox.locked_until, null, 'Lease deve ser limpo')
    assert.strictEqual(outbox.attempts, 5)
  })

  // ---------------------------------------------------------------------------
  // TESTE 10: Confirmar que lease vigente não é alterado por outra tentativa
  // ---------------------------------------------------------------------------
  test('10. Confirmar que lease vigente não é alterado por outra tentativa', async () => {
    const supabase = createAdminClient()
    const activeToken = 'active-token-1111-2222-3333-444444444444'
    const futureLockedUntil = new Date(Date.now() + 60000).toISOString()

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_until: futureLockedUntil,
      claim_token: activeToken,
      claim_version: 5,
      attempts: 5,
      max_attempts: 5,
      payload: { text: 'Worker ativo' }
    })

    // Outro processo tenta reivindicar enquanto o lease ainda está vigente
    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    assert.strictEqual(res.success, false)
    assert.strictEqual(res.outcome, 'claim_lost')
    assert.match(res.error || '', /lease ativo/)
    assert.strictEqual(fetchCallCount, 0)

    // O registro do worker ativo permanece intacto!
    const outbox = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outbox.status, 'processing', 'Lease ativo deve preservar o status processing')
    assert.strictEqual(outbox.claim_token, activeToken, 'Token do worker ativo NÃO pode ser revogado')
    assert.strictEqual(outbox.locked_until, futureLockedUntil)
  })

  // ---------------------------------------------------------------------------
  // TESTE 11: Confirmar que nenhuma condição de claim negado dispara HTTP
  // ---------------------------------------------------------------------------
  test('11. Confirmar que nenhuma condição de claim negado dispara HTTP', async () => {
    const supabase = createAdminClient()
    const baselineFetches = fetchCallCount

    // Condição A: already_sent
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'sent',
      attempts: 1,
      payload: { text: 'A' }
    })
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    // Condição B: suppressed
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'suppressed',
      attempts: 1,
      payload: { text: 'B' }
    })
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    // Condição C: active_lease
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'processing',
      locked_until: new Date(Date.now() + 50000).toISOString(),
      attempts: 1,
      payload: { text: 'C' }
    })
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    // Condição D: max_attempts_reached
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed',
      attempts: 5,
      max_attempts: 5,
      payload: { text: 'D' }
    })
    await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: supabase })

    // Condição E: outbox_not_found
    await retryOutboxMessage(TENANT_A_ID, '99999999-9999-9999-9999-999999999999', { adminClient: supabase })

    assert.strictEqual(fetchCallCount, baselineFetches, 'Nenhum HTTP deve ter sido disparado em nenhuma das 5 condições de claim negado')
  })

  // ---------------------------------------------------------------------------
  // TESTE 12: Confirmar isolamento entre empresas
  // ---------------------------------------------------------------------------
  test('12. Confirmar isolamento entre empresas', async () => {
    const supabase = createAdminClient()

    // Mensagem da Empresa A
    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed',
      attempts: 1,
      payload: { text: 'Empresa A' }
    })

    // Empresa B tenta reivindicar ou concluir OUTBOX_1
    const { data: claimB } = await supabase.rpc('claim_outbox_message', {
      p_company_id: TENANT_B_ID,
      p_outbox_id: OUTBOX_1,
      p_lease_seconds: 120
    })
    assert.strictEqual(claimB?.[0]?.was_claimed, false)
    assert.strictEqual(claimB?.[0]?.error_reason, 'outbox_not_found')

    const { data: completeB } = await supabase.rpc('complete_outbox_message', {
      p_company_id: TENANT_B_ID,
      p_outbox_id: OUTBOX_1,
      p_claim_token: '11111111-1111-1111-1111-111111111111',
      p_claim_version: 1,
      p_status: 'sent'
    })
    assert.strictEqual(completeB?.[0]?.was_completed, false)
    assert.strictEqual(completeB?.[0]?.error_reason, 'outbox_not_found')

    // Registro da Empresa A continua inalterado
    const outboxA = inMemoryDb.message_outbox.get(OUTBOX_1)
    assert.strictEqual(outboxA.status, 'failed')
    assert.strictEqual(outboxA.attempts, 1)
  })

  // ---------------------------------------------------------------------------
  // TESTE 13: Confirmar que uma falha na RPC não dispara HTTP
  // ---------------------------------------------------------------------------
  test('13. Confirmar que uma falha na RPC não dispara HTTP', async () => {
    const failingRpcClient = {
      ...createAdminClient(),
      rpc: async (fn: string) => {
        if (fn === 'claim_outbox_message') {
          return { data: null, error: { message: 'Database connection terminated unexpectedly (57P01)', code: '57P01' } }
        }
        return { data: null, error: null }
      }
    }

    inMemoryDb.message_outbox.set(OUTBOX_1, {
      id: OUTBOX_1,
      company_id: TENANT_A_ID,
      status: 'failed',
      attempts: 1,
      payload: { text: 'Falha RPC' }
    })

    const res = await retryOutboxMessage(TENANT_A_ID, OUTBOX_1, { adminClient: failingRpcClient })

    assert.strictEqual(res.success, false)
    assert.match(res.error || '', /Falha na reivindicação da outbox/)
    assert.strictEqual(fetchCallCount, 0, 'Zero chamadas HTTP quando a RPC falha')
  })
})
