import { createAdminClient } from '@/lib/supabase/service'
import { resolveBatchProductPrices, parseCommercialValidityDate, type PriceResolutionResult } from './pricing'

export type QuoteStatus = 'draft' | 'pending_validation' | 'ready' | 'expired' | 'cancelled'

export interface QuoteItemRequest {
  productId: string
  quantity: number
  unit?: string
  priceType?: string
  requestedQuantity?: number
  requestedUnit?: string
  packageFactor?: number | null
  internalQuantity?: number
  internalUnit?: string
  status?: 'confirmed' | 'pending' | 'unavailable' | 'ambiguous'
  pendingReason?: string
}

export interface QuoteItemData {
  productId: string
  sku: string | null
  name: string
  productName?: string // compatibilidade retroativa
  quantity: number
  unit: string
  requestedQuantity?: number
  requestedUnit?: string
  packageFactor?: number | null
  internalQuantity?: number
  internalUnit?: string
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
  expectedVersion?: number
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
  expectedVersion?: number
  items: QuoteItemRequest[]
  customerNotes?: string
  isClubEligible?: boolean
}

export interface GetQuoteRequest {
  companyId: string
  quoteId: string
  customerId?: string | null
  conversationId?: string | null
  allowCrossConversation?: boolean
}

/**
 * Calcula a data de validade de um orçamento comercial no fuso de Brasília (-03:00).
 * Respeita expressamente o dia civil em America/Sao_Paulo (UTC-3), eliminando divergências
 * causadas por fusos de servidores ou execuções noturnas (ex: após as 21h BRT / 00h UTC).
 */
