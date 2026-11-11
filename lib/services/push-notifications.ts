import { sendNotification, setVapidDetails } from 'web-push'
import { createAdminClient } from '@/lib/supabase/service'

export interface PushNotificationPayload {
  title: string
  body: string
  conversationId?: string
  url?: string
  tag?: string
  renotify?: boolean
  forceShow?: boolean
}

export interface SendPushParams {
  companyId: string
  assignedTo?: string | null
  userIds?: string[]
  endpoint?: string
  payload: PushNotificationPayload
  adminClient?: any
}

export interface SendPushResult {
  skipped?: boolean
  reason?: string
  sent: number
  failed: number
  deactivated: number
}

function truncateText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function getVapidConfig() {
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim()
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim()
  const subject = (process.env.VAPID_SUBJECT || 'mailto:suporte@elleveeia.com.br').trim()
  return {
    publicKey,
    privateKey,
    subject,
    isConfigured: Boolean(publicKey && privateKey),
  }
}

export async function sendPushNotifications(params: SendPushParams): Promise<SendPushResult> {
  const { publicKey, privateKey, subject, isConfigured } = getVapidConfig()
  if (!isConfigured) {
    return {
      skipped: true,
      reason: 'vapid_not_configured',
      sent: 0,
      failed: 0,
      deactivated: 0,
    }
  }

  const supabase = params.adminClient || createAdminClient()

  let query = supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .eq('company_id', params.companyId)
    .eq('is_active', true)

  if (params.endpoint) {
    query = query.eq('endpoint', params.endpoint)
  } else if (params.userIds && params.userIds.length > 0) {
    query = query.in('user_id', params.userIds)
  } else if (params.assignedTo) {
    query = query.eq('user_id', params.assignedTo)
  }

  const { data: subscriptions, error } = await query

  if (error) {
    // Tabela ainda não migrada no banco (42P01) ou indisponibilidade temporária:
    // nunca interromper fluxo de webhook ou atendimento.
    if (error.code === '42P01') {
      console.warn('[Push] Tabela push_subscriptions ainda não existe no banco.')
      return {
        skipped: true,
        reason: 'table_not_migrated',
        sent: 0,
        failed: 0,
        deactivated: 0,
      }
    }
    console.error('[Push] Erro ao consultar inscritos:', error.message)
    return {
      skipped: true,
      reason: 'query_error',
      sent: 0,
      failed: 0,
      deactivated: 0,
    }
  }

  if (!subscriptions || subscriptions.length === 0) {
    return {
      skipped: true,
      reason: 'no_active_subscriptions',
      sent: 0,
      failed: 0,
      deactivated: 0,
    }
  }

  setVapidDetails(subject, publicKey, privateKey)

  const notificationData = JSON.stringify({
    title: truncateText(params.payload.title || 'Ellevee IA', 80),
    body: truncateText(params.payload.body || 'Nova mensagem aguardando atendimento.', 140),
    conversationId: params.payload.conversationId || null,
    url:
      params.payload.url ||
      (params.payload.conversationId
        ? `/conversations?id=${encodeURIComponent(params.payload.conversationId)}`
        : '/conversations'),
    tag:
      params.payload.tag ||
      (params.payload.conversationId ? `conv-${params.payload.conversationId}` : 'ellevee-alert'),
    renotify: typeof params.payload.renotify === 'boolean' ? params.payload.renotify : false,
    forceShow: Boolean(params.payload.forceShow),
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
  })

  const sentIds: string[] = []
  const expiredIds: string[] = []
  let failed = 0

  await Promise.allSettled(
    subscriptions.map(async (sub: any) => {
      try {
        await sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          notificationData,
          { TTL: 60 * 60 }
        )
        sentIds.push(sub.id)
      } catch (err: any) {
        const statusCode = err?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          expiredIds.push(sub.id)
        } else {
          failed += 1
          console.warn(
            `[Push] Falha ao enviar para inscrição ${sub.id} (status ${statusCode || 'desconhecido'}):`,
            err?.message || err
          )
        }
      }
    })
  )

  const nowIso = new Date().toISOString()

  if (expiredIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ is_active: false, updated_at: nowIso })
      .in('id', expiredIds)
      .then(() => undefined)
      .catch((err: any) => console.warn('[Push] Falha ao desativar tokens expirados:', err?.message))
  }

  if (sentIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ last_notified_at: nowIso })
      .in('id', sentIds)
      .then(() => undefined)
      .catch(() => undefined)
  }

  return {
    sent: sentIds.length,
    failed,
    deactivated: expiredIds.length,
  }
}

