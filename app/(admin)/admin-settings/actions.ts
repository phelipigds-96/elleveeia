"use server"

import { revalidatePath } from "next/cache"
import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { executeAuditedAction } from "@/lib/services/platform/audit"
import {
  getOperationalTelemetry,
  recordCronExecutionLog,
  reprocessDeadLetterOutboxItem,
  reprocessDeadLetterWebhookEvent,
  type OperationalTelemetrySummary,
  type ReprocessDeadLetterResult,
} from "@/lib/services/platform/observability"
import {
  getTenantGovernanceReport,
  traceEventCorrelation,
  type TenantGovernanceReport,
  type EventCorrelationTrace,
} from "@/lib/services/platform/tenant-governance"

function safeRevalidateObservabilityPaths() {
  try {
    revalidatePath("/admin-settings")
    revalidatePath("/paineladmin")
    revalidatePath("/audit")
  } catch {
    // Ignora erro de revalidação fora do ciclo HTTP Next.js
  }
}

export async function refreshTelemetryAction(): Promise<{
  success: boolean
  data?: OperationalTelemetrySummary
  error?: string
}> {
  try {
    await requirePlatformAdmin()
    const telemetry = await getOperationalTelemetry({ cronLimit: 25, dlqLimit: 30 })
    return { success: true, data: telemetry }
  } catch (err: any) {
    return { success: false, error: err?.message || "Falha ao atualizar telemetria." }
  }
}

export async function triggerManualWorkerAction(): Promise<{
  success: boolean
  telemetry?: OperationalTelemetrySummary
  summary?: {
    outboxProcessed: number
    outboxSucceeded: number
    webhookProcessed: number
    webhookRecovered: number
    durationMs: number
  }
  error?: string
}> {
  try {
    const context = await requirePlatformAdmin()
    const { createAdminClient } = await import("@/lib/supabase/service")
    const adminClient = createAdminClient()

    const { reconcileStalledOutboxBatch, reconcileStalledWebhookEventsBatch } = await import(
      "@/lib/services/outbox-worker"
    )

    const startedAt = Date.now()
    const runResult = await executeAuditedAction(
      context,
      {
        action: "cron.manual_triggered",
        payloadSummary: { mode: "manual", triggered_by: context.operator.email },
        reason: "Execução manual do worker de reconciliação via SuperAdmin",
      },
      async () => {
        const outboxRes = await reconcileStalledOutboxBatch({
          adminClient,
          batchSize: 10,
          leaseSeconds: 120,
          timeBudgetMs: 14000,
        })

        const remainingMs = 19000 - (Date.now() - startedAt)
        const webhookRes =
          remainingMs >= 4500
            ? await reconcileStalledWebhookEventsBatch({
                adminClient,
                batchSize: 3,
                leaseSeconds: 90,
                timeBudgetMs: remainingMs,
              })
            : {
                processed: 0,
                recovered_ingest: 0,
                recovered_autonomous: 0,
                deferred: 0,
                failed: 0,
                skipped_due_to_budget: true,
                elapsed_ms: 0,
                items: [],
              }

        const totalDurationMs = Date.now() - startedAt
        await recordCronExecutionLog(
          {
            workerName: "outbox-worker",
            method: "MANUAL",
            httpStatus: 200,
            durationMs: totalDurationMs,
            outbox: outboxRes,
            webhookRecovery: webhookRes,
            details: { triggered_by: context.operator.email },
          },
          { adminClient }
        )

        return {
          outboxProcessed: outboxRes.processed,
          outboxSucceeded: outboxRes.succeeded,
          webhookProcessed: webhookRes.processed,
          webhookRecovered: webhookRes.recovered_ingest + webhookRes.recovered_autonomous,
          durationMs: totalDurationMs,
        }
      },
      adminClient
    )

    const telemetry = await getOperationalTelemetry({ adminClient, cronLimit: 25, dlqLimit: 30 })
    safeRevalidateObservabilityPaths()

    return {
      success: true,
      telemetry,
      summary: runResult,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Falha ao executar worker manualmente.",
    }
  }
}

export async function reprocessOutboxDlqAction(outboxId: string): Promise<{
  success: boolean
  result?: ReprocessDeadLetterResult
  telemetry?: OperationalTelemetrySummary
  error?: string
}> {
  try {
    const context = await requirePlatformAdmin()
    const { createAdminClient } = await import("@/lib/supabase/service")
    const adminClient = createAdminClient()

    const { data: outboxRow } = await adminClient
      .from("message_outbox")
      .select("company_id")
      .eq("id", outboxId)
      .maybeSingle()

    const targetCompanyId = outboxRow?.company_id || null

    const res = await executeAuditedAction(
      context,
      {
        action: "dlq.outbox_reprocessed",
        targetCompanyId,
        payloadSummary: { outbox_id: outboxId },
        reason: "Reprocessamento manual de item da Dead Letter Queue (Outbox)",
      },
      async () => {
        const opRes = await reprocessDeadLetterOutboxItem(outboxId, { adminClient })
        if (!opRes.success) {
          throw new Error(opRes.error || "Não foi possível reprocessar a outbox.")
        }
        return opRes
      },
      adminClient
    )

    const telemetry = await getOperationalTelemetry({ adminClient, cronLimit: 25, dlqLimit: 30 })
    safeRevalidateObservabilityPaths()

    return { success: true, result: res, telemetry }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao reprocessar item da outbox." }
  }
}

export async function reprocessWebhookDlqAction(webhookEventId: string): Promise<{
  success: boolean
  result?: ReprocessDeadLetterResult
  telemetry?: OperationalTelemetrySummary
  error?: string
}> {
  try {
    const context = await requirePlatformAdmin()
    const { createAdminClient } = await import("@/lib/supabase/service")
    const adminClient = createAdminClient()

    const { data: webhookRow } = await adminClient
      .from("webhook_events")
      .select("company_id, event_id")
      .eq("id", webhookEventId)
      .maybeSingle()

    const res = await executeAuditedAction(
      context,
      {
        action: "dlq.webhook_reprocessed",
        targetCompanyId: webhookRow?.company_id || null,
        payloadSummary: {
          webhook_event_id: webhookEventId,
          event_id: webhookRow?.event_id || null,
        },
        reason: "Replay manual de evento da Dead Letter Queue (Webhook)",
      },
      async () => {
        const opRes = await reprocessDeadLetterWebhookEvent(webhookEventId, { adminClient })
        if (!opRes.success) {
          throw new Error(opRes.error || "Não foi possível reprocessar o evento webhook.")
        }
        return opRes
      },
      adminClient
    )

    const telemetry = await getOperationalTelemetry({ adminClient, cronLimit: 25, dlqLimit: 30 })
    safeRevalidateObservabilityPaths()

    return { success: true, result: res, telemetry }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao reprocessar evento webhook." }
  }
}

export async function refreshTenantGovernanceAction(daysWindow = 30): Promise<{
  success: boolean
  data?: TenantGovernanceReport
  error?: string
}> {
  try {
    await requirePlatformAdmin()
    const report = await getTenantGovernanceReport({ daysWindow })
    return { success: true, data: report }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Falha ao consolidar governança e custos multi-tenant.",
    }
  }
}

export async function traceEventCorrelationAction(query: string): Promise<{
  success: boolean
  data?: EventCorrelationTrace
  error?: string
}> {
  try {
    await requirePlatformAdmin()
    const trace = await traceEventCorrelation(query)
    return { success: true, data: trace }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Falha ao rastrear correlação do evento.",
    }
  }
}
