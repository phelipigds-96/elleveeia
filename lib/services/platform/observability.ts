import { sanitizePayload } from './audit'
import { requireActiveCompany, TenantAccessError } from './tenant-access'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CronExecutionMethod = 'GET' | 'POST' | 'MANUAL'
export type CronExecutionStatus = 'success' | 'partial' | 'error'
export type WorkerHealthState = 'healthy' | 'idle' | 'warning'

export interface RecordCronExecutionInput {
  workerName?: string
  method: CronExecutionMethod
  httpStatus: number
  durationMs: number
  outbox?: {
    processed?: number
    succeeded?: number
    failed?: number
    suppressed?: number
    deferred?: number
  } | null
  webhookRecovery?: {
    processed?: number
    recovered_ingest?: number
    recovered_autonomous?: number
    deferred?: number
    failed?: number
    skipped_due_to_budget?: boolean
    skipped_rpc_unavailable?: boolean
    error?: string
  } | null
  errorMessage?: string | null
  details?: Record<string, any> | null
}

export interface CronExecutionLogItem {
  id: string
  workerName: string
  method: CronExecutionMethod
  status: CronExecutionStatus
  httpStatus: number
  durationMs: number
  outboxProcessed: number
  outboxSucceeded: number
  outboxFailed: number
  outboxSuppressed: number
  outboxDeferred: number
  webhookProcessed: number
  webhookRecoveredIngest: number
  webhookRecoveredAutonomous: number
  webhookDeferred: number
  webhookFailed: number
  errorMessage: string | null
  createdAt: string
}

