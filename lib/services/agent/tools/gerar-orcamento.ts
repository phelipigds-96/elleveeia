import { z } from 'zod'
import type { ToolDefinition } from '../tools.ts'
import { createQuote } from '@/lib/services/commercial/quotes'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const InputSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().describe('ID do produto (UUID cadastrado no catálogo)'),
    quantity: z.number().int().positive().describe('Quantidade desejada'),
    unit_price: z.number().optional().describe('Preço unitário (opcional, o sistema recalcula pela tabela oficial)')
  })).min(1, 'O orçamento deve conter pelo menos um item.').describe('Itens do orçamento'),
  customer_notes: z.string().optional()
})

export const gerarOrcamentoTool: ToolDefinition = {
  name: 'gerar_orcamento',
  description: 'Gera e persiste um orçamento comercial formal com itens e quantidades validadas. Exige que o produto já tenha sido identificado e possua preço no catálogo. Não use para simples consulta de preço.',
  metadata: { category: 'quotes', capabilities: ['quote.create'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { items } = input as z.infer<typeof InputSchema>

    if (!items || items.length === 0) {
      return {
        success: false,
        error: 'O orçamento deve conter pelo menos um item.'
      }
    }

    for (const item of items) {
      if (!item.product_id || !UUID_REGEX.test(item.product_id.trim())) {
        return {
          success: false,
          error: `Identificador do produto inválido ("${item.product_id}"). É necessário selecionar e confirmar um produto válido do catálogo antes de gerar o orçamento.`
        }
      }

      if (typeof item.quantity !== 'number' || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
        return {
          success: false,
          error: `Quantidade inválida (${item.quantity}). Informe um número inteiro maior que zero para cada item.`
        }
      }
    }

    try {
      const quoteResult = await createQuote({
        companyId: context.companyId,
        customerId: context.customerId,
        conversationId: context.conversationId,
        existingQuoteId: context.workingMemory?.activeQuote?.id,
        items: items.map(i => ({
          productId: i.product_id.trim(),
          quantity: i.quantity
        }))
      })

      if (!quoteResult || !quoteResult.quoteId) {
        return {
          success: false,
          error: 'Falha ao persistir orçamento no sistema.'
        }
      }

      if (quoteResult.total <= 0) {
        return {
          success: false,
          error: 'O valor total do orçamento não pode ser zero. Verifique se o produto possui preço configurado.'
        }
      }

      return {
        success: true,
        data: {
          id: quoteResult.quoteId,
          status: 'draft',
          total: quoteResult.total,
          items: quoteResult.items,
          is_reused: quoteResult.isReused ?? false
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Erro inesperado ao gerar orçamento.'
      }
    }
  }
}
