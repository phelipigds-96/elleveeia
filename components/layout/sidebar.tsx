import Link from 'next/link'
import { LayoutDashboard, MessageSquare, Users, Bot, BookOpen, Wrench, Plug, Settings } from 'lucide-react'

const mainLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/conversations', label: 'Conversas', icon: MessageSquare },
  { href: '/customers', label: 'Clientes', icon: Users },
  { href: '/catalog', label: 'Catálogo', icon: BookOpen },
]

const agentLinks = [
  { href: '/agent', label: 'Agentes', icon: Bot },
  { href: '#', label: 'Conhecimento (Em breve)', icon: BookOpen, disabled: true },
  { href: '#', label: 'Ferramentas (Em breve)', icon: Wrench, disabled: true },
]

const systemLinks = [
  { href: '/integrations', label: 'Integrações', icon: Plug },
  { href: '/settings', label: 'Configurações', icon: Settings },
]

export function Sidebar() {
  return (
    <aside className="w-64 border-r bg-muted/20 hidden md:block flex-shrink-0">
      <div className="flex h-full flex-col">
        <div className="flex h-14 items-center border-b px-6">
          <Link href="/dashboard" className="font-semibold text-lg tracking-tight">
            Ellevee IA
          </Link>
        </div>
        
        <div className="flex-1 overflow-auto py-4">
          <nav className="grid items-start px-4 text-sm font-medium space-y-6">
            
            {/* Principal */}
            <div>
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Principal
              </h3>
              <div className="space-y-1">
                {mainLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary hover:bg-muted"
                  >
                    <link.icon className="h-4 w-4" />
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Agente */}
            <div>
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Agente
              </h3>
              <div className="space-y-1">
                {agentLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all ${
                      link.disabled 
                        ? 'text-muted-foreground/50 cursor-not-allowed' 
                        : 'text-muted-foreground hover:text-primary hover:bg-muted'
                    }`}
                  >
                    <link.icon className="h-4 w-4" />
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* Sistema */}
            <div>
              <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sistema
              </h3>
              <div className="space-y-1">
                {systemLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary hover:bg-muted"
                  >
                    <link.icon className="h-4 w-4" />
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
            
          </nav>
        </div>
      </div>
    </aside>
  )
}
