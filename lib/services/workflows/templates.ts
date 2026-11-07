import { createClient } from '@/lib/supabase/server'
import { requireActiveCompany } from '@/lib/services/platform/tenant-access'
import {
  getOrCreateDefaultWorkflow,
  type WorkflowServiceOptions,
} from '@/lib/services/workflows/workflows'
import {
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  type TemplateHandledBy,
  type TemplateStageType,
  type WorkflowTemplate,
  type WorkflowTemplateStage,
} from '@/lib/services/workflows/template-catalog'

export {
  WORKFLOW_TEMPLATES,
  getWorkflowTemplate,
  type TemplateHandledBy,
  type TemplateStageType,
  type WorkflowTemplate,
  type WorkflowTemplateStage,
} from '@/lib/services/workflows/template-catalog'

/**
 * Marco 1 — Biblioteca de Templates de Funil por Segmento.
 *
 * Cada template descreve um funil completo (etapas, ordem, tipo, cor e
 * responsável operacional) para um segmento de mercado. A configuração é
 * sempre aplicada dentro de uma empresa (`company_id`), nunca globalmente.
 *
 * O enum `stage_type` ('initial' | 'in_progress' | 'final') é preservado:
 * ele continua sendo a única fonte de verdade para a sincronização entre
 * o funil (`workflow_stage_id`) e a lista de conversas (`status`/`assigned_to`).
 * `handled_by` e `color` são atributos descritivos e não alteram esse contrato.
 */

export interface ApplyWorkflowTemplateParams {
  retail_food: {
    key: 'retail_food',
    label: 'Varejo & Confeitaria',
    segment: 'Sumel',
    description:
      'Funil de pedidos de confeitaria com cardápio, orçamento, pagamento, separação e entrega.',
    stages: [
      { name: 'Novo Contato / Cardápio', stage_type: 'initial', handled_by: 'ai', color: '#eab308' },
      { name: 'Orçamento em Aberto', stage_type: 'in_progress', handled_by: 'ai', color: '#f97316' },
      { name: 'Aguardando Pagamento (Pix)', stage_type: 'in_progress', handled_by: 'waiting', color: '#a855f7' },
      { name: 'Em Separação / Cozinha', stage_type: 'in_progress', handled_by: 'human', color: '#3b82f6' },
      { name: 'Saiu para Entrega / Retirada', stage_type: 'in_progress', handled_by: 'human', color: '#06b6d4' },
      { name: 'Pedido Concluído', stage_type: 'final', handled_by: 'human', color: '#22c55e' },
    ],
  },
  events_party: {
    key: 'events_party',
    label: 'Salão de Festas & Eventos',
    segment: 'Salão de Festas',
    description:
      'Funil de reserva de salão: contato, disponibilidade de data, visita, proposta e contrato.',
    stages: [
      { name: 'Primeiro Contato', stage_type: 'initial', handled_by: 'ai', color: '#eab308' },
      { name: 'Data Disponível', stage_type: 'in_progress', handled_by: 'ai', color: '#f97316' },
      { name: 'Visita / Degustação Agendada', stage_type: 'in_progress', handled_by: 'human', color: '#a855f7' },
      { name: 'Proposta Enviada', stage_type: 'in_progress', handled_by: 'human', color: '#3b82f6' },
      { name: 'Contrato Fechado', stage_type: 'final', handled_by: 'human', color: '#22c55e' },
      { name: 'Data Indisponível / Perdido', stage_type: 'final', handled_by: 'human', color: '#ef4444' },
    ],
  },
  dental_clinic: {
    key: 'dental_clinic',
    label: 'Clínica Odontológica',
    segment: 'Saúde',
    description:
      'Funil de clínica: triagem, agendamento, confirmação, tratamento e conclusão.',
    stages: [
      { name: 'Triagem & Dúvidas', stage_type: 'initial', handled_by: 'ai', color: '#eab308' },
      { name: 'Agendamento em Andamento', stage_type: 'in_progress', handled_by: 'ai', color: '#06b6d4' },
      { name: 'Consulta Agendada', stage_type: 'in_progress', handled_by: 'waiting', color: '#3b82f6' },
      { name: 'Lembrete / Confirmação 24h', stage_type: 'in_progress', handled_by: 'human', color: '#a855f7' },
      { name: 'Tratamento Concluído', stage_type: 'final', handled_by: 'human', color: '#22c55e' },
    ],
  },
  general_services: {
    key: 'general_services',
    label: 'Serviços & B2B Geral',
    segment: 'Serviços',
    description:
      'Funil genérico de serviços: qualificação, negociação, espera do cliente e fechamento.',
    stages: [
      { name: 'Entrada / Qualificação', stage_type: 'initial', handled_by: 'ai', color: '#eab308' },
      { name: 'Em Negociação', stage_type: 'in_progress', handled_by: 'human', color: '#3b82f6' },
      { name: 'Aguardando Cliente', stage_type: 'in_progress', handled_by: 'waiting', color: '#a855f7' },
      { name: 'Finalizado / Ganho', stage_type: 'final', handled_by: 'human', color: '#22c55e' },
      { name: 'Arquivado / Perdido', stage_type: 'final', handled_by: 'human', color: '#ef4444' },
    ],
  },
}

