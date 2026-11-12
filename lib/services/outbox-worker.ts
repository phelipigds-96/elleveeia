import 'server-only'

import { createAdminClient } from '@/lib/supabase/service'
import { retryOutboxMessage, processWebhookEvent, handleAutonomousCycle } from '@/lib/services/message-engine'

const DEFAULT_BATCH_SIZE = 5
// Mantém o lease acima de Vercel maxDuration (60s) para evitar dupla reivindicação antes do término da lambda.
const DEFAULT_LEASE_SECONDS = 120
// Reserva margem para chamadas de gateway (8s) + rede/DB fecharem abaixo do timeout de 30s do cron-job.org.
const DEFAULT_TIME_BUDGET_MS = 19000
const DEFAULT_CONCURRENCY = 5

export interface ReconcileWorkerOptions {
  adminClient?: any
  batchSize?: number
  leaseSeconds?: number
  concurrency?: number
  timeBudgetMs?: number
}

export interface ReconcileItemResult {
  outbox_id: string
  company_id: string
  attempts?: number
  success: boolean
  code?: string
  statusCode?: number
  suppressed?: boolean
  alreadySent?: boolean
  deferred?: boolean
  error?: string
}

export interface ReconcileWorkerResult {
  processed: number
  succeeded: number
  failed: number
  suppressed: number
  deferred?: number
  elapsed_ms: number
  items: ReconcileItemResult[]
}

/**
 * Executa filas de mensagens com paralelismo limitado entre conversas distintas,
 * preservando ordem estrita (FIFO) dentro da mesma conversa e respeitando o orçamento de tempo HTTP.
 */
async function processConversationQueue(
  queue: Array<{ index: number; item: any }>,
  supabase: any,
  leaseSeconds: number,
  startTime: number,
  timeBudgetMs: number,
  results: ReconcileItemResult[]
): Promise<{ succeeded: number; failed: number; suppressed: number; deferred: number }> {
  let succeeded = 0
  let failed = 0
  let suppressed = 0
  let deferred = 0

  for (let qIdx = 0; qIdx < queue.length; qIdx++) {
    const { index, item } = queue[qIdx]
    const outboxId = item.outbox_id
    const companyId = item.company_id
    const attempts = typeof item.attempts === 'number' ? item.attempts : undefined

    if (Date.now() - startTime >= timeBudgetMs) {
      for (let rem = qIdx; rem < queue.length; rem++) {
        const skipped = queue[rem]
        deferred++
        results[skipped.index] = {
          outbox_id: skipped.item.outbox_id,
          company_id: skipped.item.company_id,
          attempts: typeof skipped.item.attempts === 'number' ? skipped.item.attempts : undefined,
          success: false,
          deferred: true,
          code: 'TIME_BUDGET_EXCEEDED',
          error: 'Execução adiada antes do despacho para respeitar limite HTTP de 30s'
        }
      }
      break
    }

    try {
      const res = await retryOutboxMessage(companyId, outboxId, {
        adminClient: supabase,
        leaseSeconds,
        claim: {
          claim_token: item.claim_token,
          claim_version: item.claim_version,
          payload: item.payload,
          message_id: item.message_id,
          attempts
        }
      })

      if (res.success) {
        succeeded++
        results[index] = {
          outbox_id: outboxId,
          company_id: companyId,
          attempts,
          success: true,
          alreadySent: res.alreadySent
        }
      } else {
        if (res.suppressed) {
          suppressed++
        } else {
          failed++
        }
        results[index] = {
          outbox_id: outboxId,
          company_id: companyId,
          attempts,
          success: false,
          code: res.code,
          statusCode: res.statusCode,
          suppressed: res.suppressed,
          error: res.error
        }
      }
    } catch (err: any) {
      failed++
      console.error(`[OutboxWorker] Falha inesperada ao reconciliar outbox ${outboxId}: ${err?.message || err}`)
      results[index] = {
        outbox_id: outboxId,
        company_id: companyId,
        attempts,
        success: false,
        error: err?.message || 'Erro inesperado no processamento da outbox'
      }
    }
  }

  return { succeeded, failed, suppressed, deferred }
}

/**
 * Worker assíncrono para reconciliação de mensagens travadas ou abandonadas na outbox.
 * Utiliza a RPC claim_stalled_outbox_batch para lock atômico concorrente (SKIP LOCKED)
 * e delega o reenvio idempotente para retryOutboxMessage.
 */
