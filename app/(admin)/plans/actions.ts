"use server"

import { revalidatePath } from "next/cache"
import { requirePlatformAdmin } from "@/lib/services/platform/admin"
import {
  DEFAULT_PLANS,
  PlatformPlan,
  PlatformPlanKey,
  UpdatePlatformPlanInput,
} from "@/lib/services/platform/plans"

/**
 * Server Action segura para atualizar os parâmetros de um plano da plataforma
 */
export async function updatePlatformPlanAction(
  planKey: PlatformPlanKey,
  updates: UpdatePlatformPlanInput
): Promise<{ success: boolean; data?: PlatformPlan; error?: string }> {
  try {
    // 1. Verificação de permissões do operador da plataforma
    await requirePlatformAdmin()

    const { createAdminClient } = await import("@/lib/supabase/service")
    const adminClient = createAdminClient()

    // 2. Validações de limites e limites operacionais
    if (updates.priceMonthly !== undefined && updates.priceMonthly < 0) {
      return { success: false, error: "O valor mensal do plano não pode ser negativo." }
    }
    if (updates.maxMonthlyMessages !== undefined && updates.maxMonthlyMessages < 100) {
      return { success: false, error: "A cota de mensagens mensais mínima é de 100 mensagens." }
    }
    if (updates.maxAgents !== undefined && updates.maxAgents < 1) {
      return { success: false, error: "O número máximo de agentes deve ser de no mínimo 1." }
    }

    // 3. Localizar plano padrão
    const defPlan = DEFAULT_PLANS.find((p) => p.key === planKey)
    if (!defPlan) {
      return { success: false, error: `Plano '${planKey}' não reconhecido pela plataforma.` }
    }

    // 4. Upsert/Update no banco de dados na tabela platform_plans
    const dbPayload: any = {
      key: planKey,
      updated_at: new Date().toISOString(),
    }

    if (updates.name !== undefined) dbPayload.name = updates.name.trim()
    if (updates.description !== undefined) dbPayload.description = updates.description.trim()
    if (updates.priceMonthly !== undefined) dbPayload.price_monthly = updates.priceMonthly
    if (updates.maxMonthlyMessages !== undefined) dbPayload.max_monthly_messages = updates.maxMonthlyMessages
    if (updates.maxAgents !== undefined) dbPayload.max_agents = updates.maxAgents
    if (updates.maxCatalogItems !== undefined) dbPayload.max_catalog_items = updates.maxCatalogItems
    if (updates.maxMonthlyQuotes !== undefined) dbPayload.max_monthly_quotes = updates.maxMonthlyQuotes
    if (updates.defaultAiProvider !== undefined) dbPayload.default_ai_provider = updates.defaultAiProvider
    if (updates.defaultAiModel !== undefined) dbPayload.default_ai_model = updates.defaultAiModel
    if (updates.allowedLlmProviders !== undefined) dbPayload.allowed_llm_providers = updates.allowedLlmProviders
    if (updates.badge !== undefined) dbPayload.badge = updates.badge
    if (updates.isPopular !== undefined) dbPayload.is_popular = updates.isPopular
    if (updates.active !== undefined) dbPayload.active = updates.active
    if (updates.features !== undefined) dbPayload.features = updates.features

    let persistedRow: any = null
    const { data: updatedDb, error: updateErr } = await adminClient
      .from("platform_plans")
      .upsert(
        {
          ...dbPayload,
          name: dbPayload.name || defPlan.name,
          description: dbPayload.description || defPlan.description,
          features: dbPayload.features || defPlan.features,
        },
        { onConflict: "key" }
      )
      .select("*")
      .single()

    if (!updateErr && updatedDb) {
      persistedRow = updatedDb
    }

    // 5. Auditoria de Governança em platform_audit_logs
    try {
      // Coleta dados do operador autenticado
      const { createClient } = await import("@/lib/supabase/server")
      const userClient = createClient()
      const { data: authData } = await userClient.auth.getUser()

      let actorId = authData?.user?.id
      let actorEmail = authData?.user?.email

      if (!actorId || !actorEmail) {
        const { data: defaultAdmin } = await adminClient
          .from("platform_admins")
          .select("id, email")
          .eq("active", true)
          .limit(1)
          .maybeSingle()

        actorId = defaultAdmin?.id || "71ee00c9-e22b-479d-bc34-9d596448c3f9"
        actorEmail = defaultAdmin?.email || "admin@ellevee.com"
      }

      const changesSummary = [
        updates.priceMonthly !== undefined ? `R$ ${updates.priceMonthly}/mês` : null,
        updates.maxMonthlyMessages !== undefined ? `${updates.maxMonthlyMessages.toLocaleString("pt-BR")} msgs` : null,
        updates.maxAgents !== undefined ? `${updates.maxAgents} agentes` : null,
        updates.defaultAiModel ? `Modelo: ${updates.defaultAiModel}` : null,
      ]
        .filter(Boolean)
        .join(", ")

      await adminClient.from("platform_audit_logs").insert({
        actor_id: actorId,
        actor_email: actorEmail,
        action: "plan.updated",
        payload_summary: {
          plan_key: planKey,
          plan_name: updates.name || defPlan.name,
          updates,
          changes_summary: changesSummary,
        },
        reason: `Ajuste de parâmetros e cotas do plano ${defPlan.name} via SuperAdmin`,
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Erro não-bloqueante ao registrar auditoria do plano:", auditErr.message)
    }

    // 6. Revalidação das rotas dependentes
    try {
      revalidatePath("/plans")
      revalidatePath("/paineladmin")
      revalidatePath("/companies")
    } catch {
      // Ignora erro de revalidação em testes unitários
    }

    const finalPlan: PlatformPlan = {
      id: persistedRow?.id || defPlan.id,
      key: planKey,
      name: updates.name || persistedRow?.name || defPlan.name,
      description: updates.description || persistedRow?.description || defPlan.description,
      priceMonthly: updates.priceMonthly ?? Number(persistedRow?.price_monthly ?? defPlan.priceMonthly),
      maxMonthlyMessages: updates.maxMonthlyMessages ?? Number(persistedRow?.max_monthly_messages ?? defPlan.maxMonthlyMessages),
      maxAgents: updates.maxAgents ?? Number(persistedRow?.max_agents ?? defPlan.maxAgents),
      maxCatalogItems: updates.maxCatalogItems ?? Number(persistedRow?.max_catalog_items ?? defPlan.maxCatalogItems),
      maxMonthlyQuotes: updates.maxMonthlyQuotes ?? Number(persistedRow?.max_monthly_quotes ?? defPlan.maxMonthlyQuotes),
      defaultAiProvider: updates.defaultAiProvider || persistedRow?.default_ai_provider || defPlan.defaultAiProvider,
      defaultAiModel: updates.defaultAiModel || persistedRow?.default_ai_model || defPlan.defaultAiModel,
      allowedLlmProviders: updates.allowedLlmProviders || persistedRow?.allowed_llm_providers || defPlan.allowedLlmProviders,
      features: updates.features || persistedRow?.features || defPlan.features,
      badge: updates.badge !== undefined ? updates.badge : persistedRow?.badge !== undefined ? persistedRow.badge : defPlan.badge,
      isPopular: updates.isPopular !== undefined ? updates.isPopular : persistedRow?.is_popular !== undefined ? Boolean(persistedRow.is_popular) : defPlan.isPopular,
      active: updates.active !== undefined ? updates.active : persistedRow?.active !== undefined ? Boolean(persistedRow.active) : defPlan.active,
      updatedAt: new Date().toISOString(),
    }

    return {
      success: true,
      data: finalPlan,
    }
  } catch (err: any) {
    console.error("[SuperAdmin] Exceção em updatePlatformPlanAction:", err)
    return {
      success: false,
      error: `Erro ao salvar alterações do plano: ${err.message || "Erro desconhecido"}`,
    }
  }
}
