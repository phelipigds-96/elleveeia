import { createClient } from '@/lib/supabase/server'
import { getCompanyWorkflows } from '@/lib/services/workflows/workflows'
import { WorkflowSettingsClient } from './components/workflow-settings-client'

export const dynamic = 'force-dynamic'

export default async function WorkflowsSettingsPage() {
  const supabase = createClient()
  const { data: userData } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', userData.user?.id).single()
  
  let initialWorkflows: any[] = []
  if (profile?.company_id) {
    initialWorkflows = await getCompanyWorkflows(profile.company_id)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workflows de Atendimento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure as etapas do funil de atendimento e vendas da sua empresa. O quadro Kanban da Central de Conversas usará estas etapas.
        </p>
      </div>
      
      <WorkflowSettingsClient initialWorkflows={initialWorkflows} companyId={profile?.company_id} />
    </div>
  )
}
