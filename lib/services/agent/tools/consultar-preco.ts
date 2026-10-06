import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { getProductPrices } from '../../catalog/prices'

export const consultarPrecoTool: ToolDefinition = {
  name: 'consultar_preco',
  description: 'Consulta o preço de um produto específico. Requer o ID do produto obtido através da ferramenta buscar_produto.',
  metadata: { category: 'pricing', capabilities: ['price.read'] },
  schema: z.object({
    productId: z.string().uuid().describe('O ID (UUID) do produto retornado pela ferramenta buscar_produto.'),
    priceType: z.string().optional().describe('Tipo de preço opcional (ex: "retail", "wholesale"). Se não enviado, retorna todos.'),
    quantity: z.number().optional().describe('Quantidade desejada para calcular faixas de preço de atacado.')
  }),
  execute: async (input, context) => {
    const { productId, priceType, quantity } = input
    
    // Novamente, o contexto.companyId blinda o acesso indevido
    const response = await getProductPrices(context.companyId, productId, priceType, quantity)

    return response
  }
}
