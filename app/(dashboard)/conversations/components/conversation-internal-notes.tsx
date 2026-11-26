"use client"

import React, { useRef, useState } from "react"
import { Loader2, Lock, StickyNote } from "lucide-react"
import type { MessageData } from "../actions"
import { formatMessageTime } from "@/lib/ui/conversations-messages"

export interface ConversationInternalNotesProps {
  conversationId: string
  internalNotes: MessageData[]
  isSavingQuickNote: boolean
  onCreateInternalNote: (conversationId: string, text: string) => Promise<boolean>
}

function ConversationInternalNotesComponent({
  conversationId,
  internalNotes,
  isSavingQuickNote,
  onCreateInternalNote,
}: ConversationInternalNotesProps) {
  const [noteContent, setNoteContent] = useState("")
  const submitGuardRef = useRef(false)

  const handleSubmitNote = async () => {
    const trimmed = noteContent.trim()
    if (!trimmed || isSavingQuickNote || submitGuardRef.current) return
    submitGuardRef.current = true
    try {
      const ok = await onCreateInternalNote(conversationId, trimmed)
      if (ok) {
        setNoteContent("")
      }
    } finally {
      submitGuardRef.current = false
    }
  }

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ellevee-text-secondary">
          <Lock className="h-3.5 w-3.5 text-note-accent shrink-0" />
          <span>Notas Internas da Equipe</span>
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-note-bg text-note-strong border border-note-border-strong shrink-0">
          Privada
        </span>
      </div>

      <div className="space-y-2">
        <textarea
          rows={3}
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          placeholder="Adicionar nota interna privada sobre este atendimento..."
          aria-label="Escrever nota rápida sobre este atendimento"
          className="w-full text-[16px] sm:text-xs px-3 py-2.5 rounded-lg border border-note-border-strong bg-note-bg text-note-text placeholder:text-note-accent/70 focus:outline-none focus:border-note-focus focus:ring-1 focus:ring-note-focus resize-none"
        />
        <button
          type="button"
          onClick={() => {
            void handleSubmitNote()
          }}
          disabled={isSavingQuickNote || !noteContent.trim()}
          className="w-full min-h-[44px] lg:min-h-[36px] rounded-lg bg-note-accent hover:bg-note-strong text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 focus-ring"
        >
          {isSavingQuickNote ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Registrando...</span>
            </>
          ) : (
            <>
              <StickyNote className="h-3.5 w-3.5" />
              <span>Adicionar Nota</span>
            </>
          )}
        </button>
      </div>

      <div className="space-y-2 pt-1">
        {internalNotes.length === 0 ? (
          <p className="text-xs text-ellevee-text-secondary italic text-center py-4">
            Nenhuma nota interna registrada nesta conversa.
          </p>
        ) : (
          internalNotes.map((n) => (
            <div
              key={n.id}
              className="p-3 rounded-xl bg-note-bg border border-note-border-strong text-xs text-note-text space-y-1.5"
            >
              <div className="flex items-center justify-between text-[11px] text-note-accent">
                <span className="font-semibold">{n.metadata?.operator_name || "Atendente"}</span>
                <span className="font-mono">{formatMessageTime(n.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{n.content}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export const ConversationInternalNotes = React.memo(ConversationInternalNotesComponent)
ConversationInternalNotes.displayName = "ConversationInternalNotes"
