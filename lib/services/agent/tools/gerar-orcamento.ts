import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { createQuote } from '@/lib/services/commercial/quotes'

const InputSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().uuid().describe('ID único do produto retornado pela ferramenta buscar_produto'),
    quantity: z.number().int().positive().describe('Quantidade desejada deste produto (maior que zero)')
  })).describe('Lista de itens para o orçamento')
})

export const gerarOrcamentoTool: ToolDefinition = {
  name: 'gerar_orcamento',
  description: 'Gera um orçamento oficial contendo um ou múltiplos produtos e quantidades. O sistema calcula automaticamente os preços unitários, os subtotais e o valor total final, salvando o registro histórico.',
  inputSchema: InputSchema,
  execute: async (input, context) => {
    const { items } = input as z.infer<typeof InputSchema>

    try {
      const result = await createQuote({
        companyId: context.companyId,
        customerId: context.customerId, // Passamos o customerId do contexto se existir
        items: items.map(i => ({
          productId: i.product_id,
          quantity: i.quantity
        }))
      })

      return {
        success: true,
        data: {
          quote_id: result.quoteId,
          total: result.total,
          items: result.items.map(item => ({
            product_id: item.productId,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            subtotal: item.subtotal,
            price_type: item.priceType
          }))
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      }
    }
  }
}
