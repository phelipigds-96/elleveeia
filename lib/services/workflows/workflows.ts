import { createAdminClient } from '@/lib/supabase/service'

export interface Workflow {
  id: string
  company_id: string
  name: string
  description: string | null
  is_default: boolean
  is_active: boolean
}

export interface WorkflowStage {
  id: string
  workflow_id: string
  company_id: string
  name: string
  description: string | null
  position: number
  stage_type: 'initial' | 'in_progress' | 'final'
  is_active: boolean
}

export async function getCompanyWorkflows(companyId: string) {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  // Order stages by position
  const workflows = data?.map(wf => {
    const stages = (wf.workflow_stages || []).sort((a: any, b: any) => a.position - b.position)
    return { ...wf, workflow_stages: stages }
  })

  return workflows || []
}

export async function createWorkflow(companyId: string, name: string, description?: string) {
  const supabase = createAdminClient()

  // Verify if it's the first one, make it default
  const { count } = await supabase.from('workflows').select('*', { count: 'exact', head: true }).eq('company_id', companyId)
  const isDefault = count === 0

  const { data, error } = await supabase
    .from('workflows')
    .insert({ company_id: companyId, name, description, is_default: isDefault })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function createWorkflowStage(companyId: string, workflowId: string, name: string, stageType: string = 'in_progress') {
  const supabase = createAdminClient()

  // Get max position
  const { data: stages } = await supabase
    .from('workflow_stages')
    .select('position')
    .eq('workflow_id', workflowId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPos = stages && stages.length > 0 ? stages[0].position + 1 : 0

  const { data, error } = await supabase
    .from('workflow_stages')
    .insert({
      company_id: companyId,
      workflow_id: workflowId,
      name,
      position: nextPos,
      stage_type: stageType
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function moveConversationStage(companyId: string, conversationId: string, stageId: string) {
  const supabase = createAdminClient()
  
  // Update the conversation directly. Ensures it belongs to company
  const { error } = await supabase
    .from('conversations')
    .update({ workflow_stage_id: stageId })
    .eq('company_id', companyId)
    .eq('id', conversationId)

  if (error) throw new Error(error.message)
}
