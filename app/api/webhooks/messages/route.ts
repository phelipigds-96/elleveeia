import { NextResponse } from 'next/server'
import { validateWebhookPayload } from '@/lib/validations/webhook'
import { processWebhookEvent, handleAutonomousCycle } from '@/lib/services/message-engine'
import { createAdminClient } from '@/lib/supabase/service'

export async function POST(request: Request) {
  const startTime = Date.now()
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()
  
  try {
    const secret = request.headers.get('x-ellevee-webhook-secret')
    if (!secret) {
      return NextResponse.json({ error: 'Credenciais de Webhook ausentes' }, { status: 401 })
    }

    // 1. Autenticacao Isolada do Webhook
    // Utilizamos o Supabase com Service Role pois estamos fora da sessao de usuario.
    // O secret enviado no header identifica rigidamente o company_id no banco.
    const supabase = createAdminClient()
    const { data: apiKey } = await supabase.from('api_keys').select('company_id').eq('key', secret).single()
    
    if (!apiKey) {
      return NextResponse.json({ error: 'Credenciais de Webhook invalidas' }, { status: 401 })
    }

    const companyId = apiKey.company_id
    
    // 2. Extracao e Validacao do Payload
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Formato de Payload invalido' }, { status: 400 })
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
    const cycleResult = await handleAutonomousCycle({
      companyId,
      conversationId: result.conversation_id,
      messageId: result.message_id,
      eventId: result.event_id,
      payload: body
    }).catch(err => {
      console.error(`[AutonomousCycle Error req:${requestId}]`, err.message)
      return { executed: false, reason: 'unhandled_cycle_error', error: err.message }
    })
    
    // 6. Logging Seguro de Servidor (Sem vazar segredos)
    console.log(`[Webhook success req:${requestId}] company:${companyId} event:${result.event_id} autonomous:${cycleResult?.executed ? (cycleResult.dispatched ? 'dispatched' : cycleResult.reason) : cycleResult?.reason} - ${Date.now() - startTime}ms`)

    return NextResponse.json(result, { status: 200 })

  } catch (error: any) {
    console.error(`[Webhook error req:${requestId}]`, error.message)
    // Protege stack trace e SQL errors, vazando apenas falha interna
    return NextResponse.json({ error: 'Erro interno durante processamento' }, { status: 500 })
  }
}