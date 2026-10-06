import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'
import { resolveProductPrice } from '../../commercial/pricing'

export const consultarProdutoComercialTool: ToolDefinition = {
  name: 'consultar_produto_comercial',
  description: 'Busca um produto no catǭlogo e jǭ calcula o preo correto em uma ǧnica etapa. Utilize esta ferramenta preferencialmente quando o usuǭrio perguntar sobre produtos E preos (ex: "quanto custa a cobertura x"). Nǜo assuma estoque se o status for "not_found", diga apenas que o produto nǜo foi localizado. Se for "ambiguous", pea para o usuǭrio esclarecer.',
  schema: z.object({
    product_query: z.string().describe('Frase ou termos de busca informados pelo cliente (ex: "cobertura genuine meio amargo 1kg").'),
    quantity: z.number().int().positive().optional().describe('Quantidade desejada. Se nǜo informada, assume 1.'),
    price_type: z.string().optional().describe('Tipo de preo desejado, ex: retail, wholesale, club. Deixe vazio para aplicar a melhor regra automatica.')
  }),
  execute: async (input, context) => {
    const { product_query, quantity = 1, price_type } = input
    
    // 1. Busca semǭntica pelo produto
    const searchResult = await searchProducts(context.companyId, product_query, 5)

    // 2. Se nǜo encontrou, retorna diretamente
    if (searchResult.status === 'not_found' || searchResult.matches.length === 0) {
      return {
        success: true,
        data: {
          status: 'not_found',
          confidence: searchResult.confidence,
          matches: []
        }
      }
    }

    // 3. Se for ambguo, retorna os candidatos para o agente perguntar ao usuǭrio
    if (searchResult.status === 'ambiguous') {
      return {
        success: true,
        data: {
          status: 'ambiguous',
          confidence: searchResult.confidence,
          matches: searchResult.matches.map(m => ({
            id: m.id,
            name: m.name,
            brand: m.brand,
            unit: m.unit
          }))
        }
      }
    }

    // 4. Se for exact_match, resolvemos o preo da primeira e melhor opǜo
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
          confidence: searchResult.confidence,
          product: {
            id: bestProduct.id,
            name: bestProduct.name,
            brand: bestProduct.brand,
            unit: bestProduct.unit
          },
          pricing: {
            unit_price: pricingResult.unitPrice,
            subtotal: pricingResult.subtotal,
            price_type: pricingResult.priceType,
            quantity: pricingResult.quantity,
            min_quantity_applied: pricingResult.minQuantity
          }
        }
      }
    } catch (pricingError: any) {
      // Caso haja falha na resoluǜo do preo (ex: sem preo cadastrado), ainda retornamos o match
      return {
        success: false,
        error: `Produto encontrado, mas falhou ao calcular o preo: ${pricingError.message}`,
        data: {
          status: 'exact_match',
          confidence: searchResult.confidence,
          product: {
            id: bestProduct.id,
            name: bestProduct.name
          }
        }
      }
    }
  }
}
