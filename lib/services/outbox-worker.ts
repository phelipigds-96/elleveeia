import 'server-only'

import { createAdminClient } from '@/lib/supabase/service'
import { retryOutboxMessage } from '@/lib/services/message-engine'

export interface ReconcileWorkerOptions {
  adminClient?: any
  batchSize?: number
  leaseSeconds?: number
}

export interface ReconcileItemResult {
  outbox_id: string
  company_id: string
  success: boolean
  code?: string
  statusCode?: number
  suppressed?: boolean
  alreadySent?: boolean
  error?: string
}

export interface ReconcileWorkerResult {
  processed: number
  succeeded: number
  failed: number
  suppressed: number
  elapsed_ms: number
  items: ReconcileItemResult[]
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
  const batchSize = options?.batchSize && options.batchSize > 0 ? options.batchSize : 25
  const leaseSeconds = options?.leaseSeconds && options.leaseSeconds >= 15 ? options.leaseSeconds : 120

  const { data: stalledBatch, error: batchErr } = await (supabase as any).rpc(
    'claim_stalled_outbox_batch',
    {
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds
    }
  )

  if (batchErr) {
    console.error(`[OutboxWorker] Erro ao reivindicar lote de mensagens travadas: ${batchErr.message || JSON.stringify(batchErr)}`)
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      suppressed: 0,
      elapsed_ms: Date.now() - startTime,
      items: []
    }
  }

  const items = Array.isArray(stalledBatch) ? stalledBatch : []
  const results: ReconcileItemResult[] = []
  let succeeded = 0
  let failed = 0
  let suppressed = 0

  for (const item of items) {
    const outboxId = item.outbox_id
    const companyId = item.company_id

    try {
      const res = await retryOutboxMessage(companyId, outboxId, {
        adminClient: supabase,
        leaseSeconds,
        claim: {
          claim_token: item.claim_token,
          claim_version: item.claim_version,
          payload: item.payload,
          message_id: item.message_id
        }
      })

      if (res.success) {
        succeeded++
        results.push({
          outbox_id: outboxId,
          company_id: companyId,
          success: true,
          alreadySent: res.alreadySent
        })
      } else {
        if (res.suppressed) {
          suppressed++
        } else {
          failed++
        }
        results.push({
          outbox_id: outboxId,
          company_id: companyId,
          success: false,
          code: res.code,
          statusCode: res.statusCode,
          suppressed: res.suppressed,
          error: res.error
        })
      }
    } catch (err: any) {
      failed++
      console.error(`[OutboxWorker] Falha inesperada ao reconciliar outbox ${outboxId}: ${err?.message || err}`)
      results.push({
        outbox_id: outboxId,
        company_id: companyId,
        success: false,
        error: err?.message || 'Erro inesperado no processamento da outbox'
      })
    }
  }

  return {
    processed: items.length,
    succeeded,
    failed,
    suppressed,
    elapsed_ms: Date.now() - startTime,
    items: results
  }
}
