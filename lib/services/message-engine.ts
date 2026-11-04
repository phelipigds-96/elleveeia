import { createAdminClient } from '@/lib/supabase/service'
import type { WebhookPayload } from '@/lib/validations/webhook'
import { runAgentEngine } from '@/lib/services/agent/engine'
import { sendOutboundMessage } from '@/lib/services/n8n-internal'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'
export type ProcessWebhookResult = 
  | { success: true; duplicate: true; event_id: string; conversation_id?: undefined; message_id?: undefined }
  | { success: true; duplicate: false; event_id: string; conversation_id: string; message_id: string }

export async function processWebhookEvent(
  companyId: string, 
  payload: WebhookPayload,
  options?: { adminClient?: any }
): Promise<ProcessWebhookResult> {
  const supabase = options?.adminClient || createAdminClient()

  // 0. Validação de ciclo de vida do tenant (Defesa em Profundidade)
  // Garante que mesmo chamadores internos/diretos não persistam registros para empresas bloqueadas
  await requireActiveCompany(companyId, { adminClient: supabase })

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
      // Atualiza o nome do cliente se necessário com escopo estrito de tenant
      const { error: custErr } = await supabase
        .from('customers')
        .update({ name: payload.customer.name })
        .eq('id', customerId)
        .eq('company_id', companyId)

      if (custErr) {
        console.error('[processWebhookEvent] Erro ao atualizar nome do cliente:', custErr)
      }
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
    
    let convQuery = supabase.from('conversations')
      .select('id, status')
      .eq('company_id', companyId)
      
    if (payload.conversation?.external_id) {
      convQuery = convQuery.eq('external_id', payload.conversation.external_id)
    } else {
      // Se a integração não manda ID de conversa, procura conversa existente do cliente no canal (ordenando pela mais recente)
      convQuery = convQuery.eq('customer_id', customerId)
        .eq('channel', payload.channel)
        .order('last_message_at', { ascending: false })
    }

    const { data: existingConv } = await convQuery.maybeSingle()

    if (existingConv) {
      conversationId = existingConv.id
      convStatus = existingConv.status
      
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

    // 4. Inserção Idempotente da Mensagem + Atualização Atômica de unread_count e last_message_at
    // O RPC insert_message_idempotent garante:
    //   - Deduplicação por (conversation_id, external_id) via ON CONFLICT DO NOTHING
    //   - Incremento atômico de unread_count (sem race condition de read-increment-write)
    //   - Monotonicidade e proteção temporal de last_message_at via GREATEST(last_message_at, LEAST(created_at, NOW()))
    //   - Validação de sender_type ('customer', 'agent', 'human', 'system')
    // Apenas mensagens realmente inseridas atualizam os contadores da conversa.
    const messageCreatedAt = payload.message.created_at || new Date().toISOString()
    const parsedTime = Date.parse(messageCreatedAt)
    if (isNaN(parsedTime)) {
      throw new Error('Data da mensagem inválida: formato não reconhecido para created_at')
    }

    const externalId = payload.message.external_id || null

    const { data: rpcResult, error: rpcErr } = await supabase.rpc('insert_message_idempotent', {
      p_company_id:      companyId,
      p_conversation_id: conversationId,
      p_external_id:     externalId,
      p_sender_type:     payload.message.sender_type,
      p_content:         payload.message.content,
      p_created_at:      messageCreatedAt,
      p_metadata:        payload.metadata || null,
      p_message_type:    payload.message.message_type || 'text'
    })

    if (rpcErr) {
      throw new Error('Falha ao inserir mensagem (idempotente): ' + rpcErr.message)
    }

    // rpcResult é um array com um único objeto { message_id, was_inserted }
    const rpcRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
    if (!rpcRow?.message_id) {
      throw new Error('Falha ao inserir mensagem: RPC não retornou message_id')
    }

    const messageId = rpcRow.message_id
    // wasInserted: true = nova mensagem; false = duplicata (event_id diferente, mesmo external_id)
    // O RPC já tratou unread_count e last_message_at de forma condicional.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const wasInserted: boolean = rpcRow.was_inserted

    // 5. Atualização de estado da Conversa (status e closed_at)
    // unread_count e last_message_at já foram atualizados atomicamente pelo RPC.
    // Aqui atualizamos apenas campos de estado (status, closed_at) que o RPC não gerencia.
    const { error: convUpdateErr } = await supabase.from('conversations').update({
      status: convStatus,
      closed_at: convStatus === 'open' ? null : undefined, // anula se reabriu
      updated_at: new Date().toISOString()
    })
      .eq('id', conversationId)
      .eq('company_id', companyId)

    if (convUpdateErr) {
      throw new Error('Falha ao atualizar conversa: ' + convUpdateErr.message)
    }

    // Variável para compatibilidade com o bloco de retorno abaixo
    const msg = { id: messageId }

    // 6. Finaliza a transação lógica marcando o evento como processado
    await supabase.from('webhook_events').update({
      status: 'processed',
      processed_at: new Date().toISOString()
    })
      .eq('id', eventRecord.id)
      .eq('company_id', companyId)

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
    })
      .eq('id', eventRecord.id)
      .eq('company_id', companyId)
    
    throw err
  }
}