export interface DeadLetterOutboxItem {
  id: string
  companyId: string
  companyName: string
  conversationId: string
  messageId: string | null
  channel: string
  recipient: string
  status: string
  attempts: number
  maxAttempts: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface DeadLetterWebhookItem {
  id: string
  companyId: string
  companyName: string
  eventId: string
  eventType: string
  status: string
  autonomousStatus: string
  autonomousAttempts: number
  autonomousMaxAttempts: number
  recoveryAttempts: number
  lastError: string | null
  conversationId: string | null
  messageId: string | null
  createdAt: string
  updatedAt: string
}

export interface RuntimeEnvironmentStatus {
  hasOpenAiKey: boolean
  hasGeminiKey: boolean
  hasCronSecret: boolean
  hasServiceRoleKey: boolean
  leaseSeconds: number
  cronBudgetMs: number
}

export interface OperationalTelemetrySummary {
  cronLogsAvailable: boolean
  recentRuns: CronExecutionLogItem[]
  cronStats: {
    totalRunsWindow: number
    successRunsWindow: number
    partialRunsWindow: number
    errorRunsWindow: number
    successRatePercent: number
    avgDurationMs: number
    lastRunAt: string | null
    lastRunStatus: CronExecutionStatus | null
  }
  queueHealth: {
    workerStatus: WorkerHealthState
    workerStatusText: string
    activeGatewayLocks: number
    stalledOutboxCount: number
    stalledWebhookCount: number
    stalledTotal: number
    deadLetterOutboxCount: number
    deadLetterWebhookCount: number
    deadLetterTotal: number
  }
  llmHealth: {
    totalRunsWindow: number
    errorRunsWindow: number
    timeoutRunsWindow: number
    slaPercent: number
    averageLatencySeconds: number
  }
  dlqOutbox: DeadLetterOutboxItem[]
  dlqWebhooks: DeadLetterWebhookItem[]
  envFlags: RuntimeEnvironmentStatus
}

export interface ReprocessDeadLetterResult {
  success: boolean
  action: 'outbox' | 'webhook'
  itemId: string
  companyId?: string
  outcome?: string
  error?: string
}

async function resolveAdminClient(adminClient?: any): Promise<any | null> {
  if (adminClient) return adminClient
  try {
    const { createAdminClient } = await import('@/lib/supabase/service')
    return createAdminClient()
  } catch {
    return null
  }
}

export function isMissingSchemaObjectError(err: any): boolean {
  if (!err) return false
  const code = String(err.code || '')
  const msg = String(err.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('could not find the column')
  )
}

function toInt(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : fallback
}

function classifyCronStatus(input: RecordCronExecutionInput): CronExecutionStatus {
  if (input.httpStatus >= 500 || Boolean(input.errorMessage)) {
    return 'error'
  }
  const hasPartialFailure =
    toInt(input.outbox?.failed) > 0 ||
    toInt(input.webhookRecovery?.failed) > 0 ||
    Boolean(input.webhookRecovery?.error)
  return hasPartialFailure ? 'partial' : 'success'
}

/**
 * Persiste uma execução do cron worker em `public.cron_execution_logs` de forma best-effort.
 * Nunca propaga exceção ao chamador para não comprometer o endpoint `/api/cron/outbox-worker`.
 */
export async function recordCronExecutionLog(
  input: RecordCronExecutionInput,
  options?: { adminClient?: any }
): Promise<{ recorded: boolean; skipped?: boolean; error?: string }> {
  const supabase = await resolveAdminClient(options?.adminClient)
  if (!supabase) {
    return { recorded: false, skipped: true, error: 'admin_client_unavailable' }
  }

  try {
    const rawDetails: Record<string, any> = {
      ...(input.details || {}),
      skipped_due_to_budget: Boolean(input.webhookRecovery?.skipped_due_to_budget),
      skipped_rpc_unavailable: Boolean(input.webhookRecovery?.skipped_rpc_unavailable),
      ...(input.webhookRecovery?.error ? { webhook_recovery_error: input.webhookRecovery.error } : {}),
    }

    const row = {
      worker_name: input.workerName || 'outbox-worker',
      method: input.method,
      status: classifyCronStatus(input),
      http_status: toInt(input.httpStatus, 200),
      duration_ms: toInt(input.durationMs, 0),
      outbox_processed: toInt(input.outbox?.processed),
      outbox_succeeded: toInt(input.outbox?.succeeded),
      outbox_failed: toInt(input.outbox?.failed),
      outbox_suppressed: toInt(input.outbox?.suppressed),
      outbox_deferred: toInt(input.outbox?.deferred),
      webhook_processed: toInt(input.webhookRecovery?.processed),
      webhook_recovered_ingest: toInt(input.webhookRecovery?.recovered_ingest),
      webhook_recovered_autonomous: toInt(input.webhookRecovery?.recovered_autonomous),
      webhook_deferred: toInt(input.webhookRecovery?.deferred),
      webhook_failed: toInt(input.webhookRecovery?.failed),
      error_message: input.errorMessage ? String(input.errorMessage).slice(0, 1000) : null,
      details: sanitizePayload(rawDetails),
    }

    const { error } = await supabase.from('cron_execution_logs').insert(row)
    if (error) {
      if (isMissingSchemaObjectError(error)) {
        return { recorded: false, skipped: true, error: 'cron_execution_logs_missing' }
      }
      console.warn('[Observability] Falha ao gravar cron_execution_logs:', error.message)
      return { recorded: false, error: error.message }
    }

    return { recorded: true }
  } catch (err: any) {
    console.warn('[Observability] Exceção não-bloqueante ao gravar cron_execution_logs:', err?.message || err)
    return { recorded: false, error: err?.message || String(err) }
  }
}

async function resolveCompanyNamesMap(
  supabase: any,
  companyIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniqueIds = Array.from(new Set(companyIds.filter((id) => Boolean(id) && UUID_REGEX.test(id))))
  if (uniqueIds.length === 0) return map

  try {
    const { data } = await supabase
      .from('companies')
      .select('id, name')
      .in('id', uniqueIds)
    for (const c of (data || []) as any[]) {
      if (c?.id) map.set(c.id, c.name || 'Empresa')
    }
  } catch {
    // Fallback silencioso caso o client de teste não suporte .in()
  }

  return map
}

async function safeSelectCronLogs(supabase: any, limit: number): Promise<{ available: boolean; rows: any[] }> {
  try {
    const { data, error } = await supabase
      .from('cron_execution_logs')
      .select(
        'id, worker_name, method, status, http_status, duration_ms, outbox_processed, outbox_succeeded, outbox_failed, outbox_suppressed, outbox_deferred, webhook_processed, webhook_recovered_ingest, webhook_recovered_autonomous, webhook_deferred, webhook_failed, error_message, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      if (isMissingSchemaObjectError(error)) {
        return { available: false, rows: [] }
      }
      return { available: true, rows: [] }
    }
    return { available: true, rows: Array.isArray(data) ? data : [] }
  } catch {
    return { available: false, rows: [] }
  }
}

async function safeSelectActiveGatewayLocksCount(supabase: any, nowIso: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('gateway_outbound_locks')
      .select('id, status, locked_until')
      .eq('status', 'in_flight')
      .gt('locked_until', nowIso)
      .limit(200)
    if (error || !Array.isArray(data)) return 0
    return data.length
  } catch {
    return 0
  }
}

