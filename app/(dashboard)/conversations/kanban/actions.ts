"use server"

import { revalidatePath } from "next/cache"
import { moveConversationStage } from "@/lib/services/workflows/workflows"

/**
 * Movimenta uma conversa para uma etapa do workflow (Kanban).
 * Reutiliza a camada de serviço que já concentra RBAC (admin/owner/attendant),
 * validação de tenant e verificação de pertencimento da etapa ao workflow.
 */
export async function moveConversationToStageAction(conversationId: string, stageId: string) {
  try {
    await moveConversationStage(conversationId, stageId)
    revalidatePath("/conversations")
    revalidatePath("/conversations/kanban")
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error?.message || "Não foi possível mover a conversa." }
  }
}
