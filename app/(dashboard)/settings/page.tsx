import { createClient } from '@/lib/supabase/server'
import { requireCompanyAdmin } from '@/lib/services/auth/guard'
import { CompanyForm } from './components/company-form'
import { TeamManagement } from '@/components/settings/team-management'
import { getCompanyMembersAction } from './actions'

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

  // Consulta lista de membros da equipe
  const members = await getCompanyMembersAction()

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Gerencie as configurações da sua organização e equipe de atendimento.</p>
      </div>

      <div className="grid gap-6">
        {/* Gestão de Equipe e Atendentes */}
        <TeamManagement initialMembers={members} currentUserId={user?.id || currentProfile.id} />

        {/* Dados Cadastrais da Empresa */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 border-b">
            <h3 className="font-semibold leading-none tracking-tight">Empresa</h3>
            <p className="text-sm text-muted-foreground">Dados cadastrais do seu tenant.</p>
          </div>
          <div className="p-6">
            <CompanyForm company={company} />
          </div>
        </div>
      </div>
    </div>
  )
}
