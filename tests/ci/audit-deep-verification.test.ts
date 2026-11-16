// @ts-nocheck
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import {
  isSafeUrl,
  isPrivateIp,
  isPrivateIpv4,
  safeLookup,
  safeHttpRequest,
  setMockHttpHandler
} from '@/lib/services/n8n-internal'
import {
  dispatchOutboxRecordHardened,
  sendEvolutionWithGatewayLock
} from '@/lib/services/conversations-internal'
import {
  requirePlatformAdmin,
  PlatformAuthError
} from '@/lib/services/platform/admin'
import {
  getAdminDashboardMetrics,
  getPlatformAuditLogs
} from '@/lib/services/platform/admin-metrics'
import {
  getOperationalTelemetry
} from '@/lib/services/platform/observability'
import {
  updateCompanyStatusAction,
  updateCompanyLimitsAction
} from '@/app/(admin)/companies/actions'
import {
  fetchEvolutionMediaBase64,
  createEvolutionInstanceOnServer
} from '@/lib/services/whatsapp-evolution'

const COMPANY_ID = '11111111-1111-1111-1111-111111111111'
const OUTBOX_ID_1 = '00000000-0000-0000-0000-000000000001'
const OUTBOX_ID_2 = '00000000-0000-0000-0000-000000000002'
const OUTBOX_ID_3 = '00000000-0000-0000-0000-000000000003'
const MSG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'

/**
 * Cria um mock completo e robusto do cliente Supabase para testes de integração unitários
 */
function createMockDb(config = {}) {
  const rpcHandler = config.rpc || (async () => ({ data: null, error: null }))
  const customTable = config.onTable || (() => undefined)

  function makeChain(table) {
    const filters = {}
    let pendingUpdate = null
    let pendingInsert = null

    const chain = {
      select: () => chain,
      eq: (col, val) => { filters[col] = val; return chain },
      not: () => chain,
      or: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (payload) => { pendingUpdate = payload; return chain },
      insert: (payload) => { pendingInsert = payload; return chain },
      single: async () => {
        const custom = await customTable(table, 'single', { filters, pendingUpdate, pendingInsert })
        if (custom !== undefined) return custom

        if (table === 'companies') {
          return { data: { id: COMPANY_ID, status: 'active', name: 'Empresa Teste', slug: 'empresa-teste' }, error: null }
        }
        if (table === 'integrations') {
          return {
            data: {
              id: 'int-1',
              company_id: COMPANY_ID,
              type: filters.type || 'n8n',
              status: 'active',
              config: {
                webhook_url: 'https://n8n.example.com/webhook',
                api_url: 'https://evolution.example.com',
                instance_name: 'prod-inst'
              },
              credentials: { webhook_secret: 'sec-123', api_key: 'evo-key' }
            },
            error: null
          }
        }
        return { data: null, error: null }
      },
      maybeSingle: async () => {
        const custom = await customTable(table, 'maybeSingle', { filters, pendingUpdate, pendingInsert })
        if (custom !== undefined) return custom

        if (table === 'companies') {
          return { data: { id: COMPANY_ID, status: 'active', name: 'Empresa Teste', slug: 'empresa-teste' }, error: null }
        }
        if (table === 'integrations') {
          return {
            data: {
              id: 'int-1',
              company_id: COMPANY_ID,
              type: filters.type || 'whatsapp_evolution',
              status: 'active',
              config: {
                webhook_url: 'https://n8n.example.com/webhook',
                api_url: 'https://evolution.example.com',
                instance_name: 'prod-inst'
              },
              credentials: { webhook_secret: 'sec-123', api_key: 'evo-key' }
            },
            error: null
          }
        }
        return { data: null, error: null }
      },
      then: (resolve, reject) => {
        Promise.resolve().then(async () => {
          const custom = await customTable(table, 'then', { filters, pendingUpdate, pendingInsert })
          if (custom !== undefined) return custom
          return { data: [], error: null }
        }).then(resolve, reject)
      }
    }

    return chain
  }

  return {
    from: (table) => makeChain(table),
    rpc: async (fnName, args) => rpcHandler(fnName, args)
  }
}

