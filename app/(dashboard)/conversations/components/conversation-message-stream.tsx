"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, MessageSquare } from "lucide-react"
import { toast } from "@/components/ui/toast"
import type { MessageData } from "../actions"
import { buildMessageFeedEntries } from "@/lib/ui/conversations-messages"
import { ConversationDayDivider } from "./conversation-system-event"
import { ConversationMessageItem } from "./conversation-message-item"

export interface ConversationMessageStreamProps {
  messages: MessageData[]
  loadingMessages: boolean
  contactName: string
  agentName?: string | null
  feedContainerRef: React.RefObject<HTMLElement | null>
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  onFeedScroll: () => void
  onOpenPreview: (url: string, fileName?: string) => void
  onRetryMessage?: (message: MessageData) => void
}

function ConversationMessageStreamComponent({
  messages,
  loadingMessages,
  contactName,
  agentName,
  feedContainerRef,
  messagesEndRef,
  onFeedScroll,
  onOpenPreview,
  onRetryMessage,
}: ConversationMessageStreamProps) {
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
        copyTimerRef.current = null
      }
    }
  }, [])

  const handleCopyMessage = useCallback(async (msgId: string, text: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMsgId(msgId)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        setCopiedMsgId((prev) => (prev === msgId ? null : prev))
      }, 1500)
    } catch {
      toast.error("Não foi possível copiar a mensagem")
    }
  }, [])

  const feedEntries = useMemo(() => buildMessageFeedEntries(messages), [messages])

  return (
    <section
      ref={feedContainerRef}
      onScroll={onFeedScroll}
      role="log"
      aria-live="polite"
      aria-label="Histórico da conversa"
      className="flex-1 basis-0 min-h-0 overflow-y-auto overscroll-contain scroll-slim p-3 sm:p-5 bg-ellevee-stone-subtle space-y-3"
    >
      <div className="max-w-4xl mx-auto space-y-3.5">
        {loadingMessages ? (
          <div className="flex flex-col items-center justify-center p-8 text-ellevee-ink-muted space-y-3">
            <Loader2 className="h-6 w-6 animate-spin text-ellevee-ink" />
            <p className="text-meta">Carregando histórico…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-white border border-ellevee-stone flex items-center justify-center">
              <MessageSquare className="h-5 w-5 stroke-1 text-ellevee-ink-muted" />
            </div>
            <p className="text-sm font-medium text-ellevee-ink">Nenhuma mensagem registrada</p>
            <p className="text-meta text-ellevee-ink-muted max-w-[280px] leading-relaxed">
              Esta conversa ainda não possui histórico. Envie a primeira mensagem para começar.
            </p>
          </div>
        ) : (
          feedEntries.map((entry) =>
            entry.kind === "divider" ? (
              <ConversationDayDivider key={entry.id} label={entry.label} />
            ) : (
              <ConversationMessageItem
                key={entry.id}
                message={entry.message}
                contactName={contactName}
                agentName={agentName}
                isCopied={copiedMsgId === entry.message.id}
                onCopy={handleCopyMessage}
                onOpenPreview={onOpenPreview}
                onRetryMessage={onRetryMessage}
              />
            )
          )
        )}
        <div ref={messagesEndRef} />
      </div>
    </section>
  )
}

export const ConversationMessageStream = React.memo(ConversationMessageStreamComponent)
ConversationMessageStream.displayName = "ConversationMessageStream"
