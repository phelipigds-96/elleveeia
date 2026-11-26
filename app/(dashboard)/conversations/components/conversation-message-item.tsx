"use client"

import React, { useMemo } from "react"
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Lock,
  RotateCcw,
  Sparkles,
  User,
} from "lucide-react"
import type { MessageData } from "../actions"
import {
  parseCommercialQuoteText,
  resolveAiStatusDetail,
} from "@/lib/ui/conversations-quote-card"
import {
  classifyMessageAuthor,
  formatMessageTime,
  getMessageDisplayContent,
  isAudioMessage,
  resolveMessageDeliveryStatus,
} from "@/lib/ui/conversations-messages"
import { ConversationSystemEvent } from "./conversation-system-event"
import { ConversationMessageContent } from "./conversation-message-content"

function DeliveryStatusIndicator({
  message,
  isHuman,
}: {
  message: MessageData
  isHuman: boolean
}) {
  const status = resolveMessageDeliveryStatus(message)
  if (!status) return null

  switch (status) {
    case "pending":
      return (
        <span
          title="Pendente na fila da Outbox"
          className={isHuman ? "text-white/70" : "text-ellevee-text-muted"}
        >
          <Clock className="h-3 w-3 animate-spin" />
        </span>
      )
    case "sent":
      return (
        <span
          title="Enviado ao WhatsApp (Gateway)"
          className={isHuman ? "text-white/80" : "text-ellevee-text-secondary"}
        >
          <CheckCheck className="h-3 w-3 stroke-[2.5]" />
        </span>
      )
    case "delivered":
      return (
        <span
          title="Despacho aceito pelo gateway"
          className={isHuman ? "text-white/80" : "text-ellevee-text-secondary"}
        >
          <CheckCheck className="h-3 w-3 stroke-[2.5]" />
        </span>
      )
    case "read":
      return (
        <span
          title="Lido pelo cliente"
          className={isHuman ? "text-ellevee-cyan" : "text-ellevee-blue"}
        >
          <CheckCheck className="h-3 w-3 stroke-[2.5]" />
        </span>
      )
    case "failed":
      return (
        <span
          title="Falha no despacho do gateway"
          className={isHuman ? "text-rose-300" : "text-ellevee-danger"}
        >
          <AlertCircle className="h-3 w-3" />
        </span>
      )
    default:
      return (
        <span className={isHuman ? "text-white/80" : "text-ellevee-text-secondary"}>
          <Check className="h-3 w-3" />
        </span>
      )
  }
}

export interface ConversationMessageItemProps {
  message: MessageData
  contactName: string
  agentName?: string | null
  isCopied: boolean
  onCopy: (msgId: string, text: string) => void
  onOpenPreview: (url: string, fileName?: string) => void
  onRetryMessage?: (message: MessageData) => void
}