export function getWorkflowTemplate(templateKey: string): WorkflowTemplate | null {
  if (!templateKey) return null
  return WORKFLOW_TEMPLATES[templateKey.trim()] || null
}

export interface ApplyWorkflowTemplateParams {
  /**
   * Opcional: quando informado, precisa bater com a empresa do usuário
   * autenticado (o servidor sempre resolve o tenant a partir da sessão).
   */
  companyId?: string
  workflowId?: string
  templateKey: string
}

export interface ApplyWorkflowTemplateResult {
  workflowId: string
  workflowName: string
  stages: {
    id: string
    name: string
    stage_type: TemplateStageType
    handled_by: TemplateHandledBy
    color: string
    position: number
  }[]
  created: number
  updated: number
  removed: number
  reassignedConversations: number
}

/**
 * Forma da linha de `workflow_stages` usada durante a aplicação do template.
 * Tipagem explícita para que os callbacks (`filter`, `map`) não dependam de
 * inferência implícita do driver do Supabase.
 */
interface TemplateStageRow {
  id: string
  name: string
  position: number
  stage_type: string
  color: string | null
  handled_by: string | null
  is_active: boolean
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id)
}

const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function sanitizeColor(color: string): string {
  return HEX_COLOR_REGEX.test(color) ? color.toLowerCase() : '#64748b'
}

/**
 * Aplica um template de funil para a empresa do usuário autenticado.
 *
 * Garantias:
 *  - o tenant é sempre resolvido no servidor (sessão) e conferido contra o
 *    `companyId` informado, quando houver;
 *  - a empresa precisa estar ativa (`requireActiveCompany`);
 *  - o workflow alvo precisa pertencer à mesma empresa;
 *  - conversas vinculadas a etapas removidas são realocadas para a etapa inicial
 *    do template, nunca órfãs.
 */
