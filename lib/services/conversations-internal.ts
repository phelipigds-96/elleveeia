import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'

/**
 * Semântica de confirmação de envio manual:
 * 
 * - gatewayDispatched: true -> O gateway de saída (n8n/webhook) recebeu e aceitou a solicitação HTTP (200 OK).
 * - externalDeliveryConfirmed: true -> [DEPRECATED] Mantido apenas para compatibilidade temporária com código legado.
 * 
 * IMPORTANTE:
 * O aceite do gateway NÃO certifica entrega física ao dispositivo do destinatário ('delivered')
 * nem confirmação de leitura ('read'). Esses eventos ocorrem exclusivamente de forma assíncrona
 * via webhooks de status de entrega (DLR). O status 'sent' no SaaS representa que o disparo
 * foi transmitido com sucesso ao gateway de mensageria.
 */
export type SendMessageResult = 
  | { 
      success: true
      message: any
      gatewayDispatched: true
      /**
       * @deprecated Utilize `gatewayDispatched`.
       * Significa estritamente que o despacho foi aceito pelo gateway externo (HTTP 200).
       * Não atesta entrega final no aparelho ('delivered') nem confirmação de leitura ('read').
       */
      externalDeliveryConfirmed?: boolean
      persistedStatus: 'sent' | 'pending'
      warning?: string
      inconsistency?: boolean
    }
  | { 
      success: false
      error: string
      code?: string
      reason?: string
      message?: any
      gatewayDispatched: false
      /**
       * @deprecated Utilize `gatewayDispatched`.
       */
      externalDeliveryConfirmed?: boolean
    }

export interface SendMessageInternalContext {
  userId: string
  companyId: string
  supabaseClient?: any
  adminClient?: any
}

/**
 * Serviço interno de execução de envio manual.
 * 
 * Este módulo NÃO possui a diretiva use-server e JAMAIS deve ser exposto como Server Action.
 * Exige identificadores (userId, companyId) rigorosamente validados pelo chamador confiável de backend.
 */
