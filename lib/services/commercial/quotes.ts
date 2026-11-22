import { createAdminClient } from '@/lib/supabase/service'
import { resolveBatchProductPrices, parseCommercialValidityDate, type PriceResolutionResult } from './pricing'

export type QuoteStatus = 'draft' | 'pending_validation' | 'ready' | 'expired' | 'cancelled'

export interface QuoteItemRequest {
  productId: string
  quantity: number
  unit?: string
  priceType?: string
}

export interface QuoteItemData {
  productId: string
  sku: string | null
  name: string
  productName?: string // compatibilidade retroativa
  quantity: number
  unit: string
  unitPriceCents: number
  unitPrice: number
  subtotalCents: number
  subtotal: number
  priceType: string
  appliedRule: string
  priceSourceId: string
  isConfirmed: boolean
  status: 'confirmed' | 'pending' | 'unavailable'
  pendingReason?: string
}

export interface QuoteVersionChange {
  version: number
  action: 'created' | 'item_added' | 'item_updated' | 'item_removed' | 'recalculated' | 'status_changed'
  changedAt: string
  summary: string
}

export interface EnterpriseQuote {
  id: string
  quoteId?: string // compatibilidade retroativa
  companyId: string
  customerId: string | null
  conversationId: string | null
  status: QuoteStatus
  version: number
  createdAt: string
  updatedAt: string
  validUntil: string
  items: QuoteItemData[]
  totalConfirmedCents: number
  totalConfirmed: number
  total?: number // compatibilidade retroativa
  totalPendingCents: number
  totalPending: number
  grandTotalCents: number
  grandTotal: number
  hasPendingItems: boolean
  pendingReasons: string[]
  changeHistory: QuoteVersionChange[]
  customerNotes?: string | null
  isReused?: boolean
  metadata: Record<string, any>
}

export interface CreateEnterpriseQuoteRequest {
  companyId: string
  customerId?: string
  conversationId?: string
  existingQuoteId?: string
  items: QuoteItemRequest[]
  customerNotes?: string
  validityDays?: number
  actionSummary?: string
  isClubEligible?: boolean
  forceStatus?: QuoteStatus
}

export interface CreateQuoteRequest {
  companyId: string
  customerId?: string
  conversationId?: string
  existingQuoteId?: string
  items: QuoteItemRequest[]
  customerNotes?: string
  isClubEligible?: boolean
}

export interface GetQuoteRequest {
  companyId: string
  quoteId: string
}

/**
 * Calcula a data de validade de um orçamento comercial no fuso de Brasília (-03:00)
 */
export function calculateQuoteValidityDate(validityDays: number = 3): string {
  const target = new Date()
  target.setDate(target.getDate() + validityDays)
  
  const yyyy = target.getFullYear()
  const mm = String(target.getMonth() + 1).padStart(2, '0')
  const dd = String(target.getDate()).padStart(2, '0')
  
  // Fim do dia no fuso de Brasília
  return `${yyyy}-${mm}-${dd}T23:59:59.999-03:00`
}

/**
 * Verifica se um orçamento comercial está expirado
 */
export function isQuoteExpired(quote: { validUntil?: string; metadata?: any }): boolean {
  const validUntilStr = quote.validUntil || quote.metadata?.valid_until
  if (!validUntilStr) return false

  const parsed = parseCommercialValidityDate(validUntilStr, true)
  if (parsed === 'INVALID' || !parsed) return false

  return new Date() > parsed
}

/**
 * Cria ou atualiza deterministicamente um orçamento comercial completo (Enterprise Quote)
 * Suporta múltiplos itens, controle de versões, cálculo em centavos inteiros e tolerância a pendências.
 */
