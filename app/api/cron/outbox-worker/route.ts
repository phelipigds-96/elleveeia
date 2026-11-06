import { NextResponse } from 'next/server'
import { reconcileStalledOutboxBatch } from '@/lib/services/outbox-worker'

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

  return authHeader === `Bearer ${cronSecret}`
}

function parseQueryParams(urlStr: string) {
  try {
    const url = new URL(urlStr)
    const qBatch = url.searchParams.get('batch_size') || url.searchParams.get('batchSize')
    const qLease = url.searchParams.get('lease_seconds') || url.searchParams.get('leaseSeconds')

    const batchSize = qBatch && !isNaN(Number(qBatch)) ? Math.max(1, Math.min(100, Number(qBatch))) : undefined
    const leaseSeconds = qLease && !isNaN(Number(qLease)) ? Math.max(15, Math.min(600, Number(qLease))) : undefined

    return { batchSize, leaseSeconds }
  } catch {
    return { batchSize: undefined, leaseSeconds: undefined }
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const { batchSize, leaseSeconds } = parseQueryParams(request.url)
    const result = await reconcileStalledOutboxBatch({ batchSize, leaseSeconds })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    console.error(`[Cron OutboxWorker Error] Falha na reconciliação: ${err?.message || err}`)
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no outbox worker' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  try {
    let { batchSize, leaseSeconds } = parseQueryParams(request.url)

    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}))
      if (body?.batch_size && !isNaN(Number(body.batch_size))) {
        batchSize = Math.max(1, Math.min(100, Number(body.batch_size)))
      } else if (body?.batchSize && !isNaN(Number(body.batchSize))) {
        batchSize = Math.max(1, Math.min(100, Number(body.batchSize)))
      }

      if (body?.lease_seconds && !isNaN(Number(body.lease_seconds))) {
        leaseSeconds = Math.max(15, Math.min(600, Number(body.lease_seconds)))
      } else if (body?.leaseSeconds && !isNaN(Number(body.leaseSeconds))) {
        leaseSeconds = Math.max(15, Math.min(600, Number(body.leaseSeconds)))
      }
    }

    const result = await reconcileStalledOutboxBatch({ batchSize, leaseSeconds })
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    console.error(`[Cron OutboxWorker Error] Falha na reconciliação: ${err?.message || err}`)
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no outbox worker' },
      { status: 500 }
    )
  }
}
