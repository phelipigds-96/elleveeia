import { z } from 'zod'

export interface WebhookPayload {
  event_id: string
  event_type: string
  channel: string
  external_customer_id?: string
  customer: {
    name: string
    phone: string
    email?: string
    avatar_url?: string
    profile_picture_url?: string
  }
  conversation?: {
    external_id?: string
  }
  message: {
    external_id?: string
    sender_type: 'customer' | 'agent' | 'human' | 'system'
    content: string
    message_type?: string
    created_at?: string
  }
  metadata?: Record<string, any>
}

// Validação robusta de payload de mensagem inbound
export function validateWebhookPayload(payload: any): payload is WebhookPayload {
  if (!payload || typeof payload !== 'object') return false

  // Validadores do header do evento
  if (typeof payload.event_id !== 'string') return false
  if (typeof payload.event_type !== 'string') return false
  if (typeof payload.channel !== 'string') return false

  // Validador de cliente
  if (!payload.customer || typeof payload.customer !== 'object') return false
  if (typeof payload.customer.name !== 'string') return false
  if (typeof payload.customer.phone !== 'string') return false

  // Validador da mensagem
  if (!payload.message || typeof payload.message !== 'object') return false
  if (typeof payload.message.content !== 'string') return false
  
  const validSenders = ['customer', 'agent', 'human', 'system']
  if (!validSenders.includes(payload.message.sender_type)) return false

  // Validador de timestamp da mensagem (quando informado)
  if (payload.message.created_at !== undefined) {
    if (typeof payload.message.created_at !== 'string') return false
    const parsedTime = Date.parse(payload.message.created_at)
    if (isNaN(parsedTime)) return false
    const maxFutureMs = Date.now() + 48 * 60 * 60 * 1000
    if (parsedTime > maxFutureMs) return false
  }

  return true
}

// ==============================================================================
// SCHEMA E VALIDAÇÃO DE CALLBACKS DE STATUS (FASE 1)
// ==============================================================================

export const DELIVERY_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed'] as const
export type DeliveryStatus = typeof DELIVERY_STATUSES[number]

export const webhookStatusSchema = z.object({
  event_id: z.string().min(1, 'event_id é obrigatório'),
  event_type: z.literal('message.status'),
  channel: z.string().optional().default('whatsapp'),
  message_id: z.string().optional(),
  provider_message_id: z.string().optional(),
  recipient_phone: z.string().optional(),
  status: z.enum(DELIVERY_STATUSES, {
    errorMap: () => ({ message: `Status inválido. Permitidos: ${DELIVERY_STATUSES.join(', ')}` })
  }),
  timestamp: z.string().optional(),
  error: z.string().optional(),
  metadata: z.record(z.any()).optional()
}).refine(
  data => Boolean((data.message_id && data.message_id.trim() !== '') || (data.provider_message_id && data.provider_message_id.trim() !== '')),
  {
    message: 'Pelo menos um identificador (message_id ou provider_message_id) deve ser informado.'
  }
)

export type WebhookStatusPayload = z.infer<typeof webhookStatusSchema>

export function validateWebhookStatusPayload(payload: any): payload is WebhookStatusPayload {
  const result = webhookStatusSchema.safeParse(payload)
  return result.success
}
