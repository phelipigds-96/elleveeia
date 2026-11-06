"use server"

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

const DEFAULT_PREVIEW_COMPANY_ID = "90e69b50-1b4e-4f4a-94f2-78be1cf82833" // Ellevee Admin

/**
 * Obtém a lista real de conversas ordenadas por last_message_at desc
 */
export async function getConversationsList(): Promise<ConversationData[]> {
  try {
    let client: any
    let targetCompanyId: string | null = null

    try {
      const supabase = createClient()
      const { data: authData } = await supabase.auth.getUser()

      if (authData?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", authData.user.id)
          .maybeSingle()

        if (profile?.company_id) {
          targetCompanyId = profile.company_id
          client = supabase
        }
      }
    } catch (e) {
      // Ignora erro de cookie/sessão em ambiente de renderização estática
    }

    // Se não houver sessão ativa (modo preview no Lovable), usa adminClient para a empresa de demonstração
    if (!client || !targetCompanyId) {
      client = createAdminClient()
      targetCompanyId = DEFAULT_PREVIEW_COMPANY_ID
    }

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
      .eq("company_id", targetCompanyId)
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

    let client: any

    try {
      const supabase = createClient()
      const { data: authData } = await supabase.auth.getUser()
      if (authData?.user) {
        client = supabase
      }
    } catch {
      // Ignora erro de cookie
    }

    if (!client) {
      client = createAdminClient()
    }

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
