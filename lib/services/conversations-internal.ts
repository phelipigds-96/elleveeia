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

  // 6-8. Pipeline endurecido compartilhado: Claim + Gateway Lock + Dispatch + Reconciliação
  const dispatchRes = await dispatchOutboxRecordHardened({
    adminClient,
    companyId,
    outboxId,
    messageId,
    outboundPayload: {
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
    },
    leaseSeconds: 120
  })

  const outboundRes = dispatchRes.outboundRes

  if (dispatchRes.outcome === 'ambiguous') {
    console.warn(`[sendMessageInternal] Timeout ou falha de rede ambígua para outbox ${outboxId}. Mantendo outbox como processing para reconciliação pelo worker.`)
    return {
      success: false,
      error: dispatchRes.finalError || 'Timeout no gateway de saída',
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

  if (dispatchRes.outcome === 'suppressed' || dispatchRes.outcome === 'failed') {
    const isTenantBlocked = dispatchRes.outcome === 'suppressed'
    const newStatus = dispatchRes.outcome
    const finalError = dispatchRes.finalError || 'Falha no envio outbound'

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

  const providerMessageId = dispatchRes.providerMessageId
  const msgStatusErr = dispatchRes.msgStatusErr

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

export interface HardenedOutboxDispatchParams {
  adminClient: any
  companyId: string
  outboxId: string
  messageId: string
  outboundPayload: any
  leaseSeconds?: number
}

export interface HardenedOutboxDispatchResult {
  outcome: 'sent' | 'ambiguous' | 'failed' | 'suppressed'
  outboundRes: any
  providerMessageId: string | null
  msgStatusErr: any
  finalError?: string
}

async function resolveEvolutionDispatchConfig(adminClient: any, companyId: string): Promise<{
  apiUrl: string
  apiKey: string
  instanceName: string
} | null> {
  let apiUrl = (process.env.EVOLUTION_API_URL || '').trim()
  let apiKey = (process.env.EVOLUTION_API_KEY || '').trim()
  let instanceName = (process.env.EVOLUTION_INSTANCE_NAME || '').trim()

  if (apiUrl === 'mock') return null

  try {
    const { data: tenantEvo } = await adminClient
      .from('integrations')
      .select('config, credentials, status')
      .eq('company_id', companyId)
      .eq('type', 'whatsapp_evolution')
      .maybeSingle()

    if (tenantEvo) {
      if (tenantEvo.status && tenantEvo.status !== 'active') return null
      if (tenantEvo.config?.instance_name) instanceName = String(tenantEvo.config.instance_name).trim()
      if (tenantEvo.config?.api_url) apiUrl = String(tenantEvo.config.api_url).trim()
      if (tenantEvo.credentials?.api_key) apiKey = String(tenantEvo.credentials.api_key).trim()
    }

    if (!apiUrl || !apiKey) {
      const { data: globalEvo } = await adminClient
        .from('integrations')
        .select('config, credentials')
        .eq('type', 'whatsapp_evolution')
        .not('config->api_url', 'is', null)
        .limit(1)
        .maybeSingle()

      if (globalEvo?.config?.api_url && !apiUrl) apiUrl = String(globalEvo.config.api_url).trim()
      if (globalEvo?.credentials?.api_key && !apiKey) apiKey = String(globalEvo.credentials.api_key).trim()
    }
  } catch {
    return null
  }

  apiUrl = apiUrl.replace(/\/+$/, '')
  if (!apiUrl || !apiKey || !instanceName) return null
  return { apiUrl, apiKey, instanceName }
}

async function safeCompleteGatewayLock(
  rpcClient: any,
  params: {
    companyId: string
    eventId: string
    claimToken: string | null
    status: 'completed' | 'failed'
    providerMessageId?: string | null
    lastError?: string | null
  }
): Promise<void> {
  if (!rpcClient || !params.claimToken) return
  try {
    await rpcClient.rpc('complete_gateway_outbound_lock', {
      p_company_id: params.companyId,
      p_event_id: params.eventId,
      p_claim_token: params.claimToken,
      p_status: params.status,
      p_provider_message_id: params.providerMessageId ?? null,
      p_last_error: params.lastError ?? null
    })
  } catch {
    // Best-effort lock finalization
  }
}

async function sendEvolutionWithGatewayLock(params: {
  adminClient: any
  companyId: string
  outboxId: string
  messageId: string
  outboundPayload: any
  leaseSeconds: number
  isSafeUrl: (url: string) => boolean
  isAmbiguousNetworkError: (err: any) => boolean
}): Promise<any | null> {
  const { adminClient, companyId, outboxId, messageId, outboundPayload, leaseSeconds, isSafeUrl, isAmbiguousNetworkError } = params
  const evo = await resolveEvolutionDispatchConfig(adminClient, companyId)
  if (!evo) return null

  try {
    await requireActiveCompany(companyId, { adminClient })
  } catch (err: any) {
    if (err instanceof TenantAccessError) {
      return { success: false, reason: 'tenant_blocked', code: err.code, error: err.message }
    }
    return { success: false, reason: 'tenant_status_unavailable', error: err?.message }
  }

  if (!isSafeUrl(evo.apiUrl)) {
    return { success: false, reason: 'unsafe_url', error: 'Unsafe Evolution URL detected (SSRF Protection)' }
  }

  const rpcClient = typeof adminClient?.rpc === 'function' ? adminClient : null
  const eventId = outboundPayload?.event_id || `outbox-${outboxId}`
  let lockToken: string | null = null

  if (rpcClient) {
    const { data: lockData, error: lockErr } = await rpcClient.rpc('acquire_gateway_outbound_lock', {
      p_company_id: companyId,
      p_event_id: eventId,
      p_outbox_id: outboxId,
      p_message_id: messageId,
      p_lease_seconds: leaseSeconds
    })
    if (lockErr) {
      return { success: false, reason: 'gateway_lock_error', error: lockErr.message }
    }
    const lockRow = Array.isArray(lockData) ? lockData[0] : lockData
    if (lockRow && !lockRow.was_acquired) {
      if (lockRow.status === 'completed' || lockRow.error_reason === 'already_completed') {
        return { success: true, duplicate: true, provider_message_id: lockRow.provider_message_id || null }
      }
      return { success: false, reason: 'gateway_lock_in_flight', error: 'Disparo já em andamento no gateway.' }
    }
    lockToken = lockRow?.claim_token || null
  }

  const recipient = outboundPayload?.recipient || outboundPayload?.number || outboundPayload?.customer?.phone
  const textContent = outboundPayload?.message?.content ?? outboundPayload?.text ?? ''
  const mediaUrl = outboundPayload?.media_url || outboundPayload?.message?.media_url
  const mediaType = outboundPayload?.media_type || outboundPayload?.message?.message_type || 'image'
  const fileName = outboundPayload?.file_name || 'arquivo'

  let targetUrl = `${evo.apiUrl}/message/sendText/${evo.instanceName}`
  let bodyPayload: Record<string, any> = { number: recipient, text: textContent }

  if (mediaUrl) {
    if (mediaType === 'audio') {
      targetUrl = `${evo.apiUrl}/message/sendWhatsAppAudio/${evo.instanceName}`
      bodyPayload = { number: recipient, audio: mediaUrl }
    } else {
      targetUrl = `${evo.apiUrl}/message/sendMedia/${evo.instanceName}`
      bodyPayload = {
        number: recipient,
        mediatype: mediaType === 'document' ? 'document' : 'image',
        media: mediaUrl,
        caption: textContent,
        fileName
      }
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evo.apiKey
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    })
    clearTimeout(timeoutId)

    const rawText = await response.text().catch(() => '')
    let data: any = null
    try {
      data = rawText ? JSON.parse(rawText) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      const errMsg = `Evolution API HTTP ${response.status}: ${rawText.slice(0, 200)}`
      const isAmbiguousHttp = response.status === 502 || response.status === 504 || response.status === 408
      if (!isAmbiguousHttp) {
        await safeCompleteGatewayLock(rpcClient, {
          companyId,
          eventId,
          claimToken: lockToken,
          status: 'failed',
          lastError: errMsg
        })
      }
      return {
        success: false,
        reason: isAmbiguousHttp ? `gateway_timeout_http_${response.status}` : `http_${response.status}`,
        error: errMsg
      }
    }

    const providerMessageId = data?.key?.id || data?.messageId || data?.id || data?.keyId || null
    await safeCompleteGatewayLock(rpcClient, {
      companyId,
      eventId,
      claimToken: lockToken,
      status: 'completed',
      providerMessageId
    })

    return { success: true, provider_message_id: providerMessageId }
  } catch (err: any) {
    clearTimeout(timeoutId)
    const isAmbiguous = isAmbiguousNetworkError(err)
    if (!isAmbiguous) {
      await safeCompleteGatewayLock(rpcClient, {
        companyId,
        eventId,
        claimToken: lockToken,
        status: 'failed',
        lastError: err?.message || 'Evolution dispatch exception'
      })
    }
    return {
      success: false,
      reason: isAmbiguous ? 'gateway_timeout' : 'fetch_error',
      error: err?.message || String(err)
    }
  }
}

/**
 * Pipeline atômico compartilhado para envio manual/humano via outbox:
 * 1. claim_outbox_message (fencing token + lease)
 * 2. sendOutboundMessage (SSRF guard + gateway_outbound_locks + n8n; fallback seguro Evolution API)
 * 3. Reconciliação de falhas ambíguas vs determinísticas + complete_outbox_message + merge_message_metadata_monotonic
 */
export async function dispatchOutboxRecordHardened(
  params: HardenedOutboxDispatchParams
): Promise<HardenedOutboxDispatchResult> {
  const { adminClient, companyId, outboxId, messageId, outboundPayload } = params
  const leaseSeconds = params.leaseSeconds || 120
  const rpcClient = typeof (adminClient as any)?.rpc === 'function' ? adminClient : null

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

  const { sendOutboundMessage, isAmbiguousNetworkError, isSafeUrl } = await import('@/lib/services/n8n-internal')

  let outboundRes: any
  try {
    outboundRes = await sendOutboundMessage(companyId, outboundPayload, {
      adminClient,
      outboxId,
      messageId,
      leaseSeconds
    })
    if (outboundRes?.reason === 'no_integration') {
      const evoRes = await sendEvolutionWithGatewayLock({
        adminClient,
        companyId,
        outboxId,
        messageId,
        outboundPayload,
        leaseSeconds,
        isSafeUrl,
        isAmbiguousNetworkError
      })
      if (evoRes) {
        outboundRes = evoRes
      }
    }
  } catch (dispErr: any) {
    console.error('[dispatchOutboxRecordHardened] Exceção inesperada no gateway de saída:', dispErr)
    outboundRes = { success: false, error: dispErr?.message || 'Exceção no gateway de saída' }
  }

  const isAmbiguous = isAmbiguousNetworkError(outboundRes?.error || outboundRes?.reason)
  if (isAmbiguous) {
    return {
      outcome: 'ambiguous',
      outboundRes,
      providerMessageId: null,
      msgStatusErr: null,
      finalError: outboundRes?.error || 'Timeout no gateway de saída'
    }
  }

  if (!outboundRes || !outboundRes.success) {
    const isTenantBlocked = outboundRes?.reason === 'tenant_blocked'
    const newStatus: 'suppressed' | 'failed' = isTenantBlocked ? 'suppressed' : 'failed'
    const finalError = outboundRes?.error || outboundRes?.reason || 'Falha no envio outbound'

    if (rpcClient) {
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
      outcome: newStatus,
      outboundRes,
      providerMessageId: null,
      msgStatusErr: null,
      finalError
    }
  }

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

  return {
    outcome: 'sent',
    outboundRes,
    providerMessageId,
    msgStatusErr
  }
}
