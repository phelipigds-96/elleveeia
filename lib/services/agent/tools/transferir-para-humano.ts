import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/service'
import type { ToolDefinition, ToolExecutionContext } from '../tools'

export const transferirParaHumanoSchema = z.object({
  reason: z
    .string()
    .min(2)
    .max(200)
    .optional()
    .describe('Motivo resumido da transferência para o atendente humano.'),
  department: z
    .string()
    .max(80)
    .optional()
    .describe('Setor sugerido (ex: vendas, financeiro, suporte).')
})

export const transferirParaHumanoTool: ToolDefinition = {
  name: 'transferir_para_humano',
  description:
    'Transfere o atendimento atual da IA para um atendente humano da equipe quando o cliente solicita explicitamente falar com uma pessoa/vendedor ou quando não for possível resolver pela IA.',
  schema: transferirParaHumanoSchema,
  metadata: {
    category: 'general',
    capabilities: ['handoff', 'human_transfer']
  },
  execute: async (rawInput, context: ToolExecutionContext) => {
    const input = (rawInput || {}) as z.infer<typeof transferirParaHumanoSchema>
    const { companyId, conversationId, agentId } = context
    if (!companyId || !conversationId) {
      return {
        success: false,
        error: 'Contexto da conversa incompleto para transferência.'
      }
    }

    const supabase = context.adminClient || createAdminClient()

    const { data: currentConv, error: convLookupErr } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('id', conversationId)
      .eq('company_id', companyId)
      .single()

    if (convLookupErr || !currentConv) {
      return {
        success: false,
        error: 'Conversa não encontrada para transferência.'
      }
    }

    if (currentConv.status === 'human') {
      return {
        success: true,
        transferred: true,
        already_in_human_mode: true,
        status: 'human',
        instruction:
          'A conversa já está direcionada para atendimento humano. Confirme gentilmente que a equipe continuará o atendimento.'
      }
    }

    const nowIso = new Date().toISOString()
    const { error: updateErr } = await supabase
      .from('conversations')
      .update({
        status: 'human',
        updated_at: nowIso
      })
      .eq('id', conversationId)
      .eq('company_id', companyId)

    if (updateErr) {
      return {
        success: false,
        error: `Falha ao atualizar status da conversa para atendimento humano: ${updateErr.message}`
      }
    }

    const cleanReason = input.reason?.trim()
    const cleanDept = input.department?.trim()
    const reasonSuffix = cleanReason ? ` Motivo: ${cleanReason}.` : ''
    const deptSuffix = cleanDept ? ` Setor: ${cleanDept}.` : ''

    try {
      const { error: eventInsertErr } = await supabase
        .from('messages')
        .insert({
          company_id: companyId,
          conversation_id: conversationId,
          sender_type: 'system',
          message_type: 'event',
          content: `IA transferiu o atendimento para atendente humano.${reasonSuffix}${deptSuffix}`,
          metadata: {
            handoff_triggered_by: 'agent_tool',
            agent_id: agentId,
            reason: cleanReason || null,
            department: cleanDept || null
          }
        })
      if (eventInsertErr) {
        console.warn('[transferir_para_humano] Falha não-bloqueante ao registrar evento de auditoria:', eventInsertErr.message)
      }
    } catch (eventErr: any) {
      console.warn('[transferir_para_humano] Falha não-bloqueante ao registrar evento de auditoria:', eventErr?.message || eventErr)
    }

    return {
      success: true,
      transferred: true,
      status: 'human',
      reason: cleanReason || null,
      department: cleanDept || null,
      instruction:
        'Despeça-se cordialmente do cliente e informe que um atendente humano dará continuidade ao atendimento em instantes.'
    }
  }
}