async function safeSelectOutboxObservability(
  supabase: any,
  nowMs: number,
  dlqLimit: number
): Promise<{ stalledCount: number; failedRows: any[]; totalOutboxWindow: number; failedOutboxWindow: number }> {
  try {
    const [pendingOrProcessingRes, failedRes] = await Promise.all([
      supabase
        .from('message_outbox')
        .select('id, status, created_at, locked_until')
        .in('status', ['pending', 'processing'])
        .limit(200),
      supabase
        .from('message_outbox')
        .select('id, company_id, conversation_id, message_id, channel, recipient, status, attempts, max_attempts, last_error, created_at, updated_at')
        .eq('status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(dlqLimit),
    ])

    const pendingOrProcessing = Array.isArray(pendingOrProcessingRes?.data) ? pendingOrProcessingRes.data : []
    const stalledCount = pendingOrProcessing.filter((row: any) => {
      if (row.status === 'pending' && row.created_at) {
        return nowMs - new Date(row.created_at).getTime() > 2 * 60 * 1000
      }
      if (row.status === 'processing' && row.locked_until) {
        return new Date(row.locked_until).getTime() < nowMs
      }
      return false
    }).length

    const failedRows = Array.isArray(failedRes?.data) ? failedRes.data : []

    let totalOutboxWindow = 0
    let failedOutboxWindow = failedRows.length
    try {
      const { data: recentOutbox } = await supabase
        .from('message_outbox')
        .select('id, status')
        .order('created_at', { ascending: false })
        .limit(200)
      if (Array.isArray(recentOutbox)) {
        totalOutboxWindow = recentOutbox.length
        failedOutboxWindow = recentOutbox.filter((r: any) => r.status === 'failed').length
      }
    } catch {}

    return { stalledCount, failedRows, totalOutboxWindow, failedOutboxWindow }
  } catch {
    return { stalledCount: 0, failedRows: [], totalOutboxWindow: 0, failedOutboxWindow: 0 }
  }
}

async function safeSelectWebhookObservability(
  supabase: any,
  nowMs: number,
  dlqLimit: number
): Promise<{ stalledCount: number; failedRows: any[] }> {
  const cutoff24h = nowMs - 24 * 60 * 60 * 1000

  try {
    const { data, error } = await supabase
      .from('webhook_events')
      .select(
        'id, company_id, event_id, event_type, status, autonomous_status, autonomous_attempts, autonomous_max_attempts, recovery_attempts, autonomous_locked_until, autonomous_last_error, error_message, conversation_id, message_id, created_at, updated_at'
      )
      .order('created_at', { ascending: false })
      .limit(250)

    if (error && isMissingSchemaObjectError(error)) {
      const { data: legacyRows } = await supabase
        .from('webhook_events')
        .select('id, company_id, event_id, event_type, status, error_message, created_at')
        .order('created_at', { ascending: false })
        .limit(250)

      const rows = Array.isArray(legacyRows) ? legacyRows : []
      const failedRows = rows.filter((r: any) => r.status === 'error').slice(0, dlqLimit)
      const stalledCount = rows.filter(
        (r: any) =>
          r.status === 'processing' &&
          r.created_at &&
          nowMs - new Date(r.created_at).getTime() > 90 * 1000 &&
          new Date(r.created_at).getTime() >= cutoff24h
      ).length
      return { stalledCount, failedRows }
    }

    const rows = Array.isArray(data) ? data : []
    const stalledCount = rows.filter((r: any) => {
      const createdAtMs = r.created_at ? new Date(r.created_at).getTime() : 0
      if (!createdAtMs || createdAtMs < cutoff24h) return false

      const lockUntilMs = r.autonomous_locked_until ? new Date(r.autonomous_locked_until).getTime() : 0
      const updatedMs = r.updated_at ? new Date(r.updated_at).getTime() : createdAtMs

      const stalledIngest =
        (r.status === 'processing' || r.status === 'error') &&
        r.autonomous_status !== 'failed' &&
        Math.max(lockUntilMs, updatedMs) < nowMs - 45 * 1000

      const stalledAutonomous =
        r.status === 'processed' &&
        (r.autonomous_status === 'pending' || r.autonomous_status === 'processing') &&
        Boolean(r.conversation_id) &&
        Boolean(r.message_id) &&
        (lockUntilMs === 0 ? createdAtMs < nowMs - 60 * 1000 : lockUntilMs < nowMs)

      return stalledIngest || stalledAutonomous
    }).length

    const failedRows = rows
      .filter((r: any) => {
        if (r.autonomous_last_error === 'historical_backfill_prior_to_2b') {
          return false
        }
        return r.status === 'error' || r.autonomous_status === 'failed'
      })
      .slice(0, dlqLimit)

    return { stalledCount, failedRows }
  } catch {
    return { stalledCount: 0, failedRows: [] }
  }
}

async function safeSelectAgentRunsHealth(supabase: any): Promise<{
  totalRunsWindow: number
  errorRunsWindow: number
  timeoutRunsWindow: number
  averageLatencySeconds: number
}> {
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .select('id, status, duration_ms')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error || !Array.isArray(data) || data.length === 0) {
      return { totalRunsWindow: 0, errorRunsWindow: 0, timeoutRunsWindow: 0, averageLatencySeconds: 0 }
    }

    const totalRunsWindow = data.length
    let errorRunsWindow = 0
    let timeoutRunsWindow = 0
    let latencySum = 0
    let latencyCount = 0

    for (const run of data as any[]) {
      if (run.status === 'error') errorRunsWindow++
      if (run.status === 'timeout') timeoutRunsWindow++
      const ms = Number(run.duration_ms)
      if (Number.isFinite(ms) && ms > 0) {
        latencySum += ms
        latencyCount++
      }
    }

    const averageLatencySeconds =
      latencyCount > 0 ? Number(((latencySum / latencyCount) / 1000).toFixed(1)) : 0

    return { totalRunsWindow, errorRunsWindow, timeoutRunsWindow, averageLatencySeconds }
  } catch {
    return { totalRunsWindow: 0, errorRunsWindow: 0, timeoutRunsWindow: 0, averageLatencySeconds: 0 }
  }
}