function ConversationMessageItemComponent({
  message,
  contactName,
  agentName,
  isCopied,
  onCopy,
  onOpenPreview,
  onRetryMessage,
}: ConversationMessageItemProps) {
  const authorKind = classifyMessageAuthor(message)
  const displayContent = useMemo(() => getMessageDisplayContent(message), [message])
  const parsedQuote = useMemo(() => {
    if (authorKind !== "ai" && authorKind !== "human") return null
    if (!displayContent) return null
    return parseCommercialQuoteText(displayContent)
  }, [authorKind, displayContent])

  // 1. Evento operacional do sistema (Takeover / Devolução / Encerramento / Reabertura)
  if (authorKind === "system") {
    return <ConversationSystemEvent content={message.content} />
  }

  // 2. Nota Interna da equipe (paleta semântica `note`, privacidade inequívoca)
  if (authorKind === "internal_note") {
    return (
      <div className="flex justify-center my-3">
        <div className="w-full max-w-xl bg-note-bg border border-note-border-strong rounded-xl p-3.5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-note-border pb-1.5 mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-note-strong">
              <Lock className="h-3.5 w-3.5 text-note-accent shrink-0" />
              <span>Nota Interna</span>
              <span className="font-normal text-note-accent">
                • {message.metadata?.operator_name || "Equipe"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/80 text-note-strong border border-note-border">
                Privada (somente equipe)
              </span>
              <span className="text-[11px] font-mono text-note-accent">
                {formatMessageTime(message.created_at)}
              </span>
            </div>
          </div>
          <p className="text-[13px] text-note-text whitespace-pre-wrap leading-relaxed">
            {message.content}
          </p>
        </div>
      </div>
    )
  }

  const audioBubbleWidth = isAudioMessage(message) ? "min-w-[230px] sm:min-w-[270px]" : ""

  // 3. Mensagem do Cliente (Branco + borda Ellevee, alinhada à esquerda)
  if (authorKind === "customer") {
    return (
      <div className="group flex flex-col items-start space-y-1">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[12px] font-medium text-ellevee-text-secondary">
            {contactName || "Cliente"}
          </span>
          {displayContent && (
            <button
              type="button"
              onClick={() => onCopy(message.id, displayContent)}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-1 text-[11px] text-ellevee-text-secondary hover:text-ellevee-deep-ink bg-white border border-ellevee-border rounded-md px-1.5 py-0.5 transition-opacity cursor-pointer"
              title="Copiar mensagem"
              aria-label="Copiar mensagem do cliente"
            >
              <Copy className="h-3 w-3" />
              <span>{isCopied ? "Copiada" : "Copiar"}</span>
            </button>
          )}
        </div>
        <div
          className={`max-w-[88%] sm:max-w-lg rounded-2xl rounded-tl-sm bg-white border border-ellevee-border px-3.5 py-2.5 text-[14px] leading-relaxed text-ellevee-deep-ink shadow-2xs transition-shadow duration-200 hover:shadow-card break-words ${audioBubbleWidth}`}
        >
          <ConversationMessageContent
            message={message}
            displayContent={displayContent}
            parsedQuote={null}
            isCustomer={true}
            isHuman={false}
            onOpenPreview={onOpenPreview}
          />
          <div className="flex justify-end items-center gap-1 mt-1 text-[11px] text-ellevee-text-secondary font-mono">
            <span>{formatMessageTime(message.created_at)}</span>
          </div>
        </div>
      </div>
    )
  }

  // 4. Mensagens de Saída: Atendente Humano (Deep Ink) vs Sofia IA (#F5F7FF + Roxo/Azul)
  const isHuman = authorKind === "human"
  const deliveryStatus = resolveMessageDeliveryStatus(message)
  const canRetry =
    deliveryStatus === "failed" &&
    Boolean(onRetryMessage) &&
    (message.message_type === "text" || !message.message_type)

  return (
    <div className="group flex flex-col items-end space-y-1">
      <div className="flex items-center gap-2 px-1">
        {displayContent && (
          <button
            type="button"
            onClick={() => onCopy(message.id, displayContent)}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-1 text-[11px] text-ellevee-text-secondary hover:text-ellevee-deep-ink bg-white border border-ellevee-border rounded-md px-1.5 py-0.5 transition-opacity cursor-pointer"
            title="Copiar mensagem"
            aria-label="Copiar mensagem enviada"
          >
            <Copy className="h-3 w-3" />
            <span>{isCopied ? "Copiada" : "Copiar"}</span>
          </button>
        )}
        <span className="text-[12px] flex items-center gap-1.5">
          {isHuman ? (
            <>
              <User className="h-3 w-3 text-ellevee-deep-ink" />
              <span className="text-ellevee-deep-ink font-semibold">
                {message.metadata?.operator_name || "Atendente"} · Humano
              </span>
            </>
          ) : (
            <>
              <Sparkles className="h-3 w-3 text-ellevee-purple" />
              <span className="text-ellevee-purple font-semibold">
                {resolveAiStatusDetail(agentName) || "Ellevee IA"}
              </span>
            </>
          )}
        </span>
      </div>

      <div
        className={`${
          parsedQuote ? "max-w-[94%] sm:max-w-lg w-full sm:w-auto" : "max-w-[88%] sm:max-w-lg"
        } rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[14px] leading-relaxed transition-shadow duration-200 hover:shadow-card break-words ${audioBubbleWidth} ${
          isHuman
            ? "bg-ellevee-deep-ink border border-ellevee-deep-ink text-white shadow-card"
            : "bg-[#F5F7FF] border border-ellevee-blue/25 text-ellevee-deep-ink shadow-2xs"
        }`}
      >
        <ConversationMessageContent
          message={message}
          displayContent={displayContent}
          parsedQuote={parsedQuote}
          isCustomer={false}
          isHuman={isHuman}
          onOpenPreview={onOpenPreview}
        />
        <div
          className={`flex justify-end items-center gap-1.5 mt-1.5 text-[11px] font-mono ${
            isHuman ? "text-white/75" : "text-ellevee-text-secondary"
          }`}
        >
          {canRetry && (
            <button
              type="button"
              onClick={() => onRetryMessage?.(message)}
              className={`inline-flex items-center gap-1 font-sans font-medium underline underline-offset-2 mr-1 cursor-pointer ${
                isHuman ? "text-rose-200 hover:text-white" : "text-ellevee-danger hover:opacity-80"
              }`}
              title="Reenviar mensagem que falhou"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Tentar novamente</span>
            </button>
          )}
          <span>{formatMessageTime(message.created_at)}</span>
          <DeliveryStatusIndicator message={message} isHuman={isHuman} />
        </div>
      </div>
    </div>
  )
}

export const ConversationMessageItem = React.memo(ConversationMessageItemComponent)
ConversationMessageItem.displayName = "ConversationMessageItem"
