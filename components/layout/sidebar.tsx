"use client"

import React from "react"
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
  Headphones
} from "lucide-react"

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

interface SidebarProps {
  userRole?: string
}

export function Sidebar({ userRole = "admin" }: SidebarProps) {
  const pathname = usePathname()
  const isAttendant = userRole === "attendant" || userRole === "user"
  const navigationSections = isAttendant
    ? ATTENDANT_NAVIGATION_SECTIONS
    : ADMIN_NAVIGATION_SECTIONS

  return (
    <aside className="w-64 bg-ellevee-ink text-white flex flex-col justify-between shrink-0 border-r border-white/10 hidden md:flex z-20 selection:bg-ellevee-accent selection:text-ellevee-ink">
      <div>
        {/* Header da Marca */}
        <div className="h-16 flex items-center px-6 border-b border-white/10 gap-3">
          <div className="h-8 w-8 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
            {isAttendant ? (
              <Headphones className="w-4 h-4 text-ellevee-accent" />
            ) : (
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
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base tracking-tight text-white leading-none">
                Ellevee IA
              </span>
              <span className={`text-[9px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded border ${
                isAttendant 
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                  : "bg-white/10 border-white/15 text-ellevee-accent"
              }`}>
                {isAttendant ? "ATENDENTE" : "PORTAL"}
              </span>
            </div>
            <span className="text-[10px] text-[#A6B5A6] font-medium tracking-tight mt-0.5">
              {isAttendant ? "Central de Atendimento" : "Plataforma Omnichannel"}
            </span>
          </div>
        </div>

        {/* Menus Estruturados */}
        <nav className="p-3.5 space-y-5">
          {navigationSections.map((section) => (
            <div key={section.title} className="space-y-1">
              <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#A6B5A6] font-sans">
                {section.title}
              </div>
              {section.items.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))

                if (item.disabled) {
                  return (
                    <div
                      key={item.label}
                      className="flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium text-white/40 cursor-not-allowed select-none"
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 text-white/30" />
                        <span>{item.label}</span>
                      </div>
                      {item.badge && (
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
                    className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-white/10 text-white font-semibold shadow-2xs"
                        : "text-[#A6B5A6] hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`h-4 w-4 ${isActive ? "text-ellevee-accent" : "text-[#A6B5A6]"}`} />
                      <span>{item.label}</span>
                    </div>
                    {isActive && (
                      <span className="h-1.5 w-1.5 rounded-full bg-ellevee-accent" />
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
        <div className="p-3.5 border-t border-white/10 space-y-2">
          <Link
            href="/paineladmin"
            className="flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium text-[#A6B5A6] hover:text-white hover:bg-white/5 transition-colors border border-white/5"
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-4 w-4 text-ellevee-accent" />
              <span>Painel SuperAdmin</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-white/40" />
          </Link>
        </div>
      )}
    </aside>
  )
}
