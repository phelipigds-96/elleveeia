"use server"

import { revalidatePath } from "next/cache"
import { moveConversationStage as moveConversationStageService } from "@/lib/services/workflows/workflows"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MoveConversationResult {
  success: boolean
  error?: string
}

/**
 * Movimenta uma conversa entre etapas do Kanban de /conversations.
 *
 * A identidade da empresa e do usuário é resolvida exclusivamente no servidor
 * (via moveConversationStage em lib/services/workflows/workflows.ts), que já
 * aplica RBAC (admin, owner, attendant), validação do ciclo de vida do tenant
 * e verificação de que a etapa pertence à empresa e ao workflow da conversa.
 */
export async function moveConversationStage(
  conversationId: string,
  stageId: string
): Promise<MoveConversationResult> {
  if (!conversationId || !UUID_REGEX.test(conversationId.trim())) {
    return { success: false, error: "Identificador de conversa inválido." }
  }
  if (!stageId || !UUID_REGEX.test(stageId.trim())) {
    return { success: false, error: "Identificador de etapa inválido." }
  }

  try {
    await moveConversationStageService(conversationId.trim(), stageId.trim())
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Não foi possível mover a conversa.",
    }
  }

  try {
    revalidatePath("/conversations")
  } catch {
    // revalidatePath pode falhar fora do contexto de requisição HTTP do Next.js
  }

  return { success: true }
}
