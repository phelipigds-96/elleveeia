"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/service"
import { dispatchOutboxMessage } from "@/lib/services/outbox-dispatcher"
import { moveConversationToStageType } from "@/lib/services/workflows/workflows"
import { assignDefaultWorkflowStages } from "@/lib/services/workflows/conversation-workflow"

export interface CustomerData {
  id?: string
  name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  avatar_url?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ConversationData {
  id: string
  company_id: string
  customer_id?: string | null
  channel?: string | null
  status: "open" | "closed" | "human" | string
  assigned_to?: string | null
  workflow_id?: string | null
  workflow_stage_id?: string | null
  workflow_stage_name?: string | null
  workflow_stage_color?: string | null
  started_at?: string | null
  last_message_at: string
  closed_at?: string | null
  created_at: string
  updated_at?: string | null
  unread_count: number
  external_id?: string | null
  agent_id?: string | null
  agent_name?: string | null
  customers?: CustomerData | null
  last_message_preview?: string
}

export interface MessageData {
  id: string
  company_id?: string
  conversation_id: string
  sender_type: "customer" | "system" | "ia" | "agent" | "human" | "bot" | string
  sender_id?: string | null
  content: string
  message_type?: string
  metadata?: {
    delivery_status?: "pending" | "sent" | "delivered" | "read" | "failed" | string
    source?: string
    event?: string
    [key: string]: any
  } | null
  created_at: string
  external_id?: string | null
}

export interface SendMessageResult {
  success: boolean
  duplicate?: boolean
  messageId?: string
  data?: any
  error?: string
}

export interface UserProfileContext {
  userId: string
  companyId: string
  role: string
  userName: string
}

const DEFAULT_PREVIEW_COMPANY_ID = "90e69b50-1b4e-4f4a-94f2-78be1cf82833" // Ellevee Admin
const DEFAULT_PREVIEW_USER_ID = "71ee00c9-e22b-479d-bc34-9d596448c3f9"    // admin@ellevee.com

/**
 * Extrai o company_id, sender_id, role e full_name da sessão segura do servidor via SSR auth.
 */
async function getAuthenticatedAgentContext(): Promise<UserProfileContext> {
  let userId: string | null = null
  let companyId: string | null = null
  let role = "admin"
  let userName = "Atendente"

  try {
    const supabase = createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (authData?.user) {
      userId = authData.user.id
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id, role, full_name")
        .eq("id", userId)
        .maybeSingle()

      if (profile) {
        if (profile.company_id) companyId = profile.company_id
        if (profile.role) role = profile.role
        if (profile.full_name) userName = profile.full_name
      }
    }

    // Suporte ao Impersonate do SuperAdmin
    try {
      const cookieStore = cookies()
      const impersonateId = cookieStore.get('ellevee_impersonate_active')?.value
      if (impersonateId) {
        companyId = impersonateId
      }
    } catch {
      // cookies() pode não estar disponível em certos contextos SSR
    }
  } catch {
    // Ignora erros de contexto em ambiente de pré-visualização estática
  }

  return {
    userId: userId || DEFAULT_PREVIEW_USER_ID,
    companyId: companyId || DEFAULT_PREVIEW_COMPANY_ID,
    role,
    userName,
  }
}

/**
 * Provê o perfil do usuário atual para Client Components.
 */
export async function getAgentProfileContext(): Promise<UserProfileContext> {
  return await getAuthenticatedAgentContext()
}

/**
 * Obtém a lista real de conversas com filtro RBAC (Master vs Atendente)
 */
export async function getConversationsList(): Promise<ConversationData[]> {
  try {
    const { userId, companyId, role } = await getAuthenticatedAgentContext()
    const client = createAdminClient()

    // 1. Descobrir o agente ativo padrão da empresa (ex: 'Ana', 'Coalito')
    let defaultAgentName = "IA"
    const { data: activeAgent } = await client
      .from("agents")
      .select("name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .maybeSingle()

    if (activeAgent?.name) {
      defaultAgentName = activeAgent.name
    }

    // 2. Query de conversas do tenant com join em customers e agents
    const buildQuery = (includeAvatar = true) => {
      let q = client
        .from("conversations")
        .select(`
          id,
          company_id,
          customer_id,
          channel,
          status,
          assigned_to,
          workflow_id,
          workflow_stage_id,
          started_at,
          last_message_at,
          closed_at,
          created_at,
          updated_at,
          unread_count,
          external_id,
          agent_id,
          agents (
            id,
            name
          ),
          workflow_stages (
            id,
            name,
            color
          ),
          customers (
            id,
            name,
            phone,
            email${includeAvatar ? ", avatar_url" : ""}
          )
        `)
        .eq("company_id", companyId)

      // 3. Regra de Governança RBAC:
      if (role !== "admin" && role !== "master") {
        q = q.or(`assigned_to.is.null,assigned_to.eq.${userId}`)
      }

      return q.order("last_message_at", { ascending: false, nullsFirst: false }).limit(100)
    }

    let { data: rawConvs, error: convError } = await buildQuery(true)

    // Fallback gracioso se a coluna avatar_url ainda não existir no banco (42703)
    if (convError && convError.code === "42703") {
      const fallback = await buildQuery(false)
      rawConvs = fallback.data
      convError = fallback.error
    }

    if (convError || !rawConvs) {
      console.error("[Conversations] Erro ao buscar conversas:", convError)
      return []
    }

    const convIds = rawConvs.map((c: any) => c.id)

    // 4. Busca a última mensagem de cada conversa para preencher o preview
    const previewMap = new Map<string, string>()

    if (convIds.length > 0) {
      const { data: latestMessages } = await client
        .from("messages")
        .select("conversation_id, content, sender_type, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })

      if (latestMessages) {
        for (const msg of latestMessages) {
          if (!previewMap.has(msg.conversation_id) && msg.content?.trim()) {
            previewMap.set(msg.conversation_id, msg.content.trim())
          }
        }
      }
    }

    // 5. Monta o contrato tipado com o nome dinâmico do agente
    const formatted: ConversationData[] = rawConvs.map((c: any) => {
      const customer = Array.isArray(c.customers) ? c.customers[0] : c.customers
      const preview = previewMap.get(c.id) || (c.channel ? `Atendimento via ${c.channel}` : "Nova conversa iniciada")
      const agentObj = Array.isArray(c.agents) ? c.agents[0] : c.agents
      const agentName = agentObj?.name || defaultAgentName
      const stageObj = Array.isArray(c.workflow_stages) ? c.workflow_stages[0] : c.workflow_stages

      return {
        id: c.id,
        company_id: c.company_id,
        customer_id: c.customer_id,
        channel: c.channel || "whatsapp",
        status: c.status || "open",
        assigned_to: c.assigned_to,
        workflow_id: c.workflow_id || null,
        workflow_stage_id: c.workflow_stage_id || null,
        workflow_stage_name: stageObj?.name || null,
        workflow_stage_color: stageObj?.color || null,
        started_at: c.started_at,
        last_message_at: c.last_message_at || c.created_at,
        closed_at: c.closed_at,
        created_at: c.created_at,
        updated_at: c.updated_at,
        unread_count: c.unread_count || 0,
        external_id: c.external_id,
        agent_id: c.agent_id,
        agent_name: agentName,
        customers: customer || { name: "Cliente Desconhecido", phone: c.external_id },
        last_message_preview: preview,
      }
    })

    return formatted
  } catch (err: any) {
    console.error("[Conversations] Exceção em getConversationsList:", err)
    return []
  }
}

/**
 * Obtém o histórico real de mensagens de uma conversa selecionada
 */
export async function getConversationMessages(
  conversationId: string
): Promise<MessageData[]> {
  try {
    if (!conversationId) return []

    const client = createAdminClient()

    const { data: messages, error } = await client
      .from("messages")
      .select("id, company_id, conversation_id, sender_type, sender_id, content, message_type, metadata, created_at, external_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200)

    if (error || !messages) {
      console.error("[Conversations] Erro ao buscar mensagens:", error)
      return []
    }

    return messages as MessageData[]
  } catch (error) {
    console.error("[Conversations] Exceção em getConversationMessages:", error)
    return []
  }
}

/**
 * Mantém a etapa do funil (workflow_stages) coerente com o status operacional
 * da conversa. Falhas não bloqueiam a ação principal: o status já foi salvo.
 */
async function syncWorkflowStage(
  conversationId: string,
  stageType: "initial" | "in_progress" | "final"
) {
  try {
    await moveConversationToStageType(conversationId, stageType)
  } catch (error: any) {
    console.error(
      "[Conversations] Falha ao sincronizar etapa do funil:",
      error?.message || error
    )
  }
}

/**
 * Server Action para envio de mensagem manual do operador humano com garantia de idempotência e outbox
 */
export async function sendMessageAction(
  conversationId: string,
  content: string,
  clientMessageId?: string
): Promise<SendMessageResult> {
  try {
    const trimmed = content?.trim()
    if (!trimmed) {
      return { success: false, error: "O conteúdo da mensagem não pode ser vazio." }
    }
    if (!conversationId) {
      return { success: false, error: "Identificador da conversa inválido." }
    }

    const { userId, companyId, userName } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()

    // 1. Obter conversa e canal
    const { data: conv, error: convErr } = await adminClient
      .from("conversations")
      .select("id, company_id, channel, customers(name, phone)")
      .eq("id", conversationId)
      .eq("company_id", companyId)
      .single()

    if (convErr || !conv) {
      return { success: false, error: "Conversa não localizada ou não autorizada para o tenant." }
    }

    const safeIdempotencyKey = clientMessageId?.trim()
      ? `manual-${conversationId}-${clientMessageId.trim()}`
      : `manual-${conversationId}-${crypto.randomUUID()}`

    // 2. Proteção de Duplo Clique: Verificar se já foi despachada
    const { data: existingOutbox } = await adminClient
      .from("message_outbox")
      .select("id, message_id")
      .eq("company_id", companyId)
      .eq("idempotency_key", safeIdempotencyKey)
      .maybeSingle()

    if (existingOutbox) {
      return {
        success: true,
        duplicate: true,
        messageId: existingOutbox.message_id,
      }
    }

    const customerPhone = (conv.customers as any)?.phone || null
    const customerName = (conv.customers as any)?.name || "Cliente"

    // Formatação corporativa Opção 4: *Atendente Nome:*\nMensagem
    const attendantName = (userName?.trim() || "Atendente").split(/\s+/)[0] || "Atendente"
    const prefix = `*Atendente ${attendantName}:*\n`
    const outboundContent = trimmed.startsWith("*Atendente") ? trimmed : `${prefix}${trimmed}`

    // 3. Persistência na tabela messages com sender_type: 'agent'
    const { data: createdMsg, error: msgInsertErr } = await adminClient
      .from("messages")
      .insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: "agent",
        sender_id: userId,
        content: outboundContent,
        message_type: "text",
        metadata: {
          delivery_status: "pending",
          client_message_id: clientMessageId || null,
          operator_name: attendantName,
        },
      })
      .select()
      .single()

    if (msgInsertErr || !createdMsg) {
      console.error("[Chat] Erro ao gravar mensagem na tabela messages:", msgInsertErr)
      return {
        success: false,
        error: `Falha ao gravar mensagem: ${msgInsertErr?.message || "Erro desconhecido"}`,
      }
    }

    // 4. Registro na message_outbox para acionamento seguro do gateway
    const outboxPayload = {
      event_id: safeIdempotencyKey,
      event_type: "message.send",
      conversation_id: conversationId,
      channel: conv.channel || "whatsapp",
      recipient: customerPhone,
      number: customerPhone,
      text: outboundContent,
      customer: {
        name: customerName,
        phone: customerPhone,
      },
      message: {
        id: createdMsg.id,
        content: outboundContent,
        text: outboundContent,
        sender_type: "agent",
        sender_id: userId,
        message_type: "text",
        created_at: createdMsg.created_at,
      },
    }

    const { data: createdOutbox, error: outboxInsertErr } = await adminClient
      .from("message_outbox")
      .insert({
        company_id: companyId,
        conversation_id: conversationId,
        message_id: createdMsg.id,
        idempotency_key: safeIdempotencyKey,
        channel: conv.channel || "whatsapp",
        recipient: customerPhone,
        payload: outboxPayload,
        status: "pending",
        attempts: 0,
      })
      .select("id")
      .single()

    if (outboxInsertErr) {
      console.warn("[Chat] Aviso ao registrar na message_outbox:", outboxInsertErr.message)
    }

    // 5. Despacho Imediato em Tempo Real (Painel -> Gateway -> WhatsApp)
    if (createdOutbox?.id) {
      try {
        await dispatchOutboxMessage(createdOutbox.id, { adminClient })
      } catch (dispErr: any) {
        console.error("[Chat] Falha no despacho imediato da outbox (será reprocessado por worker):", dispErr?.message || dispErr)
      }
    }

    // 6. Atualização do timestamp de última mensagem da conversa
    await adminClient
      .from("conversations")
      .update({
        last_message_at: createdMsg.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)

    revalidatePath("/conversations")

    return {
      success: true,
      duplicate: false,
      messageId: createdMsg.id,
      data: createdMsg,
    }
  } catch (error: any) {
    console.error("[Chat] Exceção em sendMessageAction:", error)
    return {
      success: false,
      error: `Erro interno no servidor: ${error.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para Handoff (Transbordo Humano) e pausa da IA
 */
export async function takeoverConversationAction(
  conversationId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  try {
    if (!conversationId) {
      return { success: false, error: "Identificador da conversa inválido." }
    }

    const { userId, companyId, userName } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()

    // 1. Atualizar status da conversa para 'human' e designar atendente (assigned_to)
    const now = new Date().toISOString()
    const { data: updatedConv, error: updErr } = await adminClient
      .from("conversations")
      .update({
        status: "human",
        assigned_to: userId,
        updated_at: now,
        last_message_at: now,
      })
      .eq("id", conversationId)
      .eq("company_id", companyId)
      .select()
      .single()

    if (updErr || !updatedConv) {
      console.error("[Chat] Erro ao assumir conversa:", updErr)
      return {
        success: false,
        error: `Falha ao transferir conversa: ${updErr?.message || "Erro desconhecido"}`,
      }
    }

    // 2. Sincronizar o funil (etapa) com o novo status operacional
    await syncWorkflowStage(conversationId, "in_progress")

    // 3. Gravar evento de sistema indicando o transbordo para o operador humano
    await adminClient.from("messages").insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: "system",
      content: `Atendimento assumido por ${userName || "operador humano"}. A IA foi pausada nesta conversa.`,
      message_type: "event",
      metadata: {
        event: "conversation.takeover",
        operator_id: userId,
        operator_name: userName,
      },
    })

    revalidatePath("/conversations")

    return {
      success: true,
      status: "human",
    }
  } catch (error: any) {
    console.error("[Chat] Exceção em takeoverConversationAction:", error)
    return {
      success: false,
      error: `Erro interno no servidor: ${error.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para devolver o atendimento para o Agente de IA com nome dinâmico
 */
export async function returnToAIAction(
  conversationId: string
): Promise<{ success: boolean; status?: string; agentName?: string; error?: string }> {
  try {
    if (!conversationId) {
      return { success: false, error: "Identificador da conversa inválido." }
    }

    const { companyId } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()

    // 1. Obter nome do agente da conversa ou ativo da empresa
    const { data: conv } = await adminClient
      .from("conversations")
      .select("id, agent_id, agents(name)")
      .eq("id", conversationId)
      .eq("company_id", companyId)
      .maybeSingle()

    let agentName = (conv?.agents as any)?.name

    if (!agentName) {
      const { data: activeAgent } = await adminClient
        .from("agents")
        .select("name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .maybeSingle()
      agentName = activeAgent?.name || "IA"
    }

    const now = new Date().toISOString()

    // 2. Atualizar status para 'open' e limpar atribuição de operador humano
    const { error: updErr } = await adminClient
      .from("conversations")
      .update({
        status: "open",
        assigned_to: null,
        updated_at: now,
        last_message_at: now,
      })
      .eq("id", conversationId)
      .eq("company_id", companyId)

    if (updErr) {
      console.error("[Chat] Erro ao devolver conversa para IA:", updErr)
      return { success: false, error: `Falha ao devolver conversa: ${updErr.message}` }
    }

    // 3. Sincronizar o funil (etapa) com o novo status operacional
    await syncWorkflowStage(conversationId, "initial")

    // 4. Gravar evento de sistema na timeline
    await adminClient.from("messages").insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: "system",
      content: `Atendimento devolvido para ${agentName}. O agente autônomo está ativo novamente.`,
      message_type: "event",
      metadata: {
        event: "conversation.ai_resume",
        agent_name: agentName,
      },
    })

    revalidatePath("/conversations")

    return {
      success: true,
      status: "open",
      agentName,
    }
  } catch (error: any) {
    console.error("[Chat] Exceção em returnToAIAction:", error)
    return {
      success: false,
      error: `Erro interno no servidor: ${error.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para encerrar o atendimento (concluir ticket)
 */
export async function closeConversationAction(
  conversationId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  try {
    if (!conversationId) {
      return { success: false, error: "Identificador da conversa inválido." }
    }

    const { userId, companyId, userName } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    // 1. Atualizar status para 'closed' e preencher closed_at
    const { error: updErr } = await adminClient
      .from("conversations")
      .update({
        status: "closed",
        closed_at: now,
        updated_at: now,
        last_message_at: now,
      })
      .eq("id", conversationId)
      .eq("company_id", companyId)

    if (updErr) {
      console.error("[Chat] Erro ao encerrar conversa:", updErr)
      return { success: false, error: `Falha ao encerrar conversa: ${updErr.message}` }
    }

    // 3. Sincronizar o funil (etapa) com o novo status operacional
    await syncWorkflowStage(conversationId, "final")

    // 4. Gravar evento de sistema na timeline
    await adminClient.from("messages").insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: "system",
      content: `Atendimento encerrado por ${userName || "operador"}.`,
      message_type: "event",
      metadata: {
        event: "conversation.closed",
        operator_id: userId,
        operator_name: userName,
      },
    })

    revalidatePath("/conversations")

    return {
      success: true,
      status: "closed",
    }
  } catch (error: any) {
    console.error("[Chat] Exceção em closeConversationAction:", error)
    return {
      success: false,
      error: `Erro interno no servidor: ${error.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para reabrir atendimento encerrado
 */
export async function reopenConversationAction(
  conversationId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  try {
    if (!conversationId) {
      return { success: false, error: "Identificador da conversa inválido." }
    }

    const { userId, companyId, userName } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    // 1. Reativar status para 'human', associar ao atendente e limpar closed_at
    const { error: updErr } = await adminClient
      .from("conversations")
      .update({
        status: "human",
        assigned_to: userId,
        closed_at: null,
        updated_at: now,
        last_message_at: now,
      })
      .eq("id", conversationId)
      .eq("company_id", companyId)

    if (updErr) {
      console.error("[Chat] Erro ao reabrir conversa:", updErr)
      return { success: false, error: `Falha ao reabrir conversa: ${updErr.message}` }
    }

    // 3. Sincronizar o funil (etapa) com o novo status operacional
    await syncWorkflowStage(conversationId, "in_progress")

    // 4. Gravar evento de sistema na timeline
    await adminClient.from("messages").insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: "system",
      content: `Atendimento reaberto por ${userName || "operador"}.`,
      message_type: "event",
      metadata: {
        event: "conversation.reopened",
        operator_id: userId,
        operator_name: userName,
      },
    })

    revalidatePath("/conversations")

    return {
      success: true,
      status: "human",
    }
  } catch (error: any) {
    console.error("[Chat] Exceção em reopenConversationAction:", error)
    return {
      success: false,
      error: `Erro interno no servidor: ${error.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para buscar os detalhes completos do cliente (com fallback resiliente para address/notes)
 */
export async function getCustomerDetailsAction(
  customerId: string
): Promise<{ success: boolean; customer?: CustomerData; error?: string }> {
  try {
    if (!customerId) {
      return { success: false, error: "Identificador do cliente não fornecido." }
    }

    const { companyId } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()

    // 1. Tentar selecionar com as colunas completas
    const { data, error } = await adminClient
      .from("customers")
      .select("id, name, phone, email, address, notes, avatar_url, created_at, updated_at")
      .eq("id", customerId)
      .eq("company_id", companyId)
      .maybeSingle()

    if (!error && data) {
      return { success: true, customer: data }
    }

    // 2. Se as colunas address/notes/avatar_url ainda não foram criadas no Supabase (código 42703)
    if (error && error.code === "42703") {
      const { data: baseData, error: baseErr } = await adminClient
        .from("customers")
        .select("id, name, phone, email, created_at, updated_at")
        .eq("id", customerId)
        .eq("company_id", companyId)
        .maybeSingle()

      if (baseErr) return { success: false, error: baseErr.message }
      return {
        success: true,
        customer: {
          ...baseData,
          address: null,
          notes: null,
          avatar_url: null,
        },
      }
    }

    return { success: false, error: error?.message || "Cliente não encontrado." }
  } catch (err: any) {
    return { success: false, error: err.message || "Erro ao carregar detalhes do cliente." }
  }
}

/**
 * Server Action para atualizar o perfil do cliente
 */
export async function updateCustomerProfileAction(params: {
  customerId: string
  name?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
}): Promise<{
  success: boolean
  customer?: CustomerData
  pendingMigration?: boolean
  error?: string
}> {
  try {
    if (!params.customerId) {
      return { success: false, error: "Identificador do cliente não fornecido." }
    }

    const { companyId } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    const updatePayload: Record<string, any> = {
      updated_at: now,
    }

    if (params.name !== undefined) updatePayload.name = params.name.trim() || null
    if (params.phone !== undefined) updatePayload.phone = params.phone.trim() || null
    if (params.email !== undefined) updatePayload.email = params.email.trim() || null

    let pendingMigration = false
    const fullPayload = { ...updatePayload }
    if (params.address !== undefined) fullPayload.address = params.address.trim() || null
    if (params.notes !== undefined) fullPayload.notes = params.notes.trim() || null

    // 1. Tenta atualizar com as novas colunas
    const { data: updatedCust, error: fullErr } = await adminClient
      .from("customers")
      .update(fullPayload)
      .eq("id", params.customerId)
      .eq("company_id", companyId)
      .select()
      .maybeSingle()

    let finalCustomer = updatedCust

    // 2. Se deu erro de coluna inexistente (42703), salva os campos base
    if (fullErr) {
      if (fullErr.code === "42703") {
        pendingMigration = true
        const { data: baseCust, error: baseErr } = await adminClient
          .from("customers")
          .update(updatePayload)
          .eq("id", params.customerId)
          .eq("company_id", companyId)
          .select()
          .maybeSingle()

        if (baseErr) {
          return { success: false, error: `Falha ao salvar dados do cliente: ${baseErr.message}` }
        }

        finalCustomer = {
          ...baseCust,
          address: params.address || null,
          notes: params.notes || null,
        }
      } else {
        return { success: false, error: `Falha ao atualizar cliente: ${fullErr.message}` }
      }
    }

    revalidatePath("/conversations")

    return {
      success: true,
      pendingMigration,
      customer: finalCustomer,
    }
  } catch (err: any) {
    return { success: false, error: err.message || "Erro desconhecido ao atualizar cliente." }
  }
}

/**
 * Server Action para adicionar uma nota interna na conversa (não enviada para o cliente)
 */
export async function createInternalNoteAction(params: {
  conversationId: string
  content: string
}): Promise<{
  success: boolean
  message?: MessageData
  error?: string
}> {
  try {
    const trimmed = params.content?.trim()
    if (!trimmed) {
      return { success: false, error: "O conteúdo da nota interna não pode ser vazio." }
    }

    const { userId, companyId, userName } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()
    const now = new Date().toISOString()

    // 1. Insere na tabela messages com sender_type: 'human' e message_type: 'internal_note'
    const { data: createdMsg, error: insertErr } = await adminClient
      .from("messages")
      .insert({
        company_id: companyId,
        conversation_id: params.conversationId,
        sender_type: "human",
        sender_id: userId,
        content: trimmed,
        message_type: "internal_note",
        metadata: {
          is_internal: true,
          operator_id: userId,
          operator_name: userName || "Atendente",
        },
      })
      .select()
      .single()

    if (insertErr || !createdMsg) {
      return {
        success: false,
        error: `Falha ao salvar nota interna: ${insertErr?.message || "Erro desconhecido"}`,
      }
    }

    // 2. Atualizar updated_at da conversa sem alterar last_message_at (para não resetar ordenação externa de clientes)
    await adminClient
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", params.conversationId)
      .eq("company_id", companyId)

    revalidatePath("/conversations")

    return {
      success: true,
      message: {
        id: createdMsg.id,
        company_id: createdMsg.company_id,
        conversation_id: createdMsg.conversation_id,
        sender_type: "human",
        sender_id: createdMsg.sender_id,
        content: createdMsg.content,
        message_type: "internal_note",
        metadata: createdMsg.metadata,
        created_at: createdMsg.created_at,
      },
    }
  } catch (err: any) {
    return { success: false, error: err.message || "Erro interno ao salvar nota interna." }
  }
}

export interface UploadMediaResult {
  success: boolean
  url?: string
  fileName?: string
  fileType?: string
  fileSize?: number
  error?: string
}

/**
 * Faz upload de arquivo/mídia (imagem, áudio, PDF) para o bucket chat-media do Supabase Storage
 */
export async function uploadChatMediaAction(formData: FormData): Promise<UploadMediaResult> {
  try {
    const { companyId } = await getAuthenticatedAgentContext()
    
    const file = formData.get("file") as File
    if (!file) {
      return { success: false, error: "Nenhum arquivo enviado." }
    }

    // Limite defensivo de 20MB
    const MAX_SIZE = 20 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return { success: false, error: "O arquivo excede o limite máximo de 20MB." }
    }

    const adminClient = createAdminClient()
    const rawName = file.name || "arquivo"
    const sanitizedName = rawName.replace(/[^a-zA-Z0-9.-]/g, "_")
    const filePath = `${companyId}/${Date.now()}-${sanitizedName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await adminClient.storage
      .from("chat-media")
      .upload(filePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      })

    if (uploadErr) {
      console.error("[ChatMedia] Erro no upload para Supabase Storage:", uploadErr)
      return { success: false, error: uploadErr.message || "Falha ao armazenar arquivo." }
    }

    const { data: { publicUrl } } = adminClient.storage
      .from("chat-media")
      .getPublicUrl(filePath)

    return {
      success: true,
      url: publicUrl,
      fileName: file.name || "arquivo",
      fileType: file.type || "application/octet-stream",
      fileSize: file.size || buffer.length,
    }
  } catch (err: any) {
    console.error("[ChatMedia] Exceção em uploadChatMediaAction:", err)
    return { success: false, error: err.message || "Erro interno ao processar mídia." }
  }
}

/**
 * Envia uma mensagem com anexo de mídia (imagem, áudio gravado, documento) para o cliente no WhatsApp
 */
export async function sendMediaMessageAction(params: {
  conversationId: string
  mediaUrl: string
  mediaType: "image" | "audio" | "document"
  fileName?: string
  caption?: string
  clientMessageId?: string
}): Promise<SendMessageResult> {
  try {
    const { conversationId, mediaUrl, mediaType, fileName, caption, clientMessageId } = params

    if (!conversationId || !mediaUrl) {
      return { success: false, error: "Dados incompletos para envio de mídia." }
    }

    const { userId, companyId, userName } = await getAuthenticatedAgentContext()
        const adminClient = createAdminClient()

    // 1. Obter conversa
    const { data: conv, error: convErr } = await adminClient
      .from("conversations")
      .select("id, company_id, channel, customers(name, phone)")
      .eq("id", conversationId)
      .eq("company_id", companyId)
      .single()

    if (convErr || !conv) {
      return { success: false, error: "Conversa não localizada ou não autorizada." }
    }

    const safeIdempotencyKey = clientMessageId?.trim()
      ? `manual-media-${conversationId}-${clientMessageId.trim()}`
      : `manual-media-${conversationId}-${crypto.randomUUID()}`

    const customerPhone = (conv.customers as any)?.phone || null
    const customerName = (conv.customers as any)?.name || "Cliente"
    const attendantName = (userName?.trim() || "Atendente").split(/\s+/)[0] || "Atendente"

    // Conteúdo textual de apoio / legenda
    const defaultPlaceholder =
      mediaType === "image"
        ? "[Imagem]"
        : mediaType === "audio"
        ? "[Mensagem de Voz]"
        : `[Documento] ${fileName || "arquivo"}`

    const cleanCaption = caption?.trim() || defaultPlaceholder
    const prefix = `*Atendente ${attendantName}:*\n`
    const outboundContent = cleanCaption.startsWith("*Atendente")
      ? cleanCaption
      : `${prefix}${cleanCaption}`

    // 2. Gravar na tabela messages
    const { data: createdMsg, error: msgInsertErr } = await adminClient
      .from("messages")
      .insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: "agent",
        sender_id: userId,
        content: outboundContent,
        message_type: mediaType,
        metadata: {
          delivery_status: "pending",
          client_message_id: clientMessageId || null,
          operator_name: attendantName,
          media_url: mediaUrl,
          file_name: fileName || null,
          media_type: mediaType,
        },
      })
      .select()
      .single()

    if (msgInsertErr || !createdMsg) {
      return {
        success: false,
        error: `Falha ao gravar mensagem de mídia: ${msgInsertErr?.message || "Erro"}`,
      }
    }

    // 3. Registrar na outbox com payload de mídia
    const outboxPayload = {
      event_id: safeIdempotencyKey,
      event_type: "message.send",
      channel: conv.channel || "whatsapp",
      conversation_id: conversationId,
      recipient: customerPhone,
      number: customerPhone,
      text: outboundContent,
      media_url: mediaUrl,
      media_type: mediaType,
      file_name: fileName || null,
      customer: {
        name: customerName,
        phone: customerPhone,
      },
      message: {
        id: createdMsg.id,
        content: outboundContent,
        text: outboundContent,
        sender_type: "agent",
        sender_id: userId,
        message_type: mediaType,
        media_url: mediaUrl,
        created_at: createdMsg.created_at,
      },
    }

    const { data: createdOutbox, error: outboxInsertErr } = await adminClient
      .from("message_outbox")
      .insert({
        company_id: companyId,
        conversation_id: conversationId,
        message_id: createdMsg.id,
        idempotency_key: safeIdempotencyKey,
        channel: conv.channel || "whatsapp",
        recipient: customerPhone,
        payload: outboxPayload,
        status: "pending",
        attempts: 0,
      })
      .select("id")
      .single()

    if (createdOutbox?.id) {
      try {
        await dispatchOutboxMessage(createdOutbox.id, { adminClient })
      } catch (dispErr: any) {
        console.error("[ChatMedia] Falha no despacho da outbox:", dispErr?.message || dispErr)
      }
    }

    await adminClient
      .from("conversations")
      .update({
        last_message_at: createdMsg.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)

    revalidatePath("/conversations")

    return {
      success: true,
      duplicate: false,
      messageId: createdMsg.id,
      data: createdMsg,
    }
  } catch (error: any) {
    console.error("[ChatMedia] Exceção em sendMediaMessageAction:", error)
    return {
      success: false,
      error: `Erro ao enviar mídia: ${error.message || "Erro desconhecido"}`,
    }
  }
}

export interface StartNewConversationResult {
  success: boolean
  conversationId?: string
  error?: string
}

/**
 * Inicia uma conversa ativa do painel diretamente para um número de WhatsApp.
 * Cria ou localiza o cliente, inicia a conversa em modo 'human' (assumida pelo atendente),
 * e despacha a primeira mensagem caso fornecida.
 */
export async function startNewConversationAction(params: {
  phone: string
  name?: string
  initialMessage?: string
}): Promise<StartNewConversationResult> {
  try {
    const { userId, companyId } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()

    // 1. Limpeza e normalização do número de telefone
    let cleanPhone = (params.phone || "").replace(/\D/g, "")
    if (!cleanPhone || cleanPhone.length < 8) {
      return { success: false, error: "Informe um número de telefone válido com DDD." }
    }

    // Se tiver 10 ou 11 dígitos (DDD + número), assume padrão Brasil (+55)
    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = `55${cleanPhone}`
    }

    const cleanName = params.name?.trim() || `Cliente (${cleanPhone.slice(-4)})`

    // 2. Localiza ou cadastra o cliente no Supabase
    let customerId: string
    const { data: existingCust } = await adminClient
      .from("customers")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("phone", cleanPhone)
      .maybeSingle()

    if (existingCust) {
      customerId = existingCust.id
      if (params.name?.trim() && existingCust.name !== params.name.trim()) {
        await adminClient
          .from("customers")
          .update({ name: params.name.trim() })
          .eq("id", customerId)
          .eq("company_id", companyId)
      }
    } else {
      const { data: newCust, error: custErr } = await adminClient
        .from("customers")
        .insert({
          company_id: companyId,
          name: cleanName,
          phone: cleanPhone,
        })
        .select("id")
        .single()

      if (custErr || !newCust) {
        return { success: false, error: `Falha ao cadastrar cliente: ${custErr?.message || "Erro desconhecido"}` }
      }
      customerId = newCust.id
    }

    // 3. Verifica se já existe conversa para este cliente no WhatsApp
    const { data: existingConv } = await adminClient
      .from("conversations")
      .select("id, status")
      .eq("company_id", companyId)
      .eq("customer_id", customerId)
      .eq("channel", "whatsapp")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    let conversationId: string
    const now = new Date().toISOString()

    if (existingConv) {
      conversationId = existingConv.id
      // Garante que a conversa esteja como 'human' atribuída ao atendente atual
      await adminClient
        .from("conversations")
        .update({
          status: "human",
          assigned_to: userId,
          closed_at: null,
          updated_at: now,
        })
        .eq("id", conversationId)
        .eq("company_id", companyId)
    } else {
      const { data: newConv, error: convErr } = await adminClient
        .from("conversations")
        .insert({
          company_id: companyId,
          customer_id: customerId,
          channel: "whatsapp",
          status: "human",
          assigned_to: userId,
          unread_count: 0,
          started_at: now,
          last_message_at: now,
        })
        .select("id")
        .single()

      if (convErr || !newConv) {
        return { success: false, error: `Falha ao iniciar conversa: ${convErr?.message || "Erro desconhecido"}` }
      }
      conversationId = newConv.id

      // Atribui funil padrão
      await assignDefaultWorkflowStages(adminClient, companyId, conversationId)
    }

    // 4. Se informou mensagem inicial, envia diretamente
    if (params.initialMessage?.trim()) {
      const sendRes = await sendMessageAction(conversationId, params.initialMessage.trim())
      if (!sendRes?.success) {
        return {
          success: true,
          conversationId,
          error: sendRes?.error || "Conversa criada, mas houve falha no envio da mensagem inicial.",
        }
      }
    }

    revalidatePath("/conversations")
    return { success: true, conversationId }
  } catch (err: any) {
    console.error("[startNewConversationAction] Exceção:", err)
    return { success: false, error: err?.message || "Erro interno ao iniciar conversa." }
  }
}
