import { createAdminClient } from '@/lib/supabase/service'
import { WebhookPayload } from '@/lib/validations/webhook'
import { runAgentEngine } from '@/lib/services/agent/engine'
import { sendOutboundMessage } from '@/lib/services/n8n-service'
export type ProcessWebhookResult = 
  | { success: true; duplicate: true; event_id: string; conversation_id?: undefined; message_id?: undefined }
  | { success: true; duplicate: false; event_id: string; conversation_id: string; message_id: string }

export async function processWebhookEvent(companyId: string, payload: WebhookPayload): Promise<ProcessWebhookResult> {
  const supabase = createAdminClient()

  // 1. Controle de Idempotência
  // Registra o evento. Se já existir o par company_id + event_id (Violate Unique Constraint), retornamos duplicate
  const { data: eventRecord, error: eventError } = await supabase.from('webhook_events').insert({
    company_id: companyId,
    event_id: payload.event_id,
    event_type: payload.event_type,
    payload: payload,
    status: 'processing'
  }).select().single()

  if (eventError) {
    // 23505 = Unique_violation em PostgreSQL
    if (eventError.code === '23505') {
      return { success: true, duplicate: true, event_id: payload.event_id }
    }
    throw new Error(`Falha ao registrar webhook event: ${eventError.message}`)
  }

  try {
    // 2. Customer Upsert (Localiza ou Cria cliente baseado em Company + Phone)
    let customerId: string
    const { data: existingCustomer } = await supabase.from('customers')
      .select('id').eq('company_id', companyId).eq('phone', payload.customer.phone).single()
    
    if (existingCustomer) {
      customerId = existingCustomer.id
      // Atualiza o nome do cliente se necessário
      await supabase.from('customers').update({ name: payload.customer.name }).eq('id', customerId)
    } else {
      const { data: newCustomer, error: cErr } = await supabase.from('customers').insert({
        company_id: companyId,
        name: payload.customer.name,
        phone: payload.customer.phone,
        email: payload.customer.email || null
      }).select().single()
      
      if (cErr) throw new Error('Falha ao criar cliente: ' + cErr.message)
      customerId = newCustomer.id
    }

    // 3. Conversation Upsert (Localiza por External ID ou busca conversa ativa para o cliente)
    let conversationId: string
    let convStatus = 'open'
    let currentUnread = 0
    
    let convQuery = supabase.from('conversations')
      .select('id, status, unread_count')
      .eq('company_id', companyId)
      
    if (payload.conversation?.external_id) {
      convQuery = convQuery.eq('external_id', payload.conversation.external_id)
    } else {
      // Se a integração nao manda ID de conversa, procura uma conversa que não esteja fechada do mesmo cliente no mesmo canal
      convQuery = convQuery.eq('customer_id', customerId)
        .eq('channel', payload.channel)
        .neq('status', 'closed')
    }

    const { data: existingConv } = await convQuery.maybeSingle()

    if (existingConv) {
      conversationId = existingConv.id
      convStatus = existingConv.status
      currentUnread = existingConv.unread_count
      
      // Regra de reabertura automática de conversa
      if (convStatus === 'closed' && payload.message.sender_type === 'customer') {
         convStatus = 'open'
      }
    } else {
      const { data: newConv, error: cvErr } = await supabase.from('conversations').insert({
        company_id: companyId,
        customer_id: customerId,
        channel: payload.channel,
        external_id: payload.conversation?.external_id || null,
        status: 'open'
      }).select().single()
      
      if (cvErr) throw new Error('Falha ao criar conversa: ' + cvErr.message)
      conversationId = newConv.id
    }

    // 4. Inserção da Mensagem
    const messageCreatedAt = payload.message.created_at || new Date().toISOString()
    const { data: msg, error: msgErr } = await supabase.from('messages').insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: payload.message.sender_type,
      content: payload.message.content,
      message_type: payload.message.message_type || 'text',
      external_id: payload.message.external_id || null,
      metadata: payload.metadata || null,
      created_at: messageCreatedAt
    }).select().single()
    
    if (msgErr) throw new Error('Falha ao inserir mensagem: ' + msgErr.message)

    // 5. Atualização de estado da Conversa
    let newUnread = currentUnread
    if (payload.message.sender_type === 'customer') {
      newUnread += 1
    }
    
    await supabase.from('conversations').update({
      status: convStatus,
      unread_count: newUnread,
      last_message_at: messageCreatedAt,
      closed_at: convStatus === 'open' ? null : undefined, // anula se reabriu
      updated_at: new Date().toISOString()
    }).eq('id', conversationId)

    // 6. Finaliza a transação lógica marcando o evento como processado
    await supabase.from('webhook_events').update({
      status: 'processed',
      processed_at: new Date().toISOString()
    }).eq('id', eventRecord.id)

    return {
      success: true,
      duplicate: false,
      event_id: payload.event_id,
      conversation_id: conversationId,
      message_id: msg.id
    }

  } catch (err: any) {
    // Falha em cascata detectada. Marca o evento como error na camada mais baixa.
    await supabase.from('webhook_events').update({
      status: 'error',
      error_message: err.message
    }).eq('id', eventRecord.id)
    
    throw err
  }
}


