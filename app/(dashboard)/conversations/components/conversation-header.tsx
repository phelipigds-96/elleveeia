"use client"

import React from "react"
import { ArrowLeft, Check, ChevronDown, Loader2, Phone } from "lucide-react"
import type { WorkflowStageOption } from "../actions"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  formatConversationPhone,
  resolveHeaderOwnershipView,
} from "@/lib/ui/conversations-header"
import { ConversationHeaderActions } from "./conversation-header-actions"

function HeaderWhatsAppIcon({ className = "h-2.5 w-2.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 00-3.48-8.413Z" />
    </svg>
  )
}

export interface ConversationHeaderProps {
  contactName: string
  contactAvatarUrl?: string | null
  contactPhone?: string | null
  status?: string | null
  assignedTo?: string | null
  agentName?: string | null
  workflowStageId?: string | null
  workflowStageName?: string | null
  workflowStageColor: string
  workflowStages: WorkflowStageOption[]
  currentUserId?: string | null
  isProfileOpen: boolean
  internalNotesCount: number
  confirmClose: boolean
  isTakingOver: boolean
  isReturningToAI: boolean
  isClosing: boolean
  isReopening: boolean
  isChangingStage: boolean
  onBackToList: () => void
  onOpenProfile: () => void
  onOpenNotes: () => void
  onToggleInspector: () => void
  onOpenStageModal: () => void
  onChangeStage: (stageId: string) => void
  onTakeover: () => void
  onReturnToAI: () => void
  onRequestClose: () => void
  onOpenCloseModal: () => void
  onReopen: () => void
}

