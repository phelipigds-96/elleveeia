"use client"

import React from "react"
import { Bot, Loader2, RotateCcw, UserCheck } from "lucide-react"
import { resolveReturnToAiLabel } from "@/lib/ui/conversations-header"

export interface ConversationOwnershipControlsProps {
  status?: string | null
  agentName?: string | null
  isTakingOver: boolean
  isReturningToAI: boolean
  isReopening: boolean
  isLocked: boolean
  onTakeover: () => void
  onReturnToAI: () => void
  onReopen: () => void
}

function ConversationOwnershipControlsComponent({
  status,
  agentName,
  isTakingOver,
  isReturningToAI,
  isReopening,
  isLocked,
  onTakeover,
  onReturnToAI,
  onReopen,
}: ConversationOwnershipControlsProps) {
  if (status === "closed") {
    return (
      <button
        type="button"
        onClick={onReopen}
        disabled={isLocked}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-[34px] px-3 sm:px-3.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-all shadow-2xs active:scale-95 disabled:opacity-50 shrink-0"
        title="Reabrir conversa"
      >
        {isReopening ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" />
        )}
        <span>Reabrir</span>
      </button>
    )
  }

  if (status === "human") {
    const returnLabel = resolveReturnToAiLabel(agentName)
    return (
      <button
        type="button"
        onClick={onReturnToAI}
        disabled={isLocked}
        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-[34px] px-2.5 sm:px-3.5 rounded-full text-xs font-semibold bg-white text-ellevee-purple hover:bg-[#F3EEFE] border border-ellevee-border transition-all shadow-2xs active:scale-95 disabled:opacity-50 shrink-0"
        title={returnLabel}
      >
        {isReturningToAI ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-ellevee-purple" />
        )}
        <span className="sm:hidden">IA</span>
        <span className="hidden sm:inline xl:hidden">Devolver</span>
        <span className="hidden xl:inline">{returnLabel}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onTakeover}
      disabled={isLocked}
      className="inline-flex items-center justify-center gap-1.5 min-h-[44px] lg:min-h-[34px] px-3 sm:px-3.5 rounded-full text-xs font-semibold bg-ellevee-deep-ink text-white hover:bg-black active:scale-95 shadow-2xs transition-all disabled:opacity-50 shrink-0"
      title="Assumir conversa (pausar a IA e atender manualmente)"
    >
      {isTakingOver ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <UserCheck className="h-3.5 w-3.5 text-ellevee-cyan" />
      )}
      <span>Assumir</span>
    </button>
  )
}

export const ConversationOwnershipControls = React.memo(ConversationOwnershipControlsComponent)
ConversationOwnershipControls.displayName = "ConversationOwnershipControls"
