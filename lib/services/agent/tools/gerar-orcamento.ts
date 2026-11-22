import { z } from 'zod'
import type { ToolDefinition } from '../tools.ts'
import { createOrUpdateEnterpriseQuote, formatQuoteForWhatsApp } from '@/lib/services/commercial/quotes'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const InputSchema = z.object({
  items: z.array(z.object({
    product_id: z.string().describe('ID do produto (UUID cadastrado no catálogo)'),
    quantity: z.number().int().positive().describe('Quantidade desejada'),
    unit_price: z.number().optional().describe('Preço unitário (opcional, o sistema recalcula pela tabela oficial)')
  })).optional().describe('Itens do orçamento. Se omitido, utiliza automaticamente os itens com preços confirmados do carrinho.'),
  customer_notes: z.string().optional()
})

export const gerarOrcamentoTool: ToolDefinition = {
  name: 'gerar_orcamento',
  description: 'Gera e persiste um orçamento comercial formal com itens e quantidades validadas. Exige que os produtos possuam preço oficial confirmado. Se os itens não forem informados diretamente, utiliza os itens do carrinho ativo.',
  metadata: { category: 'quotes', capabilities: ['quote.create'] },
  schema: InputSchema,
  execute: async (input, context) => {
    if (!context.companyId || !context.conversationId) {
      return {
        success: false,
        error: 'Contexto de execução inválido: companyId e conversationId são obrigatórios para gerar orçamento.'
      }
    }

    const { items, customer_notes } = input as z.infer<typeof InputSchema>

    let quoteItems: Array<{ productId: string; quantity: number }> = []

    if (items && items.length > 0) {
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

        quoteItems.push({
          productId: item.product_id.trim(),
          quantity: item.quantity
        })
      }
    } else {
      // Utiliza automaticamente itens confirmados do carrinho ativo
      const cartItems = context.workingMemory?.activeCart || []
      if (cartItems.length === 0) {
        return {
          success: false,
          error: 'O carrinho está vazio. Adicione produtos com preços confirmados antes de gerar o orçamento.'
        }
      }

      const confirmed = cartItems.filter((i: any) => i.isPriceConfirmed && (i.unitPriceCents || i.unitPrice))
      if (confirmed.length === 0) {
        return {
          success: false,
          error: 'Nenhum produto no carrinho possui preço confirmado. Realize o cálculo de preço oficial antes de formalizar o orçamento.'
        }
      }

      quoteItems = confirmed.map((i: any) => ({
        productId: i.productId.trim(),
        quantity: i.quantity
      }))
    }

    try {
      const quote = await createOrUpdateEnterpriseQuote({
        companyId: context.companyId,
        customerId: context.customerId,
        conversationId: context.conversationId,
        existingQuoteId: context.workingMemory?.activeQuote?.id,
        items: quoteItems,
        customerNotes: customer_notes
      })

      if (!quote || !quote.id) {
        return {
          success: false,
          error: 'Falha ao persistir orçamento no sistema.'
        }
      }

      if (quote.totalConfirmedCents <= 0) {
        return {
          success: false,
          error: 'O valor total do orçamento não pode ser zero. Verifique se o produto possui preço configurado.'
        }
      }

      return {
        success: true,
        data: {
          id: quote.id,
          quote_id: quote.id,
          version: quote.version,
          status: quote.status,
          total: quote.totalConfirmed,
          total_confirmed_cents: quote.totalConfirmedCents,
          total_pending_cents: quote.totalPendingCents,
          has_pending_items: quote.hasPendingItems,
          valid_until: quote.validUntil,
          items: quote.items,
          formatted_whatsapp: formatQuoteForWhatsApp(quote),
          is_reused: quote.isReused ?? false
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