export async function applyWorkflowTemplate(
  params: ApplyWorkflowTemplateParams,
  options?: WorkflowServiceOptions
): Promise<ApplyWorkflowTemplateResult> {
  const { companyId: requestedCompanyId, workflowId, templateKey } =
    params || ({} as ApplyWorkflowTemplateParams)

  if (requestedCompanyId && !isValidUuid(requestedCompanyId)) {
    throw new Error('Empresa inválida.')
  }

  const template = getWorkflowTemplate(templateKey)
  if (!template) {
    throw new Error(`Template de funil desconhecido: "${templateKey}".`)
  }

  const supabase = options?.supabaseClient || createClient()

  // 1. Identidade e tenant resolvidos no servidor. O `companyId` recebido do
  //    cliente precisa corresponder à empresa do usuário autenticado — sem esta
  //    checagem, uma empresa poderia aplicar template no funil de outra.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('Sessão inválida ou expirada.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) {
    throw new Error('Empresa não encontrada.')
  }

  const companyId = requestedCompanyId || profile.company_id

  if (!companyId || profile.company_id !== companyId) {
    throw new Error('Empresa não corresponde ao tenant autenticado.')
  }

  // 1.1 Apenas perfis administrativos da própria empresa podem reconfigurar o funil.
  const role = String(profile.role || '').toLowerCase()
  if (!['owner', 'admin', 'superadmin'].includes(role)) {
    throw new Error('Permissão insuficiente para alterar o funil da empresa.')
  }

  // 2. Tenant ativo (bloqueia provisioning, suspended e cancelled)
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  // 3. Resolve o workflow alvo: o informado (validando a titularidade) ou o padrão
  let targetWorkflowId: string
  let workflowName: string

  if (workflowId) {
    if (!isValidUuid(workflowId)) {
      throw new Error('Workflow inválido.')
    }

    const { data: workflow, error: workflowError } = await supabase
      .from('workflows')
      .select('id, name, company_id')
      .eq('id', workflowId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (workflowError || !workflow) {
      throw new Error('Workflow não encontrado para esta empresa.')
    }

    targetWorkflowId = workflow.id
    workflowName = workflow.name
  } else {
    // `getOrCreateDefaultWorkflow` devolve `{ workflow, created }`
    const { workflow } = await getOrCreateDefaultWorkflow(options)
    targetWorkflowId = workflow.id
    workflowName = workflow.name
  }

  // 4. Etapas existentes do workflow
  const { data: existingStages, error: stagesError } = await supabase
    .from('workflow_stages')
    .select('id, name, position, stage_type, color, handled_by, is_active')
    .eq('workflow_id', targetWorkflowId)
    .eq('company_id', companyId)
    .order('position', { ascending: true })

  if (stagesError) {
    throw new Error('Falha ao carregar as etapas do funil.')
  }

  const currentStages: TemplateStageRow[] = (existingStages || []) as TemplateStageRow[]
  const byName = new Map<string, TemplateStageRow>()
  for (const stage of currentStages) {
    byName.set(stage.name.trim().toLowerCase(), stage)
  }

  const appliedStages: ApplyWorkflowTemplateResult['stages'] = []
  const keptStageIds = new Set<string>()
  let created = 0
  let updated = 0

  for (let index = 0; index < template.stages.length; index++) {
    const templateStage = template.stages[index]
    const color = sanitizeColor(templateStage.color)
    const existing = byName.get(templateStage.name.trim().toLowerCase())

    if (existing) {
      const { data: updatedStage, error: updateError } = await supabase
        .from('workflow_stages')
        .update({
          position: index,
          stage_type: templateStage.stage_type,
          color,
          handled_by: templateStage.handled_by,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .eq('company_id', companyId)
        .select()
        .single()

      if (updateError) {
        throw new Error(`Falha ao atualizar etapa "${templateStage.name}".`)
      }

      keptStageIds.add(existing.id)
      updated += 1
      appliedStages.push({
        id: updatedStage.id,
        name: templateStage.name,
        stage_type: templateStage.stage_type,
        handled_by: templateStage.handled_by,
        color,
        position: index,
      })
    } else {
      const { data: insertedStage, error: insertError } = await supabase
        .from('workflow_stages')
        .insert({
          company_id: companyId,
          workflow_id: targetWorkflowId,
          name: templateStage.name,
          position: index,
          stage_type: templateStage.stage_type,
          color,
          handled_by: templateStage.handled_by,
          is_active: true,
        })
        .select()
        .single()

      if (insertError) {
        throw new Error(`Falha ao criar etapa "${templateStage.name}".`)
      }

      keptStageIds.add(insertedStage.id)
      created += 1
      appliedStages.push({
        id: insertedStage.id,
        name: templateStage.name,
        stage_type: templateStage.stage_type,
        handled_by: templateStage.handled_by,
        color,
        position: index,
      })
    }
  }

  // 5. Etapas que saíram do template são desativadas (soft delete), preservando
  //    o histórico e as conversas já vinculadas.
  const obsoleteStages = currentStages.filter((stage) => !keptStageIds.has(stage.id))
  let removed = 0

  if (obsoleteStages.length > 0) {
    const { error: obsoleteError } = await supabase
      .from('workflow_stages')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('workflow_id', targetWorkflowId)
      .eq('company_id', companyId)
      .in('id', obsoleteStages.map((stage) => stage.id))

    if (obsoleteError) {
      throw new Error('Falha ao desativar etapas fora do template.')
    }
    removed = obsoleteStages.length
  }

  // 6. Conversas vinculadas a etapas desativadas são realocadas para a etapa
  //    inicial do template (preservando o histórico da conversa).
  let reassignedConversations = 0
  const initialStage = appliedStages.find((stage) => stage.stage_type === 'initial')

  if (obsoleteStages.length > 0 && initialStage) {
    const { data: reassigned, error: reassignError } = await supabase
      .from('conversations')
      .update({
        workflow_id: targetWorkflowId,
        workflow_stage_id: initialStage.id,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .in('workflow_stage_id', obsoleteStages.map((stage) => stage.id))
      .select('id')

    if (reassignError) {
      throw new Error('Falha ao realocar conversas para a etapa inicial do funil.')
    }

    reassignedConversations = (reassigned || []).length
  }

  // 7. Conversas sem etapa do workflow recebe a etapa inicial
  if (initialStage) {
    await supabase
      .from('conversations')
      .update({
        workflow_id: targetWorkflowId,
        workflow_stage_id: initialStage.id,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .is('workflow_stage_id', null)
  }

  return {
    workflowId: targetWorkflowId,
    workflowName,
    stages: appliedStages,
    created,
    updated,
    removed,
    reassignedConversations,
  }
}