export async function reconcileStalledOutboxBatch(
  options?: ReconcileWorkerOptions
): Promise<ReconcileWorkerResult> {
  const startTime = Date.now()
  const supabase = options?.adminClient || createAdminClient()
  const batchSize = options?.batchSize && options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH_SIZE
  const leaseSeconds = options?.leaseSeconds && options.leaseSeconds >= 15 ? options.leaseSeconds : DEFAULT_LEASE_SECONDS
  const timeBudgetMs = options?.timeBudgetMs && options.timeBudgetMs > 0 ? options.timeBudgetMs : DEFAULT_TIME_BUDGET_MS
  const concurrency = options?.concurrency && options.concurrency > 0 ? Math.min(options.concurrency, 10) : DEFAULT_CONCURRENCY

  const { data: stalledBatch, error: batchErr } = await (supabase as any).rpc(
    'claim_stalled_outbox_batch',
    {
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds
    }
  )

  if (batchErr) {
    const errMsg = batchErr.message || JSON.stringify(batchErr)
    console.error(`[OutboxWorker] Erro ao reivindicar lote de mensagens travadas: ${errMsg}`)
    throw new Error(`Falha ao reivindicar lote de mensagens travadas: ${errMsg}`)
  }

  const items = Array.isArray(stalledBatch) ? stalledBatch : []
  if (items.length === 0) {
    const emptyElapsed = Date.now() - startTime
    console.log(
      JSON.stringify({
        event: 'outbox_worker.reconcile_completed',
        batch_size: batchSize,
        lease_seconds: leaseSeconds,
        processed: 0,
        succeeded: 0,
        failed: 0,
        suppressed: 0,
        deferred: 0,
        elapsed_ms: emptyElapsed
      })
    )
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      suppressed: 0,
      deferred: 0,
      elapsed_ms: emptyElapsed,
      items: []
    }
  }

  // Agrupa por conversation_id mantendo FIFO por conversa e executando conversas distintas em paralelo.
  const queuesMap = new Map<string, Array<{ index: number; item: any }>>()
  items.forEach((item, index) => {
    const convId = item.conversation_id || item.payload?.conversation_id
    const key = convId ? `conv:${convId}` : `solo:${item.outbox_id || index}`
    const queue = queuesMap.get(key)
    if (queue) {
      queue.push({ index, item })
    } else {
      queuesMap.set(key, [{ index, item }])
    }
  })

  const queues = Array.from(queuesMap.values())
  const results: ReconcileItemResult[] = new Array(items.length)
  let nextQueueIdx = 0
  let succeeded = 0
  let failed = 0
  let suppressed = 0
  let deferred = 0

  const workerCount = Math.min(concurrency, queues.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const myQueueIdx = nextQueueIdx++
        if (myQueueIdx >= queues.length) break
        const counts = await processConversationQueue(
          queues[myQueueIdx],
          supabase,
          leaseSeconds,
          startTime,
          timeBudgetMs,
          results
        )
        succeeded += counts.succeeded
        failed += counts.failed
        suppressed += counts.suppressed
        deferred += counts.deferred
      }
    })
  )

  const elapsedMs = Date.now() - startTime
  const failures = results.filter(r => !r.success)

  console.log(
    JSON.stringify({
      event: 'outbox_worker.reconcile_completed',
      batch_size: batchSize,
      lease_seconds: leaseSeconds,
      concurrency: workerCount,
      processed: items.length,
      succeeded,
      failed,
      suppressed,
      deferred,
      elapsed_ms: elapsedMs,
      failures: failures.map(f => ({
        outbox_id: f.outbox_id,
        company_id: f.company_id,
        attempts: f.attempts,
        code: f.code,
        status_code: f.statusCode,
        deferred: Boolean(f.deferred),
        error: f.error
      }))
    })
  )

  return {
    processed: items.length,
    succeeded,
    failed,
    suppressed,
    deferred,
    elapsed_ms: elapsedMs,
    items: results
  }
}

export interface WebhookRecoveryOptions {
  adminClient?: any
  batchSize?: number
  leaseSeconds?: number
  timeBudgetMs?: number
}

export interface WebhookRecoveryItemResult {
  webhook_event_id: string
  company_id: string
  event_id: string
  recovery_mode: string
  attempts?: number
  success: boolean
  deferred?: boolean
  reason?: string
  error?: string
}

export interface WebhookRecoveryResult {
  processed: number
  recovered_ingest: number
  recovered_autonomous: number
  deferred: number
  failed: number
  skipped_rpc_unavailable?: boolean
  error?: string
  elapsed_ms: number
  items: WebhookRecoveryItemResult[]
}

function isMissingWebhookRecoveryRpc(err: any): boolean {
  const code = String(err?.code || '')
  const msg = String(err?.message || '').toLowerCase()
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    msg.includes('not implemented')
  )
}

/**
 * Worker complementar (Etapa 2B) para recuperação de ingestões travadas/falhas em `webhook_events`
 * e retomada de ciclos autônomos pendentes dentro do orçamento restante de tempo do cron.
 * Degrada graciosamente se a migration 2B ainda não tiver sido aplicada no banco.
 */
