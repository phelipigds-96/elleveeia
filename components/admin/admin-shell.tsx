"use client"

import React, { useState } from "react"
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
  ShieldAlert,
  Sliders,
  CheckCircle2,
  ExternalLink
} from "lucide-react"

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
      { name: "Planos e limites", href: "#", icon: Layers, disabled: true, badge: "Em breve" },
      { name: "Agentes", href: "#", icon: Bot, disabled: true, badge: "Em breve" },
      { name: "Provedores", href: "#", icon: Cpu, disabled: true, badge: "Em breve" },
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
  const [searchQuery, setSearchQuery] = useState("")

  // Dynamic breadcrumb calculation
  const getBreadcrumb = () => {
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
    <div className="min-h-screen bg-ellevee-ivory text-ellevee-ink flex antialiased font-sans selection:bg-ellevee-accent selection:text-ellevee-ink">
      {/* Sidebar Lateral - Deep Ink (#202520) com Excelente Contraste */}
      <aside className="w-64 bg-ellevee-ink text-white flex flex-col justify-between shrink-0 border-r border-white/10 z-20">
        <div>
          {/* Header da Marca: Símbolo minimalista + Ellevee IA + ADMINISTRATION */}
          <div className="h-16 flex items-center px-6 border-b border-white/10 gap-3">
            {/* Minimalist Geometric Brand Symbol */}
            <div className="h-8 w-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <svg 
                className="w-4 h-4 text-ellevee-accent" 
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
                <span className="text-[9px] font-semibold tracking-wider uppercase text-ellevee-accent bg-white/10 border border-white/15 px-1.5 py-0.5 rounded">
                  ADMIN
                </span>
              </div>
              <span className="text-[10px] text-[#A6B5A6] font-medium tracking-tight mt-0.5">
                Plataforma de Governança
              </span>
            </div>
          </div>

          {/* Menus Estruturados */}
          <nav className="p-3.5 space-y-5">
            {NAVIGATION_SECTIONS.map((section) => (
              <div key={section.title} className="space-y-1">
                <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#A6B5A6] font-sans">
                  {section.title}
                </div>
                {section.items.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href

                  if (item.disabled) {
                    return (
                      <div
                        key={item.name}
                        className="flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium text-white/45 cursor-not-allowed select-none group"
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="h-4 w-4 text-white/35" />
                          <span>{item.name}</span>
                        </div>
                        {item.badge && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-white/10 text-white/50 border border-white/10">
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
                      className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all group ${
                        isActive
                          ? "bg-white/15 text-white font-semibold shadow-sm ring-1 ring-white/10"
                          : "text-white/80 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon 
                          className={`h-4 w-4 transition-colors ${
                            isActive ? "text-ellevee-accent" : "text-white/60 group-hover:text-white"
                          }`} 
                        />
                        <span>{item.name}</span>
                      </div>
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent ring-2 ring-ellevee-accent/20" />
                      )}
                    </Link>
                  )
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* Rodapé da Sidebar: SuperAdmin + Ambiente Demo + Voltar ao App */}
        <div className="p-3.5 border-t border-white/10 bg-black/20 space-y-3">
          {/* Perfil SuperAdmin */}
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="h-8 w-8 rounded-full bg-white/15 border border-white/20 text-white flex items-center justify-center font-display font-bold text-xs shrink-0">
              P
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-white truncate">
                Phelipi
              </span>
              <span className="text-[10px] text-[#A6B5A6] truncate">
                SuperAdmin Master
              </span>
            </div>
          </div>

          {/* Identificação Clara de Ambiente Demo / Simulação */}
          <div className="px-2.5 py-1.5 rounded bg-white/10 border border-white/15 flex items-center justify-between text-[11px]">
            <span className="text-[#A6B5A6] font-medium">Ambiente:</span>
            <span className="font-semibold text-ellevee-accent flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent" />
              SIMULAÇÃO
            </span>
          </div>

          {/* Link para o App Principal */}
          <div className="pt-1 px-1">
            <Link
              href="/dashboard"
              className="flex items-center justify-between text-xs text-[#A6B5A6] hover:text-white transition-colors py-1 group"
            >
              <span className="text-[11px] font-medium">Voltar ao App</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-[#A6B5A6] group-hover:text-white transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Área Principal */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar Discreta */}
        <header className="h-16 bg-white border-b border-ellevee-stone px-6 lg:px-8 flex items-center justify-between shrink-0 z-10">
          {/* Breadcrumb da Página Atual */}
          <div className="flex items-center gap-2 text-xs font-medium text-ellevee-sage">
            <span className="hover:text-ellevee-ink transition-colors font-display">Ellevee IA</span>
            <ChevronRight className="h-3.5 w-3.5 text-ellevee-stone stroke-[2.5]" />
            <span className="text-ellevee-sage">{breadcrumb.section}</span>
            <ChevronRight className="h-3.5 w-3.5 text-ellevee-stone stroke-[2.5]" />
            <span className="font-semibold text-ellevee-ink font-display">{breadcrumb.page}</span>
          </div>

          {/* Centro: Busca Global com Estilo Limpo */}
          <div className="hidden md:flex items-center w-80">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ellevee-sage" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Busca global no SuperAdmin..."
                className="w-full bg-[#F8F8F5] border border-ellevee-stone rounded-md pl-9 pr-9 py-1.5 text-xs text-ellevee-ink placeholder:text-ellevee-sage/70 focus:outline-none focus:ring-1 focus:ring-ellevee-ink focus:bg-white transition-colors"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ellevee-sage/60 border border-ellevee-stone/80 px-1 rounded bg-white">
                ⌘K
              </span>
            </div>
          </div>

          {/* Direita: Indicador de Ambiente e Perfil */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#F8F8F5] border border-ellevee-stone text-ellevee-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span>Modo Demonstração</span>
            </div>

            <div className="h-4 w-px bg-ellevee-stone" />

            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-ellevee-ink text-white flex items-center justify-center font-display font-semibold text-xs">
                P
              </div>
              <span className="text-xs font-semibold text-ellevee-ink hidden sm:inline">
                Phelipi
              </span>
            </div>
          </div>
        </header>

        {/* Área de Conteúdo */}
        <main className="flex-1 p-6 lg:p-8 overflow-y-auto max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
