"use client"

import React, { useMemo, useState } from "react"
import { Search, Sparkles, X, Zap } from "lucide-react"
import type { QuickReply } from "../actions"
import {
  extractQuickReplyCategories,
  filterModalQuickReplies,
  filterSlashQuickReplies,
} from "@/lib/ui/conversations-composer"

export interface ConversationSlashQuickRepliesProps {
  quickReplies: QuickReply[]
  inputContent: string
  maxHeightPx: number
  onSelect: (content: string) => void
}

function ConversationSlashQuickRepliesComponent({
  quickReplies,
  inputContent,
  maxHeightPx,
  onSelect,
}: ConversationSlashQuickRepliesProps) {
  const matches = useMemo(
    () => filterSlashQuickReplies(quickReplies, inputContent, 5),
    [quickReplies, inputContent]
  )

  if (!inputContent.startsWith("/")) return null

  return (
    <div
      role="listbox"
      aria-label="Sugestões de mensagens rápidas"
      className="absolute bottom-full left-0 mb-2 w-full sm:max-w-sm max-w-[calc(100vw-1rem)] bg-white rounded-xl border border-ellevee-border shadow-xl z-30 p-2 space-y-1"
    >
      <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-ellevee-text-muted uppercase tracking-wider border-b border-ellevee-border/70">
        <span>Mensagens Rápidas</span>
        <span>Enter para inserir</span>
      </div>
      <div
        className="overflow-y-auto overscroll-contain scroll-slim space-y-0.5"
        style={{ maxHeight: `${maxHeightPx}px` }}
      >
        {matches.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-ellevee-text-secondary italic">
            Nenhum atalho encontrado.
          </div>
        ) : (
          matches.map((qr) => (
            <button
              key={qr.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onSelect(qr.content)}
              className="w-full text-left min-h-[44px] sm:min-h-0 p-2 sm:p-1.5 rounded-lg hover:bg-[#F3EEFE] transition-colors flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="min-w-0">
                <span className="text-xs font-semibold text-ellevee-deep-ink block truncate">
                  {qr.title}
                </span>
                <span className="text-[11px] text-ellevee-text-secondary block truncate">
                  {qr.content}
                </span>
              </div>
              {qr.shortcut && (
                <span className="text-[10px] font-mono font-semibold bg-[#F3EEFE] text-ellevee-purple border border-ellevee-purple/20 px-1.5 py-0.5 rounded shrink-0">
                  /{qr.shortcut}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export const ConversationSlashQuickReplies = React.memo(ConversationSlashQuickRepliesComponent)
ConversationSlashQuickReplies.displayName = "ConversationSlashQuickReplies"

export interface ConversationQuickRepliesModalProps {
  isOpen: boolean
  quickReplies: QuickReply[]
  onClose: () => void
  onSelect: (content: string) => void
}

function ConversationQuickRepliesModalComponent({
  isOpen,
  quickReplies,
  onClose,
  onSelect,
}: ConversationQuickRepliesModalProps) {
  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("TODAS")

  const categories = useMemo(() => extractQuickReplyCategories(quickReplies), [quickReplies])
  const filteredReplies = useMemo(
    () => filterModalQuickReplies(quickReplies, search, selectedCategory),
    [quickReplies, search, selectedCategory]
  )
  const hasAnyActive = useMemo(() => quickReplies.some((q) => q.isActive), [quickReplies])

  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mensagens Rápidas"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-xl w-full max-h-[calc(var(--ellevee-vvh,100dvh)-1rem)] sm:max-h-[85dvh] flex flex-col p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl border border-ellevee-border space-y-3.5 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200">
        <div className="sm:hidden w-10 h-1 rounded-full bg-slate-200 mx-auto shrink-0" />
        <div className="flex items-start justify-between border-b border-ellevee-border pb-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-ellevee-purple" />
              <h3 className="text-base font-bold text-ellevee-deep-ink">Mensagens Rápidas</h3>
            </div>
            <p className="text-xs text-ellevee-text-secondary mt-1">
              Toque em uma mensagem para inserir instantaneamente no chat.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 sm:h-9 sm:w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Fechar mensagens rápidas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Busca & Filtro de Categorias */}
        <div className="space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por título, atalho (/pix) ou texto..."
              className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-ellevee-border rounded-lg text-[16px] sm:text-xs text-ellevee-deep-ink placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-ellevee-purple"
              autoFocus={typeof window !== "undefined" && window.innerWidth >= 640}
            />
          </div>

          {/* Categorias */}
          <div className="flex items-center gap-1.5 overflow-x-auto scroll-slim pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory("TODAS")}
              className={`text-[11px] px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-full font-medium transition-colors shrink-0 cursor-pointer ${
                selectedCategory === "TODAS"
                  ? "bg-ellevee-deep-ink text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Todas
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`text-[11px] px-3 py-1.5 sm:px-2.5 sm:py-1 rounded-full font-medium transition-colors shrink-0 cursor-pointer ${
                  selectedCategory.toLowerCase() === cat.toLowerCase()
                    ? "bg-ellevee-purple text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Lista de Respostas */}
        <div className="flex-1 min-h-0 max-h-80 sm:max-h-72 overflow-y-auto overscroll-contain scroll-slim space-y-2 pr-1">
          {filteredReplies.map((qr) => (
            <button
              key={qr.id}
              type="button"
              onClick={() => {
                onSelect(qr.content)
                onClose()
              }}
              className="w-full text-left p-3.5 sm:p-3 rounded-xl border border-ellevee-border hover:border-ellevee-purple/60 hover:bg-purple-50/30 active:bg-purple-50/60 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-ellevee-deep-ink group-hover:text-ellevee-purple transition-colors truncate">
                    {qr.title}
                  </span>
                  {qr.shortcut && (
                    <span className="text-[10px] font-mono font-semibold bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.2 rounded shrink-0">
                      /{qr.shortcut}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-medium shrink-0">
                  {qr.category}
                </span>
              </div>
              <p className="text-xs text-slate-600 font-sans whitespace-pre-wrap line-clamp-2 mt-1 leading-relaxed">
                {qr.content}
              </p>
            </button>
          ))}

          {!hasAnyActive && (
            <div className="p-8 text-center text-xs text-slate-400">
              Nenhuma mensagem rápida ativa disponível.
            </div>
          )}

          {hasAnyActive && filteredReplies.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">
              Nenhuma mensagem rápida encontrada para o filtro atual.
            </div>
          )}
        </div>

        {/* Dica de Atalho */}
        <div className="pt-2 border-t border-ellevee-border flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-purple-600 shrink-0" />
            <span>
              Dica: Digite{" "}
              <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[10px] border border-slate-200">
                /atalho
              </kbd>{" "}
              no chat.
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-slate-600 hover:bg-slate-100 font-medium shrink-0 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export const ConversationQuickRepliesModal = React.memo(ConversationQuickRepliesModalComponent)
ConversationQuickRepliesModal.displayName = "ConversationQuickRepliesModal"
