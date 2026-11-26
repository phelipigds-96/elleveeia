"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Tag,
  X,
} from "lucide-react"
import type { CloseReason, WorkflowStageOption } from "../actions"
import {
  canConfirmCloseConversation,
  getActiveCloseReasons,
  getCloseReasonDotClass,
} from "@/lib/ui/conversations-inspector"

export interface ConversationImageLightboxProps {
  previewImage: { url: string; fileName?: string } | null
  onClose: () => void
}

function ConversationImageLightboxComponent({
  previewImage,
  onClose,
}: ConversationImageLightboxProps) {
  useEffect(() => {
    if (!previewImage) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose, previewImage])

  if (!previewImage) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visualização ampliada de imagem"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Top Bar de Controles */}
      <div
        className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent text-white shrink-0 select-none z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-medium text-white/90 truncate max-w-xs md:max-w-md">
            {previewImage.fileName || "Imagem"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={previewImage.url}
            download={previewImage.fileName || "imagem"}
            target="_blank"
            rel="noopener noreferrer"
            className="h-11 w-11 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="Baixar imagem"
            aria-label="Baixar imagem"
          >
            <Download className="h-5 w-5" />
          </a>
          <a
            href={previewImage.url}
            target="_blank"
            rel="noopener noreferrer"
            className="h-11 w-11 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="Abrir imagem em nova aba"
            aria-label="Abrir imagem em nova aba"
          >
            <ExternalLink className="h-5 w-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors ml-1 cursor-pointer"
            title="Fechar (Esc)"
            aria-label="Fechar visualização de imagem"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Área Central com Imagem */}
      <div
        className="flex-1 flex items-center justify-center p-4 sm:p-8 min-h-0 overflow-auto"
        onClick={onClose}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewImage.url}
          alt={previewImage.fileName || "Visualização ampliada"}
          className="max-h-[85vh] max-w-[92vw] object-contain rounded-lg shadow-2xl transition-transform"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}

export const ConversationImageLightbox = React.memo(ConversationImageLightboxComponent)
ConversationImageLightbox.displayName = "ConversationImageLightbox"

export interface ConversationCloseDialogProps {
  isOpen: boolean
  closeReasons: CloseReason[]
  requireCloseReason: boolean
  isClosing: boolean
  onClose: () => void
  onConfirmClose: (reasonId?: string | null, notes?: string) => Promise<boolean>
}

