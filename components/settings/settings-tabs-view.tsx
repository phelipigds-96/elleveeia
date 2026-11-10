"use client"

import React, { useState } from "react"
import { Users, Zap, CheckCircle2, Building2 } from "lucide-react"
import { TeamManagement } from "@/components/settings/team-management"
import { CloseReasonsManagement } from "@/components/settings/close-reasons-management"
import { QuickRepliesManagement } from "@/components/settings/quick-replies-management"
import { CompanyForm } from "@/app/(dashboard)/settings/components/company-form"
import { CompanyMember, CloseReason, QuickReply } from "@/app/(dashboard)/settings/actions"

interface SettingsTabsViewProps {
  initialMembers: CompanyMember[]
  currentUserId: string
  company: any
  closeReasons: CloseReason[]
  requireCloseReason: boolean
  quickReplies: QuickReply[]
}

type TabKey = "team" | "quick-replies" | "close-reasons" | "company"

export function SettingsTabsView({
  initialMembers,
  currentUserId,
  company,
  closeReasons,
  requireCloseReason,
  quickReplies,
}: SettingsTabsViewProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("team")

  const tabs = [
    {
      key: "team" as TabKey,
      label: "Equipe & Atendentes",
      icon: Users,
      badge: initialMembers.length,
    },
    {
      key: "quick-replies" as TabKey,
      label: "Mensagens Rápidas",
      icon: Zap,
      badge: quickReplies.length,
    },
    {
      key: "close-reasons" as TabKey,
      label: "Motivos de Finalização",
      icon: CheckCircle2,
      badge: closeReasons.length,
    },
    {
      key: "company" as TabKey,
      label: "Dados da Empresa",
      icon: Building2,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Barra de Navegação por Abas */}
      <div className="flex items-center gap-2 border-b border-ellevee-border pb-2 overflow-x-auto scroll-slim">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all shrink-0 ${
                isActive
                  ? "bg-ellevee-deep-ink text-white shadow-2xs"
                  : "text-ellevee-text-secondary hover:text-ellevee-deep-ink hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Conteúdo da Aba Selecionada */}
      {activeTab === "team" && (
        <TeamManagement initialMembers={initialMembers} currentUserId={currentUserId} />
      )}

      {activeTab === "quick-replies" && (
        <QuickRepliesManagement initialQuickReplies={quickReplies} />
      )}

      {activeTab === "close-reasons" && (
        <CloseReasonsManagement
          initialReasons={closeReasons}
          requireCloseReason={requireCloseReason}
        />
      )}

      {activeTab === "company" && (
        <div className="rounded-xl border border-ellevee-border bg-white text-card-foreground shadow-2xs">
          <div className="flex flex-col space-y-1.5 p-6 border-b border-ellevee-border">
            <h3 className="font-semibold text-sm leading-none tracking-tight text-ellevee-deep-ink">
              Cadastro da Empresa
            </h3>
            <p className="text-xs text-ellevee-text-secondary">
              Informações cadastrais e nome corporativo da sua organização.
            </p>
          </div>
          <div className="p-6">
            <CompanyForm company={company} />
          </div>
        </div>
      )}
    </div>
  )
}
