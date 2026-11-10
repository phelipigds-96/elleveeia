import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { resolveProductPrice } from '../../commercial/pricing'
import { searchProducts } from '../../catalog/products'

export const consultarPrecoTool: ToolDefinition = {
  name: 'consultar_preco',
  description: 'Consulta o preco unitario base de um produto. Use calcular_preco_produto para regras de quantidade.',
  metadata: { category: 'pricing', capabilities: ['price.search'] },
  schema: z.object({
    product_id: z.string().optional().describe('ID do produto (UUID exato de [PRODUTOS APRESENTADOS RECENTEMENTE] ou do catálogo). Preencha preferencialmente junto com product_name.'),
    product_name: z.string().optional().describe('Nome ou termo do produto (ex: "LEITE CONDENSADO SEMIDESNATADO TIROL 395G"). Preencha SEMPRE para identificação precisa.'),
    price_type: z.string().optional().describe('Tipo preco (retail/wholesale/club)')
  }),
  execute: async (input, context) => {
    const { product_id, product_name, price_type } = input

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let targetProductId = product_id && UUID_REGEX.test(product_id.trim()) ? product_id.trim() : null
    let resolvedProductName: string | undefined = product_name?.trim() || undefined

    // 1. Tenta identificar o nome nos produtos descobertos recentemente ou contexto ativo
    if (targetProductId && context.workingMemory?.discoveredProducts) {
      const found = context.workingMemory.discoveredProducts.find((p: any) => p.id === targetProductId)
      if (found && !resolvedProductName) resolvedProductName = found.name
    }
    if (targetProductId && !resolvedProductName && context.workingMemory?.activeProduct?.id === targetProductId) {
      resolvedProductName = context.workingMemory.activeProduct.name
    }

    // 2. Fallback de busca por nome se ID for ausente ou inválido
    if (!targetProductId && (product_name || resolvedProductName)) {
      const term = (product_name || resolvedProductName)!.trim()
      const searchRes = await searchProducts(context.companyId, term, 1)
      if (searchRes.matches && searchRes.matches.length > 0) {
        targetProductId = searchRes.matches[0].id
        resolvedProductName = searchRes.matches[0].name
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
        // Fallback se precificação por ID falhar
        const candidateTerm = product_name?.trim() || resolvedProductName || 
          context.workingMemory?.activeProduct?.name ||
          (context.workingMemory?.discoveredProducts?.length === 1 ? context.workingMemory.discoveredProducts[0].name : undefined)

        if (candidateTerm) {
          try {
            const fallbackSearch = await searchProducts(context.companyId, candidateTerm, 3)
            const validMatch = fallbackSearch.matches?.find(m => m.id !== targetProductId) || fallbackSearch.matches?.[0]
            if (validMatch && validMatch.id !== targetProductId) {
              const fallbackResult = await resolveProductPrice({
                companyId: context.companyId,
                productId: validMatch.id,
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