export async function sendManualMessageInternal(
  conversationId: string,
  content: string,
  context: SendMessageInternalContext
): Promise<SendMessageResult> {
  if (!content || !content.trim()) {
    return {
      success: false,
      error: 'O conteúdo da mensagem não pode ser vazio.',
      code: 'INVALID_CONTENT',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  const { userId, companyId } = context
  if (!userId) {
    return {
      success: false,
      error: 'Usuário não autenticado.',
      code: 'UNAUTHORIZED',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  if (!companyId) {
    return {
      success: false,
      error: 'Empresa do usuário não identificada.',
      code: 'COMPANY_NOT_FOUND',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  const supabase = context.supabaseClient || createClient()
  const adminClient = context.adminClient || supabase

  // 1. Validar que a conversa existe e pertence a esta empresa (Prevenção Cross-Tenant)
  const { data: conv, error: convError } = await supabase
    .from('conversations')
    .select('id, company_id, channel, customers(phone)')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (convError || !conv) {
    return {
      success: false,
      error: 'Conversa não encontrada ou não pertence a esta empresa.',
      code: 'CONVERSATION_NOT_FOUND',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  // 2. Validação central do ciclo de vida do tenant (Fail-closed)
  // DEVE ocorrer ANTES de qualquer persistência em 'messages'
  try {
    await requireActiveCompany(companyId, { adminClient })
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      console.warn(`[sendMessageInternal] TenantAccessError para empresa ${companyId}:`, err.code, err.message)
      let userMsg = 'Empresa não autorizada a realizar operações comerciais.'
      if (err.code === 'TENANT_SUSPENDED') {
        userMsg = 'A empresa está suspensa e não pode enviar mensagens.'
      } else if (err.code === 'TENANT_CANCELLED') {
        userMsg = 'A empresa foi cancelada e não pode enviar mensagens.'
      } else if (err.code === 'TENANT_PROVISIONING') {
        userMsg = 'A empresa está em provisionamento e ainda não pode enviar mensagens.'
      } else if (err.code === 'TENANT_STATUS_UNAVAILABLE') {
        userMsg = 'Status da empresa indisponível. Envio bloqueado por segurança.'
      }
      return {
        success: false,
        error: userMsg,
        code: err.code,
        reason: 'tenant_blocked',
        gatewayDispatched: false,
        externalDeliveryConfirmed: false
      }
    }
    console.error(`[sendMessageInternal] Erro inesperado ao consultar status do tenant ${companyId}:`, err)
    return {
      success: false,
      error: 'Falha temporária ao verificar status da empresa. Envio bloqueado por segurança.',
      code: 'TENANT_CHECK_FAILED',
      reason: 'tenant_blocked',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  // 3. Persistência local da mensagem com delivery_status: 'pending'
  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: 'human',
      sender_id: userId,
      content: content.trim(),
      message_type: 'text',
      metadata: { delivery_status: 'pending' }
    })
    .select()
    .single()

  if (insertError || !message) {
    console.error('[sendMessageInternal] Erro ao persistir mensagem antes do envio externo:', insertError)
    // O gateway NUNCA deve ser chamado se a persistência falhar
    return {
      success: false,
      error: 'Erro ao registrar a mensagem no banco de dados.',
      code: 'DB_INSERT_FAILED',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  // 4. Disparo externo via gateway de saída
  const { sendOutboundMessage } = await import('@/lib/services/n8n-internal')

  const outboundPayload = {
    event_id: `outbound-${message.id}`,
    event_type: 'message.send',
    channel: conv.channel || 'whatsapp',
    conversation_id: conversationId,
    customer: {
      phone: conv.customers?.phone
    },
    message: {
      content: content.trim(),
      message_type: 'text'
    },
    metadata: {
      message_id: message.id
    }
  }

  let outboundRes: any
  try {
    outboundRes = await sendOutboundMessage(companyId, outboundPayload, {
      adminClient
    })
  } catch (dispErr: any) {
    console.error('[sendMessageInternal] Exceção inesperada no gateway de saída:', dispErr)
    outboundRes = { success: false, error: dispErr.message || 'Exceção no gateway de saída' }
  }

  // 5. Avaliação do retorno do gateway
  if (!outboundRes || !outboundRes.success) {
    const isTenantBlocked = outboundRes?.reason === 'tenant_blocked'
    const newStatus = isTenantBlocked ? 'suppressed' : 'failed'

    try {
      const { error: updateMsgErr } = await supabase
        .from('messages')
        .update({
          metadata: {
            ...(message.metadata || {}),
            delivery_status: newStatus,
            suppressed_reason: outboundRes?.reason,
            dispatch_error: outboundRes?.error
          }
        })
        .eq('id', message.id)
        .eq('company_id', companyId)

      if (updateMsgErr) {
        console.error('[sendMessageInternal] Falha ao atualizar metadata da mensagem após insucesso no gateway:', updateMsgErr)
      }
    } catch (updateEx: any) {
      console.error('[sendMessageInternal] Exceção ao atualizar metadata da mensagem após insucesso no gateway:', updateEx)
    }

    return {
      success: false,
      error: isTenantBlocked
        ? 'Envio bloqueado: a empresa não está autorizada a realizar disparos externos.'
        : (outboundRes?.error || 'Falha no envio da mensagem pelo canal externo.'),
      code: isTenantBlocked ? 'TENANT_BLOCKED' : 'OUTBOUND_DISPATCH_FAILED',
      reason: outboundRes?.reason,
      gatewayDispatched: false,
      externalDeliveryConfirmed: false,
      message: {
        ...message,
        metadata: {
          ...(message.metadata || {}),
          delivery_status: newStatus
        }
      }
    }
  }

  // 6. Disparo aceito pelo gateway externo: atualizar delivery_status para 'sent' e last_message_at
  let msgStatusErr: any = null
  let convUpdateErr: any = null

  try {
    const { error } = await supabase
      .from('messages')
      .update({
        metadata: {
          ...(message.metadata || {}),
          delivery_status: 'sent'
        }
      })
      .eq('id', message.id)
      .eq('company_id', companyId)
    msgStatusErr = error || null
  } catch (err: any) {
    msgStatusErr = err
  }

  try {
    const { error } = await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('company_id', companyId)
    convUpdateErr = error || null
  } catch (err: any) {
    convUpdateErr = err
  }

  try {
    revalidatePath('/conversations')
  } catch {
    // Silencia em ambiente de testes ou contextos sem NextRequest ativo
  }

  // Se a atualização local falhou mas o envio foi aceito pelo gateway:
  // - NÃO afirmamos que o envio externo falhou ou foi revertido
  // - NÃO apresentamos a persistência local como 'sent' quando ela falhou
  // - Retornamos gatewayDispatched: true e persistedStatus: 'pending'
  // - Preservamos message.id para permitir reconciliação administrativa posterior
  if (msgStatusErr) {
    console.error('[sendMessageInternal] INCONSISTENCY: Mensagem externa aceita pelo gateway, mas falhou ao atualizar delivery_status para sent no banco:', msgStatusErr)
    return {
      success: true,
      gatewayDispatched: true,
      externalDeliveryConfirmed: true,
      persistedStatus: 'pending',
      inconsistency: true,
      warning: 'Mensagem transmitida ao gateway externo com sucesso, mas a confirmação local no banco de dados falhou. A mensagem foi preservada como pendente para reconciliação.',
      message: {
        ...message,
        metadata: {
          ...(message.metadata || {}),
          delivery_status: 'pending' // Mantém o status real persistido no banco
        }
      }
    }
  }

  if (convUpdateErr) {
    console.error('[sendMessageInternal] INCONSISTENCY: Mensagem transmitida ao gateway, mas falhou ao atualizar last_message_at da conversa:', convUpdateErr)
  }

  return {
    success: true,
    gatewayDispatched: true,
    externalDeliveryConfirmed: true,
    persistedStatus: 'sent',
    inconsistency: false,
    message: {
      ...message,
      metadata: {
        ...(message.metadata || {}),
        delivery_status: 'sent'
      }
    }
  }
}