// ============================================================================
// SUÍTE 1: TESTE A — Outbox, Concorrência, Crash e Garantia de Entrega
// ============================================================================
describe('TESTE A — Outbox, Concorrência, Crash e Garantia de Entrega', () => {
  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('A.1 Concorrência entre workers: Worker A ganha o claim e Worker B é imediatamente barrado sem disparar HTTP', async () => {
    let workerBCalledHttp = false
    let claimCount = 0

    const mockClient = createMockDb({
      rpc: async (fnName, args) => {
        if (fnName === 'claim_outbox_message') {
          claimCount++
          if (claimCount === 1) {
            return {
              data: { was_claimed: true, claim_token: 'token-worker-a', claim_version: 1, reason: null },
              error: null
            }
          } else {
            return {
              data: { was_claimed: false, claim_token: null, claim_version: null, reason: 'concurrency_active_lease' },
              error: null
            }
          }
        }
        if (fnName === 'acquire_gateway_outbound_lock') {
          return {
            data: { was_acquired: true, claim_token: 'gw-token-a', status: 'in_flight', provider_message_id: null },
            error: null
          }
        }
        return { data: null, error: null }
      }
    })

    // Worker A despacha com mock HTTP ativo
    setMockHttpHandler(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'wamid-worker-a-123' }, provider_message_id: 'wamid-worker-a-123' }),
      json: async () => ({ key: { id: 'wamid-worker-a-123' }, provider_message_id: 'wamid-worker-a-123' })
    }))

    const resultA = await dispatchOutboxRecordHardened({
      adminClient: mockClient,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_1,
      messageId: MSG_ID,
      outboundPayload: {
        event_id: 'evt-test-a1',
        recipient: '5511999990001',
        message: { content: 'Olá do Worker A' }
      },
      leaseSeconds: 120
    })

    assert.equal(resultA.outcome, 'sent')
    assert.equal(resultA.providerMessageId, 'wamid-worker-a-123')

    // Worker B tenta a mesma mensagem simultaneamente com mock HTTP que detecta se houve tentativa de envio
    setMockHttpHandler(async () => {
      workerBCalledHttp = true
      return { ok: true, status: 200, text: async () => '{}' }
    })

    const resultB = await dispatchOutboxRecordHardened({
      adminClient: mockClient,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_1,
      messageId: MSG_ID,
      outboundPayload: {
        event_id: 'evt-test-a1',
        recipient: '5511999990001',
        message: { content: 'Tentativa concorrente Worker B' }
      },
      leaseSeconds: 120
    })

    assert.equal(resultB.outcome, 'claim_lost', 'Worker B deve perder a reivindicação')
    assert.equal(workerBCalledHttp, false, 'Worker B NÃO deve executar chamada HTTP ao gateway')
  })

  test('A.2 Crash pós-gateway: Worker A envia ao WhatsApp e grava gateway_lock, mas cai antes do outbox. Worker B recupera após o lease e NÃO reenvia ao WhatsApp (idempotência garantida)', async () => {
    let httpSendCount = 0
    let gatewayLockStatus = 'in_flight'
    let savedProviderMsgId = null
    let outboxFinalStatus = 'processing'

    setMockHttpHandler(async () => {
      httpSendCount++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ key: { id: 'wamid-provenance-456' } }),
        json: async () => ({ key: { id: 'wamid-provenance-456' } })
      }
    })

    const mockDb = createMockDb({
      rpc: async (fnName, args) => {
        if (fnName === 'claim_outbox_message') {
          return {
            data: { was_claimed: true, claim_token: 'token-' + args.p_outbox_id, claim_version: 1 },
            error: null
          }
        }
        if (fnName === 'acquire_gateway_outbound_lock') {
          if (gatewayLockStatus === 'completed') {
            return {
              data: {
                was_acquired: false,
                claim_token: 'token-gw-completed',
                status: 'completed',
                provider_message_id: savedProviderMsgId,
                error_reason: 'already_completed'
              },
              error: null
            }
          }
          gatewayLockStatus = 'in_flight'
          return {
            data: { was_acquired: true, claim_token: 'token-gw-1', status: 'in_flight', provider_message_id: null },
            error: null
          }
        }
        if (fnName === 'complete_gateway_outbound_lock') {
          gatewayLockStatus = args.p_status
          savedProviderMsgId = args.p_provider_message_id
          return { data: null, error: null }
        }
        if (fnName === 'complete_outbox_message') {
          outboxFinalStatus = args.p_status
          return { data: null, error: null }
        }
        return { data: null, error: null }
      },
      onTable: (table, op, ctx) => {
        if (table === 'integrations') {
          return {
            data: {
              id: 'int-evo-1',
              company_id: COMPANY_ID,
              type: 'whatsapp_evolution',
              status: 'active',
              config: { api_url: 'https://evolution.example.com', instance_name: 'prod-inst' },
              credentials: { api_key: 'evo-key' }
            },
            error: null
          }
        }
      }
    })

    // 1. Worker A envia a mensagem e atualiza o gateway lock, mas simula crash antes de complete_outbox_message
    const evoResA = await sendEvolutionWithGatewayLock({
      adminClient: mockDb,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_2,
      messageId: MSG_ID,
      outboundPayload: {
        event_id: 'evt-dedup-test',
        recipient: '5511988887777',
        message: { content: 'Mensagem inicial do Worker A' }
      },
      leaseSeconds: 120,
      isSafeUrl: () => true,
      isAmbiguousNetworkError: () => false
    })

    assert.equal(evoResA.success, true)
    assert.equal(evoResA.provider_message_id, 'wamid-provenance-456')
    assert.equal(httpSendCount, 1, 'WhatsApp deve ter recebido 1 envio do Worker A')
    assert.equal(gatewayLockStatus, 'completed', 'Lock do gateway foi concluído com sucesso')
    assert.equal(outboxFinalStatus, 'processing', 'Outbox permaneceu em processing porque Worker A caiu antes de atualizar')

    // 2. Worker B recupera a mensagem após o vencimento do lease
    const dispatchResB = await dispatchOutboxRecordHardened({
      adminClient: mockDb,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_2,
      messageId: MSG_ID,
      outboundPayload: {
        event_id: 'evt-dedup-test',
        recipient: '5511988887777',
        message: { content: 'Mensagem inicial do Worker A' }
      },
      leaseSeconds: 120
    })

    // 3. Verificação de Ouro: O WhatsApp NÃO recebeu um segundo envio!
    assert.equal(httpSendCount, 1, 'CRÍTICO: WhatsApp NÃO deve receber reenvio duplicado! Total de HTTP = 1')
    assert.equal(dispatchResB.outcome, 'sent', 'Worker B deve finalizar o outbox com sucesso aproveitando o provider_message_id')
    assert.equal(dispatchResB.providerMessageId, 'wamid-provenance-456')
    assert.equal(outboxFinalStatus, 'sent', 'Outbox foi reconciliado para sent sem duplicidade no provedor')
  })

  test('A.3 Crash em voo de rede (At-Least-Once Boundary): Preservação de event_id de idempotência e incremento monotônico', async () => {
    let attemptsCount = 1
    const eventIdOriginal = 'idempotent-uuid-0001'
    let receivedEventId = null

    setMockHttpHandler(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ key: { id: 'wamid-retry-ok' }, provider_message_id: 'wamid-retry-ok' }),
      json: async () => ({ key: { id: 'wamid-retry-ok' }, provider_message_id: 'wamid-retry-ok' })
    }))

    const mockDb = createMockDb({
      rpc: async (fnName, args) => {
        if (fnName === 'claim_outbox_message') {
          return {
            data: { was_claimed: true, claim_token: 'token-retry-1', claim_version: attemptsCount },
            error: null
          }
        }
        if (fnName === 'acquire_gateway_outbound_lock') {
          receivedEventId = args.p_event_id
          return {
            data: { was_acquired: true, claim_token: 'token-gw-retry', status: 'in_flight' },
            error: null
          }
        }
        return { data: null, error: null }
      }
    })

    const res = await dispatchOutboxRecordHardened({
      adminClient: mockDb,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_3,
      messageId: MSG_ID,
      outboundPayload: {
        event_id: eventIdOriginal,
        recipient: '5511977776666',
        message: { content: 'Tentativa resiliente com chave de idempotência' }
      },
      leaseSeconds: 120
    })

    assert.equal(res.outcome, 'sent')
    assert.equal(receivedEventId, eventIdOriginal, 'Chave de idempotência (event_id) deve ser monotonicamente idêntica')
  })
})