export interface InboundCustomerPushParams {
  companyId: string
  conversationId: string
  senderType?: string
  messageContent?: string | null
  messageType?: string | null
  cycleReason?: string
  adminClient?: any
}

function formatMessagePreview(content?: string | null, messageType?: string | null): string {
  const cleaned = (content || '').replace(/\s+/g, ' ').trim()
  if (cleaned) {
    return truncateText(cleaned, 120)
  }
  switch (messageType) {
    case 'audio':
      return 'Nova mensagem de voz'
    case 'image':
      return 'Enviou uma imagem'
    case 'video':
      return 'Enviou um vídeo'
    case 'document':
      return 'Enviou um documento'
    default:
      return 'Nova mensagem aguardando atendimento.'
  }
}

/**
 * Regra Zero-Spam para Operação de Loja:
 * - Conversas conduzidas pela IA (status = 'open' e etapa handled_by = 'ai') NÃO disparam push.
 * - Dispara notificação apenas quando:
 *   1) Conversa está em modo humano (status === 'human')
 *   2) Etapa atual do funil exige humano/fila (handled_by === 'human' | 'waiting')
 *   3) Empresa não possui agente de IA ativo (no_active_agent) e conversa não está encerrada
 * - Se houver atendente atribuído (assigned_to), notifica apenas ele. Se null, notifica toda a fila da loja.
 */
export async function notifyPushForInboundCustomerMessage(
  params: InboundCustomerPushParams
): Promise<SendPushResult> {
  if (params.senderType !== 'customer') {
    return { skipped: true, reason: 'not_customer_message', sent: 0, failed: 0, deactivated: 0 }
  }

  if (params.cycleReason === 'tenant_blocked' || params.cycleReason === 'conversation_closed') {
    return { skipped: true, reason: params.cycleReason, sent: 0, failed: 0, deactivated: 0 }
  }

  const supabase = params.adminClient || createAdminClient()

  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('id, status, assigned_to, workflow_stage_id, customers(name, phone)')
    .eq('id', params.conversationId)
    .eq('company_id', params.companyId)
    .maybeSingle()

  if (convErr || !conversation) {
    return { skipped: true, reason: 'conversation_not_found', sent: 0, failed: 0, deactivated: 0 }
  }

  if (conversation.status === 'closed') {
    return { skipped: true, reason: 'conversation_closed', sent: 0, failed: 0, deactivated: 0 }
  }

  let stageHandledBy: string | null = null
  if (conversation.workflow_stage_id) {
    const { data: stage } = await supabase
      .from('workflow_stages')
      .select('handled_by')
      .eq('id', conversation.workflow_stage_id)
      .eq('company_id', params.companyId)
      .maybeSingle()
    stageHandledBy = stage?.handled_by || null
  }

  const isHumanMode = conversation.status === 'human'
  const isHumanOrWaitingStage = stageHandledBy === 'human' || stageHandledBy === 'waiting'
  const hasNoAiAgent = params.cycleReason === 'no_active_agent'

  if (!isHumanMode && !isHumanOrWaitingStage && !hasNoAiAgent) {
    return { skipped: true, reason: 'handled_by_ai', sent: 0, failed: 0, deactivated: 0 }
  }

  const customer = Array.isArray((conversation as any).customers)
    ? (conversation as any).customers[0]
    : (conversation as any).customers

  const customerName =
    (customer?.name && String(customer.name).trim()) ||
    (customer?.phone && String(customer.phone).trim()) ||
    'Cliente'

  const title = conversation.assigned_to
    ? customerName
    : `${customerName} (Fila)`

  const body = formatMessagePreview(params.messageContent, params.messageType)

  return sendPushNotifications({
    companyId: params.companyId,
    assignedTo: conversation.assigned_to || null,
    adminClient: supabase,
    payload: {
      title,
      body,
      conversationId: params.conversationId,
      url: `/conversations?id=${encodeURIComponent(params.conversationId)}`,
      tag: `conv-${params.conversationId}`,
      renotify: false,
    },
  })
}
