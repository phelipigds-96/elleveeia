import { createClient } from '@/lib/supabase/server'

/**
 * Atribui o workflow padrão (e sua primeira etapa) a uma conversa.
 * Safe: deriva companyId da sessão autenticada, nunca do chamador.
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

  await assignDefaultWorkflowStages(supabase, companyId, conversationId)
}

/**
 * Variante server-side que recebe o client e o companyId explicitamente.
 * Usada por fluxos que já possuem um client administrativo (ex.: processamento de webhook),
 * onde não há sessão de usuário disponível.
 *
 * Mantém workflow_id e workflow_stage_id sempre coerentes (o trigger de integridade
 * multi-tenant do banco rejeita workflow_id sem etapa e etapa de outro workflow).
 */
export async function assignDefaultWorkflowStages(
  client: any,
  companyId: string,
  conversationId: string
): Promise<boolean> {
  if (!client || !companyId || !conversationId) return false

  // Workflow padrão ativo da empresa
  const { data: workflow } = await client
    .from('workflows')
    .select('id')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle()

  if (!workflow) return false

  // Primeira etapa ativa do workflow (menor position)
  const { data: stages } = await client
    .from('workflow_stages')
    .select('id')
    .eq('workflow_id', workflow.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .limit(1)

  const firstStageId = stages && stages.length > 0 ? stages[0].id : null
  if (!firstStageId) return false

  const { error } = await client
    .from('conversations')
    .update({
      workflow_id: workflow.id,
      workflow_stage_id: firstStageId
    })
    .eq('id', conversationId)
    .eq('company_id', companyId)

  if (error) {
    console.error('[assignDefaultWorkflowStages] Falha ao atribuir etapa inicial:', error)
    return false
  }

  return true
}
