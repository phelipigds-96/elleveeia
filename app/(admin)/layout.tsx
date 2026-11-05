import React from "react"
import Link from "next/link"
import { 
  Building2, 
  LayoutDashboard, 
  ShieldCheck, 
  Settings, 
  Activity, 
  ExternalLink,
  Users,
  Search,
  Bell,
  Sparkles,
  Database
} from "lucide-react"

export const metadata = {
  title: "SuperAdmin | Ellevée IA",
  description: "Painel de Controle e Governança Multi-Tenant da Ellevée IA",
}

const NAV_ITEMS = [
  { name: "Dashboard", href: "/paineladmin", icon: LayoutDashboard },
  { name: "Empresas", href: "/companies", icon: Building2 },
  { name: "Auditoria", href: "/audit", icon: ShieldCheck },
  { name: "Configurações", href: "/admin-settings", icon: Settings },
]

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased">
      {/* Top Banner de Ambiente */}
      <div className="bg-slate-900 text-slate-300 px-4 py-1.5 text-xs flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-white tracking-wide">ELLEVÉE IA · SUPERADMIN ROOT</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 flex items-center gap-1 font-mono">
            <Database className="h-3 w-3 text-indigo-400" />
            Supabase Cloud (sa-east-1)
          </span>
        </div>
        <div className="flex items-center gap-3 text-slate-400 text-[11px]">
          <span className="hidden sm:inline">Engine Transacional: Ativo (32/32 migrations)</span>
          <span className="bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded font-mono border border-indigo-700/50">
            RLS Multi-Tenant
          </span>
        </div>
      </div>

      <div className="flex flex-1">
        {/* Sidebar Lateral */}
        <aside className="w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between shrink-0 shadow-sm">
          <div>
            {/* Header da Sidebar */}
            <div className="h-16 flex items-center px-6 border-b border-slate-100 gap-3">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-slate-900 via-indigo-950 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-indigo-950/20">
                <Sparkles className="h-5 w-5 text-indigo-300" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-base tracking-tight text-slate-900">Ellevée</span>
                  <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/60">
                    ADMIN
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 font-medium">Infraestrutura Multi-Tenant</span>
              </div>
            </div>

            {/* Links de Navegação */}
            <nav className="p-4 space-y-1">
              <div className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Gestão da Plataforma
              </div>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-all group"
                  >
                    <Icon className="h-4 w-4 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                    <span>{item.name}</span>
                  </Link>
                )
              })}
            </nav>
          </div>

          {/* Footer da Sidebar: Perfil do SuperAdmin */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="h-9 w-9 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-xs ring-2 ring-indigo-500/20">
                SA
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-slate-800 truncate">Phelipi (SuperAdmin)</span>
                <span className="text-[11px] text-slate-400 truncate">admin@elleveeia.com</span>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                Autenticado
              </span>
              <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 text-[11px] font-medium">
                Ir p/ App <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </aside>

        {/* Conteúdo Principal */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header className="h-16 bg-white border-b border-slate-200/80 px-8 flex items-center justify-between shrink-0 shadow-sm">
            <div className="flex items-center gap-4 w-96">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Pesquisar empresas, clientes ou slugs..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:bg-white transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Worker Outbox: Saudável
              </div>
              <div className="h-4 w-px bg-slate-200" />
              <button className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors relative">
                <Bell className="h-4 w-4" />
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-indigo-600 ring-2 ring-white"></span>
              </button>
            </div>
          </header>

          {/* Área de Página com scroll independente */}
          <main className="flex-1 p-8 overflow-y-auto max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
