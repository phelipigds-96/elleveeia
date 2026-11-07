import { createAdminClient } from '@/lib/supabase/service'
import { WorkflowStage } from './workflows'

export * from './templates-data'
import { StageTemplate, WorkflowTemplate, SaveStagesInput, WORKFLOW_TEMPLATES } from './templates-data'

/**
 * Consulta o workflow padrão e suas etapas para uma empresa no contexto Super Admin
 */
export async function getCompanyWorkflowForAdmin(companyId: string, adminClient?: any) {
  const client = adminClient || createAdminClient()

  // 1. Busca workflow padrão
  let { data: workflow, error: wfError } = await client
    .from('workflows')
    .select('*, workflow_stages(*)')
    .eq('company_id', companyId)
    .eq('is_default', true)
    .maybeSingle()

  // Se não existir padrão, busca o primeiro ativo ou cria um inicial
  if (!workflow) {
    const { data: firstWf } = await client
      .from('workflows')
      .select('*, workflow_stages(*)')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (firstWf) {
      workflow = firstWf
    } else {
      // Provisiona o workflow padrão no banco
      const { data: createdWf, error: createErr } = await client
        .from('workflows')
        .insert({
          company_id: companyId,
          name: 'Atendimento Principal',
          description: 'Funil principal de atendimento e vendas',
          is_default: true,
          is_active: true
        })
        .select()
        .single()

      if (createErr || !createdWf) {
        throw new Error(`Falha ao provisionar workflow inicial para empresa ${companyId}: ${createErr?.message}`)
      }

      // Insere as 3 etapas essenciais de partida
      const initialStages = [
        { name: 'Novo Contato', stage_type: 'initial', handled_by: 'ai', color: '#eab308', position: 0 },
        { name: 'Em Atendimento', stage_type: 'in_progress', handled_by: 'human', color: '#3b82f6', position: 1 },
        { name: 'Finalizado', stage_type: 'final', handled_by: 'human', color: '#22c55e', position: 2 }
      ]

      await client.from('workflow_stages').insert(
        initialStages.map((s: any) => ({
          company_id: companyId,
          workflow_id: createdWf.id,
          ...s,
          is_active: true
        }))
      )

      const { data: fullWf } = await client
        .from('workflows')
        .select('*, workflow_stages(*)')
        .eq('id', createdWf.id)
        .single()

      workflow = fullWf
    }
  }

  // Ordena etapas por posição
  if (workflow?.workflow_stages) {
    workflow.workflow_stages.sort((a: any, b: any) => a.position - b.position)
  }

  return workflow
}

/**
 * Aplica um conjunto de etapas ao workflow de uma empresa com segurança transacional e sem orfanar conversas.
 */
export async function applyStagesToCompanyWorkflow({
  companyId,
  workflowId,
  stages,
  adminClient
}: {
  companyId: string
  workflowId?: string
  stages: SaveStagesInput[]
  adminClient?: any
}) {
  const client = adminClient || createAdminClient()

  if (!stages || stages.length === 0) {
    throw new Error('O funil deve conter pelo menos uma etapa.')
  }

  // 1. Garante pelo menos uma etapa inicial e uma final
  const hasInitial = stages.some((s) => s.stage_type === 'initial')
  const hasFinal = stages.some((s) => s.stage_type === 'final')

  if (!hasInitial) {
    // Promove a primeira para initial
    stages[0].stage_type = 'initial'
  }
  if (!hasFinal) {
    // Promove a última para final
    stages[stages.length - 1].stage_type = 'final'
  }

  // 2. Localiza o workflow alvo
  let targetWorkflowId = workflowId
  if (!targetWorkflowId) {
    const wf = await getCompanyWorkflowForAdmin(companyId, client)
    targetWorkflowId = wf.id
  }

  // 3. Consulta etapas atuais do workflow
  const { data: existingStages, error: fetchErr } = await client
    .from('workflow_stages')
    .select('id, name, stage_type, position, color, handled_by')
    .eq('company_id', companyId)
    .eq('workflow_id', targetWorkflowId)

  if (fetchErr) {
    throw new Error(`Falha ao ler etapas existentes: ${fetchErr.message}`)
  }

  const existingMap = new Map<string, any>()
  for (const st of existingStages || []) {
    existingMap.set(st.name.trim().toLowerCase(), st)
  }

  const updatedStageIds = new Set<string>()
  const newStageIds: string[] = []

  // 4. Cria ou atualiza as etapas especificadas
  for (let pos = 0; pos < stages.length; pos++) {
    const desired = stages[pos]
    const key = desired.name.trim().toLowerCase()
    const existing = existingMap.get(key)

    if (existing) {
      // Atualiza etapa existente preservando o UUID (para manter conversas associadas)
      const { error: updErr } = await client
        .from('workflow_stages')
        .update({
          name: desired.name.trim(),
          description: desired.description ? desired.description.trim() : null,
          position: pos,
          stage_type: desired.stage_type,
          handled_by: desired.handled_by || 'human',
          color: desired.color || '#64748b',
          is_active: true
        })
        .eq('id', existing.id)
        .eq('company_id', companyId)

      if (updErr) {
        throw new Error(`Falha ao atualizar etapa ${desired.name}: ${updErr.message}`)
      }
      updatedStageIds.add(existing.id)
    } else {
      // Insere nova etapa
      const { data: inserted, error: insErr } = await client
        .from('workflow_stages')
        .insert({
          company_id: companyId,
          workflow_id: targetWorkflowId,
          name: desired.name.trim(),
          description: desired.description ? desired.description.trim() : null,
          position: pos,
          stage_type: desired.stage_type,
          handled_by: desired.handled_by || 'human',
          color: desired.color || '#64748b',
          is_active: true
        })
        .select('id')
        .single()

      if (insErr || !inserted) {
        throw new Error(`Falha ao criar etapa ${desired.name}: ${insErr?.message}`)
      }
      updatedStageIds.add(inserted.id)
      newStageIds.push(inserted.id)
    }
  }

  // 5. Identifica etapas obsoletas que foram removidas do funil
  const obsoleteStages = (existingStages || []).filter((s: any) => !updatedStageIds.has(s.id))

  if (obsoleteStages.length > 0) {
    // Encontra o ID da nova etapa inicial (ou primeira etapa ativa)
    const { data: currentInitial } = await client
      .from('workflow_stages')
      .select('id')
      .eq('workflow_id', targetWorkflowId)
      .eq('company_id', companyId)
      .eq('stage_type', 'initial')
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle()

    const fallbackStageId = currentInitial?.id || Array.from(updatedStageIds)[0]

    for (const obs of obsoleteStages) {
      // Verifica se há conversas associadas a esta etapa obsoleta
      const { data: linkedConversations } = await client
        .from('conversations')
        .select('id')
        .eq('company_id', companyId)
        .eq('workflow_stage_id', obs.id)

      if (linkedConversations && linkedConversations.length > 0 && fallbackStageId) {
        // Realoca as conversas com segurança para a nova etapa inicial
        await client
          .from('conversations')
          .update({ workflow_stage_id: fallbackStageId })
          .eq('company_id', companyId)
          .eq('workflow_stage_id', obs.id)
      }

      // Agora remove com segurança a etapa do banco
      await client
        .from('workflow_stages')
        .delete()
        .eq('id', obs.id)
        .eq('company_id', companyId)
    }
  }

  // 6. Retorna o workflow completo e atualizado
  return getCompanyWorkflowForAdmin(companyId, client)
}
