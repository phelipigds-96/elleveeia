import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'

export const buscarProdutoTool: ToolDefinition = {
  name: 'buscar_produto',
  description: 'Busca produtos do catálogo da empresa por nome, descrição, código, SKU ou código de barras.',
  schema: z.object({
    query: z.string().describe('Termo de busca (nome do produto, marca, código de barras, ou SKU).'),
    limit: z.number().optional().describe('Quantidade máxima de resultados a retornar (padrão 5).')
  }),
  execute: async (input, context) => {
    const { query, limit = 5 } = input
    
    // A chamada do serviço recebe o companyId proveniente EXCLUSIVAMENTE do contexto seguro.
    const products = await searchProducts(context.companyId, query, limit)

    return {
      success: true,
      products
    }
  }
}
