"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  LayoutDashboard,
  ShieldCheck,
  Settings,
  Search,
  ArrowUpRight,
  Layers,
  Bot,
  Cpu,
  ChevronRight,
  Sparkles,
  Zap,
  Activity,
  Sliders,
  CheckCircle2,
  QrCode,
} from "lucide-react"
import { Toaster } from "@/components/ui/toast"
import AdminCommandPalette from "./admin-command-palette"

interface AdminShellProps {
  children: React.ReactNode
}

interface NavItem {
  name: string
  href: string
  icon: React.ElementType
  disabled?: boolean
  badge?: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAVIGATION_SECTIONS: NavSection[] = [
  {
    title: "VISÃO GERAL",
    items: [
      { name: "Dashboard", href: "/paineladmin", icon: LayoutDashboard },
    ],
  },
  {
    title: "GESTÃO",
    items: [
      { name: "Empresas", href: "/companies", icon: Building2 },
      { name: "Instâncias WhatsApp", href: "/instances", icon: QrCode },
      { name: "Planos e limites", href: "/plans", icon: Layers },
      { name: "Agentes", href: "/agents", icon: Bot },
      { name: "Provedores", href: "/providers", icon: Cpu },
    ],
  },
  {
    title: "GOVERNANÇA",
    items: [
      { name: "Auditoria", href: "/audit", icon: ShieldCheck },
      { name: "Configurações", href: "/admin-settings", icon: Settings },
    ],
  },
]

export default function AdminShell({ children }: AdminShellProps) {
  const pathname = usePathname()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)

