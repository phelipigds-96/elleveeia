import { createClient } from '@/lib/supabase/server'
import { requireActiveCompany } from '@/lib/services/platform/tenant-access'

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
  /** Cor hexadecimal da coluna no Kanban (Marco 1). Opcional para compatibilidade. */
  color?: string | null
  /** Responsável operacional pela etapa (Marco 1). Não substitui `stage_type`. */
  handled_by?: 'ai' | 'human' | 'waiting'
}

export interface WorkflowServiceOptions {
  supabaseClient?: any
  adminClient?: any
}

export interface AuthenticatedUserContext {
  userId: string
  companyId: string
  role: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(id: string): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id.trim())
}

/**
 * Resolve a identidade, empresa e papel do usuário autenticado no servidor.
 */
async function getAuthContext(supabase: any): Promise<AuthenticatedUserContext> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    throw new Error('Unauthorized')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', userData.user.id)
    .single()

  if (profileError || !profile?.company_id) {
    throw new Error('Company not found')
  }

  return {
    userId: userData.user.id,
    companyId: profile.company_id,
    role: profile.role || 'attendant'
  }
}

function requireAdminRole(role: string): void {
  if (!['admin', 'owner'].includes(role)) {
    throw new Error('Não autorizado: apenas administradores podem gerenciar workflows e etapas.')
  }
}

function requireMovePermission(role: string): void {
  if (!['admin', 'owner', 'attendant'].includes(role)) {
    throw new Error('Não autorizado: permissão insuficiente para movimentar conversas.')
  }
}

function getSupabaseClient(options?: WorkflowServiceOptions): any {
  if (options?.supabaseClient) return options.supabaseClient
  return createClient()
}

export async function getCompanyWorkflows(options?: WorkflowServiceOptions) {
  const supabase = getSupabaseClient(options)
  const { companyId } = await getAuthContext(supabase)
  
  const { data, error } = await supabase
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  // Order stages by position
  const workflows = data?.map((wf: any) => {
    const stages = (wf.workflow_stages || []).sort((a: any, b: any) => a.position - b.position)
    return { ...wf, workflow_stages: stages }
  })

  return workflows || []
}

export const DEFAULT_WORKFLOW_STAGES = [
  { name: 'Novo Contato', stage_type: 'initial' as const, position: 0, color: '#eab308', handled_by: 'ai' as const },
  { name: 'Em Atendimento', stage_type: 'in_progress' as const, position: 1, color: '#3b82f6', handled_by: 'human' as const },
  { name: 'Finalizado', stage_type: 'final' as const, position: 2, color: '#22c55e', handled_by: 'human' as const }
] as const

/**
 * Recupera de forma segura o workflow padrão persistido após colisão 23505.
 * Lança erro explícito se a consulta falhar ou se o registro não for encontrado,
 * impedindo retorno de { workflow: undefined, created: false }.
 */
async function fetchPersistedDefaultWorkflow(supabase: any, companyId: string) {
  const { data: persistedDefault, error: fetchError } = await supabase
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle()

  if (fetchError || !persistedDefault) {
    throw new Error(`Falha ao recuperar o workflow padrão concorrente: ${fetchError?.message || 'registro não encontrado'}`)
  }

  return persistedDefault
}

/**
 * Garante que todas as etapas padrão essenciais existam no workflow.
 * Se alguma estiver ausente (por exemplo, após falha parcial anterior), cria apenas as ausentes
 * preservando nomes, posições e stage_types padrão.
 * Não duplica etapas existentes e não altera ou remove etapas customizadas criadas pelo cliente.
 * 
 * LIMITAÇÃO DE CONCORRÊNCIA:
 * Como a tabela `workflow_stages` não possui constraint física UNIQUE em (workflow_id, name),
 * chamadas simultâneas concorrentes sem transação RPC/lock no banco de dados podem gerar etapas duplicadas.
 * A solução em nível de serviço é idempotente para execuções sequenciais, mas a garantia estrita contra
 * corridas concorrentes depende de RPC atômica ou constraint UNIQUE no schema do PostgreSQL.
 */
