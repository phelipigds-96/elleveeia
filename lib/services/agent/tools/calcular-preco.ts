import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { resolveProductPrice } from '@/lib/services/commercial/pricing'

const InputSchema = z.object({
  product_id: z.string().uuid().describe('ID do produto'),
  quantity: z.number().int().positive().describe('Qtd desejada'),
  price_type: z.string().optional().describe('Tipo preco (retail/wholesale/club)')
})

export const calcularPrecoProdutoTool: ToolDefinition = {
  name: 'calcular_preco_produto',
  description: 'Calcula preco final de um produto conforme a quantidade.',
  metadata: { category: 'pricing', capabilities: ['price.calculate'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { product_id, quantity, price_type } = input as z.infer<typeof InputSchema>

    try {
      const result = await resolveProductPrice({
        companyId: context.companyId,
        productId: product_id,
        quantity,
        priceType: price_type
      })

      return {
        success: true,
        data: {
          product_id: result.productId,
          quantity: result.quantity,
          unit_price: result.unitPrice,
          subtotal: result.subtotal
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
