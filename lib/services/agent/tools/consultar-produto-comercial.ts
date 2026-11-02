import { z } from 'zod'
import type { ToolDefinition } from '../tools'
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

    // Resolução individual de preços para os candidatos retornados (máximo 5)
    const candidatePrices = new Map<string, { unit_price: number, subtotal: number }>()
    const candidateErrors = new Map<string, string>()

    if (searchResult.matches && searchResult.matches.length > 0) {
      const targetMatches = searchResult.matches.slice(0, 5)
      await Promise.all(
        targetMatches.map(async (prod) => {
          try {
            const p = await resolveProductPrice({
              companyId: context.companyId,
              productId: prod.id,
              quantity,
              priceType: price_type
            })
            candidatePrices.set(prod.id, {
              unit_price: p.unitPrice,
              subtotal: p.subtotal
            })
          } catch (err: any) {
            // Tratamento individual: produtos sem preço configurado não travam os demais,
            // mas preservamos a mensagem de erro específica para o diagnóstico
            candidateErrors.set(prod.id, err?.message || 'Produto não possui preço configurado ou está indisponível.')
          }
        })
      )
    }

    let pricingData: any = undefined
    let hasPricingError = false
    let pricingErrorMessage = ''

    if (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1)) {
      const bestProduct = searchResult.matches[0]
      const resolved = candidatePrices.get(bestProduct.id)
      if (resolved) {
        pricingData = resolved
      } else {
        hasPricingError = true
        pricingErrorMessage = candidateErrors.get(bestProduct.id) || 'Produto não possui preço configurado ou está indisponível.'
      }
    }

    const strategyPayload = applyCommercialStrategy(product_query, searchResult, quantity, pricingData, candidatePrices)

    if (hasPricingError && (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1))) {
      return {
        success: false,
        error: `Falha ao calcular preco: ${pricingErrorMessage}`,
        data: strategyPayload
      }
    }

    return {
      success: true,
      data: strategyPayload
    }
  }
}