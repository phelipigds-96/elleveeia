"use client"

import React, { useState } from "react"
import { Loader2, Phone, Send, Sparkles, SquarePen, User, X } from "lucide-react"

export interface ConversationNewChatDialogProps {
  isOpen: boolean
  isStarting: boolean
  onClose: () => void
  onStartNewChat: (params: {
    phone: string
    name?: string
    initialMessage?: string
  }) => Promise<boolean>
}

function ConversationNewChatDialogComponent({
  isOpen,
  isStarting,
  onClose,
  onStartNewChat,
}: ConversationNewChatDialogProps) {
  const [phone, setPhone] = useState("")
  const [name, setName] = useState("")
  const [initialMessage, setInitialMessage] = useState("")

  if (!isOpen) return null

  const handleCancel = () => {
    if (isStarting) return
    setPhone("")
    setName("")
    setInitialMessage("")
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phone.trim() || isStarting) return
    const ok = await onStartNewChat({
      phone: phone.trim(),
      name: name.trim() || undefined,
      initialMessage: initialMessage.trim() || undefined,
    })
    if (ok) {
      setPhone("")
      setName("")
      setInitialMessage("")
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nova Conversa"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={handleCancel}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[calc(var(--ellevee-vvh,100dvh)-1rem)] sm:max-h-[90dvh] overflow-y-auto overscroll-contain scroll-slim shadow-2xl border border-gray-100 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-ellevee-border bg-ellevee-deep-ink text-white sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-full bg-white/10 text-ellevee-cyan">
              <SquarePen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Nova Conversa</h3>
              <p className="text-xs text-white/80">Envie uma mensagem pelo WhatsApp</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="h-11 w-11 lg:h-9 lg:w-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
            title="Fechar"
            aria-label="Fechar modal de nova conversa"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
              Telefone WhatsApp <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ellevee-text-muted" />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: 51 99999-9999 ou 5551999999999"
                className="w-full pl-9 pr-3 py-2 bg-ellevee-stone-subtle border border-ellevee-border rounded-lg text-[16px] sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-muted focus:outline-none focus:bg-white focus:ring-2 focus:ring-ellevee-blue/20 focus:border-ellevee-blue"
              />
            </div>
            <p className="text-[11px] text-ellevee-text-secondary mt-1">
              DDI +55 (Brasil) será aplicado automaticamente caso não informado.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
              Nome do Contato <span className="text-ellevee-text-muted font-normal">(opcional)</span>
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ellevee-text-muted" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Maria Silva"
                className="w-full pl-9 pr-3 py-2 bg-ellevee-stone-subtle border border-ellevee-border rounded-lg text-[16px] sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-muted focus:outline-none focus:bg-white focus:ring-2 focus:ring-ellevee-blue/20 focus:border-ellevee-blue"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
              Primeira Mensagem{" "}
              <span className="text-ellevee-text-muted font-normal">(opcional)</span>
            </label>
            <textarea
              rows={3}
              value={initialMessage}
              onChange={(e) => setInitialMessage(e.target.value)}
              placeholder="Olá! Como posso ajudar você hoje?"
              className="w-full p-3 bg-ellevee-stone-subtle border border-ellevee-border rounded-lg text-[16px] sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-muted focus:outline-none focus:bg-white focus:ring-2 focus:ring-ellevee-blue/20 focus:border-ellevee-blue resize-none"
            />
          </div>

          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              O atendimento será iniciado como <strong>Com operador (Com você)</strong>, garantindo
              que você converse diretamente sem interferência da IA.
            </span>
          </div>

          {/* Botões de Ação (>= 44px em mobile e tablet 768px) */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              disabled={isStarting}
              onClick={handleCancel}
              className="min-h-[44px] lg:min-h-[38px] px-4 py-2 text-sm text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-stone-subtle rounded-lg transition-colors font-medium cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isStarting || !phone.trim()}
              className="min-h-[44px] lg:min-h-[38px] px-5 py-2 text-sm bg-ellevee-deep-ink hover:bg-black text-white rounded-lg transition-colors font-medium flex items-center gap-2 shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isStarting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Iniciando...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Iniciar Conversa
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export const ConversationNewChatDialog = React.memo(ConversationNewChatDialogComponent)
ConversationNewChatDialog.displayName = "ConversationNewChatDialog"
