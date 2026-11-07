"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/service"
import { createClient } from "@/lib/supabase/server"
import { CompanyMock } from "@/components/companies/mock-companies"
import {
  WORKFLOW_TEMPLATES,
  getCompanyWorkflowForAdmin,
  applyStagesToCompanyWorkflow,
  SaveStagesInput,
  WorkflowTemplate,
} from "@/lib/services/workflows/templates"

export interface CreateCompanyInput {
  name: string
  slug: string
  plan?: "Trial" | "Starter" | "Pro" | "Enterprise"
  aiProvider?: "openai" | "gemini" | "hybrid"
  cnpj?: string
  adminEmail?: string
  workflowTemplateKey?: string
}

export interface ActionResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Obtém o operador admin autenticado para vincular aos logs de auditoria
 */
async function getAuditActor(): Promise<{ id: string; email: string }> {
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getUser()
    if (data?.user?.id && data.user.email) {
      return { id: data.user.id, email: data.user.email }
    }
  } catch {
    // Caso ocorra em ambiente dev ou sem cookie de sessão
  }

  // Fallback para o superadministrador padrão da plataforma cadastrado no Supabase
  const adminClient = createAdminClient()
  const { data: admin } = await adminClient
    .from("platform_admins")
    .select("id, email")
    .eq("active", true)
    .limit(1)
    .maybeSingle()

  if (admin?.id && admin?.email) {
    return { id: admin.id, email: admin.email }
  }

  return {
    id: "71ee00c9-e22b-479d-bc34-9d596448c3f9",
    email: "admin@ellevee.com",
  }
}

/**
 * Consulta a lista real de empresas no Supabase com limites e contagem de mensagens
 */
export async function getCompaniesList(): Promise<CompanyMock[]> {
  const adminClient = createAdminClient()

  // 1. Consulta empresas com seus respectivos limites contratados
  const { data: rows, error: compErr } = await adminClient
    .from("companies")
    .select(`
      id,
      name,
      slug,
      status,
      plan_tier,
      created_at,
      updated_at,
      company_limits (
        max_agents,
        max_monthly_messages,
        max_monthly_quotes,
        max_catalog_items,
        allowed_llm_providers
      )
    `)
    .order("created_at", { ascending: false })

  if (compErr) {
    console.error("[SuperAdmin] Erro ao listar empresas do banco:", compErr.message)
    throw new Error(`Falha ao consultar empresas no banco: ${compErr.message}`)
  }

  // 2. Consulta quantidade real de mensagens por tenant para cálculo de consumo
  const { data: messagesData } = await adminClient
    .from("messages")
    .select("company_id")

  const messagesCountMap = new Map<string, number>()
  if (messagesData) {
    for (const msg of messagesData) {
      if (msg.company_id) {
        messagesCountMap.set(
          msg.company_id,
          (messagesCountMap.get(msg.company_id) || 0) + 1
        )
      }
    }
  }

  // 3. Mapeia as linhas do PostgreSQL para o contrato visual da interface
  const companies: CompanyMock[] = (rows || []).map((c: any) => {
    const limits = Array.isArray(c.company_limits)
      ? c.company_limits[0]
      : c.company_limits

    const msgsUsed = messagesCountMap.get(c.id) || 0
    const planTierDb = (c.plan_tier || "standard").toLowerCase()

    let planUI: "Trial" | "Starter" | "Pro" | "Enterprise" = "Starter"
    if (planTierDb === "trial") planUI = "Trial"
    else if (planTierDb === "standard" || planTierDb === "starter") planUI = "Starter"
    else if (planTierDb === "pro") planUI = "Pro"
    else if (planTierDb === "enterprise") planUI = "Enterprise"

    const statusUI: "Ativo" | "Suspenso" =
      c.status === "suspended" ? "Suspenso" : "Ativo"

    const providers = limits?.allowed_llm_providers || ["gemini"]
    let providerUI: "openai" | "gemini" | "hybrid" = "gemini"
    if (providers.includes("openai") && providers.includes("gemini")) {
      providerUI = "hybrid"
    } else if (providers.includes("openai")) {
      providerUI = "openai"
    } else {
      providerUI = "gemini"
    }

    const messagesLimit =
      limits?.max_monthly_messages ||
      (planUI === "Trial"
        ? 1000
        : planUI === "Starter"
        ? 5000
        : planUI === "Pro"
        ? 25000
        : 100000)

    const maxAgents =
      limits?.max_agents ||
      (planUI === "Trial" ? 1 : planUI === "Starter" ? 2 : planUI === "Pro" ? 5 : 15)

    const tokensLimit =
      planUI === "Trial"
        ? 100000
        : planUI === "Starter"
        ? 500000
        : planUI === "Pro"
        ? 2000000
        : 10000000

    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      cnpj: "00.000.000/0001-00",
      plan: planUI,
      status: statusUI,
      agentsCount: 1,
      maxAgents,
      messagesUsed: msgsUsed,
      messagesLimit,
      tokensUsed: Math.round(msgsUsed * 75),
      tokensLimit,
      aiProvider: providerUI,
      createdAt: c.created_at ? c.created_at.split("T")[0] : new Date().toISOString().split("T")[0],
      adminEmail: `admin@${c.slug}.com`,
    }
  })

  return companies
}

