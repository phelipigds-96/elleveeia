import type { MessageData } from "@/app/(dashboard)/conversations/actions"

export type MessageAuthorKind = "system" | "internal_note" | "customer" | "human" | "ai"
export type MessageMediaKind = "image" | "audio" | "document"
export type MessageDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed"

export interface ResolvedMessageMedia {
  url: string
  type: MessageMediaKind
  fileName: string
}

export type MessageFeedEntry =
  | {
      kind: "divider"
      id: string
      label: string
      createdAt: string
    }
  | {
      kind: "message"
      id: string
      message: MessageData
    }

const IMAGE_URL_REGEX = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i
const AUDIO_URL_REGEX = /\.(mp3|ogg|wav|m4a|webm)(\?.*)?$/i
const DOCUMENT_URL_REGEX = /\.(pdf|docx?|xlsx?|txt)(\?.*)?$/i

export function formatMessageTime(isoString?: string | null): string {
  if (!isoString) return ""
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function isSameCalendarDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false
  const d1 = new Date(a)
  const d2 = new Date(b)
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return false
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

export function formatMessageDayLabel(isoString?: string | null, referenceDate = new Date()): string {
  if (!isoString) return ""
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return ""

  const yesterday = new Date(referenceDate)
  yesterday.setDate(referenceDate.getDate() - 1)

  if (isSameCalendarDay(isoString, referenceDate.toISOString())) return "Hoje"
  if (isSameCalendarDay(isoString, yesterday.toISOString())) return "Ontem"
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
}

export function classifyMessageAuthor(msg: MessageData): MessageAuthorKind {
  if (msg.sender_type === "system" || msg.message_type === "event") {
    return "system"
  }
  if (msg.message_type === "internal_note" || Boolean(msg.metadata?.is_internal)) {
    return "internal_note"
  }
  if (msg.sender_type === "customer") {
    return "customer"
  }
  if (msg.sender_type === "human" || Boolean(msg.sender_id)) {
    return "human"
  }
  return "ai"
}

export function resolveMessageMedia(msg: MessageData): ResolvedMessageMedia | null {
  const legacyRecord = msg as MessageData & { media_url?: string | null; file_name?: string | null }
  const mediaUrl =
    (typeof msg.metadata?.media_url === "string" ? msg.metadata.media_url : null) ||
    legacyRecord.media_url ||
    (msg.message_type !== "text" && typeof msg.content === "string" && msg.content.startsWith("http")
      ? msg.content
      : null)

  const rawMediaType =
    (typeof msg.metadata?.media_type === "string" ? msg.metadata.media_type : null) ||
    (msg.message_type && msg.message_type !== "text" && msg.message_type !== "event" && msg.message_type !== "internal_note"
      ? msg.message_type
      : null) ||
    (mediaUrl && IMAGE_URL_REGEX.test(mediaUrl)
      ? "image"
      : mediaUrl && AUDIO_URL_REGEX.test(mediaUrl)
      ? "audio"
      : mediaUrl && DOCUMENT_URL_REGEX.test(mediaUrl)
      ? "document"
      : null)

  if (!mediaUrl) return null

  const fileName =
    (typeof msg.metadata?.file_name === "string" && msg.metadata.file_name) ||
    legacyRecord.file_name ||
    "arquivo"

  if (rawMediaType === "image" || IMAGE_URL_REGEX.test(mediaUrl)) {
    return { url: mediaUrl, type: "image", fileName }
  }
  if (rawMediaType === "audio" || AUDIO_URL_REGEX.test(mediaUrl)) {
    return { url: mediaUrl, type: "audio", fileName }
  }
  return { url: mediaUrl, type: "document", fileName }
}

export function isAudioMessage(msg: MessageData): boolean {
  return msg.message_type === "audio" || msg.metadata?.media_type === "audio"
}

/**
 * Remove placeholders técnicos ([Imagem], [Mensagem de Voz], [Documento] ou URL bruta)
 * SOMENTE quando há media_url carregada, preservando integralmente qualquer texto real.
 */
export function getMessageDisplayContent(msg: MessageData): string | null {
  const content = msg.content || ""
  const legacyRecord = msg as MessageData & { media_url?: string | null }
  const mediaUrl =
    (typeof msg.metadata?.media_url === "string" ? msg.metadata.media_url : null) ||
    legacyRecord.media_url

  if (mediaUrl && content.trim() === mediaUrl.trim()) return null

  if (
    Boolean(mediaUrl) &&
    (content.trim() === "[Imagem]" ||
      content.trim() === "[Mensagem de Voz]" ||
      content.trim().startsWith("[Documento]") ||
      content.endsWith("[Imagem]") ||
      content.endsWith("[Mensagem de Voz]"))
  ) {
    const cleaned = content.replace(/\[(Imagem|Mensagem de Voz|Documento.*?)\]/g, "").trim()
    if (!cleaned || /^(\*Atendente[^*]*:\*|\s)*$/.test(cleaned)) {
      return null
    }
    return cleaned
  }

  return content || null
}

export function resolveMessageDeliveryStatus(msg: MessageData): MessageDeliveryStatus | null {
  if (msg.sender_type !== "agent" && msg.sender_type !== "human") return null

  const legacyRecord = msg as MessageData & { delivery_status?: string }
  const raw = msg.metadata?.delivery_status || legacyRecord.delivery_status || "sent"

  if (raw === "pending" || raw === "sent" || raw === "delivered" || raw === "read" || raw === "failed") {
    return raw
  }
  return "sent"
}

/**
 * Constrói o feed cronológico com deduplicação defensiva por id e separadores de dia.
 */
export function buildMessageFeedEntries(
  messages: MessageData[],
  referenceDate = new Date()
): MessageFeedEntry[] {
  const feed: MessageFeedEntry[] = []
  const seenIds = new Set<string>()
  let lastDay = ""

  for (const msg of messages) {
    if (!msg?.id || seenIds.has(msg.id)) continue
    seenIds.add(msg.id)

    const day = msg.created_at ? new Date(msg.created_at).toDateString() : ""
    if (day && day !== "Invalid Date" && day !== lastDay) {
      feed.push({
        kind: "divider",
        id: `divider-${day}-${msg.id}`,
        label: formatMessageDayLabel(msg.created_at, referenceDate),
        createdAt: msg.created_at,
      })
      lastDay = day
    }

    feed.push({
      kind: "message",
      id: msg.id,
      message: msg,
    })
  }

  return feed
}
