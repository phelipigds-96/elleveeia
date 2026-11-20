import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Endpoint de upload direto via multipart/form-data para o bucket chat-media.
 * Suporta imagens, áudios e documentos até 25MB.
 * Exige autenticação estrita e empresa válida (fail-closed, sem tenant fixo).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: authData, error: authErr } = await supabase.auth.getUser()

    if (authErr || !authData?.user) {
      return NextResponse.json(
        { success: false, error: "Não autorizado: sessão de autenticação inválida ou ausente." },
        { status: 401 }
      )
    }

    const userId = authData.user.id
    const adminClient = createAdminClient()

    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("company_id, role")
      .eq("id", userId)
      .maybeSingle()

    if (profileErr || !profile?.company_id) {
      return NextResponse.json(
        { success: false, error: "Acesso negado: empresa não vinculada ao perfil do usuário." },
        { status: 403 }
      )
    }

    let companyId = profile.company_id

    // Suporte restrito e validado ao Impersonate: EXCLUSIVO para SuperAdmins ativos
    try {
      const { data: operator } = await adminClient
        .from("platform_admins")
        .select("id, role, active")
        .eq("id", userId)
        .maybeSingle()

      const isSuperAdmin = operator && operator.active === true && operator.role === "superadmin"

      if (isSuperAdmin) {
        const cookieStore = await cookies()
        const impersonateId = cookieStore.get("ellevee_impersonate_active")?.value
        if (impersonateId && UUID_REGEX.test(impersonateId)) {
          const { data: targetComp } = await adminClient
            .from("companies")
            .select("id, status")
            .eq("id", impersonateId)
            .maybeSingle()

          if (targetComp && targetComp.status !== "suspended") {
            companyId = targetComp.id
          }
        }
      }
    } catch {
      // cookies() pode não estar disponível em certos contextos
    }

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: "Acesso negado: empresa não identificada." },
        { status: 403 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: "Nenhum arquivo enviado no formulário." },
        { status: 400 }
      )
    }

    // Limite máximo de 25MB
    const MAX_SIZE = 25 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { success: false, error: "O arquivo excede o limite máximo de 25MB." },
        { status: 400 }
      )
    }

    const sanitizedName = (file.name || "arquivo").replace(/[^a-zA-Z0-9.-]/g, "_")
    const filePath = `${companyId}/${Date.now()}-${sanitizedName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await adminClient.storage
      .from("chat-media")
      .upload(filePath, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      })

    if (uploadErr) {
      console.error("[UploadAPI] Erro no upload para Supabase Storage:", uploadErr)
      return NextResponse.json(
        { success: false, error: uploadErr.message || "Falha ao gravar arquivo no storage." },
        { status: 500 }
      )
    }

    const {
      data: { publicUrl },
    } = adminClient.storage.from("chat-media").getPublicUrl(filePath)

    return NextResponse.json({
      success: true,
      url: publicUrl,
      fileName: file.name || "arquivo",
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
    })
  } catch (error: any) {
    console.error("[UploadAPI] Exceção em /api/chat/upload:", error)
    return NextResponse.json(
      { success: false, error: error?.message || "Erro interno ao processar upload." },
      { status: 500 }
    )
  }
}
