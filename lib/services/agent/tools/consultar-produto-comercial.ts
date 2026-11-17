import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'
import { parseQuery } from '../../catalog/search-logic'
import { resolveProductPrice } from '../../commercial/pricing'
import { applyCommercialStrategy, resolveReferenceQuery } from '../commercial-strategy'

export const consultarProdutoComercialTool: ToolDefinition = {
  name: 'consultar_produto_comercial',
  description: 'Busca produto e calcula preco numa unica etapa. Se a consulta for ampla (apenas marca ou termo geral), utilize as orientações consultivas retornadas para qualificar a necessidade do cliente antes de listar produtos desnecessários. Se "not_found", diga que nao achou (nao presuma estoque). Se "ambiguous", peca para esclarecer.',
  metadata: { category: 'commercial', capabilities: ['product.search', 'price.calculate'] },
  schema: z.object({
    product_query: z.string().describe('Termo buscado.'),
    quantity: z.number().int().positive().optional().describe('Qtd desejada (padrao 1).'),
    price_type: z.string().optional().describe('Tipo de preco (retail/wholesale/club). Deixe vazio p/ regra automatica.')
  }),
  execute: async (input, context) => {
    const { product_query, quantity = 1, price_type } = input
    
    // 1. Resolução Anafórica e Ordinal via Working Memory
    const refResolution = resolveReferenceQuery(product_query, context.workingMemory)

    // Se a referência for ambígua e exigir desambiguação amigável
    if (refResolution.isAmbiguous) {
      return {
        success: true,
        data: {
          strategy: 'ambiguous_product',
          consultative_hint: refResolution.ambiguityMessage,
          options: refResolution.candidateOptions?.map((o: any) => ({
            id: o.id || o.product?.id,
            name: o.name || o.product?.name
          }))
        }
      }
    }

    const effectiveQuery = refResolution.resolvedQuery || product_query
    const parsedQuery = parseQuery(effectiveQuery)

    const searchResult = await searchProducts(context.companyId, effectiveQuery, 12)

    // Se o cliente pediu outra marca e temos a marca anterior identificada para exclusão
    if (refResolution.excludeBrand && searchResult.matches.length > 0) {
      const excl = refResolution.excludeBrand.toLowerCase()
      const nonExcluded = searchResult.matches.filter(m => {
        const b = (m.brand || '').toLowerCase()
        const n = (m.name || '').toLowerCase()
        return !b.includes(excl) && !n.includes(excl)
      })
      if (nonExcluded.length > 0) {
        searchResult.matches = nonExcluded
      }
    }

    // Resolução individual de preços para os candidatos retornados (máximo 10)
    const candidatePrices = new Map<string, { unit_price: number, subtotal: number }>()
    const candidateErrors = new Map<string, string>()

    if (searchResult.matches && searchResult.matches.length > 0) {
      const targetMatches = searchResult.matches.slice(0, 10)
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

    const strategyPayload = applyCommercialStrategy(
      effectiveQuery,
      searchResult,
      quantity,
      pricingData,
      candidatePrices,
      refResolution,
      parsedQuery
    )

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