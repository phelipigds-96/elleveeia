import { createClient } from '@/lib/supabase/server'

/**
 * Assigns the company's default workflow (and its first stage) to a conversation.
 * Safe: derives companyId from authenticated session, never from the caller.
 */
export async function assignDefaultWorkflowToConversation(conversationId: string) {
  const supabase = createClient()

  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userData.user.id)
    .single()

  const companyId = profile?.company_id
  if (!companyId) return

  // Find the default active workflow for this company
  const { data: workflow } = await supabase
    .from('workflows')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .eq('is_active', true)
    .single()

  if (!workflow) return

  // Find the first stage (lowest position) of that workflow
  const { data: stages } = await supabase
    .from('workflow_stages')
    .select('id')
    .eq('workflow_id', workflow.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .limit(1)

  const firstStageId = stages && stages.length > 0 ? stages[0].id : null

  await supabase
    .from('conversations')
    .update({
      workflow_id: workflow.id,
      workflow_stage_id: firstStageId
    })
    .eq('id', conversationId)
    .eq('company_id', companyId)
}
