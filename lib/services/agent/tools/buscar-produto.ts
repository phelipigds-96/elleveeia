import { z } from 'zod'
import { ToolDefinition } from '../tools'
import { searchProducts } from '../../catalog/products'

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

    // Otimizando payload LLM-facing (removendo informacoes desnecessarias na desambiguacao)
    let llmResult: any = {
      status: result.status
    }

    if (result.status === 'exact_match' && result.matches.length > 0) {
      llmResult.matches = [{
        id: result.matches[0].id,
        name: result.matches[0].name
      }]
    } else if (result.status === 'ambiguous' && result.matches.length > 0) {
      // Retorna apenas ID e NOME para desambiguacao, cortando unit/brand se nao essenciais
      llmResult.matches = result.matches.map(m => ({
        id: m.id,
        name: m.name
      }))
    }

    return {
      success: true,
      data: llmResult
    }
  }
}
