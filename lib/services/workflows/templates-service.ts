"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/service"
import { 
  WorkflowTemplate, 
  StageTemplate, 
  WORKFLOW_TEMPLATES 
} from "./template-catalog"

export interface ActionResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

export interface SavePlatformTemplateInput {
  id?: string
  key: string
  label: string
  description?: string
  segment: string
  badgeText?: string
  stages: StageTemplate[]
}

/**
 * Consulta a lista completa de modelos de funil (Blueprints)
 * Realiza leitura prioritária no PostgreSQL (Supabase) com fallback seguro para os modelos nativos.
 */
export async function getPlatformWorkflowTemplatesList(): Promise<WorkflowTemplate[]> {
  try {
    const adminClient = createAdminClient()
    const { data: rows, error } = await adminClient
      .from("platform_workflow_templates")
      .select("id, key, label, description, segment, badge_text, is_system, stages, created_at")
      .order("is_system", { ascending: false })
      .order("created_at", { ascending: true })

    if (!error && rows && rows.length > 0) {
      return rows.map((r: any) => ({
        id: r.id,
        key: r.key,
        label: r.label,
        description: r.description || "",
        segment: r.segment || "Geral",
        badgeText: r.badge_text || r.segment || "Blueprint",
        isSystem: r.is_system ?? false,
        stages: Array.isArray(r.stages) ? r.stages : [],
      }))
    }
  } catch (err: any) {
    console.warn("[TemplatesService] Fallback para templates estáticos em memória:", err?.message)
  }

  // Fallback caso a tabela ainda não tenha sido migrada
  return Object.values(WORKFLOW_TEMPLATES).map((tmpl) => ({
    ...tmpl,
    isSystem: tmpl.key !== "streaming_subscriptions",
  }))
}

/**
 * Salva ou atualiza um modelo de funil global no banco de dados
 */
export async function savePlatformWorkflowTemplateAction(
  input: SavePlatformTemplateInput
): Promise<ActionResult<WorkflowTemplate>> {
  try {
    const label = input.label?.trim() || ""
    if (label.length < 2) {
      return { success: false, error: "O nome do modelo deve conter pelo menos 2 caracteres." }
    }

    const segment = input.segment?.trim() || "Geral"

    // Gera chave/slug segura
    let rawKey = input.key?.trim()
    if (!rawKey) {
      rawKey = label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/(^_|_$)/g, "")
    }

    const key = rawKey.toLowerCase()

    if (!input.stages || input.stages.length < 2) {
      return { success: false, error: "O modelo deve conter pelo menos 2 etapas (uma inicial e uma final)." }
    }

    // Valida integridade das etapas
    const stages: StageTemplate[] = input.stages.map((st, idx) => ({
      name: st.name?.trim() || `Etapa ${idx + 1}`,
      description: st.description?.trim() || "",
      stage_type: st.stage_type || (idx === 0 ? "initial" : idx === input.stages.length - 1 ? "final" : "in_progress"),
      handled_by: st.handled_by || "human",
      color: st.color || "#64748b",
    }))

    // Garante que existe pelo menos uma inicial e uma final
    if (!stages.some((s) => s.stage_type === "initial")) {
      stages[0].stage_type = "initial"
    }
    if (!stages.some((s) => s.stage_type === "final")) {
      stages[stages.length - 1].stage_type = "final"
    }

    const adminClient = createAdminClient()

    const payload = {
      key,
      label,
      description: input.description?.trim() || "",
      segment,
      badge_text: input.badgeText?.trim() || segment,
      is_system: false,
      stages,
      updated_at: new Date().toISOString(),
    }

    let savedTemplate: any = null

    if (input.id) {
      const { data, error } = await adminClient
        .from("platform_workflow_templates")
        .update(payload)
        .eq("id", input.id)
        .select()
        .single()

      if (error) throw error
      savedTemplate = data
    } else {
      const { data, error } = await adminClient
        .from("platform_workflow_templates")
        .upsert(payload, { onConflict: "key" })
        .select()
        .single()

      if (error) throw error
      savedTemplate = data
    }

    revalidatePath("/companies")
    revalidatePath("/settings/workflows")

    return {
      success: true,
      data: {
        id: savedTemplate.id,
        key: savedTemplate.key,
        label: savedTemplate.label,
        description: savedTemplate.description,
        segment: savedTemplate.segment,
        badgeText: savedTemplate.badge_text,
        isSystem: savedTemplate.is_system,
        stages: savedTemplate.stages,
      },
    }
  } catch (err: any) {
    console.error("[TemplatesService] Erro ao salvar modelo de funil:", err)
    return { success: false, error: `Falha ao salvar modelo: ${err?.message || "Erro desconhecido"}` }
  }
}

