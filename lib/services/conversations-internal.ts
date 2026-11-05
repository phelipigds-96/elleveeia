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
  clientMessageId?: string
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

  const { userId, companyId, clientMessageId } = context
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

  const supabase = context.supabaseClient || context.adminClient || createClient()
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
  // DEVE ocorrer ANTES de qualquer persistência em 'messages' ou 'message_outbox'
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

  // 3. Montagem da chave de idempotência contra cliques duplos
  const safeClientMsgId = clientMessageId?.trim()
  const idempotencyKey = safeClientMsgId
    ? `manual-${conversationId}-${safeClientMsgId}`
    : `manual-${conversationId}-${crypto.randomUUID()}`

  // 4. Criação atômica simultânea de 'messages' e 'message_outbox' via RPC
  let messageId: string
  let outboxId: string
  let isDuplicate = false

  const rpcClient = typeof (context.supabaseClient as any)?.rpc === 'function'
    ? context.supabaseClient
    : (typeof (adminClient as any)?.rpc === 'function' ? adminClient : (typeof (supabase as any)?.rpc === 'function' ? supabase : null))

  if (!rpcClient) {
    throw new Error('RPC_CLIENT_UNAVAILABLE: Operações devem passar estritamente pela outbox transacional.')
  }

  const { data: createData, error: createError } = await (rpcClient as any).rpc('create_outbound_message_atomic', {
    p_company_id: companyId,
    p_conversation_id: conversationId,
    p_sender_type: 'human',
    p_content: content.trim(),
    p_idempotency_key: idempotencyKey,
    p_sender_id: userId,
    p_message_type: 'text',
    p_metadata: { delivery_status: 'pending' },
    p_channel: conv.channel || 'whatsapp',
    p_recipient: conv.customers?.phone || null
  })

  if (createError) {
    console.error('[sendMessageInternal] Erro ao invocar create_outbound_message_atomic:', createError)
    return {
      success: false,
      error: 'Erro ao registrar a mensagem no banco de dados.',
      code: 'DB_INSERT_FAILED',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  const row = Array.isArray(createData) ? createData[0] : createData
  if (!row || (!row.was_inserted && !row.duplicate)) {
    const reason = row?.error_reason || 'Erro na criação atômica'
    if (reason.startsWith('company_not_active')) {
      const fallbackMsgId = row?.message_id
      if (fallbackMsgId) {
        try {
          await (adminClient as any).from('messages').update({
            metadata: { delivery_status: 'suppressed', suppressed_reason: 'tenant_blocked' }
          }).eq('id', fallbackMsgId)
        } catch {}
      }
      return {
        success: false,
        error: 'Envio bloqueado: a empresa não está autorizada a realizar disparos externos.',
        code: 'TENANT_BLOCKED',
        reason: 'tenant_blocked',
        gatewayDispatched: false,
        externalDeliveryConfirmed: false,
        message: {
          id: fallbackMsgId,
          company_id: companyId,
          conversation_id: conversationId,
          sender_type: 'human',
          sender_id: userId,
          content: content.trim(),
          metadata: {
            delivery_status: 'suppressed',
            suppressed_reason: 'tenant_blocked'
          }
        }
      }
    }
    if (reason === 'conversation_not_found' || reason === 'conversation_tenant_mismatch') {
      return {
        success: false,
        error: 'Conversa não encontrada ou não pertence a esta empresa.',
        code: 'CONVERSATION_NOT_FOUND',
        gatewayDispatched: false,
        externalDeliveryConfirmed: false
      }
    }
    return {
      success: false,
      error: 'Erro ao registrar a mensagem no banco de dados.',
      reason,
      code: 'DB_INSERT_FAILED',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false
    }
  }

  messageId = row.message_id
  outboxId = row.outbox_id
  isDuplicate = !!row.duplicate

  // 5. Tratamento de Duplicação (Duplo-clique no frontend): retorna a mensagem sem chamar a rede
  if (isDuplicate) {
    const { data: existingMsg } = await (adminClient as any)
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .maybeSingle()

    const deliveryStatus = existingMsg?.metadata?.delivery_status || 'sent'
    return {
      success: true,
      gatewayDispatched: true,
      externalDeliveryConfirmed: true,
      persistedStatus: deliveryStatus === 'sent' ? 'sent' : 'pending',
      message: existingMsg || {
        id: messageId,
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'human',
        sender_id: userId,
        content: content.trim(),
        message_type: 'text',
        metadata: { delivery_status: deliveryStatus }
      }
    }
  }

  // 6. Claim da mensagem na outbox via claim_outbox_message
  const leaseSeconds = 120
  let claim: any = null
  if (rpcClient) {
    const { data: claimData, error: claimErr } = await (rpcClient as any).rpc('claim_outbox_message', {
      p_company_id: companyId,
      p_outbox_id: outboxId,
      p_lease_seconds: leaseSeconds
    })
    if (!claimErr && claimData) {
      claim = Array.isArray(claimData) ? claimData[0] : claimData
    }
  }

  // 7. Disparo externo via gateway de saída com Gateway Lock e Fencing
  const { sendOutboundMessage, isAmbiguousNetworkError } = await import('@/lib/services/n8n-internal')

  const outboundPayload = {
    event_id: idempotencyKey,
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
      message_id: messageId,
      sender_type: 'human'
    }
  }

  let outboundRes: any
  try {
    outboundRes = await sendOutboundMessage(companyId, outboundPayload, {
      adminClient,
      outboxId,
      messageId,
      leaseSeconds
    })
  } catch (dispErr: any) {
    console.error('[sendMessageInternal] Exceção inesperada no gateway de saída:', dispErr)
    outboundRes = { success: false, error: dispErr.message || 'Exceção no gateway de saída' }
  }

  // 8. Avaliação do resultado com tratamento de Ambíguo vs Determinístico

  // 8.1. Falha de rede ambígua (Timeout, AbortError, ECONNRESET): abandona lock e preserva outbox em processing
  const isAmbiguous = isAmbiguousNetworkError(outboundRes?.error || outboundRes?.reason)
  if (isAmbiguous) {
    console.warn(`[sendMessageInternal] Timeout ou falha de rede ambígua para outbox ${outboxId}. Mantendo outbox como processing para reconciliação pelo worker.`)
    return {
      success: false,
      error: outboundRes?.error || 'Timeout no gateway de saída',
      code: 'OUTBOUND_DISPATCH_FAILED',
      reason: 'gateway_timeout',
      gatewayDispatched: false,
      externalDeliveryConfirmed: false,
      message: {
        id: messageId,
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'human',
        sender_id: userId,
        content: content.trim(),
        message_type: 'text',
        metadata: { delivery_status: 'pending' }
      }
    }
  }

  // 8.2. Falha determinística (HTTP 4xx, 500 nítido, tenant_blocked)
  if (!outboundRes || !outboundRes.success) {
    const isTenantBlocked = outboundRes?.reason === 'tenant_blocked'
    const newStatus = isTenantBlocked ? 'suppressed' : 'failed'
    const finalError = outboundRes?.error || outboundRes?.reason || 'Falha no envio outbound'

    if (rpcClient) {
      // Atualiza metadata de forma atômica e monotônica
      await (rpcClient as any).rpc('merge_message_metadata_monotonic', {
        p_company_id: companyId,
        p_message_id: messageId,
        p_metadata_patch: {
          delivery_status: newStatus,
          suppressed_reason: outboundRes?.reason,
          dispatch_error: finalError
        },
        p_provider_message_id: null
      })

      // Conclui outbox como failed/suppressed
      if (claim?.claim_token && claim?.claim_version) {
        await (rpcClient as any).rpc('complete_outbox_message', {
          p_company_id: companyId,
          p_outbox_id: outboxId,
          p_claim_token: claim.claim_token,
          p_claim_version: claim.claim_version,
          p_status: newStatus,
          p_last_error: finalError,
          p_provider_message_id: null
        })
      }
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
        id: messageId,
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'human',
        sender_id: userId,
        content: content.trim(),
        message_type: 'text',
        metadata: {
          delivery_status: newStatus,
          suppressed_reason: outboundRes?.reason,
          dispatch_error: finalError
        }
      }
    }
  }

  // 8.3. Sucesso: Conclui outbox como sent e consolida metadata via merge_message_metadata_monotonic
  const providerMessageId = (outboundRes as any).provider_message_id || null

  let msgStatusErr: any = null

  if (rpcClient) {
    try {
      if (claim?.claim_token && claim?.claim_version) {
        await (rpcClient as any).rpc('complete_outbox_message', {
          p_company_id: companyId,
          p_outbox_id: outboxId,
          p_claim_token: claim.claim_token,
          p_claim_version: claim.claim_version,
          p_status: 'sent',
          p_last_error: null,
          p_provider_message_id: providerMessageId
        })
      }

      const { error: mergeErr } = await (rpcClient as any).rpc('merge_message_metadata_monotonic', {
        p_company_id: companyId,
        p_message_id: messageId,
        p_metadata_patch: {
          delivery_status: 'sent',
          ...(providerMessageId ? { provider_message_id: providerMessageId } : {})
        },
        p_provider_message_id: providerMessageId
      })
      if (mergeErr) msgStatusErr = mergeErr
    } catch (err: any) {
      msgStatusErr = err
    }
  }

  if (msgStatusErr) {
    console.error('[sendMessageInternal] INCONSISTENCY: Mensagem externa aceita pelo gateway, mas falhou ao atualizar delivery_status para sent no banco:', msgStatusErr)
    try {
      const msgRecord = await (adminClient as any).from('messages').select('metadata').eq('id', messageId).single()
      if (msgRecord?.data) {
        await (adminClient as any).from('messages').update({
          metadata: { ...(msgRecord.data.metadata || {}), delivery_status: 'pending' }
        }).eq('id', messageId)
      }
    } catch {}
    return {
      success: true,
      gatewayDispatched: true,
      externalDeliveryConfirmed: true,
      persistedStatus: 'pending',
      inconsistency: true,
      warning: 'Mensagem transmitida ao gateway externo com sucesso, mas a confirmação local no banco de dados falhou. A mensagem foi preservada como pendente para reconciliação.',
      message: {
        id: messageId,
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'human',
        sender_id: userId,
        content: content.trim(),
        message_type: 'text',
        metadata: {
          delivery_status: 'pending'
        }
      }
    }
  }

  try {
    await adminClient
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('company_id', companyId)
  } catch {}

  try {
    revalidatePath('/conversations')
  } catch {}

  // Consulta registro final da mensagem
  const { data: finalMsg } = await adminClient
    .from('messages')
    .select('*')
    .eq('id', messageId)
    .eq('company_id', companyId)
    .maybeSingle()

  const retMsg = finalMsg || {
    id: messageId,
    company_id: companyId,
    conversation_id: conversationId,
    sender_type: 'human',
    sender_id: userId,
    content: content.trim(),
    message_type: 'text',
    metadata: {
      delivery_status: 'sent',
      ...(providerMessageId ? { provider_message_id: providerMessageId } : {})
    }
  }

  return {
    success: true,
    gatewayDispatched: true,
    externalDeliveryConfirmed: true,
    persistedStatus: 'sent',
    inconsistency: false,
    message: retMsg
  }
}
