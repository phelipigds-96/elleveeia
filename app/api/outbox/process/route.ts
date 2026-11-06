import { NextResponse } from 'next/server'
import { processOutboxBatch } from '@/lib/services/outbox-dispatcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Validação de autorização do processador de outbox.
 * Suporta:
 * 1. Bearer Token no cabeçalho Authorization
 * 2. Cabeçalho x-cron-secret ou x-api-key
 * 3. Query param ?secret=... ou ?token=...
 * Caso CRON_SECRET não esteja definido no ambiente (ex: desenvolvimento local), permite execução controlada.
 */
function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return true
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.trim() === `Bearer ${cronSecret}`) {
    return true
  }

  const headerSecret = request.headers.get('x-cron-secret') || request.headers.get('x-api-key')
  if (headerSecret && headerSecret === cronSecret) {
    return true
  }

  try {
    const url = new URL(request.url)
    const token = url.searchParams.get('secret') || url.searchParams.get('token')
    if (token && token === cronSecret) {
      return true
    }
  } catch {}

  return false
}

/**
 * Handler GET: permite trigger manual ou via agendador cron da Vercel.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    const qBatch = url.searchParams.get('batch_size') || url.searchParams.get('batchSize')
    const qLease = url.searchParams.get('lease_seconds') || url.searchParams.get('leaseSeconds')
    const qMock = url.searchParams.get('mock') === 'true'

    const batchSize = qBatch && !isNaN(Number(qBatch)) ? Number(qBatch) : undefined
    const leaseSeconds = qLease && !isNaN(Number(qLease)) ? Number(qLease) : undefined

    const result = await processOutboxBatch({ batchSize, leaseSeconds, mock: qMock })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[OutboxProcessor GET Error]:', err?.message || err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no processamento da outbox' },
      { status: 500 }
    )
  }
}

/**
 * Handler POST: permite trigger via webhook com payload configurável.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Não autorizado' }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    let batchSize = url.searchParams.get('batch_size') ? Number(url.searchParams.get('batch_size')) : undefined
    let leaseSeconds = url.searchParams.get('lease_seconds') ? Number(url.searchParams.get('lease_seconds')) : undefined
    let mock = url.searchParams.get('mock') === 'true'

    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}))
      if (body?.batch_size && !isNaN(Number(body.batch_size))) {
        batchSize = Number(body.batch_size)
      } else if (body?.batchSize && !isNaN(Number(body.batchSize))) {
        batchSize = Number(body.batchSize)
      }

      if (body?.lease_seconds && !isNaN(Number(body.lease_seconds))) {
        leaseSeconds = Number(body.lease_seconds)
      } else if (body?.leaseSeconds && !isNaN(Number(body.leaseSeconds))) {
        leaseSeconds = Number(body.leaseSeconds)
      }

      if (body?.mock === true) {
        mock = true
      }
    }

    const result = await processOutboxBatch({ batchSize, leaseSeconds, mock })
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[OutboxProcessor POST Error]:', err?.message || err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Erro interno no processamento da outbox' },
      { status: 500 }
    )
  }
}
