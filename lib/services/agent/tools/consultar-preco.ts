import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { resolveProductPrice } from '@/lib/services/commercial/pricing'

export const consultarPrecoTool: ToolDefinition = {
  name: 'consultar_preco',
  description: 'Consulta o preco unitario base de um produto. Use calcular_preco_produto para regras de quantidade.',
  metadata: { category: 'pricing', capabilities: ['price.search'] },
  schema: z.object({
    product_id: z.string().uuid().describe('ID do produto'),
    price_type: z.string().optional().describe('Tipo preco (retail/wholesale/club)')
  }),
  execute: async (input, context) => {
    const { product_id, price_type } = input

    try {
      const result = await resolveProductPrice({
        companyId: context.companyId,
        productId: product_id,
        quantity: 1, // unitário base
        priceType: price_type
      })

      return {
        success: true,
        data: {
          product_id: result.productId,
          unit_price: result.unitPrice
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
