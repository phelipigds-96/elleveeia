"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Info, Lock, Paperclip, RotateCcw, X } from "lucide-react"
import { toast } from "@/components/ui/toast"
import type { QuickReply } from "../actions"
import { COMPOSER_MAX_HEIGHT_PX } from "@/lib/ui/conversations-viewport"
import {
  type ComposerSendMode,
  findExactSlashQuickReply,
  releaseAudioRecorderResources,
  resolveComposerSubmitIntent,
  validateAttachmentFile,
} from "@/lib/ui/conversations-composer"
import { ConversationAudioRecorder } from "./conversation-audio-recorder"
import {
  ConversationComposerLeadingActions,
  ConversationComposerSubmitAction,
} from "./conversation-composer-actions"
import {
  ConversationQuickRepliesModal,
  ConversationSlashQuickReplies,
} from "./conversation-quick-replies"

export interface ConversationComposerProps {
  conversationId: string
  conversationStatus?: string | null
  quickReplies: QuickReply[]
  quickReplyListMaxHeight: number
  isSending: boolean
  isSendingInternalNote: boolean
  isUploadingMedia: boolean
  isUploadingAudio: boolean
  isReopening: boolean
  onComposerFocus: () => void
  onReopen: () => void
  onSendText: (conversationId: string, text: string) => Promise<boolean>
  onSendInternalNote: (conversationId: string, text: string) => Promise<boolean>
  onSendAttachment: (
    conversationId: string,
    file: File,
    caption: string,
    previewUrl: string | null
  ) => Promise<boolean>
  onSendAudio: (
    conversationId: string,
    audioBlob: Blob,
    mimeType: string
  ) => Promise<boolean>
}

