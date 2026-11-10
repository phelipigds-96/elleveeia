import { createAdminClient } from "@/lib/supabase/service"

export interface CloseReason {
  id: string
  companyId: string
  title: string
  description?: string | null
  color: string
  isActive: boolean
  orderIndex: number
  createdAt?: string
}

export interface SaveCloseReasonInput {
  id?: string
  title: string
  description?: string
  color?: string
  isActive?: boolean
  orderIndex?: number
}

export interface QuickReply {
  id: string
  companyId: string
  title: string
  shortcut?: string | null
  content: string
  category: string
  isActive: boolean
  orderIndex: number
  createdAt?: string
}

export interface SaveQuickReplyInput {
  id?: string
  title: string
  shortcut?: string
  content: string
  category?: string
  isActive?: boolean
  orderIndex?: number
}

export const DEFAULT_CLOSE_REASONS: Array<Omit<CloseReason, "id" | "companyId">> = [
  {
    title: "Venda Concluída",
    description: "Atendimento resultou em conversão ou fechamento de pedido.",
    color: "emerald",
    isActive: true,
    orderIndex: 0,
  },
  {
    title: "Dúvida Esclarecida",
    description: "O cliente obteve a informação solicitada com clareza.",
    color: "blue",
    isActive: true,
    orderIndex: 1,
  },
  {
    title: "Orçamento / Proposta Enviada",
    description: "Cotação enviada, aguardando deliberação do cliente.",
    color: "violet",
    isActive: true,
    orderIndex: 2,
  },
  {
    title: "Sem Retorno do Cliente",
    description: "Cliente parou de responder após tentativas de contato.",
    color: "amber",
    isActive: true,
    orderIndex: 3,
  },
  {
    title: "Desistência / Preço",
    description: "Cliente optou por não dar continuidade por preço ou condições.",
    color: "rose",
    isActive: true,
    orderIndex: 4,
  },
  {
    title: "Outros / Diversos",
    description: "Outros assuntos não categorizados anteriormente.",
    color: "slate",
    isActive: true,
    orderIndex: 5,
  },
]

export const DEFAULT_QUICK_REPLIES: Array<Omit<QuickReply, "id" | "companyId">> = [
  {
    title: "Chave Pix CNPJ",
    shortcut: "pix",
    category: "Financeiro",
    content: "Segue a nossa chave Pix (CNPJ) para pagamento:\n[Chave PIX da Empresa]\n\nAssim que efetuar o pagamento, por favor envie o comprovante por aqui!",
    isActive: true,
    orderIndex: 0,
  },
  {
    title: "Horário de Funcionamento",
    shortcut: "horario",
    category: "Geral",
    content: "Nosso horário de atendimento é de segunda a sexta, das 08h às 18h, e aos sábados das 08h às 12h.",
    isActive: true,
    orderIndex: 1,
  },
  {
    title: "Dados Bancários",
    shortcut: "banco",
    category: "Financeiro",
    content: "Dados para transferência bancária:\nBanco: [Nome do Banco]\nAgência: 0001\nConta: 12345-6\nFavorecido: [Nome da Organização]\nCNPJ: [CNPJ]",
    isActive: true,
    orderIndex: 2,
  },
  {
    title: "Agradecimento & Despedida",
    shortcut: "obrigado",
    category: "Geral",
    content: "Foi um prazer atendê-lo(a)! Se precisar de qualquer outra coisa, estamos sempre à disposição. Tenha um excelente dia!",
    isActive: true,
    orderIndex: 3,
  },
]

// ============================================================================
// MOTIVOS DE FINALIZAÇÃO (CLOSE REASONS)
// ============================================================================

export async function getCompanyClosePolicy(companyId: string): Promise<{ requireCloseReason: boolean }> {
  try {
    const adminClient = createAdminClient()
    const { data, error } = await adminClient
      .from("companies")
      .select("require_close_reason")
      .eq("id", companyId)
      .maybeSingle()

    if (!error && data && data.require_close_reason !== undefined) {
      return { requireCloseReason: Boolean(data.require_close_reason) }
    }
  } catch (err: any) {
    console.warn("[ClosePolicy] Aviso ao consultar política da empresa:", err?.message)
  }
  return { requireCloseReason: false }
}

