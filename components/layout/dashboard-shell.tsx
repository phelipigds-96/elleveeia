"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { PushNotificationsButton } from "@/components/notifications/push-notifications-button"
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
  ChevronDown,
  Building2,
  Headphones,
  CheckCircle2,
  Radio,
  Menu,
  X,
  BookOpen,
  Plug,
  ShieldCheck,
  LogOut
} from "lucide-react"
import { logout } from "@/app/(auth)/actions"
import { ElleveeLogo } from "@/components/ui/ellevee-logo"

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasActiveMobileChat, setHasActiveMobileChat] = useState(false)

  useEffect(() => {
    const handleSelectionChange = (event: Event) => {
      const custom = event as CustomEvent<{ hasSelection?: boolean }>
      setHasActiveMobileChat(Boolean(custom.detail?.hasSelection))
    }
    window.addEventListener("ellevee:chat-selection-change", handleSelectionChange)
    return () => window.removeEventListener("ellevee:chat-selection-change", handleSelectionChange)
  }, [])

  useEffect(() => {
    if (!isConversationsChat) {
      setHasActiveMobileChat(false)
    }
  }, [isConversationsChat])

  const displayName = userDisplayName || "Atendente"
  const userInitials = displayName.slice(0, 2).toUpperCase()
  const isAttendant = userRole === "attendant" || userRole === "user"

  const navItems = [
    { href: "/conversations", label: "Conversas & Chat", icon: MessageSquare, highlight: true },
    { href: "/conversations/kanban", label: "Quadro Funil (Kanban)", icon: Calendar },
    ...(!isAttendant
      ? [
          { href: "/dashboard", label: "Dashboard & Métricas", icon: BarChart3 },
          { href: "/customers", label: "Clientes & Contatos", icon: Users },
          { href: "/agent", label: "Agentes IA", icon: Bot },
          { href: "/catalog", label: "Catálogo", icon: BookOpen },
          { href: "/integrations", label: "Integrações", icon: Plug },
          { href: "/settings", label: "Configurações", icon: Settings },
        ]
      : []),
  ]

  const renderMobileDrawer = () => {
    if (!mobileMenuOpen) return null

    return (
      <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
        {/* Backdrop escurecido com toque para fechar */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
          onClick={() => setMobileMenuOpen(false)}
        />

        {/* Drawer Lateral Deslizante */}
        <div className="relative w-72 max-w-[85vw] bg-ellevee-ink text-white shadow-2xl flex flex-col justify-between animate-in slide-in-from-left duration-200 border-r border-white/10 z-10">
          <div className="flex flex-col min-h-0 overflow-y-auto">
            {/* Header do Drawer: Logotipo Oficial Ellevee IA */}
            <div className="h-16 flex items-center justify-between px-5 border-b border-white/10 shrink-0">
              <ElleveeLogo
                variant="full"
                theme="dark"
                size="sm"
                href="/dashboard"
              />

              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="Fechar menu"
                aria-label="Fechar menu de navegação"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Itens de Navegação */}
            <nav className="p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
                      isActive
                        ? "bg-white/15 text-white font-semibold shadow-xs"
                        : item.highlight
                        ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                        : "text-white/70 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive
                            ? "text-ellevee-accent"
                            : item.highlight
                            ? "text-emerald-400"
                            : "text-white/60"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </div>
                    {isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent shrink-0" />
                    )}
                  </Link>
                )
              })}

              {!isAttendant && (
                <div className="pt-2 mt-2 border-t border-white/10">
                  <Link
                    href="/paineladmin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="h-4 w-4 text-ellevee-accent shrink-0" />
                      <span>Painel SuperAdmin</span>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-white/40" />
                  </Link>
                </div>
              )}
            </nav>
          </div>

          {/* Rodapé do Drawer: Perfil + Logout */}
          <div className="p-4 border-t border-white/10 shrink-0 bg-black/20 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full bg-emerald-700 border border-white/30 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                {userInitials}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-white truncate max-w-[120px]">
                  {displayName}
                </span>
                <span className="text-[10px] text-white/60">
                  {isAttendant ? "Atendente" : "Administrador"}
                </span>
              </div>
            </div>

            <form action={logout}>
              <button
                type="submit"
                className="p-2 rounded-lg text-white/70 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Sair da conta"
                aria-label="Sair da conta"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // Se NÃO for a tela de conversas/chat, mantém o layout padrão do dashboard com Menu Mobile no topo
  if (!isConversationsChat) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {standardSidebar}
        <div className="flex flex-col w-full flex-1 min-w-0 h-full min-h-0">
          {/* Top Bar Mobile com Menu Hamburger e Atalho para Chat */}
          <div className="md:hidden h-14 bg-white border-b border-ellevee-stone px-4 flex items-center justify-between shrink-0 z-30">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="p-1.5 -ml-1 text-ellevee-ink hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                title="Menu de navegação"
                aria-label="Abrir menu de navegação"
              >
                <Menu className="h-6 w-6" />
              </button>
              <div className="flex items-center gap-2">
                <ElleveeLogo variant="full" theme="light" size="xs" href="/dashboard" />
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 truncate max-w-[120px]">
                  {companyName}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/conversations"
                className="h-8 px-3 rounded-full bg-[#005d4b] hover:bg-[#004738] text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-transform active:scale-95"
                title="Ir para o Chat de Atendimento"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Atendimento</span>
              </Link>
            </div>
          </div>

          {/* Header padrão em telas médias/grandes */}
          <div className="hidden md:block">
            {standardHeader}
          </div>

          <main className="flex flex-1 flex-col min-h-0 overflow-auto bg-ellevee-ivory p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>

        {/* Mobile Navigation Drawer */}
        {renderMobileDrawer()}
      </div>
    )
  }

  // =========================================================================
  // MODO WHATSAPP OMNICHANNEL FULL-BLEED PARA /conversations
  // =========================================================================
  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden bg-[#efeae2] relative">
      {/* 1. TOP BAR TEAL ESTILO WHATSAPP BUSINESS COM MENU MOBILE (Oculta em smartphones quando uma conversa está aberta) */}
      <header className={`${hasActiveMobileChat ? "hidden lg:flex" : "flex"} h-14 bg-[#005d4b] text-white px-3 sm:px-4 items-center justify-between shrink-0 shadow-sm z-30 select-none`}>
        {/* Esquerda: Botão Menu Mobile + Identidade da Empresa e Canal WhatsApp Conectado */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="p-1.5 -ml-1 text-white/90 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            title="Menu de navegação"
            aria-label="Abrir menu de navegação"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex items-center gap-2 bg-white/10 hover:bg-white/15 px-2.5 sm:px-3 py-1.5 rounded-lg border border-white/20 transition-colors">
            <span className="text-[#25d366]">
              <WhatsAppHeaderIcon className="h-4 w-4" />
            </span>
            <span className="font-semibold text-xs sm:text-sm tracking-tight text-white truncate max-w-[120px] sm:max-w-none">
              {companyName}
            </span>
            <span className="hidden xs:inline-flex items-center gap-1 text-[11px] font-medium bg-[#25d366]/20 text-[#25d366] px-1.5 py-0.2 rounded border border-[#25d366]/30">
              <span className="h-1.5 w-1.5 rounded-full bg-[#25d366] animate-pulse" />
              Online
            </span>
          </div>
        </div>

        {/* Direita: Seletor de Unidade, Tema, Notificações e Perfil */}
        <div className="flex items-center gap-2 sm:gap-4">
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

          {/* Notificações (Bell / Web Push PWA) */}
          <PushNotificationsButton variant="dark" />

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

      {/* 2. CORPO: SLIM ICON-RAIL (OCULTO EM MOBILE) + MAIN FULL-BLEED */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Barra Lateral Estreita (Icon Rail) — oculta em mobile para liberar 100% da tela */}
        <aside className="w-14 bg-[#004738] text-white hidden md:flex flex-col items-center justify-between py-3 shrink-0 border-r border-[#00382c] z-20">
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

            {/* Clientes (restrito a Admin / Owner) */}
            {!isAttendant && (
              <Link
                href="/customers"
                className="h-10 w-10 rounded-xl text-white/70 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
                title="Clientes & Contatos"
              >
                <Users className="h-5 w-5" />
              </Link>
            )}

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
        <main className="flex-1 flex flex-col min-h-0 w-full overflow-hidden bg-[#efeae2]">
          {children}
        </main>
      </div>

      {/* Mobile Navigation Drawer */}
      {renderMobileDrawer()}
    </div>
  )
}
