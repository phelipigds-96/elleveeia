import { NextResponse } from 'next/server'
import { validateWebhookStatusPayload } from '@/lib/validations/webhook'
import { updateMessageDeliveryStatus } from '@/lib/services/message-engine'
import { createAdminClient } from '@/lib/supabase/service'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const startTime = Date.now()
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()

  try {
    const url = new URL(request.url)
    const rawSecret =
      request.headers.get('x-ellevee-webhook-secret') ||
      url.searchParams.get('token') ||
      url.searchParams.get('secret') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

    const secret = rawSecret ? rawSecret.trim().replace(/^['"]|['"]$/g, '') : null

    if (!secret) {
      return NextResponse.json(
        { error: 'Credenciais de Webhook ausentes (informe via header x-ellevee-webhook-secret ou ?token=...)' },
        { status: 401 }
      )
    }

    const supabase = createAdminClient()
    let companyId: string | null = null

    // 1.1 Tenta autenticar por api_keys
    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('company_id')
      .eq('key', secret)
      .maybeSingle()

    if (apiKey?.company_id) {
      companyId = apiKey.company_id
    } else {
      // 1.2 Tenta autenticar pelo secret cadastrado na integracao n8n da empresa
      const { data: integration } = await supabase
        .from('integrations')
        .select('company_id')
        .eq('type', 'n8n')
        .eq('status', 'active')
        .eq('credentials->>webhook_secret', secret)
        .maybeSingle()

      if (integration?.company_id) {
        companyId = integration.company_id
      }
    }

    if (!companyId) {
      return NextResponse.json({ error: 'Credenciais de Webhook invalidas' }, { status: 401 })
    }

    // 2. Validação de Ciclo de Vida do Tenant (Fail-closed)
    try {
      await requireActiveCompany(companyId, { adminClient: supabase })
    } catch (err: any) {
      if (err instanceof TenantAccessError) {
        if (err.code === 'TENANT_STATUS_UNAVAILABLE') {
          return NextResponse.json({ accepted: false, error: 'Serviço temporariamente indisponível' }, { status: 503 })
        }
        const reasonMap: Record<string, string> = {
          TENANT_SUSPENDED: 'tenant_suspended',
          TENANT_CANCELLED: 'tenant_cancelled',
          TENANT_PROVISIONING: 'tenant_provisioning',
          TENANT_NOT_FOUND: 'tenant_not_found',
          INVALID_COMPANY_ID: 'invalid_company_id'
        }
        const reason = reasonMap[err.code] || 'tenant_blocked'
        console.warn(`[StatusCallback Tenant Blocked req:${requestId}] company:${companyId} code:${err.code} reason:${reason}`)
        return NextResponse.json({ accepted: false, reason }, { status: 200 })
      }
      return NextResponse.json({ accepted: false, error: 'Falha ao verificar autorização da empresa' }, { status: 503 })
    }

    // 3. Extração e Validação do Payload
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Formato de Payload invalido' }, { status: 400 })
    }

    if (!validateWebhookStatusPayload(body)) {
      return NextResponse.json({ error: 'Estrutura de status callback invalida' }, { status: 400 })
    }

    // 4. Atualização Monotônica do Status de Entrega
    const result = await updateMessageDeliveryStatus(companyId, {
      messageId: body.message_id,
      providerMessageId: body.provider_message_id,
      status: body.status,
      timestamp: body.timestamp,
      error: body.error,
      adminClient: supabase
    })

    console.log(`[StatusCallback req:${requestId}] company:${companyId} event:${body.event_id} status:${body.status} updated:${result.updated} - ${Date.now() - startTime}ms`)

    return NextResponse.json(result, { status: 200 })

  } catch (error: any) {
    console.error(`[StatusCallback error req:${requestId}]`, error.message)
    return NextResponse.json({ error: 'Erro interno durante processamento do status' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/status',
    description: 'Ellevee Webhook Status Endpoint para confirmações de entrega (sent, delivered, read, failed).'
  }, { status: 200 })
}
