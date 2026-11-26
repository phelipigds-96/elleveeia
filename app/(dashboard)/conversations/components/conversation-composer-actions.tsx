"use client"

import React from "react"
import { Loader2, Mic, Paperclip, Send, Zap } from "lucide-react"
import type { ComposerSendMode } from "@/lib/ui/conversations-composer"

export interface ConversationComposerLeadingActionsProps {
  sendMode: ComposerSendMode
  isBusy: boolean
  onTriggerFileSelect: () => void
  onOpenQuickReplies: () => void
}

function ConversationComposerLeadingActionsComponent({
  sendMode,
  isBusy,
  onTriggerFileSelect,
  onOpenQuickReplies,
}: ConversationComposerLeadingActionsProps) {
  const isNoteMode = sendMode === "note"

  return (
    <>
      <button
        type="button"
        onClick={onTriggerFileSelect}
        disabled={isBusy || isNoteMode}
        className="h-11 w-11 lg:h-9 lg:w-9 flex items-center justify-center text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-white rounded-full transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
        title={
          isNoteMode
            ? "Anexos disponíveis apenas no modo Mensagem WhatsApp"
            : "Anexar arquivo ou imagem"
        }
        aria-label="Anexar arquivo ou imagem"
      >
        <Paperclip className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={onOpenQuickReplies}
        disabled={isBusy}
        className="h-11 w-11 lg:h-9 lg:w-9 flex items-center justify-center text-ellevee-text-secondary hover:text-ellevee-purple hover:bg-[#F3EEFE] rounded-full transition-colors shrink-0 disabled:opacity-40 cursor-pointer"
        title="Mensagens rápidas (respostas prontas) ou digite /"
        aria-label="Mensagens rápidas"
      >
        <Zap className="h-5 w-5" />
      </button>
    </>
  )
}

export const ConversationComposerLeadingActions = React.memo(
  ConversationComposerLeadingActionsComponent
)
ConversationComposerLeadingActions.displayName = "ConversationComposerLeadingActions"

export interface ConversationComposerSubmitActionProps {
  sendMode: ComposerSendMode
  hasSelectedFile: boolean
  hasText: boolean
  isBusy: boolean
  isUploadingAudio: boolean
  onStartRecording: () => void
}

function ConversationComposerSubmitActionComponent({
  sendMode,
  hasSelectedFile,
  hasText,
  isBusy,
  isUploadingAudio,
  onStartRecording,
}: ConversationComposerSubmitActionProps) {
  const isNoteMode = sendMode === "note"
  const showSendButton = isNoteMode || hasSelectedFile || hasText

  if (showSendButton) {
    const canSubmit = isNoteMode ? hasText : hasSelectedFile || hasText
    return (
      <button
        type="submit"
        disabled={isBusy || !canSubmit}
        className={`h-11 w-11 lg:h-10 lg:w-10 rounded-full flex items-center justify-center text-white shadow-xs transition-transform active:scale-95 shrink-0 cursor-pointer ${
          isNoteMode ? "bg-note-accent hover:bg-note-strong" : "bg-ellevee-blue hover:bg-blue-700"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
        title={
          isNoteMode
            ? "Salvar nota interna"
            : hasSelectedFile
            ? "Enviar anexo"
            : "Enviar mensagem"
        }
        aria-label={
          isNoteMode
            ? "Salvar nota interna"
            : hasSelectedFile
            ? "Enviar anexo"
            : "Enviar mensagem"
        }
      >
        {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-4 w-4" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onStartRecording}
      disabled={isBusy}
      className="h-11 w-11 lg:h-10 lg:w-10 rounded-full flex items-center justify-center text-white bg-ellevee-deep-ink hover:bg-black shadow-xs transition-transform active:scale-95 shrink-0 disabled:opacity-40 cursor-pointer"
      title="Gravar mensagem de voz"
      aria-label="Gravar mensagem de voz"
    >
      {isUploadingAudio ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  )
}

export const ConversationComposerSubmitAction = React.memo(
  ConversationComposerSubmitActionComponent
)
ConversationComposerSubmitAction.displayName = "ConversationComposerSubmitAction"
