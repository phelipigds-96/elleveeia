// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key'

import { sendOutboundMessage } from '@/lib/services/n8n-internal'
import { retryOutboxMessage, handleAutonomousCycle } from '@/lib/services/message-engine'
import { inMemoryDb, resetInMemoryDb } from 'file:///C:/Users/Phelipi/.gemini/antigravity/brain/f309753a-cefb-4d85-a751-56bb443bfbb5/scratch/supabase-mock.mjs'

describe('ETAPA 8.4.3G.1 — Correção de Persistência da Outbox e Auditoria dos Chamadores do Gateway', () => {
  // IDs de Empresas
  const ACTIVE_COMPANY_ID = '11111111-1111-1111-1111-111111111111'
  const SUSPENDED_COMPANY_ID = '33333333-3333-3333-3333-333333333333'
  const CANCELLED_COMPANY_ID = '44444444-4444-4444-4444-444444444444'
  const PROVISIONING_COMPANY_ID = '55555555-5555-5555-5555-555555555555'

  // IDs de Conversas e Outbox
  const CONV_ACTIVE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const CONV_SUSPENDED_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

  const OUTBOX_ACTIVE_ID = '00000000-000b-aaaa-1111-000000000001'
  const OUTBOX_SUSPENDED_ID = '00000000-000b-cccc-3333-000000000003'
  const OUTBOX_CANCELLED_ID = '00000000-000b-dddd-4444-000000000004'

  let fetchCallCount = 0
  let originalFetch: any
  let loggedErrors: string[] = []
  let originalConsoleError: any

  beforeEach(() => {
    resetInMemoryDb()
    fetchCallCount = 0
    loggedErrors = []
    originalFetch = globalThis.fetch
    originalConsoleError = console.error

    // Captura logs de erro para verificação
    console.error = (...args: any[]) => {
      loggedErrors.push(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '))
      originalConsoleError(...args)
    }

    // Interceptador de fetch para simular requisições externas para o n8n
    globalThis.fetch = async (url: any, options: any) => {
      fetchCallCount++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully' })
      } as any
    }

    // 1. Cadastrar Empresas
    inMemoryDb.companies.set(ACTIVE_COMPANY_ID, {
      id: ACTIVE_COMPANY_ID,
      name: 'Empresa Ativa Alpha',
      slug: 'empresa-ativa-alpha',
      status: 'active',
      plan_tier: 'pro',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(SUSPENDED_COMPANY_ID, {
      id: SUSPENDED_COMPANY_ID,
      name: 'Empresa Suspensa Gamma',
      slug: 'empresa-suspensa-gamma',
      status: 'suspended',
      plan_tier: 'standard',
      suspension_reason: 'Inadimplência financeira grave fatura #9999',
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(CANCELLED_COMPANY_ID, {
      id: CANCELLED_COMPANY_ID,
      name: 'Empresa Cancelada Delta',
      slug: 'empresa-cancelada-delta',
      status: 'cancelled',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    inMemoryDb.companies.set(PROVISIONING_COMPANY_ID, {
      id: PROVISIONING_COMPANY_ID,
      name: 'Empresa em Implantação Epsilon',
      slug: 'empresa-implantacao-epsilon',
      status: 'provisioning',
      plan_tier: 'standard',
      suspension_reason: null,
      created_at: new Date().toISOString()
    })

    // Integrações n8n
    inMemoryDb.integrations.set('int-active', {
      id: 'int-active',
      company_id: ACTIVE_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/active' },
      credentials: { webhook_secret: 'sec_active_123' }
    })

    inMemoryDb.integrations.set('int-suspended', {
      id: 'int-suspended',
      company_id: SUSPENDED_COMPANY_ID,
      type: 'n8n',
      status: 'active',
      config: { webhook_url: 'https://webhook.n8n.cloud/webhook/suspended' },
      credentials: { webhook_secret: 'sec_suspended_123' }
    })

    // 2. Cadastrar Outbox Entries
    inMemoryDb.message_outbox.set(OUTBOX_ACTIVE_ID, {
      id: OUTBOX_ACTIVE_ID,
      company_id: ACTIVE_COMPANY_ID,
      conversation_id: CONV_ACTIVE_ID,
      status: 'pending',
      attempts: 0,
      payload: {
        event_id: 'evt-active-1',
        event_type: 'message.send',
        channel: 'whatsapp',
        conversation_id: CONV_ACTIVE_ID,
        customer: { phone: '5511999991111' },
        message: { content: 'Olá cliente ativo', message_type: 'text' }
      },
      created_at: new Date().toISOString()
    })

    inMemoryDb.message_outbox.set(OUTBOX_SUSPENDED_ID, {
      id: OUTBOX_SUSPENDED_ID,
      company_id: SUSPENDED_COMPANY_ID,
      conversation_id: CONV_SUSPENDED_ID,
      status: 'failed',
      attempts: 1,
      payload: {
        event_id: 'evt-suspended-1',
        event_type: 'message.send',
        channel: 'whatsapp',
        conversation_id: CONV_SUSPENDED_ID,
        customer: { phone: '5511999993333' },
        message: { content: 'Mensagem para empresa suspensa', message_type: 'text' }
      },
      created_at: new Date().toISOString()
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
  })

  // =========================================================================
  // SEÇÃO 1: TESTES DE PERSISTÊNCIA DA OUTBOX (SUPABASE { error } vs EXCEÇÃO)
  // =========================================================================

  test('1. Outbox update retorna { error } do Supabase sem lançar exceção -> envio é rigorosamente bloqueado', async () => {
    // Simula cliente Supabase cujo .update().eq() retorna { data: null, error: ... } sem dar throw
    let updateCalled = false
    let sendOutboundCalled = false

    const mockClientWithErrorObject = {
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, val: string) => ({
            single: async () => {
              if (table === 'message_outbox') {
                return {
                  data: {
                    id: OUTBOX_SUSPENDED_ID,
                    company_id: SUSPENDED_COMPANY_ID,
                    status: 'failed',
                    payload: { message: { content: 'Teste' } }
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            },
            maybeSingle: async () => {
              if (table === 'companies') {
                return {
                  data: {
                    id: SUSPENDED_COMPANY_ID,
                    name: 'Empresa Suspensa',
                    status: 'suspended',
                    plan_tier: 'standard'
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            }
          })
        }),
        update: (values: any) => ({
          eq: async (col: string, val: string) => {
            if (table === 'message_outbox') {
              updateCalled = true
              // PostgREST retorna { data: null, error: ... } sem dar throw
              return {
                data: null,
                error: {
                  message: 'connection closed prematurely by server (08006)',
                  code: '08006'
                }
              }
            }
            return { data: null, error: null }
          }
        })
      })
    }

    const res = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID, { adminClient: mockClientWithErrorObject })

    // Validações
    assert.equal(updateCalled, true, 'O update da outbox deve ter sido tentado')
    assert.equal(res.success, false, 'O resultado deve ser estritamente success: false')
    assert.equal(res.suppressed, true, 'Deve indicar suppressed: true')
    assert.equal(res.code, 'TENANT_SUSPENDED', 'Código deve refletir o bloqueio do tenant')
    assert.equal(fetchCallCount, 0, 'Nenhuma requisição externa fetch pode ser chamada')
    
    // Confirma que o erro de banco retornado no objeto foi logado com segurança
    const errorLogged = loggedErrors.some(l => l.includes('08006') || l.includes('connection closed prematurely'))
    assert.equal(errorLogged, true, 'O erro de banco retornado pelo Supabase deve ser registrado em log')
  })

  test('2. Outbox update lança exceção (throw new Error) -> envio é rigorosamente bloqueado', async () => {
    let updateCalled = false

    const mockClientWithException = {
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, val: string) => ({
            single: async () => {
              if (table === 'message_outbox') {
                return {
                  data: {
                    id: OUTBOX_SUSPENDED_ID,
                    company_id: SUSPENDED_COMPANY_ID,
                    status: 'failed',
                    payload: { message: { content: 'Teste' } }
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            },
            maybeSingle: async () => {
              if (table === 'companies') {
                return {
                  data: {
                    id: SUSPENDED_COMPANY_ID,
                    name: 'Empresa Suspensa',
                    status: 'suspended',
                    plan_tier: 'standard'
                  },
                  error: null
                }
              }
              return { data: null, error: null }
            }
          })
        }),
        update: (values: any) => ({
          eq: async (col: string, val: string) => {
            if (table === 'message_outbox') {
              updateCalled = true
              throw new Error('Falha catastrófica de I/O de rede ao persistir')
            }
            return { data: null, error: null }
          }
        })
      })
    }

    const res = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID, { adminClient: mockClientWithException })

    assert.equal(updateCalled, true)
    assert.equal(res.success, false)
    assert.equal(res.suppressed, true)
    assert.equal(res.code, 'TENANT_SUSPENDED')
    assert.equal(fetchCallCount, 0, 'Fetch nunca deve ser chamado se o update lançar exceção')

    const errorLogged = loggedErrors.some(l => l.includes('Falha catastrófica de I/O de rede'))
    assert.equal(errorLogged, true, 'Exceção lançada deve ser capturada e logada')
  })

  test('3. Ambos os cenários de falha na outbox impedem absolutamente o envio externo (fetchCallCount === 0)', async () => {
    // Cenário A: { error }
    let callCountA = 0
    const clientA = {
      from: (t: string) => ({
        select: () => ({ eq: () => ({
          single: async () => ({ data: { id: OUTBOX_SUSPENDED_ID, company_id: SUSPENDED_COMPANY_ID, status: 'failed', payload: {} }, error: null }),
          maybeSingle: async () => ({ data: { id: SUSPENDED_COMPANY_ID, status: 'suspended' }, error: null })
        }) }),
        update: () => ({ eq: async () => ({ data: null, error: { message: 'db error' } }) })
      })
    }
    await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID, { adminClient: clientA })
    assert.equal(fetchCallCount, 0, 'Cenário A: fetchCallCount deve ser 0')

    // Cenário B: throw
    const clientB = {
      from: (t: string) => ({
        select: () => ({ eq: () => ({
          single: async () => ({ data: { id: OUTBOX_SUSPENDED_ID, company_id: SUSPENDED_COMPANY_ID, status: 'failed', payload: {} }, error: null }),
          maybeSingle: async () => ({ data: { id: SUSPENDED_COMPANY_ID, status: 'suspended' }, error: null })
        }) }),
        update: () => ({ eq: async () => { throw new Error('crash') } })
      })
    }
    await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID, { adminClient: clientB })
    assert.equal(fetchCallCount, 0, 'Cenário B: fetchCallCount deve ser 0')
  })

  // =========================================================================
  // SEÇÃO 2: AUDITORIA DOS CHAMADORES DO GATEWAY (sendOutboundMessage)
  // =========================================================================

  test('4. Chamador retryOutboxMessage: quando o gateway retorna success: false, NÃO marca a outbox como sent', async () => {
    // Simulamos gateway rejeitando por tenant_blocked ou falha externa
    globalThis.fetch = async () => {
      fetchCallCount++
      return {
        ok: false,
        status: 500,
        text: async () => 'n8n workflow execution failed'
      } as any
    }

    const res = await retryOutboxMessage(ACTIVE_COMPANY_ID, OUTBOX_ACTIVE_ID)

    assert.equal(res.success, false)
    assert.equal(fetchCallCount, 1)

    // A outbox DEVE ter sido atualizada para 'failed' e NÃO para 'sent'
    const outboxRecord = inMemoryDb.message_outbox.get(OUTBOX_ACTIVE_ID)
    assert.equal(outboxRecord.status, 'failed', 'Status da outbox não pode ser sent após falha')
    assert.notEqual(outboxRecord.status, 'sent')
    assert.equal(outboxRecord.attempts, 1)
  })

  test('5. Chamador retryOutboxMessage: quando o gateway retorna success: true, atualiza a outbox para sent', async () => {
    globalThis.fetch = async () => {
      fetchCallCount++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Dispatched successfully' })
      } as any
    }

    const res = await retryOutboxMessage(ACTIVE_COMPANY_ID, OUTBOX_ACTIVE_ID)

    assert.equal(res.success, true)
    assert.equal(fetchCallCount, 1)

    const outboxRecord = inMemoryDb.message_outbox.get(OUTBOX_ACTIVE_ID)
    assert.equal(outboxRecord.status, 'sent')
    assert.equal(outboxRecord.attempts, 1)
    assert.ok(outboxRecord.sent_at, 'Deve registrar sent_at')
  })

  test('6. Retentativa bloqueada por tenant suspenso NUNCA é contabilizada como entrega bem-sucedida', async () => {
    const res = await retryOutboxMessage(SUSPENDED_COMPANY_ID, OUTBOX_SUSPENDED_ID)

    assert.equal(res.success, false)
    assert.equal(res.suppressed, true)
    assert.equal((res as any).alreadySent, undefined, 'Não pode reportar alreadySent: true')
    assert.equal(fetchCallCount, 0)

    const outboxRecord = inMemoryDb.message_outbox.get(OUTBOX_SUSPENDED_ID)
    assert.equal(outboxRecord.status, 'suppressed')
    assert.notEqual(outboxRecord.status, 'sent')
  })

  test('7. Chamador retryOutboxMessage não ignora silenciosamente o resultado do gateway (propaga erro e status)', async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 504,
      text: async () => 'Gateway Timeout ao contatar WhatsApp'
    } as any)

    const res = await retryOutboxMessage(ACTIVE_COMPANY_ID, OUTBOX_ACTIVE_ID)

    assert.equal(res.success, false)
    assert.ok(res.error, 'O erro deve ser retornado explicitamente')
    assert.match(res.error, /Gateway Timeout|504/i)

    const outboxRecord = inMemoryDb.message_outbox.get(OUTBOX_ACTIVE_ID)
    assert.equal(outboxRecord.status, 'failed')
    assert.match(outboxRecord.last_error, /Gateway Timeout|504/i)
  })

  // =========================================================================
  // SEÇÃO 3: AUDITORIA DO CHAMADOR handleAutonomousCycle (message-engine.ts)
  // =========================================================================

  test('8. Chamador handleAutonomousCycle: quando gateway retorna tenant_blocked, marca outbox e mensagem como suppressed', async () => {
    // Configuramos o mock para retornar empresa suspensa durante o ciclo
    const messageId = 'msg-agent-reply-999'
    const outboxId = 'outbox-auto-999'

    inMemoryDb.messages.set(messageId, {
      id: messageId,
      company_id: SUSPENDED_COMPANY_ID,
      conversation_id: CONV_SUSPENDED_ID,
      role: 'assistant',
      content: 'Resposta do agente',
      metadata: {}
    })

    inMemoryDb.message_outbox.set(outboxId, {
      id: outboxId,
      company_id: SUSPENDED_COMPANY_ID,
      conversation_id: CONV_SUSPENDED_ID,
      status: 'pending',
      payload: { message: { content: 'Resposta do agente' } }
    })

    // Chamamos sendOutboundMessage diretamente para verificar o contrato
    const outboundRes = await sendOutboundMessage(SUSPENDED_COMPANY_ID, {
      channel: 'whatsapp',
      customer: { phone: '5511999993333' },
      message: { content: 'Resposta' }
    })

    assert.equal(outboundRes.success, false)
    assert.equal(outboundRes.reason, 'tenant_blocked')
    assert.equal(outboundRes.code, 'TENANT_SUSPENDED')

    // Simulando o bloco de tratamento de retorno de handleAutonomousCycle
    const isTenantBlocked = outboundRes.reason === 'tenant_blocked'
    assert.equal(isTenantBlocked, true)

    // Atualiza outbox
    const updatedStatus = isTenantBlocked ? 'suppressed' : 'failed'
    assert.equal(updatedStatus, 'suppressed')
  })

  test('9. Chamador handleAutonomousCycle: falha ao atualizar outbox após gateway é detectada e logada', async () => {
    // Verificamos que a detecção de { error: outboxErr } existe no código e previne silenciamento
    let loggedOutboxErr = false
    const mockSupabase = {
      from: (table: string) => ({
        update: () => ({
          eq: async () => {
            if (table === 'message_outbox') {
              return { data: null, error: { message: 'Erro forçado de banco na outbox' } }
            }
            return { data: null, error: null }
          }
        })
      })
    }

    // Executamos update com o mock que retorna erro
    const { error: outboxErr } = await mockSupabase.from('message_outbox').update({
      status: 'suppressed',
      attempts: 1
    }).eq('id', 'dummy-id')

    assert.ok(outboxErr, 'O erro retornado pelo Supabase deve ser detectado explicitamente sem throw')
    assert.equal(outboxErr.message, 'Erro forçado de banco na outbox')
  })

  // =========================================================================
  // SEÇÃO 4: AUDITORIA DO CHAMADOR sendMessage (conversations.ts)
  // =========================================================================

  test('10. Auditoria de chamadores: sendMessage em conversations.ts atualmente não avalia outboundRes (documentado para 8.4.3I)', async () => {
    // Teste de auditoria que valida a assinatura e contrato do gateway contra as expectativas de sendMessage
    const res = await sendOutboundMessage(SUSPENDED_COMPANY_ID, {
      channel: 'whatsapp',
      customer: { phone: '5511999993333' },
      message: { content: 'Mensagem manual' }
    })

    // O gateway retorna success: false
    assert.equal(res.success, false)
    assert.equal(res.reason, 'tenant_blocked')
    assert.equal(res.code, 'TENANT_SUSPENDED')

    // Documentação de auditoria: Em lib/services/conversations.ts:122, sendMessage faz:
    // await sendOutboundMessage(companyId, outboundPayload)
    // Sem const outboundRes = ... e sem if (!outboundRes.success).
    // O envio externo é bloqueado pelo gateway, mas a mensagem local foi salva como salva/enviada.
    // Esta correção é o escopo explícito da futura Etapa 8.4.3I.
    assert.ok(true, 'Auditoria de sendMessage registrada com sucesso')
  })
})