async function ensureDefaultStages(
  workflowId: string,
  companyId: string,
  currentStages: any[] = [],
  options?: WorkflowServiceOptions
) {
  const supabase = getSupabaseClient(options)

  let stagesList = currentStages
  if (!stagesList || stagesList.length === 0) {
    const { data: dbStages } = await supabase
      .from('workflow_stages')
      .select('name')
      .eq('workflow_id', workflowId)
      .eq('company_id', companyId)
    if (dbStages && dbStages.length > 0) {
      stagesList = dbStages
    }
  }

  const existingStageNames = new Set(
    (stagesList || [])
      .map((s: any) => s.name?.trim().toLowerCase())
      .filter(Boolean)
  )

  for (const defStage of DEFAULT_WORKFLOW_STAGES) {
    if (!existingStageNames.has(defStage.name.toLowerCase())) {
      const { error: insertStageError } = await supabase
        .from('workflow_stages')
        .insert({
          company_id: companyId,
          workflow_id: workflowId,
          name: defStage.name,
          position: defStage.position,
          stage_type: defStage.stage_type,
          color: defStage.color,
          handled_by: defStage.handled_by,
          is_active: true
        })

      if (insertStageError) {
        throw new Error(`Falha ao criar etapa padrão "${defStage.name}": ${insertStageError.message}`)
      }
    }
  }
}

/**
 * Cria ou recupera de forma estritamente idempotente o workflow padrão da empresa.
 * 
 * Regras de governança (Etapa 8.4.3P.4):
 * 1. Resolução segura de identidade e tenant no servidor.
 * 2. Exigência estrita de papel administrativo (admin ou owner).
 * 3. Validação de ciclo de vida (requireActiveCompany).
 * 4. Idempotência: se já houver workflow padrão ativo, recupera etapas faltantes e retorna sem duplicar.
 * 5. Se houver workflow padrão inativo, não cria outro silenciosamente; exige reativação operacional.
 * 6. Se já existir workflow com nome "Atendimento Principal", promove-o a padrão sem criar duplicatas
 *    e trata colisões 23505 durante a promoção.
 * 7. Concorrência: captura violações da constraint uq_workflows_company_default (23505) e retorna
 *    o registro efetivamente persistido pela transação vencedora, validando erros da busca.
 * 8. Recuperação idempotente de etapas padrão ausentes se houver falha parcial anterior.
 */
