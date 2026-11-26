"use client"

import React from "react"
import { Loader2, Send, Trash2 } from "lucide-react"
import { formatRecordingTime } from "@/lib/ui/conversations-composer"

export interface ConversationAudioRecorderProps {
  recordingSeconds: number
  isUploadingAudio: boolean
  onCancel: () => void
  onStopAndSend: () => void
}

function ConversationAudioRecorderComponent({
  recordingSeconds,
  isUploadingAudio,
  onCancel,
  onStopAndSend,
}: ConversationAudioRecorderProps) {
  return (
    <div className="flex items-center justify-between gap-3 w-full bg-white px-4 py-2 rounded-xl border border-red-200 shadow-2xs">
      <div className="flex items-center gap-2.5">
        <span className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-semibold text-red-600 font-mono">
          {formatRecordingTime(recordingSeconds)}
        </span>
        <span className="text-xs text-ellevee-text-secondary italic hidden sm:inline">
          Gravando mensagem de voz...
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 w-11 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-full transition-colors cursor-pointer"
          title="Descartar gravação"
          aria-label="Descartar gravação"
        >
          <Trash2 className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onStopAndSend}
          disabled={isUploadingAudio}
          className="h-11 w-11 rounded-full bg-ellevee-blue hover:bg-blue-700 text-white flex items-center justify-center shadow-xs transition-transform active:scale-95 disabled:opacity-50 cursor-pointer"
          title="Enviar áudio gravado"
          aria-label="Enviar áudio gravado"
        >
          {isUploadingAudio ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  )
}

export const ConversationAudioRecorder = React.memo(ConversationAudioRecorderComponent)
ConversationAudioRecorder.displayName = "ConversationAudioRecorder"