function ConversationComposerComponent({
  conversationId,
  conversationStatus,
  quickReplies,
  quickReplyListMaxHeight,
  isSending,
  isSendingInternalNote,
  isUploadingMedia,
  isUploadingAudio,
  isReopening,
  onComposerFocus,
  onReopen,
  onSendText,
  onSendInternalNote,
  onSendAttachment,
  onSendAudio,
}: ConversationComposerProps) {
  const [inputContent, setInputContent] = useState("")
  const [sendMode, setSendMode] = useState<ComposerSendMode>("whatsapp")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [isQuickRepliesOpen, setIsQuickRepliesOpen] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const filePreviewUrlRef = useRef<string | null>(null)
  const submitGuardRef = useRef(false)

  const isBusy = isSending || isSendingInternalNote || isUploadingMedia || isUploadingAudio

  useEffect(() => {
    filePreviewUrlRef.current = filePreviewUrl
  }, [filePreviewUrl])

  // Libera microfone, timer e ObjectURL ao desmontar ou trocar de conversa (key={conversationId})
  useEffect(() => {
    return () => {
      releaseAudioRecorderResources({
        timerRef: recordingTimerRef,
        recorderRef: mediaRecorderRef,
        streamRef: mediaStreamRef,
        chunksRef: audioChunksRef,
      })
      if (filePreviewUrlRef.current) {
        URL.revokeObjectURL(filePreviewUrlRef.current)
        filePreviewUrlRef.current = null
      }
    }
  }, [])

  const applyTextareaHeight = useCallback((value: string) => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    if (value) {
      el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
    }
  }, [])

  const handleInputContentChange = useCallback(
    (value: string) => {
      setInputContent(value)
      applyTextareaHeight(value)
    },
    [applyTextareaHeight]
  )

  const handleClearSelectedFile = useCallback((revokePreview = true) => {
    if (revokePreview && filePreviewUrlRef.current) {
      URL.revokeObjectURL(filePreviewUrlRef.current)
      filePreviewUrlRef.current = null
    }
    setSelectedFile(null)
    setFilePreviewUrl(null)
  }, [])

  const handleCancelRecording = useCallback(() => {
    releaseAudioRecorderResources({
      timerRef: recordingTimerRef,
      recorderRef: mediaRecorderRef,
      streamRef: mediaStreamRef,
      chunksRef: audioChunksRef,
    })
    setIsRecording(false)
    setRecordingSeconds(0)
  }, [])

  const handleSwitchMode = useCallback(
    (nextMode: ComposerSendMode) => {
      setSendMode(nextMode)
      if (nextMode === "note") {
        // Garante isolamento: ao entrar em Nota Interna, descarta anexo/gravação externa pendente
        handleClearSelectedFile(true)
        handleCancelRecording()
      }
    },
    [handleCancelRecording, handleClearSelectedFile]
  )

  const handleTriggerFileSelect = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validation = validateAttachmentFile(file)
    if (!validation.ok) {
      toast.error("Arquivo muito grande", validation.error)
      e.target.value = ""
      return
    }

    if (filePreviewUrlRef.current) {
      URL.revokeObjectURL(filePreviewUrlRef.current)
      filePreviewUrlRef.current = null
    }

    setSelectedFile(file)
    if (validation.mediaType === "image") {
      const url = URL.createObjectURL(file)
      filePreviewUrlRef.current = url
      setFilePreviewUrl(url)
    } else {
      setFilePreviewUrl(null)
    }

    e.target.value = ""
  }, [])

  const handleStartRecording = useCallback(async () => {
    if (isRecording || isBusy || sendMode === "note") return

    if (!navigator?.mediaDevices?.getUserMedia) {
      toast.error(
        "Microfone não suportado",
        "Seu navegador não possui suporte para gravação de áudio."
      )
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      let mimeType = "audio/webm;codecs=opus"
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
          mimeType = "audio/ogg;codecs=opus"
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4"
        } else {
          mimeType = ""
        }
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.start(200)
      setIsRecording(true)
      setRecordingSeconds(0)

      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      console.error("[AudioRecord] Erro ao acessar microfone:", err)
      releaseAudioRecorderResources({
        timerRef: recordingTimerRef,
        recorderRef: mediaRecorderRef,
        streamRef: mediaStreamRef,
        chunksRef: audioChunksRef,
      })
      toast.error(
        "Permissão de Microfone",
        "Não foi possível acessar seu microfone. Verifique as permissões."
      )
    }
  }, [isBusy, isRecording, sendMode])

  const handleStopAndSendRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || isUploadingAudio || submitGuardRef.current) return
    submitGuardRef.current = true

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }

    const recorder = mediaRecorderRef.current
    const stream = mediaStreamRef.current
    setIsRecording(false)

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || "audio/webm"
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        resolve(audioBlob)
      }
    })

    if (recorder.state !== "inactive") {
      recorder.stop()
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    mediaRecorderRef.current = null

    try {
      const audioBlob = await stopPromise
      audioChunksRef.current = []
      setRecordingSeconds(0)
      await onSendAudio(conversationId, audioBlob, recorder.mimeType || "audio/webm")
    } finally {
      submitGuardRef.current = false
    }
  }, [conversationId, isUploadingAudio, onSendAudio])

  const executeSubmit = useCallback(async () => {
    if (isBusy || submitGuardRef.current) return

    const intent = resolveComposerSubmitIntent({
      sendMode,
      inputContent,
      hasSelectedFile: Boolean(selectedFile),
      isRecording,
    })

    if (intent === "noop") return

    if (intent === "stop_send_audio") {
      await handleStopAndSendRecording()
      return
    }

    submitGuardRef.current = true
    try {
      if (intent === "send_note") {
        const trimmed = inputContent.trim()
        const ok = await onSendInternalNote(conversationId, trimmed)
        if (ok) {
          handleInputContentChange("")
        }
        return
      }

      if (intent === "send_attachment" && selectedFile) {
        const fileToSend = selectedFile
        const caption = inputContent.trim()
        const preview = filePreviewUrlRef.current
        // Não revoga o ObjectURL ainda porque o feed usa a prévia otimista até a URL remota voltar
        handleClearSelectedFile(false)
        handleInputContentChange("")
        await onSendAttachment(conversationId, fileToSend, caption, preview)
        textareaRef.current?.focus()
        return
      }

      if (intent === "send_text") {
        const trimmed = inputContent.trim()
        handleInputContentChange("")
        await onSendText(conversationId, trimmed)
        textareaRef.current?.focus()
      }
    } finally {
      submitGuardRef.current = false
    }
  }, [
    conversationId,
    handleClearSelectedFile,
    handleInputContentChange,
    handleStopAndSendRecording,
    inputContent,
    isBusy,
    isRecording,
    onSendAttachment,
    onSendInternalNote,
    onSendText,
    selectedFile,
    sendMode,
  ])

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      void executeSubmit()
    },
    [executeSubmit]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        const matched = findExactSlashQuickReply(quickReplies, inputContent)
        if (matched) {
          e.preventDefault()
          handleInputContentChange(matched.content)
          return
        }

        e.preventDefault()
        void executeSubmit()
      }
    },
    [executeSubmit, handleInputContentChange, inputContent, quickReplies]
  )

  const handleSelectSlashReply = useCallback(
    (content: string) => {
      handleInputContentChange(content)
      textareaRef.current?.focus()
    },
    [handleInputContentChange]
  )

  const handleSelectModalReply = useCallback(
    (content: string) => {
      setInputContent((prev) => {
        const next = prev ? `${prev}\n${content}` : content
        window.requestAnimationFrame(() => applyTextareaHeight(next))
        return next
      })
      window.setTimeout(() => textareaRef.current?.focus(), 100)
    },
    [applyTextareaHeight]
  )

  const handleOpenQuickReplies = useCallback(() => {
    setIsQuickRepliesOpen(true)
  }, [])

  const handleCloseQuickReplies = useCallback(() => {
    setIsQuickRepliesOpen(false)
  }, [])

  if (conversationStatus === "closed") {
    return (
      <footer className="border-t border-ellevee-border px-4 sm:px-6 py-3 sm:py-4 bg-white shrink-0 z-20 flex items-center justify-between gap-3 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 text-ellevee-text-secondary">
          <CheckCircle2 className="h-4 w-4 text-ellevee-text-muted shrink-0" />
          <span className="text-xs sm:text-sm font-semibold text-ellevee-deep-ink">
            Este atendimento foi finalizado.
          </span>
          <span className="text-xs text-ellevee-text-secondary hidden sm:inline">
            O histórico está preservado.
          </span>
        </div>

        <button
          type="button"
          onClick={onReopen}
          disabled={isReopening}
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3.5 py-1.5 rounded-full text-xs font-semibold bg-ellevee-deep-ink hover:bg-black text-white transition-colors cursor-pointer disabled:opacity-50 shadow-2xs focus-ring shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{isReopening ? "Reabrindo..." : "Reabrir Atendimento"}</span>
        </button>
      </footer>
    )
  }

  return (
    <>
      <footer className="p-2 px-2.5 sm:px-5 sm:py-3 bg-white border-t border-ellevee-border shrink-0 z-20 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div
          className={`max-w-4xl mx-auto rounded-2xl border p-2 space-y-2 transition-colors ${
            sendMode === "note"
              ? "bg-note-bg border-note-border-strong"
              : "bg-ellevee-stone-subtle border-ellevee-border focus-within:bg-white focus-within:border-ellevee-blue/60"
          }`}
        >
          {/* Modo: Mensagem WhatsApp vs Nota Interna */}
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSwitchMode("whatsapp")}
                className={`min-h-[36px] sm:min-h-[28px] inline-flex items-center text-[11px] font-semibold px-3 py-1 sm:py-0.5 rounded-full transition-colors cursor-pointer ${
                  sendMode === "whatsapp"
                    ? "bg-ellevee-deep-ink text-white shadow-2xs"
                    : "bg-white text-ellevee-text-secondary hover:text-ellevee-deep-ink border border-ellevee-border"
                }`}
              >
                Mensagem WhatsApp
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode("note")}
                className={`min-h-[36px] sm:min-h-[28px] inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1 sm:py-0.5 rounded-full transition-colors cursor-pointer ${
                  sendMode === "note"
                    ? "bg-note-accent text-white shadow-2xs"
                    : "bg-white text-ellevee-text-secondary hover:text-note-strong border border-ellevee-border"
                }`}
              >
                <Lock className="h-3 w-3" />
                <span>Nota Interna</span>
              </button>
            </div>

            {sendMode === "note" ? (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-note-strong whitespace-nowrap">
                <Lock className="h-3 w-3 text-note-accent shrink-0" />
                <span>Privada · não enviada ao cliente</span>
              </span>
            ) : (
              conversationStatus === "open" && (
                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-ellevee-purple whitespace-nowrap">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  <span>Ao enviar, a IA pausa</span>
                </span>
              )
            )}
          </div>

          {/* Input Oculto de Arquivo */}
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleFileSelect}
          />

          {/* Barra de Pré-visualização de Anexo Selecionado */}
          {selectedFile && sendMode === "whatsapp" && (
            <div className="flex items-center justify-between p-2 bg-white rounded-xl border border-ellevee-border shadow-2xs">
              <div className="flex items-center gap-2.5 min-w-0">
                {filePreviewUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={filePreviewUrl}
                    alt="Pré-visualização"
                    className="h-10 w-10 object-cover rounded-md border border-ellevee-border shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-ellevee-blue/10 text-ellevee-blue flex items-center justify-center shrink-0">
                    <Paperclip className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ellevee-deep-ink truncate max-w-xs">
                    {selectedFile.name}
                  </p>
                  <p className="text-[11px] text-ellevee-text-secondary font-mono">
                    {(selectedFile.size / 1024).toFixed(0)} KB
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleClearSelectedFile(true)}
                className="h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center hover:bg-ellevee-stone-subtle text-ellevee-text-muted hover:text-ellevee-deep-ink rounded-full transition-colors shrink-0 cursor-pointer"
                title="Remover anexo"
                aria-label="Remover anexo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Modo de Gravação de Áudio Ativo vs Formulário de Mensagem */}
          {isRecording ? (
            <ConversationAudioRecorder
              recordingSeconds={recordingSeconds}
              isUploadingAudio={isUploadingAudio}
              onCancel={handleCancelRecording}
              onStopAndSend={() => {
                void handleStopAndSendRecording()
              }}
            />
          ) : (
            <form onSubmit={handleFormSubmit} className="flex items-end gap-1 sm:gap-2">
              <ConversationComposerLeadingActions
                sendMode={sendMode}
                isBusy={isBusy}
                onTriggerFileSelect={handleTriggerFileSelect}
                onOpenQuickReplies={handleOpenQuickReplies}
              />

              {/* Input de Mensagem + Sugestões / */}
              <div className="flex-1 min-w-0 relative">
                <ConversationSlashQuickReplies
                  quickReplies={quickReplies}
                  inputContent={inputContent}
                  maxHeightPx={quickReplyListMaxHeight}
                  onSelect={handleSelectSlashReply}
                />
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputContent}
                  onChange={(e) => handleInputContentChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={onComposerFocus}
                  disabled={isBusy}
                  placeholder={
                    selectedFile
                      ? "Adicionar legenda..."
                      : sendMode === "note"
                      ? "Escreva uma nota interna para a equipe..."
                      : "Escreva sua mensagem ou digite / para atalhos..."
                  }
                  aria-label={
                    sendMode === "note"
                      ? "Escrever nota interna"
                      : "Escrever mensagem para o cliente"
                  }
                  className={`w-full resize-none rounded-xl px-3.5 py-2 text-[16px] sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-muted focus:outline-none min-h-[42px] sm:min-h-[38px] max-h-[112px] disabled:opacity-50 overflow-y-auto scroll-slim transition-all block ${
                    sendMode === "note"
                      ? "bg-white/90 border border-note-border-strong focus:border-note-focus"
                      : "bg-white border border-ellevee-border focus:border-ellevee-blue"
                  }`}
                />
              </div>

              <ConversationComposerSubmitAction
                sendMode={sendMode}
                hasSelectedFile={Boolean(selectedFile)}
                hasText={inputContent.trim().length > 0}
                isBusy={isBusy}
                isUploadingAudio={isUploadingAudio}
                onStartRecording={() => {
                  void handleStartRecording()
                }}
              />
            </form>
          )}
        </div>
      </footer>

      <ConversationQuickRepliesModal
        isOpen={isQuickRepliesOpen}
        quickReplies={quickReplies}
        onClose={handleCloseQuickReplies}
        onSelect={handleSelectModalReply}
      />
    </>
  )
}

export const ConversationComposer = React.memo(ConversationComposerComponent)
ConversationComposer.displayName = "ConversationComposer"
