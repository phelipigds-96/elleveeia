import { NextResponse } from 'next/server'
import { validateWebhookPayload } from '@/lib/validations/webhook'
import { processWebhookEvent } from '@/lib/services/message-engine'
import { createAdminClient } from '@/lib/supabase/service'

export async function POST(request: Request) {
  const startTime = Date.now()
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID()
  
  try {
    const secret = request.headers.get('x-ellevee-webhook-secret')
    if (!secret) {
      return NextResponse.json({ error: 'Credenciais de Webhook ausentes' }, { status: 401 })
    }

    // 1. Autenticação Isolada do Webhook
    // Utilizamos o Supabase com Service Role pois estamos fora da sessão de usuário.
    // O secret enviado no header identifica rigidamente o company_id no banco.
    const supabase = createAdminClient()
    const { data: apiKey } = await supabase.from('api_keys').select('company_id').eq('key', secret).single()
    
    if (!apiKey) {
      return NextResponse.json({ error: 'Credenciais de Webhook inválidas' }, { status: 401 })
    }

    const companyId = apiKey.company_id
    
    // 2. Extração e Validação do Payload
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Formato de Payload inválido' }, { status: 400 })
    }

    if (!validateWebhookPayload(body)) {
      return NextResponse.json({ error: 'Estrutura de evento não suportada' }, { status: 400 })
    }

    // 3. Processamento via Motor de Mensagens
    const result = await processWebhookEvent(companyId, body)
    
    // 4. Logging Seguro de Servidor
    console.log(`[Webhook success req:${requestId}] company:${companyId} event:${result.event_id} - ${Date.now() - startTime}ms`)

    return NextResponse.json(result, { status: 200 })

  } catch (error: any) {
    console.error(`[Webhook error req:${requestId}]`, error.message)
    // Protege stack trace e SQL errors, vazando apenas falha interna
    return NextResponse.json({ error: 'Erro interno durante processamento' }, { status: 500 })
  }
}