export async function reconcileStalledWebhookEventsBatch(
  options?: WebhookRecoveryOptions
): Promise<WebhookRecoveryResult> {
  const startTime = Date.now()
  const supabase = options?.adminClient || createAdminClient()
  const batchSize = options?.batchSize && options.batchSize > 0 ? Math.min(options.batchSize, 10) : 3
  const leaseSeconds = options?.leaseSeconds && options.leaseSeconds >= 15 ? options.leaseSeconds : 90
  const timeBudgetMs = options?.timeBudgetMs && options.timeBudgetMs > 0 ? options.timeBudgetMs : DEFAULT_TIME_BUDGET_MS

  let batchRes: any
  try {
    batchRes = await (supabase as any).rpc('claim_stalled_webhook_events_batch', {
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds
    })
  } catch (rpcThrown: any) {
    if (isMissingWebhookRecoveryRpc(rpcThrown)) {
      return {
        processed: 0,
        recovered_ingest: 0,
        recovered_autonomous: 0,
        deferred: 0,
        failed: 0,
        skipped_rpc_unavailable: true,
        elapsed_ms: Date.now() - startTime,
        items: []
      }
    }
    const errMsg = rpcThrown?.message || String(rpcThrown)
    console.error(`[WebhookRecovery] Erro ao reivindicar webhook_events travados: ${errMsg}`)
    return {
      processed: 0,
      recovered_ingest: 0,
      recovered_autonomous: 0,
      deferred: 0,
      failed: 1,
      error: errMsg,
      elapsed_ms: Date.now() - startTime,
      items: []
    }
  }

  if (!batchRes || batchRes.error) {
    const batchErr = batchRes?.error
    if (!batchRes || isMissingWebhookRecoveryRpc(batchErr)) {
      return {
        processed: 0,
        recovered_ingest: 0,
        recovered_autonomous: 0,
        deferred: 0,
        failed: 0,
        skipped_rpc_unavailable: true,
        elapsed_ms: Date.now() - startTime,
        items: []
      }
    }
    const errMsg = batchErr.message || JSON.stringify(batchErr)
    console.error(`[WebhookRecovery] Erro ao reivindicar lote webhook_events: ${errMsg}`)
    return {
      processed: 0,
      recovered_ingest: 0,
      recovered_autonomous: 0,
      deferred: 0,
      failed: 1,
      error: errMsg,
      elapsed_ms: Date.now() - startTime,
      items: []
    }
  }

  const items = Array.isArray(batchRes.data) ? batchRes.data : []
  if (items.length === 0) {
    return {
      processed: 0,
      recovered_ingest: 0,
      recovered_autonomous: 0,
      deferred: 0,
      failed: 0,
      elapsed_ms: Date.now() - startTime,
      items: []
    }
  }

  let recoveredIngest = 0
  let recoveredAutonomous = 0
  let deferred = 0
  let failed = 0
  const results: WebhookRecoveryItemResult[] = []

  for (const item of items) {
    const remaining = timeBudgetMs - (Date.now() - startTime)
    if (remaining < 3500) {
      deferred++
      try {
        await (supabase as any).rpc('complete_webhook_autonomous_event', {
          p_company_id: item.company_id,
          p_webhook_event_id: item.webhook_event_id,
          p_claim_token: item.claim_token,
          p_autonomous_status: 'pending',
          p_last_error: 'worker_time_budget_deferred',
          p_retry_after_sec: 5
        })
      } catch {}
      results.push({
        webhook_event_id: item.webhook_event_id,
        company_id: item.company_id,
        event_id: item.event_id,
        recovery_mode: item.recovery_mode,
        attempts: item.attempts,
        success: false,
        deferred: true,
        reason: 'time_budget_exceeded'
      })
      continue
    }

    if (item.recovery_mode === 'ingest') {
      try {
        const ingestRes = await processWebhookEvent(item.company_id, item.payload, {
          adminClient: supabase,
          retryWebhookEventRowId: item.webhook_event_id
        })
        recoveredIngest++

        let autoReason = 'ingest_only'
        if (!ingestRes.duplicate && ingestRes.conversation_id && ingestRes.message_id) {
          const remainingAfterIngest = timeBudgetMs - (Date.now() - startTime)
          if (item.payload?.message?.sender_type === 'customer' && remainingAfterIngest >= 5000) {
            const cycleRes = await handleAutonomousCycle({
              companyId: item.company_id,
              conversationId: ingestRes.conversation_id,
              messageId: ingestRes.message_id,
              eventId: item.event_id,
              payload: item.payload,
              webhookEventRowId: ingestRes.webhook_event_id || item.webhook_event_id,
              adminClient: supabase
            })
            if (cycleRes.reason === 'conversation_lock_busy' || cycleRes.reason === 'agent_engine_failed') {
              deferred++
            } else {
              recoveredAutonomous++
            }
            autoReason = cycleRes.dispatched ? 'ingest_and_autonomous_dispatched' : (cycleRes.reason || 'ingest_and_autonomous_handled')
          } else if (item.payload?.message?.sender_type === 'customer') {
            // Libera o autonomous_locked_until imediatamente para o próximo tick do worker
            try {
              await (supabase as any).rpc('complete_webhook_autonomous_event', {
                p_company_id: item.company_id,
                p_webhook_event_id: item.webhook_event_id,
                p_claim_token: null,
                p_autonomous_status: 'pending',
                p_last_error: 'ingest_recovered_autonomous_deferred',
                p_retry_after_sec: 2
              })
            } catch {}
            deferred++
            autoReason = 'ingest_recovered_autonomous_deferred'
          }
        }

        results.push({
          webhook_event_id: item.webhook_event_id,
          company_id: item.company_id,
          event_id: item.event_id,
          recovery_mode: 'ingest',
          attempts: item.attempts,
          success: true,
          reason: autoReason
        })
      } catch (err: any) {
        failed++
        results.push({
          webhook_event_id: item.webhook_event_id,
          company_id: item.company_id,
          event_id: item.event_id,
          recovery_mode: 'ingest',
          attempts: item.attempts,
          success: false,
          reason: 'ingest_recovery_failed',
          error: err?.message || String(err)
        })
      }
      continue
    }

    // recovery_mode === 'autonomous'
    if (!item.conversation_id || !item.message_id || !item.payload) {
      failed++
      try {
        await (supabase as any).rpc('complete_webhook_autonomous_event', {
          p_company_id: item.company_id,
          p_webhook_event_id: item.webhook_event_id,
          p_claim_token: item.claim_token,
          p_autonomous_status: 'failed',
          p_last_error: 'incomplete_recovery_record',
          p_retry_after_sec: null
        })
      } catch {}
      results.push({
        webhook_event_id: item.webhook_event_id,
        company_id: item.company_id,
        event_id: item.event_id,
        recovery_mode: 'autonomous',
        attempts: item.attempts,
        success: false,
        reason: 'incomplete_recovery_record'
      })
      continue
    }

    try {
      const cycleRes = await handleAutonomousCycle({
        companyId: item.company_id,
        conversationId: item.conversation_id,
        messageId: item.message_id,
        eventId: item.event_id,
        payload: item.payload,
        webhookEventRowId: item.webhook_event_id,
        autonomousClaimToken: item.claim_token,
        adminClient: supabase
      })

      const isDeferred =
        cycleRes.reason === 'conversation_lock_busy' ||
        cycleRes.reason === 'agent_engine_failed' ||
        cycleRes.reason === 'prepare_outbound_failed'

      if (isDeferred) {
        deferred++
      } else {
        recoveredAutonomous++
      }

      results.push({
        webhook_event_id: item.webhook_event_id,
        company_id: item.company_id,
        event_id: item.event_id,
        recovery_mode: 'autonomous',
        attempts: item.attempts,
        success: !isDeferred,
        deferred: isDeferred || undefined,
        reason: cycleRes.dispatched ? 'dispatched' : cycleRes.reason,
        error: cycleRes.error
      })
    } catch (err: any) {
      failed++
      try {
        await (supabase as any).rpc('complete_webhook_autonomous_event', {
          p_company_id: item.company_id,
          p_webhook_event_id: item.webhook_event_id,
          p_claim_token: item.claim_token,
          p_autonomous_status: 'pending',
          p_last_error: err?.message || 'autonomous_recovery_error',
          p_retry_after_sec: 15
        })
      } catch {}
      results.push({
        webhook_event_id: item.webhook_event_id,
        company_id: item.company_id,
        event_id: item.event_id,
        recovery_mode: 'autonomous',
        attempts: item.attempts,
        success: false,
        reason: 'autonomous_recovery_error',
        error: err?.message || String(err)
      })
    }
  }

  const elapsedMs = Date.now() - startTime
  console.log(
    JSON.stringify({
      event: 'webhook_recovery.completed',
      processed: items.length,
      recovered_ingest: recoveredIngest,
      recovered_autonomous: recoveredAutonomous,
      deferred,
      failed,
      elapsed_ms: elapsedMs
    })
  )

  return {
    processed: items.length,
    recovered_ingest: recoveredIngest,
    recovered_autonomous: recoveredAutonomous,
    deferred,
    failed,
    elapsed_ms: elapsedMs,
    items: results
  }
}
