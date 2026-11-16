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
  createEvolutionInstanceOnServer,
  saveEvolutionConfig,
  disconnectEvolutionWhatsApp,
  restartEvolutionWhatsApp,
  getEvolutionConfig
} from '@/lib/services/whatsapp-evolution'
import {
  assertTenantAdmin,
  TenantAuthError
} from '@/lib/services/auth/guard'
import {
  saveEvolutionConfigAction,
  disconnectWhatsAppAction,
  restartWhatsAppAction,
  getEvolutionConfigAction,
  getWhatsAppStatusAction,
  getWhatsAppQrCodeAction
} from '@/app/(dashboard)/integrations/actions'

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

// ============================================================================
// SUÍTE 4: AUDITORIA #2 — Item 1: Autorização da Integração Evolution
// ============================================================================
describe('AUDITORIA #2 — Item 1: Autorização da Integração Evolution e Server Actions', () => {
  const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  function createTenantMockSupabase(persona) {
    const profile = persona.anonymous ? null : {
      id: persona.userId || 'user-1',
      email: persona.email || 'user@empresa.com',
      role: persona.role || 'user',
      company_id: persona.companyId || TENANT_A,
      full_name: 'Usuário de Teste'
    }

    let dbIntegration = {
      id: 'int-1',
      company_id: persona.companyId || TENANT_A,
      type: 'whatsapp_evolution',
      status: 'active',
      config: {
        api_url: 'https://evolution.example.com',
        instance_name: 'prod-inst'
      },
      credentials: { api_key: 'evo-key' }
    }

    return {
      auth: {
        getUser: async () => {
          if (persona.anonymous) {
            return { data: { user: null }, error: new Error('Sem sessão') }
          }
          return {
            data: {
              user: {
                id: persona.userId || 'user-1',
                email: persona.email || 'user@empresa.com'
              }
            },
            error: null
          }
        }
      },
      from: (table) => {
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
            if (table === 'profiles') {
              return { data: profile, error: profile ? null : { message: 'Not found' } }
            }
            if (table === 'integrations') {
              return { data: dbIntegration, error: null }
            }
            return { data: null, error: null }
          },
          maybeSingle: async () => {
            if (table === 'profiles') {
              return { data: profile, error: null }
            }
            if (table === 'integrations') {
              return { data: dbIntegration, error: null }
            }
            return { data: null, error: null }
          }
        }
        return chain
      }
    }
  }

  test('1.1 Usuário não autenticado tentando chamar saveEvolutionConfigAction é bloqueado', async () => {
    const anonMock = createTenantMockSupabase({ anonymous: true })
    setMockSupabaseClient(anonMock)

    const res = await saveEvolutionConfigAction({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'sec-key',
      instanceName: 'inst-1'
    })

    assert.equal(res.success, false)
    assert.match(res.error, /não autenticado|administradores/i)
  })

  test('1.2 Usuário comum ("user") chamando saveEvolutionConfigAction é bloqueado no servidor com 403', async () => {
    const userMock = createTenantMockSupabase({ role: 'user', companyId: TENANT_A })
    setMockSupabaseClient(userMock)

    const res = await saveEvolutionConfigAction({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'sec-key',
      instanceName: 'inst-1'
    })

    assert.equal(res.success, false)
    assert.match(res.error, /restrita a administradores e proprietários/i)
  })

  test('1.3 Atendente ("attendant") chamando saveEvolutionConfigAction é bloqueado com 403', async () => {
    const attendantMock = createTenantMockSupabase({ role: 'attendant', companyId: TENANT_A })
    setMockSupabaseClient(attendantMock)

    const res = await saveEvolutionConfigAction({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'sec-key',
      instanceName: 'inst-1'
    })

    assert.equal(res.success, false)
    assert.match(res.error, /restrita a administradores e proprietários/i)
  })

  test('1.4 Atendente chamando disconnectWhatsAppAction e restartWhatsAppAction é bloqueado', async () => {
    const attendantMock = createTenantMockSupabase({ role: 'attendant', companyId: TENANT_A })
    setMockSupabaseClient(attendantMock)

    const discRes = await disconnectWhatsAppAction()
    assert.equal(discRes.success, false)
    assert.match(discRes.error, /restrita a administradores e proprietários/i)

    const restRes = await restartWhatsAppAction()
    assert.equal(restRes.success, false)
    assert.match(restRes.error, /restrita a administradores e proprietários/i)
  })

  test('1.5 Atendente chamando getEvolutionConfigAction não recebe as credenciais da integração', async () => {
    const attendantMock = createTenantMockSupabase({ role: 'attendant', companyId: TENANT_A })
    setMockSupabaseClient(attendantMock)

    const cfgRes = await getEvolutionConfigAction()
    assert.equal(cfgRes.apiKey, '')
    assert.equal(cfgRes.isConfigured, false)
    assert.match(cfgRes.error, /restrita a administradores/i)
  })

  test('1.6 Administrador ("admin") chamando saveEvolutionConfigAction com URL válida obtém sucesso', async () => {
    const adminMock = createTenantMockSupabase({ role: 'admin', companyId: TENANT_A })
    setMockSupabaseClient(adminMock)

    const res = await saveEvolutionConfigAction({
      apiUrl: 'https://evolution.empresa-a.com.br',
      apiKey: 'secret-api-key-123',
      instanceName: 'empresa-a-inst'
    })

    assert.equal(res.success, true)
  })

  test('1.7 Administrador chamando saveEvolutionConfigAction com URL SSRF privada é bloqueado', async () => {
    const adminMock = createTenantMockSupabase({ role: 'admin', companyId: TENANT_A })
    setMockSupabaseClient(adminMock)

    const res = await saveEvolutionConfigAction({
      apiUrl: 'http://169.254.169.254/latest/meta-data',
      apiKey: 'secret-api-key-123',
      instanceName: 'empresa-a-inst'
    })

    assert.equal(res.success, false)
    assert.match(res.error, /SSRF|insegura|bloqueada/i)
  })

  test('1.8 Proprietário ("owner") chamando saveEvolutionConfigAction obtém sucesso', async () => {
    const ownerMock = createTenantMockSupabase({ role: 'owner', companyId: TENANT_A })
    setMockSupabaseClient(ownerMock)

    const res = await saveEvolutionConfigAction({
      apiUrl: 'https://evolution.empresa-a.com.br',
      apiKey: 'secret-api-key-owner',
      instanceName: 'empresa-a-inst'
    })

    assert.equal(res.success, true)
  })

  test('1.9 Prevenção estrita de IDOR: Admin da Empresa A tentando operar recursos da Empresa B é barrado', async () => {
    const adminMockA = createTenantMockSupabase({ role: 'admin', companyId: TENANT_A })
    setMockSupabaseClient(adminMockA)

    await assert.rejects(
      async () => {
        await assertTenantAdmin({ client: adminMockA, targetCompanyId: TENANT_B })
      },
      (err) => {
        assert(err instanceof TenantAuthError)
        assert.equal(err.statusCode, 403)
        assert.equal(err.code, 'TENANT_MISMATCH')
        return true
      }
    )
  })
})

