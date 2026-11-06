import { User, LogOut, Search, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/(auth)/actions'

export async function Header() {
  const supabase = createClient()
  let profile = null
  let company = null

  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*, companies(*)')
        .eq('id', user.id)
        .maybeSingle()
        
      if (profileData) {
        profile = profileData
        company = profileData.companies as any
      }
    }
  } catch {
    // Modo preview
  }

  const displayName = profile?.full_name || 'Operador'
  const companyName = company?.name || 'Ellevee IA'
  const monogram = displayName.slice(0, 1).toUpperCase() || 'P'

  return (
    <header className="h-16 border-b border-ellevee-stone bg-white/90 backdrop-blur-md px-6 flex items-center justify-between z-10 shrink-0">
      {/* Esquerda: Breadcrumb corporativo */}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-ellevee-ink">Plataforma</span>
        <span className="text-ellevee-stone font-mono">/</span>
        <span className="text-ellevee-sage font-medium">Atendimento Omnichannel</span>
      </div>

      {/* Direita: Organização ativa, Perfil e Logout */}
      <div className="flex items-center gap-4">
        {/* Badge da Empresa / Tenant */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#F8F8F5] border border-ellevee-stone text-ellevee-ink">
          <Building2 className="h-3.5 w-3.5 text-ellevee-sage" />
          <span className="font-semibold">{companyName}</span>
        </div>

        <div className="h-4 w-px bg-ellevee-stone hidden sm:block" />

        {/* Perfil com Monograma */}
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-ellevee-ink text-white flex items-center justify-center font-display font-semibold text-xs shrink-0 shadow-2xs">
            {monogram}
          </div>
          <div className="flex flex-col text-left hidden sm:flex">
            <span className="text-xs font-semibold text-ellevee-ink leading-tight">
              {displayName}
            </span>
            <span className="text-[10px] text-ellevee-sage leading-tight">
              Operador
            </span>
          </div>
        </div>

        <div className="h-4 w-px bg-ellevee-stone" />

        {/* Botão Logout */}
        <form action={logout}>
          <button 
            type="submit" 
            className="h-8 w-8 rounded-md border border-ellevee-stone bg-[#F8F8F5] hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-ellevee-sage flex items-center justify-center transition-colors cursor-pointer"
            title="Sair da sessão"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </header>
  )
}