export interface AutonomousCycleParams {
  companyId: string
  conversationId: string
  messageId: string
  eventId: string
  payload: WebhookPayload
}

export interface AutonomousCycleResult {
  executed: boolean
  dispatched?: boolean
  reason?: string
  agentId?: string
  replyMessageId?: string
  outboxId?: string
  error?: string
}

/**
 * Resolve o agente elegivel para a conversa seguindo as regras de negocio:
 * 1. Se a conversa ja tiver agent_id, valida se esta ativo.
 * 2. Se nao tiver agent_id, busca os agentes ativos da empresa.
 * 3. Se houver exatamente 1 agente ativo, utiliza-o.
 * 4. Se houver mais de 1, busca o configurado com is_default: true.
 * 5. Se nao houver agente elegivel ou default inequivoco, NAO seleciona arbitrariamente.
 */
export async function resolveEligibleAgent(companyId: string, conversationAgentId?: string | null): Promise<{
  agentId: string | null
  reason?: string
}> {
  const supabase = createAdminClient()

  if (conversationAgentId) {
    const { data: assignedAgent } = await supabase
      .from('agents')
      .select('id, is_active')
      .eq('id', conversationAgentId)
      .eq('company_id', companyId)
      .single()

    if (assignedAgent && assignedAgent.is_active) {
      return { agentId: assignedAgent.id }
    }
    return { agentId: null, reason: 'assigned_agent_inactive' }
  }

  const { data: activeAgents } = await supabase
    .from('agents')
    .select('id, is_active, metadata')
    .eq('company_id', companyId)
    .eq('is_active', true)

  if (!activeAgents || activeAgents.length === 0) {
    return { agentId: null, reason: 'no_active_agents_for_company' }
  }

  if (activeAgents.length === 1) {
    return { agentId: activeAgents[0].id }
  }

  const defaultAgent = activeAgents.find((a: any) => a.metadata?.is_default === true)
  if (defaultAgent) {
    return { agentId: defaultAgent.id }
  }

  return { agentId: null, reason: 'multiple_active_agents_without_default' }
}

/**
 * Executa o ciclo autonomo completo:
 * Validacao de condicoes -> Resolucao de agente -> Agent Engine -> Trava de Handoff -> Outbox -> n8n.
 */
