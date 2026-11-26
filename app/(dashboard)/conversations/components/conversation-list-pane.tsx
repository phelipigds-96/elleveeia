"use client"

import React, { useMemo, useState } from "react"
import Link from "next/link"
import { MessageSquare, Search, SlidersHorizontal, SquarePen } from "lucide-react"
import type { ConversationData } from "../actions"
import {
  type ConversationListTab,
  computeConversationCounts,
  filterConversations,
  getDefaultConversationTab,
} from "@/lib/ui/conversations-list"
import { ConversationListFilters } from "./conversation-list-filters"
import { ConversationListItem } from "./conversation-list-item"

export interface ConversationListPaneProps {
  conversations: ConversationData[]
  selectedId: string | null
  recentlyUpdatedId: string | null
  showChatOnMobile: boolean
  isMasterOrAdmin: boolean
  currentUserId?: string | null
  onSelectConversation: (conversationId: string) => void
  onOpenNewChat: () => void
}

function ConversationListPaneComponent({
  conversations,
  selectedId,
  recentlyUpdatedId,
  showChatOnMobile,
  isMasterOrAdmin,
  currentUserId,
  onSelectConversation,
  onOpenNewChat,
}: ConversationListPaneProps) {
  const [activeTab, setActiveTab] = useState<ConversationListTab>(() =>
    getDefaultConversationTab(isMasterOrAdmin)
  )
  const [search, setSearch] = useState("")

  const counts = useMemo(() => computeConversationCounts(conversations), [conversations])

  const filteredConversations = useMemo(
    () => filterConversations(conversations, activeTab, search),
    [conversations, activeTab, search]
  )

  return (
    <aside
      className={`${showChatOnMobile ? "hidden lg:flex" : "flex"} w-full lg:w-[320px] xl:w-[356px] border-r border-ellevee-border bg-white flex-col shrink-0 h-full z-40 lg:static`}
    >
      {/* Cabeçalho de Busca e Filtros Legíveis (Outlook Pivot Style) */}
      <div className="p-3 border-b border-ellevee-border space-y-2.5 bg-white">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-ellevee-deep-ink truncate">
              Atendimentos
            </h1>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenNewChat}
              className="h-11 w-11 lg:h-8 lg:w-8 flex items-center justify-center text-ellevee-text-secondary hover:text-ellevee-blue hover:bg-[#F4F8FE] rounded-md transition-colors shrink-0"
              title="Nova conversa / contato"
              aria-label="Nova conversa ou contato"
            >
              <SquarePen className="h-4 w-4" />
            </button>
            <Link
              href="/conversations/kanban"
              className="h-11 w-11 lg:h-8 lg:w-8 flex items-center justify-center text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-ellevee-stone-subtle rounded-md transition-colors shrink-0"
              title="Abrir Funil Kanban"
              aria-label="Abrir Funil Kanban"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ellevee-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar contato, telefone ou prévia"
            aria-label="Buscar contato"
            className="w-full h-11 lg:h-9 pl-9 pr-3 bg-ellevee-stone-subtle border border-ellevee-border rounded-control text-[16px] sm:text-sm text-ellevee-deep-ink placeholder:text-ellevee-text-muted focus:outline-none focus:bg-white focus:border-ellevee-blue focus:ring-2 focus:ring-ellevee-blue/15 transition-colors"
          />
        </div>

        <ConversationListFilters
          activeTab={activeTab}
          counts={counts}
          onSelectTab={setActiveTab}
        />
      </div>

      {/* Lista de Itens */}
      <div
        className="flex-1 overflow-y-auto scroll-slim p-2 space-y-1"
        aria-label="Lista de conversas"
      >
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-ellevee-ink-muted p-6 text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-ellevee-ivory flex items-center justify-center">
              <MessageSquare className="h-5 w-5 stroke-1 text-ellevee-ink-muted/70" />
            </div>
            <p className="text-sm font-medium text-ellevee-ink">
              {conversations.length === 0
                ? "Nenhuma conversa por aqui"
                : "Nenhuma conversa encontrada"}
            </p>
            <p className="text-sm text-ellevee-ink-muted max-w-[240px] leading-relaxed">
              {conversations.length === 0
                ? "Quando um contato chegar pelo WhatsApp, a conversa aparece aqui."
                : "Ajuste a busca ou troque a aba de status para ver outros atendimentos."}
            </p>
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <ConversationListItem
              key={conv.id}
              conversation={conv}
              isSelected={selectedId === conv.id}
              isPulsing={recentlyUpdatedId === conv.id}
              currentUserId={currentUserId}
              onSelect={onSelectConversation}
            />
          ))
        )}
      </div>
    </aside>
  )
}

export const ConversationListPane = React.memo(ConversationListPaneComponent)
ConversationListPane.displayName = "ConversationListPane"
