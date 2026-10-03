import { createClient } from '@/lib/supabase/server'
import { CompanyForm } from './components/company-form'

export default async function SettingsPage() {
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

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Gerencie as configurações da sua empresa e usuários.</p>
      </div>

      <div className="grid gap-6">
        
        {/* Empresa */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 border-b">
            <h3 className="font-semibold leading-none tracking-tight">Empresa</h3>
            <p className="text-sm text-muted-foreground">Dados cadastrais do seu tenant.</p>
          </div>
          <div className="p-6">
            <CompanyForm company={company} />
          </div>
        </div>

        {/* Usuários */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 border-b">
            <h3 className="font-semibold leading-none tracking-tight">Usuários</h3>
            <p className="text-sm text-muted-foreground">Gerencie quem tem acesso ao painel da sua empresa.</p>
          </div>
          <div className="p-6">
            <div className="text-sm text-muted-foreground mb-4">
              Apenas o administrador atual está cadastrado. Funcionalidade de convite em breve.
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
            >
              Convidar Usuário
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
