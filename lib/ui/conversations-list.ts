import type { ConversationData } from "@/app/(dashboard)/conversations/actions"

export type ConversationListTab = "all" | "waiting" | "in_progress" | "ai" | "closed"

export interface ConversationListCounts {
  all: number
  waiting: number
  inProgress: number
  ai: number
  closed: number
}

export function getDefaultConversationTab(isMasterOrAdmin: boolean): ConversationListTab {
  return isMasterOrAdmin ? "all" : "waiting"
}

export function computeConversationCounts(
  conversations: readonly ConversationData[]
): ConversationListCounts {
  let waiting = 0
  let inProgress = 0
  let ai = 0
  let closed = 0

  for (const c of conversations) {
    if (c.status === "closed") {
      closed++
    } else if (c.status === "human") {
      if (!c.assigned_to) {
        waiting++
      } else {
        inProgress++
      }
    } else if (c.status === "open") {
      ai++
    }
  }

  return {
    all: conversations.length,
    waiting,
    inProgress,
    ai,
    closed,
  }
}

export function filterConversations(
  conversations: readonly ConversationData[],
  activeTab: ConversationListTab,
  search: string
): ConversationData[] {
  const normalizedSearch = search.trim() ? search.toLowerCase() : ""

  return conversations.filter((c) => {
    if (activeTab === "waiting" && !(c.status === "human" && !c.assigned_to)) return false
    if (activeTab === "in_progress" && !(c.status === "human" && !!c.assigned_to)) return false
    if (activeTab === "ai" && c.status !== "open") return false
    if (activeTab === "closed" && c.status !== "closed") return false

    if (!normalizedSearch) return true
    const customerName = c.customers?.name?.toLowerCase() || ""
    const phone = c.customers?.phone?.toLowerCase() || ""
    const preview = c.last_message_preview?.toLowerCase() || ""

    return (
      customerName.includes(normalizedSearch) ||
      phone.includes(normalizedSearch) ||
      preview.includes(normalizedSearch)
    )
  })
}

export interface StageColorCandidate {
  workflow_stage_color?: string | null
  stage_color?: string | null
  workflow_stages?: { color?: string | null } | null
}

export function resolveConversationStageColor(
  conv: StageColorCandidate | null | undefined
): string {
  const raw =
    conv?.workflow_stage_color ??
    conv?.stage_color ??
    conv?.workflow_stages?.color ??
    null
  if (typeof raw === "string" && /^#[0-9a-fA-F]{3,8}$/.test(raw.trim())) {
    return raw.trim()
  }
  return "#64748b"
}

export function getCustomerInitials(name?: string | null): string {
  const customerName = name || "Cliente Desconhecido"
  return (
    customerName
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "CL"
  )
}

export function formatConversationTimeAgo(isoString: string, nowMs: number = Date.now()): string {
  if (!isoString) return ""
  const diff = nowMs - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "agora"
  if (mins < 60) return `há ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `há ${days}d`
  return new Date(isoString).toLocaleDateString([], { day: "2-digit", month: "2-digit" })
}

export function formatConversationWaitTime(isoString: string, nowMs: number = Date.now()): string {
  if (!isoString) return "instantes"
  const diff = Math.max(0, nowMs - new Date(isoString).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "instantes"
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