export async function createOrUpdateEnterpriseQuote(
  params: CreateEnterpriseQuoteRequest
): Promise<EnterpriseQuote> {
  const {
    companyId,
    customerId,
    conversationId,
    existingQuoteId,
    items,
    customerNotes,
    validityDays = 3,
    actionSummary,
    isClubEligible = false,
    forceStatus
  } = params

  if (!companyId || typeof companyId !== 'string') {
    throw new Error('companyId é obrigatório para gerar orçamento.')
  }

  if (!items || items.length === 0) {
    throw new Error('O orçamento deve conter pelo menos um item.')
  }

  for (const it of items) {
    if (!it.productId || typeof it.productId !== 'string' || it.productId.trim() === '') {
      throw new Error('productId inválido para item do orçamento.')
    }
    if (typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      throw new Error(`Quantidade inválida (${it.quantity}). Informe um número inteiro positivo.`)
    }
  }

  const supabase = createAdminClient()

  // 1. Resolução dos preços pelo motor comercial em lote (ZERO N+1)
  const batchPricing = await resolveBatchProductPrices({
    companyId,
    items: items.map(item => ({
      productId: item.productId.trim(),
      quantity: item.quantity,
      unit: item.unit,
      priceType: item.priceType
    })),
    isClubEligible
  })

  // 2. Busca nomes e SKUs oficiais no catálogo da empresa em uma única consulta
  const uniqueProductIds = Array.from(new Set(items.map(i => i.productId.trim())))
  const { data: rawProducts } = await supabase
    .from('products')
    .select('id, name, sku, unit')
    .eq('company_id', companyId)
    .in('id', uniqueProductIds)

  const productMetaMap = new Map<string, { name: string; sku: string | null; unit: string }>()
  for (const p of (rawProducts || [])) {
    productMetaMap.set(p.id, {
      name: p.name,
      sku: p.sku || null,
      unit: p.unit || 'UN'
    })
  }

  // 3. Montagem dos itens estruturados e cálculo financeiro em centavos
  const quoteItems: QuoteItemData[] = []
  let totalConfirmedCents = 0
  let totalPendingCents = 0
  const pendingReasons: string[] = []

  for (const item of items) {
    const priced = batchPricing.items.find(p => p.productId === item.productId.trim())
    const prodMeta = productMetaMap.get(item.productId.trim())

    const isConfirmed = priced ? priced.status === 'confirmed' : false
    const unitPriceCents = priced && isConfirmed ? priced.unitPriceCents : 0
    const subtotalCents = priced && isConfirmed ? priced.subtotalCents : 0
    const unitPrice = unitPriceCents / 100
    const subtotal = subtotalCents / 100

    if (isConfirmed) {
      totalConfirmedCents += subtotalCents
    } else {
      const reason = priced?.unavailableReason || 'Produto sem preço configurado para a quantidade solicitada.'
      pendingReasons.push(reason)
      // Mantém subtotal estimado como 0 para itens pendentes no total financeiro oficial
      totalPendingCents += 0
    }

    quoteItems.push({
      productId: item.productId.trim(),
      sku: prodMeta?.sku || null,
      name: prodMeta?.name || 'Produto',
      productName: prodMeta?.name || 'Produto',
      quantity: item.quantity,
      unit: item.unit || prodMeta?.unit || priced?.unit || 'UN',
      unitPriceCents,
      unitPrice,
      subtotalCents,
      subtotal,
      priceType: priced?.priceType || 'unknown',
      appliedRule: priced?.appliedRule || 'none',
      priceSourceId: priced?.priceSourceId || '',
      isConfirmed,
      status: isConfirmed ? 'confirmed' : 'pending',
      pendingReason: isConfirmed ? undefined : priced?.unavailableReason
    })
  }

  const hasPendingItems = pendingReasons.length > 0 || !batchPricing.allConfirmed
  const totalConfirmed = totalConfirmedCents / 100
  const totalPending = totalPendingCents / 100
  const grandTotalCents = totalConfirmedCents + totalPendingCents
  const grandTotal = grandTotalCents / 100

  // Status determinístico do orçamento
  let status: QuoteStatus = 'ready'
  if (forceStatus) {
    status = forceStatus
  } else if (hasPendingItems) {
    status = 'pending_validation'
  }

  const nowIso = new Date().toISOString()
  const validUntilIso = calculateQuoteValidityDate(validityDays)

  // 4. Prevenção de duplicação e reutilização/versionamento
  let targetQuoteId: string | null = null
  let currentVersion = 1
  let changeHistory: QuoteVersionChange[] = []

  if (existingQuoteId) {
    const { data: existingQuote } = await supabase
      .from('quotes')
      .select('id, total, status, metadata')
      .eq('id', existingQuoteId)
      .eq('company_id', companyId)
      .in('status', ['draft', 'pending_validation', 'ready'])
      .maybeSingle()

    if (existingQuote) {
      targetQuoteId = existingQuote.id
      currentVersion = (existingQuote.metadata?.version || 1) + 1
      changeHistory = Array.isArray(existingQuote.metadata?.change_history)
        ? [...existingQuote.metadata.change_history]
        : []
    }
  } else if (conversationId) {
    const { data: existingByConv } = await supabase
      .from('quotes')
      .select('id, total, status, metadata')
      .eq('company_id', companyId)
      .in('status', ['draft', 'pending_validation', 'ready'])
      .contains('metadata', { conversation_id: conversationId })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingByConv) {
      targetQuoteId = existingByConv.id
      currentVersion = (existingByConv.metadata?.version || 1) + 1
      changeHistory = Array.isArray(existingByConv.metadata?.change_history)
        ? [...existingByConv.metadata.change_history]
        : []
    }
  }

  // 5. Persistência no banco (Atualização ou Inserção)
  if (targetQuoteId) {
    changeHistory.push({
      version: currentVersion,
      action: 'recalculated',
      changedAt: nowIso,
      summary: actionSummary || `Atualização para versão ${currentVersion}: ${quoteItems.length} itens recalibrados.`
    })

    const updatedMetadata = {
      conversation_id: conversationId,
      version: currentVersion,
      valid_until: validUntilIso,
      total_confirmed_cents: totalConfirmedCents,
      total_pending_cents: totalPendingCents,
      has_pending_items: hasPendingItems,
      pending_reasons: pendingReasons,
      change_history: changeHistory,
      customer_notes: customerNotes || null
    }

    const { error: updateErr } = await supabase
      .from('quotes')
      .update({
        total: totalConfirmed,
        status,
        metadata: updatedMetadata,
        updated_at: nowIso
      })
      .eq('id', targetQuoteId)

    if (updateErr) {
      throw new Error(`Erro ao atualizar orçamento: ${updateErr.message}`)
    }

    // Atualiza itens do orçamento
    await supabase.from('quote_items').delete().eq('quote_id', targetQuoteId)

    const quoteItemsPayload = quoteItems.map(item => ({
      quote_id: targetQuoteId,
      company_id: companyId,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      subtotal: item.subtotal,
      metadata: {
        sku: item.sku,
        unit: item.unit,
        unit_price_cents: item.unitPriceCents,
        subtotal_cents: item.subtotalCents,
        price_type: item.priceType,
        applied_rule: item.appliedRule,
        price_source_id: item.priceSourceId,
        is_confirmed: item.isConfirmed,
        status: item.status,
        pending_reason: item.pendingReason
      }
    }))

    const { error: itemsErr } = await supabase.from('quote_items').insert(quoteItemsPayload)
    if (itemsErr) {
      throw new Error(`Erro ao salvar itens do orçamento: ${itemsErr.message}`)
    }

    return {
      id: targetQuoteId,
      quoteId: targetQuoteId,
      companyId,
      customerId: customerId || null,
      conversationId: conversationId || null,
      status,
      version: currentVersion,
      createdAt: nowIso,
      updatedAt: nowIso,
      validUntil: validUntilIso,
      items: quoteItems,
      totalConfirmedCents,
      totalConfirmed,
      total: totalConfirmed,
      totalPendingCents,
      totalPending,
      grandTotalCents,
      grandTotal,
      hasPendingItems,
      pendingReasons,
      changeHistory,
      customerNotes: customerNotes || null,
      isReused: true,
      metadata: updatedMetadata
    }
  }

  // Novo orçamento
  changeHistory.push({
    version: 1,
    action: 'created',
    changedAt: nowIso,
    summary: actionSummary || 'Orçamento inicial gerado.'
  })

  const newMetadata = {
    conversation_id: conversationId,
    version: 1,
    valid_until: validUntilIso,
    total_confirmed_cents: totalConfirmedCents,
    total_pending_cents: totalPendingCents,
    has_pending_items: hasPendingItems,
    pending_reasons: pendingReasons,
    change_history: changeHistory,
    customer_notes: customerNotes || null
  }

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      company_id: companyId,
      customer_id: customerId || null,
      status,
      total: totalConfirmed,
      metadata: newMetadata
    })
    .select('id')
    .single()

  if (quoteErr || !quote) {
    throw new Error(`Erro ao criar orçamento: ${quoteErr?.message}`)
  }

  const quoteItemsPayload = quoteItems.map(item => ({
    quote_id: quote.id,
    company_id: companyId,
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    subtotal: item.subtotal,
    metadata: {
      sku: item.sku,
      unit: item.unit,
      unit_price_cents: item.unitPriceCents,
      subtotal_cents: item.subtotalCents,
      price_type: item.priceType,
      applied_rule: item.appliedRule,
      price_source_id: item.priceSourceId,
      is_confirmed: item.isConfirmed,
      status: item.status,
      pending_reason: item.pendingReason
    }
  }))

  const { error: itemsErr } = await supabase.from('quote_items').insert(quoteItemsPayload)
  if (itemsErr) {
    throw new Error(`Erro ao salvar itens do orçamento: ${itemsErr.message}`)
  }

  return {
    id: quote.id,
    quoteId: quote.id,
    companyId,
    customerId: customerId || null,
    conversationId: conversationId || null,
    status,
    version: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
    validUntil: validUntilIso,
    items: quoteItems,
    totalConfirmedCents,
    totalConfirmed,
    total: totalConfirmed,
    totalPendingCents,
    totalPending,
    grandTotalCents,
    grandTotal,
    hasPendingItems,
    pendingReasons,
    changeHistory,
    customerNotes: customerNotes || null,
    isReused: false,
    metadata: newMetadata
  }
}

