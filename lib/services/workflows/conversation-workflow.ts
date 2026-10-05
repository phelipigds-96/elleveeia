import { createAdminClient } from '@/lib/supabase/service'

export async function assignConversationWorkflow(companyId: string, conversationId: string, workflowId: string) {
  const supabase = createAdminClient()

  // Set the workflow, and automatically set the stage to the first position
  const { data: stages } = await supabase
    .from('workflow_stages')
    .select('id')
    .eq('workflow_id', workflowId)
    .order('position', { ascending: true })
    .limit(1)

  const firstStageId = stages && stages.length > 0 ? stages[0].id : null

  const { error } = await supabase
    .from('conversations')
    .update({ 
      workflow_id: workflowId,
      workflow_stage_id: firstStageId
    })
    .eq('company_id', companyId)
    .eq('id', conversationId)

  if (error) throw new Error(error.message)
}
