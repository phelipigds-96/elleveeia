import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { resolveProductPrice } from '@/lib/services/commercial/pricing'

const InputSchema = z.object({
  product_id: z.string().uuid().describe('ID único do produto retornado pela buscar_produto'),
  quantity: z.number().int().positive().describe('Quantidade desejada do produto (maior que zero)'),
  price_type: z.string().optional().describe('Tipo de preço desejado, ex: retail, wholesale, club. Deixe vazio para aplicar a melhor regra.')
})

export const calcularPrecoProdutoTool: ToolDefinition = {
  name: 'calcular_preco_produto',
  description: 'Calcula o preço de um produto de acordo com a quantidade solicitada, retornando o preço unitário aplicável, subtotal e regras respeitadas.',
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
          subtotal: result.subtotal,
          price_type: result.priceType,
          min_quantity: result.minQuantity,
          source: result.source
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
