import { z } from 'zod'
import type { ToolDefinition } from '../tools.ts'
import { getQuote } from '@/lib/services/commercial/quotes'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const InputSchema = z.object({
  quote_id: z.string().optional().describe('ID do orçamento (UUID). Se omitido, busca o orçamento ativo na memória operacional.')
})

export const consultarOrcamentoTool: ToolDefinition = {
  name: 'consultar_orcamento',
  description: 'Consulta os detalhes de um orçamento existente (itens, quantidades, preços unitários, valor total e status). Use quando o cliente perguntar sobre o valor total ou itens de um orçamento já gerado.',
  metadata: { category: 'quotes', capabilities: ['quote.read'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { quote_id } = input as z.infer<typeof InputSchema>
    const targetQuoteId = quote_id?.trim() || context.workingMemory?.activeQuote?.id

    if (!targetQuoteId) {
      return {
        success: false,
        error: 'Nenhum identificador de orçamento foi informado e não há orçamento ativo na memória da conversa.'
      }
    }

    if (!UUID_REGEX.test(targetQuoteId)) {
      return {
        success: false,
        error: `Identificador de orçamento inválido ("${targetQuoteId}"). Deve ser um UUID válido.`
      }
    }

    try {
      const quote = await getQuote({
        companyId: context.companyId,
        quoteId: targetQuoteId
      })

      if (!quote) {
        return {
          success: false,
          error: `Orçamento não encontrado com o ID ${targetQuoteId}.`
        }
      }

      return {
        success: true,
        data: {
          id: quote.quoteId,
          status: quote.status,
          total: quote.total,
          items: quote.items.map(i => ({
            product_id: i.productId,
            name: i.productName,
            quantity: i.quantity,
            unit_price: i.unitPrice,
            subtotal: i.subtotal
          }))
        }
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Erro ao consultar orçamento: ${err.message || err}`
      }
    }
  }
}
