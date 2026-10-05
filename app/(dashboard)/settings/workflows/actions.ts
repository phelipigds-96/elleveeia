'use server'

import { createClient } from '@/lib/supabase/server'
import { createWorkflow, createWorkflowStage } from '@/lib/services/workflows/workflows'
import { revalidatePath } from 'next/cache'

export async function createDefaultWorkflowAction() {
  const supabase = createClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw new Error('Unauthorized')

  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', userData.user.id).single()
  const companyId = profile?.company_id

  if (!companyId) throw new Error('Company not found')

  // Create the workflow
  const workflow = await createWorkflow(companyId, 'Atendimento Principal', 'Funil padrão de conversas')

  // Create default stages
  await createWorkflowStage(companyId, workflow.id, 'Novo Contato', 'initial')
  await createWorkflowStage(companyId, workflow.id, 'Em Atendimento', 'in_progress')
  await createWorkflowStage(companyId, workflow.id, 'Finalizado', 'final')

  revalidatePath('/settings/workflows')
  revalidatePath('/conversations')
  
  return workflow
}
