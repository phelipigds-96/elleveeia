import { User, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/(auth)/actions'

export async function Header() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  let profile = null
  let company = null

  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*, companies(*)')
      .eq('id', user.id)
      .single()
      
    if (profileData) {
      profile = profileData
      company = profileData.companies
    }
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/20 px-6 lg:h-[60px]">
      <div className="w-full flex-1">
        {/* Titulo ou breadcrumbs podem vir aqui */}
      </div>
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-end text-sm font-medium">
          <span className="text-foreground leading-none">{profile?.full_name || user?.email || 'Usuário'}</span>
          <span className="text-muted-foreground text-xs">{company?.name || 'Carregando...'}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <User className="h-4 w-4" />
          </div>
          
          <form action={logout}>
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