export async function getOrCreateDefaultWorkflow(options?: WorkflowServiceOptions) {
  const supabase = getSupabaseClient(options)
  const { companyId, role } = await getAuthContext(supabase)

  requireAdminRole(role)
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  // 1. Verificar se já existe um workflow padrão para a empresa
  const { data: existingDefault, error: defaultError } = await supabase
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle()

  if (defaultError) throw new Error(defaultError.message)

  if (existingDefault) {
    if (!existingDefault.is_active) {
      throw new Error('Já existe um workflow padrão configurado para esta empresa que se encontra inativo. Reative o workflow existente antes de criar um novo.')
    }

    // Recupera etapas padrão faltantes caso tenha ocorrido falha parcial prévia
    await ensureDefaultStages(existingDefault.id, companyId, existingDefault.workflow_stages, options)

    const { data: refreshedWf, error: refreshError } = await supabase
      .from('workflows')
      .select('*, workflow_stages(*)')
      .eq('id', existingDefault.id)
      .eq('company_id', companyId)
      .single()

    if (refreshError) {
      throw new Error(`Falha ao recarregar workflow padrão: ${refreshError.message}`)
    }

    return { workflow: refreshedWf || existingDefault, created: false }
  }

  // 2. Se não há padrão, verificar se já existe um workflow chamado 'Atendimento Principal'
  const { data: existingNamed, error: namedError } = await supabase
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('company_id', companyId)
    .eq('name', 'Atendimento Principal')
    .maybeSingle()

  if (namedError) throw new Error(namedError.message)

  if (existingNamed) {
    if (!existingNamed.is_active) {
      throw new Error('Já existe um workflow com o nome "Atendimento Principal" inativo. Reative-o antes de configurar o padrão.')
    }
    // Promover a padrão sem duplicar
    const { data: updatedWf, error: updateError } = await supabase
      .from('workflows')
      .update({ is_default: true })
      .eq('id', existingNamed.id)
      .eq('company_id', companyId)
      .select('*, workflow_stages(*)')
      .single()

    if (updateError) {
      // Trata colisão concorrente 23505 durante a promoção
      if (updateError.code === '23505' || updateError.message?.includes('uq_workflows_company_default')) {
        const persistedDefault = await fetchPersistedDefaultWorkflow(supabase, companyId)
        if (!persistedDefault.is_active) {
          throw new Error('Já existe um workflow padrão configurado para esta empresa que se encontra inativo. Reative o workflow existente antes de criar um novo.')
        }
        await ensureDefaultStages(persistedDefault.id, companyId, persistedDefault.workflow_stages, options)
        const refreshed = await fetchPersistedDefaultWorkflow(supabase, companyId)
        return { workflow: refreshed, created: false }
      }
      throw new Error(updateError.message)
    }

    // Garante as etapas essenciais no workflow promovido
    await ensureDefaultStages(existingNamed.id, companyId, existingNamed.workflow_stages, options)

    const { data: refreshedNamed, error: refreshNamedError } = await supabase
      .from('workflows')
      .select('*, workflow_stages(*)')
      .eq('id', existingNamed.id)
      .eq('company_id', companyId)
      .single()

    if (refreshNamedError) {
      throw new Error(`Falha ao recarregar workflow promovido: ${refreshNamedError.message}`)
    }

    return { workflow: refreshedNamed || updatedWf || existingNamed, created: false }
  }

  // 3. Criação resiliente a concorrência
  let newWorkflow: any
  try {
    const { data: createdWf, error: insertError } = await supabase
      .from('workflows')
      .insert({
        company_id: companyId,
        name: 'Atendimento Principal',
        description: 'Funil padrão de conversas',
        is_default: true,
        is_active: true
      })
      .select()
      .single()

    if (insertError) {
      // Captura corrida concorrente interceptada pelo índice uq_workflows_company_default
      if (insertError.code === '23505' || insertError.message?.includes('uq_workflows_company_default')) {
        const persistedDefault = await fetchPersistedDefaultWorkflow(supabase, companyId)
        if (!persistedDefault.is_active) {
          throw new Error('Já existe um workflow padrão configurado para esta empresa que se encontra inativo. Reative o workflow existente antes de criar um novo.')
        }
        await ensureDefaultStages(persistedDefault.id, companyId, persistedDefault.workflow_stages, options)
        const refreshed = await fetchPersistedDefaultWorkflow(supabase, companyId)
        return { workflow: refreshed, created: false }
      }
      throw new Error(insertError.message)
    }
    newWorkflow = createdWf
  } catch (err: any) {
    if (err.code === '23505' || err.message?.includes('uq_workflows_company_default')) {
      const persistedDefault = await fetchPersistedDefaultWorkflow(supabase, companyId)
      if (!persistedDefault.is_active) {
        throw new Error('Já existe um workflow padrão configurado para esta empresa que se encontra inativo. Reative o workflow existente antes de criar um novo.')
      }
      await ensureDefaultStages(persistedDefault.id, companyId, persistedDefault.workflow_stages, options)
      const refreshed = await fetchPersistedDefaultWorkflow(supabase, companyId)
      return { workflow: refreshed, created: false }
    }
    throw err
  }

  // 4. Criação das etapas iniciais caso tenha sido criado nesta chamada
  await ensureDefaultStages(newWorkflow.id, companyId, [], options)

  const { data: fullWorkflow, error: fullError } = await supabase
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('id', newWorkflow.id)
    .eq('company_id', companyId)
    .single()

  if (fullError) {
    throw new Error(`Falha ao buscar workflow criado: ${fullError.message}`)
  }

  return { workflow: fullWorkflow || newWorkflow, created: true }
}

export async function createWorkflow(name: string, description?: string, options?: WorkflowServiceOptions) {
  const supabase = getSupabaseClient(options)
  const { companyId, role } = await getAuthContext(supabase)

  // RBAC: apenas admin ou owner podem criar workflow
  requireAdminRole(role)

  // Ciclo de vida: bloqueia provisioning, suspended e cancelled
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Nome do workflow é obrigatório.')
  }

  // Verifica se já existe um workflow padrão na empresa
  const { count: defaultCount } = await supabase
    .from('workflows')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_default', true)

  const isDefault = defaultCount === 0

  const { data, error } = await supabase
    .from('workflows')
    .insert({
      company_id: companyId,
      name: name.trim(),
      description: description ? description.trim() : null,
      is_default: isDefault
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505' && isDefault) {
      // Em colisão de concorrência no default, recupera o workflow padrão existente
      const { data: existingDefault, error: fetchError } = await supabase
        .from('workflows')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_default', true)
        .maybeSingle()

      if (fetchError || !existingDefault) {
        throw new Error(`Falha ao recuperar o workflow padrão concorrente: ${fetchError?.message || 'registro não encontrado'}`)
      }
      return existingDefault
    }
    throw new Error(error.message)
  }

  return data
}

