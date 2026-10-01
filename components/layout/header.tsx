import { User, LogOut } from 'lucide-react'
import Link from 'next/link'

export function Header() {
  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/20 px-6 lg:h-[60px]">
      <div className="w-full flex-1">
        {/* Futuramente breadcrumbs ou titulo da pagina aqui */}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-muted-foreground hidden md:inline-block">Empresa Teste</span>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="relative flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <User className="h-4 w-4" />
          </button>
          
          <form action="/auth/signout" method="post">
            <button 
              type="submit" 
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
