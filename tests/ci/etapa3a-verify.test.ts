// @ts-nocheck
import fs from 'node:fs'
import path from 'node:path'
import { describe, test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key'

import { setMockSupabaseClient } from './mocks/supabase-mock.mjs'
import {
  recordCronExecutionLog,
  getOperationalTelemetry,
  reprocessDeadLetterOutboxItem,
  reprocessDeadLetterWebhookEvent,
} from '@/lib/services/platform/observability'
import {
  getAdminDashboardMetrics,
  humanizeAuditAction,
  humanizeAuditDetails,
} from '@/lib/services/platform/admin-metrics'
import { GET as cronGet } from '@/app/api/cron/outbox-worker/route'
import { setMockHttpHandler } from '@/lib/services/n8n-internal'

const COMPANY_ACTIVE_ID = '11111111-1111-1111-1111-111111111111'
const COMPANY_SUSPENDED_ID = '22222222-2222-2222-2222-222222222222'
const CONV_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
const MSG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
const OUTBOX_FAILED_ID = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
const OUTBOX_SUPPRESSED_ID = 'cccccccc-cccc-cccc-cccc-ccccccccccc2'
const OUTBOX_LOCKED_ID = 'cccccccc-cccc-cccc-cccc-ccccccccccc3'
const WEBHOOK_FAILED_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddd1'
const WEBHOOK_LEGACY_ID = 'dddddddd-dddd-dddd-dddd-ddddddddddd2'

function create3AMockSupabase(opts: { missingCronTable?: boolean; agentStatus?: string } = {}) {
  const now = Date.now()
  const state = {
    cronLogs: [
      {
        id: 'eeee0000-0000-0000-0000-000000000001',
        worker_name: 'outbox-worker',
        method: 'GET',
        status: 'success',
        http_status: 200,
        duration_ms: 420,
        outbox_processed: 2,
        outbox_succeeded: 2,
        outbox_failed: 0,
        outbox_suppressed: 0,
        outbox_deferred: 0,
        webhook_processed: 1,
        webhook_recovered_ingest: 0,
        webhook_recovered_autonomous: 1,
        webhook_deferred: 0,
        webhook_failed: 0,
        error_message: null,
        details: {},
        created_at: new Date(now - 2 * 60 * 1000).toISOString(),
      },
      {
        id: 'eeee0000-0000-0000-0000-000000000002',
        worker_name: 'outbox-worker',
        method: 'POST',
        status: 'partial',
        http_status: 200,
        duration_ms: 980,
        outbox_processed: 2,
        outbox_succeeded: 1,
        outbox_failed: 1,
        outbox_suppressed: 0,
        outbox_deferred: 0,
        webhook_processed: 0,
        webhook_recovered_ingest: 0,
        webhook_recovered_autonomous: 0,
        webhook_deferred: 0,
        webhook_failed: 0,
        error_message: null,
        details: {},
        created_at: new Date(now - 5 * 60 * 1000).toISOString(),
      },
    ],
    companies: new Map([
      [
        COMPANY_ACTIVE_ID,
        { id: COMPANY_ACTIVE_ID, name: 'Sumel Confeitaria', slug: 'sumel', status: 'active', plan_tier: 'pro', created_at: new Date(now - 86400_000).toISOString() },
      ],
      [
        COMPANY_SUSPENDED_ID,
        { id: COMPANY_SUSPENDED_ID, name: 'Tenant Suspenso', slug: 'suspenso', status: 'suspended', plan_tier: 'starter', created_at: new Date(now - 86400_000).toISOString() },
      ],
    ]),
    outbox: new Map([
      [
        OUTBOX_FAILED_ID,
        {
          id: OUTBOX_FAILED_ID,
          company_id: COMPANY_ACTIVE_ID,
          conversation_id: CONV_ID,
          message_id: MSG_ID,
          channel: 'whatsapp',
          recipient: '5511999990001',
          payload: { recipient: '5511999990001', text: 'Olá de novo!', channel: 'whatsapp', metadata: { event_id: 'evt-retry-1' } },
          status: 'failed',
          attempts: 5,
          max_attempts: 5,
          locked_until: null,
          claim_token: null,
          claim_version: 2,
          last_error: 'max_attempts_reached',
          created_at: new Date(now - 600_000).toISOString(),
          updated_at: new Date(now - 120_000).toISOString(),
        },
      ],
      [
        OUTBOX_SUPPRESSED_ID,
        {
          id: OUTBOX_SUPPRESSED_ID,
          company_id: COMPANY_SUSPENDED_ID,
          conversation_id: CONV_ID,
          message_id: MSG_ID,
          channel: 'whatsapp',
          recipient: '5511999990002',
          payload: { recipient: '5511999990002', text: 'Bloqueado' },
          status: 'suppressed',
          attempts: 1,
          max_attempts: 5,
          locked_until: null,
          last_error: 'Empresa suspensa',
          created_at: new Date(now - 500_000).toISOString(),
          updated_at: new Date(now - 100_000).toISOString(),
        },
      ],
      [
        OUTBOX_LOCKED_ID,
        {
          id: OUTBOX_LOCKED_ID,
          company_id: COMPANY_ACTIVE_ID,
          conversation_id: CONV_ID,
          message_id: MSG_ID,
          channel: 'whatsapp',
          recipient: '5511999990003',
          payload: { recipient: '5511999990003', text: 'Em voo' },
          status: 'processing',
          attempts: 1,
          max_attempts: 5,
          locked_until: new Date(now + 60_000).toISOString(),
          last_error: null,
          created_at: new Date(now - 10_000).toISOString(),
          updated_at: new Date(now - 10_000).toISOString(),
        },
      ],
    ]),
    webhookEvents: new Map([
      [
        WEBHOOK_FAILED_ID,
        {
          id: WEBHOOK_FAILED_ID,
          company_id: COMPANY_ACTIVE_ID,
          event_id: 'evt-dlq-001',
          event_type: 'message.received',
          status: 'processed',
          autonomous_status: 'failed',
          autonomous_attempts: 3,
          autonomous_max_attempts: 3,
          recovery_attempts: 0,
          autonomous_locked_until: null,
          autonomous_last_error: 'max_autonomous_attempts_reached',
          error_message: null,
          conversation_id: CONV_ID,
          message_id: MSG_ID,
          payload: {
            event_id: 'evt-dlq-001',
            event_type: 'message.received',
            customer: { phone: '5511999990001', name: 'Maria' },
            message: { id: 'ext-1', text: 'Quero um bolo', sender_type: 'customer' },
          },
          created_at: new Date(now - 300_000).toISOString(),
          updated_at: new Date(now - 60_000).toISOString(),
        },
      ],
      [
        WEBHOOK_LEGACY_ID,
        {
          id: WEBHOOK_LEGACY_ID,
          company_id: COMPANY_ACTIVE_ID,
          event_id: 'evt-legacy-000',
          event_type: 'message.received',
          status: 'error',
          autonomous_status: 'failed',
          autonomous_attempts: 0,
          autonomous_max_attempts: 3,
          recovery_attempts: 3,
          autonomous_locked_until: null,
          autonomous_last_error: 'historical_backfill_prior_to_2b',
          error_message: 'old error',
          conversation_id: null,
          message_id: null,
          payload: {},
          created_at: new Date(now - 10 * 86400_000).toISOString(),
          updated_at: new Date(now - 10 * 86400_000).toISOString(),
        },
      ],
    ]),
    gatewayLocks: [
      { id: 'lock-1', status: 'in_flight', locked_until: new Date(now + 45_000).toISOString() },
    ],
    agentRuns: [
      { id: 'run-1', status: 'success', duration_ms: 1500, created_at: new Date(now - 60_000).toISOString() },
      { id: 'run-2', status: 'success', duration_ms: 2500, created_at: new Date(now - 50_000).toISOString() },
      { id: 'run-3', status: 'error', duration_ms: 500, created_at: new Date(now - 40_000).toISOString() },
    ],
    conversationStatus: 'human',
  }

  function makeChain(table: string) {
    const filters: Array<(row: any) => boolean> = []
    let limitCount: number | null = null
    let orderCol: string | null = null
    let orderAsc = true
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payloadData: any = null

    const getSourceRows = (): any[] => {
      if (table === 'cron_execution_logs') return [...state.cronLogs]
      if (table === 'companies') return Array.from(state.companies.values())
      if (table === 'message_outbox') return Array.from(state.outbox.values())
      if (table === 'webhook_events') return Array.from(state.webhookEvents.values())
      if (table === 'gateway_outbound_locks') return [...state.gatewayLocks]
      if (table === 'agent_runs') return [...state.agentRuns]
      if (table === 'messages') return [{ id: MSG_ID, company_id: COMPANY_ACTIVE_ID, conversation_id: CONV_ID, created_at: new Date().toISOString() }]
      if (table === 'conversations') return [{ id: CONV_ID, company_id: COMPANY_ACTIVE_ID, status: state.conversationStatus, channel: 'whatsapp', agent_id: 'a1', customer_id: 'c1', customers: { id: 'c1', phone: '5511999990001', name: 'Maria' } }]
      if (table === 'agents') return [{ id: 'a1', is_active: true }]
      if (table === 'integrations') {
        return [{
          id: 'int-1',
          company_id: COMPANY_ACTIVE_ID,
          type: 'n8n',
          status: 'active',
          config: { webhook_url: 'https://example.com/webhook/send' },
          credentials: { webhook_secret: 'sec-123' },
        }]
      }
      if (table === 'platform_audit_logs') return []
      return []
    }

    const execute = async () => {
      if (table === 'cron_execution_logs' && opts.missingCronTable) {
        return { data: null, error: { code: '42P01', message: 'relation "public.cron_execution_logs" does not exist' } }
      }

      if (mode === 'insert') {
        if (table === 'cron_execution_logs') {
          const inserted = { id: `cron-${state.cronLogs.length + 1}`, created_at: new Date().toISOString(), ...payloadData }
          state.cronLogs.unshift(inserted)
          return { data: inserted, error: null }
        }
        return { data: payloadData, error: null }
      }

      if (mode === 'update') {
        const rows = getSourceRows().filter((r) => filters.every((fn) => fn(r)))
        for (const r of rows) {
          Object.assign(r, payloadData)
        }
        return { data: rows, error: null }
      }

      let rows = getSourceRows().filter((r) => filters.every((fn) => fn(r)))
      if (orderCol) {
        rows.sort((a, b) => {
          const av = String(a[orderCol!] || '')
          const bv = String(b[orderCol!] || '')
          return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av)
        })
      }
      if (limitCount !== null) rows = rows.slice(0, limitCount)
      return { data: rows, error: null }
    }

    const chain: any = {
      select() { return chain },
      insert(d: any) { mode = 'insert'; payloadData = d; return chain },
      update(d: any) { mode = 'update'; payloadData = d; return chain },
      eq(col: string, val: any) { filters.push((r) => r[col] === val); return chain },
      in(col: string, vals: any[]) { filters.push((r) => vals.includes(r[col])); return chain },
      gt(col: string, val: any) { filters.push((r) => String(r[col] || '') > String(val)); return chain },
      order(col: string, o?: { ascending?: boolean }) { orderCol = col; orderAsc = o?.ascending !== false; return chain },
      limit(n: number) { limitCount = n; return chain },
      async maybeSingle() {
        const res = await execute()
        if (res.error) return res
        const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
        return { data: rows[0] || null, error: null }
      },
      async single() {
        const res = await execute()
        if (res.error) return res
        const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
        if (!rows[0]) return { data: null, error: { code: 'PGRST116', message: 'not found' } }
        return { data: rows[0], error: null }
      },
      then(resolve: any, reject: any) {
        return execute().then(resolve, reject)
      },
    }
    return chain
  }

  return {
    state,
    from(table: string) {
      return makeChain(table)
    },
    async rpc(name: string, args: any) {
      if (name === 'claim_stalled_outbox_batch') return { data: [], error: null }
      if (name === 'claim_stalled_webhook_events_batch') return { data: [], error: null }
      if (name === 'acquire_conversation_processing_lock') return { data: [{ acquired: true, lock_token: 'lock-tok-1' }], error: null }
      if (name === 'release_conversation_processing_lock') return { data: true, error: null }
      if (name === 'complete_webhook_autonomous_event') {
        const row = state.webhookEvents.get(args.p_webhook_event_id)
        if (row) {
          row.autonomous_status = args.p_autonomous_status
          row.autonomous_last_error = args.p_last_error ?? null
          row.autonomous_locked_until = null
          row.autonomous_claim_token = null
        }
        return { data: true, error: null }
      }
      if (name === 'claim_outbox_message') {
        const row = state.outbox.get(args.p_outbox_id)
        if (!row) return { data: [{ was_claimed: false, error_reason: 'outbox_not_found' }], error: null }
        if (row.attempts >= row.max_attempts) return { data: [{ was_claimed: false, error_reason: 'max_attempts_reached' }], error: null }
        row.status = 'processing'
        row.claim_token = 'claim-tok-1'
        row.claim_version += 1
        row.attempts += 1
        return {
          data: [{
            was_claimed: true,
            claim_token: row.claim_token,
            claim_version: row.claim_version,
            status: row.status,
            attempts: row.attempts,
            payload: row.payload,
            message_id: row.message_id,
          }],
          error: null,
        }
      }
      if (name === 'complete_outbox_message') {
        const row = state.outbox.get(args.p_outbox_id)
        if (row) {
          row.status = args.p_status
          row.last_error = args.p_last_error ?? null
          row.locked_until = null
        }
        return { data: [{ was_completed: true, current_status: args.p_status }], error: null }
      }
      if (name === 'acquire_gateway_outbound_lock') {
        return { data: [{ was_acquired: true, claim_token: 'gw-claim-1', status: 'in_flight' }], error: null }
      }
      if (name === 'complete_gateway_outbound_lock') {
        return { data: true, error: null }
      }
      return { data: null, error: null }
    },
  }
}

