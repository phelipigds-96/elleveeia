import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { reconcileStalledOutboxBatch, reconcileStalledWebhookEventsBatch } from '@/lib/services/outbox-worker'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return false
  }

  const authHeader = request.headers.get('authorization')
  if (!authHeader) {
    return false
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, 'utf8')
  const received = Buffer.from(authHeader, 'utf8')
  if (expected.length !== received.length) {
    return false
  }

  return crypto.timingSafeEqual(expected, received)
}

function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return Math.max(min, Math.min(max, Math.floor(num)))
}

function parseQueryParams(urlStr: string) {
  try {
    const url = new URL(urlStr)
    const batchSize = clampNumber(
      url.searchParams.get('batch_size') || url.searchParams.get('batchSize'),
      1,
      100
    )
    const leaseSeconds = clampNumber(
      url.searchParams.get('lease_seconds') || url.searchParams.get('leaseSeconds'),
      15,
      600
    )
    return { batchSize, leaseSeconds }
  } catch {
    return { batchSize: undefined, leaseSeconds: undefined }
  }
}

async function resolveWorkerOptions(request: Request, method: 'GET' | 'POST') {
  let { batchSize, leaseSeconds } = parseQueryParams(request.url)

  if (method === 'POST') {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}))
      const bodyBatch = clampNumber(body?.batch_size ?? body?.batchSize, 1, 100)
      const bodyLease = clampNumber(body?.lease_seconds ?? body?.leaseSeconds, 15, 600)
      if (bodyBatch !== undefined) batchSize = bodyBatch
      if (bodyLease !== undefined) leaseSeconds = bodyLease
    }
  }

  return { batchSize, leaseSeconds }
}

async function handleWorkerRequest(request: Request, method: 'GET' | 'POST') {
  if (!isAuthorized(request)) {
    console.warn(
      JSON.stringify({
        event: 'outbox_worker.http_unauthorized',
        method,
        has_cron_secret: Boolean(process.env.CRON_SECRET)
      })
    )
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const startedAt = Date.now()

  try {
    const { batchSize, leaseSeconds } = await resolveWorkerOptions(request, method)
    const result = await reconcileStalledOutboxBatch({ batchSize, leaseSeconds })

    const totalBudgetMs = 19000
    const remainingBudgetMs = totalBudgetMs - (Date.now() - startedAt)
    const webhookRecovery = remainingBudgetMs >= 4500
      ? await reconcileStalledWebhookEventsBatch({
          batchSize: Math.min(batchSize ?? 5, 3),
          leaseSeconds: Math.min(leaseSeconds ?? 90, 120),
          timeBudgetMs: remainingBudgetMs
        })
      : {
          processed: 0,
          recovered_ingest: 0,
          recovered_autonomous: 0,
          deferred: 0,
          failed: 0,
          skipped_due_to_budget: true,
          elapsed_ms: 0,
          items: []
        }

    console.log(
      JSON.stringify({
        event: 'outbox_worker.http_completed',
        method,
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        suppressed: result.suppressed,
        deferred: result.deferred || 0,
        webhook_recovery_processed: webhookRecovery.processed,
        webhook_recovery_autonomous: webhookRecovery.recovered_autonomous,
        webhook_recovery_ingest: webhookRecovery.recovered_ingest,
        elapsed_ms: Date.now() - startedAt
      })
    )

    return NextResponse.json({ success: true, ...result, webhook_recovery: webhookRecovery })
  } catch (err: any) {
    console.error(
      JSON.stringify({
        event: 'outbox_worker.http_failed',
        method,
        elapsed_ms: Date.now() - startedAt,
        error: err?.message || String(err)
      })
    )
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no outbox worker' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return handleWorkerRequest(request, 'GET')
}

export async function POST(request: Request) {
  return handleWorkerRequest(request, 'POST')
}
