import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  estimateLlmCostUsd,
  evaluateQuotaStatus,
  getTenantGovernanceReport,
  traceEventCorrelation,
} from '@/lib/services/platform/tenant-governance'
import { logAgentRun } from '@/lib/services/agent/engine'

const PROJECT_ROOT = process.cwd()

test('1. Migration 3B existe e define colunas e índices aditivos sem alterações destrutivas', () => {
  const sqlPath = path.join(
    PROJECT_ROOT,
    'supabase/migrations/2026111203_enterprise_governance_3b.sql'
  )
  assert.equal(fs.existsSync(sqlPath), true, 'Migration 3B deve existir')
  const sql = fs.readFileSync(sqlPath, 'utf8')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS correlation_event_id TEXT/i)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS webhook_event_id UUID/i)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC\(12,6\)/i)
  assert.match(sql, /idx_agent_runs_correlation_event/i)
  assert.match(sql, /idx_agent_runs_company_created/i)
  assert.match(sql, /idx_messages_company_created/i)
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i)
})

test('2. estimateLlmCostUsd e evaluateQuotaStatus calculam custos e limiares soft-quota corretamente', () => {
  // gpt-4o-mini: $0.15/1M in, $0.60/1M out
  const miniCost = estimateLlmCostUsd('openai', 'gpt-4o-mini-2024-07-18', 1000, 500)
  // (1000/1e6)*0.15 + (500/1e6)*0.60 = 0.00015 + 0.0003 = 0.00045
  assert.equal(miniCost, 0.00045)

  // gemini-2.5-flash: $0.30/1M in, $2.50/1M out
  const geminiCost = estimateLlmCostUsd('gemini', 'gemini-2.5-flash', 2000, 1000)
  // (2000/1e6)*0.30 + (1000/1e6)*2.50 = 0.0006 + 0.0025 = 0.0031
  assert.equal(geminiCost, 0.0031)

  assert.equal(evaluateQuotaStatus(500, 1000).status, 'ok')
  assert.equal(evaluateQuotaStatus(800, 1000).status, 'warning')
  assert.equal(evaluateQuotaStatus(1000, 1000).status, 'exceeded')
  assert.equal(evaluateQuotaStatus(1250, 1000).usagePercent, 125)
  assert.equal(evaluateQuotaStatus(50, 0).status, 'ok')
})

test('3. logAgentRun persiste correlação 3B e faz fallback automático em erro 42703 pré-migration', async () => {
  const insertedPayloads: any[] = []
  const mockSupabase3b = {
    from(table: string) {
      assert.equal(table, 'agent_runs')
      return {
        async insert(payload: any) {
          insertedPayloads.push(payload)
          return { error: null }
        },
      }
    },
  }

  await logAgentRun(mockSupabase3b, {
    companyId: '11111111-1111-4111-8111-111111111111',
    agentId: '22222222-2222-4222-8222-222222222222',
    conversationId: '33333333-3333-4333-8333-333333333333',
    status: 'success',
    provider: 'openai',
    model: 'gpt-4o-mini',
    usageMetrics: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    duration: 420,
    metadata: { orchestration: { trigger_event_id: 'evt-123' } },
    correlationEventId: 'evt-123',
    webhookEventId: '44444444-4444-4444-8444-444444444444',
    estimatedCostUsd: 0.00045,
  })

  assert.equal(insertedPayloads.length, 1)
  assert.equal(insertedPayloads[0].correlation_event_id, 'evt-123')
  assert.equal(insertedPayloads[0].webhook_event_id, '44444444-4444-4444-8444-444444444444')
  assert.equal(insertedPayloads[0].estimated_cost_usd, 0.00045)

  // Agora simula ambiente pré-migration retornando 42703 na primeira tentativa
  const fallbackPayloads: any[] = []
  let callCount = 0
  const mockSupabasePre3b = {
    from() {
      return {
        async insert(payload: any) {
          callCount += 1
          fallbackPayloads.push(payload)
          if (callCount === 1) {
            return {
              error: {
                code: '42703',
                message: 'column "correlation_event_id" of relation "agent_runs" does not exist',
              },
            }
          }
          return { error: null }
        },
      }
    },
  }

  await logAgentRun(mockSupabasePre3b, {
    companyId: '11111111-1111-4111-8111-111111111111',
    agentId: '22222222-2222-4222-8222-222222222222',
    conversationId: '33333333-3333-4333-8333-333333333333',
    status: 'success',
    provider: 'openai',
    model: 'gpt-4o-mini',
    usageMetrics: { prompt_tokens: 500, completion_tokens: 250, total_tokens: 750 },
    duration: 310,
    metadata: { orchestration: { trigger_event_id: 'evt-legacy' } },
    correlationEventId: 'evt-legacy',
    webhookEventId: '44444444-4444-4444-8444-444444444444',
    estimatedCostUsd: 0.000225,
  })

  assert.equal(fallbackPayloads.length, 2)
  assert.equal('correlation_event_id' in fallbackPayloads[1], false)
  assert.equal('webhook_event_id' in fallbackPayloads[1], false)
  assert.equal('estimated_cost_usd' in fallbackPayloads[1], false)
  assert.equal(fallbackPayloads[1].metadata.orchestration.trigger_event_id, 'evt-legacy')
})

