'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  createWorkflowStage,
  updateWorkflowStage,
  deleteWorkflowStage,
  moveConversationStage,
  getOrCreateDefaultWorkflow
} from '@/lib/services/workflows/workflows'
import { applyWorkflowTemplate } from '@/lib/services/workflows/templates'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const updateWorkflowStageSchema = z.object({
  name: z.string().trim().min(1, 'Nome da etapa não pode ser vazio.').max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  position: z.number().int().min(0, 'Posição deve ser maior ou igual a 0.').optional(),
  stage_type: z.enum(['initial', 'in_progress', 'final'], {
    errorMap: () => ({ message: 'Tipo de etapa deve ser initial, in_progress ou final.' })
  }).optional(),
  is_active: z.boolean().optional(),
  color: z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, 'Cor deve ser um valor hexadecimal, por exemplo #3b82f6.')
    .nullable()
    .optional(),
  handled_by: z
    .enum(['ai', 'human', 'waiting'], {
      errorMap: () => ({ message: 'Responsável da etapa deve ser ai, human ou waiting.' })
    })
    .nullable()
    .optional(),
}).strict('Campos adicionais ou não autorizados não podem ser informados na atualização da etapa.')

/**
 * Cria ou recupera de forma idempotente o workflow padrão da empresa.
 * Não duplica funis em chamadas repetidas ou concorrentes.
 */
export async function createDefaultWorkflowAction() {
  const result = await getOrCreateDefaultWorkflow()

  revalidatePath('/settings/workflows')
  revalidatePath('/conversations')
  
  return result.workflow
}

/**
 * Aplica um template de funil por segmento ao workflow padrão da empresa.
 * O tenant é sempre resolvido no servidor a partir da sessão; o cliente
 * apenas informa a chave do template.
 */
export async function applyWorkflowTemplateAction(templateKey: string) {
  if (!templateKey || typeof templateKey !== 'string' || templateKey.trim().length === 0) {
    throw new Error('Selecione um template de funil.')
  }

  const result = await applyWorkflowTemplate({ templateKey: templateKey.trim() })

  revalidatePath('/settings/workflows')
  revalidatePath('/conversations')
  revalidatePath('/conversations/kanban')

  return result
}

export async function createWorkflowStageAction(
  workflowId: string,
  name: string,
  handled_by?: 'ai' | 'human' | 'waiting' | null,
  color?: string | null
) {
  if (!workflowId || !UUID_REGEX.test(workflowId.trim())) {
    throw new Error('Identificador de workflow inválido.')
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Nome da etapa é obrigatório.')
  }
  if (handled_by && !['ai', 'human', 'waiting'].includes(handled_by)) {
    throw new Error('Responsável da etapa deve ser ai, human ou waiting.')
  }
  if (color && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim())) {
    throw new Error('Cor da etapa inválida. Use um valor hexadecimal, por exemplo #3b82f6.')
  }

  const stage = await createWorkflowStage(workflowId.trim(), name.trim(), 'in_progress', {
    handled_by: handled_by || null,
    color: color || null,
  })
  revalidatePath('/settings/workflows')
  return stage
}

export async function updateWorkflowStageAction(stageId: string, updates: any) {
  if (!stageId || !UUID_REGEX.test(stageId.trim())) {
    throw new Error('Identificador de etapa inválido.')
  }

  // Validação estrita via Zod com whitelist (rejeita id, company_id, workflow_id, etc.)
  const validatedUpdates = updateWorkflowStageSchema.parse(updates)

  await updateWorkflowStage(stageId.trim(), validatedUpdates)
  revalidatePath('/settings/workflows')
}

export async function deleteWorkflowStageAction(stageId: string) {
  if (!stageId || !UUID_REGEX.test(stageId.trim())) {
    throw new Error('Identificador de etapa inválido.')
  }

  await deleteWorkflowStage(stageId.trim())
  revalidatePath('/settings/workflows')
}

export async function moveConversationStageAction(conversationId: string, stageId: string) {
  if (!conversationId || !UUID_REGEX.test(conversationId.trim())) {
    throw new Error('Identificador de conversa inválido.')
  }
  if (!stageId || !UUID_REGEX.test(stageId.trim())) {
    throw new Error('Identificador de etapa inválido.')
  }

  await moveConversationStage(conversationId.trim(), stageId.trim())
  revalidatePath('/conversations')
}
