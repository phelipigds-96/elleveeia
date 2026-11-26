import type {
  CloseReason,
  ConversationData,
  CustomerData,
  MessageData,
} from "@/app/(dashboard)/conversations/actions"

export interface CustomerProfileDraft {
  id: string
  name: string
  phone: string
  email: string
  address: string
  notes: string
  avatar_url: string
}

export function buildInitialCustomerDraft(params: {
  customerId?: string | null
  customer?: CustomerData | null
  externalId?: string | null
}): CustomerProfileDraft {
  const cust = params.customer
  return {
    id: params.customerId || cust?.id || "",
    name: cust?.name || "",
    phone: cust?.phone || params.externalId || "",
    email: cust?.email || "",
    address: cust?.address || "",
    notes: cust?.notes || "",
    avatar_url: cust?.avatar_url || "",
  }
}

/**
 * Mescla detalhes carregados do servidor apenas quando o ID do cliente
 * corresponde exatamente ao contato ativo, preservando campos já editados
 * pelo operador (evitando corrida entre carregamento assíncrono e edição/salvamento).
 */
export function mergeLoadedCustomerDetails(
  currentDraft: CustomerProfileDraft,
  loadedCustomer: CustomerData | null | undefined,
  expectedCustomerId: string,
  dirtyFields?: ReadonlySet<keyof CustomerProfileDraft>
): CustomerProfileDraft {
  if (!loadedCustomer || !expectedCustomerId) return currentDraft
  if (loadedCustomer.id && loadedCustomer.id !== expectedCustomerId) {
    return currentDraft
  }
  if (currentDraft.id && currentDraft.id !== expectedCustomerId) {
    return currentDraft
  }

  const isDirty = (field: keyof CustomerProfileDraft) => Boolean(dirtyFields?.has(field))

  return {
    ...currentDraft,
    id: loadedCustomer.id || currentDraft.id || expectedCustomerId,
    name: isDirty("name") ? currentDraft.name : loadedCustomer.name || currentDraft.name,
    phone: isDirty("phone") ? currentDraft.phone : loadedCustomer.phone || currentDraft.phone,
    email: isDirty("email") ? currentDraft.email : loadedCustomer.email || currentDraft.email,
    address: isDirty("address")
      ? currentDraft.address
      : (loadedCustomer.address ?? currentDraft.address ?? ""),
    notes: isDirty("notes")
      ? currentDraft.notes
      : (loadedCustomer.notes ?? currentDraft.notes ?? ""),
    avatar_url: loadedCustomer.avatar_url || currentDraft.avatar_url || "",
  }
}

/**
 * Rejeita respostas assíncronas tardias de `getCustomerDetailsAction`
 * em trocas rápidas entre contatos (incluindo A → B → A).
 */
export function isStaleCustomerProfileLoad(params: {
  activeConversationId: string | null
  requestConversationId: string
  activeCustomerId: string
  requestCustomerId: string
  activeSeq: number
  requestSeq: number
}): boolean {
  return (
    params.activeConversationId !== params.requestConversationId ||
    params.activeCustomerId !== params.requestCustomerId ||
    params.activeSeq !== params.requestSeq
  )
}

/**
 * Reflete alterações de perfil confirmadas pelo servidor na lista e cabeçalho
 * somente para a conversa alvo (e conversas do mesmo cliente), sem tocar em outros contatos.
 */
export function applyConfirmedCustomerUpdate(
  conversations: ConversationData[],
  targetConversationId: string,
  targetCustomerId: string,
  savedDraft: Pick<CustomerProfileDraft, "name" | "phone" | "email" | "address" | "notes">
): ConversationData[] {
  return conversations.map((c) => {
    const matchesConversation = c.id === targetConversationId
    const matchesSameCustomer = Boolean(targetCustomerId && c.customer_id === targetCustomerId)
    if (!matchesConversation && !matchesSameCustomer) return c

    return {
      ...c,
      customers: {
        ...c.customers,
        name: savedDraft.name,
        phone: savedDraft.phone,
        email: savedDraft.email,
        address: savedDraft.address,
        notes: savedDraft.notes,
      },
    }
  })
}

/**
 * Compara listas de notas internas por ID, conteúdo e timestamp para manter
 * estabilidade referencial quando mensagens comuns chegam via Realtime.
 */
export function areInternalNotesEqual(prev: MessageData[], next: MessageData[]): boolean {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    if (
      prev[i].id !== next[i].id ||
      prev[i].content !== next[i].content ||
      prev[i].created_at !== next[i].created_at
    ) {
      return false
    }
  }
  return true
}

export function sanitizeWhatsAppDigits(phone?: string | null): string {
  return (phone || "").replace(/\D/g, "")
}

export function getCloseReasonDotClass(color?: string | null): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-500"
    case "blue":
      return "bg-blue-500"
    case "violet":
      return "bg-purple-500"
    case "amber":
      return "bg-amber-500"
    case "rose":
      return "bg-rose-500"
    case "cyan":
      return "bg-cyan-500"
    default:
      return "bg-slate-500"
  }
}

export function getActiveCloseReasons(closeReasons: CloseReason[]): CloseReason[] {
  return closeReasons.filter((r) => r.isActive)
}

export function canConfirmCloseConversation(params: {
  isClosing: boolean
  requireCloseReason: boolean
  selectedReasonId: string | null
}): boolean {
  if (params.isClosing) return false
  if (params.requireCloseReason && !params.selectedReasonId) return false
  return true
}