export async function getCompanyCloseReasons(
  companyId: string,
  onlyActive: boolean = false
): Promise<CloseReason[]> {
  try {
    const adminClient = createAdminClient()
    let query = adminClient
      .from("conversation_close_reasons")
      .select("id, company_id, title, description, color, is_active, order_index, created_at")
      .eq("company_id", companyId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true })

    if (onlyActive) {
      query = query.eq("is_active", true)
    }

    const { data, error } = await query

    if (!error && data && data.length > 0) {
      return data.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        title: r.title,
        description: r.description,
        color: r.color || "slate",
        isActive: Boolean(r.is_active),
        orderIndex: r.order_index ?? 0,
        createdAt: r.created_at,
      }))
    }
  } catch (err: any) {
    console.warn("[CloseReasons] Fallback ao consultar motivos de finalização:", err?.message)
  }

  // Fallback padrão em memória caso a tabela não exista ainda ou não tenha registros
  return DEFAULT_CLOSE_REASONS.map((d, index) => ({
    id: `default-${index}`,
    companyId,
    title: d.title,
    description: d.description,
    color: d.color,
    isActive: d.isActive,
    orderIndex: d.orderIndex,
  }))
}

export async function saveCompanyCloseReason(
  companyId: string,
  input: SaveCloseReasonInput
): Promise<{ success: boolean; data?: CloseReason; error?: string }> {
  try {
    const adminClient = createAdminClient()
    const title = input.title?.trim()
    if (!title || title.length < 2) {
      return { success: false, error: "O título do motivo deve ter no mínimo 2 caracteres." }
    }

    const payload: any = {
      company_id: companyId,
      title,
      description: input.description?.trim() || null,
      color: input.color || "slate",
      is_active: input.isActive !== undefined ? input.isActive : true,
      order_index: input.orderIndex ?? 0,
      updated_at: new Date().toISOString(),
    }

    if (input.id && !input.id.startsWith("default-")) {
      const { data, error } = await adminClient
        .from("conversation_close_reasons")
        .update(payload)
        .eq("id", input.id)
        .eq("company_id", companyId)
        .select()
        .single()

      if (error) {
        return { success: false, error: `Falha ao atualizar motivo: ${error.message}` }
      }
      return {
        success: true,
        data: {
          id: data.id,
          companyId: data.company_id,
          title: data.title,
          description: data.description,
          color: data.color,
          isActive: data.is_active,
          orderIndex: data.order_index,
          createdAt: data.created_at,
        },
      }
    } else {
      const { data, error } = await adminClient
        .from("conversation_close_reasons")
        .insert(payload)
        .select()
        .single()

      if (error) {
        return { success: false, error: `Falha ao criar motivo: ${error.message}` }
      }
      return {
        success: true,
        data: {
          id: data.id,
          companyId: data.company_id,
          title: data.title,
          description: data.description,
          color: data.color,
          isActive: data.is_active,
          orderIndex: data.order_index,
          createdAt: data.created_at,
        },
      }
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro inesperado ao salvar motivo." }
  }
}

export async function deleteCompanyCloseReason(
  companyId: string,
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (id.startsWith("default-")) {
      return { success: true }
    }
    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from("conversation_close_reasons")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro inesperado ao excluir motivo." }
  }
}

export async function toggleCompanyCloseReason(
  companyId: string,
  id: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    if (id.startsWith("default-")) {
      return { success: true }
    }
    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from("conversation_close_reasons")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao alternar status do motivo." }
  }
}

// ============================================================================
// MENSAGENS RÁPIDAS (QUICK REPLIES / CANNED RESPONSES)
// ============================================================================

