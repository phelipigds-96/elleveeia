import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/service'
import type { WebhookPayload, DeliveryStatus } from '@/lib/validations/webhook'
import { runAgentEngine } from '@/lib/services/agent/engine'
import { sendOutboundMessage } from '@/lib/services/n8n-internal'
import { requireActiveCompany, TenantAccessError } from '@/lib/services/platform/tenant-access'
import { prepareOutboundMessage } from '@/lib/services/outbound-internal'
import { assignDefaultWorkflowStages } from '@/lib/services/workflows/conversation-workflow'
import { getBrazilianPhoneVariants } from '@/lib/services/phone-normalization'
import { buildFallbackCustomerName, isPlausibleHumanName, normalizeRawName, sanitizeCustomerName } from '@/lib/services/customer-name'
export type ProcessWebhookResult = 
  | { success: true; duplicate: true; event_id: string; webhook_event_id?: string; conversation_id?: undefined; message_id?: undefined }
  | { success: true; duplicate: false; event_id: string; webhook_event_id?: string; conversation_id: string; message_id: string }

export async function processWebhookEvent(
  companyId: string, 
  payload: WebhookPayload,
  options?: { adminClient?: any; retryWebhookEventRowId?: string }
): Promise<ProcessWebhookResult> {
  const supabase = options?.adminClient || createAdminClient()

  // 0. Validação de ciclo de vida do tenant (Defesa em Profundidade)
  // Garante que mesmo chamadores internos/diretos não persistam registros para empresas bloqueadas
  await requireActiveCompany(companyId, { adminClient: supabase })

  // 1. Controle de Idempotência (ou Retomada de Ingestão Travada via Worker)
  let eventRecord: any = null

  if (options?.retryWebhookEventRowId) {
    const { data: existingEvent, error: existingEventErr } = await supabase
      .from('webhook_events')
      .select('id, company_id, event_id, event_type, status')
      .eq('id', options.retryWebhookEventRowId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (existingEventErr || !existingEvent) {
      throw new Error(`Evento de recuperação não localizado em webhook_events: ${existingEventErr?.message || options.retryWebhookEventRowId}`)
    }
    eventRecord = existingEvent
  } else {
    // Registra o evento. Se já existir o par company_id + event_id (Violate Unique Constraint), retornamos duplicate
    const { data: insertedEvent, error: eventError } = await supabase.from('webhook_events').insert({
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
    eventRecord = insertedEvent
  }

  try {
    // 2. Customer Upsert (Localiza ou Cria cliente baseado em Company + Phone com espelhamento híbrido)
    let customerId: string
    const phoneVariants = getBrazilianPhoneVariants(payload.customer.phone)
    let { data: existingCustomer, error: custLookupErr } = await supabase.from('customers')
      .select('id, name, phone, name_confirmed, name_source')
      .eq('company_id', companyId)
      .in('phone', phoneVariants)
      .limit(1)
      .maybeSingle()

    if (custLookupErr && custLookupErr.code === '42703') {
      const baseLookup = await supabase.from('customers')
        .select('id, name, phone')
        .eq('company_id', companyId)
        .in('phone', phoneVariants)
        .limit(1)
        .maybeSingle()
      existingCustomer = baseLookup.data
    }

    const avatarUrl = payload.customer.avatar_url || payload.customer.profile_picture_url || null
    const rawIncomingName = normalizeRawName(payload.customer.name)
    const incomingPlausible = isPlausibleHumanName(rawIncomingName)
    const cleanIncomingName = incomingPlausible ? sanitizeCustomerName(rawIncomingName) : ''

    if (existingCustomer) {
      customerId = existingCustomer.id
      const hasConfirmedName =
        existingCustomer.name_confirmed === true ||
        existingCustomer.name_source === 'manual' ||
        existingCustomer.name_source === 'agent_collected' ||
        (existingCustomer.name_confirmed === undefined && isPlausibleHumanName(existingCustomer.name))

      // Preserva nomes já confirmados/editados e sempre espelha whatsapp_name/avatar_url
      const updateData: any = {}
      if (!hasConfirmedName && incomingPlausible && cleanIncomingName) {
        updateData.name = cleanIncomingName
        updateData.name_confirmed = true
        updateData.name_source = 'whatsapp_push'
      }
      if (rawIncomingName) {
        updateData.whatsapp_name = rawIncomingName
      }
      if (avatarUrl) {
        updateData.avatar_url = avatarUrl
      }

      if (Object.keys(updateData).length > 0) {
        const { error: custErr } = await supabase
          .from('customers')
          .update(updateData)
          .eq('id', customerId)
          .eq('company_id', companyId)

        // Fallback gracioso se colunas novas ainda não existirem no banco (42703)
        if (custErr && custErr.code === '42703') {
          if (!hasConfirmedName && incomingPlausible && cleanIncomingName) {
            await supabase
              .from('customers')
              .update({ name: cleanIncomingName })
              .eq('id', customerId)
              .eq('company_id', companyId)
          }
        } else if (custErr) {
          console.error('[processWebhookEvent] Erro ao atualizar dados do cliente:', custErr)
        }
      }
    } else {
      const resolvedName =
        incomingPlausible && cleanIncomingName
          ? cleanIncomingName
          : buildFallbackCustomerName(payload.customer.phone)

      const insertData: any = {
        company_id: companyId,
        name: resolvedName,
        phone: payload.customer.phone,
        email: payload.customer.email || null,
        whatsapp_name: rawIncomingName || null,
        name_confirmed: incomingPlausible,
        name_source: 'whatsapp_push'
      }
      if (avatarUrl) {
        insertData.avatar_url = avatarUrl
      }

      let { data: newCustomer, error: cErr } = await supabase
        .from('customers')
        .insert(insertData)
        .select()
        .single()

      // Fallback gracioso se colunas novas ainda não existirem no banco (42703)
      if (cErr && cErr.code === '42703') {
        const fallbackRes = await supabase.from('customers').insert({
          company_id: companyId,
          name: resolvedName,
          phone: payload.customer.phone,
          email: payload.customer.email || null
        }).select().single()
        newCustomer = fallbackRes.data
        cErr = fallbackRes.error
      }

      if (cErr) throw new Error('Falha ao criar cliente: ' + cErr.message)
      customerId = newCustomer.id
    }

    // 3. Conversation Upsert (Localiza por External ID ou busca conversa ativa para o cliente)
    let conversationId: string
    let convStatus = 'open'
    
    let convQuery = supabase.from('conversations')
      .select('id, status, workflow_id, workflow_stage_id, external_id')
      .eq('company_id', companyId)
      
    if (payload.conversation?.external_id) {
      convQuery = convQuery.eq('external_id', payload.conversation.external_id)
    } else {
      // Se a integração não manda ID de conversa, procura conversa existente do cliente no canal (ordenando pela mais recente)
      convQuery = convQuery.eq('customer_id', customerId)
        .eq('channel', payload.channel)
        .order('last_message_at', { ascending: false })
    }

    let { data: existingConv } = await convQuery.maybeSingle()

    // Se não localizou por external_id exato, mas o cliente já possui conversa aberta/recente criada manualmente no painel
    if (!existingConv && customerId) {
      const { data: manualConv } = await supabase.from('conversations')
        .select('id, status, workflow_id, workflow_stage_id, external_id')
        .eq('company_id', companyId)
        .eq('customer_id', customerId)
        .eq('channel', payload.channel)
        .order('last_message_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (manualConv) {
        existingConv = manualConv
        // Vincula o external_id à conversa existente para evitar duplicidade de janelas
        if (!manualConv.external_id && payload.conversation?.external_id) {
          await supabase.from('conversations')
            .update({ external_id: payload.conversation.external_id })
            .eq('id', manualConv.id)
            .eq('company_id', companyId)
        }
      }
    }

    if (existingConv) {
      conversationId = existingConv.id
      convStatus = existingConv.status
      
      // Regra de reabertura automática de conversa
      if (convStatus === 'closed' && payload.message.sender_type === 'customer') {
         convStatus = 'open'
      }

      // Backfill do funil: conversas antigas criadas antes da atribuição automática
      // entram na primeira etapa do workflow padrão assim que recebem uma mensagem.
      if (!existingConv.workflow_stage_id) {
        await assignDefaultWorkflowStages(supabase, companyId, conversationId)
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

      // Entrada no funil: toda conversa nova nasce na primeira etapa do workflow padrão
      await assignDefaultWorkflowStages(supabase, companyId, conversationId)
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

    // 6. Finaliza a transação lógica marcando o evento como processado e preparando o ciclo autônomo
    const nowIso = new Date().toISOString()
    const isCustomerMsg = payload.message.sender_type === 'customer'
    const extendedFinalizePatch: Record<string, any> = {
      status: 'processed',
      processed_at: nowIso,
      conversation_id: conversationId,
      message_id: msg.id,
      autonomous_status: isCustomerMsg ? 'pending' : 'skipped',
      autonomous_locked_until: isCustomerMsg ? new Date(Date.now() + 90_000).toISOString() : null,
      autonomous_claim_token: null,
      autonomous_last_error: null,
      updated_at: nowIso
    }

    const finalizeRes = await supabase.from('webhook_events')
      .update(extendedFinalizePatch)
      .eq('id', eventRecord.id)
      .eq('company_id', companyId)

    // Degradação graciosa se a migration 2B (colunas novas) ainda não tiver sido aplicada (42703)
    if (finalizeRes?.error?.code === '42703') {
      await supabase.from('webhook_events').update({
        status: 'processed',
        processed_at: nowIso
      })
        .eq('id', eventRecord.id)
        .eq('company_id', companyId)
    }

    return {
      success: true,
      duplicate: false,
      event_id: payload.event_id,
      webhook_event_id: eventRecord?.id,
      conversation_id: conversationId,
      message_id: msg.id
    }

  } catch (err: any) {
    // Falha em cascata detectada. Marca o evento como error na camada mais baixa.
    const errRes = await supabase.from('webhook_events').update({
      status: 'error',
      error_message: err.message,
      autonomous_claim_token: null,
      autonomous_last_error: err.message,
      updated_at: new Date().toISOString()
    })
      .eq('id', eventRecord.id)
      .eq('company_id', companyId)

    if (errRes?.error?.code === '42703') {
      await supabase.from('webhook_events').update({
        status: 'error',
        error_message: err.message
      })
        .eq('id', eventRecord.id)
        .eq('company_id', companyId)
    }
    
    throw err
  }
}


export interface AutonomousCycleParams {
  companyId: string
  conversationId: string
  messageId: string
  eventId: string
  payload: WebhookPayload
  webhookEventRowId?: string
  autonomousClaimToken?: string
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
  providerMessageId?: string
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
async function applyMetadataPatchSafely(
  supabase: any,
  companyId: string,
  messageId: string,
  baseMetadata: Record<string, any>,
  patch: Record<string, any>
): Promise<void> {
  if (typeof supabase?.rpc === 'function' && isValidUuid(companyId) && isValidUuid(messageId)) {
    const res = await updateMessageMetadataSafe(supabase, companyId, messageId, patch)
    if (!res.success) {
      console.warn(`[message-engine] Falha ao mesclar metadata monotonicamente (${messageId}):`, res.error)
    }
    return
  }

  await supabase
    .from('messages')
    .update({
      metadata: {
        ...baseMetadata,
        ...patch
      }
    })
    .eq('id', messageId)
    .eq('company_id', companyId)
}

function isMissingDatabaseRoutineError(err: any): boolean {
  const code = String(err?.code || '')
  const msg = String(err?.message || '').toLowerCase()
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist') ||
    msg.includes('not implemented')
  )
}

async function acquireConversationLockWithRetry(
  supabase: any,
  companyId: string,
  conversationId: string,
  leaseSeconds = 65,
  maxWaitMs = 2500
): Promise<{ acquired: boolean; lockToken?: string; bypass?: boolean }> {
  if (typeof supabase?.rpc !== 'function' || !isValidUuid(companyId) || !isValidUuid(conversationId)) {
    return { acquired: false, bypass: true }
  }

  const deadline = Date.now() + maxWaitMs
  const delays = [500, 900, 1100]

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const rpcRes = await supabase.rpc('acquire_conversation_processing_lock', {
        p_company_id: companyId,
        p_conversation_id: conversationId,
        p_lease_seconds: leaseSeconds
      })

      if (!rpcRes || rpcRes.error) {
        if (!rpcRes || isMissingDatabaseRoutineError(rpcRes.error)) {
          return { acquired: false, bypass: true }
        }
        console.warn('[ConversationLock] Erro ao adquirir lock (seguindo sem bloqueio):', rpcRes.error.message)
        return { acquired: false, bypass: true }
      }

      const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data
      if (!row || row.was_acquired === undefined) {
        return { acquired: false, bypass: true }
      }

      if (row.was_acquired && row.lock_token) {
        return { acquired: true, lockToken: row.lock_token }
      }
    } catch (err: any) {
      if (isMissingDatabaseRoutineError(err)) {
        return { acquired: false, bypass: true }
      }
      return { acquired: false, bypass: true }
    }

    if (attempt >= delays.length || Date.now() >= deadline) {
      break
    }

    const waitMs = Math.min(delays[attempt], Math.max(50, deadline - Date.now()))
    await new Promise(resolve => setTimeout(resolve, waitMs))
  }

  return { acquired: false, bypass: false }
}

async function releaseConversationLockSafe(
  supabase: any,
  companyId: string,
  conversationId: string,
  lockToken?: string
): Promise<void> {
  if (!lockToken || typeof supabase?.rpc !== 'function') return
  try {
    await supabase.rpc('release_conversation_processing_lock', {
      p_company_id: companyId,
      p_conversation_id: conversationId,
      p_lock_token: lockToken
    })
  } catch {}
}

async function finalizeWebhookAutonomousStatusSafe(
  supabase: any,
  params: {
    companyId: string
    webhookEventRowId?: string
    claimToken?: string
    status: 'pending' | 'completed' | 'skipped' | 'failed'
    lastError?: string | null
    retryAfterSec?: number | null
  }
): Promise<void> {
  if (!params.webhookEventRowId || typeof supabase?.rpc !== 'function' || !isValidUuid(params.companyId)) {
    return
  }

  try {
    await supabase.rpc('complete_webhook_autonomous_event', {
      p_company_id: params.companyId,
      p_webhook_event_id: params.webhookEventRowId,
      p_claim_token: params.claimToken || null,
      p_autonomous_status: params.status,
      p_last_error: params.lastError || null,
      p_retry_after_sec: params.retryAfterSec ?? null
    })
  } catch {}
}

export async function handleAutonomousCycle(
  params: AutonomousCycleParams,
  options?: { adminClient?: any }
): Promise<AutonomousCycleResult> {
  const { companyId, conversationId, payload, webhookEventRowId, autonomousClaimToken } = params
  const supabase = params.adminClient || options?.adminClient || createAdminClient()

  // 1. Condicao: Apenas mensagens reais de cliente acionam o agente (protege contra ecos e loops)
  if (payload.message.sender_type !== 'customer') {
    await finalizeWebhookAutonomousStatusSafe(supabase, {
      companyId,
      webhookEventRowId,
      claimToken: autonomousClaimToken,
      status: 'skipped',
      lastError: 'non_customer_sender'
    })
    return { executed: false, reason: 'non_customer_sender' }
  }

  // 1.1 Validação de ciclo de vida do tenant (1ª Verificação - Início do Ciclo)
  // Bloqueia preventivamente empresas suspensas, canceladas ou em implantação
  // antes de carregar conversa, resolver agentes ou invocar o Agent Engine (LLM).
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    const errorMsg = err instanceof TenantAccessError ? err.message : 'Falha ao verificar autorização da empresa'
    console.warn(`[AutonomousCycle Blocked req:${params.eventId}] Tenant '${companyId}' bloqueado no início do ciclo: ${errorMsg}`)
    await finalizeWebhookAutonomousStatusSafe(supabase, {
      companyId,
      webhookEventRowId,
      claimToken: autonomousClaimToken,
      status: 'skipped',
      lastError: 'tenant_blocked'
    })
    return {
      executed: false,
      dispatched: false,
      reason: 'tenant_blocked',
      error: errorMsg
    }
  }

  // 1.2 Lock distribuído por conversa (serializa turnos rápidos do mesmo cliente sem pg_advisory_lock)
  const lockLeaseSeconds = 65
  const lockMaxWaitMs = autonomousClaimToken ? 600 : 2500
  const lockResult = await acquireConversationLockWithRetry(
    supabase,
    companyId,
    conversationId,
    lockLeaseSeconds,
    lockMaxWaitMs
  )

  if (!lockResult.bypass && !lockResult.acquired) {
    console.warn(`[AutonomousCycle Lock Busy] Conversa ${conversationId} em processamento por outro worker; deferindo evento ${params.eventId}`)
    await finalizeWebhookAutonomousStatusSafe(supabase, {
      companyId,
      webhookEventRowId,
      claimToken: autonomousClaimToken,
      status: 'pending',
      lastError: 'conversation_lock_busy',
      retryAfterSec: 10
    })
    return {
      executed: false,
      dispatched: false,
      reason: 'conversation_lock_busy',
      error: 'Conversa em processamento concorrente; tentativa adiada.'
    }
  }

  let result: AutonomousCycleResult
  try {
    result = await executeLockedAutonomousCycle(params, supabase)
  } catch (err: any) {
    await finalizeWebhookAutonomousStatusSafe(supabase, {
      companyId,
      webhookEventRowId,
      claimToken: autonomousClaimToken,
      status: 'pending',
      lastError: err?.message || 'unhandled_cycle_error',
      retryAfterSec: 15
    })
    throw err
  } finally {
    await releaseConversationLockSafe(supabase, companyId, conversationId, lockResult.lockToken)
  }

  // Mapeia desfecho final para webhook_events:
  // - Outbox já criada (dispatched, idempotent_duplicate, unknown_outcome, outbound_failed, claim_*) -> ciclo autônomo resolvido (outbox-worker assume retries se necessário)
  // - Erro pré-outbox (agent_engine_failed / prepare_outbound_failed) -> retorna para 'pending' para recuperação no worker
  // - Demais skips definitivos (human_mode_active, conversation_closed, suppressed_by_handoff, no_active_agents_*) -> 'skipped'
  if (webhookEventRowId) {
    const outboxCreated = Boolean(result.outboxId)
    const isCompleted = Boolean(result.dispatched) || result.reason === 'idempotent_duplicate' || outboxCreated
    const isRetryablePreOutbox = !outboxCreated && (
      result.reason === 'agent_engine_failed' ||
      result.reason === 'prepare_outbound_failed' ||
      result.reason === 'conversation_lock_busy'
    )

    if (isRetryablePreOutbox) {
      await finalizeWebhookAutonomousStatusSafe(supabase, {
        companyId,
        webhookEventRowId,
        claimToken: autonomousClaimToken,
        status: 'pending',
        lastError: result.error || result.reason || 'retryable_cycle_error',
        retryAfterSec: 15
      })
    } else if (result.reason === 'suppressed_by_handoff' || result.reason === 'tenant_blocked') {
      await finalizeWebhookAutonomousStatusSafe(supabase, {
        companyId,
        webhookEventRowId,
        claimToken: autonomousClaimToken,
        status: 'skipped',
        lastError: result.reason
      })
    } else if (isCompleted) {
      await finalizeWebhookAutonomousStatusSafe(supabase, {
        companyId,
        webhookEventRowId,
        claimToken: autonomousClaimToken,
        status: 'completed',
        lastError: null
      })
    } else {
      await finalizeWebhookAutonomousStatusSafe(supabase, {
        companyId,
        webhookEventRowId,
        claimToken: autonomousClaimToken,
        status: 'skipped',
        lastError: result.reason || result.error || 'cycle_skipped'
      })
    }
  }

  return result
}

async function executeLockedAutonomousCycle(
  params: AutonomousCycleParams,
  supabase: any
): Promise<AutonomousCycleResult> {
  const { companyId, conversationId, messageId, eventId, payload, webhookEventRowId } = params

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

  // 4.1 Deduplicação Pré-LLM: Verifica se já existe outbox para este evento nesta empresa
  const cleanEventId = (eventId || '').trim()
  if (!cleanEventId) {
    return { executed: false, reason: 'missing_event_id' }
  }

  const idempotencyKey = cleanEventId.length <= 115 
    ? `agent-reply-${cleanEventId}` 
    : `agent-reply-${crypto.createHash('sha256').update(cleanEventId).digest('hex').slice(0, 64)}`

  const { data: existingOutbox } = await supabase
    .from('message_outbox')
    .select('id, message_id, status')
    .eq('company_id', companyId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existingOutbox) {
    console.log(`[AutonomousCycle Duplicate Pre-LLM] Idempotência prévia detectada para chave ${idempotencyKey} (outbox: ${existingOutbox.id}, status: ${existingOutbox.status})`)
    return {
      executed: true,
      dispatched: false,
      reason: 'idempotent_duplicate',
      agentId: selectedAgentId,
      replyMessageId: existingOutbox.message_id,
      outboxId: existingOutbox.id
    }
  }

  // 5. Execucao do Agent Engine desacoplado com persistMessage: false
  const agentResult = await runAgentEngine({
    companyId,
    agentId: selectedAgentId,
    conversationId,
    userMessage: payload.message.content,
    skipCustomerMessageInsert: true,
    persistMessage: false,
    llmProvider: params.llmProvider,
    triggerEventId: cleanEventId,
    webhookEventId: webhookEventRowId
  })

  if (!agentResult.success || !agentResult.message) {
    return { executed: false, reason: 'agent_engine_failed', error: agentResult.error }
  }

  // 6. Trava de Handoff Concorrente (Nível 1 - Pré-preparação):
  // Verifica se um atendente assumiu ou se a conversa foi encerrada durante a execução do LLM
  const { data: latestConv } = await supabase
    .from('conversations')
    .select('status')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  if (latestConv?.status === 'human' && !agentResult.handoffTriggered) {
    console.log(`[AutonomousCycle Suppressed] Conversa ${conversationId} entrou em handoff humano durante processamento do LLM`)
    return { executed: true, dispatched: false, reason: 'suppressed_by_handoff' }
  }

  if (latestConv?.status === 'closed') {
    console.log(`[AutonomousCycle Suppressed] Conversa ${conversationId} foi encerrada durante processamento do LLM`)
    return { executed: true, dispatched: false, reason: 'conversation_closed' }
  }

  // 7. Preparar Payload de Saida e Metadados Transacionais com Working Memory
  const messageMetadata: Record<string, any> = {
    ...(agentResult.metadata || {}),
    agent_id: selectedAgentId,
    trigger_event_id: eventId,
    trigger_message_id: messageId
  }

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
      trigger_message_id: messageId
    }
  }

  // 8. Criação Atômica Transacional via Fundação Outbound (prepareOutboundMessage)
  const prepResult = await prepareOutboundMessage({
    companyId,
    conversationId,
    content: agentResult.message,
    senderType: 'agent',
    senderId: null,
    idempotencyKey,
    channel: outboundPayload.channel,
    recipient: recipientPhone,
    metadata: messageMetadata,
    payload: outboundPayload
  }, { adminClient: supabase })

  if (!prepResult.success) {
    console.error(`[AutonomousCycle Prepare Error] Falha ao preparar mensagem de saída: ${prepResult.error}`)

    // Se a falha for por tenant suspenso durante a inferência (janela TOCTOU de 8.4.3H)
    if (prepResult.code === 'TENANT_SUSPENDED' || prepResult.code === 'TENANT_NOT_ACTIVE' || prepResult.code === 'TENANT_STATUS_UNAVAILABLE') {
      const { data: suppMsg } = await supabase.from('messages').insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: 'agent',
        content: agentResult.message,
        message_type: 'text',
        metadata: {
          ...messageMetadata,
          delivery_status: 'suppressed',
          delivery_error: prepResult.error
        }
      }).select('id').maybeSingle()

      const suppOutbox = await recordOutboxEntry(supabase, {
        company_id: companyId,
        conversation_id: conversationId,
        message_id: suppMsg?.id || null,
        idempotency_key: idempotencyKey,
        channel: outboundPayload.channel,
        recipient: recipientPhone,
        payload: outboundPayload,
        status: 'pending'
      })

      if (suppOutbox?.id) {
        try {
          const outboxBuilder = (supabase as any).from('message_outbox').update({
            status: 'suppressed',
            attempts: 1,
            last_error: `Despacho suprimido antes do envio: ${prepResult.error}`,
            updated_at: new Date().toISOString()
          })
            .eq('id', suppOutbox.id)

          await (
            typeof outboxBuilder?.eq === 'function'
              ? outboxBuilder.eq('company_id', companyId)
              : outboxBuilder
          )
        } catch (dbErr: any) {
          console.error(`[AutonomousCycle Outbound Error] Falha ao persistir outbox suppressed: ${dbErr?.message || dbErr}`)
        }
      }

      return {
        executed: true,
        dispatched: false,
        reason: 'tenant_blocked',
        agentId: selectedAgentId,
        replyMessageId: suppMsg?.id,
        outboxId: suppOutbox?.id,
        error: prepResult.error
      }
    }

    return {
      executed: false,
      reason: prepResult.code || 'prepare_outbound_failed',
      error: prepResult.error
    }
  }

  // 8.1 Deduplicação idempotente estrita: não realiza novo despacho
  if (prepResult.duplicate) {
    console.log(`[AutonomousCycle Duplicate] Idempotência detectada para chave ${idempotencyKey}`)
    return {
      executed: true,
      dispatched: false,
      reason: 'idempotent_duplicate',
      agentId: selectedAgentId,
      replyMessageId: prepResult.messageId,
      outboxId: prepResult.outboxId
    }
  }

  const outboxId = prepResult.outboxId
  const replyMessageId = prepResult.messageId

  // 9. Reivindicação Atômica com Fencing Token e Lease (claim_outbox_message)
  const autonomousLeaseSeconds = 120
  const { data: claimData, error: claimErr } = await (supabase as any).rpc('claim_outbox_message', {
    p_company_id: companyId,
    p_outbox_id: outboxId,
    p_lease_seconds: autonomousLeaseSeconds
  })

  if (claimErr) {
    console.error(`[AutonomousCycle Claim Error] Erro ao reivindicar outbox ${outboxId}: ${claimErr.message}`)
    return {
      executed: true,
      dispatched: false,
      reason: 'claim_rpc_error',
      agentId: selectedAgentId,
      replyMessageId,
      outboxId,
      error: claimErr.message
    }
  }

  const claim = Array.isArray(claimData) ? claimData[0] : claimData

  if (!claim || !claim.was_claimed) {
    console.warn(`[AutonomousCycle Claim Denied] Reivindicação negada para outbox ${outboxId}: ${claim?.error_reason}`)
    return {
      executed: true,
      dispatched: false,
      reason: claim?.error_reason || 'claim_denied',
      agentId: selectedAgentId,
      replyMessageId,
      outboxId,
      error: claim?.error_reason || 'Reivindicação de outbox não concedida'
    }
  }

  // 10. Proteção Pré-Despacho (Nível 2 - Handoff pós-claim e validação estrita de tenant)
  let tenantActive = true
  let tenantBlockReason = ''
  try {
    await requireActiveCompany(companyId, { adminClient: supabase })
  } catch (err: any) {
    tenantActive = false
    tenantBlockReason = err instanceof TenantAccessError ? err.message : 'Empresa não autorizada'
  }

  const { data: preDispatchConv } = await supabase
    .from('conversations')
    .select('status')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .single()

  const isHandoff = preDispatchConv?.status === 'human' && !agentResult.handoffTriggered
  const isClosed = preDispatchConv?.status === 'closed'

  if (!tenantActive || isHandoff || isClosed) {
    const suppressReason = !tenantActive
      ? `Despacho suprimido antes do envio: ${tenantBlockReason}`
      : (isHandoff ? 'Handoff humano assumido antes do despacho' : 'Conversa encerrada antes do despacho')
    const reasonCode = !tenantActive ? 'tenant_blocked' : (isHandoff ? 'suppressed_by_handoff' : 'conversation_closed')

    console.warn(`[AutonomousCycle Suppress Guard] Solicitando supressão de outbox ${outboxId}: ${suppressReason}`)

    const { data: completeData, error: completeErr } = await (supabase as any).rpc('complete_outbox_message', {
      p_company_id: companyId,
      p_outbox_id: outboxId,
      p_claim_token: claim.claim_token,
      p_claim_version: claim.claim_version,
      p_status: 'suppressed',
      p_last_error: suppressReason
    })

    const complete = Array.isArray(completeData) ? completeData[0] : completeData

    if (completeErr || !complete?.was_completed) {
      const failureReason = complete?.error_reason || completeErr?.message || 'unknown_suppress_failure'
      console.error(`[AutonomousCycle Suppress Error] Falha ao suprimir outbox ${outboxId} no banco: ${failureReason}`)
      return {
        executed: true,
        dispatched: false,
        reason: 'suppress_failed',
        agentId: selectedAgentId,
        replyMessageId,
        outboxId,
        error: `Falha na supressão transacional: ${failureReason}`
      }
    }

    await applyMetadataPatchSafely(supabase, companyId, replyMessageId, messageMetadata, {
      delivery_status: 'suppressed',
      suppression_reason: isHandoff ? 'handoff' : (!tenantActive ? 'tenant_blocked' : 'conversation_closed')
    })

    return {
      executed: true,
      dispatched: false,
      reason: reasonCode,
      agentId: selectedAgentId,
      replyMessageId,
      outboxId,
      error: suppressReason
    }
  }

  // 11. Despacho Seguro via Gateway Outbound
  const outboundRes = await sendOutboundMessage(companyId, claim.payload || outboundPayload, {
    adminClient: supabase,
    outboxId,
    messageId: replyMessageId,
    leaseSeconds: autonomousLeaseSeconds
  })

  // 12. Conclusão Atômica com Fencing (complete_outbox_message)
  if (outboundRes.success) {
    const providerMessageId = (outboundRes as any).provider_message_id || null

    const { data: completeData, error: completeErr } = await (supabase as any).rpc('complete_outbox_message', {
      p_company_id: companyId,
      p_outbox_id: outboxId,
      p_claim_token: claim.claim_token,
      p_claim_version: claim.claim_version,
      p_status: 'sent',
      p_last_error: null,
      p_provider_message_id: providerMessageId || null
    })

    const complete = Array.isArray(completeData) ? completeData[0] : completeData

    if (completeErr || !complete?.was_completed) {
      const reason = complete?.error_reason || completeErr?.message
      console.warn(`[AutonomousCycle Fencing Warning] Conflito de fencing ao concluir outbox ${outboxId}: ${reason}`)
      return {
        executed: true,
        dispatched: true,
        reason: 'claim_lost_post_dispatch',
        agentId: selectedAgentId,
        replyMessageId,
        outboxId,
        error: reason
      }
    }

    // 12.1. Merge seguro de metadados em messages preservando integridade JSONB via RPC atômica
    const metaToMerge: Record<string, any> = {
      ...messageMetadata,
      delivery_status: 'sent'
    }
    if (providerMessageId) {
      metaToMerge.provider_message_id = providerMessageId
    }

    await updateMessageMetadataSafe(supabase, companyId, replyMessageId, metaToMerge)

    return {
      executed: true,
      dispatched: true,
      agentId: selectedAgentId,
      replyMessageId,
      outboxId,
      providerMessageId: providerMessageId || undefined
    }
  }

  // 13. Tratamento Resiliente de Falhas do Gateway
  const isAmbiguous = isAmbiguousGatewayOutcome(outboundRes.error, outboundRes.reason)

  if (isAmbiguous) {
    console.warn(`[AutonomousCycle Ambiguous] Gateway retornou resultado ambíguo para outbox ${outboxId}: ${outboundRes.error || outboundRes.reason}`)
    return {
      executed: true,
      dispatched: false,
      reason: 'unknown_outcome',
      agentId: selectedAgentId,
      replyMessageId,
      outboxId,
      error: outboundRes.error || outboundRes.reason || 'Resultado ambíguo no gateway'
    }
  }

  const isTenantBlocked = outboundRes.reason === 'tenant_blocked'
  const targetStatus = isTenantBlocked ? 'suppressed' : 'failed'
  const finalError = outboundRes.error || outboundRes.reason || 'Falha no envio outbound'

  await (supabase as any).rpc('complete_outbox_message', {
    p_company_id: companyId,
    p_outbox_id: outboxId,
    p_claim_token: claim.claim_token,
    p_claim_version: claim.claim_version,
    p_status: targetStatus,
    p_last_error: finalError
  })

  await applyMetadataPatchSafely(supabase, companyId, replyMessageId, messageMetadata, {
    delivery_status: targetStatus,
    delivery_error: finalError
  })

  return {
    executed: true,
    dispatched: false,
    reason: outboundRes.reason || 'outbound_failed',
    agentId: selectedAgentId,
    replyMessageId,
    outboxId,
    error: finalError
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

export type RetryOutboxOutcome = 'gateway_accepted' | 'confirmed_failure' | 'unknown_outcome' | 'claim_lost'

export type RetryOutboxResult = {
  success: boolean
  outcome?: RetryOutboxOutcome
  claimToken?: string | null
  claimVersion?: number | null
  alreadySent?: boolean
  suppressed?: boolean
  providerMessageId?: string
  code?: string
  statusCode?: number
  error?: string
}

export function isAmbiguousGatewayOutcome(error?: string, reason?: string): boolean {
  if (reason === 'tenant_blocked' || reason === 'no_integration' || reason === 'unsafe_url') {
    return false
  }
  if (!error) return false
  const lower = error.toLowerCase()
  return (
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborterror') ||
    lower.includes('aborted') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('socket hang up') ||
    lower.includes('econnrefused') ||
    lower.includes('network error')
  )
}

/**
 * Reenvia uma mensagem pendente/falha da outbox sem reexecutar o LLM.
 * Exige validação de tenant explícita (companyId) para impedir operações cross-tenant sob service_role.
 * Utiliza claim atômico via RPC com lease e fencing token para prevenir envios concorrentes.
 */
export interface RetryOutboxOptions {
  adminClient?: any
  leaseSeconds?: number
  claim?: {
    claim_token: string
    claim_version: number | string
    payload?: any
    message_id?: string
    attempts?: number
  }
}

export async function retryOutboxMessage(
  companyId: string,
  outboxId: string,
  options?: RetryOutboxOptions
): Promise<RetryOutboxResult> {
  // 1. Validação Sintática de UUIDs (Defesa Pré-Banco)
  if (!isValidUuid(companyId) || !isValidUuid(outboxId)) {
    return { success: false, error: 'Identificador inválido fornecido.' }
  }

  const supabase = options?.adminClient || createAdminClient()

  // 2. Fallback retrocompatível: se o cliente fornecido não implementar rpc (ex: mocks de testes unitários anteriores)
  if (typeof (supabase as any).rpc !== 'function') {
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

    if (!record || record.company_id !== companyId) {
      return { success: false, error: 'Registro não encontrado' }
    }

    if (record.status === 'sent') {
      return { success: true, alreadySent: true }
    }
    if (record.status === 'suppressed') {
      return { success: false, error: 'Mensagem suprimida não pode ser reprocessada', suppressed: true }
    }
    if (record.status !== 'failed' && record.status !== 'pending') {
      return { success: false, error: `Registro em estado não elegível para retry: ${record.status}` }
    }

    if ((record.attempts || 0) >= (record.max_attempts || 5)) {
      const outboxBuilder = (supabase as any).from('message_outbox').update({
        status: 'failed',
        last_error: 'max_attempts_reached',
        updated_at: new Date().toISOString()
      }).eq('id', outboxId)

      await (
        typeof outboxBuilder?.eq === 'function'
          ? outboxBuilder.eq('company_id', companyId)
          : outboxBuilder
      )

      return {
        success: false,
        outcome: 'claim_lost',
        error: 'Limite máximo de tentativas atingido (max_attempts_reached)'
      }
    }

    if (record.message_id) {
      const msgQuery = (supabase as any)
        .from('messages')
        .select('id, company_id')
        .eq('id', record.message_id)

      const { data: linkedMsg } = await (
        typeof msgQuery?.eq === 'function'
          ? msgQuery.eq('company_id', companyId).maybeSingle()
          : (typeof msgQuery?.maybeSingle === 'function' ? msgQuery.maybeSingle() : msgQuery.single())
      )

      if (!linkedMsg) {
        const { data: crossMsg } = await (supabase as any)
          .from('messages')
          .select('id, company_id')
          .eq('id', record.message_id)
          .maybeSingle()

        if (crossMsg && crossMsg.company_id !== companyId) {
          return {
            success: false,
            error: 'Mensagem vinculada não encontrada ou pertence a outro tenant'
          }
        }
      }
    }

    // Validação de tenant antes do envio externo
    try {
      await requireActiveCompany(companyId, { adminClient: supabase })
    } catch (err: any) {
      const errorMsg = err instanceof TenantAccessError ? err.message : 'Falha ao verificar autorização da empresa'
      const blockCode = err instanceof TenantAccessError ? err.code : 'TENANT_STATUS_UNAVAILABLE'
      const statusCode = err instanceof TenantAccessError ? err.statusCode : 503

      try {
        const outboxBuilder = (supabase as any).from('message_outbox').update({
          status: 'suppressed',
          last_error: `Envio suprimido: ${errorMsg}`,
          updated_at: new Date().toISOString()
        }).eq('id', outboxId)

        const updRes: any = await (
          typeof outboxBuilder?.eq === 'function'
            ? outboxBuilder.eq('company_id', companyId)
            : outboxBuilder
        )
        if (updRes?.error) {
          console.error(`[RetryOutbox Error] Falha ao persistir status suppressed: ${updRes.error.message || JSON.stringify(updRes.error)}`)
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

    const outboundRes = await sendOutboundMessage(companyId, record.payload, {
      adminClient: supabase,
      outboxId,
      messageId: record.message_id
    })

    if (outboundRes.success) {
      const outboxBuilder = (supabase as any).from('message_outbox').update({
        status: 'sent',
        attempts: (record.attempts || 0) + 1,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', outboxId)

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
      }).eq('id', outboxId)

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

  // 2.1. Checagem prévia de terminalidade: registros já suprimidos ou enviados não são reprocessados
  const { data: preCheckOutbox } = await (supabase as any)
    .from('message_outbox')
    .select('status')
    .eq('id', outboxId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (preCheckOutbox?.status === 'suppressed') {
    return { success: false, error: 'Mensagem suprimida não pode ser reprocessada', suppressed: true }
  }
  if (preCheckOutbox?.status === 'sent') {
    return { success: true, alreadySent: true }
  }

  // 3. Validação centralizada do ciclo de vida do tenant antes do claim e envio externo
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

      await (
        typeof outboxBuilder?.eq === 'function'
          ? outboxBuilder.eq('company_id', companyId)
          : outboxBuilder
      )
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

  // 4. Reivindicação atômica via RPC (com RowExclusiveLock, lease e fencing token)
  const leaseSeconds = options?.leaseSeconds && options.leaseSeconds >= 15 ? options.leaseSeconds : 120
  let claim: any = null

  if (options?.claim) {
    let payload = options.claim.payload
    let messageId = options.claim.message_id
    if (!payload) {
      let outboxBuilder = (supabase as any)
        .from('message_outbox')
        .select('payload, message_id')
        .eq('id', outboxId)
      if (typeof outboxBuilder?.eq === 'function') {
        outboxBuilder = outboxBuilder.eq('company_id', companyId)
      }
      const { data: rec } = typeof outboxBuilder?.maybeSingle === 'function'
        ? await outboxBuilder.maybeSingle()
        : await outboxBuilder.single()
      payload = rec?.payload
      messageId = rec?.message_id
    }
    claim = {
      was_claimed: true,
      claim_token: options.claim.claim_token,
      claim_version: options.claim.claim_version,
      payload,
      message_id: messageId,
      attempts: options.claim.attempts
    }
  } else {
    const { data: claimData, error: claimErr } = await (supabase as any).rpc('claim_outbox_message', {
      p_company_id: companyId,
      p_outbox_id: outboxId,
      p_lease_seconds: leaseSeconds
    })

    if (claimErr) {
      return {
        success: false,
        error: `Falha na reivindicação da outbox: ${claimErr.message || JSON.stringify(claimErr)}`
      }
    }

    claim = Array.isArray(claimData) ? claimData[0] : claimData

    if (!claim || !claim.was_claimed) {
      const reason = claim?.error_reason
      if (reason === 'already_sent') {
        return { success: true, alreadySent: true }
      }
      if (reason === 'suppressed') {
        return { success: false, error: 'Mensagem suprimida não pode ser reprocessada', suppressed: true }
      }
      if (reason === 'outbox_not_found') {
        return { success: false, error: 'Registro não encontrado' }
      }
      if (reason === 'active_lease') {
        return {
          success: false,
          outcome: 'claim_lost',
          error: 'Registro em processamento por outro processo com lease ativo'
        }
      }
      if (reason === 'max_attempts_reached') {
        return {
          success: false,
          outcome: 'claim_lost',
          error: 'Limite máximo de tentativas atingido (max_attempts_reached)'
        }
      }
      if (reason && reason.startsWith('company_not_active')) {
        return {
          success: false,
          suppressed: true,
          code: 'TENANT_NOT_ACTIVE',
          error: `Empresa inativa: ${reason}`
        }
      }
      return {
        success: false,
        outcome: 'claim_lost',
        error: `Registro não elegível para retry: ${reason || 'não reivindicado'}`
      }
    }
  }

  // 4. Validação de integridade da mensagem vinculada (se houver message_id)
  if (claim.message_id) {
    const msgQuery = (supabase as any)
      .from('messages')
      .select('id, company_id')
      .eq('id', claim.message_id)

    const { data: linkedMsg } = await (
      typeof msgQuery?.eq === 'function'
        ? msgQuery.eq('company_id', companyId).maybeSingle()
        : (typeof msgQuery?.maybeSingle === 'function' ? msgQuery.maybeSingle() : msgQuery.single())
    )

    if (!linkedMsg) {
      // Verifica se a mensagem pertence a outro tenant para diagnosticar adulteração cross-tenant
      const { data: crossMsg } = await (supabase as any)
        .from('messages')
        .select('id, company_id')
        .eq('id', claim.message_id)
        .maybeSingle()

      if (crossMsg && crossMsg.company_id !== companyId) {
        // Marca como falha fenced para não travar a outbox
        await (supabase as any).rpc('complete_outbox_message', {
          p_company_id: companyId,
          p_outbox_id: outboxId,
          p_claim_token: claim.claim_token,
          p_claim_version: claim.claim_version,
          p_status: 'failed',
          p_last_error: 'Mensagem vinculada não encontrada ou pertence a outro tenant'
        })
        return {
          success: false,
          outcome: 'confirmed_failure',
          claimToken: claim.claim_token,
          claimVersion: claim.claim_version,
          error: 'Mensagem vinculada não encontrada ou pertence a outro tenant'
        }
      }
    }
  }

  // 5. Despacho seguro via Gateway Outbound
  const outboundRes = await sendOutboundMessage(companyId, claim.payload, {
    adminClient: supabase,
    outboxId,
    messageId: claim.message_id,
    leaseSeconds
  })

  // 6. Avaliação de resultado com distinção estrita e fencing determinístico
  if (outboundRes.success) {
    const providerMessageId = (outboundRes as any).provider_message_id || null

    // Gateway aceitou o despacho: completa transacionalmente com fencing e provider_message_id
    const { data: completeData, error: completeErr } = await (supabase as any).rpc('complete_outbox_message', {
      p_company_id: companyId,
      p_outbox_id: outboxId,
      p_claim_token: claim.claim_token,
      p_claim_version: claim.claim_version,
      p_status: 'sent',
      p_last_error: null,
      p_provider_message_id: providerMessageId || null
    })

    const complete = Array.isArray(completeData) ? completeData[0] : completeData
    if (completeErr || !complete?.was_completed) {
      const reason = complete?.error_reason || completeErr?.message
      const errorMsg = reason === 'already_completed'
        ? 'Registro já concluído ou reivindicação expirada (already_completed)'
        : 'Conflito de fencing: reivindicação expirou ou foi substituída antes da conclusão'
      console.warn(`[RetryOutbox Fencing] Conflito ao finalizar mensagem enviada: ${reason}`)
      return {
        success: false,
        outcome: 'claim_lost',
        claimToken: claim.claim_token,
        claimVersion: claim.claim_version,
        error: errorMsg
      }
    }

    if (claim.message_id) {
      const metaToMerge: Record<string, any> = {
        delivery_status: 'sent'
      }
      if (providerMessageId) {
        metaToMerge.provider_message_id = providerMessageId
      }
      await updateMessageMetadataSafe(supabase, companyId, claim.message_id, metaToMerge)
    }

    try {
      const outboxUpdate: Record<string, any> = {
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      if (typeof claim.attempts === 'number') {
        outboxUpdate.attempts = claim.attempts
      }

      const outboxBuilder = (supabase as any).from('message_outbox').update(outboxUpdate).eq('id', outboxId)

      await (
        typeof outboxBuilder?.eq === 'function'
          ? outboxBuilder.eq('company_id', companyId)
          : outboxBuilder
      )
    } catch {}

    return {
      success: true,
      outcome: 'gateway_accepted',
      claimToken: claim.claim_token,
      claimVersion: claim.claim_version,
      providerMessageId: providerMessageId || undefined
    }
  }

  // Despacho não obteve confirmação de sucesso
  const isAmbiguous = isAmbiguousGatewayOutcome(outboundRes.error, outboundRes.reason)

  if (isAmbiguous) {
    // Resultado ambíguo: timeout de rede ou conexão abortada após envio dos bytes.
    // NÃO converter automaticamente em falha comprovada! O status permanece 'processing' até expiração de lease ou reconciliação.
    console.warn(`[RetryOutbox Ambiguous] Resposta ambígua do gateway para outbox ${outboxId}: ${outboundRes.error || outboundRes.reason}`)
    return {
      success: false,
      outcome: 'unknown_outcome',
      claimToken: claim.claim_token,
      claimVersion: claim.claim_version,
      error: outboundRes.error || outboundRes.reason || 'Resultado ambíguo no gateway'
    }
  }

  // Falha confirmada: erro determinístico de validação ou rejeição prévia à entrega
  const isTenantBlocked = outboundRes.reason === 'tenant_blocked'
  const targetStatus = isTenantBlocked ? 'suppressed' : 'failed'
  const finalError = outboundRes.error || outboundRes.reason || 'Falha no envio outbound'

  const { data: completeData, error: completeErr } = await (supabase as any).rpc('complete_outbox_message', {
    p_company_id: companyId,
    p_outbox_id: outboxId,
    p_claim_token: claim.claim_token,
    p_claim_version: claim.claim_version,
    p_status: targetStatus,
    p_last_error: finalError
  })

  const complete = Array.isArray(completeData) ? completeData[0] : completeData
  if (completeErr || !complete?.was_completed) {
    const reason = complete?.error_reason || completeErr?.message
    const errorMsg = reason === 'already_completed'
      ? 'Registro já concluído ou reivindicação expirada (already_completed)'
      : 'Conflito de fencing ao persistir falha: reivindicação expirou ou foi substituída'
    return {
      success: false,
      outcome: 'claim_lost',
      claimToken: claim.claim_token,
      claimVersion: claim.claim_version,
      error: errorMsg
    }
  }

  if (claim.message_id) {
    await updateMessageMetadataSafe(supabase, companyId, claim.message_id, {
      delivery_status: targetStatus,
      delivery_error: finalError
    })
  }

  return {
    success: false,
    outcome: 'confirmed_failure',
    claimToken: claim.claim_token,
    claimVersion: claim.claim_version,
    code: (outboundRes as any).code,
    statusCode: (outboundRes as any).statusCode,
    suppressed: isTenantBlocked,
    error: finalError
  }
}

// ==============================================================================
// MÁQUINA DE ESTADOS MONOTÔNICA E CALLBACKS DE STATUS (FASE 1)
// ==============================================================================

export const DELIVERY_STATUS_RANK: Record<DeliveryStatus, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: -1
}

export interface UpdateDeliveryStatusOptions {
  providerMessageId?: string
  timestamp?: string
  error?: string
  adminClient?: any
}

export interface UpdateDeliveryStatusParams {
  messageId?: string
  providerMessageId?: string
  status: DeliveryStatus
  timestamp?: string
  error?: string
  adminClient?: any
}

export interface UpdateDeliveryStatusResult {
  success: boolean
  updated: boolean
  messageId?: string
  previousStatus?: string
  currentStatus?: string
  reason?: string
  error?: string
}

/**
 * Atualiza o status de entrega de uma mensagem seguindo uma máquina de estados monotônica:
 * pending (0) -> sent (1) -> delivered (2) -> read (3)
 * Rejeita regressões de status e updates redundantes de forma idempotente.
 */
export async function updateMessageDeliveryStatus(
  companyId: string,
  messageIdOrParams: string | UpdateDeliveryStatusParams,
  statusArg?: DeliveryStatus,
  optionsArg?: UpdateDeliveryStatusOptions
): Promise<UpdateDeliveryStatusResult> {
  // 1. Validação Sintática de Identificador de Empresa
  if (!isValidUuid(companyId)) {
    return {
      success: false,
      updated: false,
      reason: 'invalid_company_id',
      error: 'Identificador da empresa inválido.'
    }
  }

  // 2. Resolução flexível de parâmetros (sobrecarga de assinatura)
  let messageId: string | undefined
  let providerMessageId: string | undefined
  let newStatus: DeliveryStatus
  let timestamp: string | undefined
  let errorMsg: string | undefined
  let customAdminClient: any

  if (typeof messageIdOrParams === 'string') {
    messageId = messageIdOrParams
    newStatus = statusArg as DeliveryStatus
    providerMessageId = optionsArg?.providerMessageId
    timestamp = optionsArg?.timestamp
    errorMsg = optionsArg?.error
    customAdminClient = optionsArg?.adminClient
  } else {
    messageId = messageIdOrParams.messageId
    providerMessageId = messageIdOrParams.providerMessageId
    newStatus = messageIdOrParams.status
    timestamp = messageIdOrParams.timestamp
    errorMsg = messageIdOrParams.error
    customAdminClient = messageIdOrParams.adminClient
  }

  if (!newStatus || !['pending', 'sent', 'delivered', 'read', 'failed'].includes(newStatus)) {
    return {
      success: false,
      updated: false,
      reason: 'invalid_status',
      error: `Status de entrega inválido: ${newStatus}`
    }
  }

  if (!messageId && !providerMessageId) {
    return {
      success: false,
      updated: false,
      reason: 'missing_message_identifier',
      error: 'É necessário fornecer messageId ou providerMessageId.'
    }
  }

  const supabase = customAdminClient || createAdminClient()

  // 3. Localização da mensagem no banco com escopo multi-tenant estrito
  let targetMessage: any = null

  if (messageId && isValidUuid(messageId)) {
    const { data: msg } = await supabase
      .from('messages')
      .select('id, company_id, metadata, external_id')
      .eq('id', messageId)
      .eq('company_id', companyId)
      .maybeSingle()
    targetMessage = msg
  }

  if (!targetMessage && providerMessageId) {
    const { data: msgByProvider } = await supabase
      .from('messages')
      .select('id, company_id, metadata, external_id')
      .eq('company_id', companyId)
      .eq('external_id', providerMessageId)
      .maybeSingle()
    
    if (msgByProvider) {
      targetMessage = msgByProvider
    }
  }

  if (!targetMessage && messageId) {
    const { data: msgByExt } = await supabase
      .from('messages')
      .select('id, company_id, metadata, external_id')
      .eq('company_id', companyId)
      .eq('external_id', messageId)
      .maybeSingle()
    
    if (msgByExt) {
      targetMessage = msgByExt
    }
  }

  // Fallback Etapa 2B: busca em message_outbox pelo provider_message_id se messages.external_id ainda não foi espelhado
  if (!targetMessage && providerMessageId) {
    try {
      const { data: outboxByProvider } = await supabase
        .from('message_outbox')
        .select('id, message_id')
        .eq('company_id', companyId)
        .eq('provider_message_id', providerMessageId)
        .maybeSingle()

      if (outboxByProvider?.message_id) {
        const { data: msgByOutbox } = await supabase
          .from('messages')
          .select('id, company_id, metadata, external_id')
          .eq('id', outboxByProvider.message_id)
          .eq('company_id', companyId)
          .maybeSingle()

        if (msgByOutbox) {
          targetMessage = msgByOutbox
        }
      }
    } catch {}
  }

  if (!targetMessage) {
    return {
      success: false,
      updated: false,
      reason: 'message_not_found',
      error: 'Mensagem vinculada não encontrada para a empresa especificada.'
    }
  }

  // 4. Validação da Máquina de Estados Monotônica
  const currentStatus: DeliveryStatus = (targetMessage.metadata?.delivery_status as DeliveryStatus) || 'pending'

  if (newStatus === currentStatus) {
    return {
      success: true,
      updated: false,
      messageId: targetMessage.id,
      previousStatus: currentStatus,
      currentStatus,
      reason: 'idempotent_no_change'
    }
  }

  const currentRank = DELIVERY_STATUS_RANK[currentStatus] ?? 0
  const newRank = DELIVERY_STATUS_RANK[newStatus] ?? 0

  // Se o status for 'failed'
  if (newStatus === 'failed') {
    if (currentStatus === 'delivered' || currentStatus === 'read') {
      return {
        success: true,
        updated: false,
        messageId: targetMessage.id,
        previousStatus: currentStatus,
        currentStatus,
        reason: 'status_regression_ignored',
        error: 'Mensagem já entregue ou lida não pode regredir para failed.'
      }
    }
  } else if (currentStatus === 'failed') {
    if (newStatus !== 'delivered' && newStatus !== 'read') {
      return {
        success: true,
        updated: false,
        messageId: targetMessage.id,
        previousStatus: currentStatus,
        currentStatus,
        reason: 'status_regression_ignored'
      }
    }
  } else {
    if (newRank < currentRank) {
      return {
        success: true,
        updated: false,
        messageId: targetMessage.id,
        previousStatus: currentStatus,
        currentStatus,
        reason: 'status_regression_ignored'
      }
    }
  }

  // 5. Aplicação da Atualização em messages delegando para updateMessageMetadataSafe
  const updateTimestamp = timestamp || new Date().toISOString()
  const metaToUpdate: Record<string, any> = {
    delivery_status: newStatus,
    delivery_updated_at: updateTimestamp
  }
  if (providerMessageId) {
    metaToUpdate.provider_message_id = providerMessageId
  }
  if (errorMsg) {
    metaToUpdate.delivery_error = errorMsg
  }

  const safeRes = await updateMessageMetadataSafe(
    supabase,
    companyId,
    targetMessage.id,
    metaToUpdate
  )

  if (!safeRes.success) {
    return {
      success: false,
      updated: false,
      messageId: targetMessage.id,
      reason: 'db_update_failed',
      error: safeRes.error
    }
  }

  // 6. Reconciliação com message_outbox e gateway_outbound_locks conforme o status confirmado pelo gateway
  if (newStatus === 'sent' || newStatus === 'delivered' || newStatus === 'read') {
    try {
      const richOutboxPatch: Record<string, any> = {
        status: 'sent',
        sent_at: updateTimestamp,
        locked_at: null,
        locked_until: null,
        claim_token: null,
        updated_at: updateTimestamp
      }
      if (providerMessageId) {
        richOutboxPatch.provider_message_id = providerMessageId
      }

      const outboxBuilder = supabase
        .from('message_outbox')
        .update(richOutboxPatch)
        .eq('message_id', targetMessage.id)

      const outboxRes = await (
        typeof (outboxBuilder as any).eq === 'function'
          ? (outboxBuilder as any).eq('company_id', companyId)
          : outboxBuilder
      )

      if (outboxRes?.error?.code === '42703') {
        const legacyOutboxBuilder = supabase
          .from('message_outbox')
          .update({
            status: 'sent',
            sent_at: updateTimestamp,
            updated_at: updateTimestamp
          })
          .eq('message_id', targetMessage.id)

        await (
          typeof (legacyOutboxBuilder as any).eq === 'function'
            ? (legacyOutboxBuilder as any).eq('company_id', companyId)
            : legacyOutboxBuilder
        )
      }
    } catch {}

    try {
      const lockPatch: Record<string, any> = {
        status: 'completed',
        completed_at: updateTimestamp,
        locked_until: updateTimestamp,
        last_error: null,
        updated_at: updateTimestamp
      }
      if (providerMessageId) {
        lockPatch.provider_message_id = providerMessageId
      }

      const lockBuilder = supabase
        .from('gateway_outbound_locks')
        .update(lockPatch)
        .eq('company_id', companyId)

      await (
        typeof (lockBuilder as any).eq === 'function'
          ? (lockBuilder as any).eq('message_id', targetMessage.id)
          : lockBuilder
      )
    } catch {}
  } else if (newStatus === 'failed') {
    const failedReason = errorMsg || 'delivery_failed_callback'
    try {
      const outboxFailedBuilder = supabase
        .from('message_outbox')
        .update({
          status: 'failed',
          last_error: failedReason,
          locked_at: null,
          locked_until: null,
          claim_token: null,
          updated_at: updateTimestamp
        })
        .eq('message_id', targetMessage.id)

      await (
        typeof (outboxFailedBuilder as any).eq === 'function'
          ? (outboxFailedBuilder as any).eq('company_id', companyId)
          : outboxFailedBuilder
      )
    } catch {}

    try {
      const lockFailedBuilder = supabase
        .from('gateway_outbound_locks')
        .update({
          status: 'failed',
          last_error: failedReason,
          locked_until: updateTimestamp,
          updated_at: updateTimestamp
        })
        .eq('company_id', companyId)

      await (
        typeof (lockFailedBuilder as any).eq === 'function'
          ? (lockFailedBuilder as any).eq('message_id', targetMessage.id)
          : lockFailedBuilder
      )
    } catch {}
  }

  return {
    success: true,
    updated: true,
    messageId: targetMessage.id,
    previousStatus: currentStatus,
    currentStatus: newStatus
  }
}

/**
 * Atualização atômica e segura de metadados JSONB na tabela messages.
 * Utiliza a RPC PostgreSQL merge_message_metadata_monotonic (com lock pessimista FOR UPDATE
 * e resolução monotônica de máquina de estados dentro do SQL) para eliminar por completo
 * race conditions e Lost Updates em ambientes distribuídos multi-instância.
 */
export async function updateMessageMetadataSafe(
  supabase: any,
  companyId: string,
  messageId: string,
  newMetadata: Record<string, any>,
  extraFields?: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!isValidUuid(companyId) || !isValidUuid(messageId)) {
    return { success: false, error: 'Identificadores inválidos fornecidos.' }
  }

  try {
    // 1. Sanitiza newMetadata para descartar chaves com valor undefined
    const cleanNewMeta: Record<string, any> = {}
    for (const [key, val] of Object.entries(newMetadata)) {
      if (val !== undefined) {
        cleanNewMeta[key] = val
      }
    }

    const providerMessageId = cleanNewMeta.provider_message_id || null

    // 2. Execução Atômica via RPC PostgreSQL (Row Lock FOR UPDATE + Monotonia no Banco)
    const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('merge_message_metadata_monotonic', {
      p_company_id: companyId,
      p_message_id: messageId,
      p_metadata_patch: cleanNewMeta,
      p_provider_message_id: providerMessageId
    })

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData

    if (rpcErr || !row?.was_updated) {
      const errReason = row?.error_reason || rpcErr?.message || 'Falha ao atualizar metadados da mensagem.'
      const friendlyError = errReason === 'message_not_found' ? 'Mensagem não encontrada.' : errReason
      return { success: false, error: friendlyError }
    }

    // 3. Atualização de campos adicionais caso fornecidos
    if (extraFields && Object.keys(extraFields).length > 0) {
      await supabase
        .from('messages')
        .update(extraFields)
        .eq('id', messageId)
        .eq('company_id', companyId)
    }

    return {
      success: true,
      data: {
        id: messageId,
        metadata: row.final_metadata,
        current_status: row.current_status,
        external_id: providerMessageId || undefined
      }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Exceção ao atualizar metadados da mensagem.' }
  }
}