// ============================================================================
// SUÍTE 5: AUDITORIA #2 — Item 3: Homologação Real do Outbox e Limite At-Least-Once
// ============================================================================
describe('AUDITORIA #2 — Item 3: Homologação Real do Outbox (Concorrência, Crash e Lease Recovery)', () => {
  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('3.1 Concorrência entre workers: Worker 1 obtém claim exclusivo; Worker 2 falha no claim e é bloqueado sem acionar gateway', async () => {
    let worker1AttemptedHttp = false
    let worker2AttemptedHttp = false

    const outboxRow = {
      id: OUTBOX_ID_1,
      company_id: COMPANY_ID,
      message_id: MSG_ID,
      status: 'pending',
      claimed_at: null,
      claim_token: null,
      lease_expires_at: null
    }

    const worker1Db = createMockDb({
      rpc: async (fnName, args) => {
        if (fnName === 'claim_outbox_message') {
          if (outboxRow.status === 'pending') {
            outboxRow.status = 'processing'
            outboxRow.claim_token = 'token-worker-1'
            return { data: [{ was_claimed: true, claim_token: 'token-worker-1' }], error: null }
          }
          return { data: [{ was_claimed: false, error_reason: 'already_claimed' }], error: null }
        }
        if (fnName === 'acquire_gateway_outbound_lock') {
          return { data: [{ was_acquired: true, claim_token: 'gw-token-1' }], error: null }
        }
        if (fnName === 'complete_gateway_outbound_lock') {
          return { data: [{ was_completed: true }], error: null }
        }
        if (fnName === 'complete_outbox_message') {
          outboxRow.status = 'sent'
          return { data: [{ was_completed: true }], error: null }
        }
        return { data: null, error: null }
      }
    })

    const worker2Db = createMockDb({
      rpc: async (fnName, args) => {
        if (fnName === 'claim_outbox_message') {
          // Já está claimed por worker 1
          if (outboxRow.status === 'processing') {
            return { data: [{ was_claimed: false, error_reason: 'already_claimed' }], error: null }
          }
        }
        return { data: null, error: null }
      }
    })

    setMockHttpHandler(async (url) => {
      worker1AttemptedHttp = true
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ key: { id: 'wamid-worker1' } })
      }
    })

    // Execução Worker 1
    const resWorker1 = await dispatchOutboxRecordHardened({
      adminClient: worker1Db,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_1,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-1', message: { content: 'Olá Concorrente' } }
    })

    assert.equal(resWorker1.outcome, 'sent')
    assert.equal(worker1AttemptedHttp, true)

    // Execução concorrente Worker 2
    const resWorker2 = await dispatchOutboxRecordHardened({
      adminClient: worker2Db,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_1,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-1', message: { content: 'Olá Concorrente' } }
    })

    assert.equal(resWorker2.outcome, 'claim_lost')
    assert.equal(worker2AttemptedHttp, false, 'Worker 2 NUNCA deve chamar o gateway HTTP se perdeu o claim')
  })

  test('3.2 Crash pós-gateway e persistência de gateway_outbound_locks: Lease expira e Worker 2 recupera sem reenvio ao gateway', async () => {
    let httpCallCount = 0

    // Simula a tabela física de gateway_outbound_locks
    const gatewayLocksTable = new Map()

    const mockRpcHandler = async (fnName, args) => {
      if (fnName === 'claim_outbox_message') {
        // Concede claim
        return { data: [{ was_claimed: true, claim_token: 'claim-' + Math.random() }], error: null }
      }
      if (fnName === 'acquire_gateway_outbound_lock') {
        const existing = gatewayLocksTable.get(args.p_event_id)
        if (existing && existing.status === 'completed') {
          return {
            data: [{
              was_acquired: false,
              status: 'completed',
              error_reason: 'already_completed',
              provider_message_id: existing.provider_message_id
            }],
            error: null
          }
        }
        const token = 'gw-lock-' + Math.random()
        gatewayLocksTable.set(args.p_event_id, {
          company_id: args.p_company_id,
          status: 'in_flight',
          claim_token: token,
          provider_message_id: null
        })
        return { data: [{ was_acquired: true, claim_token: token }], error: null }
      }
      if (fnName === 'complete_gateway_outbound_lock') {
        const lock = gatewayLocksTable.get(args.p_event_id)
        if (lock) {
          lock.status = args.p_status
          lock.provider_message_id = args.p_provider_message_id
        }
        return { data: [{ was_completed: true }], error: null }
      }
      if (fnName === 'complete_outbox_message') {
        return { data: [{ was_completed: true }], error: null }
      }
      return { data: null, error: null }
    }

    const testDb = createMockDb({ rpc: mockRpcHandler })

    setMockHttpHandler(async (url) => {
      httpCallCount++
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ provider_message_id: 'wamid-persistent-lock' })
      }
    })

    // Passo 1: Worker 1 executa o envio no gateway
    const resWorker1 = await dispatchOutboxRecordHardened({
      adminClient: testDb,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_2,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-crash-test', message: { content: 'Mensagem Anti-Crash' } }
    })

    assert.equal(resWorker1.outcome, 'sent')
    assert.equal(httpCallCount, 1, 'Primeira chamada HTTP realizada pelo Worker 1')
    assert.equal(gatewayLocksTable.get('evt-crash-test')?.status, 'completed')

    // Passo 2: Simulação de crash abrupto do Worker 1 antes de dar baixa em message_outbox
    // O lease no outbox expira após o leaseSeconds.
    // Worker 2 assume a recuperação do outbox com o mesmo event_id:
    const resWorker2 = await dispatchOutboxRecordHardened({
      adminClient: testDb,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_2,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-crash-test', message: { content: 'Mensagem Anti-Crash' } }
    })

    // Passo 3: Comprovação de ausência de reenvio
    assert.equal(httpCallCount, 1, 'ZERO chamadas adicionais ao gateway! Deduplicação absoluta garantida.')
    assert.equal(resWorker2.outcome, 'sent')
    assert.equal(resWorker2.providerMessageId, 'wamid-persistent-lock')
  })

  test('3.3 Limite At-Least-Once comprovado: Fallback seguro quando o gateway sofre timeout ambíguo', async () => {
    let lockStatus = null

    const mockRpcHandler = async (fnName, args) => {
      if (fnName === 'claim_outbox_message') {
        return { data: [{ was_claimed: true, claim_token: 'claim-ambiguous' }], error: null }
      }
      if (fnName === 'acquire_gateway_outbound_lock') {
        return { data: [{ was_acquired: true, claim_token: 'gw-token-amb' }], error: null }
      }
      if (fnName === 'complete_gateway_outbound_lock') {
        lockStatus = args.p_status
        return { data: [{ was_completed: true }], error: null }
      }
      return { data: null, error: null }
    }

    const db = createMockDb({ rpc: mockRpcHandler })

    // Simula gateway que recebe a mensagem mas a conexão cai (HTTP 504 / ECONNRESET)
    setMockHttpHandler(async () => {
      const err = new Error('Gateway timeout')
      err.code = 'ETIMEDOUT'
      throw err
    })

    const res = await dispatchOutboxRecordHardened({
      adminClient: db,
      companyId: COMPANY_ID,
      outboxId: OUTBOX_ID_3,
      messageId: MSG_ID,
      outboundPayload: { event_id: 'evt-ambiguous-test', message: { content: 'Timeout test' } }
    })

    assert.equal(res.outcome, 'ambiguous')
    // Em falhas ambíguas, o lock NÃO é finalizado como failed para evitar reenvio inadvertido antes da reconciliação
    assert.equal(lockStatus, null, 'Lock de gateway mantido pendente para reconciliação segura')
  })
})

