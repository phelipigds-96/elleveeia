"use client"

import React from "react"
import type {
  ConversationListCounts,
  ConversationListTab,
} from "@/lib/ui/conversations-list"

export interface ConversationListFiltersProps {
  activeTab: ConversationListTab
  counts: ConversationListCounts
  onSelectTab: (tab: ConversationListTab) => void
}

function ConversationListFiltersComponent({
  activeTab,
  counts,
  onSelectTab,
}: ConversationListFiltersProps) {
  const tabs: Array<{
    key: ConversationListTab
    label: string
    count: number
    title: string
    badgeClass: string
  }> = [
    {
      key: "all",
      label: "Todas",
      count: counts.all,
      title: `Todas as conversas (${counts.all})`,
      badgeClass: "bg-ellevee-stone-subtle text-ellevee-text-secondary",
    },
    {
      key: "waiting",
      label: "Fila",
      count: counts.waiting,
      title: `Aguardando atendimento (${counts.waiting})`,
      badgeClass:
        counts.waiting > 0
          ? "bg-amber-100 text-amber-800 border border-amber-200"
          : "bg-ellevee-stone-subtle text-ellevee-text-secondary",
    },
    {
      key: "in_progress",
      label: "Com operador",
      count: counts.inProgress,
      title: `Em atendimento humano (${counts.inProgress})`,
      badgeClass: "bg-emerald-50 text-emerald-700 border border-emerald-200/80",
    },
    {
      key: "ai",
      label: "IA",
      count: counts.ai,
      title: `Atendimento IA ativa (${counts.ai})`,
      badgeClass: "bg-[#F3EEFE] text-ellevee-purple border border-ellevee-purple/20",
    },
    {
      key: "closed",
      label: "Fim",
      count: counts.closed,
      title: `Conversas finalizadas (${counts.closed})`,
      badgeClass: "bg-ellevee-stone-subtle text-ellevee-text-secondary",
    },
  ]

  return (
    <div
      role="tablist"
      aria-label="Filtros da fila de atendimentos"
      className="flex flex-wrap items-center gap-1.5 pt-0.5"
    >
      {tabs.map((tab) => {
        const isTabActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isTabActive}
            onClick={() => onSelectTab(tab.key)}
            title={tab.title}
            aria-label={tab.title}
            className={`min-h-[44px] lg:min-h-[32px] px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              isTabActive
                ? "bg-ellevee-deep-ink text-white shadow-2xs"
                : "bg-white text-ellevee-text-secondary border border-ellevee-border hover:bg-ellevee-stone-subtle hover:text-ellevee-deep-ink"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-mono font-semibold inline-flex items-center justify-center ${
                isTabActive ? "bg-white/20 text-white border-transparent" : tab.badgeClass
              }`}
            >
              {tab.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export const ConversationListFilters = React.memo(ConversationListFiltersComponent)
ConversationListFilters.displayName = "ConversationListFilters"