export async function handleAutonomousCycle(params: AutonomousCycleParams): Promise<AutonomousCycleResult> {
  const { companyId, conversationId, messageId, eventId, payload } = params
  const supabase = createAdminClient()

  // 1. Condicao: Apenas mensagens reais de cliente acionam o agente (protege contra ecos e loops)
  if (payload.message.sender_type !== 'customer') {
    return { executed: false, reason: 'non_customer_sender' }
  }

  // 2. Condicao: Conversa existe e esta aberta (nao fechada, nao em handoff humano)
  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('id, status, channel, agent_id, customer_id, customers(id, phone, name)')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (convErr || !conversation) {
    return { executed: false, reason: 'conversation_not_found' }
  }

  if (conversation.status === 'closed') {
    return { executed: false, reason: 'conversation_closed' }
  }

  if (conversation.status === 'human') {
    return { executed: false, reason: 'human_mode_active' }
  }

  // 3. Destinatario verificado (nao confiar cegamente em inputs nao persistidos)
  const recipientPhone = (conversation as any).customers?.phone || payload.customer.phone
  if (!recipientPhone) {
    return { executed: false, reason: 'missing_recipient_phone' }
  }

  // 4. Selecao segura e deterministica do agente ativo elegivel
  const agentResolution = await resolveEligibleAgent(companyId, conversation.agent_id)
  if (!agentResolution.agentId) {
    console.log(`[AutonomousCycle Notice] Agente nao elegivel: ${agentResolution.reason} (empresa: ${companyId})`)
    return { executed: false, reason: agentResolution.reason }
  }
  const selectedAgentId = agentResolution.agentId

  // 5. Execucao do Agent Engine reutilizando runAgentEngine com skipCustomerMessageInsert: true
  const agentResult = await runAgentEngine({
    companyId,
    agentId: selectedAgentId,
    conversationId,
    userMessage: payload.message.content,
    skipCustomerMessageInsert: true
  })

  if (!agentResult.success || !agentResult.message) {
    return { executed: false, reason: 'agent_engine_failed', error: agentResult.error }
  }

  // 6. Trava de Handoff Concorrente: Verificar se um atendente assumiu durante a execucao do LLM
  const { data: latestConv } = await supabase
    .from('conversations')
    .select('status')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  const idempotencyKey = `agent-reply-${eventId}`

  if (latestConv?.status === 'human') {
    console.log(`[AutonomousCycle Suppressed] Conversa ${conversationId} entrou em handoff humano durante processamento do LLM`)
    
    // Atualiza metadata da mensagem persistida para indicar supressao
    if (agentResult.messageId) {
      await supabase.from('messages').update({
        metadata: { delivery_status: 'suppressed', suppression_reason: 'handoff' }
      }).eq('id', agentResult.messageId)
    }

    // Registra na outbox como suprimido para auditoria
    await recordOutboxEntry(supabase, {
      company_id: companyId,
      conversation_id: conversationId,
      message_id: agentResult.messageId || null,
      idempotency_key: idempotencyKey,
      channel: conversation.channel || payload.channel || 'whatsapp',
      recipient: recipientPhone,
      payload: { suppressed: true, reason: 'handoff' },
      status: 'suppressed',
      last_error: 'Handoff humano assumido antes do despacho'
    })

    return { executed: true, dispatched: false, reason: 'suppressed_by_handoff' }
  }

  // 7. Preparar Payload de Saida com dados validados
  const outboundPayload = {
    event_id: idempotencyKey,
    event_type: 'message.send',
    channel: conversation.channel || payload.channel || 'whatsapp',
    conversation_id: conversationId,
    customer: {
      phone: recipientPhone,
      name: (conversation as any).customers?.name || payload.customer.name
    },
    message: {
      content: agentResult.message,
      message_type: 'text'
    },
    metadata: {
      agent_id: selectedAgentId,
      trigger_event_id: eventId,
      trigger_message_id: messageId,
      reply_message_id: agentResult.messageId
    }
  }

  // 8. Despacho Confiavel via Outbox
  const outboxEntry = await recordOutboxEntry(supabase, {
    company_id: companyId,
    conversation_id: conversationId,
    message_id: agentResult.messageId || null,
    idempotency_key: idempotencyKey,
    channel: outboundPayload.channel,
    recipient: recipientPhone,
    payload: outboundPayload,
    status: 'pending'
  })

  const outboundRes = await sendOutboundMessage(companyId, outboundPayload)

  if (outboundRes.success) {
    if (outboxEntry?.id) {
      await supabase.from('message_outbox').update({
        status: 'sent',
        attempts: 1,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', outboxEntry.id)
    }
    if (agentResult.messageId) {
      await supabase.from('messages').update({
        metadata: { delivery_status: 'sent' }
      }).eq('id', agentResult.messageId)
    }
    return {
      executed: true,
      dispatched: true,
      agentId: selectedAgentId,
      replyMessageId: agentResult.messageId,
      outboxId: outboxEntry?.id
    }
  } else {
    // Falha de envio externo nao perde a mensagem do agente nem exige reexecucao do LLM
    console.error(`[AutonomousCycle Outbound Error] Falha ao enviar resposta para o n8n: ${outboundRes.error || outboundRes.reason}`)
    if (outboxEntry?.id) {
      await supabase.from('message_outbox').update({
        status: 'failed',
        attempts: 1,
        last_error: outboundRes.error || outboundRes.reason || 'Falha no envio outbound',
        updated_at: new Date().toISOString()
      }).eq('id', outboxEntry.id)
    }
    if (agentResult.messageId) {
      await supabase.from('messages').update({
        metadata: { delivery_status: 'failed', delivery_error: outboundRes.error || outboundRes.reason }
      }).eq('id', agentResult.messageId)
    }
    return {
      executed: true,
      dispatched: false,
      reason: 'outbound_failed',
      agentId: selectedAgentId,
      replyMessageId: agentResult.messageId,
      outboxId: outboxEntry?.id,
      error: outboundRes.error || outboundRes.reason
    }
  }
}

/**
 * Utilitario de persistencia na outbox com tolerancia caso a migration ainda nao tenha rodado
 */
async function recordOutboxEntry(supabase: any, entryData: any) {
  try {
    const { data } = await supabase.from('message_outbox').insert(entryData).select('id').maybeSingle()
    return data
  } catch (err: any) {
    // 42P01: tabela nao existe ainda
    return null
  }
}

/**
 * Reenvia uma mensagem pendente/falha da outbox sem reexecutar o LLM
 */
export async function retryOutboxMessage(outboxId: string) {
  const supabase = createAdminClient()
  const { data: record, error } = await supabase.from('message_outbox').select('*').eq('id', outboxId).single()
  if (error || !record) return { success: false, error: 'Registro nao encontrado' }
  if (record.status === 'sent') return { success: true, alreadySent: true }

  const outboundRes = await sendOutboundMessage(record.company_id, record.payload)
  if (outboundRes.success) {
    await supabase.from('message_outbox').update({
      status: 'sent',
      attempts: (record.attempts || 0) + 1,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', outboxId)
    return { success: true }
  } else {
    await supabase.from('message_outbox').update({
      status: 'failed',
      attempts: (record.attempts || 0) + 1,
      last_error: outboundRes.error || outboundRes.reason,
      updated_at: new Date().toISOString()
    }).eq('id', outboxId)
    return { success: false, error: outboundRes.error || outboundRes.reason }
  }
}
