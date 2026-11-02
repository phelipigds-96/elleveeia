import { createAdminClient } from '@/lib/supabase/service'
import { resolveProductPrice } from './pricing'

export interface QuoteItemRequest {
  productId: string
  quantity: number
}

export interface CreateQuoteRequest {
  companyId: string
  customerId?: string
  conversationId?: string
  existingQuoteId?: string
  items: QuoteItemRequest[]
}

export interface GetQuoteRequest {
  companyId: string
  quoteId: string
}

export async function createQuote(params: CreateQuoteRequest) {
  const { companyId, customerId, conversationId, existingQuoteId, items } = params

  if (!items || items.length === 0) {
    throw new Error('O orçamento deve conter pelo menos um item.')
  }

  const supabase = createAdminClient()

  // 1. Resolver todos os preços pelo motor comercial
  const resolvedItems = []
  let totalCents = 0

  for (const item of items) {
    // resolveProductPrice garante a validação da quantidade e cálculo financeiro exato
    const pricing = await resolveProductPrice({
      companyId,
      productId: item.productId,
      quantity: item.quantity
    })

    resolvedItems.push(pricing)
    totalCents += Math.round(pricing.subtotal * 100)
  }

  const grandTotal = totalCents / 100

  // 2. Prevenção de duplicação: verificar se já existe um orçamento draft para este contexto
  let targetQuoteId: string | null = null

  if (existingQuoteId) {
    const { data: existingQuote } = await supabase
      .from('quotes')
      .select('id, total, status')
      .eq('id', existingQuoteId)
      .eq('company_id', companyId)
      .eq('status', 'draft')
      .maybeSingle()

    if (existingQuote) {
      targetQuoteId = existingQuote.id
    }
  } else if (conversationId) {
    const { data: existingByConv } = await supabase
      .from('quotes')
      .select('id, total, status')
      .eq('company_id', companyId)
      .eq('status', 'draft')
      .contains('metadata', { conversation_id: conversationId })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingByConv) {
      targetQuoteId = existingByConv.id
    }
  }

  if (targetQuoteId) {
    // Verificar se os itens existentes já são idênticos aos solicitados
    const { data: existingItems } = await supabase
      .from('quote_items')
      .select('product_id, quantity, unit_price, subtotal')
      .eq('quote_id', targetQuoteId)

    const isIdentical = existingItems &&
      existingItems.length === resolvedItems.length &&
      resolvedItems.every(r => existingItems.some((e: any) => e.product_id === r.productId && Number(e.quantity) === r.quantity))

    if (isIdentical) {
      return {
        quoteId: targetQuoteId,
        total: grandTotal,
        items: resolvedItems,
        isReused: true
      }
    }

    // Se os itens ou quantidades mudaram, atualiza o orçamento existente (evita duplicatas)
    const { error: updateErr } = await supabase
      .from('quotes')
      .update({
        total: grandTotal,
        updated_at: new Date().toISOString()
      })
      .eq('id', targetQuoteId)

    if (updateErr) {
      throw new Error(`Erro ao atualizar orçamento: ${updateErr.message}`)
    }

    await supabase
      .from('quote_items')
      .delete()
      .eq('quote_id', targetQuoteId)

    const quoteItemsPayload = resolvedItems.map(item => ({
      quote_id: targetQuoteId,
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
      throw new Error(`Erro ao salvar itens do orçamento: ${itemsErr.message}`)
    }

    return {
      quoteId: targetQuoteId,
      total: grandTotal,
      items: resolvedItems,
      isReused: true
    }
  }

  // 3. Criar novo registro de orçamento principal
  const quoteMetadata: Record<string, any> = {}
  if (conversationId) quoteMetadata.conversation_id = conversationId

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      company_id: companyId,
      customer_id: customerId || null,
      status: 'draft',
      total: grandTotal,
      metadata: quoteMetadata
    })
    .select('id')
    .single()

  if (quoteErr || !quote) {
    throw new Error(`Erro ao criar orçamento: ${quoteErr?.message}`)
  }

  // 4. Criar os itens do orçamento
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
    throw new Error(`Erro ao salvar itens do orçamento: ${itemsErr.message}`)
  }

  return {
    quoteId: quote.id,
    total: grandTotal,
    items: resolvedItems,
    isReused: false
  }
}

export async function getQuote(params: GetQuoteRequest) {
  const { companyId, quoteId } = params
  const supabase = createAdminClient()

  const { data: quote, error } = await supabase
    .from('quotes')
    .select(`
      id,
      company_id,
      customer_id,
      status,
      total,
      metadata,
      created_at,
      updated_at,
      quote_items (
        id,
        product_id,
        quantity,
        unit_price,
        subtotal,
        products (
          id,
          name
        )
      )
    `)
    .eq('company_id', companyId)
    .eq('id', quoteId)
    .maybeSingle()

  if (error || !quote) {
    return null
  }

  return {
    quoteId: quote.id,
    companyId: quote.company_id,
    customerId: quote.customer_id,
    status: quote.status,
    total: Number(quote.total),
    metadata: quote.metadata,
    createdAt: quote.created_at,
    updatedAt: quote.updated_at,
    items: (quote.quote_items || []).map((item: any) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.products?.name || 'Produto',
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      subtotal: Number(item.subtotal)
    }))
  }
}
