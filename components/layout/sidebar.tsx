"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  LayoutDashboard, 
  MessageSquare, 
  Users, 
  Bot, 
  BookOpen, 
  Wrench, 
  Plug, 
  Settings,
  ShieldCheck,
  ChevronRight,
  Headphones,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react"
import { ElleveeLogo } from "@/components/ui/ellevee-logo"

interface NavLinkItem {
  href: string
  label: string
  icon: React.ElementType
  disabled?: boolean
  badge?: string
}

interface NavSection {
  title: string
  items: NavLinkItem[]
}

const ADMIN_NAVIGATION_SECTIONS: NavSection[] = [
  {
    title: "PRINCIPAL",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/conversations", label: "Conversas", icon: MessageSquare },
      { href: "/customers", label: "Clientes", icon: Users },
      { href: "/catalog", label: "Catálogo", icon: BookOpen },
    ],
  },
  {
    title: "AGENTE IA",
    items: [
      { href: "/agent", label: "Agentes", icon: Bot },
      { href: "#", label: "Conhecimento", icon: BookOpen, disabled: true, badge: "Em breve" },
      { href: "#", label: "Ferramentas", icon: Wrench, disabled: true, badge: "Em breve" },
    ],
  },
  {
    title: "SISTEMA",
    items: [
      { href: "/integrations", label: "Integrações", icon: Plug },
      { href: "/settings", label: "Configurações", icon: Settings },
    ],
  },
]

const ATTENDANT_NAVIGATION_SECTIONS: NavSection[] = [
  {
    title: "ATENDIMENTO",
    items: [
      { href: "/conversations", label: "Conversas & Chat", icon: MessageSquare },
    ],
  },
]

const STORAGE_KEY = "ellevee:sidebar-collapsed"

interface SidebarProps {
  userRole?: string
}

export function Sidebar({ userRole = "admin" }: SidebarProps) {
  const pathname = usePathname()
  const isAttendant = userRole === "attendant" || userRole === "user"
  const navigationSections = isAttendant
    ? ATTENDANT_NAVIGATION_SECTIONS
    : ADMIN_NAVIGATION_SECTIONS

  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Restaura a preferência salva apenas no cliente, evitando divergência de hidratação.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true")
    } catch {
      // localStorage indisponível (modo privado): mantém expandido.
    }
    setMounted(true)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // Ignora falha de persistência: o estado visual ainda funciona na sessão.
      }
      return next
    })
  }

  const isCollapsed = mounted && collapsed

  return (
    <aside
      data-collapsed={isCollapsed ? "true" : "false"}
      className={`bg-ellevee-ink text-white flex flex-col justify-between shrink-0 border-r border-white/10 hidden md:flex z-20 selection:bg-ellevee-accent selection:text-ellevee-ink transition-[width] duration-200 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      <div>
        {/* Header da Marca: Logotipo Oficial Ellevee IA */}
        <div className={`h-16 flex items-center border-b border-white/10 ${
          isCollapsed ? "justify-center px-2" : "px-5"
        }`}>
          {isCollapsed ? (
            <ElleveeLogo variant="icon" size="sm" href="/dashboard" />
          ) : (
            <ElleveeLogo
              variant="full"
              theme="dark"
              size="md"
              badge={isAttendant ? "ATENDENTE" : "PORTAL"}
              href="/dashboard"
              priority
            />
          )}
        </div>

        {/* Botão de recolher/expandir */}
        <div className={`flex items-center border-b border-white/10 ${isCollapsed ? "justify-center px-2 py-2" : "px-3.5 py-2"}`}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!isCollapsed}
            aria-controls="sidebar-navigation"
            aria-label={isCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={isCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-white/60 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" />
                <span className="text-[11px] font-medium">Recolher menu</span>
              </>
            )}
          </button>
        </div>

        {/* Menus Estruturados */}
        <nav id="sidebar-navigation" className="p-3.5 space-y-5">
          {navigationSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#A6B5A6] font-sans">
                  {section.title}
                </div>
              )}
              {isCollapsed && <div className="mx-2 border-t border-white/10" />}
              {section.items.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))

                if (item.disabled) {
                  return (
                    <div
                      key={item.label}
                      title={isCollapsed ? `${item.label} (${item.badge || "indisponível"})` : undefined}
                      aria-disabled="true"
                      className={`flex items-center rounded-md text-xs font-medium text-white/40 cursor-not-allowed select-none ${
                        isCollapsed ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-white/30 shrink-0" />
                        {!isCollapsed && <span>{item.label}</span>}
                      </div>
                      {!isCollapsed && item.badge && (
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-white/10 text-white/50 border border-white/10 font-mono">
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )
                }

                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    title={isCollapsed ? item.label : undefined}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center rounded-md text-xs font-medium transition-colors ${
                      isCollapsed ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
                    } ${
                      isActive
                        ? "bg-white/10 text-white font-semibold shadow-2xs"
                        : "text-[#A6B5A6] hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-ellevee-accent" : "text-[#A6B5A6]"}`} />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </div>
                    {!isCollapsed && isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent shrink-0" />
                    )}
                    {isCollapsed && isActive && (
                      <span className="sr-only">Seção atual</span>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </div>

      {/* Footer da Sidebar: Atalho SuperAdmin disponível apenas para Administradores */}
      {!isAttendant && (
        <div className={`p-3.5 border-t border-white/10 space-y-2`}>
          <Link
            href="/paineladmin"
            title={isCollapsed ? "Painel SuperAdmin" : undefined}
            className={`flex items-center rounded-md text-xs font-medium text-[#A6B5A6] hover:text-white hover:bg-white/5 transition-colors border border-white/5 ${
              isCollapsed ? "justify-center px-2 py-2" : "justify-between px-3 py-2"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-ellevee-accent shrink-0" />
              {!isCollapsed && <span>Painel SuperAdmin</span>}
            </div>
            {!isCollapsed && <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
          </Link>
        </div>
      )}
    </aside>
  )
}
