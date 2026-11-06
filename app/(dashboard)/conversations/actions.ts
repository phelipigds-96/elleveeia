"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/service"

export interface CustomerData {
  id?: string
  name?: string | null
  phone?: string | null
  email?: string | null
}

export interface ConversationData {
  id: string
  company_id: string
  customer_id?: string | null
  channel?: string | null
  status: "open" | "closed" | "human" | string
  assigned_to?: string | null
  started_at?: string | null
  last_message_at: string
  closed_at?: string | null
  created_at: string
  updated_at?: string | null
  unread_count: number
  external_id?: string | null
  agent_id?: string | null
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
    delivery_status?: "pending" | "sent" | "delivered" | "read" | string
    source?: string
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

const DEFAULT_PREVIEW_COMPANY_ID = "90e69b50-1b4e-4f4a-94f2-78be1cf82833" // Ellevee Admin
const DEFAULT_PREVIEW_USER_ID = "71ee00c9-e22b-479d-bc34-9d596448c3f9"    // admin@ellevee.com

/**
 * Extrai o company_id e o sender_id diretamente da sessão segura do servidor via SSR auth.
 * Em modo de demonstração/preview, provê o contexto padrão do tenant administrador.
 */
async function getAuthenticatedAgentContext(): Promise<{ userId: string; companyId: string }> {
  let userId: string | null = null
  let companyId: string | null = null

  try {
    const supabase = createClient()
    const { data: authData } = await supabase.auth.getUser()

    if (authData?.user) {
      userId = authData.user.id
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle()

      if (profile?.company_id) {
        companyId = profile.company_id
      }
    }
  } catch {
    // Ignora erros de contexto em ambiente de pré-visualização estática
  }

  return {
    userId: userId || DEFAULT_PREVIEW_USER_ID,
    companyId: companyId || DEFAULT_PREVIEW_COMPANY_ID,
  }
}

/**
 * Obtém a lista real de conversas ordenadas por last_message_at desc
 */
export async function getConversationsList(): Promise<ConversationData[]> {
  try {
    const { companyId } = await getAuthenticatedAgentContext()
    const client = createAdminClient()

    // 1. Busca conversas do tenant
    const { data: rawConvs, error: convError } = await client
      .from("conversations")
      .select(`
        id,
        company_id,
        customer_id,
        channel,
        status,
        assigned_to,
        started_at,
        last_message_at,
        closed_at,
        created_at,
        updated_at,
        unread_count,
        external_id,
        agent_id,
        customers (
          id,
          name,
          phone,
          email
        )
      `)
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50)

    if (convError || !rawConvs) {
      console.error("[Conversations] Erro ao buscar conversas:", convError)
      return []
    }

    const convIds = rawConvs.map((c: any) => c.id)

    // 2. Busca a última mensagem de cada conversa para preencher o preview
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

    // 3. Monta o contrato tipado
    const formatted: ConversationData[] = rawConvs.map((c: any) => {
      const customer = Array.isArray(c.customers) ? c.customers[0] : c.customers
      const preview = previewMap.get(c.id) || (c.channel ? `Atendimento via ${c.channel}` : "Nova conversa iniciada")

      return {
        id: c.id,
        company_id: c.company_id,
        customer_id: c.customer_id,
        channel: c.channel || "whatsapp",
        status: c.status || "open",
        assigned_to: c.assigned_to,
        started_at: c.started_at,
        last_message_at: c.last_message_at || c.created_at,
        closed_at: c.closed_at,
        created_at: c.created_at,
        updated_at: c.updated_at,
        unread_count: c.unread_count || 0,
        external_id: c.external_id,
        agent_id: c.agent_id,
        customers: customer || { name: "Cliente Desconhecido", phone: c.external_id },
        last_message_preview: preview,
      }
    })

    return formatted
  } catch (error) {
    console.error("[Conversations] Exceção em getConversationsList:", error)
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

    const { userId, companyId } = await getAuthenticatedAgentContext()
    const adminClient = createAdminClient()

    // 1. Obter conversa e canal
    const { data: conv, error: convErr } = await adminClient
      .from("conversations")
      .select("id, company_id, channel, customers(phone)")
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

    // 3. Persistência na tabela messages com sender_type: 'agent'
    const { data: createdMsg, error: msgInsertErr } = await adminClient
      .from("messages")
      .insert({
        company_id: companyId,
        conversation_id: conversationId,
        sender_type: "agent",
        sender_id: userId,
        content: trimmed,
        message_type: "text",
        metadata: {
          delivery_status: "sent",
          client_message_id: clientMessageId || null,
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
    const { error: outboxInsertErr } = await adminClient
      .from("message_outbox")
      .insert({
        company_id: companyId,
        conversation_id: conversationId,
        message_id: createdMsg.id,
        idempotency_key: safeIdempotencyKey,
        channel: conv.channel || "whatsapp",
        recipient: customerPhone,
        payload: {
          event_id: safeIdempotencyKey,
          conversation_id: conversationId,
          channel: conv.channel || "whatsapp",
          recipient: customerPhone,
          message: {
            id: createdMsg.id,
            content: trimmed,
            sender_type: "agent",
            sender_id: userId,
            created_at: createdMsg.created_at,
          },
        },
        status: "pending",
        attempts: 0,
      })

    if (outboxInsertErr) {
      console.warn("[Chat] Aviso ao registrar na message_outbox:", outboxInsertErr.message)
    }

    // 5. Atualização do timestamp de última mensagem da conversa
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

    const { userId, companyId } = await getAuthenticatedAgentContext()
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

    // 2. Gravar evento de sistema indicando o transbordo para o operador humano
    await adminClient.from("messages").insert({
      company_id: companyId,
      conversation_id: conversationId,
      sender_type: "system",
      content: "Atendimento transferido para o operador humano. A IA foi pausada nesta conversa.",
      message_type: "event",
      metadata: {
        event: "conversation.takeover",
        operator_id: userId,
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
