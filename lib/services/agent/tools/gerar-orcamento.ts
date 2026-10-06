import { z } from 'zod'
import { ToolDefinition } from '../tools'

export const gerarOrcamentoTool: ToolDefinition = {
  name: 'gerar_orcamento',
  description: 'Gera pedido/orcamento. Tente puxar id/preco da Working Memory.',
  metadata: { category: 'quotes', capabilities: ['quote.create'] },
  schema: z.object({
    items: z.array(z.object({
      product_id: z.string(),
      quantity: z.number(),
      unit_price: z.number().optional()
    })).describe('Itens do orcamento'),
    customer_notes: z.string().optional()
  }),
  execute: async (input, context) => {
    // Implementacao mocada por enquanto
    const total = input.items.reduce((acc, item) => acc + (item.quantity * (item.unit_price || 0)), 0)
    
    return {
      success: true,
      data: {
        id: `ORC-${Math.floor(Math.random() * 10000)}`,
        status: 'draft',
        total
      }
    }
  }
}