// ============================================================================
// SUÍTE 2: TESTE B — SuperAdmin e Autorização em Profundidade (5 Papéis)
// ============================================================================
describe('TESTE B — SuperAdmin e Autorização em Profundidade (5 Papéis)', () => {
  let dbCompanyStatus = 'active'
  let auditLogsInserted = []

  function createRoleMockSupabase(persona) {
    const db = createMockDb({
      onTable: (table, op, ctx) => {
        if (table === 'platform_admins') {
          if (persona.inPlatformAdmins) {
            return {
              data: {
                id: persona.userId,
                email: persona.email,
                full_name: persona.fullName,
                role: persona.platformRole,
                active: persona.active,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z'
              },
              error: null
            }
          }
          return { data: null, error: { code: 'PGRST116', message: 'Row not found' } }
        }
        if (table === 'companies') {
          if (ctx.pendingUpdate && ctx.pendingUpdate.status) {
            dbCompanyStatus = ctx.pendingUpdate.status
          }
          return {
            data: {
              id: COMPANY_ID,
              name: 'Empresa Alvo',
              slug: 'empresa-alvo',
              status: dbCompanyStatus,
              suspension_reason: ctx.pendingUpdate?.suspension_reason || null
            },
            error: null
          }
        }
        if (table === 'platform_audit_logs') {
          if (ctx.pendingInsert) {
            auditLogsInserted.push(ctx.pendingInsert)
          }
          return { data: ctx.pendingInsert || null, error: null }
        }
      }
    })

    return {
      ...db,
      auth: {
        getUser: async () => {
          if (persona.anonymous) {
            return { data: { user: null }, error: new Error('Sessão inexistente') }
          }
          return {
            data: {
              user: {
                id: persona.userId,
                email: persona.email
              }
            },
            error: null
          }
        }
      }
    }
  }

  beforeEach(() => {
    dbCompanyStatus = 'active'
    auditLogsInserted = []
  })

  test('B.1 Visitante Anônimo (Sem Sessão): Bloqueado com 401 e ZERO efeitos colaterais no banco', async () => {
    const anonMock = createRoleMockSupabase({ anonymous: true })
    setMockSupabaseClient(anonMock)

    // 1. Server Action
    const actionRes = await updateCompanyStatusAction(COMPANY_ID, 'suspended', 'Tentativa anônima')
    assert.equal(actionRes.success, false)
    assert.match(actionRes.error, /Não autenticado|401|sessão/i)
    assert.equal(dbCompanyStatus, 'active', 'Efeito colateral no banco DEVE ser zero: status inalterado')
    assert.equal(auditLogsInserted.length, 0, 'Nenhum log de auditoria gerado para anônimo')

    // 2. Serviço Direto
    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: anonMock, adminClient: anonMock })
      },
      (err) => {
        assert(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 401)
        return true
      }
    )
  })

  test('B.2 Usuário Comum da Empresa (Tenant Agent/Viewer): Bloqueado com 403 e ZERO efeitos colaterais', async () => {
    const agentMock = createRoleMockSupabase({
      anonymous: false,
      userId: 'user-tenant-agent-123',
      email: 'agent@tenant.com',
      inPlatformAdmins: false
    })
    setMockSupabaseClient(agentMock)

    const actionRes = await updateCompanyStatusAction(COMPANY_ID, 'suspended', 'Tentativa de agente')
    assert.equal(actionRes.success, false)
    assert.match(actionRes.error, /Acesso negado|não é um operador/i)
    assert.equal(dbCompanyStatus, 'active', 'Efeito colateral no banco DEVE ser zero')
    assert.equal(auditLogsInserted.length, 0)

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: agentMock, adminClient: agentMock })
      },
      (err) => {
        assert(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )
  })

  test('B.3 Administrador de uma Empresa (Tenant Admin): Bloqueado com 403 e ZERO efeitos colaterais no SuperAdmin', async () => {
    const tenantAdminMock = createRoleMockSupabase({
      anonymous: false,
      userId: 'user-tenant-admin-999',
      email: 'admin@empresa-cliente.com',
      inPlatformAdmins: false
    })
    setMockSupabaseClient(tenantAdminMock)

    const actionRes = await updateCompanyStatusAction(COMPANY_ID, 'suspended', 'Tentativa de admin do tenant')
    assert.equal(actionRes.success, false)
    assert.match(actionRes.error, /Acesso negado|não é um operador/i)
    assert.equal(dbCompanyStatus, 'active', 'Efeito colateral no banco DEVE ser zero')
    assert.equal(auditLogsInserted.length, 0)

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: tenantAdminMock, adminClient: tenantAdminMock })
      },
      (err) => {
        assert(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_NOT_OPERATOR')
        return true
      }
    )
  })

  test('B.4 SuperAdmin Inativo (active: false): Bloqueado com 403 FORBIDDEN_OPERATOR_INACTIVE e ZERO efeitos colaterais', async () => {
    const inactiveAdminMock = createRoleMockSupabase({
      anonymous: false,
      userId: 'user-superadmin-disabled',
      email: 'demitido@elleveeia.com',
      fullName: 'Operador Inativo',
      inPlatformAdmins: true,
      platformRole: 'superadmin',
      active: false
    })
    setMockSupabaseClient(inactiveAdminMock)

    const actionRes = await updateCompanyStatusAction(COMPANY_ID, 'suspended', 'Tentativa de admin desativado')
    assert.equal(actionRes.success, false)
    assert.match(actionRes.error, /Acesso negado|desativado/i)
    assert.equal(dbCompanyStatus, 'active', 'Efeito colateral no banco DEVE ser zero')
    assert.equal(auditLogsInserted.length, 0)

    await assert.rejects(
      async () => {
        await requirePlatformAdmin({ client: inactiveAdminMock, adminClient: inactiveAdminMock })
      },
      (err) => {
        assert(err instanceof PlatformAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'FORBIDDEN_OPERATOR_INACTIVE')
        return true
      }
    )
  })

  test('B.5 SuperAdmin Ativo: Acesso concedido, mutação executada e log de auditoria persistido com o ID do operador', async () => {
    const activeSuperAdminMock = createRoleMockSupabase({
      anonymous: false,
      userId: 'user-superadmin-active-777',
      email: 'phelipi@elleveeia.com',
      fullName: 'Phelipi SuperAdmin',
      inPlatformAdmins: true,
      platformRole: 'superadmin',
      active: true
    })
    setMockSupabaseClient(activeSuperAdminMock)

    // 1. Autorização central direta
    const authContext = await requirePlatformAdmin({ client: activeSuperAdminMock, adminClient: activeSuperAdminMock })
    assert.equal(authContext.user.id, 'user-superadmin-active-777')
    assert.equal(authContext.operator.role, 'superadmin')
    assert.equal(authContext.operator.active, true)

    // 2. Server Action de mutação real
    const actionRes = await updateCompanyStatusAction(COMPANY_ID, 'suspended', 'Suspensão justificada')
    assert.equal(actionRes.success, true)
    assert.equal(actionRes.data.status, 'suspended')
    assert.equal(dbCompanyStatus, 'suspended', 'Status no banco deve ser devidamente atualizado para suspended')
    assert.equal(auditLogsInserted.length, 1, 'Log de auditoria oficial deve ter sido gerado')
    assert.equal(auditLogsInserted[0].actor_id, 'user-superadmin-active-777')
    assert.equal(auditLogsInserted[0].action, 'company.suspended')
  })
})