export async function getCompanyQuickReplies(
  companyId: string,
  onlyActive: boolean = false
): Promise<QuickReply[]> {
  try {
    const adminClient = createAdminClient()
    let query = adminClient
      .from("quick_replies")
      .select("id, company_id, title, shortcut, content, category, is_active, order_index, created_at")
      .eq("company_id", companyId)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true })

    if (onlyActive) {
      query = query.eq("is_active", true)
    }

    const { data, error } = await query

    if (!error && data && data.length > 0) {
      return data.map((q) => ({
        id: q.id,
        companyId: q.company_id,
        title: q.title,
        shortcut: q.shortcut ? q.shortcut.replace(/^\//, "") : null,
        content: q.content,
        category: q.category || "Geral",
        isActive: Boolean(q.is_active),
        orderIndex: q.order_index ?? 0,
        createdAt: q.created_at,
      }))
    }
  } catch (err: any) {
    console.warn("[QuickReplies] Fallback ao consultar mensagens rápidas:", err?.message)
  }

  // Fallback padrão em memória caso a tabela não exista ainda ou não tenha registros
  return DEFAULT_QUICK_REPLIES.map((d, index) => ({
    id: `default-qr-${index}`,
    companyId,
    title: d.title,
    shortcut: d.shortcut,
    content: d.content,
    category: d.category,
    isActive: d.isActive,
    orderIndex: d.orderIndex,
  }))
}

export async function saveCompanyQuickReply(
  companyId: string,
  input: SaveQuickReplyInput
): Promise<{ success: boolean; data?: QuickReply; error?: string }> {
  try {
    const adminClient = createAdminClient()
    const title = input.title?.trim()
    const content = input.content?.trim()

    if (!title || title.length < 2) {
      return { success: false, error: "O título da mensagem rápida deve conter no mínimo 2 caracteres." }
    }
    if (!content || content.length < 1) {
      return { success: false, error: "O conteúdo da mensagem rápida não pode estar vazio." }
    }

    // Normaliza atalho (sem barra inicial, apenas minúsculas e hífens)
    const cleanShortcut = input.shortcut
      ? input.shortcut
          .trim()
          .replace(/^\//, "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9_-]/g, "")
      : null

    const payload: any = {
      company_id: companyId,
      title,
      shortcut: cleanShortcut || null,
      content,
      category: input.category?.trim() || "Geral",
      is_active: input.isActive !== undefined ? input.isActive : true,
      order_index: input.orderIndex ?? 0,
      updated_at: new Date().toISOString(),
    }

    if (input.id && !input.id.startsWith("default-qr-")) {
      const { data, error } = await adminClient
        .from("quick_replies")
        .update(payload)
        .eq("id", input.id)
        .eq("company_id", companyId)
        .select()
        .single()

      if (error) {
        return { success: false, error: `Falha ao atualizar mensagem rápida: ${error.message}` }
      }
      return {
        success: true,
        data: {
          id: data.id,
          companyId: data.company_id,
          title: data.title,
          shortcut: data.shortcut,
          content: data.content,
          category: data.category,
          isActive: data.is_active,
          orderIndex: data.order_index,
          createdAt: data.created_at,
        },
      }
    } else {
      const { data, error } = await adminClient
        .from("quick_replies")
        .insert(payload)
        .select()
        .single()

      if (error) {
        return { success: false, error: `Falha ao criar mensagem rápida: ${error.message}` }
      }
      return {
        success: true,
        data: {
          id: data.id,
          companyId: data.company_id,
          title: data.title,
          shortcut: data.shortcut,
          content: data.content,
          category: data.category,
          isActive: data.is_active,
          orderIndex: data.order_index,
          createdAt: data.created_at,
        },
      }
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro inesperado ao salvar mensagem rápida." }
  }
}

export async function deleteCompanyQuickReply(
  companyId: string,
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (id.startsWith("default-qr-")) {
      return { success: true }
    }
    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from("quick_replies")
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro inesperado ao excluir mensagem rápida." }
  }
}

export async function toggleCompanyQuickReply(
  companyId: string,
  id: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    if (id.startsWith("default-qr-")) {
      return { success: true }
    }
    const adminClient = createAdminClient()
    const { error } = await adminClient
      .from("quick_replies")
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao alternar status da mensagem rápida." }
  }
}
