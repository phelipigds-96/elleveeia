import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/service"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const DEFAULT_PREVIEW_COMPANY_ID = "00000000-0000-0000-0000-000000000001"

/**
 * Endpoint de upload direto via multipart/form-data para o bucket chat-media.
 * Suporta imagens, áudios e documentos até 25MB.
 */
export async function POST(req: NextRequest) {
  try {
    let companyId: string | null = null

    try {
      const supabase = createClient()
      const { data: authData } = await supabase.auth.getUser()

      if (authData?.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", authData.user.id)
          .maybeSingle()

        if (profile?.company_id) {
          companyId = profile.company_id
        }
      }
    } catch (authErr) {
      console.warn("[UploadAPI] Contexto de auth SSR não disponível, usando fallback:", authErr)
    }

    const safeCompanyId = companyId || DEFAULT_PREVIEW_COMPANY_ID

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

    const adminClient = createAdminClient()
    const sanitizedName = (file.name || "arquivo").replace(/[^a-zA-Z0-9.-]/g, "_")
    const filePath = `${safeCompanyId}/${Date.now()}-${sanitizedName}`
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