/**
 * Cria ou atualiza orçamento comercial (wrapper retrocompatível)
 */
export async function createQuote(params: CreateQuoteRequest) {
  const quote = await createOrUpdateEnterpriseQuote(params)
  return {
    quoteId: quote.id,
    total: quote.totalConfirmed,
    items: quote.items,
    isReused: quote.isReused ?? false,
    enterprise: quote
  }
}

/**
 * Consulta um orçamento comercial completo
 */
export async function getQuote(params: GetQuoteRequest): Promise<EnterpriseQuote | null> {
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
        metadata,
        products (
          id,
          name,
          sku,
          unit
        )
      )
    `)
    .eq('company_id', companyId)
    .eq('id', quoteId)
    .maybeSingle()

  if (error || !quote) {
    return null
  }

  const items: QuoteItemData[] = (quote.quote_items || []).map((it: any) => {
    const rawPrice = Number(it.unit_price)
    const rawSubtotal = Number(it.subtotal)
    const uCents = it.metadata?.unit_price_cents ?? Math.round(rawPrice * 100)
    const sCents = it.metadata?.subtotal_cents ?? Math.round(rawSubtotal * 100)
    return {
      productId: it.product_id,
      sku: it.products?.sku || it.metadata?.sku || null,
      name: it.products?.name || 'Produto',
      productName: it.products?.name || 'Produto',
      quantity: Number(it.quantity),
      unit: it.products?.unit || it.metadata?.unit || 'UN',
      unitPriceCents: uCents,
      unitPrice: rawPrice,
      subtotalCents: sCents,
      subtotal: rawSubtotal,
      priceType: it.metadata?.price_type || 'retail',
      appliedRule: it.metadata?.applied_rule || 'default',
      priceSourceId: it.metadata?.price_source_id || '',
      isConfirmed: it.metadata?.is_confirmed ?? true,
      status: it.metadata?.status || 'confirmed',
      pendingReason: it.metadata?.pending_reason
    }
  })

  const totalConfirmedCents = quote.metadata?.total_confirmed_cents ?? Math.round(Number(quote.total) * 100)
  const totalPendingCents = quote.metadata?.total_pending_cents ?? 0
  const grandTotalCents = totalConfirmedCents + totalPendingCents

  return {
    id: quote.id,
    quoteId: quote.id,
    companyId: quote.company_id,
    customerId: quote.customer_id,
    conversationId: quote.metadata?.conversation_id || null,
    status: quote.status as QuoteStatus,
    version: quote.metadata?.version || 1,
    createdAt: quote.created_at,
    updatedAt: quote.updated_at,
    validUntil: quote.metadata?.valid_until || calculateQuoteValidityDate(3),
    items,
    totalConfirmedCents,
    totalConfirmed: totalConfirmedCents / 100,
    total: totalConfirmedCents / 100,
    totalPendingCents,
    totalPending: totalPendingCents / 100,
    grandTotalCents,
    grandTotal: grandTotalCents / 100,
    hasPendingItems: quote.metadata?.has_pending_items ?? false,
    pendingReasons: quote.metadata?.pending_reasons || [],
    changeHistory: quote.metadata?.change_history || [],
    customerNotes: quote.metadata?.customer_notes || null,
    metadata: quote.metadata || {}
  }
}

/**
 * Formata um orçamento comercial em formato legível para WhatsApp
 */
export function formatQuoteForWhatsApp(quote: EnterpriseQuote): string {
  const validUntilDate = quote.validUntil
    ? new Date(quote.validUntil).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : '3 dias'

  const lines: string[] = [
    '📋 *ORÇAMENTO COMERCIAL* — Ellevee IA',
    `_Validade da proposta: até ${validUntilDate}_ (v${quote.version})`,
    '',
    '🛒 *Itens do Orçamento:*'
  ]

  quote.items.forEach((item, index) => {
    const formattedUnit = item.unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const formattedSub = item.subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const statusIcon = item.status === 'confirmed' ? '•' : '⏳'
    const ruleLabel = item.appliedRule ? ` (${item.appliedRule})` : ''

    lines.push(`${index + 1}. *${item.name}*`)
    if (item.status === 'confirmed') {
      lines.push(`   ${statusIcon} Qtd: ${item.quantity} ${item.unit}${ruleLabel}`)
      lines.push(`   ${statusIcon} ${formattedUnit} un | Subtotal: *${formattedSub}*`)
    } else {
      lines.push(`   ${statusIcon} Qtd: ${item.quantity} ${item.unit} — _${item.pendingReason || 'Preço pendente de confirmação'}_`)
    }
  })

  lines.push('')
  lines.push('━━━━━━━━━━━━━━━━━━━━')

  const formattedTotal = quote.totalConfirmed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  lines.push(`💰 *Total Confirmado:* *${formattedTotal}*`)

  if (quote.hasPendingItems) {
    lines.push('')
    lines.push('⚠️ *Atenção:* Alguns itens requerem validação comercial humana e não estão incluídos no total acima.')
  }

  lines.push('')
  lines.push('ℹ️ _Esta proposta é válida por tempo limitado e não reserva estoque. Para formalizar o pedido ou tirar dúvidas, é só me avisar!_ 😊')

  return lines.join('\n')
}