function computeWorkerHealth(params: {
  cronLogsAvailable: boolean
  recentRuns: CronExecutionLogItem[]
  stalledTotal: number
  deadLetterTotal: number
  nowMs: number
}): { workerStatus: WorkerHealthState; workerStatusText: string } {
  const { cronLogsAvailable, recentRuns, stalledTotal, deadLetterTotal, nowMs } = params

  if (stalledTotal > 0) {
    return {
      workerStatus: 'warning',
      workerStatusText: `${stalledTotal} pendência(s) aguardando reconciliação`,
    }
  }

  const latestRun = recentRuns[0]
  if (latestRun) {
    if (latestRun.status === 'error') {
      return {
        workerStatus: 'warning',
        workerStatusText: 'Última execução do Cron falhou',
      }
    }
    if (latestRun.status === 'partial') {
      return {
        workerStatus: 'warning',
        workerStatusText: 'Último ciclo com falhas parciais na fila',
      }
    }
    const ageMs = nowMs - new Date(latestRun.createdAt).getTime()
    if (deadLetterTotal > 0) {
      return {
        workerStatus: 'warning',
        workerStatusText: `${deadLetterTotal} item(ns) na Dead Letter Queue`,
      }
    }
    if (ageMs <= 15 * 60 * 1000) {
      return {
        workerStatus: 'healthy',
        workerStatusText: 'Operando normalmente',
      }
    }
    return {
      workerStatus: 'idle',
      workerStatusText: 'Aguardando próximo disparo do Cron',
    }
  }

  if (deadLetterTotal > 0) {
    return {
      workerStatus: 'warning',
      workerStatusText: `${deadLetterTotal} item(ns) na Dead Letter Queue`,
    }
  }

  if (!cronLogsAvailable) {
    return {
      workerStatus: 'idle',
      workerStatusText: 'Aguardando migration de telemetria (3A)',
    }
  }

  return {
    workerStatus: 'idle',
    workerStatusText: 'Sem execuções registradas ainda',
  }
}

export function getRuntimeEnvironmentStatus(): RuntimeEnvironmentStatus {
  return {
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY?.trim()),
    hasCronSecret: Boolean(process.env.CRON_SECRET?.trim()),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    leaseSeconds: 120,
    cronBudgetMs: 19000,
  }
}

/**
 * Consolida telemetria operacional real do motor (Cron Worker, Fila Outbox/Webhooks, Locks e DLQ).
 */