  // Listener global de atalho ⌘K / Ctrl+K para abrir a paleta de comandos
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setIsCommandPaletteOpen((prev) => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Dynamic breadcrumb calculation
  const getBreadcrumb = () => {
    if (pathname.startsWith("/instances")) {
      return { section: "Gestão", page: "Instâncias WhatsApp" }
    }
    if (pathname.startsWith("/plans")) {
      return { section: "Gestão", page: "Planos e Limites" }
    }
    if (pathname.startsWith("/agents")) {
      return { section: "Gestão", page: "Agentes de IA" }
    }
    if (pathname.startsWith("/providers")) {
      return { section: "Gestão", page: "Provedores de IA" }
    }
    if (pathname.startsWith("/companies")) {
      return { section: "Gestão", page: "Empresas" }
    }
    if (pathname.startsWith("/audit")) {
      return { section: "Governança", page: "Auditoria" }
    }
    if (pathname.startsWith("/admin-settings")) {
      return { section: "Governança", page: "Configurações" }
    }
    return { section: "Visão Geral", page: "Dashboard" }
  }

  const breadcrumb = getBreadcrumb()

  return (
    <div className="min-h-screen bg-[#F3F2ED] text-ellevee-deep-ink flex antialiased font-sans selection:bg-ellevee-purple selection:text-white">
      {/* Sidebar Lateral - Deep Ink Oficial (#202520) */}
      <aside className="w-64 bg-[#202520] text-white flex flex-col justify-between shrink-0 border-r border-white/10 z-20 shadow-xl">
        <div>
          {/* Header da Marca: Emblema Minimalista Oficial */}
          <div className="h-16 flex items-center px-5 border-b border-white/10 gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0 shadow-sm">
              <svg
                className="w-4 h-4 text-[#16BCE0]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6h16" />
                <path d="M4 12h10" />
                <path d="M4 18h16" />
              </svg>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-base tracking-tight text-white leading-none">
                  Ellevee IA
                </span>
                <span className="text-[9px] font-mono font-bold tracking-wider uppercase text-white bg-ellevee-gradient px-1.5 py-0.5 rounded shadow-2xs">
                  ADMIN
                </span>
              </div>
              <span className="text-[10px] text-[#A6B5A6] font-medium tracking-tight mt-1">
                Governança &amp; Infraestrutura
              </span>
            </div>
          </div>

          {/* Menus de Navegação Estruturados */}
          <nav className="p-3 space-y-4">
            {NAVIGATION_SECTIONS.map((section) => (
              <div key={section.title} className="space-y-1">
                <div className="px-3 pt-2 pb-1 text-[10px] font-mono font-bold uppercase tracking-widest text-[#8E9F8E]">
                  {section.title}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href

                  if (item.disabled) {
                    return (
                      <div
                        key={item.name}
                        className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-white/40 cursor-not-allowed select-none group"
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="h-4 w-4 text-white/30" />
                          <span>{item.name}</span>
                        </div>
                        {item.badge && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-white/10 text-white/40 border border-white/10">
                            {item.badge}
                          </span>
                        )}
                      </div>
                    )
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group ${
                        isActive
                          ? "bg-white/12 text-white font-semibold shadow-sm border-l-2 border-[#7028D9] pl-2.5"
                          : "text-white/75 hover:text-white hover:bg-white/8 pl-3"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={`h-4 w-4 transition-colors ${
                            isActive
                              ? "text-[#7028D9]"
                              : "text-white/60 group-hover:text-white"
                          }`}
                        />
                        <span>{item.name}</span>
                      </div>
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#7028D9] ring-2 ring-[#7028D9]/40 animate-pulse" />
                      )}
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Rodapé da Sidebar: Operador + Ambiente Produção + Voltar ao App */}
        <div className="p-3 border-t border-white/10 bg-black/25 space-y-2.5">
          {/* Card do Operador SuperAdmin */}
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="relative">
              <div className="h-8 w-8 rounded-full bg-white/15 border border-white/20 text-white flex items-center justify-center font-display font-bold text-xs shrink-0 ring-2 ring-emerald-500/20">
                P
              </div>
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#202520]" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-white truncate">
                Phelipi
              </span>
              <span className="text-[10px] text-[#A6B5A6] font-mono truncate">
                SuperAdmin Master
              </span>
            </div>
          </div>

          {/* Identificação Clara de Ambiente de Produção */}
          <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-between text-[11px]">
            <span className="text-[#A6B5A6] font-medium text-[10px]">Ambiente:</span>
            <span className="font-semibold text-emerald-400 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              PRODUÇÃO
            </span>
          </div>

          {/* Link Estilizado para o App Principal */}
          <Link
            href="/dashboard"
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs font-medium transition-all group"
          >
            <span className="text-[11px]">Voltar ao App do Cliente</span>
            <ArrowUpRight className="h-3.5 w-3.5 text-white/60 group-hover:text-white transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </aside>

      {/* Área Principal de Trabalho */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar Flutuante com Glassmorphism (Efeito de Vidro) */}
        <header className="sticky top-0 z-20 h-16 bg-white/90 backdrop-blur-md border-b border-ellevee-border px-6 lg:px-8 flex items-center justify-between transition-colors shadow-2xs">
          {/* Breadcrumb da Página Atual */}
          <div className="flex items-center gap-2 text-xs font-medium text-ellevee-text-secondary">
            <span className="hover:text-ellevee-deep-ink transition-colors font-display font-semibold">
              Ellevee IA
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-ellevee-border stroke-[2.5]" />
            <span className="text-ellevee-text-secondary font-medium">{breadcrumb.section}</span>
            <ChevronRight className="h-3.5 w-3.5 text-ellevee-border stroke-[2.5]" />
            <span className="font-bold text-ellevee-deep-ink font-display bg-ellevee-warm-ivory px-2 py-0.5 rounded-md border border-ellevee-border">
              {breadcrumb.page}
            </span>
          </div>

          {/* Centro: Gatilho da Busca Global Interativa (⌘K) */}
          <div className="hidden md:flex items-center w-80">
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="w-full flex items-center justify-between bg-[#F8F8F6] hover:bg-white border border-ellevee-border rounded-xl px-3 py-1.5 text-xs text-ellevee-text-secondary transition-all shadow-2xs hover:border-[#7028D9]/40 cursor-pointer text-left group"
            >
              <div className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5 text-ellevee-text-secondary group-hover:text-ellevee-deep-ink transition-colors" />
                <span className="text-xs text-ellevee-text-secondary/80 group-hover:text-ellevee-deep-ink font-sans">
                  Buscar no SuperAdmin...
                </span>
              </div>
              <kbd className="inline-flex items-center gap-0.5 text-[10px] font-mono text-ellevee-text-secondary bg-white border border-ellevee-border px-1.5 py-0.5 rounded-md shadow-2xs">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Direita: Telemetria de IA + Status de Produção */}
          <div className="flex items-center gap-3">
            {/* Pill de Latência OpenAI */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white border border-ellevee-border text-ellevee-deep-ink shadow-2xs">
              <Sparkles className="w-3 h-3 text-[#7028D9]" />
              <span className="font-mono text-[10px] font-semibold">1.1s</span>
              <span className="text-[10px] text-ellevee-text-secondary">· OpenAI</span>
            </div>

            {/* Pill de Produção Ativa */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 border border-emerald-200 text-emerald-800 shadow-2xs">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
              <span>Produção Ativa</span>
            </div>

            <div className="h-4 w-px bg-ellevee-border" />

            {/* Avatar do Operador */}
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-ellevee-deep-ink text-white flex items-center justify-center font-display font-bold text-xs ring-2 ring-ellevee-border shadow-2xs">
                P
              </div>
              <span className="text-xs font-semibold text-ellevee-deep-ink hidden sm:inline">
                Phelipi
              </span>
            </div>
          </div>
        </header>

        {/* Área de Conteúdo Fluida e Centralizada */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto max-w-7xl w-full mx-auto animate-in fade-in duration-150">
          {children}
        </main>
      </div>

      {/* Paleta de Comandos Interativa Global */}
      <AdminCommandPalette
        open={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />

      {/* Notificações Toaster Globais */}
      <Toaster />
    </div>
  )
}
