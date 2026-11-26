"use client"

import React from "react"
import { Sparkles } from "lucide-react"

export interface ConversationSystemEventProps {
  content: string
}

function ConversationSystemEventComponent({ content }: ConversationSystemEventProps) {
  return (
    <div className="flex justify-center my-2.5">
      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white text-ellevee-text-secondary border border-ellevee-border shadow-2xs max-w-md text-center">
        <Sparkles className="h-3.5 w-3.5 text-ellevee-purple shrink-0" />
        <span>{content}</span>
      </div>
    </div>
  )
}

export const ConversationSystemEvent = React.memo(ConversationSystemEventComponent)
ConversationSystemEvent.displayName = "ConversationSystemEvent"

export interface ConversationDayDividerProps {
  label: string
}

function ConversationDayDividerComponent({ label }: ConversationDayDividerProps) {
  return (
    <div className="flex justify-center py-1">
      <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-ellevee-text-secondary bg-white border border-ellevee-border rounded-full px-3 py-0.5 shadow-2xs">
        {label}
      </span>
    </div>
  )
}

export const ConversationDayDivider = React.memo(ConversationDayDividerComponent)
ConversationDayDivider.displayName = "ConversationDayDivider"