/**
 * Exclui um modelo customizado (impede remoção de modelos de sistema)
 */
export async function deletePlatformWorkflowTemplateAction(
  templateKeyOrId: string
): Promise<ActionResult> {
  try {
    const adminClient = createAdminClient()

    // 1. Verifica se é um modelo nativo de sistema
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateKeyOrId)
    let existingQuery = adminClient
      .from("platform_workflow_templates")
      .select("id, key, is_system")

    if (isUuid) {
      existingQuery = existingQuery.eq("id", templateKeyOrId)
    } else {
      existingQuery = existingQuery.eq("key", templateKeyOrId)
    }

    const { data: existing } = await existingQuery.maybeSingle()

    if (existing?.is_system) {
      return { success: false, error: "Modelos nativos do sistema não podem ser excluídos." }
    }

    let deleteQuery = adminClient
      .from("platform_workflow_templates")
      .delete()

    if (isUuid) {
      deleteQuery = deleteQuery.eq("id", templateKeyOrId)
    } else {
      deleteQuery = deleteQuery.eq("key", templateKeyOrId)
    }

    const { error } = await deleteQuery

    if (error) throw error

    revalidatePath("/companies")
    revalidatePath("/settings/workflows")

    return { success: true }
  } catch (err: any) {
    return { success: false, error: `Erro ao excluir modelo: ${err?.message || "Erro desconhecido"}` }
  }
}

/**
 * Salva as etapas atuais de uma empresa como um novo modelo de funil global
 */
export async function saveCompanyWorkflowAsTemplateAction(
  companyId: string,
  metadata: {
    label: string
    segment?: string
    description?: string
  }
): Promise<ActionResult<WorkflowTemplate>> {
  try {
    const label = metadata.label?.trim() || ""
    if (label.length < 2) {
      return { success: false, error: "Informe um nome válido para o modelo (mínimo 2 caracteres)." }
    }

    const adminClient = createAdminClient()

    // 1. Busca etapas atuais da empresa
    const { data: stagesData, error: stagesErr } = await adminClient
      .from("workflow_stages")
      .select("name, description, stage_type, handled_by, color, position")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("position", { ascending: true })

    if (stagesErr || !stagesData || stagesData.length === 0) {
      return { success: false, error: "Nenhuma etapa encontrada no funil desta empresa." }
    }

    const stages: StageTemplate[] = stagesData.map((s) => ({
      name: s.name,
      description: s.description || "",
      stage_type: s.stage_type as any,
      handled_by: (s.handled_by as any) || "human",
      color: s.color || "#64748b",
    }))

    // 2. Salva como template
    return await savePlatformWorkflowTemplateAction({
      key: "",
      label,
      segment: metadata.segment?.trim() || "Personalizado",
      description: metadata.description?.trim() || `Modelo gerado a partir do funil da empresa em ${new Date().toLocaleDateString("pt-BR")}.`,
      badgeText: metadata.segment?.trim() || "Modelo Salvo",
      stages,
    })
  } catch (err: any) {
    return { success: false, error: `Falha ao salvar funil como modelo: ${err?.message || "Erro desconhecido"}` }
  }
}
