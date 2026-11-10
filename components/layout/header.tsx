import Link from 'next/link'
import { User, LogOut, Search, Building2, Headphones, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/(auth)/actions'
import { ElleveeLogo } from '@/components/ui/ellevee-logo'

interface HeaderProps {
  userRole?: string
}

export async function Header({ userRole = 'admin' }: HeaderProps) {
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

  const isAttendant = (profile?.role || userRole) === 'attendant' || (profile?.role || userRole) === 'user'
  const isOwner = (profile?.role || userRole) === 'owner'
  const displayName = profile?.full_name || (isAttendant ? 'Atendente' : 'Administrador')
  const companyName = company?.name || 'Ellevee IA'
  const monogram = displayName.slice(0, 1).toUpperCase() || 'O'

  return (
    <header className="h-16 border-b border-ellevee-border bg-white/90 backdrop-blur-md px-6 flex items-center justify-between z-10 shrink-0 shadow-2xs">
      {/* Esquerda: Breadcrumb corporativo com Logotipo */}
      <div className="flex items-center gap-2 text-xs">
        <Link href="/dashboard" className="flex items-center gap-1.5 hover:opacity-85 transition-opacity">
          <ElleveeLogo variant="icon" size="xs" />
          <span className="font-display font-semibold text-ellevee-deep-ink">
            Ellevee
          </span>
          <span className="font-display font-extrabold bg-gradient-to-r from-[#7028D9] via-[#087BEA] to-[#16BCE0] bg-clip-text text-transparent">
            IA
          </span>
        </Link>
        <ChevronRight className="h-3 w-3 text-ellevee-border" />
        <span className="font-semibold text-ellevee-deep-ink">
          {isAttendant ? 'Atendimento' : 'Plataforma'}
        </span>
        <ChevronRight className="h-3 w-3 text-ellevee-border" />
        <span className="text-ellevee-text-secondary font-medium">
          {isAttendant ? 'Chat de Conversas' : 'Atendimento Omnichannel'}
        </span>
      </div>

      {/* Direita: Organização ativa, Perfil e Logout */}
      <div className="flex items-center gap-4">
        {/* Badge da Empresa / Tenant */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-ellevee-warm-ivory border border-ellevee-border text-ellevee-deep-ink shadow-2xs">
          <Building2 className="h-3.5 w-3.5 text-ellevee-blue" />
          <span className="font-semibold">{companyName}</span>
        </div>

        <div className="h-4 w-px bg-ellevee-border hidden sm:block" />

        {/* Perfil com Monograma */}
        <div className="flex items-center gap-2.5">
          <div className={`h-7 w-7 rounded-full flex items-center justify-center font-display font-semibold text-xs shrink-0 shadow-2xs ${
            isAttendant 
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
              : 'bg-ellevee-deep-ink text-white'
          }`}>
            {monogram}
          </div>
          <div className="flex flex-col text-left hidden sm:flex">
            <span className="text-xs font-semibold text-ellevee-deep-ink leading-tight">
              {displayName}
            </span>
            <span className={`text-[10px] leading-tight font-medium ${
              isAttendant ? 'text-emerald-700 font-semibold' : 'text-ellevee-text-secondary'
            }`}>
              {isAttendant ? 'Atendente' : isOwner ? 'Proprietário' : 'Administrador'}
            </span>
          </div>
        </div>

        <div className="h-4 w-px bg-ellevee-border" />

        {/* Botão Logout */}
        <form action={logout}>
          <button 
            type="submit" 
            className="h-8 w-8 rounded-lg border border-ellevee-border bg-white hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-ellevee-text-secondary flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
            title="Sair da sessão"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    </header>
  )
}
