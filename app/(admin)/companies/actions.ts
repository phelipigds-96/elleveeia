"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/service"
import { createClient } from "@/lib/supabase/server"
import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import { CompanyAddonRecord, CompanyMock } from "@/components/companies/mock-companies"
import {
  ADDON_PACKAGE_SIZES,
  AddonPackageSize,
  calculateCompanyBillingOverage,
  getCurrentBillingMonth,
  isOutboundSentSenderType,
  resolvePlanBillingKey,
} from "@/lib/services/platform/tenant-governance"
import {
  WORKFLOW_TEMPLATES,
  getCompanyWorkflowForAdmin,
  applyStagesToCompanyWorkflow,
  SaveStagesInput,
  WorkflowTemplate,
} from "@/lib/services/workflows/templates"
import { getPlatformWorkflowTemplatesList } from "@/lib/services/workflows/templates-service"

export interface CreateCompanyInput {
  name: string
  slug: string
  plan?: "Trial" | "Starter" | "Pro" | "Enterprise"
  aiProvider?: "openai" | "gemini" | "hybrid"
  cnpj?: string
  adminEmail?: string
  adminPassword?: string
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
 * Consulta a lista real de empresas no Supabase com limites, contagem de mensagens e dados de contato
 */
export async function getCompaniesList(): Promise<CompanyMock[]> {
  try {
    const adminClient = createAdminClient()

    // 1. Tenta consultar empresas com colunas de cnpj, contact_email, require_close_reason e tarifas customizadas
    let rows: any[] = []
    const { data: rowsWithCustomTariffs, error: customTariffErr } = await adminClient
      .from("companies")
      .select(`
        id,
        name,
        slug,
        status,
        plan_tier,
        created_at,
        updated_at,
        cnpj,
        contact_email,
        require_close_reason,
        company_limits (
          max_agents,
          max_monthly_messages,
          max_monthly_quotes,
          max_catalog_items,
          allowed_llm_providers,
          custom_addon_unit_price_brl,
          custom_overage_unit_price_brl
        )
      `)
      .order("created_at", { ascending: false })

    if (!customTariffErr && rowsWithCustomTariffs) {
      rows = rowsWithCustomTariffs
    } else {
      const { data: rowsWithCols, error: compErr } = await adminClient
        .from("companies")
        .select(`
          id,
          name,
          slug,
          status,
          plan_tier,
          created_at,
          updated_at,
          cnpj,
          contact_email,
          require_close_reason,
          company_limits (
            max_agents,
            max_monthly_messages,
            max_monthly_quotes,
            max_catalog_items,
            allowed_llm_providers
          )
        `)
        .order("created_at", { ascending: false })

      if (!compErr && rowsWithCols) {
        rows = rowsWithCols
      } else {
      // Fallback caso as colunas novas ainda não tenham sido migradas no Supabase
      const { data: fallbackRows, error: fallbackErr } = await adminClient
        .from("companies")
        .select(`
          id,
          name,
          slug,
          status,
          plan_tier,
          created_at,
          updated_at,
          cnpj,
          contact_email,
          company_limits (
            max_agents,
            max_monthly_messages,
            max_monthly_quotes,
            max_catalog_items,
            allowed_llm_providers
          )
        `)
        .order("created_at", { ascending: false })

      if (!fallbackErr && fallbackRows) {
        rows = fallbackRows
      } else {
        const { data: minimalRows, error: minErr } = await adminClient
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

        if (minErr) {
          console.error("[SuperAdmin] Erro ao listar empresas do banco:", minErr.message)
          rows = []
        } else {
          rows = minimalRows || []
        }
      }
    }
    }

  const now = new Date()
  const monthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  ).toISOString()
  const currentBillingMonth = getCurrentBillingMonth(now)

  // 2. Consulta quantidade real de mensagens enviadas e tokens LLM do mês corrente por tenant
  const [{ data: messagesData }, { data: agentRunsData }] = await Promise.all([
    adminClient
      .from("messages")
      .select("company_id, sender_type")
      .gte("created_at", monthStartIso),
    adminClient
      .from("agent_runs")
      .select("company_id, total_tokens")
      .gte("created_at", monthStartIso),
  ])

  const sentMessagesCountMap = new Map<string, number>()
  const totalMessagesCountMap = new Map<string, number>()
  if (messagesData) {
    for (const msg of messagesData as any[]) {
      if (msg.company_id) {
        totalMessagesCountMap.set(
          msg.company_id,
          (totalMessagesCountMap.get(msg.company_id) || 0) + 1
        )
        if (isOutboundSentSenderType(msg.sender_type)) {
          sentMessagesCountMap.set(
            msg.company_id,
            (sentMessagesCountMap.get(msg.company_id) || 0) + 1
          )
        }
      }
    }
  }

  // 2.1. Consulta tarifas por plano e pacotes extras contratados no mês (com fallback gracioso)
  const planTariffMap = new Map<string, { addonPrice?: number; overagePrice?: number }>()
  try {
    const { data: planTariffs, error: ptErr } = await adminClient
      .from("platform_plans")
      .select("key, addon_package_unit_price_brl, overage_unit_price_brl")
    if (!ptErr && Array.isArray(planTariffs)) {
      for (const p of planTariffs as any[]) {
        if (p?.key) {
          planTariffMap.set(String(p.key).toLowerCase(), {
            addonPrice: p.addon_package_unit_price_brl !== null && p.addon_package_unit_price_brl !== undefined ? Number(p.addon_package_unit_price_brl) : undefined,
            overagePrice: p.overage_unit_price_brl !== null && p.overage_unit_price_brl !== undefined ? Number(p.overage_unit_price_brl) : undefined,
          })
        }
      }
    }
  } catch {
    // fallback para defaults
  }

  const companyAddonsMap = new Map<string, CompanyAddonRecord[]>()
  try {
    const { data: addonsData, error: addonsErr } = await adminClient
      .from("company_message_addons")
      .select("id, company_id, billing_month, package_messages, unit_price_brl, total_price_brl, status, notes, created_at")
      .eq("billing_month", currentBillingMonth)
      .eq("status", "active")
      .order("created_at", { ascending: false })
    if (!addonsErr && Array.isArray(addonsData)) {
      for (const a of addonsData as any[]) {
        if (!a?.company_id) continue
        const list = companyAddonsMap.get(a.company_id) || []
        list.push({
          id: a.id,
          billingMonth: a.billing_month,
          packageMessages: Number(a.package_messages) || 0,
          unitPriceBrl: Number(a.unit_price_brl) || 0,
          totalPriceBrl: Number(a.total_price_brl) || 0,
          status: a.status === "cancelled" ? "cancelled" : "active",
          notes: a.notes || null,
          createdAt: a.created_at,
        })
        companyAddonsMap.set(a.company_id, list)
      }
    }
  } catch {
    // tabela company_message_addons ainda não migrada
  }

  const tokensCountMap = new Map<string, number>()
  if (agentRunsData) {
    for (const run of agentRunsData) {
      if (run.company_id) {
        tokensCountMap.set(
          run.company_id,
          (tokensCountMap.get(run.company_id) || 0) + Math.max(0, Number(run.total_tokens) || 0)
        )
      }
    }
  }

  // 3. Consulta perfis de administradores/owners para capturar email real do responsável
  const { data: profilesData } = await adminClient
    .from("profiles")
    .select("company_id, email, role")
    .in("role", ["owner", "admin"])

  const companyAdminEmailMap = new Map<string, string>()
  if (profilesData) {
    for (const p of profilesData) {
      if (p.company_id && p.email && !companyAdminEmailMap.has(p.company_id)) {
        companyAdminEmailMap.set(p.company_id, p.email)
      }
    }
  }

  // 4. Consulta logs de auditoria de provisionamento para resgatar CNPJ/Email caso não estejam na coluna
  const { data: auditLogs } = await adminClient
    .from("platform_audit_logs")
    .select("target_company_id, payload_summary")
    .eq("action", "company.created")

  const companyCnpjMap = new Map<string, string>()
  const auditEmailMap = new Map<string, string>()
  if (auditLogs) {
    for (const log of auditLogs) {
      if (log.target_company_id && log.payload_summary) {
        const payload = log.payload_summary as any
        if (payload.cnpj && !companyCnpjMap.has(log.target_company_id)) {
          companyCnpjMap.set(log.target_company_id, payload.cnpj)
        }
        if (payload.admin_email && !auditEmailMap.has(log.target_company_id)) {
          auditEmailMap.set(log.target_company_id, payload.admin_email)
        }
      }
    }
  }

  // 5. Mapeia as linhas do PostgreSQL para o contrato visual da interface
  const companies: CompanyMock[] = rows.map((c: any) => {
    const limits = Array.isArray(c.company_limits)
      ? c.company_limits[0]
      : c.company_limits

    const sentMsgsUsed = sentMessagesCountMap.get(c.id) || 0
    const totalMsgsUsed = totalMessagesCountMap.get(c.id) || 0
    const planTierDb = (c.plan_tier || "standard").toLowerCase()
    const planKey = resolvePlanBillingKey(planTierDb)

    let planUI: "Trial" | "Starter" | "Pro" | "Enterprise" = "Starter"
    if (planTierDb === "trial") planUI = "Trial"
    else if (planTierDb === "standard" || planTierDb === "starter") planUI = "Starter"
    else if (planTierDb === "pro") planUI = "Pro"
    else if (planTierDb === "enterprise") planUI = "Enterprise"

    const statusUI: "Ativo" | "Suspenso" =
      c.status === "suspended" ? "Suspenso" : "Ativo"

    const providers = limits?.allowed_llm_providers || ["openai"]
    let providerUI: "openai" | "gemini" | "hybrid" = "openai"
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

    const resolvedCnpj = c.cnpj || companyCnpjMap.get(c.id) || "Não informado"
    const resolvedEmail =
      c.contact_email ||
      companyAdminEmailMap.get(c.id) ||
      auditEmailMap.get(c.id) ||
      `admin@${c.slug}.com`

    const activeAddons = companyAddonsMap.get(c.id) || []
    const addonMessagesPurchased = activeAddons.reduce(
      (acc, a) => acc + (Number(a.packageMessages) || 0),
      0
    )
    const addonsTotalBrl = activeAddons.reduce(
      (acc, a) => acc + (Number(a.totalPriceBrl) || 0),
      0
    )
    const planTariffs = planTariffMap.get(planKey)
    const customAddonRate =
      limits?.custom_addon_unit_price_brl !== undefined &&
      limits?.custom_addon_unit_price_brl !== null
        ? Number(limits.custom_addon_unit_price_brl)
        : undefined
    const customOverageRate =
      limits?.custom_overage_unit_price_brl !== undefined &&
      limits?.custom_overage_unit_price_brl !== null
        ? Number(limits.custom_overage_unit_price_brl)
        : undefined
    const billingSummary = calculateCompanyBillingOverage({
      sentMessages: sentMsgsUsed,
      baseQuotaMessages: messagesLimit,
      addonMessagesPurchased,
      addonsTotalBrl,
      addonUnitPriceBrl: customAddonRate ?? planTariffs?.addonPrice,
      overageUnitPriceBrl: customOverageRate ?? planTariffs?.overagePrice,
      isTrial: planKey === "trial",
    })

    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      cnpj: resolvedCnpj,
      plan: planUI,
      status: statusUI,
      agentsCount: 1,
      maxAgents,
      messagesUsed: sentMsgsUsed,
      messagesLimit,
      tokensUsed: tokensCountMap.get(c.id) || 0,
      tokensLimit,
      aiProvider: providerUI,
      createdAt: c.created_at ? c.created_at.split("T")[0] : new Date().toISOString().split("T")[0],
      adminEmail: resolvedEmail,
      requireCloseReason: Boolean(c.require_close_reason),
      sentMessagesUsed: sentMsgsUsed,
      totalMessagesUsed: totalMsgsUsed,
      addonMessages: billingSummary.addonMessagesPurchased,
      effectiveMessagesLimit: billingSummary.effectiveQuotaMessages,
      overageMessages: billingSummary.overageMessages,
      addonsTotalBrl: billingSummary.addonsTotalBrl,
      overageTotalBrl: billingSummary.overageTotalBrl,
      extraInvoiceBrl: billingSummary.extraInvoiceTotalBrl,
      addonUnitPriceBrl: billingSummary.addonUnitPriceBrl,
      overageUnitPriceBrl: billingSummary.overageUnitPriceBrl,
      billingMonth: currentBillingMonth,
      activeAddons,
    }
  })

