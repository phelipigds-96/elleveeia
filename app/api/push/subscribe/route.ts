import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getVapidConfig } from '@/lib/services/push-notifications'
import { resolvePushSessionContext } from '@/lib/services/push-auth'

export const runtime = 'nodejs'

const SubscribeBodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({
      p256dh: z.string().min(1).max(1000),
      auth: z.string().min(1).max(500),
    }),
  }),
  deviceLabel: z.string().max(120).optional(),
  active: z.boolean().optional(),
})

const ToggleBodySchema = z.object({
  endpoint: z.string().url().max(2000),
  active: z.boolean(),
})

const DeleteBodySchema = z.object({
  endpoint: z.string().url().max(2000),
})

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolvePushSessionContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const vapid = getVapidConfig()
    const endpoint = request.nextUrl.searchParams.get('endpoint')?.trim() || null

    const { data: rows, error } = await ctx.adminClient
      .from('push_subscriptions')
      .select('id, endpoint, is_active')
      .eq('user_id', ctx.userId)
      .eq('company_id', ctx.companyId)

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({
          configured: vapid.isConfigured,
          publicKey: vapid.publicKey || null,
          migrationPending: true,
          currentDeviceActive: false,
          hasCurrentDeviceRow: false,
          activeDevicesCount: 0,
        })
      }
      return NextResponse.json({ error: 'Falha ao consultar notificações' }, { status: 500 })
    }

    const list = rows || []
    const currentRow = endpoint ? list.find((r: any) => r.endpoint === endpoint) : null
    const activeDevicesCount = list.filter((r: any) => r.is_active).length

    return NextResponse.json({
      configured: vapid.isConfigured,
      publicKey: vapid.publicKey || null,
      migrationPending: false,
      currentDeviceActive: Boolean(currentRow?.is_active),
      hasCurrentDeviceRow: Boolean(currentRow),
      activeDevicesCount,
    })
  } catch (error: any) {
    console.error('[Push GET Error]', error?.message || error)
    return NextResponse.json({ error: 'Erro interno ao consultar status de push' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await resolvePushSessionContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const rawBody = await request.json().catch(() => null)
    const parsed = SubscribeBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados de inscrição inválidos' },
        { status: 400 }
      )
    }

    const { subscription, deviceLabel, active } = parsed.data
    const userAgent = request.headers.get('user-agent')?.slice(0, 500) || null

    const { error } = await ctx.adminClient
      .from('push_subscriptions')
      .upsert(
        {
          company_id: ctx.companyId,
          user_id: ctx.userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          user_agent: userAgent,
          device_label: deviceLabel || null,
          is_active: active ?? true,
        },
        { onConflict: 'user_id,endpoint' }
      )

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json(
          { error: 'Tabela push_subscriptions pendente de migração no Supabase.' },
          { status: 503 }
        )
      }
      console.error('[Push POST Error]', error.message)
      return NextResponse.json({ error: 'Não foi possível salvar inscrição' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, isActive: active ?? true })
  } catch (error: any) {
    console.error('[Push POST Error]', error?.message || error)
    return NextResponse.json({ error: 'Erro interno ao registrar push' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await resolvePushSessionContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const rawBody = await request.json().catch(() => null)
    const parsed = ToggleBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
    }

    const { error } = await ctx.adminClient
      .from('push_subscriptions')
      .update({
        is_active: parsed.data.active,
        company_id: ctx.companyId,
      })
      .eq('user_id', ctx.userId)
      .eq('endpoint', parsed.data.endpoint)

    if (error) {
      console.error('[Push PATCH Error]', error.message)
      return NextResponse.json({ error: 'Falha ao atualizar preferência' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, isActive: parsed.data.active })
  } catch (error: any) {
    console.error('[Push PATCH Error]', error?.message || error)
    return NextResponse.json({ error: 'Erro interno ao atualizar push' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await resolvePushSessionContext()
    if (!ctx) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
    }

    const queryEndpoint = request.nextUrl.searchParams.get('endpoint')
    const rawBody = queryEndpoint ? { endpoint: queryEndpoint } : await request.json().catch(() => null)
    const parsed = DeleteBodySchema.safeParse(rawBody)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Endpoint inválido' }, { status: 400 })
    }

    const { error } = await ctx.adminClient
      .from('push_subscriptions')
      .delete()
      .eq('user_id', ctx.userId)
      .eq('endpoint', parsed.data.endpoint)

    if (error) {
      console.error('[Push DELETE Error]', error.message)
      return NextResponse.json({ error: 'Falha ao remover inscrição' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[Push DELETE Error]', error?.message || error)
    return NextResponse.json({ error: 'Erro interno ao remover push' }, { status: 500 })
  }
}
