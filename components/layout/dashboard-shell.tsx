"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  MessageSquare,
  Users,
  Bot,
  Calendar,
  BarChart3,
  Clock,
  Settings,
  HelpCircle,
  Sun,
  Bell,
  ChevronDown,
  Building2,
  Headphones,
  CheckCircle2,
  Radio
} from "lucide-react"

interface DashboardShellProps {
  userRole?: string
  impersonate?: {
    isImpersonating: boolean
    targetCompanyName?: string | null
    targetCompanySlug?: string | null
  }
  companyName?: string
  userDisplayName?: string
  standardSidebar: React.ReactNode
  standardHeader: React.ReactNode
  children: React.ReactNode
}

function WhatsAppHeaderIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.456 5.711 1.457h.005c6.554 0 11.89-5.335 11.893-11.893a11.82 11.82 0 00-3.48-8.413Z"/>
    </svg>
  )
}

export function DashboardShell({
  userRole = "admin",
  impersonate,
  companyName = "Ellevee IA",
  userDisplayName = "Operador",
  standardSidebar,
  standardHeader,
  children
}: DashboardShellProps) {
  const pathname = usePathname()
  const isConversationsChat = pathname === "/conversations"

  // Se NÃO for a tela de conversas/chat, mantém o layout padrão do dashboard
  if (!isConversationsChat) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {standardSidebar}
        <div className="flex flex-col w-full flex-1 min-w-0 h-full min-h-0">
          {standardHeader}
          <main className="flex flex-1 flex-col min-h-0 overflow-auto bg-ellevee-ivory p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    )
  }

  // =========================================================================
  // MODO WHATSAPP OMNICHANNEL FULL-BLEED PARA /conversations
  // =========================================================================
  const displayName = userDisplayName || "Atendente"
  const userInitials = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden bg-[#efeae2]">
      {/* 1. TOP BAR TEAL ESTILO WHATSAPP BUSINESS */}
      <header className="h-14 bg-[#005d4b] text-white px-4 flex items-center justify-between shrink-0 shadow-sm z-30 select-none">
        {/* Esquerda: Logo / Identidade da Empresa e Canal WhatsApp Conectado */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/10 hover:bg-white/15 px-3 py-1.5 rounded-lg border border-white/20 transition-colors">
            <span className="text-[#25d366]">
              <WhatsAppHeaderIcon className="h-4 w-4" />
            </span>
            <span className="font-semibold text-sm tracking-tight text-white">
              {companyName}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#25d366]/20 text-[#25d366] px-1.5 py-0.2 rounded border border-[#25d366]/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[#25d366] animate-pulse" />
              Online
            </span>
          </div>
        </div>

        {/* Direita: Seletor de Unidade, Tema, Notificações e Perfil */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Seletor de Empresa/Unidade */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-white/90 bg-black/10 hover:bg-black/20 rounded-md cursor-pointer transition-colors">
            <span>{companyName}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </div>

          {/* Ícone de Tema (Sun) */}
          <button
            type="button"
            className="p-1.5 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors"
            title="Alternar tema"
          >
            <Sun className="h-4 w-4" />
          </button>

          {/* Notificações (Bell) */}
          <button
            type="button"
            className="p-1.5 rounded-full hover:bg-white/10 text-white/90 hover:text-white transition-colors relative"
            title="Notificações"
          >
            <Bell className="h-4 w-4" />
          </button>

          {/* Avatar / Perfil do Operador */}
          <div className="flex items-center gap-2 pl-1 border-l border-white/20">
            <div className="h-8 w-8 rounded-full bg-[#004738] border border-white/30 text-white flex items-center justify-center font-bold text-xs shadow-xs">
              {userInitials}
            </div>
            <span className="hidden md:inline text-xs font-medium text-white/90 max-w-[120px] truncate">
              {displayName}
            </span>
          </div>
        </div>
      </header>

      {/* 2. CORPO: SLIM ICON-RAIL + MAIN FULL-BLEED */}
      <div className="flex flex-1 min-h-0 h-full w-full overflow-hidden">
        {/* Barra Lateral Estreita (Icon Rail) */}
        <aside className="w-14 bg-[#004738] text-white flex flex-col items-center justify-between py-3 shrink-0 border-r border-[#00382c] z-20">
          {/* Ícones de Navegação Superiores */}
          <div className="flex flex-col items-center gap-2 w-full">
            {/* Conversas (Ativo) */}
            <Link
              href="/conversations"
              className="h-10 w-10 rounded-xl bg-[#005d4b] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95"
              title="Conversas em Andamento"
            >
              <MessageSquare className="h-5 w-5" />
            </Link>

            {/* Clientes */}
            <Link
              href="/customers"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Clientes & Contatos"
            >
              <Users className="h-5 w-5" />
            </Link>

            {/* Agentes de IA */}
            <Link
              href="/agent"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Agentes de Inteligência Artificial"
            >
              <Bot className="h-5 w-5" />
            </Link>

            {/* Funil Kanban */}
            <Link
              href="/conversations/kanban"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Quadro Funil (Kanban)"
            >
              <Calendar className="h-5 w-5" />
            </Link>

            {/* Dashboard / Relatórios */}
            <Link
              href="/dashboard"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Dashboard & Métricas"
            >
              <BarChart3 className="h-5 w-5" />
            </Link>

            {/* Auditoria / Histórico */}
            <Link
              href="/audit"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Histórico de Auditoria"
            >
              <Clock className="h-5 w-5" />
            </Link>
          </div>

          {/* Ícones Inferiores: Configurações e Ajuda */}
          <div className="flex flex-col items-center gap-2 w-full pt-3 border-t border-white/10">
            <Link
              href="/settings"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Configurações do Sistema"
            >
              <Settings className="h-5 w-5" />
            </Link>
            <button
              type="button"
              className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Ajuda e Suporte"
              onClick={() => alert("Central de Ajuda Ellevee IA")}
            >
              <HelpCircle className="h-5 w-5" />
            </button>
          </div>
        </aside>

        {/* Área Central / Chat sem Padding (Full Bleed) */}
        <main className="flex-1 flex flex-col min-h-0 h-full w-full overflow-hidden bg-[#efeae2]">
          {children}
        </main>
      </div>
    </div>
  )
}
