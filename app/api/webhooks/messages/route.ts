import { NextResponse } from 'next/server'
import { validateWebhookPayload, validateWebhookStatusPayload } from '@/lib/validations/webhook'
import { processWebhookEvent, handleAutonomousCycle, updateMessageDeliveryStatus, type AutonomousCycleResult } from '@/lib/services/message-engine'
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
      return NextResponse.json({ error: 'Credenciais de Webhook ausentes (informe via header x-ellevee-webhook-secret ou ?token=...)' }, { status: 401 })
    }

    // 1. Autenticacao Isolada do Webhook
    // Identifica rigidamente o company_id consultando api_keys ou integrations (n8n ativo)
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

    // 1.3 Validação de Ciclo de Vida do Tenant (Fail-closed)
    // Impede que eventos de empresas suspensas, canceladas ou em implantação
    // gerem registros operacionais, mensagens, conversas ou chamadas a LLMs.
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
        console.warn(`[Webhook Tenant Blocked req:${requestId}] company:${companyId} code:${err.code} reason:${reason}`)
        return NextResponse.json({ accepted: false, reason }, { status: 200 })
      }
      return NextResponse.json({ accepted: false, error: 'Falha ao verificar autorização da empresa' }, { status: 503 })
    }
    
    // 2. Extracao e Validacao do Payload
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Formato de Payload invalido' }, { status: 400 })
    }

    // Suporte unificado a Callbacks de Status no endpoint principal de mensagens
    if (body?.event_type === 'message.status') {
      if (!validateWebhookStatusPayload(body)) {
        return NextResponse.json({ error: 'Estrutura de status callback invalida' }, { status: 400 })
      }
      const statusRes = await updateMessageDeliveryStatus(companyId, {
        messageId: body.message_id,
        providerMessageId: body.provider_message_id,
        status: body.status,
        timestamp: body.timestamp,
        error: body.error,
        adminClient: supabase
      })
      console.log(`[Webhook Status req:${requestId}] company:${companyId} event:${body.event_id} status:${body.status} updated:${statusRes.updated} - ${Date.now() - startTime}ms`)
      return NextResponse.json(statusRes, { status: 200 })
    }

    if (!validateWebhookPayload(body)) {
      return NextResponse.json({ error: 'Estrutura de evento nao suportada' }, { status: 400 })
    }

    // 3. Processamento via Motor de Mensagens (Idempotencia e persistencia da mensagem de entrada)
    const result = await processWebhookEvent(companyId, body)

    // 4. Se for evento duplicado ou sem IDs, interrompe imediatamente preservando o contrato HTTP (Regra 4)
    if (result.duplicate || !result.conversation_id || !result.message_id) {
      console.log(`[Webhook duplicate req:${requestId}] company:${companyId} event:${result.event_id} - ${Date.now() - startTime}ms`)
      return NextResponse.json(result, { status: 200 })
    }

    // 5. Execucao do Ciclo Autonomo de Atendimento (Validacao, Agent Engine, Handoff check e envio via n8n)
    const cycleResult: AutonomousCycleResult = await handleAutonomousCycle({
      companyId,
      conversationId: result.conversation_id,
      messageId: result.message_id,
      eventId: result.event_id,
      payload: body
    }).catch(err => {
      console.error(`[AutonomousCycle Error req:${requestId}]`, err.message)
      return { executed: false, dispatched: false, reason: 'unhandled_cycle_error', error: err.message }
    })
    
    // 6. Logging Seguro de Servidor (Sem vazar segredos)
    const statusLabel = cycleResult.dispatched ? 'dispatched' : (cycleResult.reason || 'skipped')
    console.log(`[Webhook success req:${requestId}] company:${companyId} event:${result.event_id} autonomous:${statusLabel} - ${Date.now() - startTime}ms`)

    return NextResponse.json(result, { status: 200 })

  } catch (error: any) {
    console.error(`[Webhook error req:${requestId}]`, error.message)
    // Protege stack trace e SQL errors, vazando apenas falha interna
    return NextResponse.json({ error: 'Erro interno durante processamento' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: '/api/webhooks/messages',
    description: 'Ellevee Webhook Endpoint. Envie requisicoes POST com payload e autenticacao via secret/token.'
  }, { status: 200 })
}