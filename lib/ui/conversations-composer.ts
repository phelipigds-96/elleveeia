import type { MessageData, QuickReply } from "@/app/(dashboard)/conversations/actions"

export type ComposerSendMode = "whatsapp" | "note"
export type ComposerMediaType = "image" | "audio" | "document"
export type ComposerSubmitIntent =
  | "send_note"
  | "send_attachment"
  | "send_text"
  | "stop_send_audio"
  | "noop"

export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024

export function formatRecordingTime(secs: number): string {
  const safe = Number.isFinite(secs) && secs > 0 ? Math.floor(secs) : 0
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s < 10 ? "0" : ""}${s}`
}

export function validateAttachmentFile(file: {
  name: string
  size: number
  type: string
}): { ok: true; mediaType: ComposerMediaType } | { ok: false; error: string } {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      error: "O tamanho máximo permitido é de 20MB.",
    }
  }

  const mediaType: ComposerMediaType = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("audio/")
    ? "audio"
    : "document"

  return { ok: true, mediaType }
}

/**
 * Determina a intenção de envio preservando o isolamento estrito de Nota Interna:
 * em modo "note", NUNCA dispara envio de anexo, texto WhatsApp ou áudio externo.
 */
export function resolveComposerSubmitIntent(params: {
  sendMode: ComposerSendMode
  inputContent: string
  hasSelectedFile: boolean
  isRecording: boolean
}): ComposerSubmitIntent {
  const hasText = params.inputContent.trim().length > 0

  if (params.sendMode === "note") {
    return hasText ? "send_note" : "noop"
  }
  if (params.hasSelectedFile) {
    return "send_attachment"
  }
  if (hasText) {
    return "send_text"
  }
  if (params.isRecording) {
    return "stop_send_audio"
  }
  return "noop"
}

export function filterSlashQuickReplies(
  quickReplies: QuickReply[],
  inputContent: string,
  limit = 5
): QuickReply[] {
  if (!inputContent.startsWith("/")) return []
  const query = inputContent.slice(1).trim().toLowerCase()

  return quickReplies
    .filter((q) => {
      if (!q.isActive) return false
      if (!query) return true
      const byShortcut = Boolean(q.shortcut && q.shortcut.toLowerCase().includes(query))
      const byTitle = q.title.toLowerCase().includes(query)
      return byShortcut || byTitle
    })
    .slice(0, limit)
}

export function findExactSlashQuickReply(
  quickReplies: QuickReply[],
  inputContent: string
): QuickReply | null {
  if (!inputContent.startsWith("/")) return null
  const query = inputContent.slice(1).trim().toLowerCase()
  if (!query) return null

  return (
    quickReplies.find(
      (q) => q.isActive && Boolean(q.shortcut) && q.shortcut!.toLowerCase() === query
    ) || null
  )
}

export function extractQuickReplyCategories(quickReplies: QuickReply[]): string[] {
  return Array.from(new Set(quickReplies.map((q) => q.category).filter(Boolean)))
}

export function filterModalQuickReplies(
  quickReplies: QuickReply[],
  search: string,
  category: string
): QuickReply[] {
  const normalizedSearch = search.trim().toLowerCase()
  const normalizedCategory = category.toLowerCase()

  return quickReplies.filter((q) => {
    if (!q.isActive) return false
    const matchSearch =
      !normalizedSearch ||
      q.title.toLowerCase().includes(normalizedSearch) ||
      q.content.toLowerCase().includes(normalizedSearch) ||
      Boolean(q.shortcut && q.shortcut.toLowerCase().includes(normalizedSearch))
    const matchCat =
      category === "TODAS" || q.category.toLowerCase() === normalizedCategory
    return matchSearch && matchCat
  })
}

/**
 * Reconcilia uma mensagem otimista após confirmação (mesmo tardia pós-timeout)
 * garantindo ausência de duplicidade caso o Realtime já tenha entregue o registro definitivo.
 */
export function reconcileOptimisticMessage(
  messages: MessageData[],
  tempId: string,
  confirmedId: string | undefined,
  metadataPatch: Record<string, unknown>
): MessageData[] {
  const finalId = confirmedId || tempId
  const alreadyHasConfirmed = Boolean(
    confirmedId && confirmedId !== tempId && messages.some((m) => m.id === confirmedId)
  )

  if (alreadyHasConfirmed) {
    return messages
      .filter((m) => m.id !== tempId)
      .map((m) =>
        m.id === confirmedId
          ? {
              ...m,
              metadata: {
                ...m.metadata,
                ...metadataPatch,
              },
            }
          : m
      )
  }

  return messages.map((m) =>
    m.id === tempId
      ? {
          ...m,
          id: finalId,
          metadata: {
            ...m.metadata,
            ...metadataPatch,
          },
        }
      : m
  )
}

/**
 * Mescla uma mensagem recebida via Realtime eliminando qualquer duplicata otimista
 * por `client_message_id`, por `id` já presente ou por conteúdo idêntico em `temp-*`.
 */
export function mergeRealtimeInsertedMessage(
  messages: MessageData[],
  incoming: MessageData
): MessageData[] {
  const incomingClientId =
    typeof incoming.metadata?.client_message_id === "string"
      ? incoming.metadata.client_message_id
      : null

  const filtered = messages.filter((m) => {
    if (!m.id.startsWith("temp-")) return true
    const tempClientId =
      typeof m.metadata?.client_message_id === "string" ? m.metadata.client_message_id : null
    if (incomingClientId && tempClientId && incomingClientId === tempClientId) {
      return false
    }
    if (m.content === incoming.content) {
      return false
    }
    return true
  })

  if (filtered.some((m) => m.id === incoming.id)) {
    return filtered.map((m) => (m.id === incoming.id ? { ...m, ...incoming } : m))
  }

  return [...filtered, incoming]
}

/**
 * Protege o histórico contra respostas de rede fora de ordem em trocas rápidas (incluindo A → B → A).
 */
export function isStaleConversationLoad(params: {
  activeConversationId: string | null
  requestConversationId: string
  activeSeq: number
  requestSeq: number
}): boolean {
  return (
    params.activeConversationId !== params.requestConversationId ||
    params.activeSeq !== params.requestSeq
  )
}

export interface AudioRecorderResourceRefs {
  timerRef: { current: ReturnType<typeof setInterval> | null }
  recorderRef: { current: MediaRecorder | null }
  streamRef: { current: MediaStream | null }
  chunksRef: { current: Blob[] }
}

/**
 * Libera determinísticamente timer, MediaRecorder e todas as tracks de microfone
 * em cancelamento, erro, interrupção ou desmontagem (troca de conversa).
 */
export function releaseAudioRecorderResources(refs: AudioRecorderResourceRefs): void {
  if (refs.timerRef.current) {
    clearInterval(refs.timerRef.current)
    refs.timerRef.current = null
  }

  if (refs.recorderRef.current && refs.recorderRef.current.state !== "inactive") {
    try {
      refs.recorderRef.current.onstop = null
      refs.recorderRef.current.ondataavailable = null
      refs.recorderRef.current.stop()
    } catch {
      // Silencioso ao encerrar gravador já parado
    }
  }
  refs.recorderRef.current = null

  if (refs.streamRef.current) {
    refs.streamRef.current.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // Track já encerrada
      }
    })
    refs.streamRef.current = null
  }

  refs.chunksRef.current = []
}