function ConversationCloseDialogComponent({
  isOpen,
  closeReasons,
  requireCloseReason,
  isClosing,
  onClose,
  onConfirmClose,
}: ConversationCloseDialogProps) {
  const [selectedReasonId, setSelectedReasonId] = useState<string | null>(null)
  const [closeNotes, setCloseNotes] = useState("")

  const activeReasons = useMemo(() => getActiveCloseReasons(closeReasons), [closeReasons])

  if (!isOpen) return null

  const canConfirm = canConfirmCloseConversation({
    isClosing,
    requireCloseReason,
    selectedReasonId,
  })

  const handleCloseModal = () => {
    if (isClosing) return
    setSelectedReasonId(null)
    setCloseNotes("")
    onClose()
  }

  const handleConfirm = async () => {
    if (!canConfirm) return
    const ok = await onConfirmClose(selectedReasonId, closeNotes)
    if (ok) {
      setSelectedReasonId(null)
      setCloseNotes("")
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Finalizar Atendimento"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isClosing) handleCloseModal()
      }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[calc(var(--ellevee-vvh,100dvh)-1rem)] sm:max-h-[85dvh] flex flex-col p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl border border-ellevee-border space-y-4 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200">
        <div className="sm:hidden w-10 h-1 rounded-full bg-slate-200 mx-auto shrink-0" />
        <div className="flex items-start justify-between border-b border-ellevee-border pb-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-base font-bold text-ellevee-deep-ink">Finalizar Atendimento</h3>
              {activeReasons.length > 0 &&
                (requireCloseReason ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full">
                    Obrigatório
                  </span>
                ) : (
                  <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    Opcional
                  </span>
                ))}
            </div>
            <p className="text-xs text-ellevee-text-secondary mt-1">
              {activeReasons.length > 0
                ? "Selecione o motivo de conclusão para enriquecer as métricas operacionais e histórico do cliente."
                : "Confirme o encerramento deste atendimento. O histórico continuará preservado."}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="h-11 w-11 lg:h-9 lg:w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label="Fechar modal de encerramento"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Corpo rolável */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-slim space-y-4 pr-1">
          {(activeReasons.length > 0 || requireCloseReason) && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-ellevee-deep-ink">
                Motivo do Encerramento {requireCloseReason && <span className="text-rose-500">*</span>}
              </label>

              {activeReasons.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 text-center text-xs text-slate-500">
                  Nenhum motivo cadastrado pela administração.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {activeReasons.map((r) => {
                    const isSelected = selectedReasonId === r.id
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedReasonId(r.id)}
                        className={`w-full min-h-[44px] text-left p-3 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                          isSelected
                            ? "border-emerald-600 bg-emerald-50/50 shadow-2xs"
                            : "border-ellevee-border hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`h-3 w-3 rounded-full mt-0.5 shrink-0 ${getCloseReasonDotClass(
                            r.color
                          )}`}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-semibold text-ellevee-deep-ink block">
                            {r.title}
                          </span>
                          {r.description && (
                            <span className="text-[11px] text-ellevee-text-secondary line-clamp-1 mt-0.5">
                              {r.description}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Observações Opcionais */}
          <div>
            <label className="block text-xs font-semibold text-ellevee-deep-ink mb-1">
              Observações de Encerramento{" "}
              <span className="text-slate-400 font-normal">(opcional)</span>
            </label>
            <textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              rows={2}
              placeholder="Ex: Cliente fechou pedido de R$ 500, comprovante recebido..."
              className="w-full text-[16px] sm:text-xs p-2.5 rounded-xl border border-ellevee-border bg-slate-50/50 text-ellevee-deep-ink focus:outline-none focus:bg-white focus:ring-1 focus:ring-emerald-600 resize-none"
            />
          </div>
        </div>

        {/* Rodapé de Ações (>= 44px em mobile e tablet 768px) */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-ellevee-border shrink-0">
          <button
            type="button"
            onClick={handleCloseModal}
            disabled={isClosing}
            className="min-h-[44px] lg:min-h-[36px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-ellevee-deep-ink hover:bg-slate-100 rounded-xl lg:rounded-lg transition-colors cursor-pointer"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={() => {
              void handleConfirm()
            }}
            disabled={!canConfirm}
            className="min-h-[44px] lg:min-h-[36px] flex-1 sm:flex-initial justify-center px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl lg:rounded-lg transition-all flex items-center gap-1.5 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isClosing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Finalizando...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Confirmar Encerramento
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export const ConversationCloseDialog = React.memo(ConversationCloseDialogComponent)
ConversationCloseDialog.displayName = "ConversationCloseDialog"

export interface ConversationStageDialogProps {
  isOpen: boolean
  activeStageId?: string | null
  workflowStages: WorkflowStageOption[]
  isChangingStage: boolean
  onClose: () => void
  onSelectStage: (stageId: string) => void
}

function ConversationStageDialogComponent({
  isOpen,
  activeStageId,
  workflowStages,
  isChangingStage,
  onClose,
  onSelectStage,
}: ConversationStageDialogProps) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Etiquetas e Funil"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isChangingStage) onClose()
      }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full max-h-[calc(var(--ellevee-vvh,100dvh)-1rem)] sm:max-h-[85dvh] flex flex-col p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl border border-ellevee-border space-y-4 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200">
        <div className="sm:hidden w-10 h-1 rounded-full bg-slate-200 mx-auto shrink-0" />
        <div className="flex items-start justify-between border-b border-ellevee-border pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Tag className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-ellevee-deep-ink">Etiquetas e Funil</h3>
              <p className="text-xs text-ellevee-text-secondary mt-0.5">
                Selecione a etapa para categorizar este atendimento.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 lg:h-9 lg:w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-ellevee-deep-ink hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label="Fechar seletor de etiquetas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Lista de Etapas */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-slim space-y-2 py-1 pr-1">
          {workflowStages.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500 italic">
              Nenhuma etapa de funil encontrada para esta empresa.
            </div>
          ) : (
            workflowStages.map((st) => {
              const isSelected = activeStageId === st.id
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectStage(st.id)}
                  disabled={isChangingStage}
                  className={`w-full min-h-[44px] flex items-center justify-between p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500"
                      : "border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="h-3.5 w-3.5 rounded-full shrink-0 shadow-2xs"
                      style={{ backgroundColor: st.color || "#64748b" }}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isSelected ? "text-emerald-950" : "text-slate-800"
                        }`}
                      >
                        {st.name}
                      </p>
                      <p className="text-xs text-slate-500 capitalize">
                        {st.stage_type === "initial"
                          ? "Etapa inicial"
                          : st.stage_type === "final"
                          ? "Etapa de conclusão"
                          : "Em andamento"}
                      </p>
                    </div>
                  </div>
                  {isSelected ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full shrink-0">
                      <Check className="h-3 w-3" /> Atual
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Selecionar</span>
                  )}
                </button>
              )
            })
          )}
        </div>

        <div className="pt-2 border-t border-ellevee-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] lg:min-h-[34px] px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

export const ConversationStageDialog = React.memo(ConversationStageDialogComponent)
ConversationStageDialog.displayName = "ConversationStageDialog"