export async function getOperationalTelemetry(options?: {
  adminClient?: any
  cronLimit?: number
  dlqLimit?: number
}): Promise<OperationalTelemetrySummary> {
  const cronLimit = Math.min(Math.max(options?.cronLimit ?? 25, 1), 100)
  const dlqLimit = Math.min(Math.max(options?.dlqLimit ?? 25, 1), 100)
  const envFlags = getRuntimeEnvironmentStatus()

  const supabase = await resolveAdminClient(options?.adminClient)
  if (!supabase) {
    return {
      cronLogsAvailable: false,
      recentRuns: [],
      cronStats: {
        totalRunsWindow: 0,
        successRunsWindow: 0,
        partialRunsWindow: 0,
        errorRunsWindow: 0,
        successRatePercent: 100,
        avgDurationMs: 0,
        lastRunAt: null,
        lastRunStatus: null,
      },
      queueHealth: {
        workerStatus: 'idle',
        workerStatusText: 'Cliente administrativo indisponível',
        activeGatewayLocks: 0,
        stalledOutboxCount: 0,
        stalledWebhookCount: 0,
        stalledTotal: 0,
        deadLetterOutboxCount: 0,
        deadLetterWebhookCount: 0,
        deadLetterTotal: 0,
      },
      llmHealth: {
        totalRunsWindow: 0,
        errorRunsWindow: 0,
        timeoutRunsWindow: 0,
        slaPercent: 100,
        averageLatencySeconds: 0,
      },
      dlqOutbox: [],
      dlqWebhooks: [],
      envFlags,
    }
  }

  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const [cronRes, activeGatewayLocks, outboxObs, webhookObs, llmHealth] = await Promise.all([
    safeSelectCronLogs(supabase, cronLimit),
    safeSelectActiveGatewayLocksCount(supabase, nowIso),
    safeSelectOutboxObservability(supabase, nowMs, dlqLimit),
    safeSelectWebhookObservability(supabase, nowMs, dlqLimit),
    safeSelectAgentRunsHealth(supabase),
  ])

  const companyIds = [
    ...outboxObs.failedRows.map((r: any) => r.company_id),
    ...webhookObs.failedRows.map((r: any) => r.company_id),
  ]
  const companyMap = await resolveCompanyNamesMap(supabase, companyIds)

  const recentRuns: CronExecutionLogItem[] = cronRes.rows.map((r: any) => ({
    id: r.id,
    workerName: r.worker_name || 'outbox-worker',
    method: r.method || 'GET',
    status: r.status || 'success',
    httpStatus: toInt(r.http_status, 200),
    durationMs: toInt(r.duration_ms, 0),
    outboxProcessed: toInt(r.outbox_processed),
    outboxSucceeded: toInt(r.outbox_succeeded),
    outboxFailed: toInt(r.outbox_failed),
    outboxSuppressed: toInt(r.outbox_suppressed),
    outboxDeferred: toInt(r.outbox_deferred),
    webhookProcessed: toInt(r.webhook_processed),
    webhookRecoveredIngest: toInt(r.webhook_recovered_ingest),
    webhookRecoveredAutonomous: toInt(r.webhook_recovered_autonomous),
    webhookDeferred: toInt(r.webhook_deferred),
    webhookFailed: toInt(r.webhook_failed),
    errorMessage: r.error_message || null,
    createdAt: r.created_at,
  }))

  const totalRunsWindow = recentRuns.length
  const successRunsWindow = recentRuns.filter((r) => r.status === 'success').length
  const partialRunsWindow = recentRuns.filter((r) => r.status === 'partial').length
  const errorRunsWindow = recentRuns.filter((r) => r.status === 'error').length
  const successRatePercent =
    totalRunsWindow > 0
      ? Number((((successRunsWindow + partialRunsWindow * 0.5) / totalRunsWindow) * 100).toFixed(1))
      : 100
  const avgDurationMs =
    totalRunsWindow > 0
      ? Math.round(recentRuns.reduce((sum, r) => sum + r.durationMs, 0) / totalRunsWindow)
      : 0

  const dlqOutbox: DeadLetterOutboxItem[] = outboxObs.failedRows.map((r: any) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: companyMap.get(r.company_id) || 'Empresa',
    conversationId: r.conversation_id,
    messageId: r.message_id || null,
    channel: r.channel || 'whatsapp',
    recipient: r.recipient || '',
    status: r.status,
    attempts: toInt(r.attempts),
    maxAttempts: toInt(r.max_attempts, 5),
    lastError: r.last_error || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
  }))

  const dlqWebhooks: DeadLetterWebhookItem[] = webhookObs.failedRows.map((r: any) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: companyMap.get(r.company_id) || 'Empresa',
    eventId: r.event_id,
    eventType: r.event_type || 'message.received',
    status: r.status,
    autonomousStatus: r.autonomous_status || (r.status === 'error' ? 'failed' : 'pending'),
    autonomousAttempts: toInt(r.autonomous_attempts),
    autonomousMaxAttempts: toInt(r.autonomous_max_attempts, 3),
    recoveryAttempts: toInt(r.recovery_attempts),
    lastError: r.autonomous_last_error || r.error_message || null,
    conversationId: r.conversation_id || null,
    messageId: r.message_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at || r.created_at,
  }))

  const stalledTotal = outboxObs.stalledCount + webhookObs.stalledCount
  const deadLetterTotal = dlqOutbox.length + dlqWebhooks.length

  const { workerStatus, workerStatusText } = computeWorkerHealth({
    cronLogsAvailable: cronRes.available,
    recentRuns,
    stalledTotal,
    deadLetterTotal,
    nowMs,
  })

  // SLA consolidado real sobre execuções do agente e entregas da outbox na janela recente
  const slaSamples = llmHealth.totalRunsWindow + outboxObs.totalOutboxWindow
  const slaFailures =
    llmHealth.errorRunsWindow + llmHealth.timeoutRunsWindow + outboxObs.failedOutboxWindow
  const slaPercent =
    slaSamples > 0
      ? Number(Math.max(0, ((slaSamples - slaFailures) / slaSamples) * 100).toFixed(2))
      : 100

  return {
    cronLogsAvailable: cronRes.available,
    recentRuns,
    cronStats: {
      totalRunsWindow,
      successRunsWindow,
      partialRunsWindow,
      errorRunsWindow,
      successRatePercent,
      avgDurationMs,
      lastRunAt: recentRuns[0]?.createdAt || null,
      lastRunStatus: recentRuns[0]?.status || null,
    },
    queueHealth: {
      workerStatus,
      workerStatusText,
      activeGatewayLocks,
      stalledOutboxCount: outboxObs.stalledCount,
      stalledWebhookCount: webhookObs.stalledCount,
      stalledTotal,
      deadLetterOutboxCount: dlqOutbox.length,
      deadLetterWebhookCount: dlqWebhooks.length,
      deadLetterTotal,
    },
    llmHealth: {
      ...llmHealth,
      slaPercent,
    },
    dlqOutbox,
    dlqWebhooks,
    envFlags,
  }
}