describe('ETAPA 3A — Observabilidade Operacional, Cron Logs & DLQ', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret-3a'
    setMockHttpHandler(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ provider_message_id: 'wamid.3a.ok' }),
      json: async () => ({ provider_message_id: 'wamid.3a.ok' }),
    }))
  })

  afterEach(() => {
    setMockSupabaseClient(null)
    setMockHttpHandler(null)
  })

  test('1. Migration SQL 2026111202 garante tabela, RLS fail-closed e índices de DLQ', () => {
    const sqlPath = path.resolve('supabase/migrations/2026111202_enterprise_observability_3a.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.cron_execution_logs/i)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/i)
    assert.match(sql, /public\.is_platform_admin\(\)/i)
    assert.match(sql, /REVOKE ALL ON public\.cron_execution_logs FROM PUBLIC, anon/i)
    assert.match(sql, /GRANT ALL ON public\.cron_execution_logs TO service_role/i)
    assert.match(sql, /idx_message_outbox_dead_letter/i)
    assert.match(sql, /idx_webhook_events_dead_letter/i)
  })

  test('2. recordCronExecutionLog degrada graciosamente quando cron_execution_logs não existe (42P01) e sanitiza segredos quando existe', async () => {
    const missingMock = create3AMockSupabase({ missingCronTable: true })
    const resMissing = await recordCronExecutionLog(
      { method: 'GET', httpStatus: 200, durationMs: 120 },
      { adminClient: missingMock }
    )
    assert.equal(resMissing.recorded, false)
    assert.equal(resMissing.skipped, true)

    const validMock = create3AMockSupabase()
    const resPartial = await recordCronExecutionLog(
      {
        method: 'POST',
        httpStatus: 200,
        durationMs: 350,
        outbox: { processed: 3, succeeded: 2, failed: 1 },
        webhookRecovery: { processed: 1, recovered_autonomous: 1, failed: 0 },
        details: { api_key: 'dummy_secret_value_for_redaction_test', note: 'ok' },
      },
      { adminClient: validMock }
    )
    assert.equal(resPartial.recorded, true)
    assert.equal(validMock.state.cronLogs[0].status, 'partial')
    assert.equal(validMock.state.cronLogs[0].details.api_key, '[REDACTED]')
  })

  test('3. Rota GET /api/cron/outbox-worker grava cron_execution_logs mesmo em ambiente sem falhas', async () => {
    const mockDb = create3AMockSupabase()
    setMockSupabaseClient(mockDb)

    const beforeCount = mockDb.state.cronLogs.length
    const req = new Request('https://app.elleveeia.com.br/api/cron/outbox-worker', {
      method: 'GET',
      headers: { authorization: 'Bearer test-cron-secret-3a' },
    })

    const res = await cronGet(req)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.success, true)
    assert.equal(mockDb.state.cronLogs.length, beforeCount + 1)
    assert.equal(mockDb.state.cronLogs[0].method, 'GET')
    assert.equal(mockDb.state.cronLogs[0].http_status, 200)
  })

  test('4. getOperationalTelemetry e getAdminDashboardMetrics calculam saúde real, locks, latência, SLA e filtram backfill legado da DLQ', async () => {
    const mockDb = create3AMockSupabase()
    const telemetry = await getOperationalTelemetry({ adminClient: mockDb })

    assert.equal(telemetry.cronLogsAvailable, true)
    assert.equal(telemetry.cronStats.totalRunsWindow, 2)
    assert.equal(telemetry.cronStats.successRatePercent, 75) // (1 success + 0.5 partial) / 2
    assert.equal(telemetry.cronStats.avgDurationMs, 700)
    assert.equal(telemetry.queueHealth.activeGatewayLocks, 1)
    // Outbox failed (1) + Webhook failed post-2B (1); legacy backfill excluded
    assert.equal(telemetry.queueHealth.deadLetterOutboxCount, 1)
    assert.equal(telemetry.queueHealth.deadLetterWebhookCount, 1)
    assert.equal(telemetry.queueHealth.deadLetterTotal, 2)
    assert.equal(telemetry.dlqOutbox[0].companyName, 'Sumel Confeitaria')
    assert.equal(telemetry.dlqWebhooks[0].eventId, 'evt-dlq-001')
    assert.equal(telemetry.llmHealth.averageLatencySeconds, 1.5) // (1500+2500+500)/3 = 1500ms = 1.5s

    const metrics = await getAdminDashboardMetrics({ adminClient: mockDb })
    assert.equal(metrics.agents.averageLatencySeconds, 1.5)
    assert.equal(metrics.health.activeGatewayLocks, 1)
    assert.equal(metrics.health.deadLetterCount, 2)
    assert.equal(metrics.health.workerStatus, 'warning')
  })

  test('5. Reprocessamento manual de DLQ bloqueia itens suprimidos/em voo e reenvia outbox/webhook elegíveis com segurança', async () => {
    const mockDb = create3AMockSupabase()

    const suppressedRes = await reprocessDeadLetterOutboxItem(OUTBOX_SUPPRESSED_ID, { adminClient: mockDb })
    assert.equal(suppressedRes.success, false)
    assert.match(suppressedRes.error || '', /suprimida/i)

    const lockedRes = await reprocessDeadLetterOutboxItem(OUTBOX_LOCKED_ID, { adminClient: mockDb })
    assert.equal(lockedRes.success, false)
    assert.match(lockedRes.error || '', /lease vigente/i)

    const retryRes = await reprocessDeadLetterOutboxItem(OUTBOX_FAILED_ID, { adminClient: mockDb })
    assert.equal(retryRes.success, true, retryRes.error)
    assert.equal(retryRes.outcome, 'dispatched')
    assert.equal(mockDb.state.outbox.get(OUTBOX_FAILED_ID)?.status, 'sent')
    assert.equal(mockDb.state.outbox.get(OUTBOX_FAILED_ID)?.max_attempts, 6)

    // Webhook replay quando conversa está em 'human' fecha o ciclo com 'skipped' sem duplicar envio da IA
    const whRes = await reprocessDeadLetterWebhookEvent(WEBHOOK_FAILED_ID, { adminClient: mockDb })
    assert.equal(whRes.success, true, whRes.error)
    assert.equal(whRes.outcome, 'human_mode_active')
    assert.equal(mockDb.state.webhookEvents.get(WEBHOOK_FAILED_ID)?.autonomous_status, 'skipped')
  })

  test('6. humanizeAuditAction e humanizeAuditDetails traduzem ações de DLQ e Cron sem undefined', () => {
    assert.equal(humanizeAuditAction('dlq.outbox_reprocessed').label, 'Reenvio DLQ')
    assert.equal(humanizeAuditAction('dlq.webhook_reprocessed').label, 'Replay DLQ')
    assert.equal(humanizeAuditAction('cron.manual_triggered').label, 'Worker Cron')

    const d1 = humanizeAuditDetails('dlq.outbox_reprocessed', { outbox_id: 'abc-1' })
    assert.match(d1, /Outbox abc-1 reprocessada manualmente/)
    assert.doesNotMatch(d1, /undefined/)

    const d2 = humanizeAuditDetails('cron.manual_triggered', { mode: 'manual', triggered_by: 'ops@ellevee.com' })
    assert.match(d2, /Reconciliação manual acionada por ops@ellevee\.com/)
    assert.doesNotMatch(d2, /undefined/)
  })
})