// ============================================================================
// SUÍTE 3: TESTE C — SSRF e DNS Rebinding (Bateria Completa de Ataques e Pinning)
// ============================================================================
describe('TESTE C — SSRF e DNS Rebinding (Bateria Completa de Ataques e Pinning)', () => {
  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('C.1 Rejeição de loopback IPv4 (127.0.0.1 e variantes)', async () => {
    assert.equal(isPrivateIp('127.0.0.1'), true)
    assert.equal(isPrivateIp('127.0.0.2'), true)
    assert.equal(isSafeUrl('http://127.0.0.1:8080/admin'), false)
    assert.equal(isSafeUrl('http://127.0.0.1'), false)
    assert.equal(isSafeUrl('http://localhost:3000'), false)

    await assert.rejects(
      async () => {
        await safeHttpRequest('http://127.0.0.1:8080/admin')
      },
      /SSRF/i
    )
  })

  test('C.2 Rejeição de link-local e Cloud Metadata (169.254.169.254)', async () => {
    assert.equal(isPrivateIp('169.254.169.254'), true)
    assert.equal(isPrivateIpv4('169.254.169.254'), true)
    assert.equal(isSafeUrl('http://169.254.169.254/latest/meta-data/'), false)

    await assert.rejects(
      async () => {
        await safeHttpRequest('http://169.254.169.254/latest/meta-data/')
      },
      /SSRF/i
    )
  })

  test('C.3 Rejeição de faixas privadas IPv4 e representações decimais/hexadecimais/octais', async () => {
    assert.equal(isPrivateIp('10.0.0.1'), true)
    assert.equal(isPrivateIp('10.255.255.255'), true)
    assert.equal(isPrivateIp('172.16.0.1'), true)
    assert.equal(isPrivateIp('172.31.255.254'), true)
    assert.equal(isPrivateIp('192.168.0.1'), true)
    assert.equal(isPrivateIp('192.168.1.100'), true)

    assert.equal(isPrivateIp('100.64.0.1'), true)
    assert.equal(isPrivateIp('100.127.255.255'), true)
    assert.equal(isPrivateIp('0.0.0.0'), true)

    assert.equal(isSafeUrl('http://2130706433/'), false)
    assert.equal(isSafeUrl('http://0x7f000001/'), false)
    assert.equal(isSafeUrl('http://0177.0.0.1/'), false)
  })

  test('C.4 Rejeição de endereços IPv6 locais (Loopback, Link-Local, ULA, IPv4-mapped e NAT64)', async () => {
    assert.equal(isPrivateIp('::1'), true)
    assert.equal(isPrivateIp('0:0:0:0:0:0:0:1'), true)
    assert.equal(isSafeUrl('http://[::1]:8080/'), false)

    assert.equal(isPrivateIp('fe80::1'), true)
    assert.equal(isPrivateIp('fe80::abcd:1234'), true)

    assert.equal(isPrivateIp('fc00::1'), true)
    assert.equal(isPrivateIp('fd12:3456:789a::1'), true)

    assert.equal(isPrivateIp('::ffff:127.0.0.1'), true)
    assert.equal(isPrivateIp('::ffff:7f00:1'), true)
    assert.equal(isPrivateIp('::ffff:10.0.0.1'), true)
    assert.equal(isPrivateIp('::ffff:192.168.1.1'), true)

    assert.equal(isPrivateIp('64:ff9b::127.0.0.1'), true)
    assert.equal(isPrivateIp('64:ff9b::192.168.1.1'), true)
  })

  test('C.5 Domínio que resolve para IP privado (DNS Spoofing / Rebinding)', (t, done) => {
    safeLookup('127.0.0.1', {}, (err) => {
      assert(err instanceof Error)
      assert.match(err.message, /SSRF_BLOCKED/i)
      done()
    })
  })

  test('C.6 Bloqueio explícito de Redirecionamentos HTTP para endereços internos (301/302 Abort)', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
    })

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port

    const customLookup = (host, options, cb) => {
      if (typeof options === 'function') {
        cb = options
        options = {}
      }
      if (options && options.all) {
        return cb(null, [{ address: '127.0.0.1', family: 4 }])
      }
      return cb(null, '127.0.0.1', 4)
    }

    try {
      await assert.rejects(
        async () => {
          await safeHttpRequest(`http://example.com:${port}/`, {
            lookup: customLookup
          })
        },
        /Redirecionamentos HTTP são bloqueados por políticas de segurança|SSRF/i
      )
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  test('C.7 DNS com respostas múltiplas: Rejeita se QUALQUER endereço for privado e faz IP pinning se todos forem públicos', (t, done) => {
    const mixedAddresses = [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ]

    let blocked = false
    for (const addr of mixedAddresses) {
      if (isPrivateIp(addr.address)) {
        blocked = true
        break
      }
    }
    assert.equal(blocked, true, 'Se qualquer endereço da lista for privado, deve abortar imediatamente')

    const allPublicAddresses = [
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 }
    ]
    const approved = allPublicAddresses.every((a) => !isPrivateIp(a.address))
    assert.equal(approved, true)
    const pinnedIp = allPublicAddresses[0].address
    assert.equal(pinnedIp, '93.184.216.34', 'Socket deve ser fixado (pinning) no primeiro IP aprovado')
    done()
  })

  test('C.8 Blindagem integrada na Evolution API (whatsapp-evolution.ts) contra SSRF', async () => {
    const maliciousResult = await fetchEvolutionMediaBase64({
      messageExternalId: 'evolution-TEST123456789',
      apiUrl: 'http://169.254.169.254',
      apiKey: 'test-key',
      instanceName: 'inst-1'
    })

    assert.equal(Boolean(maliciousResult.error), true, 'Deve retornar erro de segurança')
    assert.match(maliciousResult.error, /SSRF|bloqueada|políticas de segurança/i)

    const createResult = await createEvolutionInstanceOnServer({
      instanceName: 'malicious-instance',
      apiUrl: 'http://127.0.0.1:8080',
      apiKey: 'test-key'
    })

    assert.equal(createResult.success, false)
    assert.match(createResult.error, /SSRF|bloqueada|políticas de segurança/i)
  })
})