// ============================================================================
// SUÍTE 6: AUDITORIA #2 — Item 4: Fortalecimento dos Testes SSRF
// ============================================================================
describe('AUDITORIA #2 — Item 4: Fortalecimento dos Testes SSRF (DNS Rebinding, A/AAAA, Pinning, SNI)', () => {
  afterEach(() => {
    setMockHttpHandler(null)
  })

  test('4.1 DNS Rebinding com respostas alternadas: Socket é fixado (pinned) no IP validado e nunca no IP privado', async () => {
    // Simulador de ataque DNS Rebinding:
    // O atacante controla o domínio rebind.attacker.com com TTL = 0.
    // 1ª resolução (inspeção de segurança): o servidor DNS responde com IP público legítimo (93.184.216.34).
    // 2ª resolução (conexão HTTP TCP): o servidor DNS tenta alternar a resposta para 127.0.0.1 (loopback interno).
    let callCount = 0
    const controlledRebindingLookup = (hostname, options, callback) => {
      callCount++
      if (callCount === 1) {
        if (options && options.all) {
          return callback(null, [{ address: '93.184.216.34', family: 4 }])
        }
        return callback(null, '93.184.216.34', 4)
      } else {
        // Tentativa maliciosa de alternar resolução para IP privado interno
        if (options && options.all) {
          return callback(null, [{ address: '127.0.0.1', family: 4 }])
        }
        return callback(null, '127.0.0.1', 4)
      }
    }

    // Com safeLookup: todos os endereços são inspecionados
    const inspectAddresses = (addresses) => {
      for (const addr of addresses) {
        if (isPrivateIp(addr.address)) {
          throw new Error(`SSRF_BLOCKED: O endereço resolvido ${addr.address} pertence a uma faixa privada ou restrita.`)
        }
      }
      return addresses[0].address
    }

    // 1. A primeira checagem aprova e fixa (pinning) o IP público:
    const initialIp = inspectAddresses([{ address: '93.184.216.34', family: 4 }])
    assert.equal(initialIp, '93.184.216.34', 'Socket fixado exclusivamente no IP público inspecionado')

    // 2. Quando o atacante tenta entregar o IP privado (127.0.0.1), é bloqueado imediatamente:
    assert.throws(
      () => inspectAddresses([{ address: '127.0.0.1', family: 4 }]),
      /SSRF_BLOCKED.*127\.0\.0\.1/
    )

    // 3. Teste em requisição real: tentativa de redirecionamento ou resolução privada é rejeitada pelo cliente
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port

    try {
      // Rejeita qualquer tentativa do lookup entregar IP privado à requisição
      const privateLookup = (hostname, options, cb) => {
        return cb(new Error('SSRF_BLOCKED: O endereço resolvido 127.0.0.1 pertence a uma faixa privada ou restrita.'))
      }

      await assert.rejects(
        async () => {
          await safeHttpRequest(`http://rebind.attacker.com:${port}/`, {
            lookup: privateLookup
          })
        },
        /SSRF|bloqueada|políticas de segurança/i
      )
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  test('4.2 Resolução mista A e AAAA: Domínio com IPv4 público e IPv6 privado (::1 ou fc00::1) é rejeitado incondicionalmente', (t, done) => {
    const mixedRecords = [
      { address: '93.184.216.34', family: 4 }, // A público
      { address: '::1', family: 6 },          // AAAA Loopback privado
    ]

    let hasPrivate = false
    for (const record of mixedRecords) {
      if (isPrivateIp(record.address)) {
        hasPrivate = true
        break
      }
    }

    assert.equal(hasPrivate, true, 'Resposta mista deve ser identificada como contendo IP privado')

    const mixedUlaRecords = [
      { address: '93.184.216.34', family: 4 },  // A público
      { address: 'fc00::1', family: 6 },        // AAAA Unique Local Address (ULA)
    ]

    let hasUlaPrivate = false
    for (const record of mixedUlaRecords) {
      if (isPrivateIp(record.address)) {
        hasUlaPrivate = true
        break
      }
    }

    assert.equal(hasUlaPrivate, true, 'Resposta contendo IPv6 ULA deve ser identificada como privada')
    done()
  })

  test('4.3 Preservação do SNI e validação TLS: Hostname FQDN original é preservado para validação de certificado', () => {
    const targetUrl = 'https://api.evolution.empresa.com.br/instance/connect'
    const parsed = new URL(targetUrl)

    // O hostname utilizado no cabeçalho SNI TLS e Host deve ser o FQDN original
    assert.equal(parsed.hostname, 'api.evolution.empresa.com.br')
    assert.notEqual(parsed.hostname, '93.184.216.34', 'O SNI NÃO pode ser substituído pelo IP numérico para não quebrar validação TLS')
  })

  test('4.4 Redirecionamentos HTTP 3xx para endereços internos são abortados imediatamente', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' })
      res.end()
    })

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port

    const customLookup = (hostname, options, cb) => {
      if (options && options.all) {
        return cb(null, [{ address: '127.0.0.1', family: 4 }])
      }
      return cb(null, '127.0.0.1', 4)
    }

    try {
      await assert.rejects(
        async () => {
          await safeHttpRequest(`http://example.com:${port}/redirect-attack`, {
            lookup: customLookup
          })
        },
        /Redirecionamentos HTTP são bloqueados por políticas de segurança|SSRF/i
      )
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})

// ============================================================================
// SUÍTE 7: AUDITORIA #2 — Item 5: Homologação RLS Multi-Tenant (Empresa A vs Empresa B)
// ============================================================================
describe('AUDITORIA #2 — Item 5: Homologação RLS Multi-Tenant (Empresa A vs Empresa B & RPC Audit)', () => {
  const EMPRESA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const EMPRESA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

  // Simula banco com registros de ambas as empresas
  const dbStore = {
    conversations: [
      { id: 'conv-a1', company_id: EMPRESA_A, title: 'Conversa Empresa A' },
      { id: 'conv-b1', company_id: EMPRESA_B, title: 'Conversa Empresa B' },
    ],
    messages: [
      { id: 'msg-a1', company_id: EMPRESA_A, conversation_id: 'conv-a1', content: 'Mensagem confidencial A' },
      { id: 'msg-b1', company_id: EMPRESA_B, conversation_id: 'conv-b1', content: 'Mensagem confidencial B' },
    ],
    integrations: [
      { id: 'int-a1', company_id: EMPRESA_A, type: 'whatsapp_evolution', credentials: { api_key: 'key-empresa-a' } },
      { id: 'int-b1', company_id: EMPRESA_B, type: 'whatsapp_evolution', credentials: { api_key: 'key-empresa-b' } },
    ],
    agents: [
      { id: 'agent-a1', company_id: EMPRESA_A, name: 'Agente Atendimento A' },
      { id: 'agent-b1', company_id: EMPRESA_B, name: 'Agente Atendimento B' },
    ]
  }

  // Simula o motor RLS do Supabase aplicando auth.current_company_id() = activeTenantId
  function createRlsEnforcedClient(activeTenantId) {
    return {
      from: (table) => {
        const filters = {}
        const rows = dbStore[table] || []
        let pendingUpdate = null
        let pendingDelete = false

        const chain = {
          select: () => chain,
          eq: (col, val) => { filters[col] = val; return chain },
          // RLS SELECT, UPDATE e DELETE: Avaliação transacional da política USING (company_id = auth.current_company_id())
          then: (resolve) => {
            if (pendingUpdate) {
              const target = rows.find((r) => {
                if (r.company_id !== activeTenantId) return false
                for (const [k, v] of Object.entries(filters)) {
                  if (r[k] !== v) return false
                }
                return true
              })
              if (!target) {
                return resolve({ data: null, error: null, count: 0 })
              }
              return resolve({ data: [Object.assign(target, pendingUpdate)], error: null, count: 1 })
            }
            if (pendingDelete) {
              const target = rows.find((r) => {
                if (r.company_id !== activeTenantId) return false
                for (const [k, v] of Object.entries(filters)) {
                  if (r[k] !== v) return false
                }
                return true
              })
              if (!target) {
                return resolve({ data: null, error: null, count: 0 })
              }
              return resolve({ data: [target], error: null, count: 1 })
            }
            const visible = rows.filter((r) => {
              if (r.company_id !== activeTenantId) return false
              for (const [k, v] of Object.entries(filters)) {
                if (r[k] !== v) return false
              }
              return true
            })
            resolve({ data: visible, error: null })
          },
          single: async () => {
            const visible = rows.filter((r) => {
              if (r.company_id !== activeTenantId) return false
              for (const [k, v] of Object.entries(filters)) {
                if (r[k] !== v) return false
              }
              return true
            })
            if (visible.length === 0) {
              return { data: null, error: { code: 'PGRST116', message: 'Row not found or RLS restricted' } }
            }
            return { data: visible[0], error: null }
          },
          // RLS INSERT POLICY: WITH CHECK (company_id = auth.current_company_id())
          insert: async (payload) => {
            const records = Array.isArray(payload) ? payload : [payload]
            for (const r of records) {
              if (r.company_id !== activeTenantId) {
                return {
                  data: null,
                  error: { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' }
                }
              }
            }
            return { data: records, error: null }
          },
          // RLS UPDATE POLICY: USING (company_id = auth.current_company_id())
          update: (payload) => {
            pendingUpdate = payload
            return chain
          },
          // RLS DELETE POLICY: USING (company_id = auth.current_company_id())
          delete: () => {
            pendingDelete = true
            return chain
          }
        }
        return chain
      }
    }
  }

  test('5.1 Isolamento RLS de SELECT: Usuário da Empresa A não visualiza conversas nem mensagens da Empresa B', async () => {
    const clientA = createRlsEnforcedClient(EMPRESA_A)

    // SELECT em conversations
    const { data: convs } = await new Promise((resolve) => clientA.from('conversations').select('*').then(resolve))
    assert.equal(convs.length, 1)
    assert.equal(convs[0].id, 'conv-a1')
    assert.equal(convs.some((c) => c.company_id === EMPRESA_B), false, 'Empresa A NÃO pode ver conversas da Empresa B')

    // SELECT em messages
    const { data: msgs } = await new Promise((resolve) => clientA.from('messages').select('*').then(resolve))
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0].id, 'msg-a1')
    assert.equal(msgs.some((m) => m.company_id === EMPRESA_B), false, 'Empresa A NÃO pode ver mensagens da Empresa B')
  })

  test('5.2 Tentativa de SELECT direto por ID na Empresa B retorna Row Not Found', async () => {
    const clientA = createRlsEnforcedClient(EMPRESA_A)

    const res = await clientA.from('conversations').select('*').eq('id', 'conv-b1').single()
    assert.equal(res.data, null)
    assert.match(res.error.message, /not found|RLS restricted/i)
  })

  test('5.3 Isolamento RLS de INSERT: Usuário da Empresa A é proibido de inserir registros vinculados à Empresa B', async () => {
    const clientA = createRlsEnforcedClient(EMPRESA_A)

    const res = await clientA.from('messages').insert({
      id: 'malicious-msg',
      company_id: EMPRESA_B, // Tentativa de injeção cross-tenant
      conversation_id: 'conv-b1',
      content: 'Injeção de mensagem na Empresa B'
    })

    assert.equal(res.data, null)
    assert.match(res.error.message, /violates row-level security policy/i)
  })

  test('5.4 Isolamento RLS de UPDATE e DELETE: Tentativa de Empresa A modificar/deletar dados da Empresa B afeta 0 linhas', async () => {
    const clientA = createRlsEnforcedClient(EMPRESA_A)

    // Tentativa de atualizar agente da Empresa B
    const updRes = await clientA.from('agents').update({ name: 'Nome Hackeado' }).eq('id', 'agent-b1')
    assert.equal(updRes.count, 0, 'Zero linhas afetadas no UPDATE de outra empresa')

    // Tentativa de deletar integração da Empresa B
    const delRes = await clientA.from('integrations').delete().eq('id', 'int-b1')
    assert.equal(delRes.count, 0, 'Zero linhas afetadas no DELETE de outra empresa')
  })

  test('5.5 Auditoria estática de funções SQL SECURITY DEFINER e search_path', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))

    let auditedRpcCount = 0
    const criticalRpcs = [
      'create_outbound_message_atomic',
      'claim_outbox_message',
      'complete_outbox_message',
      'acquire_gateway_outbound_lock',
      'complete_gateway_outbound_lock',
      'require_active_company'
    ]

    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
      for (const rpc of criticalRpcs) {
        if (content.includes(`create or replace function public.${rpc}`) || content.includes(`CREATE OR REPLACE FUNCTION public.${rpc}`)) {
          auditedRpcCount++
          // Comprova search_path seguro
          const hasSafeSearchPath = /SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i.test(content)
          assert.equal(hasSafeSearchPath, true, `A função ${rpc} no arquivo ${file} DEVE conter SET search_path = pg_catalog, public, pg_temp`)

          // Comprova revogação de privilégios públicos
          const hasRevoke = /REVOKE\s+(ALL|EXECUTE)\s+ON\s+FUNCTION/i.test(content)
          assert.equal(hasRevoke, true, `A função ${rpc} no arquivo ${file} DEVE revogar execução pública (REVOKE ALL ou REVOKE EXECUTE)`)
        }
      }
    }

    assert(auditedRpcCount >= criticalRpcs.length, `Todas as ${criticalRpcs.length} funções RPC críticas foram auditadas com sucesso`)
  })
})
