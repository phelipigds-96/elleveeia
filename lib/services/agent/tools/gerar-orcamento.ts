import { z } from 'zod'
import { ToolDefinition } from '../tools'

const InputSchema = z.object({
  items: z.array(z.object({
    product_id: z.string(),
    quantity: z.number(),
    unit_price: z.number().optional()
  })).describe('Itens do orcamento'),
  customer_notes: z.string().optional()
})

export const gerarOrcamentoTool: ToolDefinition = {
  name: 'gerar_orcamento',
  description: 'Gera pedido/orcamento. Tente puxar id/preco da Working Memory.',
  metadata: { category: 'quotes', capabilities: ['quote.create'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { items } = input as z.infer<typeof InputSchema>
    // Implementacao mocada por enquanto
    const total = items.reduce((acc: number, item) => acc + (item.quantity * (item.unit_price || 0)), 0)
    
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
