import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { createAdminClient } from '@/lib/supabase/service'
import { isPlausibleHumanName, sanitizeCustomerName } from '@/lib/services/customer-name'

const InputSchema = z.object({
  customer_name: z
    .string()
    .min(2, 'Informe o nome com pelo menos 2 caracteres.')
    .max(80, 'Nome muito longo.')
    .describe('Nome real informado pelo cliente na conversa (ex: "Maria Silva" ou "João").'),
})

export const salvarNomeClienteTool: ToolDefinition = {
  name: 'salvar_nome_cliente',
  description:
    'Salva o nome real informado pelo cliente no cadastro para identificá-lo nos próximos atendimentos. Chame assim que o cliente informar como prefere ser chamado(a).',
  metadata: { category: 'general', capabilities: ['customer.update_name'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { customer_name } = input as z.infer<typeof InputSchema>

    if (!context.customerId) {
      return {
        success: false,
        error: 'Cliente não vinculado a esta conversa.',
      }
    }

    if (!isPlausibleHumanName(customer_name)) {
      return {
        success: false,
        error:
          'O valor informado não parece um nome pessoal válido. Confirme novamente como o cliente prefere ser chamado.',
      }
    }

    const cleanName = sanitizeCustomerName(customer_name)
    const supabase = createAdminClient()
    const nowIso = new Date().toISOString()

    const { error } = await supabase
      .from('customers')
      .update({
        name: cleanName,
        name_confirmed: true,
        name_source: 'agent_collected',
        updated_at: nowIso,
      })
      .eq('id', context.customerId)
      .eq('company_id', context.companyId)

    if (error && error.code === '42703') {
      const { error: baseErr } = await supabase
        .from('customers')
        .update({
          name: cleanName,
          updated_at: nowIso,
        })
        .eq('id', context.customerId)
        .eq('company_id', context.companyId)

      if (baseErr) {
        return {
          success: false,
          error: `Falha ao salvar nome do cliente: ${baseErr.message}`,
        }
      }
    } else if (error) {
      return {
        success: false,
        error: `Falha ao salvar nome do cliente: ${error.message}`,
      }
    }

    return {
      success: true,
      data: {
        customer_id: context.customerId,
        name: cleanName,
        name_confirmed: true,
      },
    }
  },
}
