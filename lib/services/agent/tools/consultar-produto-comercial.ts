import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'
import { resolveProductPrice } from '../../commercial/pricing'
import { applyCommercialStrategy } from '../commercial-strategy'

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

    let pricingData: any = undefined
    let hasPricingError = false
    let pricingErrorMessage = ''

    if (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1)) {
      const bestProduct = searchResult.matches[0]
      try {
        const p = await resolveProductPrice({
          companyId: context.companyId,
          productId: bestProduct.id,
          quantity,
          priceType: price_type
        })
        pricingData = {
          unit_price: p.unitPrice,
          subtotal: p.subtotal
        }
      } catch (err: any) {
        hasPricingError = true
        pricingErrorMessage = err.message
      }
    }

    const strategyPayload = applyCommercialStrategy(product_query, searchResult, true, quantity, pricingData)

    if (hasPricingError) {
      return {
        success: false,
        error: "Falha ao calcular preco: ",
        data: strategyPayload
      }
    }

    return {
      success: true,
      data: strategyPayload
    }
  }
}