export interface AutonomousCycleParams {
  companyId: string
  conversationId: string
  messageId: string
  eventId: string
  payload: WebhookPayload
  adminClient?: any
  llmProvider?: any
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
export async function handleAutonomousCycle(
  params: AutonomousCycleParams,
  options?: { adminClient?: any }
): Promise<AutonomousCycleResult> {
  const { companyId, conversationId, messageId, eventId, payload } = params
  const supabase = params.adminClient || options?.adminClient || createAdminClient()

  // 1. Condicao: Apenas mensagens reais de cliente acionam o agente (protege contra ecos e loops)
  if (payload.message.sender_type !== 'customer') {
    return { executed: false, reason: 'non_customer_sender' }
  }

  // 1.1 Validação de ciclo de vida do tenant (1ª Verificação - Início do Ciclo)
  // Bloqueia preventivamente empresas suspensas, canceladas ou em implantação
  // antes de carregar conversa, resolver agentes ou invocar o Agent Engine (LLM).
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    const errorMsg = err instanceof TenantAccessError ? err.message : 'Falha ao verificar autorização da empresa'
    console.warn(`[AutonomousCycle Blocked req:${eventId}] Tenant '${companyId}' bloqueado no início do ciclo: ${errorMsg}`)
    return {
      executed: false,
      dispatched: false,
      reason: 'tenant_blocked',
      error: errorMsg
    }
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
    skipCustomerMessageInsert: true,
    llmProvider: params.llmProvider
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
      const { error: suppMsgErr } = await supabase.from('messages').update({
        metadata: { delivery_status: 'suppressed', suppression_reason: 'handoff' }
      })
        .eq('id', agentResult.messageId)
        .eq('company_id', companyId)

      if (suppMsgErr) {
        console.error('[AutonomousCycle Suppress Error] Falha ao atualizar metadata da mensagem:', suppMsgErr)
      }
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

  // 8.1 Segunda Validação do Tenant (Imediatamente antes do despacho externo)
  // Reduz drasticamente a janela de corrida (TOCTOU) decorrente do tempo de inferência do LLM.
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    const errorMsg = err instanceof TenantAccessError ? err.message : 'Falha ao verificar autorização da empresa'
    const blockCode = err instanceof TenantAccessError ? err.code : 'TENANT_STATUS_UNAVAILABLE'
    console.warn(`[AutonomousCycle Blocked req:${eventId}] Tenant '${companyId}' bloqueado na 2ª verificação pré-despacho: ${blockCode}`)

    // Suprime o despacho na outbox e na mensagem
    if (outboxEntry?.id) {
      try {
        const outboxBuilder = (supabase as any).from('message_outbox').update({
          status: 'suppressed',
          attempts: 1,
          last_error: `Despacho suprimido antes do envio: ${errorMsg}`,
          updated_at: new Date().toISOString()
        })
          .eq('id', outboxEntry.id)

        const { error: outboxErr } = await (
          typeof outboxBuilder?.eq === 'function'
            ? outboxBuilder.eq('company_id', companyId)
            : outboxBuilder
        )

        if (outboxErr) {
          console.error(`[AutonomousCycle Outbound Error] Falha ao atualizar outbox para suppressed: ${outboxErr.message || JSON.stringify(outboxErr)}`)
        }
      } catch (dbErr: any) {
        console.error(`[AutonomousCycle Outbound Error] Falha ao persistir outbox suppressed: ${dbErr?.message || dbErr}`)
      }
    }

    if (agentResult.messageId) {
      try {
        const { error: msgErr } = await supabase.from('messages').update({
          metadata: {
            delivery_status: 'suppressed',
            delivery_error: errorMsg
          }
        })
          .eq('id', agentResult.messageId)
          .eq('company_id', companyId)

        if (msgErr) {
          console.error(`[AutonomousCycle Outbound Error] Falha ao atualizar message para suppressed: ${msgErr.message || JSON.stringify(msgErr)}`)
        }
      } catch (dbErr: any) {
        console.error(`[AutonomousCycle Outbound Error] Falha ao persistir message suppressed: ${dbErr?.message || dbErr}`)
      }
    }

    return {
      executed: true,
      dispatched: false,
      reason: 'tenant_blocked',
      agentId: selectedAgentId,
      replyMessageId: agentResult.messageId,
      outboxId: outboxEntry?.id,
      error: errorMsg
    }
  }