function ConversationHeaderComponent({
  contactName,
  contactAvatarUrl,
  contactPhone,
  status,
  assignedTo,
  agentName,
  workflowStageId,
  workflowStageName,
  workflowStageColor,
  workflowStages,
  currentUserId,
  isProfileOpen,
  internalNotesCount,
  confirmClose,
  isTakingOver,
  isReturningToAI,
  isClosing,
  isReopening,
  isChangingStage,
  onBackToList,
  onOpenProfile,
  onOpenNotes,
  onToggleInspector,
  onOpenStageModal,
  onChangeStage,
  onTakeover,
  onReturnToAI,
  onRequestClose,
  onOpenCloseModal,
  onReopen,
}: ConversationHeaderProps) {
  const displayName = contactName || "Cliente Desconhecido"
  const avatarInitials = (contactName || "C").slice(0, 2).toUpperCase()
  const ownership = resolveHeaderOwnershipView({
    status,
    assignedTo,
    currentUserId,
    agentName,
  })

  const ownershipToneClasses =
    ownership.tone === "human"
      ? { text: "font-semibold text-emerald-700", dot: "bg-emerald-500" }
      : ownership.tone === "waiting"
      ? { text: "font-semibold text-ellevee-warning-strong", dot: "bg-ellevee-warning" }
      : ownership.tone === "closed"
      ? { text: "font-medium text-ellevee-text-secondary", dot: "bg-ellevee-text-muted" }
      : { text: "font-semibold text-ellevee-purple", dot: "bg-ellevee-purple" }

  return (
    <header className="h-14 sm:h-16 border-b border-ellevee-border px-2.5 sm:px-5 flex items-center justify-between bg-white shrink-0 gap-2 sm:gap-3 z-10">
      {/* Lado Esquerdo: Voltar (mobile) + Avatar + Nome + Etapa/Status */}
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={onBackToList}
          className="lg:hidden inline-flex items-center justify-center h-11 w-11 -ml-1.5 rounded-full text-ellevee-deep-ink hover:bg-ellevee-stone-subtle focus-ring shrink-0"
          title="Voltar para a lista de conversas"
          aria-label="Voltar para a lista de conversas"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Avatar clicável para abrir Perfil */}
        <div
          className="relative shrink-0 cursor-pointer group"
          onClick={onOpenProfile}
          title="Abrir detalhes do cliente"
        >
          {contactAvatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Avatar externo dinâmico com fallback onError
            <img
              src={contactAvatarUrl}
              alt={contactName || "Cliente"}
              referrerPolicy="no-referrer"
              className="h-9 w-9 sm:h-10 sm:w-10 rounded-full object-cover border border-ellevee-border shadow-2xs group-hover:ring-2 group-hover:ring-ellevee-blue/30 transition-all"
              onError={(e) => {
                e.currentTarget.style.display = "none"
                if (e.currentTarget.nextElementSibling) {
                  ;(e.currentTarget.nextElementSibling as HTMLElement).style.display = "flex"
                }
              }}
            />
          ) : null}
          <div
            className={`h-9 w-9 sm:h-10 sm:w-10 rounded-full bg-ellevee-deep-ink text-white font-bold text-xs sm:text-sm flex items-center justify-center shrink-0 shadow-2xs group-hover:ring-2 group-hover:ring-ellevee-blue/30 transition-all ${
              contactAvatarUrl ? "hidden" : ""
            }`}
          >
            {avatarInitials}
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 sm:h-4 sm:w-4 rounded-full bg-ellevee-success text-white flex items-center justify-center shadow-xs ring-2 ring-white">
            <HeaderWhatsAppIcon className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
          </div>
        </div>

        {/* Nome e Metadados */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="font-semibold text-[15px] sm:text-base text-ellevee-deep-ink truncate hover:text-ellevee-blue cursor-pointer transition-colors min-w-0 flex-1 sm:flex-initial"
              onClick={onOpenProfile}
              title={displayName}
            >
              {displayName}
            </h2>

            {/* Etapa do Funil no Desktop */}
            <div className="hidden sm:inline-flex items-center">
              <DropdownMenu
                align="left"
                trigger={
                  <button
                    type="button"
                    disabled={isChangingStage}
                    title={
                      workflowStageName
                        ? `Etapa: ${workflowStageName} (clique para alterar)`
                        : "Definir etiqueta / etapa"
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-ellevee-stone-subtle hover:bg-ellevee-warm-ivory border border-ellevee-border px-2.5 py-0.5 text-xs text-ellevee-deep-ink font-medium whitespace-nowrap shadow-2xs shrink-0 cursor-pointer transition-colors disabled:opacity-60 group"
                  >
                    {isChangingStage ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin text-ellevee-blue shrink-0" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: workflowStageColor }}
                      />
                    )}
                    <span className="max-w-[140px] xl:max-w-[180px] truncate">
                      {workflowStageName || "Sem Etiqueta"}
                    </span>
                    <ChevronDown className="h-3 w-3 text-ellevee-text-muted group-hover:text-ellevee-deep-ink transition-colors" />
                  </button>
                }
              >
                <DropdownMenuLabel>Alterar Etiqueta / Funil</DropdownMenuLabel>
                {workflowStages.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-ellevee-text-secondary italic">
                    Nenhuma etapa encontrada
                  </div>
                ) : (
                  workflowStages.map((st) => {
                    const isSelected = workflowStageId === st.id
                    return (
                      <DropdownMenuItem
                        key={st.id}
                        onClick={() => {
                          if (!isChangingStage) onChangeStage(st.id)
                        }}
                        className={`flex items-center justify-between gap-3 cursor-pointer ${
                          isSelected ? "bg-[#F4F8FE] font-semibold text-ellevee-deep-ink" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: st.color || "#64748b" }}
                          />
                          <span className="truncate">{st.name}</span>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 text-ellevee-blue shrink-0" />}
                      </DropdownMenuItem>
                    )
                  })
                )}
              </DropdownMenu>
            </div>
          </div>

          {/* Linha inferior de ownership + etapa mobile + telefone xl */}
          <div className="flex items-center gap-1.5 text-xs text-ellevee-text-secondary mt-0.5 min-w-0 overflow-hidden">
            <span className={`inline-flex items-center gap-1 text-[11px] whitespace-nowrap shrink-0 ${ownershipToneClasses.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ownershipToneClasses.dot}`} />
              <span>{ownership.label}</span>
            </span>

            {/* Etapa no mobile (compacta) */}
            {workflowStageName && (
              <>
                <span className="sm:hidden text-ellevee-border shrink-0">•</span>
                <button
                  type="button"
                  disabled={isChangingStage}
                  onClick={onOpenStageModal}
                  title="Alterar etiqueta da conversa"
                  className="sm:hidden inline-flex items-center gap-1 min-h-[28px] min-w-0 px-1.5 py-0.5 rounded-md text-[11px] text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-stone-subtle disabled:opacity-60 cursor-pointer"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: workflowStageColor }}
                  />
                  <span className="truncate">{workflowStageName}</span>
                </button>
              </>
            )}

            {/* Telefone apenas quando há boa folga horizontal (xl:) */}
            {contactPhone && (
              <>
                <span className="hidden xl:inline text-ellevee-border">•</span>
                <span className="hidden xl:flex items-center gap-1 font-mono text-[11px] text-ellevee-text-secondary">
                  <Phone className="h-3 w-3 text-ellevee-text-muted shrink-0" />
                  <span>{formatConversationPhone(contactPhone)}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Lado Direito: Controles de Ownership, Inspector, Finalizar e Menu Contextual */}
      <ConversationHeaderActions
        status={status}
        agentName={agentName}
        isProfileOpen={isProfileOpen}
        internalNotesCount={internalNotesCount}
        confirmClose={confirmClose}
        isTakingOver={isTakingOver}
        isReturningToAI={isReturningToAI}
        isClosing={isClosing}
        isReopening={isReopening}
        onTakeover={onTakeover}
        onReturnToAI={onReturnToAI}
        onRequestClose={onRequestClose}
        onOpenCloseModal={onOpenCloseModal}
        onReopen={onReopen}
        onToggleInspector={onToggleInspector}
        onOpenProfile={onOpenProfile}
        onOpenNotes={onOpenNotes}
        onOpenStageModal={onOpenStageModal}
      />
    </header>
  )
}

export const ConversationHeader = React.memo(ConversationHeaderComponent)
ConversationHeader.displayName = "ConversationHeader"