/**
 * Reprocessa manualmente com segurança um registro falho da `message_outbox` (Dead Letter Queue).
 */
export async function reprocessDeadLetterOutboxItem(
  outboxId: string,
  options?: { adminClient?: any }
): Promise<ReprocessDeadLetterResult> {
  if (!outboxId || !UUID_REGEX.test(outboxId)) {
    return { success: false, action: 'outbox', itemId: outboxId, error: 'Identificador de outbox inválido.' }
  }

  const supabase = await resolveAdminClient(options?.adminClient)
  if (!supabase) {
    return { success: false, action: 'outbox', itemId: outboxId, error: 'Cliente administrativo indisponível.' }
  }

  const { data: row, error: fetchErr } = await supabase
    .from('message_outbox')
    .select('id, company_id, status, attempts, max_attempts, locked_until, last_error')
    .eq('id', outboxId)
    .maybeSingle()

  if (fetchErr || !row) {
    return {
      success: false,
      action: 'outbox',
      itemId: outboxId,
      error: fetchErr?.message || 'Registro de outbox não encontrado.',
    }
  }

  if (row.status === 'sent') {
    return { success: true, action: 'outbox', itemId: outboxId, companyId: row.company_id, outcome: 'already_sent' }
  }
  if (row.status === 'suppressed') {
    return {
      success: false,
      action: 'outbox',
      itemId: outboxId,
      companyId: row.company_id,
      error: 'Mensagem suprimida não é elegível para reprocessamento.',
    }
  }
  if (row.status === 'processing' && row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return {
      success: false,
      action: 'outbox',
      itemId: outboxId,
      companyId: row.company_id,
      error: 'Registro em processamento ativo com lease vigente.',
    }
  }

  try {
    await requireActiveCompany(row.company_id, { adminClient: supabase })
  } catch (err: any) {
    return {
      success: false,
      action: 'outbox',
      itemId: outboxId,
      companyId: row.company_id,
      error: err instanceof TenantAccessError ? err.message : 'Empresa inativa ou indisponível.',
    }
  }

  const attempts = toInt(row.attempts)
  const currentMax = toInt(row.max_attempts, 5)
  const nextMax = Math.max(currentMax, attempts + 1)

  const { error: resetErr } = await supabase
    .from('message_outbox')
    .update({
      status: 'failed',
      max_attempts: nextMax,
      locked_at: null,
      locked_until: null,
      claim_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('company_id', row.company_id)

  if (resetErr) {
    return {
      success: false,
      action: 'outbox',
      itemId: outboxId,
      companyId: row.company_id,
      error: `Falha ao preparar outbox para reenvio: ${resetErr.message}`,
    }
  }

  const { retryOutboxMessage } = await import('@/lib/services/message-engine')
  const retryRes = await retryOutboxMessage(row.company_id, row.id, { adminClient: supabase })
  return {
    success: Boolean(retryRes.success),
    action: 'outbox',
    itemId: outboxId,
    companyId: row.company_id,
    outcome: retryRes.alreadySent ? 'already_sent' : retryRes.success ? 'dispatched' : retryRes.code || 'failed',
    error: retryRes.error,
  }
}

/**
 * Reprocessa manualmente com segurança um evento falho em `webhook_events` (ingestão ou ciclo autônomo).
 */
export async function reprocessDeadLetterWebhookEvent(
  webhookEventRowId: string,
  options?: { adminClient?: any }
): Promise<ReprocessDeadLetterResult> {
  if (!webhookEventRowId || !UUID_REGEX.test(webhookEventRowId)) {
    return { success: false, action: 'webhook', itemId: webhookEventRowId, error: 'Identificador de webhook inválido.' }
  }

  const supabase = await resolveAdminClient(options?.adminClient)
  if (!supabase) {
    return { success: false, action: 'webhook', itemId: webhookEventRowId, error: 'Cliente administrativo indisponível.' }
  }

  let row: any = null
  const richQuery = await supabase
    .from('webhook_events')
    .select(
      'id, company_id, event_id, event_type, status, autonomous_status, autonomous_attempts, autonomous_max_attempts, recovery_attempts, autonomous_locked_until, conversation_id, message_id, payload'
    )
    .eq('id', webhookEventRowId)
    .maybeSingle()

  if (richQuery.error && isMissingSchemaObjectError(richQuery.error)) {
    const legacyQuery = await supabase
      .from('webhook_events')
      .select('id, company_id, event_id, event_type, status, payload')
      .eq('id', webhookEventRowId)
      .maybeSingle()
    if (legacyQuery.error || !legacyQuery.data) {
      return {
        success: false,
        action: 'webhook',
        itemId: webhookEventRowId,
        error: legacyQuery.error?.message || 'Evento webhook não encontrado.',
      }
    }
    row = legacyQuery.data
  } else if (richQuery.error || !richQuery.data) {
    return {
      success: false,
      action: 'webhook',
      itemId: webhookEventRowId,
      error: richQuery.error?.message || 'Evento webhook não encontrado.',
    }
  } else {
    row = richQuery.data
  }

  if (row.autonomous_locked_until && new Date(row.autonomous_locked_until).getTime() > Date.now()) {
    return {
      success: false,
      action: 'webhook',
      itemId: webhookEventRowId,
      companyId: row.company_id,
      error: 'Evento em processamento ativo com lease vigente.',
    }
  }

  if (row.status === 'processed' && (row.autonomous_status === 'completed' || row.autonomous_status === 'skipped')) {
    return {
      success: true,
      action: 'webhook',
      itemId: webhookEventRowId,
      companyId: row.company_id,
      outcome: 'already_completed',
    }
  }

  try {
    await requireActiveCompany(row.company_id, { adminClient: supabase })
  } catch (err: any) {
    return {
      success: false,
      action: 'webhook',
      itemId: webhookEventRowId,
      companyId: row.company_id,
      error: err instanceof TenantAccessError ? err.message : 'Empresa inativa ou indisponível.',
    }
  }

  if (row.status !== 'processed') {
    const currentAttempts = Math.max(toInt(row.recovery_attempts), toInt(row.autonomous_attempts))
    const nextMax = Math.max(toInt(row.autonomous_max_attempts, 3), currentAttempts + 1)

    // Tenta liberar lock e ampliar teto de tentativas antes do reprocessamento (ignora 42703)
    const prepRes = await supabase
      .from('webhook_events')
      .update({
        autonomous_max_attempts: nextMax,
        autonomous_locked_until: null,
        autonomous_claim_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('company_id', row.company_id)

    if (prepRes.error && !isMissingSchemaObjectError(prepRes.error)) {
      return {
        success: false,
        action: 'webhook',
        itemId: webhookEventRowId,
        companyId: row.company_id,
        error: `Falha ao preparar webhook para reprocessamento: ${prepRes.error.message}`,
      }
    }

    try {
      const { processWebhookEvent } = await import('@/lib/services/message-engine')
      const ingestRes = await processWebhookEvent(row.company_id, row.payload, {
        adminClient: supabase,
        retryWebhookEventRowId: row.id,
      })

      if (
        !ingestRes.duplicate &&
        ingestRes.conversation_id &&
        ingestRes.message_id &&
        row.payload?.message?.sender_type === 'customer'
      ) {
        return await replayAutonomousAndFormat({
          supabase,
          companyId: row.company_id,
          conversationId: ingestRes.conversation_id,
          messageId: ingestRes.message_id,
          eventId: row.event_id,
          payload: row.payload,
          webhookEventRowId: ingestRes.webhook_event_id || row.id,
          itemId: webhookEventRowId,
          dispatchedOutcome: 'ingest_and_dispatched',
        })
      }

      return {
        success: true,
        action: 'webhook',
        itemId: webhookEventRowId,
        companyId: row.company_id,
        outcome: ingestRes.duplicate ? 'duplicate_already_ingested' : 'ingest_reprocessed',
      }
    } catch (err: any) {
      return {
        success: false,
        action: 'webhook',
        itemId: webhookEventRowId,
        companyId: row.company_id,
        error: err?.message || String(err),
      }
    }
  }

  if (!row.conversation_id || !row.message_id) {
    return {
      success: false,
      action: 'webhook',
      itemId: webhookEventRowId,
      companyId: row.company_id,
      error: 'Evento sem conversation_id/message_id vinculados para retomada autônoma.',
    }
  }

  const nextAutoMax = Math.max(toInt(row.autonomous_max_attempts, 3), toInt(row.autonomous_attempts) + 1)
  const { error: resetErr } = await supabase
    .from('webhook_events')
    .update({
      autonomous_status: 'pending',
      autonomous_max_attempts: nextAutoMax,
      autonomous_locked_until: null,
      autonomous_claim_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('company_id', row.company_id)

  if (resetErr && !isMissingSchemaObjectError(resetErr)) {
    return {
      success: false,
      action: 'webhook',
      itemId: webhookEventRowId,
      companyId: row.company_id,
      error: `Falha ao resetar estado autônomo do webhook: ${resetErr.message}`,
    }
  }

  try {
    return await replayAutonomousAndFormat({
      supabase,
      companyId: row.company_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      eventId: row.event_id,
      payload: row.payload,
      webhookEventRowId: row.id,
      itemId: webhookEventRowId,
      dispatchedOutcome: 'dispatched',
    })
  } catch (err: any) {
    return {
      success: false,
      action: 'webhook',
      itemId: webhookEventRowId,
      companyId: row.company_id,
      error: err?.message || String(err),
    }
  }
}

async function replayAutonomousAndFormat(params: {
  supabase: any
  companyId: string
  conversationId: string
  messageId: string
  eventId: string
  payload: any
  webhookEventRowId: string
  itemId: string
  dispatchedOutcome: string
}): Promise<ReprocessDeadLetterResult> {
  const { handleAutonomousCycle } = await import('@/lib/services/message-engine')
  const cycleRes = await handleAutonomousCycle({
    companyId: params.companyId,
    conversationId: params.conversationId,
    messageId: params.messageId,
    eventId: params.eventId,
    payload: params.payload,
    webhookEventRowId: params.webhookEventRowId,
    adminClient: params.supabase,
  })

  const resolvedTerminalReasons = new Set([
    'idempotent_duplicate',
    'conversation_closed',
    'human_mode_active',
    'suppressed_by_handoff',
  ])

  const isSuccess =
    Boolean(cycleRes.dispatched) ||
    Boolean(cycleRes.outboxId) ||
    (cycleRes.reason ? resolvedTerminalReasons.has(cycleRes.reason) : false)

  return {
    success: isSuccess,
    action: 'webhook',
    itemId: params.itemId,
    companyId: params.companyId,
    outcome: cycleRes.dispatched ? params.dispatchedOutcome : cycleRes.reason,
    error: cycleRes.error,
  }
}
