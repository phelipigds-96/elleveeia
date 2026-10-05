'use server'

import { createClient } from '@/lib/supabase/server'
import { createWorkflow, createWorkflowStage, updateWorkflowStage, deleteWorkflowStage, moveConversationStage } from '@/lib/services/workflows/workflows'
import { revalidatePath } from 'next/cache'

export async function createDefaultWorkflowAction() {
  const workflow = await createWorkflow('Atendimento Principal', 'Funil padrão de conversas')

  await createWorkflowStage(workflow.id, 'Novo Contato', 'initial')
  await createWorkflowStage(workflow.id, 'Em Atendimento', 'in_progress')
  await createWorkflowStage(workflow.id, 'Finalizado', 'final')

  revalidatePath('/settings/workflows')
  revalidatePath('/conversations')
  
  return workflow
}

export async function createWorkflowStageAction(workflowId: string, name: string) {
  const stage = await createWorkflowStage(workflowId, name, 'in_progress')
  revalidatePath('/settings/workflows')
  return stage
}

export async function updateWorkflowStageAction(stageId: string, updates: any) {
  await updateWorkflowStage(stageId, updates)
  revalidatePath('/settings/workflows')
}

export async function deleteWorkflowStageAction(stageId: string) {
  await deleteWorkflowStage(stageId)
  revalidatePath('/settings/workflows')
}

export async function moveConversationStageAction(conversationId: string, stageId: string) {
  await moveConversationStage(conversationId, stageId)
  revalidatePath('/conversations')
}