/**
 * Server Action para criação e provisionamento atômico de uma nova empresa
 */
export async function createCompanyAction(
  inputOrFormData: FormData | CreateCompanyInput
): Promise<ActionResult<{ id: string; name: string; slug: string }>> {
  try {
    let name = ""
    let slug = ""
    let plan: "Trial" | "Starter" | "Pro" | "Enterprise" = "Pro"
    let aiProvider: "openai" | "gemini" | "hybrid" = "openai"
    let cnpj = ""
    let adminEmail = ""
    let workflowTemplateKey = "none"

    if (inputOrFormData instanceof FormData) {
      name = String(inputOrFormData.get("name") || "")
      slug = String(inputOrFormData.get("slug") || "")
      plan = (inputOrFormData.get("plan") as any) || "Pro"
      aiProvider = (inputOrFormData.get("aiProvider") as any) || "openai"
      cnpj = String(inputOrFormData.get("cnpj") || "")
      adminEmail = String(inputOrFormData.get("adminEmail") || "")
      workflowTemplateKey = String(inputOrFormData.get("workflowTemplateKey") || "none")
    } else {
      name = inputOrFormData.name || ""
      slug = inputOrFormData.slug || ""
      plan = inputOrFormData.plan || "Pro"
      aiProvider = inputOrFormData.aiProvider || "openai"
      cnpj = inputOrFormData.cnpj || ""
      adminEmail = inputOrFormData.adminEmail || ""
      workflowTemplateKey = inputOrFormData.workflowTemplateKey || "none"
    }

    // 1. Validação de entradas
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName.length < 2) {
      return { success: false, error: "O nome da empresa deve conter pelo menos 2 caracteres." }
    }

    const cleanSlug = slug
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")

    if (!cleanSlug || cleanSlug.length < 2) {
      return { success: false, error: "O slug do tenant é inválido ou vazio." }
    }

    const adminClient = createAdminClient()

    // 2. Verificar duplicidade de slug
    const { data: existingSlug } = await adminClient
      .from("companies")
      .select("id")
      .eq("slug", cleanSlug)
      .maybeSingle()

    if (existingSlug) {
      return { success: false, error: `O slug '${cleanSlug}' já está em uso por outra organização.` }
    }

    // Mapeamento do plano para o enum do banco ('trial' | 'standard' | 'pro' | 'enterprise')
    let planTierDb = "standard"
    if (plan === "Trial") planTierDb = "trial"
    else if (plan === "Starter") planTierDb = "standard"
    else if (plan === "Pro") planTierDb = "pro"
    else if (plan === "Enterprise") planTierDb = "enterprise"

    // 3. Inserção na tabela companies
    const { data: createdCompany, error: compInsertErr } = await adminClient
      .from("companies")
      .insert({
        name: trimmedName,
        slug: cleanSlug,
        status: "active",
        plan_tier: planTierDb,
      })
      .select("id, name, slug, status, plan_tier, created_at")
      .single()

    if (compInsertErr || !createdCompany) {
      console.error("[SuperAdmin] Erro ao inserir company:", compInsertErr)
      return {
        success: false,
        error: `Falha ao cadastrar empresa no banco: ${compInsertErr?.message || "Erro desconhecido"}`,
      }
    }

    // 4. Inserção atômica de limites na tabela company_limits
    const maxMessages =
      plan === "Trial"
        ? 1000
        : plan === "Starter"
        ? 5000
        : plan === "Pro"
        ? 25000
        : 100000

    const maxAgents =
      plan === "Trial" ? 1 : plan === "Starter" ? 2 : plan === "Pro" ? 5 : 15

    const allowedProviders =
      aiProvider === "hybrid" ? ["openai", "gemini"] : [aiProvider]

    const { error: limitsInsertErr } = await adminClient
      .from("company_limits")
      .insert({
        company_id: createdCompany.id,
        max_agents: maxAgents,
        max_monthly_messages: maxMessages,
        max_monthly_quotes: 1000,
        max_catalog_items: 50000,
        allowed_llm_providers: allowedProviders,
      })

        if (limitsInsertErr) {
      console.warn("[SuperAdmin] Aviso ao inserir company_limits:", limitsInsertErr.message)
    }

    // 4.1. Provisionamento opcional do Funil Kanban
    let appliedTemplateName = "Padrão (3 etapas básicas)"
    try {
      if (workflowTemplateKey && workflowTemplateKey !== "none" && WORKFLOW_TEMPLATES[workflowTemplateKey]) {
        const template = WORKFLOW_TEMPLATES[workflowTemplateKey]
        appliedTemplateName = template.label
        await applyStagesToCompanyWorkflow({
          companyId: createdCompany.id,
          stages: template.stages,
          adminClient,
        })
      } else {
        // Inicializa o workflow padrão com as 3 etapas essenciais
        await getCompanyWorkflowForAdmin(createdCompany.id, adminClient)
      }
    } catch (wfErr: any) {
      console.warn("[SuperAdmin] Aviso ao provisionar workflow inicial:", wfErr.message)
    }

    // 5. Registro na tabela platform_audit_logs
    try {
      const actor = await getAuditActor()
      await adminClient.from("platform_audit_logs").insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: "company.created",
        target_company_id: createdCompany.id,
        payload_summary: {
          name: createdCompany.name,
          slug: createdCompany.slug,
          plan_tier: planTierDb,
          max_messages: maxMessages,
          max_agents: maxAgents,
          allowed_providers: allowedProviders,
          admin_email: adminEmail || null,
          cnpj: cnpj || null,
          workflow_template: appliedTemplateName,
        },
        reason: "Provisionamento inicial de tenant via Painel SuperAdmin",
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria não-bloqueante:", auditErr.message)
    }

    // 6. Revalidação das rotas do Next.js
    revalidatePath("/companies")
    revalidatePath("/paineladmin")
    revalidatePath("/audit")
    revalidatePath("/conversations/kanban")
    revalidatePath("/settings/workflows")

    return {
      success: true,
      data: {
        id: createdCompany.id,
        name: createdCompany.name,
        slug: createdCompany.slug,
      },
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Exceção em createCompanyAction:", err)
    return {
      success: false,
      error: `Erro interno no servidor: ${err.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para alternar o status operacional do tenant (Ativo / Suspenso)
 */
export async function updateCompanyStatusAction(
  companyId: string,
  newStatus: "active" | "suspended" | "Ativo" | "Suspenso",
  reason?: string
): Promise<ActionResult<{ id: string; status: string; suspension_reason: string | null }>> {
  try {
    if (!companyId) {
      return { success: false, error: "Identificador da empresa inválido." }
    }

    const normalizedStatus: "active" | "suspended" =
      newStatus === "suspended" || newStatus === "Suspenso" ? "suspended" : "active"

    const adminClient = createAdminClient()

    // 1. Verificar se a empresa existe
    const { data: company, error: fetchErr } = await adminClient
      .from("companies")
      .select("id, name, slug, status, suspension_reason")
      .eq("id", companyId)
      .maybeSingle()

    if (fetchErr || !company) {
      return { success: false, error: "Empresa não encontrada no banco de dados." }
    }

    const suspensionReason =
      normalizedStatus === "suspended"
        ? (reason?.trim() || "Suspensão manual realizada pelo SuperAdmin")
        : null

    // 2. Atualizar status na tabela companies
    const { data: updated, error: updateErr } = await adminClient
      .from("companies")
      .update({
        status: normalizedStatus,
        suspension_reason: suspensionReason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .select("id, name, slug, status, suspension_reason")
      .single()

    if (updateErr || !updated) {
      console.error("[SuperAdmin] Erro ao atualizar status:", updateErr)
      return {
        success: false,
        error: `Falha ao atualizar status da empresa: ${updateErr?.message || "Erro desconhecido"}`,
      }
    }

    // 3. Registrar auditoria em platform_audit_logs
    try {
      const actor = await getAuditActor()
      await adminClient.from("platform_audit_logs").insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: normalizedStatus === "suspended" ? "company.suspended" : "company.reactivated",
        target_company_id: companyId,
        payload_summary: {
          company_name: company.name,
          company_slug: company.slug,
          previous_status: company.status,
          new_status: normalizedStatus,
          suspension_reason: suspensionReason,
        },
        reason:
          suspensionReason ||
          (normalizedStatus === "suspended"
            ? "Suspensão manual de tenant"
            : "Reativação operacional de tenant"),
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria não-bloqueante:", auditErr.message)
    }

    // 4. Revalidar rotas administrativas do Next.js
    revalidatePath("/companies")
    revalidatePath("/paineladmin")
    revalidatePath("/audit")

    return {
      success: true,
      data: updated,
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Exceção em updateCompanyStatusAction:", err)
    return {
      success: false,
      error: `Erro interno no servidor: ${err.message || "Falha desconhecida"}`,
    }
  }
}

/**
 * Server Action para alterar o plano contratado do tenant
 */
export async function updateCompanyPlanAction(
  companyId: string,
  newPlan: "Trial" | "Starter" | "Pro" | "Enterprise"
): Promise<ActionResult<{ id: string; plan: string; plan_tier: string }>> {
  try {
    if (!companyId) {
      return { success: false, error: "Identificador da empresa inválido." }
    }

    let planTierDb = "standard"
    if (newPlan === "Trial") planTierDb = "trial"
    else if (newPlan === "Starter") planTierDb = "standard"
    else if (newPlan === "Pro") planTierDb = "pro"
    else if (newPlan === "Enterprise") planTierDb = "enterprise"

    const adminClient = createAdminClient()

    // 1. Obter registro atual
    const { data: company, error: fetchErr } = await adminClient
      .from("companies")
      .select("id, name, slug, plan_tier")
      .eq("id", companyId)
      .maybeSingle()

    if (fetchErr || !company) {
      return { success: false, error: "Empresa não encontrada no banco de dados." }
    }

    // 2. Atualizar plano na tabela companies
    const { data: updated, error: updateErr } = await adminClient
      .from("companies")
      .update({
        plan_tier: planTierDb,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId)
      .select("id, name, slug, plan_tier")
      .single()

    if (updateErr || !updated) {
      console.error("[SuperAdmin] Erro ao atualizar plano:", updateErr)
      return {
        success: false,
        error: `Falha ao atualizar plano da empresa: ${updateErr?.message || "Erro desconhecido"}`,
      }
    }

    // 3. Atualizar cotas padrão correspondentes ao plano em company_limits
    const defaultQuotas = {
      Trial: { messages: 1000, agents: 1 },
      Starter: { messages: 5000, agents: 2 },
      Pro: { messages: 25000, agents: 5 },
      Enterprise: { messages: 100000, agents: 15 },
    }[newPlan]

    const { data: existingLimits } = await adminClient
      .from("company_limits")
      .select("id, max_monthly_messages, max_agents")
      .eq("company_id", companyId)
      .maybeSingle()

    if (existingLimits) {
      await adminClient
        .from("company_limits")
        .update({
          max_monthly_messages: defaultQuotas.messages,
          max_agents: defaultQuotas.agents,
          updated_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
    } else {
      await adminClient
        .from("company_limits")
        .insert({
          company_id: companyId,
          max_monthly_messages: defaultQuotas.messages,
          max_agents: defaultQuotas.agents,
          max_monthly_quotes: 1000,
          max_catalog_items: 50000,
          allowed_llm_providers: ["gemini"],
        })
    }

    // 4. Registrar auditoria em platform_audit_logs
    try {
      const actor = await getAuditActor()
      await adminClient.from("platform_audit_logs").insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: "company.plan_changed",
        target_company_id: companyId,
        payload_summary: {
          company_name: company.name,
          company_slug: company.slug,
          previous_plan: company.plan_tier,
          new_plan_tier: planTierDb,
          new_plan_ui: newPlan,
          adjusted_limits: defaultQuotas,
        },
        reason: `Alteração de plano contratado para ${newPlan} via Painel SuperAdmin`,
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria não-bloqueante:", auditErr.message)
    }

    // 5. Revalidar rotas administrativas do Next.js
    revalidatePath("/companies")
    revalidatePath("/paineladmin")
    revalidatePath("/audit")

    return {
      success: true,
      data: {
        id: companyId,
        plan: newPlan,
        plan_tier: planTierDb,
      },
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Exceção em updateCompanyPlanAction:", err)
    return {
      success: false,
      error: `Erro interno no servidor: ${err.message || "Falha desconhecida"}`,
    }
  }
}

export interface UpdateLimitsInput {
  maxMonthlyMessages: number
  maxAgents: number
  allowedLlmProviders?: string[]
  maxMonthlyQuotes?: number
  maxCatalogItems?: number
  tokensLimit?: number
}

/**
 * Server Action para ajustar cotas de infraestrutura na tabela company_limits
 */
export async function updateCompanyLimitsAction(
  companyId: string,
  newLimits: UpdateLimitsInput
): Promise<ActionResult<any>> {
  try {
    if (!companyId) {
      return { success: false, error: "Identificador da empresa inválido." }
    }

    const adminClient = createAdminClient()

    // 1. Obter empresa
    const { data: company, error: fetchErr } = await adminClient
      .from("companies")
      .select("id, name, slug")
      .eq("id", companyId)
      .maybeSingle()

    if (fetchErr || !company) {
      return { success: false, error: "Empresa não encontrada no banco de dados." }
    }

    // 2. Obter limites atuais
    const { data: currentLimits } = await adminClient
      .from("company_limits")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle()

    const providers =
      newLimits.allowedLlmProviders && newLimits.allowedLlmProviders.length > 0
        ? newLimits.allowedLlmProviders
        : ["gemini"]

    const maxMessages = Math.max(0, Math.floor(Number(newLimits.maxMonthlyMessages) || 0))
    const maxAgents = Math.max(1, Math.floor(Number(newLimits.maxAgents) || 1))

    const updatePayload: Record<string, any> = {
      max_monthly_messages: maxMessages,
      max_agents: maxAgents,
      allowed_llm_providers: providers,
      updated_at: new Date().toISOString(),
    }

    if (newLimits.maxMonthlyQuotes !== undefined) {
      updatePayload.max_monthly_quotes = Math.max(0, Math.floor(Number(newLimits.maxMonthlyQuotes) || 0))
    }
    if (newLimits.maxCatalogItems !== undefined) {
      updatePayload.max_catalog_items = Math.max(0, Math.floor(Number(newLimits.maxCatalogItems) || 0))
    }

    let limitsResult: any
    if (currentLimits) {
      const { data, error } = await adminClient
        .from("company_limits")
        .update(updatePayload)
        .eq("company_id", companyId)
        .select("*")
        .single()

      if (error) {
        console.error("[SuperAdmin] Erro ao atualizar company_limits:", error)
        return { success: false, error: `Falha ao atualizar limites: ${error.message}` }
      }
      limitsResult = data
    } else {
      const { data, error } = await adminClient
        .from("company_limits")
        .insert({
          company_id: companyId,
          ...updatePayload,
          max_monthly_quotes: 1000,
          max_catalog_items: 50000,
        })
        .select("*")
        .single()

      if (error) {
        console.error("[SuperAdmin] Erro ao criar company_limits:", error)
        return { success: false, error: `Falha ao salvar limites: ${error.message}` }
      }
      limitsResult = data
    }

    // 3. Registrar auditoria em platform_audit_logs
    try {
      const actor = await getAuditActor()
      await adminClient.from("platform_audit_logs").insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: "company.limits_changed",
        target_company_id: companyId,
        payload_summary: {
          company_name: company.name,
          company_slug: company.slug,
          previous_limits: currentLimits
            ? {
                max_monthly_messages: currentLimits.max_monthly_messages,
                max_agents: currentLimits.max_agents,
                allowed_llm_providers: currentLimits.allowed_llm_providers,
              }
            : null,
          new_limits: updatePayload,
        },
        reason: "Ajuste de cotas operacionais e limites pelo SuperAdmin",
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria não-bloqueante:", auditErr.message)
    }

    // 4. Revalidar rotas administrativas do Next.js
    revalidatePath("/companies")
    revalidatePath("/paineladmin")
    revalidatePath("/audit")

    return {
      success: true,
      data: limitsResult,
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Exceção em updateCompanyLimitsAction:", err)
    return {
      success: false,
      error: `Erro interno no servidor: ${err.message || "Falha desconhecida"}`,
    }
  }
}


/**
 * Consulta o workflow e as etapas de uma empresa para exibição no diálogo Super Admin
 */
export async function getCompanyWorkflowAction(companyId: string): Promise<ActionResult<{
  workflow: any
  templates: Record<string, WorkflowTemplate>
}>> {
  try {
    const adminClient = createAdminClient()
    const workflow = await getCompanyWorkflowForAdmin(companyId, adminClient)
    return {
      success: true,
      data: {
        workflow,
        templates: WORKFLOW_TEMPLATES,
      },
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Erro em getCompanyWorkflowAction:", err)
    return {
      success: false,
      error: `Falha ao carregar funil da empresa: ${err.message || "Erro desconhecido"}`,
    }
  }
}

/**
 * Salva as etapas customizadas de um workflow para uma empresa
 */
export async function saveCompanyWorkflowAction(params: {
  companyId: string
  workflowId?: string
  stages: SaveStagesInput[]
}): Promise<ActionResult<any>> {
  try {
    const adminClient = createAdminClient()
    const { companyId, workflowId, stages } = params

    if (!companyId) {
      return { success: false, error: "Identificador da empresa é obrigatório." }
    }
    if (!stages || stages.length === 0) {
      return { success: false, error: "O funil deve conter ao menos 1 etapa." }
    }

    const updatedWorkflow = await applyStagesToCompanyWorkflow({
      companyId,
      workflowId,
      stages,
      adminClient,
    })

    // Registrar auditoria
    try {
      const actor = await getAuditActor()
      await adminClient.from("platform_audit_logs").insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: "company.workflow_updated",
        target_company_id: companyId,
        payload_summary: {
          stages_count: stages.length,
          stage_names: stages.map((s) => s.name),
        },
        reason: "Configuração do funil Kanban via Super Admin",
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria não-bloqueante:", auditErr.message)
    }

    revalidatePath("/companies")
    revalidatePath("/conversations/kanban")
    revalidatePath("/conversations")
    revalidatePath("/settings/workflows")

    return {
      success: true,
      data: updatedWorkflow,
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Erro em saveCompanyWorkflowAction:", err)
    return {
      success: false,
      error: `Falha ao salvar funil: ${err.message || "Erro interno"}`,
    }
  }
}

/**
 * Aplica um template de segmento pré-definido ao workflow da empresa
 */
export async function applyCompanyWorkflowTemplateAction(params: {
  companyId: string
  workflowId?: string
  templateKey: string
}): Promise<ActionResult<any>> {
  try {
    const adminClient = createAdminClient()
    const { companyId, workflowId, templateKey } = params

    const template = WORKFLOW_TEMPLATES[templateKey]
    if (!template) {
      return { success: false, error: `Template '${templateKey}' não encontrado.` }
    }

    const updatedWorkflow = await applyStagesToCompanyWorkflow({
      companyId,
      workflowId,
      stages: template.stages,
      adminClient,
    })

    // Registrar auditoria
    try {
      const actor = await getAuditActor()
      await adminClient.from("platform_audit_logs").insert({
        actor_id: actor.id,
        actor_email: actor.email,
        action: "company.workflow_template_applied",
        target_company_id: companyId,
        payload_summary: {
          template_key: templateKey,
          template_name: template.label,
          stages_count: template.stages.length,
          stage_names: template.stages.map((s) => s.name),
        },
        reason: `Aplicação do template '${template.label}' via Super Admin`,
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria não-bloqueante:", auditErr.message)
    }

    revalidatePath("/companies")
    revalidatePath("/conversations/kanban")
    revalidatePath("/conversations")
    revalidatePath("/settings/workflows")

    return {
      success: true,
      data: updatedWorkflow,
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Erro em applyCompanyWorkflowTemplateAction:", err)
    return {
      success: false,
      error: `Falha ao aplicar template de funil: ${err.message || "Erro interno"}`,
    }
  }
}