export function calculateQuoteValidityDate(validityDays: number = 3, baseDate: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const dateStr = formatter.format(baseDate) // "YYYY-MM-DD"
  const [year, month, day] = dateStr.split('-').map(Number)

  const targetUtc = new Date(Date.UTC(year, month - 1, day))
  targetUtc.setUTCDate(targetUtc.getUTCDate() + validityDays)

  const yyyy = targetUtc.getUTCFullYear()
  const mm = String(targetUtc.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(targetUtc.getUTCDate()).padStart(2, '0')

  // Fim do dia civil no fuso de Brasília (23:59:59.999-03:00)
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
    expectedVersion,
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

    const isItemExplicitlyPending = item.status === 'pending'
    const isConfirmed = priced ? (priced.status === 'confirmed' && !isItemExplicitlyPending) : false
    const unitPriceCents = priced && isConfirmed ? priced.unitPriceCents : 0
    const subtotalCents = priced && isConfirmed ? priced.subtotalCents : 0
    const unitPrice = unitPriceCents / 100
    const subtotal = subtotalCents / 100

    if (isConfirmed) {
      totalConfirmedCents += subtotalCents
    } else {
      const reason = item.pendingReason || priced?.unavailableReason || 'Produto sem preço configurado para a quantidade solicitada ou fator de embalagem pendente.'
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
      requestedQuantity: item.requestedQuantity ?? item.quantity,
      requestedUnit: item.requestedUnit ?? item.unit ?? prodMeta?.unit ?? 'UN',
      packageFactor: item.packageFactor ?? null,
      internalQuantity: item.internalQuantity ?? item.quantity,
      internalUnit: item.internalUnit ?? item.unit ?? prodMeta?.unit ?? 'UN',
      unitPriceCents,
      unitPrice,
      subtotalCents,
      subtotal,
      priceType: priced?.priceType || 'unknown',
      appliedRule: priced?.appliedRule || 'none',
      priceSourceId: priced?.priceSourceId || '',
      isConfirmed,
      status: isConfirmed ? 'confirmed' : 'pending',
      pendingReason: isConfirmed ? undefined : (item.pendingReason || priced?.unavailableReason)
    })
  }

  const hasPendingItems = pendingReasons.length > 0 || !batchPricing.allConfirmed || quoteItems.some(i => i.status === 'pending' || !i.isConfirmed)
  const totalConfirmed = totalConfirmedCents / 100
  const totalPending = totalPendingCents / 100
  const grandTotalCents = totalConfirmedCents + totalPendingCents
  const grandTotal = grandTotalCents / 100

  // Status determinístico do orçamento: qualquer item pendente força pending_validation
  let status: QuoteStatus = 'ready'
  if (forceStatus) {
    status = forceStatus
  } else if (hasPendingItems) {
    status = 'pending_validation'
  }

  const nowIso = new Date().toISOString()
  const validUntilIso = calculateQuoteValidityDate(validityDays)

  // 4. Prevenção de duplicação e reutilização/versionamento com controle de concorrência otimista
  let targetQuoteId: string | null = null
  let currentVersion = 1
  let changeHistory: QuoteVersionChange[] = []

  if (existingQuoteId) {
    const { data: existingQuote } = await supabase
      .from('quotes')
      .select('id, customer_id, total, status, metadata')
      .eq('id', existingQuoteId)
      .eq('company_id', companyId)
      .in('status', ['draft', 'pending_validation', 'ready'])
      .maybeSingle()

    if (existingQuote) {
      // Gate 1: Validação de autorização no contexto da conversa e do cliente
      const quoteConvId = existingQuote.metadata?.conversation_id
      if (conversationId && quoteConvId && quoteConvId !== conversationId) {
        throw new Error(`Acesso negado: o orçamento ${existingQuoteId} pertence à conversa ${quoteConvId} e não pode ser atualizado pela conversa ${conversationId}.`)
      }
      if (customerId && existingQuote.customer_id && existingQuote.customer_id !== customerId) {
        throw new Error(`Acesso negado: o orçamento ${existingQuoteId} pertence ao cliente ${existingQuote.customer_id} e não pode ser atualizado pelo cliente ${customerId}.`)
      }
      // Orçamentos legados sem conversation_id vinculado
      if (!quoteConvId && conversationId && existingQuote.customer_id && customerId && existingQuote.customer_id !== customerId) {
        throw new Error(`Acesso negado: o orçamento legado ${existingQuoteId} não pertence a este cliente.`)
      }

      if (expectedVersion !== undefined && (existingQuote.metadata?.version || 1) !== expectedVersion) {
        throw new Error(`Conflito de concorrência no orçamento: versão esperada ${expectedVersion}, mas o registro no banco está na versão ${existingQuote.metadata?.version || 1}.`)
      }
      targetQuoteId = existingQuote.id
      currentVersion = (existingQuote.metadata?.version || 1) + 1
      changeHistory = Array.isArray(existingQuote.metadata?.change_history)
        ? [...existingQuote.metadata.change_history]
        : []
    } else {
      throw new Error(`Orçamento não localizado ou status não modificável para ID ${existingQuoteId}.`)
    }
  } else if (conversationId) {
    const { data: existingByConv } = await supabase
      .from('quotes')
      .select('id, customer_id, total, status, metadata')
      .eq('company_id', companyId)
      .in('status', ['draft', 'pending_validation', 'ready'])
      .contains('metadata', { conversation_id: conversationId })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingByConv) {
      if (customerId && existingByConv.customer_id && existingByConv.customer_id !== customerId) {
        throw new Error(`Acesso negado: o orçamento da conversa pertence ao cliente ${existingByConv.customer_id} e não pode ser manipulado por ${customerId}.`)
      }
      if (expectedVersion !== undefined && (existingByConv.metadata?.version || 1) !== expectedVersion) {
        throw new Error(`Conflito de concorrência no orçamento: versão esperada ${expectedVersion}, mas o registro no banco está na versão ${existingByConv.metadata?.version || 1}.`)
      }
      targetQuoteId = existingByConv.id
      currentVersion = (existingByConv.metadata?.version || 1) + 1
      changeHistory = Array.isArray(existingByConv.metadata?.change_history)
        ? [...existingByConv.metadata.change_history]
        : []
    }
  }

  // 5. Persistência no banco (Atômica via RPC ou Fallback Seguro)
  const targetVersionForSave = targetQuoteId ? currentVersion : 1
  changeHistory.push({
    version: targetVersionForSave,
    action: targetQuoteId ? 'recalculated' : 'created',
    changedAt: nowIso,
    summary: actionSummary || (targetQuoteId 
      ? `Atualização para versão ${targetVersionForSave}: ${quoteItems.length} itens recalibrados.`
      : 'Orçamento inicial gerado.')
  })

  const updatedMetadata = {
    conversation_id: conversationId,
    version: targetVersionForSave,
    valid_until: validUntilIso,
    total_confirmed_cents: totalConfirmedCents,
    total_pending_cents: totalPendingCents,
    has_pending_items: hasPendingItems,
    pending_reasons: pendingReasons,
    change_history: changeHistory,
    customer_notes: customerNotes || null
  }

  const itemsPayloadForRpc = quoteItems.map(item => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    subtotal: item.subtotal,
    metadata: {
      sku: item.sku,
      unit: item.unit,
      requested_quantity: item.requestedQuantity,
      requested_unit: item.requestedUnit,
      package_factor: item.packageFactor,
      internal_quantity: item.internalQuantity,
      internal_unit: item.internalUnit,
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

  if (typeof (supabase as any)?.rpc === 'function') {
    try {
      const { data: atomicResult, error: atomicErr } = await (supabase as any).rpc('save_enterprise_quote_atomic', {
        p_company_id: companyId,
        p_customer_id: customerId || null,
        p_conversation_id: conversationId || null,
        p_existing_quote_id: targetQuoteId || null,
        p_expected_version: expectedVersion ?? (targetQuoteId ? (targetVersionForSave - 1) : null),
        p_status: status,
        p_total: totalConfirmed,
        p_metadata: updatedMetadata,
        p_items: itemsPayloadForRpc
      })

      if (!atomicErr && atomicResult?.id) {
        return {
          id: atomicResult.id,
          quoteId: atomicResult.id,
          companyId,
          customerId: customerId || null,
          conversationId: conversationId || null,
          status,
          version: atomicResult.version || targetVersionForSave,
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
          isReused: Boolean(targetQuoteId),
          metadata: updatedMetadata
        }
      }

      if (atomicErr) {
        const errMsg = String(atomicErr.message || '')
        if (errMsg.includes('ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN') || errMsg.includes('pertence à conversa')) {
          throw new Error(`Acesso negado: o orçamento pertence a outra conversa e não pode ser modificado.`)
        }
        if (errMsg.includes('ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN') || errMsg.includes('outro cliente')) {
          throw new Error(`Acesso negado: o orçamento pertence a outro cliente.`)
        }
        if (errMsg.includes('ORCAMENTO_CONCURRENCY_CONFLICT')) {
          throw new Error(`Conflito de concorrência no orçamento: versão esperada ${expectedVersion} difere da versão atual no banco de dados.`)
        }
        const isMissingRoutine = atomicErr.code === '42883' || atomicErr.code === 'PGRST202' || errMsg.includes('could not find the function')
        if (!isMissingRoutine) {
          throw new Error(`Erro na transação atômica do orçamento: ${errMsg}`)
        }
      }
    } catch (rpcErr: any) {
      if (rpcErr.message?.includes('Acesso negado') || rpcErr.message?.includes('Conflito de concorrência') || rpcErr.message?.includes('transação atômica')) {
        throw rpcErr
      }
    }
  }

  // Fallback seguro se RPC não estiver registrada no runtime
  if (targetQuoteId) {
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
        requested_quantity: item.requestedQuantity,
        requested_unit: item.requestedUnit,
        package_factor: item.packageFactor,
        internal_quantity: item.internalQuantity,
        internal_unit: item.internalUnit,
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

  // Novo orçamento no fallback
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      company_id: companyId,
      customer_id: customerId || null,
      status,
      total: totalConfirmed,
      metadata: updatedMetadata
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
      requested_quantity: item.requestedQuantity,
      requested_unit: item.requestedUnit,
      package_factor: item.packageFactor,
      internal_quantity: item.internalQuantity,
      internal_unit: item.internalUnit,
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
    metadata: updatedMetadata
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
  const { companyId, quoteId, customerId, conversationId, allowCrossConversation = false } = params
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

  // Gate 1: Validação de isolamento no nível de conversa e cliente (mesmo tenant)
  const quoteConvId = quote.metadata?.conversation_id
  if (!allowCrossConversation && conversationId) {
    if (quoteConvId && quoteConvId !== conversationId) {
      console.warn(`[getQuote Unauthorized] Tentativa de acesso cruzado: quote ${quoteId} (conv:${quoteConvId}) acessado pela conv:${conversationId}`)
      return null
    }
  }

  if (customerId && quote.customer_id && quote.customer_id !== customerId) {
    console.warn(`[getQuote Unauthorized] Tentativa de acesso cruzado: quote ${quoteId} (cust:${quote.customer_id}) acessado pelo cust:${customerId}`)
    return null
  }

  // Orçamentos legados sem conversation_id: se tiver customer_id e o caller informou customer_id diferente, bloqueia
  if (!allowCrossConversation && conversationId && !quoteConvId && quote.customer_id && customerId && quote.customer_id !== customerId) {
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
      requestedQuantity: it.metadata?.requested_quantity ?? Number(it.quantity),
      requestedUnit: it.metadata?.requested_unit ?? it.products?.unit ?? it.metadata?.unit ?? 'UN',
      packageFactor: it.metadata?.package_factor ?? null,
      internalQuantity: it.metadata?.internal_quantity ?? Number(it.quantity),
      internalUnit: it.metadata?.internal_unit ?? it.products?.unit ?? it.metadata?.unit ?? 'UN',
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
    const pkgDetail = (item.packageFactor && item.packageFactor > 1 && item.requestedUnit && item.requestedUnit !== item.unit)
      ? ` (${item.requestedQuantity} ${item.requestedUnit} c/ ${item.packageFactor} un = ${item.quantity} ${item.unit})`
      : ''

    lines.push(`${index + 1}. *${item.name}*`)
    if (item.status === 'confirmed') {
      lines.push(`   ${statusIcon} Qtd: ${item.quantity} ${item.unit}${pkgDetail}${ruleLabel}`)
      lines.push(`   ${statusIcon} ${formattedUnit} un | Subtotal: *${formattedSub}*`)
    } else {
      const displayQty = item.requestedQuantity ?? item.quantity
      const displayUnit = item.requestedUnit ?? item.unit
      lines.push(`   ${statusIcon} Qtd: ${displayQty} ${displayUnit} — _${item.pendingReason || 'Preço pendente de confirmação'}_`)
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

/**
 * Recupera o orçamento ativo de uma conversa a partir do banco de dados (resiliência a reinício).
 */
export async function getActiveQuoteForConversation(
  companyId: string, 
  conversationId: string
): Promise<EnterpriseQuote | null> {
  const supabase = createAdminClient()
  const { data: quote, error } = await supabase
    .from('quotes')
    .select('id')
    .eq('company_id', companyId)
    .in('status', ['draft', 'pending_validation', 'ready'])
    .contains('metadata', { conversation_id: conversationId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !quote) return null
  return getQuote({ companyId, quoteId: quote.id, conversationId })
}
