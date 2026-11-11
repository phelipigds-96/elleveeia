import { NextRequest, NextResponse } from 'next/server'
import { resolvePushSessionContext } from '@/lib/services/push-auth'
import { sendPushNotifications } from '@/lib/services/push-notifications'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const ctx = await resolvePushSessionContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const rawBody = await request.json().catch(() => ({}))
    const endpoint = typeof rawBody?.endpoint === 'string' && rawBody.endpoint.trim()
      ? rawBody.endpoint.trim()
      : undefined

    const result = await sendPushNotifications({
      companyId: ctx.companyId,
      userIds: [ctx.userId],
      endpoint,
      adminClient: ctx.adminClient,
      payload: {
        title: 'Ellevee IA · Teste de alerta',
        body: 'Notificações ativadas com sucesso! Você receberá alertas quando um cliente precisar de você.',
        url: '/conversations',
        tag: 'ellevee-test',
        renotify: true,
        forceShow: true,
      },
    })

    if (result.skipped) {
      if (result.reason === 'vapid_not_configured') {
        return NextResponse.json(
          { error: 'Chaves VAPID ainda não configuradas no servidor.' },
          { status: 503 }
        )
      }
      if (result.reason === 'table_not_migrated') {
        return NextResponse.json(
          { error: 'Tabela push_subscriptions ainda não migrada no Supabase.' },
          { status: 503 }
        )
      }
      return NextResponse.json(
        { error: 'Ative as notificações neste aparelho antes de testar.' },
        { status: 400 }
      )
    }

    if (result.sent === 0) {
      return NextResponse.json(
        { error: 'Este aparelho não aceitou a notificação ou o token expirou. Ative novamente.' },
        { status: 410 }
      )
    }

    return NextResponse.json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
      deactivated: result.deactivated,
    })
  } catch (error: any) {
    console.error('[Push Test Error]', error?.message || error)
    return NextResponse.json({ error: 'Erro interno ao enviar notificação de teste' }, { status: 500 })
  }
}
