import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEPRECATED_RESPONSE = {
  success: false,
  code: 'LEGACY_ENDPOINT_GONE',
  error: 'Endpoint legado descontinuado por segurança e idempotência. Utilize /api/cron/outbox-worker.'
}

function respondDeprecated(method: string) {
  console.warn(
    `[OutboxProcessor Deprecated] Requisição ${method} bloqueada em /api/outbox/process (410 Gone). Utilize /api/cron/outbox-worker.`
  )
  return NextResponse.json(DEPRECATED_RESPONSE, { status: 410 })
}

/**
 * Rota legada desativada permanentemente (fail-open e lote sem lock atômico removidos).
 */
export async function GET() {
  return respondDeprecated('GET')
}

export async function POST() {
  return respondDeprecated('POST')
}
