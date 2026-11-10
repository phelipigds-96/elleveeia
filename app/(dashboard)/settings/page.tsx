import { createClient } from '@/lib/supabase/server'
import { requireCompanyAdmin } from '@/lib/services/auth/guard'
import { SettingsTabsView } from '@/components/settings/settings-tabs-view'
import {
  getCompanyMembersAction,
  getCloseReasonsAction,
  getCompanyClosePolicyAction,
  getQuickRepliesAction,
} from './actions'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: "Configurações da Empresa | Ellevee IA",
  description: "Gerencie equipe, motivos de finalização de atendimento e mensagens rápidas.",
}

export default async function SettingsPage() {
  // Barreira de proteção: apenas Admin ou Owner da empresa pode acessar Configurações
  const currentProfile = await requireCompanyAdmin()
  
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  let company = null

  if (user) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('company_id, role, companies(*)')
      .eq('id', user.id)
      .single()
      
    if (profileData) {
      company = profileData.companies as any
    }
  }

  // Consulta em paralelo os dados de equipe, motivos de finalização, política e mensagens rápidas
  const [members, closeReasons, closePolicy, quickReplies] = await Promise.all([
    getCompanyMembersAction(),
    getCloseReasonsAction(),
    getCompanyClosePolicyAction(),
    getQuickRepliesAction(),
  ])

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ellevee-deep-ink">Configurações</h1>
        <p className="text-xs text-ellevee-text-secondary mt-1">
          Gerencie a equipe de atendimento, mensagens rápidas, motivos de encerramento e cadastro corporativo.
        </p>
      </div>

      <SettingsTabsView
        initialMembers={members}
        currentUserId={user?.id || currentProfile.id}
        company={company}
        closeReasons={closeReasons}
        requireCloseReason={closePolicy.requireCloseReason}
        quickReplies={quickReplies}
      />
    </div>
  )
}