function buildMockQuery(rows: any[], opts?: { failWith42703OnSelect?: RegExp }) {
  return {
    _selectCols: '*',
    select(cols: string) {
      this._selectCols = cols
      return this
    },
    eq(col: string, val: any) {
      rows = rows.filter((r) => r?.[col] === val)
      return this
    },
    gte() {
      return this
    },
    order() {
      return this
    },
    limit(n: number) {
      rows = rows.slice(0, n)
      return this
    },
    then(resolve: any) {
      if (opts?.failWith42703OnSelect && opts.failWith42703OnSelect.test(this._selectCols)) {
        return resolve({
          data: null,
          error: {
            code: '42703',
            message: 'column agent_runs.correlation_event_id does not exist',
          },
        })
      }
      return resolve({ data: rows, error: null })
    },
  }
}

test('4. getTenantGovernanceReport consolida custos, tokens, latência, fallbacks e alertas soft-quota (inclusive pré-3B)', async () => {
  const companies = [
    {
      id: 'comp-a',
      name: 'Empresa Alpha',
      slug: 'alpha',
      plan_tier: 'pro',
      status: 'active',
      company_limits: [{ max_monthly_messages: 100 }],
    },
    {
      id: 'comp-b',
      name: 'Empresa Beta',
      slug: 'beta',
      plan_tier: 'trial',
      status: 'active',
      company_limits: [{ max_monthly_messages: 10 }],
    },
  ]
  const messages = [
    ...Array.from({ length: 85 }, () => ({ company_id: 'comp-a', sender_type: 'agent' })),
    ...Array.from({ length: 12 }, () => ({ company_id: 'comp-b', sender_type: 'customer' })),
  ]
  const agentRuns = [
    {
      id: 'run-1',
      company_id: 'comp-a',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'success',
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      duration_ms: 400,
      metadata: { orchestration: { fallback_catalog_triggered: true } },
      created_at: new Date().toISOString(),
    },
    {
      id: 'run-2',
      company_id: 'comp-b',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      status: 'error',
      prompt_tokens: 2000,
      completion_tokens: 0,
      total_tokens: 2000,
      duration_ms: 1200,
      metadata: {},
      created_at: new Date().toISOString(),
    },
  ]
  const outbox = [
    { id: 'ob-1', company_id: 'comp-a', status: 'sent', attempts: 1 },
    { id: 'ob-2', company_id: 'comp-b', status: 'failed', attempts: 5 },
  ]

  const mockAdmin = {
    from(table: string) {
      if (table === 'companies') return buildMockQuery(companies)
      if (table === 'messages') return buildMockQuery(messages)
      if (table === 'agent_runs') {
        return buildMockQuery(agentRuns, {
          failWith42703OnSelect: /correlation_event_id/,
        })
      }
      if (table === 'message_outbox') return buildMockQuery(outbox)
      return buildMockQuery([])
    },
  }

  const report = await getTenantGovernanceReport({ adminClient: mockAdmin, daysWindow: 30 })

  assert.equal(report.quotaEnforcementMode, 'soft_alert')
  assert.equal(report.schemaWarnings.length, 1)
  assert.equal(report.totals.warningTenantsCount, 1)
  assert.equal(report.totals.exceededTenantsCount, 1)
  assert.equal(report.totals.totalFallbacks, 1)
  assert.equal(report.totals.totalErrorsAndTimeouts, 1)
  assert.equal(report.totals.totalTokens, 3500)

  const alpha = report.tenants.find((t) => t.companyId === 'comp-a')!
  assert.equal(alpha.quotaStatus, 'warning')
  assert.equal(alpha.quotaUsagePercent, 85)
  assert.equal(alpha.fallbackCount, 1)
  assert.equal(alpha.estimatedCostUsd, 0.00045)
  assert.equal(alpha.outboxSent, 1)

  const beta = report.tenants.find((t) => t.companyId === 'comp-b')!
  assert.equal(beta.quotaStatus, 'exceeded')
  assert.equal(beta.quotaUsagePercent, 120)
  assert.equal(beta.errorRuns, 1)
  assert.equal(beta.outboxFailed, 1)
})

