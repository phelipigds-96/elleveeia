export interface WebhookPayload {
  event_id: string
  event_type: string
  channel: string
  external_customer_id?: string
  customer: {
    name: string
    phone: string
    email?: string
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

// Uma forma robusta de validação de payload sem precisar instalar pacotes complexos (como Zod) nesta fase
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

  return true
}
