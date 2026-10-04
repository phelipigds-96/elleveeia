import { createAdminClient } from '@/lib/supabase/service'
import { resolveProductPrice } from './pricing'

export interface QuoteItemRequest {
  productId: string
  quantity: number
}

export interface CreateQuoteRequest {
  companyId: string
  customerId?: string
  items: QuoteItemRequest[]
}

export async function createQuote(params: CreateQuoteRequest) {
  const { companyId, customerId, items } = params

  if (!items || items.length === 0) {
    throw new Error('O orçamento deve conter pelo menos um item.')
  }

  const supabase = createAdminClient()

  // 1. Resolver todos os preços
  const resolvedItems = []
  let totalCents = 0

  for (const item of items) {
    // resolveProductPrice garante a validação da quantidade e cálculo exato
    const pricing = await resolveProductPrice({
      companyId,
      productId: item.productId,
      quantity: item.quantity
    })

    resolvedItems.push(pricing)
    totalCents += Math.round(pricing.subtotal * 100)
  }

  const grandTotal = totalCents / 100

  // 2. Criar registro do orçamento principal
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      company_id: companyId,
      customer_id: customerId || null,
      status: 'draft',
      total: grandTotal
    })
    .select('id')
    .single()

  if (quoteErr || !quote) {
    throw new Error(`Erro ao criar orçamento: ${quoteErr?.message}`)
  }

  // 3. Criar os itens do orçamento
  const quoteItemsPayload = resolvedItems.map(item => ({
    quote_id: quote.id,
    company_id: companyId,
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    subtotal: item.subtotal
  }))

  const { error: itemsErr } = await supabase
    .from('quote_items')
    .insert(quoteItemsPayload)

  if (itemsErr) {
    // Compensação: idealmente deveria ser transaction, 
    // mas Supabase RPC não é necessário aqui, podemos apenas registrar o erro
    throw new Error(`Erro ao salvar itens do orçamento: ${itemsErr.message}`)
  }

  return {
    quoteId: quote.id,
    total: grandTotal,
    items: resolvedItems
  }
}