  const outboundRes = await sendOutboundMessage(companyId, outboundPayload, { adminClient: supabase })

  if (outboundRes.success) {
    if (outboxEntry?.id) {
      const { error: outboxErr } = await supabase.from('message_outbox').update({
        status: 'sent',
        attempts: 1,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
        .eq('id', outboxEntry.id)
        .eq('company_id', companyId)

      if (outboxErr) {
        console.error(`[AutonomousCycle Outbound Error] Falha ao atualizar outbox para sent: ${outboxErr.message || JSON.stringify(outboxErr)}`)
      }
    }
    if (agentResult.messageId) {
      const { error: msgErr } = await supabase.from('messages').update({
        metadata: { delivery_status: 'sent' }
      })
        .eq('id', agentResult.messageId)
        .eq('company_id', companyId)

      if (msgErr) {
        console.error(`[AutonomousCycle Outbound Error] Falha ao atualizar message para sent: ${msgErr.message || JSON.stringify(msgErr)}`)
      }
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
    const isTenantBlocked = outboundRes.reason === 'tenant_blocked'
    if (outboxEntry?.id) {
      const { error: outboxErr } = await supabase.from('message_outbox').update({
        status: isTenantBlocked ? 'suppressed' : 'failed',
        attempts: 1,
        last_error: outboundRes.error || outboundRes.reason || 'Falha no envio outbound',
        updated_at: new Date().toISOString()
      })
        .eq('id', outboxEntry.id)
        .eq('company_id', companyId)

      if (outboxErr) {
        console.error(`[AutonomousCycle Outbound Error] Falha ao atualizar outbox para ${isTenantBlocked ? 'suppressed' : 'failed'}: ${outboxErr.message || JSON.stringify(outboxErr)}`)
      }
    }
    if (agentResult.messageId) {
      const { error: msgErr } = await supabase.from('messages').update({
        metadata: {
          delivery_status: isTenantBlocked ? 'suppressed' : 'failed',
          delivery_error: outboundRes.error || outboundRes.reason
        }
      })
        .eq('id', agentResult.messageId)
        .eq('company_id', companyId)

      if (msgErr) {
        console.error(`[AutonomousCycle Outbound Error] Falha ao atualizar message para ${isTenantBlocked ? 'suppressed' : 'failed'}: ${msgErr.message || JSON.stringify(msgErr)}`)
      }
    }
    return {
      executed: true,
      dispatched: false,
      reason: outboundRes.reason || 'outbound_failed',
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id.trim())
}

export type RetryOutboxResult = {
  success: boolean
  alreadySent?: boolean
  suppressed?: boolean
  code?: string
  statusCode?: number
  error?: string
}

/**
 * Reenvia uma mensagem pendente/falha da outbox sem reexecutar o LLM.
 * Exige validação de tenant explícita (companyId) para impedir operações cross-tenant sob service_role.
 */
export async function retryOutboxMessage(
  companyId: string,
  outboxId: string,
  options?: { adminClient?: any }
): Promise<RetryOutboxResult> {
  // 1. Validação Sintática de UUIDs (Defesa Pré-Banco)
  if (!isValidUuid(companyId) || !isValidUuid(outboxId)) {
    return { success: false, error: 'Identificador inválido fornecido.' }
  }

  const supabase = options?.adminClient || createAdminClient()

  // 2. Consulta com filtro obrigatório duplo: id e company_id (Defesa em Profundidade)
  const outboxBuilder = (supabase as any)
    .from('message_outbox')
    .select('*')
    .eq('id', outboxId)

  const { data: record, error } = await (
    typeof outboxBuilder?.eq === 'function'
      ? outboxBuilder.eq('company_id', companyId).maybeSingle()
      : outboxBuilder.single()
  )

  if (error) {
    return { success: false, error: `Falha na consulta da outbox: ${error.message}` }
  }

  // Não revela se o UUID existe em outro tenant
  if (!record || record.company_id !== companyId) {
    return { success: false, error: 'Registro não encontrado' }
  }

  // 3. Verificação de elegibilidade do estado da Outbox
  if (record.status === 'sent') {
    return { success: true, alreadySent: true }
  }
  if (record.status === 'suppressed') {
    return { success: false, error: 'Mensagem suprimida não pode ser reprocessada', suppressed: true }
  }
  if (record.status !== 'failed' && record.status !== 'pending') {
    return { success: false, error: `Registro em estado não elegível para retry: ${record.status}` }
  }

  // 4. Validação de integridade da mensagem vinculada (se houver message_id)
  if (record.message_id) {
    const msgQuery = (supabase as any)
      .from('messages')
      .select('id, company_id')
      .eq('id', record.message_id)

    const { data: linkedMsg } = await (
      typeof msgQuery?.eq === 'function'
        ? msgQuery.eq('company_id', companyId).maybeSingle()
        : (typeof msgQuery?.maybeSingle === 'function' ? msgQuery.maybeSingle() : msgQuery.single())
    ).catch(() => ({ data: null }))

    if (!linkedMsg) {
      // Verifica se a mensagem pertence a outro tenant para diagnosticar adulteração cross-tenant
      const { data: crossMsg } = await (supabase as any)
        .from('messages')
        .select('id, company_id')
        .eq('id', record.message_id)
        .maybeSingle()
        .catch(() => ({ data: null }))

      if (crossMsg && crossMsg.company_id !== companyId) {
        return {
          success: false,
          error: 'Mensagem vinculada não encontrada ou pertence a outro tenant'
        }
      }
    }
  }

  // 5. Validação centralizada do ciclo de vida do tenant antes do envio externo
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    const errorMsg = err instanceof TenantAccessError ? err.message : 'Falha ao verificar autorização da empresa'
    const blockCode = err instanceof TenantAccessError ? err.code : 'TENANT_STATUS_UNAVAILABLE'
    const statusCode = err instanceof TenantAccessError ? err.statusCode : 503

    // Tenta persistir a supressão definitiva para evitar retentativas futuras, com escopo duplo
    try {
      const outboxBuilder = (supabase as any).from('message_outbox').update({
        status: 'suppressed',
        last_error: `Envio suprimido: ${errorMsg}`,
        updated_at: new Date().toISOString()
      })
        .eq('id', outboxId)

      const { error: updateErr } = await (
        typeof outboxBuilder?.eq === 'function'
          ? outboxBuilder.eq('company_id', companyId)
          : outboxBuilder
      )
      if (updateErr) {
        console.error(`[RetryOutbox Error] Falha ao persistir status suppressed: ${updateErr.message || JSON.stringify(updateErr)}`)
      }
    } catch (dbErr: any) {
      console.error(`[RetryOutbox Error] Falha ao persistir status suppressed: ${dbErr?.message || dbErr}`)
    }

    return {
      success: false,
      code: blockCode,
      statusCode,
      suppressed: true,
      error: errorMsg
    }
  }

  // 6. Despacho seguro via Gateway Outbound
  const outboundRes = await sendOutboundMessage(companyId, record.payload, { adminClient: supabase })

  // 7. Atualização pós-despacho protegida com ID e Empresa simultaneamente
  if (outboundRes.success) {
    const outboxBuilder = (supabase as any).from('message_outbox').update({
      status: 'sent',
      attempts: (record.attempts || 0) + 1,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
      .eq('id', outboxId)

    const { error: updateErr } = await (
      typeof outboxBuilder?.eq === 'function'
        ? outboxBuilder.eq('company_id', companyId)
        : outboxBuilder
    )
    if (updateErr) {
      console.error(`[RetryOutbox Error] Falha ao atualizar outbox para sent: ${updateErr.message || JSON.stringify(updateErr)}`)
    }
    return { success: true }
  } else {
    const isTenantBlocked = outboundRes.reason === 'tenant_blocked'
    const outboxBuilder = (supabase as any).from('message_outbox').update({
      status: isTenantBlocked ? 'suppressed' : 'failed',
      attempts: (record.attempts || 0) + 1,
      last_error: outboundRes.error || outboundRes.reason,
      updated_at: new Date().toISOString()
    })
      .eq('id', outboxId)

    const { error: updateErr } = await (
      typeof outboxBuilder?.eq === 'function'
        ? outboxBuilder.eq('company_id', companyId)
        : outboxBuilder
    )
    if (updateErr) {
      console.error(`[RetryOutbox Error] Falha ao atualizar outbox para ${isTenantBlocked ? 'suppressed' : 'failed'}: ${updateErr.message || JSON.stringify(updateErr)}`)
    }
    return {
      success: false,
      code: (outboundRes as any).code,
      statusCode: (outboundRes as any).statusCode,
      suppressed: isTenantBlocked,
      error: outboundRes.error || outboundRes.reason
    }
  }
}
