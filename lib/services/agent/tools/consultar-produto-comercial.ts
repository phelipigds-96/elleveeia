import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'
import { resolveProductPrice } from '../../commercial/pricing'

export const consultarProdutoComercialTool: ToolDefinition = {
  name: 'consultar_produto_comercial',
  description: 'Busca produto e calcula preco numa unica etapa. Se "not_found", diga que nao achou (nao presuma estoque). Se "ambiguous", peca para esclarecer.',
  metadata: { category: 'commercial', capabilities: ['product.search', 'price.calculate'] },
  schema: z.object({
    product_query: z.string().describe('Termo buscado.'),
    quantity: z.number().int().positive().optional().describe('Qtd desejada (padrao 1).'),
    price_type: z.string().optional().describe('Tipo de preco (retail/wholesale/club). Deixe vazio p/ regra automatica.')
  }),
  execute: async (input, context) => {
    const { product_query, quantity = 1, price_type } = input
    
    const searchResult = await searchProducts(context.companyId, product_query, 5)

    if (searchResult.status === 'not_found' || searchResult.matches.length === 0) {
      return {
        success: true,
        data: {
          status: 'not_found'
        }
      }
    }

    if (searchResult.status === 'ambiguous') {
      return {
        success: true,
        data: {
          status: 'ambiguous',
          matches: searchResult.matches.map(m => ({
            id: m.id,
            name: m.name
          }))
        }
      }
    }

    const bestProduct = searchResult.matches[0]

    try {
      const pricingResult = await resolveProductPrice({
        companyId: context.companyId,
        productId: bestProduct.id,
        quantity,
        priceType: price_type
      })

      return {
        success: true,
        data: {
          status: 'exact_match',
          product: {
            id: bestProduct.id,
            name: bestProduct.name
          },
          pricing: {
            unit_price: pricingResult.unitPrice,
            subtotal: pricingResult.subtotal
          }
        }
      }
    } catch (pricingError: any) {
      return {
        success: false,
        error: `Falha ao calcular preco: ${pricingError.message}`,
        data: {
          status: 'exact_match',
          product: {
            id: bestProduct.id,
            name: bestProduct.name
          }
        }
      }
    }
  }
}
