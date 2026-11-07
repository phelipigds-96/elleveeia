"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  LayoutDashboard,
  Building2,
  Layers,
  Bot,
  Cpu,
  ShieldCheck,
  Settings,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Command,
} from "lucide-react"

interface CommandItem {
  id: string
  title: string
  subtitle: string
  href: string
  icon: React.ElementType
  category: "Navegação" | "Ações Rápidas"
  badge?: string
}

const COMMANDS: CommandItem[] = [
  {
    id: "nav-dashboard",
    title: "Dashboard Executivo",
    subtitle: "Métricas consolidadas, MRR ativo e volume de mensagens",
    href: "/paineladmin",
    icon: LayoutDashboard,
    category: "Navegação",
    badge: "Visão Geral",
  },
  {
    id: "nav-companies",
    title: "Gestão de Empresas",
    subtitle: "Listagem de clientes, provisionamento, CNPJ e Impersonate",
    href: "/companies",
    icon: Building2,
    category: "Navegação",
    badge: "Multi-tenant",
  },
  {
    id: "nav-plans",
    title: "Planos e Limites Operacionais",
    subtitle: "Cotas mensais de mensagens, limites de agentes e tabela de preços",
    href: "/plans",
    icon: Layers,
    category: "Navegação",
    badge: "Comercial",
  },
  {
    id: "nav-agents",
    title: "Agentes de Inteligência Artificial",
    subtitle: "Telemetria global, kill-switch e biblioteca de blueprints",
    href: "/agents",
    icon: Bot,
    category: "Navegação",
    badge: "Agentes",
  },
  {
    id: "nav-providers",
    title: "Provedores & Infraestrutura de IA",
    subtitle: "OpenAI primária, teste de ping, workers de mensageria e locks",
    href: "/providers",
    icon: Cpu,
    category: "Navegação",
    badge: "OpenAI",
  },
  {
    id: "nav-audit",
    title: "Trilha de Auditoria Global",
    subtitle: "Logs imutáveis de governança, alterações e suporte",
    href: "/audit",
    icon: ShieldCheck,
    category: "Navegação",
    badge: "Governança",
  },
  {
    id: "nav-settings",
    title: "Configurações Globais",
    subtitle: "Parâmetros centrais do sistema e credenciais de infraestrutura",
    href: "/admin-settings",
    icon: Settings,
    category: "Navegação",
  },
  {
    id: "nav-app",
    title: "Alternar para Painel do Cliente",
    subtitle: "Visualizar a interface padrão de atendimento e kanban",
    href: "/dashboard",
    icon: ExternalLink,
    category: "Ações Rápidas",
    badge: "App Tenant",
  },
]

interface AdminCommandPaletteProps {
  open: boolean
  onClose: () => void
}

export default function AdminCommandPalette({
  open,
  onClose,
}: AdminCommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filtragem dos comandos pela busca
  const filtered = COMMANDS.filter((cmd) => {
    const q = query.toLowerCase().trim()
    if (!q) return true
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.subtitle.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q)
    )
  })

  // Listener para fechar com ESC ou navegar com setas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return

      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1))
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault()
        handleSelect(filtered[selectedIndex].href)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, filtered, selectedIndex])

  // Reset de seleção ao mudar a busca
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!open) return null

  const handleSelect = (href: string) => {
    onClose()
    setQuery("")
    router.push(href)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      {/* Backdrop suave */}
      <div
        className="fixed inset-0 bg-ellevee-ink/60 backdrop-blur-sm transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Surface do Command Palette */}
      <div className="relative z-50 w-full max-w-xl rounded-2xl border border-ellevee-stone/80 bg-white shadow-2xl overflow-hidden transition-all animate-in zoom-in-95">
        {/* Barra de Busca */}
        <div className="flex items-center px-4 py-3.5 border-b border-ellevee-stone/60 gap-3 bg-[#FBFBFA]">
          <Search className="w-4 h-4 text-ellevee-sage shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="O que você deseja buscar ou acessar? (ex: empresas, planos, openai...)"
            className="w-full text-xs bg-transparent text-ellevee-ink placeholder:text-ellevee-sage/70 focus:outline-none font-sans"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono text-ellevee-sage bg-white border border-ellevee-stone px-1.5 py-0.5 rounded shadow-2xs">
            ESC
          </kbd>
        </div>

        {/* Lista de Destinos */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-ellevee-sage">
              Nenhum comando ou página encontrada para &quot;{query}&quot;.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon
              const isSelected = idx === selectedIndex

              return (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item.href)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all text-xs ${
                    isSelected
                      ? "bg-ellevee-ink text-white shadow-sm"
                      : "text-ellevee-ink hover:bg-ellevee-ivory/60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 transition-colors ${
                        isSelected
                          ? "bg-white/15 text-ellevee-accent"
                          : "bg-ellevee-ivory border border-ellevee-stone/60 text-ellevee-ink"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs truncate">
                          {item.title}
                        </span>
                        {item.badge && (
                          <span
                            className={`text-[9px] font-mono font-medium px-1.5 py-0.2 rounded border ${
                              isSelected
                                ? "bg-white/10 text-white/80 border-white/20"
                                : "bg-ellevee-ivory text-ellevee-sage border-ellevee-stone"
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[11px] truncate mt-0.5 ${
                          isSelected ? "text-white/70" : "text-ellevee-sage"
                        }`}
                      >
                        {item.subtitle}
                      </span>
                    </div>
                  </div>

                  <ArrowRight
                    className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                      isSelected
                        ? "text-ellevee-accent translate-x-0.5"
                        : "text-ellevee-sage/40 opacity-0 group-hover:opacity-100"
                    }`}
                  />
                </button>
              )
            })
          )}
        </div>

        {/* Rodapé do Menu com Atalhos */}
        <div className="px-4 py-2.5 bg-[#FBFBFA] border-t border-ellevee-stone/60 flex items-center justify-between text-[11px] text-ellevee-sage">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-white border border-ellevee-stone rounded text-[10px] font-mono">
                ↑
              </kbd>
              <kbd className="px-1 py-0.5 bg-white border border-ellevee-stone rounded text-[10px] font-mono">
                ↓
              </kbd>
              Navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white border border-ellevee-stone rounded text-[10px] font-mono">
                ↵
              </kbd>
              Selecionar
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-800 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
            Produção Ativa
          </span>
        </div>
      </div>
    </div>
  )
}
