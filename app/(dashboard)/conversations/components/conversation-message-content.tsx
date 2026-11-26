"use client"

import React, { useEffect, useRef, useState } from "react"
import { FileText, Pause, Play } from "lucide-react"
import type { MessageData } from "../actions"
import type { ParsedCommercialQuote } from "@/lib/ui/conversations-quote-card"
import { resolveMessageMedia } from "@/lib/ui/conversations-messages"

function WhatsAppAudioPlayerComponent({
  src,
  isCustomer = false,
  isHuman = false,
}: {
  src: string
  isCustomer?: boolean
  isHuman?: boolean
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      if (audio.duration && !Number.isNaN(audio.duration) && Number.isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    audio.addEventListener("loadedmetadata", onLoadedMetadata)
    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("ended", onEnded)

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata)
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("ended", onEnded)
    }
  }, [src])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch((e) => {
          console.error("Audio playback error:", e)
        })
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value)
    setCurrentTime(time)
    if (audioRef.current) {
      audioRef.current.currentTime = time
    }
  }

  const formatSecs = (sec: number) => {
    if (Number.isNaN(sec) || !Number.isFinite(sec)) return "0:00"
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${s < 10 ? "0" : ""}${s}`
  }

  return (
    <div className="flex items-center gap-3 py-1.5 px-1 w-full min-w-[240px] max-w-[280px]">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 shadow-xs transition-transform active:scale-95 ${
          isHuman
            ? "bg-white text-ellevee-deep-ink hover:bg-ellevee-stone-subtle"
            : "bg-ellevee-deep-ink hover:bg-black text-white"
        }`}
        title={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
        aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isPlaying ? (
          <Pause
            className={`h-4 w-4 ${
              isHuman ? "fill-ellevee-deep-ink text-ellevee-deep-ink" : "fill-white text-white"
            }`}
          />
        ) : (
          <Play
            className={`h-4 w-4 ml-0.5 ${
              isHuman ? "fill-ellevee-deep-ink text-ellevee-deep-ink" : "fill-white text-white"
            }`}
          />
        )}
      </button>

      <div className="flex-1 flex flex-col justify-center min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          aria-label="Progresso do áudio"
          className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${
            isHuman ? "bg-white/25 accent-white" : "bg-ellevee-border accent-ellevee-blue"
          }`}
        />
        <div
          className={`flex justify-between items-center text-[11px] font-mono mt-1 font-medium ${
            isHuman
              ? "text-white/80"
              : isCustomer
              ? "text-ellevee-text-secondary"
              : "text-ellevee-text-secondary"
          }`}
        >
          <span>{formatSecs(currentTime)}</span>
          <span>{duration > 0 ? formatSecs(duration) : "--:--"}</span>
        </div>
      </div>
    </div>
  )
}

const WhatsAppAudioPlayer = React.memo(WhatsAppAudioPlayerComponent)

function MessageMediaBlock({
  message,
  isCustomer = false,
  isHuman = false,
  onOpenPreview,
}: {
  message: MessageData
  isCustomer?: boolean
  isHuman?: boolean
  onOpenPreview?: (url: string, fileName?: string) => void
}) {
  const media = resolveMessageMedia(message)
  if (!media) return null

  if (media.type === "image") {
    return (
      <div className="my-1.5 overflow-hidden rounded-lg">
        <button
          type="button"
          onClick={() => {
            if (onOpenPreview) {
              onOpenPreview(media.url, media.fileName)
            } else {
              window.open(media.url, "_blank", "noopener,noreferrer")
            }
          }}
          className="block group/img cursor-zoom-in text-left focus:outline-none focus:ring-2 focus:ring-ellevee-blue/50 rounded-lg transition-transform active:scale-[0.99]"
          title="Clique para ampliar na tela"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={media.url}
            alt={media.fileName || "Imagem"}
            className="max-h-72 w-auto max-w-full rounded-lg object-cover transition-transform group-hover:scale-[1.01]"
            loading="lazy"
          />
        </button>
      </div>
    )
  }

  if (media.type === "audio") {
    return (
      <div className={`my-1 rounded-xl ${isHuman ? "bg-white/10" : "bg-black/5"}`}>
        <WhatsAppAudioPlayer src={media.url} isCustomer={isCustomer} isHuman={isHuman} />
      </div>
    )
  }

  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`my-1.5 p-2.5 rounded-lg flex items-center gap-3 transition-colors ${
        isHuman
          ? "bg-white/15 hover:bg-white/25 text-white"
          : isCustomer
          ? "bg-ellevee-stone-subtle hover:bg-ellevee-border/40 text-ellevee-deep-ink border border-ellevee-border"
          : "bg-white hover:bg-ellevee-stone-subtle text-ellevee-deep-ink border border-ellevee-border"
      }`}
    >
      <FileText className="h-6 w-6 text-red-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{media.fileName}</p>
        <p className="text-[10px] opacity-75">Documento • Clique para abrir</p>
      </div>
    </a>
  )
}

function CommercialQuoteCard({
  messageId,
  parsedQuote,
}: {
  messageId: string
  parsedQuote: ParsedCommercialQuote
}) {
  return (
    <div className="space-y-2">
      {parsedQuote.introText && (
        <p className="whitespace-pre-wrap leading-relaxed text-[13px]">{parsedQuote.introText}</p>
      )}

      {/* Cartão Comercial Estruturado (fiel à mensagem original, 2 linhas por produto) */}
      <div className="rounded-xl border border-ellevee-border bg-white text-ellevee-deep-ink overflow-hidden shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-ellevee-stone-subtle border-b border-ellevee-border">
          <span className="text-xs font-semibold text-ellevee-deep-ink flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-ellevee-blue shrink-0" />
            <span>Orçamento Comercial</span>
          </span>
          {(parsedQuote.validityLabel || parsedQuote.versionLabel) && (
            <span className="text-[11px] font-mono text-ellevee-text-secondary">
              {[
                parsedQuote.validityLabel ? `Validade: ${parsedQuote.validityLabel}` : null,
                parsedQuote.versionLabel,
              ]
                .filter(Boolean)
                .join(" • ")}
            </span>
          )}
        </div>

        <div className="divide-y divide-ellevee-border/70">
          {parsedQuote.items.map((item, idx) => (
            <div key={`${messageId}-qi-${idx}`} className="p-3 space-y-1.5">
              <p className="text-[13px] font-semibold leading-snug text-ellevee-deep-ink line-clamp-2 break-words">
                {item.indexLabel} {item.name}
              </p>
              {item.quantityLine && (
                <p className="text-[12px] text-ellevee-text-secondary leading-snug break-words">
                  Qtd: {item.quantityLine}
                </p>
              )}
              {item.isPending ? (
                item.pendingReason ? (
                  <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 leading-snug">
                    {item.pendingReason}
                  </p>
                ) : null
              ) : (
                (item.unitPriceLabel || item.subtotalLabel) && (
                  <div className="pt-1 border-t border-ellevee-border/60 flex flex-wrap items-baseline justify-between gap-1.5 text-[12px] font-mono">
                    {item.unitPriceLabel && (
                      <span className="text-ellevee-text-secondary">{item.unitPriceLabel}</span>
                    )}
                    {item.subtotalLabel && (
                      <span className="font-semibold text-ellevee-deep-ink">
                        Subtotal: {item.subtotalLabel}
                      </span>
                    )}
                  </div>
                )
              )}
            </div>
          ))}
        </div>

        {parsedQuote.warningText && (
          <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-amber-900 text-[12px] leading-snug">
            {parsedQuote.warningText}
          </div>
        )}

        <div className="px-3 py-2.5 bg-[#F4F8FE] border-t border-ellevee-blue/25 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ellevee-text-secondary">
            Total Confirmado
          </span>
          <span className="text-[15px] font-bold font-mono text-ellevee-deep-ink">
            {parsedQuote.totalLabel}
          </span>
        </div>

        {parsedQuote.footerNote && (
          <div className="px-3 py-2 bg-ellevee-stone-subtle/70 border-t border-ellevee-border text-[11px] text-ellevee-text-secondary leading-snug">
            {parsedQuote.footerNote}
          </div>
        )}
      </div>

      {parsedQuote.outroText && (
        <p className="whitespace-pre-wrap leading-relaxed text-[13px]">{parsedQuote.outroText}</p>
      )}
    </div>
  )
}

export interface ConversationMessageContentProps {
  message: MessageData
  displayContent: string | null
  parsedQuote: ParsedCommercialQuote | null
  isCustomer?: boolean
  isHuman?: boolean
  onOpenPreview?: (url: string, fileName?: string) => void
}

function ConversationMessageContentComponent({
  message,
  displayContent,
  parsedQuote,
  isCustomer = false,
  isHuman = false,
  onOpenPreview,
}: ConversationMessageContentProps) {
  return (
    <>
      <MessageMediaBlock
        message={message}
        isCustomer={isCustomer}
        isHuman={isHuman}
        onOpenPreview={onOpenPreview}
      />
      {parsedQuote ? (
        <CommercialQuoteCard messageId={message.id} parsedQuote={parsedQuote} />
      ) : (
        displayContent && <p className="whitespace-pre-wrap leading-relaxed">{displayContent}</p>
      )}
    </>
  )
}

export const ConversationMessageContent = React.memo(ConversationMessageContentComponent)
ConversationMessageContent.displayName = "ConversationMessageContent"