test('5. traceEventCorrelation reconstrói cadeia completa webhook -> agent_run -> message -> outbox -> lock', async () => {
  const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const whId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const msgId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const obId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const eventId = 'wamid.HBgNNTUxMTk5OTk'

  const tables: Record<string, any[]> = {
    webhook_events: [
      {
        id: whId,
        company_id: 'comp-a',
        event_id: eventId,
        status: 'processed',
        attempts: 1,
        created_at: '2026-11-12T10:00:00.000Z',
        processed_at: '2026-11-12T10:00:01.500Z',
      },
    ],
    agent_runs: [
      {
        id: runId,
        company_id: 'comp-a',
        agent_id: 'agent-1',
        conversation_id: convId,
        status: 'success',
        provider: 'openai',
        model: 'gpt-4o-mini',
        prompt_tokens: 500,
        completion_tokens: 150,
        total_tokens: 650,
        duration_ms: 480,
        correlation_event_id: eventId,
        webhook_event_id: whId,
        estimated_cost_usd: 0.000165,
        metadata: { orchestration: { fallback_catalog_triggered: false, trigger_event_id: eventId } },
        created_at: '2026-11-12T10:00:00.400Z',
      },
    ],
    messages: [
      {
        id: msgId,
        company_id: 'comp-a',
        conversation_id: convId,
        sender_type: 'agent',
        content: 'Olá! Segue o orçamento.',
        external_id: 'wa-provider-123',
        metadata: { trigger_event_id: eventId, delivery_status: 'sent' },
        created_at: '2026-11-12T10:00:00.900Z',
      },
    ],
    message_outbox: [
      {
        id: obId,
        company_id: 'comp-a',
        conversation_id: convId,
        message_id: msgId,
        idempotency_key: `agent-reply-${eventId}`,
        status: 'sent',
        attempts: 1,
        provider_message_id: 'wa-provider-123',
        created_at: '2026-11-12T10:00:01.000Z',
        sent_at: '2026-11-12T10:00:01.400Z',
      },
    ],
    gateway_outbound_locks: [
      {
        company_id: 'comp-a',
        idempotency_key: `agent-reply-${eventId}`,
        status: 'sent',
        provider_message_id: 'wa-provider-123',
        updated_at: '2026-11-12T10:00:01.350Z',
      },
    ],
  }

  const mockAdmin = {
    from(table: string) {
      return buildMockQuery(tables[table] || [])
    },
  }

  const trace = await traceEventCorrelation(eventId, { adminClient: mockAdmin })

  assert.equal(trace.found, true)
  assert.equal(trace.resolvedIds.eventId, eventId)
  assert.equal(trace.resolvedIds.webhookEventId, whId)
  assert.equal(trace.resolvedIds.conversationId, convId)
  assert.equal(trace.resolvedIds.outboxId, obId)
  assert.equal(trace.resolvedIds.providerMessageId, 'wa-provider-123')
  assert.equal(trace.timeline.length, 6)
  assert.deepEqual(
    trace.timeline.map((t) => t.stage),
    [
      'webhook_received',
      'agent_run',
      'message_persisted',
      'outbox_queued',
      'gateway_lock',
      'whatsapp_dispatched',
    ]
  )
})

test('6. message-engine propaga triggerEventId e webhookEventId sem bloquear quota excedida', () => {
  const msgEngineSrc = fs.readFileSync(
    path.join(PROJECT_ROOT, 'lib/services/message-engine.ts'),
    'utf8'
  )
  assert.match(msgEngineSrc, /triggerEventId:\s*cleanEventId/)
  assert.match(msgEngineSrc, /webhookEventId:\s*webhookEventRowId/)
  // Garante política soft-quota sem introdução de bloqueio duro no motor
  assert.doesNotMatch(msgEngineSrc, /QUOTA_EXCEEDED/i)
})