export const WORKFLOW_STAGE_HANDLED_BY_VALUES = ['ai', 'human', 'waiting'] as const
export type WorkflowStageHandledBy = (typeof WORKFLOW_STAGE_HANDLED_BY_VALUES)[number]

const HEX_COLOR_REGEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Normaliza a cor da etapa (Marco 1). Cores inválidas caem no cinza padrão
 * do Kanban, sem quebrar a gravação.
 */
function sanitizeStageColor(color: unknown): string | null {
  if (color === undefined || color === null || color === '') return null
  if (typeof color !== 'string') return null
  const trimmed = color.trim()
  if (!HEX_COLOR_REGEX.test(trimmed)) return null
  return trimmed
}

/**
 * Normaliza o responsável operacional da etapa (Marco 1).
 */
function sanitizeStageHandledBy(handledBy: unknown): WorkflowStageHandledBy | null {
  if (handledBy === undefined || handledBy === null || handledBy === '') return null
  if (typeof handledBy !== 'string') return null
  const trimmed = handledBy.trim().toLowerCase()
  if (!(WORKFLOW_STAGE_HANDLED_BY_VALUES as readonly string[]).includes(trimmed)) return null
  return trimmed as WorkflowStageHandledBy
}

export async function createWorkflowStage(
  workflowId: string, 
  name: string, 
  stageType: string = 'in_progress',
  options?: WorkflowServiceOptions & { color?: string | null; handled_by?: string | null }
) {
  const supabase = getSupabaseClient(options)
  const { companyId, role } = await getAuthContext(supabase)

  // RBAC: apenas admin ou owner podem criar etapas
  requireAdminRole(role)

  // Ciclo de vida: bloqueia provisioning, suspended e cancelled
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  if (!isValidUuid(workflowId)) {
    throw new Error('Workflow não encontrado.')
  }

  // Validação de propriedade do workflow pela empresa autenticada
  const { data: workflow, error: wfError } = await supabase
    .from('workflows')
    .select('id')
    .eq('id', workflowId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (wfError || !workflow) {
    throw new Error('Workflow não encontrado.')
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Nome da etapa é obrigatório.')
  }

  const validStageTypes = ['initial', 'in_progress', 'final']
  const finalStageType = validStageTypes.includes(stageType) ? stageType : 'in_progress'

  // Marco 1: cor e responsável operacional são opcionais e nunca invalidam a criação
  const stageColor = sanitizeStageColor(options?.color)
  const stageHandledBy = sanitizeStageHandledBy(options?.handled_by)

  const { data: stages } = await supabase
    .from('workflow_stages')
    .select('position')
    .eq('workflow_id', workflowId)
    .eq('company_id', companyId)
    .order('position', { ascending: false })
    .limit(1)

  const nextPos = stages && stages.length > 0 ? stages[0].position + 1 : 0

  const { data, error } = await supabase
    .from('workflow_stages')
    .insert({
      company_id: companyId,
      workflow_id: workflowId,
      name: name.trim(),
      position: nextPos,
      stage_type: finalStageType,
      ...(stageColor ? { color: stageColor } : {}),
      ...(stageHandledBy ? { handled_by: stageHandledBy } : {})
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function updateWorkflowStage(
  stageId: string, 
  updates: any,
  options?: WorkflowServiceOptions
) {
  const supabase = getSupabaseClient(options)
  const { companyId, role } = await getAuthContext(supabase)

  // RBAC: apenas admin ou owner podem atualizar etapas
  requireAdminRole(role)

  // Ciclo de vida: bloqueia provisioning, suspended e cancelled
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  if (!isValidUuid(stageId)) {
    throw new Error('Etapa não encontrada.')
  }

  // Validação de propriedade da etapa pela empresa autenticada
  const { data: existingStage, error: stageError } = await supabase
    .from('workflow_stages')
    .select('id, workflow_id')
    .eq('id', stageId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (stageError || !existingStage) {
    throw new Error('Etapa não encontrada.')
  }

  // Whitelist estrita de campos atualizáveis
  const sanitizedUpdates: Record<string, any> = {}

  if (updates && typeof updates === 'object') {
    if (updates.name !== undefined) {
      if (typeof updates.name !== 'string' || updates.name.trim().length === 0) {
        throw new Error('Nome da etapa não pode ser vazio.')
      }
      sanitizedUpdates.name = updates.name.trim()
    }

    if (updates.description !== undefined) {
      sanitizedUpdates.description = updates.description === null ? null : String(updates.description).trim()
    }

    if (updates.position !== undefined) {
      const pos = Number(updates.position)
      if (isNaN(pos) || pos < 0 || !Number.isInteger(pos)) {
        throw new Error('Posição da etapa deve ser um número inteiro não negativo.')
      }
      sanitizedUpdates.position = pos
    }

    if (updates.stage_type !== undefined) {
      if (!['initial', 'in_progress', 'final'].includes(updates.stage_type)) {
        throw new Error('Tipo de etapa inválido.')
      }
      sanitizedUpdates.stage_type = updates.stage_type
    }

    if (updates.is_active !== undefined) {
      sanitizedUpdates.is_active = Boolean(updates.is_active)
    }

    // Marco 1: cor da coluna no Kanban
    if (updates.color !== undefined) {
      if (updates.color === null) {
        sanitizedUpdates.color = null
      } else {
        const parsedColor = sanitizeStageColor(updates.color)
        if (!parsedColor) {
          throw new Error('Cor da etapa inválida. Use um valor hexadecimal, por exemplo #3b82f6.')
        }
        sanitizedUpdates.color = parsedColor
      }
    }

    // Marco 1: responsável operacional pela etapa (não substitui stage_type)
    if (updates.handled_by !== undefined) {
      if (updates.handled_by === null) {
        sanitizedUpdates.handled_by = null
      } else {
        const parsedHandledBy = sanitizeStageHandledBy(updates.handled_by)
        if (!parsedHandledBy) {
          throw new Error('Responsável da etapa inválido. Use ai, human ou waiting.')
        }
        sanitizedUpdates.handled_by = parsedHandledBy
      }
    }
  }

  if (Object.keys(sanitizedUpdates).length === 0) {
    return
  }

  const { error } = await supabase
    .from('workflow_stages')
    .update(sanitizedUpdates)
    .eq('id', stageId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}

export async function deleteWorkflowStage(
  stageId: string,
  options?: WorkflowServiceOptions
) {
  const supabase = getSupabaseClient(options)
  const { companyId, role } = await getAuthContext(supabase)

  // RBAC: apenas admin ou owner podem excluir etapas
  requireAdminRole(role)

  // Ciclo de vida: bloqueia provisioning, suspended e cancelled
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  if (!isValidUuid(stageId)) {
    throw new Error('Etapa não encontrada.')
  }

  // Validação de propriedade da etapa pela empresa autenticada
  const { data: existingStage, error: stageError } = await supabase
    .from('workflow_stages')
    .select('id')
    .eq('id', stageId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (stageError || !existingStage) {
    throw new Error('Etapa não encontrada.')
  }

  const { error } = await supabase
    .from('workflow_stages')
    .delete()
    .eq('id', stageId)
    .eq('company_id', companyId)

  if (error) throw new Error(error.message)
}

/**
 * Movimenta uma conversa para uma etapa válida no Kanban.
 * 
 * Blindagens obrigatórias:
 * 1. Autenticação e perfil resolvidos no servidor.
 * 2. Validação de papel (admin, owner, attendant).
 * 3. Validação de ciclo de vida (requireActiveCompany).
 * 4. Consulta simultânea de conversa por id + company_id.
 * 5. Consulta simultânea de etapa por id + company_id.
 * 6. Validação de pertencimento da etapa ao workflow da conversa (se já vinculado).
 * 7. Atualização atômica coerente de workflow_id e workflow_stage_id.
 */
export async function moveConversationStage(
  conversationId: string, 
  stageId: string,
  options?: WorkflowServiceOptions
) {
  const supabase = getSupabaseClient(options)
  const { companyId, role, userId } = await getAuthContext(supabase)

  // RBAC: atendentes, admins e owners têm permissão operacional no Kanban
  requireMovePermission(role)

  // Ciclo de vida: bloqueia provisioning, suspended e cancelled
  await requireActiveCompany(companyId, { adminClient: options?.adminClient })

  if (!isValidUuid(conversationId)) {
    throw new Error('Conversa não encontrada.')
  }

  if (!isValidUuid(stageId)) {
    throw new Error('Etapa não encontrada.')
  }

  // 1. Consultar a conversa usando id e company_id
  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, company_id, workflow_id, workflow_stage_id, assigned_to')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (convError || !conversation) {
    throw new Error('Conversa não encontrada.')
  }

  // 2. Consultar a etapa informada usando id e company_id
  const { data: stage, error: stageError } = await supabase
    .from('workflow_stages')
    .select('id, company_id, workflow_id, is_active, stage_type')
    .eq('id', stageId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (stageError || !stage) {
    throw new Error('Etapa não encontrada.')
  }

  if (stage.is_active === false) {
    throw new Error('Não é possível mover a conversa para uma etapa inativa.')
  }

  // 3. Validar se a etapa pertence ao workflow correto
  if (conversation.workflow_id && stage.workflow_id !== conversation.workflow_id) {
    throw new Error('Etapa de outro workflow é rejeitada.')
  }

  // 4. Sincronizar o status operacional da conversa com o tipo da etapa.
  //    O funil (workflow_stage_id) e a lista de conversas (status/assigned_to)
  //    passam a refletir o mesmo estado, independentemente da tela de origem.
  const now = new Date().toISOString()
  const statusPayload: Record<string, any> = {}

  if (stage.stage_type === 'final') {
    statusPayload.status = 'closed'
    statusPayload.closed_at = now
  } else if (stage.stage_type === 'in_progress') {
    statusPayload.status = 'human'
    statusPayload.assigned_to = conversation.assigned_to || userId
    statusPayload.closed_at = null
  } else {
    // Etapa inicial: conversa na fila, ainda sem atendente responsável
    // (atendimento conduzido pela IA até que um operador assuma).
    statusPayload.status = 'open'
    statusPayload.assigned_to = null
    statusPayload.closed_at = null
  }

  // 5. Executar a atualização mantendo workflow_id e workflow_stage_id coerentes
  const { error: updateError } = await supabase
    .from('conversations')
    .update({
      workflow_id: stage.workflow_id,
      workflow_stage_id: stage.id,
      ...statusPayload,
      updated_at: now,
    })
    .eq('id', conversationId)
    .eq('company_id', companyId)

  if (updateError) throw new Error(updateError.message)
}

/**
 * Move a conversa para a primeira etapa ativa do tipo informado
 * (initial | in_progress | final) do seu workflow atual.
 *
 * Usado pela lista de conversas para manter o funil alinhado quando o
 * status operacional muda por fora do Kanban (assumir, devolver para IA,
 * encerrar ou reabrir atendimento).
 */
export async function moveConversationToStageType(
  conversationId: string,
  stageType: 'initial' | 'in_progress' | 'final',
  options?: WorkflowServiceOptions
) {
  const supabase = getSupabaseClient(options)
  const { companyId } = await getAuthContext(supabase)

  if (!isValidUuid(conversationId)) {
    throw new Error('Conversa não encontrada.')
  }

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, workflow_id')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (convError || !conversation) {
    throw new Error('Conversa não encontrada.')
  }

  let stageQuery = supabase
    .from('workflow_stages')
    .select('id')
    .eq('company_id', companyId)
    .eq('stage_type', stageType)
    .eq('is_active', true)

  if (conversation.workflow_id) {
    stageQuery = stageQuery.eq('workflow_id', conversation.workflow_id)
  }

  const { data: stages, error: stageError } = await stageQuery
    .order('position', { ascending: true })
    .limit(1)

  if (stageError) {
    throw new Error(stageError.message)
  }

  const stage = stages && stages[0]
  if (!stage) {
    // Empresa sem etapa do tipo pedido: mantém apenas o status operacional.
    return null
  }

  await moveConversationStage(conversationId, stage.id, options)
  return stage.id
}
