import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'

export const buscarProdutoTool: ToolDefinition = {
  name: 'buscar_produto',
  description: 'Busca produtos do catǭlogo da empresa por nome ou caractersticas. ATENO: NO existe integraǜo de estoque no momento. Se o status for "not_found", responda apenas que o produto nǜo foi localizado no catǭlogo, e NUNCA afirme que estǭ "sem estoque". Se for "ambiguous", pea para o usuǭrio esclarecer (ex: escolhendo entre os tamanhos/sabores retornados).',
  schema: z.object({
    query: z.string().describe('Frase ou termos de busca informados pelo cliente (ex: "cobertura genuine meio amargo 1kg").'),
    limit: z.number().optional().describe('Quantidade mǭxima de resultados a retornar (padrǜo 5).')
  }),
  execute: async (input, context) => {
    const { query, limit = 5 } = input
    
    // A busca agora cuida inteiramente da anǭlise semǦntica e ranking.
    // Retorna { status: 'exact_match' | 'ambiguous' | 'not_found', confidence, matches }
    const result = await searchProducts(context.companyId, query, limit)

    return {
      success: true,
      data: result
    }
  }
}
