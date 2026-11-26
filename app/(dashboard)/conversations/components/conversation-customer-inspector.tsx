"use client"

import React from "react"
import { StickyNote, User, X } from "lucide-react"
import type { CustomerData, MessageData, WorkflowStageOption } from "../actions"
import { CONVERSATIONS_DESKTOP_BREAKPOINT_PX } from "@/lib/ui/conversations-viewport"
import type { CustomerProfileDraft } from "@/lib/ui/conversations-inspector"
import { ConversationCustomerProfile } from "./conversation-customer-profile"
import { ConversationInternalNotes } from "./conversation-internal-notes"

export interface ConversationCustomerInspectorProps {
  isOpen: boolean
  activeTab: "profile" | "notes"
  conversationId: string
  customerId: string
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerAddress?: string | null
  customerNotes?: string | null
  customerAvatarUrl?: string | null
  externalId?: string | null
  workflowStageId?: string | null
  workflowStages: WorkflowStageOption[]
  internalNotes: MessageData[]
  isChangingStage: boolean
  isSavingCustomer: boolean
  isSavingQuickNote: boolean
  onSelectTab: (tab: "profile" | "notes") => void
  onClose: () => void
  onChangeStage: (stageId: string) => void
  onLoadCustomerDetails: (
    customerId: string
  ) => Promise<{ success: boolean; customer?: CustomerData; error?: string }>
  onSaveCustomer: (params: {
    conversationId: string
    customerId: string
    draft: CustomerProfileDraft
  }) => Promise<boolean>
  onCreateInternalNote: (conversationId: string, text: string) => Promise<boolean>
}

function ConversationCustomerInspectorComponent({
  isOpen,
  activeTab,
  conversationId,
  customerId,
  customerName,
  customerPhone,
  customerEmail,
  customerAddress,
  customerNotes,
  customerAvatarUrl,
  externalId,
  workflowStageId,
  workflowStages,
  internalNotes,
  isChangingStage,
  isSavingCustomer,
  isSavingQuickNote,
  onSelectTab,
  onClose,
  onChangeStage,
  onLoadCustomerDetails,
  onSaveCustomer,
  onCreateInternalNote,
}: ConversationCustomerInspectorProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] flex items-end lg:items-stretch lg:static lg:bg-transparent lg:backdrop-blur-none lg:z-auto"
      onClick={(e) => {
        if (
          e.target === e.currentTarget &&
          typeof window !== "undefined" &&
          window.innerWidth < CONVERSATIONS_DESKTOP_BREAKPOINT_PX
        ) {
          onClose()
        }
      }}
    >
      <aside
        id="painel-perfil-cliente"
        aria-label="Inspector de Perfil e Notas"
        className="w-full lg:w-[320px] xl:w-[344px] border-t lg:border-t-0 lg:border-l border-ellevee-border bg-white rounded-t-2xl lg:rounded-none max-h-[calc(var(--ellevee-vvh,100dvh)-2.5rem)] lg:max-h-none lg:h-full flex flex-col shrink-0 overflow-hidden shadow-2xl lg:shadow-none pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        {/* Alça visual no smartphone / tablet */}
        <div className="lg:hidden flex justify-center pt-2.5 pb-1 shrink-0">
          <span className="w-10 h-1 rounded-full bg-ellevee-border" />
        </div>

        {/* Header do Inspector com Abas Perfil | Notas */}
        <div className="px-3.5 py-2.5 border-b border-ellevee-border flex items-center justify-between gap-2 bg-ellevee-stone-subtle shrink-0">
          <div
            role="tablist"
            aria-label="Abas do Inspector"
            className="inline-flex items-center gap-1 p-1 rounded-lg bg-white border border-ellevee-border"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "profile"}
              onClick={() => onSelectTab("profile")}
              className={`min-h-[44px] lg:min-h-[28px] px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === "profile"
                  ? "bg-ellevee-deep-ink text-white shadow-2xs"
                  : "text-ellevee-text-secondary hover:text-ellevee-deep-ink"
              }`}
            >
              <User className="h-3.5 w-3.5" />
              <span>Perfil</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "notes"}
              onClick={() => onSelectTab("notes")}
              className={`min-h-[44px] lg:min-h-[28px] px-3 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === "notes"
                  ? "bg-note-accent text-white shadow-2xs"
                  : "text-ellevee-text-secondary hover:text-note-strong"
              }`}
            >
              <StickyNote className="h-3.5 w-3.5" />
              <span>Notas ({internalNotes.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 lg:h-8 lg:w-8 flex items-center justify-center rounded-md text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-border/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ellevee-blue/40 shrink-0"
            title="Fechar painel"
            aria-label="Fechar painel do cliente"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Conteúdo do Inspector com Scroll independente */}
        <div className="p-4 space-y-5 flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-slim">
          {activeTab === "profile" ? (
            <ConversationCustomerProfile
              key={`${conversationId}:${customerId}`}
              conversationId={conversationId}
              customerId={customerId}
              customerName={customerName}
              customerPhone={customerPhone}
              customerEmail={customerEmail}
              customerAddress={customerAddress}
              customerNotes={customerNotes}
              customerAvatarUrl={customerAvatarUrl}
              externalId={externalId}
              workflowStageId={workflowStageId}
              workflowStages={workflowStages}
              isChangingStage={isChangingStage}
              isSavingCustomer={isSavingCustomer}
              onChangeStage={onChangeStage}
              onLoadCustomerDetails={onLoadCustomerDetails}
              onSaveCustomer={onSaveCustomer}
            />
          ) : (
            <ConversationInternalNotes
              key={conversationId}
              conversationId={conversationId}
              internalNotes={internalNotes}
              isSavingQuickNote={isSavingQuickNote}
              onCreateInternalNote={onCreateInternalNote}
            />
          )}
        </div>
      </aside>
    </div>
  )
}

export const ConversationCustomerInspector = React.memo(ConversationCustomerInspectorComponent)
ConversationCustomerInspector.displayName = "ConversationCustomerInspector"
