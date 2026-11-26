"use client"

import React from "react"
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  StickyNote,
  Tag,
  User,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { isHeaderActionLocked } from "@/lib/ui/conversations-header"
import { ConversationOwnershipControls } from "./conversation-ownership-controls"

export interface ConversationHeaderActionsProps {
  status?: string | null
  agentName?: string | null
  isProfileOpen: boolean
  internalNotesCount: number
  confirmClose: boolean
  isTakingOver: boolean
  isReturningToAI: boolean
  isClosing: boolean
  isReopening: boolean
  onTakeover: () => void
  onReturnToAI: () => void
  onRequestClose: () => void
  onOpenCloseModal: () => void
  onReopen: () => void
  onToggleInspector: () => void
  onOpenProfile: () => void
  onOpenNotes: () => void
  onOpenStageModal: () => void
}

function ConversationHeaderActionsComponent({
  status,
  agentName,
  isProfileOpen,
  internalNotesCount,
  confirmClose,
  isTakingOver,
  isReturningToAI,
  isClosing,
  isReopening,
  onTakeover,
  onReturnToAI,
  onRequestClose,
  onOpenCloseModal,
  onReopen,
  onToggleInspector,
  onOpenProfile,
  onOpenNotes,
  onOpenStageModal,
}: ConversationHeaderActionsProps) {
  const isLocked = isHeaderActionLocked({
    isTakingOver,
    isReturningToAI,
    isClosing,
    isReopening,
  })

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      {/* 1. Controle Principal de Ownership: Assumir / Devolver / Reabrir */}
      <ConversationOwnershipControls
        status={status}
        agentName={agentName}
        isTakingOver={isTakingOver}
        isReturningToAI={isReturningToAI}
        isReopening={isReopening}
        isLocked={isLocked}
        onTakeover={onTakeover}
        onReturnToAI={onReturnToAI}
        onReopen={onReopen}
      />

      {/* 2. Botão Toggle do Inspector (Desktop >= lg) */}
      <button
        type="button"
        onClick={onToggleInspector}
        className={`hidden lg:inline-flex items-center gap-1.5 h-[34px] px-2.5 xl:px-3 rounded-full text-xs font-medium border transition-all shadow-2xs shrink-0 cursor-pointer ${
          isProfileOpen
            ? "bg-[#F4F8FE] text-ellevee-blue border-ellevee-blue/30"
            : "bg-white text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-stone-subtle border-ellevee-border"
        }`}
        title={isProfileOpen ? "Recolher Inspector (Perfil e Notas)" : "Abrir Inspector (Perfil e Notas)"}
        aria-label={isProfileOpen ? "Recolher painel do cliente" : "Abrir painel do cliente"}
        aria-expanded={isProfileOpen}
      >
        {isProfileOpen ? (
          <PanelRightClose className="h-3.5 w-3.5" />
        ) : (
          <PanelRightOpen className="h-3.5 w-3.5" />
        )}
        <span className="hidden xl:inline">Inspector</span>
        {internalNotesCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-note-bg border border-note-border-strong text-note-strong text-[10px] font-mono font-bold inline-flex items-center justify-center">
            {internalNotesCount}
          </span>
        )}
      </button>

      {/* 3. Botão Finalizar (no desktop com Inspector aberto vai para ⋮ para preservar nome do cliente) */}
      {status !== "closed" && (
        <button
          type="button"
          onClick={onRequestClose}
          disabled={isLocked}
          className={`${
            isProfileOpen ? "hidden 2xl:inline-flex" : "hidden xl:inline-flex"
          } items-center gap-1.5 h-[34px] px-3 rounded-full text-xs font-medium transition-all shadow-2xs active:scale-95 disabled:opacity-50 shrink-0 ${
            confirmClose
              ? "bg-rose-600 text-white hover:bg-rose-700 border border-rose-600 shadow-sm"
              : "text-ellevee-text-secondary hover:text-rose-600 bg-white hover:bg-rose-50 border border-ellevee-border hover:border-rose-200"
          }`}
          title={confirmClose ? "Clique novamente para confirmar encerramento" : "Finalizar atendimento"}
        >
          {isClosing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : confirmClose ? (
            <AlertCircle className="h-3.5 w-3.5 text-white" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-ellevee-text-muted" />
          )}
          <span>{confirmClose ? "Confirmar?" : "Finalizar"}</span>
        </button>
      )}

      <div className="h-5 w-px bg-ellevee-border mx-0.5 hidden sm:block" />

      {/* 4. Menu Suspenso Mais Opções (⋮) */}
      <DropdownMenu
        align="right"
        trigger={
          <button
            type="button"
            className="h-11 w-11 lg:h-9 lg:w-9 rounded-full flex items-center justify-center text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-stone-subtle border border-ellevee-border transition-all shadow-2xs shrink-0 cursor-pointer"
            title="Mais opções da conversa"
            aria-label="Mais opções da conversa"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        }
      >
        <DropdownMenuLabel>Ações da Conversa</DropdownMenuLabel>
        <DropdownMenuItem onClick={onOpenProfile}>
          <User className="h-4 w-4 mr-2 text-ellevee-text-secondary" />
          <span>Ver Perfil do Cliente</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenNotes}>
          <StickyNote className="h-4 w-4 mr-2 text-note-accent" />
          <span>Notas Internas ({internalNotesCount})</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenStageModal}>
          <Tag className="h-4 w-4 mr-2 text-ellevee-purple" />
          <span>Etiquetas e Funil</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {status === "closed" ? (
          <DropdownMenuItem
            onClick={() => {
              if (!isLocked) onReopen()
            }}
          >
            <RotateCcw className="h-4 w-4 mr-2 text-emerald-600" />
            <span>Reabrir Atendimento</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => {
              if (!isLocked) onOpenCloseModal()
            }}
            className="text-red-600 font-medium"
          >
            <CheckCircle2 className="h-4 w-4 mr-2 text-red-500" />
            <span>Finalizar Atendimento</span>
          </DropdownMenuItem>
        )}
      </DropdownMenu>
    </div>
  )
}

export const ConversationHeaderActions = React.memo(ConversationHeaderActionsComponent)
ConversationHeaderActions.displayName = "ConversationHeaderActions"
