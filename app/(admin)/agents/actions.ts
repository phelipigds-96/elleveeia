"use server"

import { revalidatePath } from "next/cache"
import { requirePlatformAdmin } from "@/lib/services/platform/admin"

/**
 * Server Action para alternar o status operacional (ativo/pausado) de um agente de IA
 */
export async function toggleAgentStatusAction(
  agentId: string,
  newActiveState: boolean
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    await requirePlatformAdmin()
    const { createAdminClient } = await import("@/lib/supabase/service")
    const adminClient = createAdminClient()

    // 1. Obter dados atuais do agente e empresa
    const { data: agent, error: fetchErr } = await adminClient
      .from("agents")
      .select("id, name, company_id, is_active, companies:company_id(name)")
      .eq("id", agentId)
      .maybeSingle()

    if (fetchErr || !agent) {
      return { success: false, error: "Agente não encontrado no banco de dados." }
    }

    // 2. Atualizar status no banco
    const { data: updated, error: updateErr } = await adminClient
      .from("agents")
      .update({
        is_active: newActiveState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", agentId)
      .select("id, name, is_active")
      .single()

    if (updateErr || !updated) {
      return {
        success: false,
        error: `Falha ao atualizar agente: ${updateErr?.message || "Erro desconhecido"}`,
      }
    }

    // 3. Registrar auditoria em platform_audit_logs
    try {
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

      const compName = (agent.companies as any)?.name || "Organização"

      await adminClient.from("platform_audit_logs").insert({
        actor_id: actorId,
        actor_email: actorEmail,
        action: "agent.status_changed",
        target_company_id: agent.company_id,
        payload_summary: {
          agent_id: agentId,
          agent_name: agent.name,
          company_name: compName,
          previous_status: agent.is_active ? "ativo" : "pausado",
          new_status: newActiveState ? "ativo" : "pausado",
        },
        reason: `Alteração operacional de status do agente para ${newActiveState ? "Ativo" : "Pausado"} via SuperAdmin`,
        status: "success",
      })
    } catch (auditErr: any) {
      console.warn("[SuperAdmin] Erro não-bloqueante na auditoria do agente:", auditErr.message)
    }

    try {
      revalidatePath("/agents")
      revalidatePath("/paineladmin")
    } catch {
      // Ignora erro de revalidação em testes unitários
    }

    return { success: true, data: updated }
  } catch (err: any) {
    return { success: false, error: err.message || "Erro ao atualizar status do agente" }
  }
}
