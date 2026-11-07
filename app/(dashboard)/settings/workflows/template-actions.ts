'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  applyWorkflowTemplate,
  getWorkflowTemplate,
  WORKFLOW_TEMPLATES,
} from '@/lib/services/workflows/templates'

/**
 * Marco 1 — Server Actions do motor de Templates por Segmento.
 *
 * A ação é executada somente no servidor. O `companyId` nunca vem da UI
 * como fonte de autoridade: `applyWorkflowTemplate` resolve o tenant a partir
 * da sessão e rejeita qualquer empresa divergente.
 */

const applyTemplateSchema = z.object({
  templateKey: z.string().min(1, 'Informe o template.'),
  workflowId: z.string().uuid().optional().nullable(),
})

export interface ApplyTemplateActionResult {
  ok: boolean
  message: string
  workflowId?: string
  workflowName?: string
  created?: number
  updated?: number
  removed?: number
  reassignedConversations?: number
}

/**
 * Lista os templates disponíveis para a UI de configuração do funil.
 */
export async function listWorkflowTemplatesAction(): Promise<{
  ok: boolean
  templates: {
    key: string
    label: string
    segment: string
    description: string
    stages: { name: string; stage_type: string; handled_by: string; color: string }[]
  }[]
  error?: string
}> {
  try {
    const templates = Object.values(WORKFLOW_TEMPLATES).map((template) => ({
      key: template.key,
      label: template.label,
      segment: template.segment,
      description: template.description,
      stages: template.stages.map((stage) => ({
        name: stage.name,
        stage_type: stage.stage_type,
        handled_by: stage.handled_by,
        color: stage.color,
      })),
    }))

    return { ok: true, templates }
  } catch (error: any) {
    return {
      ok: false,
      templates: [],
      error: error?.message || 'Falha ao listar os templates de funil.',
    }
  }
}

/**
 * Aplica um template de funil ao workflow da empresa do usuário autenticado.
 */
export async function applyWorkflowTemplateAction(
  input: { templateKey: string; workflowId?: string | null }
): Promise<ApplyTemplateActionResult> {
  const parsed = applyTemplateSchema.safeParse(input || ({} as any))

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message || 'Dados inválidos.',
    }
  }

  const { templateKey, workflowId } = parsed.data

  // Falha rápida com mensagem legível antes de tocar no banco.
  if (!getWorkflowTemplate(templateKey)) {
    return { ok: false, message: `Template desconhecido: "${templateKey}".` }
  }

  try {
    const result = await applyWorkflowTemplate({
      templateKey,
      workflowId: workflowId || undefined,
    })

    revalidatePath('/settings/workflows')
    revalidatePath('/conversations')
    revalidatePath('/conversations/kanban')

    return {
      ok: true,
      message: `Funil "${result.workflowName}" configurado com ${result.stages.length} etapas.`,
      workflowId: result.workflowId,
      workflowName: result.workflowName,
      created: result.created,
      updated: result.updated,
      removed: result.removed,
      reassignedConversations: result.reassignedConversations,
    }
  } catch (error: any) {
    return {
      ok: false,
      message: error?.message || 'Falha ao aplicar o template de funil.',
    }
  }
}
