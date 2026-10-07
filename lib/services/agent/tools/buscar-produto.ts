import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'
import { applyCommercialStrategy } from '../commercial-strategy'

export const buscarProdutoTool: ToolDefinition = {
  name: 'buscar_produto',
  description: 'Busca produtos por nome/atributos. Se "not_found", responda que nao achou (NUNCA diga "sem estoque"). Se "ambiguous", peca para o cliente esclarecer a opcao.',
  metadata: { category: 'catalog', capabilities: ['product.search'] },
  schema: z.object({
    query: z.string().describe('Termo buscado (ex: "cobertura sicao 1kg").'),
    limit: z.number().optional().describe('Maximo de resultados (padrao 5).')
  }),
  execute: async (input, context) => {
    const { query, limit = 5 } = input
    
    // A busca cuida da analise semantica e ranking.
    const result = await searchProducts(context.companyId, query, limit)

    const strategyPayload = applyCommercialStrategy(query, result, false)

    return {
      success: true,
      data: strategyPayload
    }
  }
}