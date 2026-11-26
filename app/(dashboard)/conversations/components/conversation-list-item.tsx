"use client"

import React from "react"
import type { ConversationData } from "../actions"
import {
  StatusChip,
  resolveStatusView,
} from "@/components/conversations/conversation-status"
import { resolveAiStatusDetail } from "@/lib/ui/conversations-quote-card"
import {
  formatConversationTimeAgo,
  formatConversationWaitTime,
  getCustomerInitials,
  resolveConversationStageColor,
} from "@/lib/ui/conversations-list"

function WhatsAppChannelBadgeIcon({ className = "h-2 w-2" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 00-3.48-8.413Z" />
    </svg>
  )
}

export interface ConversationListItemProps {
  conversation: ConversationData
  isSelected: boolean
  isPulsing: boolean
  currentUserId?: string | null
  onSelect: (conversationId: string) => void
}

function ConversationListItemComponent({
  conversation: conv,
  isSelected,
  isPulsing,
  currentUserId,
  onSelect,
}: ConversationListItemProps) {
  const customerName = conv.customers?.name || "Cliente Desconhecido"
  const initials = getCustomerInitials(customerName)
  const isWaiting = conv.status === "human" && !conv.assigned_to

  const statusDetail = isWaiting
    ? `há ${formatConversationWaitTime(conv.last_message_at || conv.updated_at || conv.created_at)}`
    : conv.status === "human"
    ? conv.assigned_to === currentUserId
      ? "com você"
      : undefined
    : conv.status === "open"
    ? resolveAiStatusDetail(conv.agent_name)
    : undefined

  return (
    <button
      type="button"
      onClick={() => onSelect(conv.id)}
      aria-current={isSelected ? "true" : undefined}
      className={`conv-item focus-ring w-full text-left flex items-start gap-3 px-3 py-2.5 sm:p-3 rounded-xl transition-all relative cursor-pointer border ${
        isSelected
          ? "bg-[#F4F8FE] border-ellevee-blue/30 shadow-2xs"
          : "hover:bg-ellevee-stone-subtle border-transparent"
      } ${isPulsing ? "ring-2 ring-ellevee-blue/40 bg-[#F4F8FE]" : ""}`}
    >
      {/* Barra de seleção Fluent à esquerda */}
      {(isSelected || isWaiting) && (
        <span
          aria-hidden="true"
          className={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full ${
            isSelected ? "bg-ellevee-blue" : "bg-amber-500"
          }`}
        />
      )}

      {/* Avatar com Foto Real ou Iniciais + Selo WhatsApp */}
      <div className="relative shrink-0">
        {conv.customers?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Avatar externo dinâmico com fallback onError
          <img
            src={conv.customers.avatar_url}
            alt={customerName}
            referrerPolicy="no-referrer"
            className="h-10 w-10 rounded-full object-cover border border-ellevee-border"
            onError={(e) => {
              e.currentTarget.style.display = "none"
              if (e.currentTarget.nextElementSibling) {
                ;(e.currentTarget.nextElementSibling as HTMLElement).style.display = "flex"
              }
            }}
          />
        ) : null}
        <div
          className={`h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
            conv.customers?.avatar_url ? "hidden" : ""
          } ${
            isSelected
              ? "bg-ellevee-deep-ink text-white"
              : isWaiting
              ? "bg-amber-50 text-amber-800 border border-amber-300"
              : "bg-ellevee-warm-ivory text-ellevee-deep-ink border border-ellevee-border"
          }`}
        >
          {initials}
        </div>
        <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-ellevee-success text-white flex items-center justify-center shadow-xs ring-1 ring-white">
          <WhatsAppChannelBadgeIcon className="h-2 w-2" />
        </div>
      </div>

      {/* Informações da Conversa */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-semibold text-[14px] text-ellevee-deep-ink truncate">
            {customerName}
          </span>
          <span className="text-[11px] text-ellevee-text-secondary shrink-0 font-mono font-medium">
            {formatConversationTimeAgo(conv.last_message_at || conv.created_at)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-ellevee-text-secondary truncate leading-snug min-w-0">
            {conv.last_message_preview || "Nenhuma mensagem recente"}
          </p>

          {conv.unread_count > 0 && (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-ellevee-blue text-white text-[11px] font-bold flex items-center justify-center font-mono shrink-0 shadow-2xs">
              {conv.unread_count}
            </span>
          )}
        </div>

        {/* Etapa do funil */}
        {conv.workflow_stage_name ? (
          <div className="mt-1.5 flex items-center">
            <span
              title={`Etapa no funil: ${conv.workflow_stage_name}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-[11px] text-ellevee-deep-ink border border-ellevee-border font-medium max-w-full shadow-2xs"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: resolveConversationStageColor(conv) }}
              />
              <span className="truncate max-w-[175px]">{conv.workflow_stage_name}</span>
            </span>
          </div>
        ) : null}

        {/* Selo de status corporativo */}
        <div className="mt-1.5 text-[11px] leading-snug flex items-center gap-1.5 min-w-0">
          <StatusChip
            view={resolveStatusView(conv.status, !!conv.assigned_to)}
            detail={statusDetail}
          />
        </div>
      </div>
    </button>
  )
}

export const ConversationListItem = React.memo(ConversationListItemComponent)
ConversationListItem.displayName = "ConversationListItem"