  return companies
} catch (err: any) {
  console.error("[SuperAdmin] Falha em getCompaniesList:", err?.message)
  return []
}
}

/**
 * Server Action para criação e provisionamento atômico de uma nova empresa
 */
export async function createCompanyAction(
  inputOrFormData: FormData | CreateCompanyInput
): Promise<ActionResult<{
  id: string
  name: string
  slug: string
  adminEmail?: string | null
  adminPassword?: string | null
  userCreated?: boolean
}>> {
  try {
    let name = ""
    let slug = ""
    let plan: "Trial" | "Starter" | "Pro" | "Enterprise" = "Pro"
    let aiProvider: "openai" | "gemini" | "hybrid" = "openai"
    let cnpj = ""
    let adminEmail = ""
    let adminPassword = ""
    let workflowTemplateKey = "none"

    if (inputOrFormData instanceof FormData) {
      name = String(inputOrFormData.get("name") || "")
      slug = String(inputOrFormData.get("slug") || "")
      plan = (inputOrFormData.get("plan") as any) || "Pro"
      aiProvider = (inputOrFormData.get("aiProvider") as any) || "openai"
      cnpj = String(inputOrFormData.get("cnpj") || "")
      adminEmail = String(inputOrFormData.get("adminEmail") || "")
      adminPassword = String(inputOrFormData.get("adminPassword") || "")
      workflowTemplateKey = String(inputOrFormData.get("workflowTemplateKey") || "none")
    } else {
      name = inputOrFormData.name || ""
      slug = inputOrFormData.slug || ""
      plan = inputOrFormData.plan || "Pro"
      aiProvider = inputOrFormData.aiProvider || "openai"
      cnpj = inputOrFormData.cnpj || ""
      adminEmail = inputOrFormData.adminEmail || ""
      adminPassword = inputOrFormData.adminPassword || ""
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

    // 3. Inserção na tabela companies (com suporte a cnpj e contact_email)
    let createdCompany: any = null
    const baseCompanyData: any = {
      name: trimmedName,
      slug: cleanSlug,
      status: "active",
      plan_tier: planTierDb,
    }

    // Tenta primeiro com as colunas dedicadas cnpj e contact_email
    const { data: compWithNewCols, error: errNewCols } = await adminClient
      .from("companies")
      .insert({
        ...baseCompanyData,
        cnpj: cnpj.trim() || null,
        contact_email: adminEmail.trim().toLowerCase() || null,
      })
      .select("id, name, slug, status, plan_tier, created_at")
      .single()

    if (!errNewCols && compWithNewCols) {
      createdCompany = compWithNewCols
    } else {
      // Fallback sem as colunas caso a migration ainda esteja em aplicação
      const { data: compFallback, error: errFallback } = await adminClient
        .from("companies")
        .insert(baseCompanyData)
        .select("id, name, slug, status, plan_tier, created_at")
        .single()

      if (errFallback || !compFallback) {
        console.error("[SuperAdmin] Erro ao inserir company:", errFallback || errNewCols)
        return {
          success: false,
          error: `Falha ao cadastrar empresa no banco: ${(errFallback || errNewCols)?.message || "Erro desconhecido"}`,
        }
      }
      createdCompany = compFallback
    }

    // 3.1 Provisionamento do Usuário Administrador no Supabase Auth + Profiles
    let authUserId: string | null = null
    let userAlreadyExisted = false
    const finalPassword =
      adminPassword.trim().length >= 6
        ? adminPassword.trim()
        : `Sumel@${Math.floor(100000 + Math.random() * 900000)}`

    if (adminEmail && adminEmail.trim().includes("@")) {
      const cleanEmail = adminEmail.trim().toLowerCase()
      try {
        const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
          email: cleanEmail,
          password: finalPassword,
          email_confirm: true,
          app_metadata: {
            skip_tenant_trigger: true,
            created_via: "superadmin_panel",
          },
          user_metadata: {
            full_name: `${trimmedName} Admin`,
            company_id: createdCompany.id,
          },
        })

        if (authUser?.user) {
          authUserId = authUser.user.id
        } else if (authErr) {
          // Verifica se o usuário já existia no Auth
          const { data: usersList } = await adminClient.auth.admin.listUsers()
          const existing = usersList?.users?.find(
            (u) => u.email?.toLowerCase() === cleanEmail
          )
          if (existing) {
            authUserId = existing.id
            userAlreadyExisted = true
          } else {
            console.warn("[SuperAdmin] Aviso ao criar usuário Auth:", authErr.message)
          }
        }

        // Se obtivemos o ID do usuário, vinculamos o perfil na empresa como 'owner'
        if (authUserId) {
          const { error: profErr } = await adminClient.from("profiles").upsert(
            {
              id: authUserId,
              company_id: createdCompany.id,
              full_name: `${trimmedName} Admin`,
              email: cleanEmail,
              role: "owner",
            },
            { onConflict: "id" }
          )
          if (profErr) {
            console.warn("[SuperAdmin] Aviso ao vincular profile:", profErr.message)
          }

          // Prevenção defensiva contra tenants fantasmas gerados por triggers legadas em auth.users
          try {
            const { data: ghostCompanies } = await adminClient
              .from("companies")
              .select("id, name, slug")
              .neq("id", createdCompany.id)
              .or(`name.ilike.Empresa de ${trimmedName}%,slug.ilike.${cleanSlug}-%`)

            if (ghostCompanies && ghostCompanies.length > 0) {
              for (const ghost of ghostCompanies) {
                const { count } = await adminClient
                  .from("profiles")
                  .select("id", { count: "exact", head: true })
                  .eq("company_id", ghost.id)

                if (!count || count === 0) {
                  await adminClient.from("companies").delete().eq("id", ghost.id)
                  console.info(`[SuperAdmin] Tenant fantasma automático removido com sucesso: ${ghost.id} (${ghost.slug})`)
                }
              }
            }
          } catch (cleanErr: any) {
            console.warn("[SuperAdmin] Aviso na verificação de tenants fantasmas:", cleanErr?.message)
          }
        }
      } catch (authExc: any) {
        console.warn("[SuperAdmin] Exceção não-bloqueante no provisionamento de Auth:", authExc.message)
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
      aiProvider === "hybrid" ? ["openai", "gemini"] : [aiProvider || "openai"]

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
      if (workflowTemplateKey && workflowTemplateKey !== "none") {
        let template: any = WORKFLOW_TEMPLATES[workflowTemplateKey]
        if (!template) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workflowTemplateKey)
          let query = adminClient
            .from("platform_workflow_templates")
            .select("key, label, stages")

          if (isUuid) {
            query = query.eq("id", workflowTemplateKey)
          } else {
            query = query.eq("key", workflowTemplateKey)
          }

          const { data: dbTmpl } = await query.maybeSingle()

          if (dbTmpl && Array.isArray(dbTmpl.stages)) {
            template = {
              key: dbTmpl.key,
              label: dbTmpl.label,
              stages: dbTmpl.stages,
            }
          }
        }

        if (template) {
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
          admin_email: adminEmail ? adminEmail.trim().toLowerCase() : null,
          admin_user_id: authUserId,
          cnpj: cnpj || null,
          workflow_template: appliedTemplateName,
        },
        reason: "Provisionamento inicial de tenant com usuário responsável via Painel SuperAdmin",
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
        adminEmail: adminEmail ? adminEmail.trim().toLowerCase() : null,
        adminPassword: authUserId
          ? userAlreadyExisted
            ? "(usuário já cadastrado no Auth)"
            : finalPassword
          : null,
        userCreated: !!authUserId,
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
          allowed_llm_providers: ["openai"],
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
  requireCloseReason?: boolean
  customAddonUnitPriceBrl?: number | null
  customOverageUnitPriceBrl?: number | null
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
    if (newLimits.customAddonUnitPriceBrl !== undefined) {
      updatePayload.custom_addon_unit_price_brl =
        newLimits.customAddonUnitPriceBrl === null
          ? null
          : Math.max(0, Number(newLimits.customAddonUnitPriceBrl) || 0)
    }
    if (newLimits.customOverageUnitPriceBrl !== undefined) {
      updatePayload.custom_overage_unit_price_brl =
        newLimits.customOverageUnitPriceBrl === null
          ? null
          : Math.max(0, Number(newLimits.customOverageUnitPriceBrl) || 0)
    }

    const persistLimits = async (payloadToSave: Record<string, any>) => {
      if (currentLimits) {
        return await adminClient
          .from("company_limits")
          .update(payloadToSave)
          .eq("company_id", companyId)
          .select("*")
          .single()
      }
      return await adminClient
        .from("company_limits")
        .insert({
          company_id: companyId,
          ...payloadToSave,
          max_monthly_quotes: 1000,
          max_catalog_items: 50000,
        })
        .select("*")
        .single()
    }

    let { data: limitsData, error: limitsErr } = await persistLimits(updatePayload)
    if (
      limitsErr &&
      (String(limitsErr.code || "") === "42703" ||
        String(limitsErr.message || "").toLowerCase().includes("column"))
    ) {
      const {
        custom_addon_unit_price_brl: _ignoreCustomAddon,
        custom_overage_unit_price_brl: _ignoreCustomOverage,
        ...legacyPayload
      } = updatePayload
      const retryRes = await persistLimits(legacyPayload)
      limitsData = retryRes.data
      limitsErr = retryRes.error
    }

    if (limitsErr) {
      console.error("[SuperAdmin] Erro ao salvar company_limits:", limitsErr)
      return { success: false, error: `Falha ao salvar limites: ${limitsErr.message}` }
    }
    const limitsResult = limitsData

    // 2.1. Atualizar política de motivo de encerramento da empresa se especificado
    if (newLimits.requireCloseReason !== undefined) {
      try {
        await adminClient
          .from("companies")
          .update({
            require_close_reason: Boolean(newLimits.requireCloseReason),
            updated_at: new Date().toISOString(),
          })
          .eq("id", companyId)
      } catch (policyErr: any) {
        console.warn("[SuperAdmin] Aviso ao atualizar require_close_reason:", policyErr?.message)
      }
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

    // Carrega templates incluindo blueprints customizados no banco
    const dynamicList = await getPlatformWorkflowTemplatesList()
    const templatesMap: Record<string, WorkflowTemplate> = { ...WORKFLOW_TEMPLATES }
    for (const t of dynamicList) {
      templatesMap[t.key] = t
    }

    return {
      success: true,
      data: {
        workflow,
        templates: templatesMap,
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

    let template: any = WORKFLOW_TEMPLATES[templateKey]
    if (!template) {
      // Buscar no banco de dados caso seja um template dinâmico/customizado
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateKey)
      let query = adminClient
        .from("platform_workflow_templates")
        .select("key, label, stages")

      if (isUuid) {
        query = query.eq("id", templateKey)
      } else {
        query = query.eq("key", templateKey)
      }

      const { data: dbTmpl } = await query.maybeSingle()

      if (dbTmpl && Array.isArray(dbTmpl.stages)) {
        template = {
          key: dbTmpl.key,
          label: dbTmpl.label,
          stages: dbTmpl.stages,
        }
      }
    }

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
          stage_names: (template.stages as any[]).map((s: any) => s.name),
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

/**
 * Inicia uma sessão administrativa de Impersonate para o SuperAdmin operar como o tenant alvo
 */
export async function impersonateCompanyAction(
  targetCompanyId: string
): Promise<ActionResult<{ redirectUrl: string; targetName: string }>> {
  try {
    // 1. Validação estrita: apenas operadores superadmin em platform_admins podem impersonar
    const { operator, user } = await requirePlatformAdmin()

    const adminClient = createAdminClient()

    // 2. Consulta os dados da empresa alvo
    const { data: targetCompany, error: compErr } = await adminClient
      .from("companies")
      .select("id, name, slug, status")
      .eq("id", targetCompanyId)
      .single()

    if (compErr || !targetCompany) {
      return { success: false, error: "Empresa de destino não encontrada." }
    }

    if (targetCompany.status === "suspended") {
      return { success: false, error: "Não é possível impersonar uma organização suspensa." }
    }

    // 3. Captura o vínculo atual de company_id do profile do superadmin
    const { data: currentProfile } = await adminClient
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()

    const originalCompanyId =
      currentProfile?.company_id || "90e69b50-1b4e-4f4a-94f2-78be1cf82833"

    // 4. Grava os cookies seguros de impersonação
    const cookieStore = cookies()
    cookieStore.set("ellevee_impersonate_active", targetCompanyId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 horas
    })
    cookieStore.set("ellevee_impersonate_original", originalCompanyId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
    })

    // 5. Atualiza o profile do operador no banco para conceder acesso RLS transparente
    await adminClient
      .from("profiles")
      .update({
        company_id: targetCompanyId,
        role: "owner",
      })
      .eq("id", user.id)

    // 6. Auditoria obrigatória
    try {
      await adminClient.from("platform_audit_logs").insert({
        actor_id: user.id,
        actor_email: user.email,
        action: "platform.impersonate_started",
        target_company_id: targetCompanyId,
        payload_summary: {
          operator_role: operator.role,
          target_name: targetCompany.name,
          target_slug: targetCompany.slug,
          original_company_id: originalCompanyId,
        },
        reason: "Sessão de suporte e onboarding administrativo via Painel SuperAdmin",
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Aviso de auditoria impersonate:", auditErr.message)
    }

    revalidatePath("/", "layout")
    revalidatePath("/dashboard")
    revalidatePath("/companies")

    return {
      success: true,
      data: {
        redirectUrl: "/dashboard",
        targetName: targetCompany.name,
      },
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Erro ao iniciar impersonação:", err)
    return {
      success: false,
      error: `Falha ao iniciar impersonação: ${err.message || "Erro desconhecido"}`,
    }
  }
}

/**
 * Encerra a sessão de Impersonate e restaura o perfil original do SuperAdmin
 */
export async function stopImpersonateAction(): Promise<ActionResult<{ redirectUrl: string }>> {
  try {
    const { user } = await requirePlatformAdmin()
    const adminClient = createAdminClient()
    const cookieStore = cookies()

    const targetCompanyId = cookieStore.get("ellevee_impersonate_active")?.value
    const originalCompanyId =
      cookieStore.get("ellevee_impersonate_original")?.value ||
      "90e69b50-1b4e-4f4a-94f2-78be1cf82833"

    // 1. Restaura o perfil do operador para sua empresa original
    await adminClient
      .from("profiles")
      .update({
        company_id: originalCompanyId,
        role: "admin",
      })
      .eq("id", user.id)

    // 2. Remove os cookies
    cookieStore.delete("ellevee_impersonate_active")
    cookieStore.delete("ellevee_impersonate_original")

    // 3. Auditoria obrigatória
    if (targetCompanyId) {
      try {
        await adminClient.from("platform_audit_logs").insert({
          actor_id: user.id,
          actor_email: user.email,
          action: "platform.impersonate_stopped",
          target_company_id: targetCompanyId,
          payload_summary: {
            restored_company_id: originalCompanyId,
          },
          reason: "Encerramento voluntário de sessão de impersonação",
          status: "success",
        })
      } catch (auditErr: any) {
        console.warn("[SuperAdmin] Aviso de auditoria stop impersonate:", auditErr.message)
      }
    }

    revalidatePath("/", "layout")
    revalidatePath("/dashboard")
    revalidatePath("/companies")

    return {
      success: true,
      data: {
        redirectUrl: "/companies",
      },
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Erro ao encerrar impersonação:", err)
    return {
      success: false,
      error: `Falha ao encerrar impersonação: ${err.message || "Erro desconhecido"}`,
    }
  }
}

/**
 * Retorna os detalhes da empresa atualmente impersonada, caso haja uma sessão ativa
 */
export async function getImpersonateStatus(): Promise<{
  isImpersonating: boolean
  targetCompanyId?: string
  targetCompanyName?: string
  targetCompanySlug?: string
}> {
  try {
    const cookieStore = cookies()
    const targetCompanyId = cookieStore.get("ellevee_impersonate_active")?.value
    if (!targetCompanyId) {
      return { isImpersonating: false }
    }

    const adminClient = createAdminClient()
    const { data: comp } = await adminClient
      .from("companies")
      .select("id, name, slug")
      .eq("id", targetCompanyId)
      .maybeSingle()

    if (!comp) {
      return { isImpersonating: false }
    }

    return {
      isImpersonating: true,
      targetCompanyId: comp.id,
      targetCompanyName: comp.name,
      targetCompanySlug: comp.slug,
    }
  } catch {
    return { isImpersonating: false }
  }
}

export interface AdminCompanyUser {
  id: string
  fullName: string
  email: string
  role: "owner" | "admin" | "attendant" | "user" | string
  createdAt: string
}

/**
 * SuperAdmin: Consulta usuários de uma organização específica
 */
export async function getCompanyUsersAction(companyId: string): Promise<AdminCompanyUser[]> {
  const adminClient = createAdminClient()
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })

  if (error || !profiles) {
    console.error("[SuperAdmin] Erro ao listar membros da empresa:", error)
    return []
  }

  return profiles.map((p) => ({
    id: p.id,
    fullName: p.full_name || "Sem nome",
    email: p.email || "",
    role: p.role || "user",
    createdAt: p.created_at ? p.created_at.split("T")[0] : "",
  }))
}

/**
 * SuperAdmin: Cria um atendente ou administrador para uma empresa específica
 */
export async function createCompanyAttendantAction(input: {
  companyId: string
  fullName: string
  email: string
  password?: string
  role: "attendant" | "admin"
}): Promise<ActionResult<{ id: string; fullName: string; email: string; password: string; role: string }>> {
  try {
    const { companyId, fullName, email } = input
    const role = input.role === "admin" ? "admin" : "attendant"

    if (!companyId) return { success: false, error: "ID da empresa obrigatório." }
    if (!fullName || fullName.trim().length < 2) return { success: false, error: "Nome inválido." }
    if (!email || !email.includes("@")) return { success: false, error: "E-mail inválido." }

    const cleanEmail = email.trim().toLowerCase()
    const password =
      input.password && input.password.trim().length >= 6
        ? input.password.trim()
        : `@Atend${Math.floor(100000 + Math.random() * 900000)}`

    const adminClient = createAdminClient()

    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      app_metadata: {
        skip_tenant_trigger: true,
        company_id: companyId,
        created_via: "superadmin_users_dialog",
      },
      user_metadata: {
        full_name: fullName.trim(),
        company_id: companyId,
      },
    })

    if (authErr || !authUser?.user) {
      return { success: false, error: `Falha ao criar credenciais no Auth: ${authErr?.message}` }
    }

    const userId = authUser.user.id

    const { error: profErr } = await adminClient.from("profiles").upsert(
      {
        id: userId,
        company_id: companyId,
        full_name: fullName.trim(),
        email: cleanEmail,
        role,
      },
      { onConflict: "id" }
    )

    if (profErr) {
      return { success: false, error: `Falha ao vincular perfil: ${profErr.message}` }
    }

    // Limpeza defensiva
    try {
      const firstName = fullName.trim().split(" ")[0]
      const { data: ghostCompanies } = await adminClient
        .from("companies")
        .select("id")
        .neq("id", companyId)
        .ilike("name", `Empresa de ${firstName}%`)

      if (ghostCompanies && ghostCompanies.length > 0) {
        for (const ghost of ghostCompanies) {
          const { count } = await adminClient
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("company_id", ghost.id)

          if (!count || count === 0) {
            await adminClient.from("companies").delete().eq("id", ghost.id)
          }
        }
      }
    } catch {
      // silencioso
    }

    revalidatePath("/companies")
    return {
      success: true,
      data: {
        id: userId,
        fullName: fullName.trim(),
        email: cleanEmail,
        password,
        role,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro desconhecido" }
  }
}

/**
 * SuperAdmin: Remove um usuário da empresa
 */
export async function deleteCompanyAttendantAction(
  companyId: string,
  userId: string
): Promise<ActionResult> {
  try {
    const adminClient = createAdminClient()
    await adminClient.from("profiles").delete().eq("id", userId).eq("company_id", companyId)
    await adminClient.auth.admin.deleteUser(userId)
    revalidatePath("/companies")
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao deletar usuário" }
  }
}

/**
 * SuperAdmin: Adiciona pacote extra mensal (1.000, 5.000, 10.000 ou 15.000 mensagens enviadas)
 */
export async function addCompanyAddonPackageAction(
  companyId: string,
  packageMessages: AddonPackageSize,
  notes?: string
): Promise<ActionResult<CompanyAddonRecord>> {
  try {
    const { operator, user } = await requirePlatformAdmin()
    if (!companyId) {
      return { success: false, error: "Identificador da empresa inválido." }
    }
    if (!(ADDON_PACKAGE_SIZES as readonly number[]).includes(packageMessages)) {
      return {
        success: false,
        error: "Tamanho de pacote inválido. Escolha 1.000, 5.000, 10.000 ou 15.000 mensagens.",
      }
    }

    const adminClient = createAdminClient()
    const { data: company, error: compErr } = await adminClient
      .from("companies")
      .select("id, name, slug, plan_tier")
      .eq("id", companyId)
      .maybeSingle()

    if (compErr || !company) {
      return { success: false, error: "Empresa não encontrada no banco de dados." }
    }

    const planKey = resolvePlanBillingKey(company.plan_tier)
    let customAddonPrice: number | null = null
    let planAddonPrice: number | undefined

    try {
      const { data: limitRow } = await adminClient
        .from("company_limits")
        .select("custom_addon_unit_price_brl")
        .eq("company_id", companyId)
        .maybeSingle()
      if (limitRow && (limitRow as any).custom_addon_unit_price_brl !== null && (limitRow as any).custom_addon_unit_price_brl !== undefined) {
        customAddonPrice = Number((limitRow as any).custom_addon_unit_price_brl)
      }
    } catch {
      // coluna custom ainda não migrada
    }

    try {
      const { data: planRow } = await adminClient
        .from("platform_plans")
        .select("addon_package_unit_price_brl")
        .eq("key", planKey)
        .maybeSingle()
      if (planRow && (planRow as any).addon_package_unit_price_brl !== null && (planRow as any).addon_package_unit_price_brl !== undefined) {
        planAddonPrice = Number((planRow as any).addon_package_unit_price_brl)
      }
    } catch {
      // coluna no plano ainda não migrada
    }

    const resolvedSummary = calculateCompanyBillingOverage({
      sentMessages: 0,
      baseQuotaMessages: 0,
      addonUnitPriceBrl: customAddonPrice ?? planAddonPrice,
      isTrial: planKey === "trial",
    })

    const unitPriceBrl = resolvedSummary.addonUnitPriceBrl
    const totalPriceBrl = Number((packageMessages * unitPriceBrl).toFixed(2))
    const billingMonth = getCurrentBillingMonth()
    const cleanNotes = notes && notes.trim().length > 0 ? notes.trim() : null

    const { data: inserted, error: insertErr } = await adminClient
      .from("company_message_addons")
      .insert({
        company_id: companyId,
        billing_month: billingMonth,
        package_messages: packageMessages,
        unit_price_brl: unitPriceBrl,
        total_price_brl: totalPriceBrl,
        status: "active",
        notes: cleanNotes,
        created_by: operator?.id || user?.id || null,
      })
      .select("id, billing_month, package_messages, unit_price_brl, total_price_brl, status, notes, created_at")
      .single()

    if (insertErr || !inserted) {
      const code = String(insertErr?.code || "")
      if (code === "42P01" || String(insertErr?.message || "").includes("does not exist")) {
        return {
          success: false,
          error:
            "Tabela company_message_addons não encontrada no Supabase. Execute a migration 2026111204_overage_and_addon_packages.sql no SQL Editor.",
        }
      }
      return {
        success: false,
        error: `Falha ao registrar pacote adicional: ${insertErr?.message || "Erro desconhecido"}`,
      }
    }

    try {
      await adminClient.from("platform_audit_logs").insert({
        actor_id: operator?.id || user?.id,
        actor_email: operator?.email || user?.email || "admin@ellevee.com",
        action: "company.addon_added",
        target_company_id: companyId,
        payload_summary: {
          company_name: company.name,
          company_slug: company.slug,
          billing_month: billingMonth,
          package_messages: packageMessages,
          unit_price_brl: unitPriceBrl,
          total_price_brl: totalPriceBrl,
          notes: cleanNotes,
        },
        reason: `Contratação de pacote extra (+${packageMessages.toLocaleString("pt-BR")} msgs enviadas)`,
        status: "success",
      })
    } catch {
      // auditoria não-bloqueante
    }

    try {
      revalidatePath("/companies")
      revalidatePath("/paineladmin")
      revalidatePath("/admin-settings")
      revalidatePath("/audit")
    } catch {
      // ignora em testes
    }

    return {
      success: true,
      data: {
        id: inserted.id,
        billingMonth: inserted.billing_month,
        packageMessages: Number(inserted.package_messages),
        unitPriceBrl: Number(inserted.unit_price_brl),
        totalPriceBrl: Number(inserted.total_price_brl),
        status: "active",
        notes: inserted.notes || null,
        createdAt: inserted.created_at,
      },
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro inesperado ao adicionar pacote." }
  }
}

/**
 * SuperAdmin: Cancela/estorna um pacote adicional do mês vigente
 */
export async function cancelCompanyAddonPackageAction(
  companyId: string,
  addonId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const { operator, user } = await requirePlatformAdmin()
    if (!companyId || !addonId) {
      return { success: false, error: "Empresa ou pacote inválido." }
    }

    const adminClient = createAdminClient()
    const { data: existing, error: fetchErr } = await adminClient
      .from("company_message_addons")
      .select("id, company_id, billing_month, package_messages, total_price_brl, status")
      .eq("id", addonId)
      .eq("company_id", companyId)
      .maybeSingle()

    if (fetchErr || !existing) {
      return { success: false, error: "Pacote adicional não encontrado para esta empresa." }
    }

    const { error: updateErr } = await adminClient
      .from("company_message_addons")
      .update({
        status: "cancelled",
      })
      .eq("id", addonId)
      .eq("company_id", companyId)

    if (updateErr) {
      return { success: false, error: `Falha ao cancelar pacote: ${updateErr.message}` }
    }

    try {
      await adminClient.from("platform_audit_logs").insert({
        actor_id: operator?.id || user?.id,
        actor_email: operator?.email || user?.email || "admin@ellevee.com",
        action: "company.addon_cancelled",
        target_company_id: companyId,
        payload_summary: {
          addon_id: addonId,
          billing_month: existing.billing_month,
          package_messages: existing.package_messages,
          total_price_brl: existing.total_price_brl,
        },
        reason: "Cancelamento/estorno de pacote extra pelo SuperAdmin",
        status: "success",
      })
    } catch {
      // auditoria não-bloqueante
    }

    try {
      revalidatePath("/companies")
      revalidatePath("/paineladmin")
      revalidatePath("/admin-settings")
      revalidatePath("/audit")
    } catch {
      // ignora em testes
    }

    return { success: true, data: { id: addonId } }
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro inesperado ao cancelar pacote." }
  }
}
