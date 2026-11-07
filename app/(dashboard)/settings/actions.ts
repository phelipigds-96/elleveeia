"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/service"
import { requireCompanyAdmin } from "@/lib/services/auth/guard"

export interface CompanyMember {
  id: string
  fullName: string
  email: string
  role: "owner" | "admin" | "attendant" | "user" | string
  createdAt: string
}

export interface CreateCompanyUserInput {
  fullName: string
  email: string
  password?: string
  role: "attendant" | "admin"
}

export interface ActionResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Consulta todos os membros/perfis pertencentes à empresa do usuário logado
 */
export async function getCompanyMembersAction(): Promise<CompanyMember[]> {
  const currentProfile = await requireCompanyAdmin()
  if (!currentProfile.company_id) return []

  const adminClient = createAdminClient()
  const { data: profiles, error } = await adminClient
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .eq("company_id", currentProfile.company_id)
    .order("created_at", { ascending: true })

  if (error || !profiles) {
    console.error("[Settings] Erro ao listar membros da empresa:", error)
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
 * Cria um novo usuário/atendente vinculado à empresa atual
 */
export async function createCompanyUserAction(
  input: CreateCompanyUserInput
): Promise<ActionResult<{ id: string; fullName: string; email: string; password: string; role: string }>> {
  try {
    const currentProfile = await requireCompanyAdmin()
    if (!currentProfile.company_id) {
      return { success: false, error: "Empresa não identificada." }
    }

    const fullName = input.fullName?.trim() || ""
    const email = input.email?.trim().toLowerCase() || ""
    const role = input.role === "admin" ? "admin" : "attendant"

    if (fullName.length < 2) {
      return { success: false, error: "O nome deve conter pelo menos 2 caracteres." }
    }

    if (!email || !email.includes("@")) {
      return { success: false, error: "Informe um endereço de e-mail válido." }
    }

    // Gera senha temporária caso não informada
    const password =
      input.password && input.password.trim().length >= 6
        ? input.password.trim()
        : `@Atend${Math.floor(100000 + Math.random() * 900000)}`

    const adminClient = createAdminClient()

    // 1. Cria usuário no Supabase Auth com skip_tenant_trigger para evitar tenants fantasmas
    const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        skip_tenant_trigger: true,
        company_id: currentProfile.company_id,
        created_by_role: currentProfile.role,
      },
      user_metadata: {
        full_name: fullName,
        company_id: currentProfile.company_id,
      },
    })

    if (authErr || !authUser?.user) {
      return {
        success: false,
        error: `Falha ao criar credenciais de acesso: ${authErr?.message || "Erro desconhecido"}`,
      }
    }

    const userId = authUser.user.id

    // 2. Insere/atualiza o perfil vinculado à empresa da Sumel com o papel selecionado
    const { error: profErr } = await adminClient.from("profiles").upsert(
      {
        id: userId,
        company_id: currentProfile.company_id,
        full_name: fullName,
        email,
        role,
      },
      { onConflict: "id" }
    )

    if (profErr) {
      console.error("[Settings] Erro ao criar perfil do usuário:", profErr)
      return { success: false, error: `Falha ao vincular usuário à empresa: ${profErr.message}` }
    }

    // 3. Limpeza defensiva caso algum trigger legado tenha gerado uma empresa órfã
    try {
      const firstName = fullName.split(" ")[0]
      const { data: ghostCompanies } = await adminClient
        .from("companies")
        .select("id")
        .neq("id", currentProfile.company_id)
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

    revalidatePath("/settings")
    revalidatePath("/conversations")

    return {
      success: true,
      data: {
        id: userId,
        fullName,
        email,
        password,
        role,
      },
    }
  } catch (err: any) {
    return { success: false, error: `Erro interno: ${err?.message || "Falha desconhecida"}` }
  }
}

/**
 * Remove um usuário da empresa e revoga suas credenciais
 */
export async function deleteCompanyUserAction(userId: string): Promise<ActionResult> {
  try {
    const currentProfile = await requireCompanyAdmin()
    if (!currentProfile.company_id) {
      return { success: false, error: "Empresa não identificada." }
    }

    if (userId === currentProfile.id) {
      return { success: false, error: "Você não pode remover o seu próprio usuário administrador." }
    }

    const adminClient = createAdminClient()

    // 1. Valida se o usuário alvo pertence à mesma empresa
    const { data: targetProfile, error: getErr } = await adminClient
      .from("profiles")
      .select("id, company_id, role, full_name")
      .eq("id", userId)
      .maybeSingle()

    if (getErr || !targetProfile) {
      return { success: false, error: "Usuário não encontrado." }
    }

    if (targetProfile.company_id !== currentProfile.company_id) {
      return { success: false, error: "Acesso negado: o usuário não pertence à sua organização." }
    }

    // Impede que um admin comum delete o owner da empresa
    if (targetProfile.role === "owner" && currentProfile.role !== "owner") {
      return { success: false, error: "Apenas o proprietário da conta pode remover outro proprietário." }
    }

    // 2. Remove o perfil
    await adminClient.from("profiles").delete().eq("id", userId)

    // 3. Remove o usuário do Supabase Auth
    const { error: delAuthErr } = await adminClient.auth.admin.deleteUser(userId)
    if (delAuthErr) {
      console.warn("[Settings] Aviso ao deletar do Auth:", delAuthErr.message)
    }

    revalidatePath("/settings")
    return { success: true }
  } catch (err: any) {
    return { success: false, error: `Erro interno: ${err?.message || "Falha desconhecida"}` }
  }
}
