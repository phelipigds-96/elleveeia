import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { resolveProductPrice } from '../../commercial/pricing'
import { searchProducts } from '../../catalog/products'

export const consultarPrecoTool: ToolDefinition = {
  name: 'consultar_preco',
  description: 'Consulta o preco unitario base de um produto. Use calcular_preco_produto para regras de quantidade.',
  metadata: { category: 'pricing', capabilities: ['price.search'] },
  schema: z.object({
    product_id: z.string().optional().describe('ID do produto (UUID cadastrado no catálogo). Use o ID de [PRODUTOS APRESENTADOS RECENTEMENTE]'),
    product_name: z.string().optional().describe('Nome ou termo do produto para identificação caso não tenha certeza do ID exato'),
    price_type: z.string().optional().describe('Tipo preco (retail/wholesale/club)')
  }),
  execute: async (input, context) => {
    const { product_id, product_name, price_type } = input

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let targetProductId = product_id && UUID_REGEX.test(product_id.trim()) ? product_id.trim() : null

    // 1. Fallback de busca por nome se ID for ausente ou inválido
    if (!targetProductId && product_name) {
      const searchRes = await searchProducts(context.companyId, product_name.trim(), 1)
      if (searchRes.matches && searchRes.matches.length > 0) {
        targetProductId = searchRes.matches[0].id
      }
    }

    if (targetProductId) {
      try {
        const result = await resolveProductPrice({
          companyId: context.companyId,
          productId: targetProductId,
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
        // Fallback por nome se a busca por ID falhar
        if (product_name) {
          try {
            const fallbackSearch = await searchProducts(context.companyId, product_name.trim(), 1)
            if (fallbackSearch.matches && fallbackSearch.matches.length > 0 && fallbackSearch.matches[0].id !== targetProductId) {
              const fallbackResult = await resolveProductPrice({
                companyId: context.companyId,
                productId: fallbackSearch.matches[0].id,
                quantity: 1,
                priceType: price_type
              })

              return {
                success: true,
                data: {
                  product_id: fallbackResult.productId,
                  unit_price: fallbackResult.unitPrice
                }
              }
            }
          } catch {
            // Preserva o erro original
          }
        }

        return {
          success: false,
          error: error.message
        }
      }
    }

    return {
      success: false,
      error: `Produto não localizado no catálogo para "${product_name || product_id || 'item não informado'}".`
    }
  }
}
