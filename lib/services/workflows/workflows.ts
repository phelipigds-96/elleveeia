import { createClient } from '@/lib/supabase/server'

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

async function getCompanyId(supabase: any) {
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', userData.user.id).single()
  if (!profile?.company_id) throw new Error("Company not found")
  return profile.company_id
}

export async function getCompanyWorkflows() {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)
  
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

export async function createWorkflow(name: string, description?: string) {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)

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

export async function createWorkflowStage(workflowId: string, name: string, stageType: string = 'in_progress') {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)

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

export async function updateWorkflowStage(stageId: string, updates: any) {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)
  
  // Clean payload
  delete updates.id
  delete updates.company_id
  delete updates.workflow_id
  
  const { error } = await supabase
    .from('workflow_stages')
    .update(updates)
    .eq('id', stageId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}

export async function deleteWorkflowStage(stageId: string) {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)
  
  const { error } = await supabase
    .from('workflow_stages')
    .delete()
    .eq('id', stageId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}

export async function moveConversationStage(conversationId: string, stageId: string) {
  const supabase = createClient()
  const companyId = await getCompanyId(supabase)
  
  const { error } = await supabase
    .from('conversations')
    .update({ workflow_stage_id: stageId })
    .eq('id', conversationId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}
