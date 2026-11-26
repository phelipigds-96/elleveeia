import { resolveAiStatusDetail } from "./conversations-quote-card"

export type HeaderOwnershipTone = "waiting" | "human" | "ai" | "closed"

export interface HeaderOwnershipView {
  tone: HeaderOwnershipTone
  label: string
}

export interface HeaderOwnershipInput {
  status?: string | null
  assignedTo?: string | null
  currentUserId?: string | null
  agentName?: string | null
}

/**
 * Resolve o estado textual e visual de ownership exibido no cabeçalho da conversa,
 * alinhado à taxonomia Fluent/Ellevee ("IA ativa", "Aguardando", "Com você", "Operador", "Finalizado")
 * e livre de redundâncias como "IA ativa · IA".
 */
export function resolveHeaderOwnershipView(input: HeaderOwnershipInput): HeaderOwnershipView {
  if (input.status === "closed") {
    return { tone: "closed", label: "Finalizado" }
  }

  if (input.status === "human") {
    if (!input.assignedTo) {
      return { tone: "waiting", label: "Aguardando" }
    }
    return {
      tone: "human",
      label: input.assignedTo === input.currentUserId ? "Com você" : "Operador",
    }
  }

  const aiDetail = resolveAiStatusDetail(input.agentName)
  return {
    tone: "ai",
    label: aiDetail ? `IA ativa · ${aiDetail}` : "IA ativa",
  }
}

export function resolveReturnToAiLabel(agentName?: string | null): string {
  const aiDetail = resolveAiStatusDetail(agentName)
  return aiDetail ? `Devolver para ${aiDetail}` : "Devolver para IA"
}

export function formatConversationPhone(phone?: string | null): string {
  if (!phone) return ""
  const clean = phone.replace(/\D/g, "")
  if (clean.length === 13 && clean.startsWith("55")) {
    return `+55 (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  }
  if (clean.length === 12 && clean.startsWith("55")) {
    return `+55 (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`
  }
  if (clean.length === 11) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`
  }
  return phone
}

export interface HeaderLifecycleFlags {
  isTakingOver: boolean
  isReturningToAI: boolean
  isClosing: boolean
  isReopening: boolean
}

/**
 * Impede ações concorrentes de ciclo de vida (Assumir, Devolver à IA, Finalizar, Reabrir)
 * enquanto outra operação aguarda confirmação do servidor.
 */
export function isHeaderActionLocked(flags: HeaderLifecycleFlags): boolean {
  return (
    flags.isTakingOver ||
    flags.isReturningToAI ||
    flags.isClosing ||
    flags.isReopening
  )
}
