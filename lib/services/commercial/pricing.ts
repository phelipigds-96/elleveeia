import { createAdminClient } from '@/lib/supabase/service'

export type PriceStatus = 'confirmed' | 'pending' | 'unavailable'
export type PriceType = 'retail' | 'wholesale' | 'club' | 'promotion' | string

export interface PriceResolutionRequest {
  companyId: string
  productId: string
  quantity: number
  priceType?: string
  isClubEligible?: boolean
  unit?: string
  branchId?: string
  channel?: string
  throwOnError?: boolean
}

export interface PriceResolutionResult {
  productId: string
  companyId: string
  priceTableId?: string | null
  unit: string | null
  requestedQuantity: number
  sellableQuantity: number
  unitPriceCents: number
  unitPrice: number
  subtotalCents: number
  subtotal: number
  priceType: string
  appliedRule: string
  priceSourceId: string
  validFrom: string | null
  validUntil: string | null
  evaluatedAt: string
  status: PriceStatus
  unavailableReason?: string
  requiresHumanValidation?: boolean
  currency: 'BRL'

  // Compatibilidade retroativa com código existente
  quantity: number
  minQuantity: number
  maxQuantity?: number | null
  source: string
}

export interface BatchPriceResolutionItem {
  productId: string
  quantity: number
  priceType?: string
  unit?: string
}

export interface BatchPriceResolutionRequest {
  companyId: string
  items: BatchPriceResolutionItem[]
  isClubEligible?: boolean
  defaultPriceType?: string
  branchId?: string
  channel?: string
}

export interface BatchPriceResolutionResult {
  companyId: string
  items: PriceResolutionResult[]
  totalCents: number
  total: number
  allConfirmed: boolean
  hasUnavailable: boolean
  evaluatedAt: string
}

/**
 * Converte strings de vigência recebidas do banco/ERP respeitando o fuso de Brasília (-03:00).
 * Se a data vier apenas como "YYYY-MM-DD", assume o final do dia (23:59:59.999) para valid_until
 * e o início do dia (00:00:00.000) para valid_from.
 * Retorna 'INVALID' se a data for inválida ou corrompida.
 */
export function parseCommercialValidityDate(val: string | Date | null | undefined, isEndOfDay: boolean): Date | null | 'INVALID' {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return isNaN(val.getTime()) ? 'INVALID' : val
  if (typeof val !== 'string') return 'INVALID'
  
  const trimmed = val.trim()
  if (trimmed === '') return null

  // 1. Formato YYYY-MM-DD (data pura comercial recebida do ERP)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const isoString = isEndOfDay
      ? `${trimmed}T23:59:59.999-03:00`
      : `${trimmed}T00:00:00.000-03:00`
    const parsed = new Date(isoString)
    return isNaN(parsed.getTime()) ? 'INVALID' : parsed
  }

  // 2. Formato YYYY-MM-DD HH:mm:ss ou YYYY-MM-DDTHH:mm:ss sem timezone
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    const isoString = trimmed.replace(' ', 'T') + '-03:00'
    const parsed = new Date(isoString)
    return isNaN(parsed.getTime()) ? 'INVALID' : parsed
  }

  // 3. Timestamp completo ISO 8601 com timezone (ex: ...Z ou ...-03:00)
  const parsed = new Date(trimmed)
  return isNaN(parsed.getTime()) ? 'INVALID' : parsed
}

/**
 * Avalia de forma pura e determinística as regras de preço de um item comercial
 */
export function evaluateItemPricing(
  params: {
    companyId: string
    productId: string
    quantity: number
    priceType?: string
    isClubEligible?: boolean
    unit?: string
    branchId?: string
    channel?: string
  },
  rawPrices: any[],
  productInfo?: { unit?: string | null; name?: string; package_description?: string | null; metadata?: any } | null
): PriceResolutionResult {
  const { companyId, productId, quantity, priceType, isClubEligible = false, branchId, channel } = params
  const evaluatedAt = new Date().toISOString()
  const effectiveUnit = params.unit || productInfo?.unit || 'UN'

  // Helper para construir resposta de indisponibilidade
  function buildUnavailableResult(reason: string, requiresHumanValidation: boolean = false): PriceResolutionResult {
    return {
      productId,
      companyId,
      priceTableId: null,
      unit: effectiveUnit,
      requestedQuantity: quantity,
      sellableQuantity: quantity,
      unitPriceCents: 0,
      unitPrice: 0,
      subtotalCents: 0,
      subtotal: 0,
      priceType: priceType || 'unknown',
      appliedRule: 'none',
      priceSourceId: '',
      validFrom: null,
      validUntil: null,
      evaluatedAt,
      status: 'unavailable',
      unavailableReason: reason,
      requiresHumanValidation,
      currency: 'BRL',
      quantity,
      minQuantity: 1,
      maxQuantity: null,
      source: 'product_prices'
    }
  }

  // 1. Validação da quantidade solicitada
  if (typeof quantity !== 'number' || isNaN(quantity) || quantity <= 0) {
    return buildUnavailableResult('Quantidade inválida. Informe um valor numérico maior que zero.')
  }

  // 2. Validação de Unidades Discretas vs Fracionadas
  const DISCRETE_UNITS = ['UN', 'CX', 'FD', 'LT', 'PC', 'DZ']
  const isDiscreteUnit = DISCRETE_UNITS.includes(effectiveUnit.toUpperCase())
  if (isDiscreteUnit && !Number.isInteger(quantity)) {
    return buildUnavailableResult(
      `Quantidade fracionada (${quantity}) não permitida para a unidade ${effectiveUnit.toUpperCase()}. Informe um número inteiro.`
    )
  }

  // 3. Validação de Fator de Embalagem e Múltiplos de Venda
  const multipleOf = productInfo?.metadata?.multiple_of || productInfo?.metadata?.package_factor
  if (multipleOf && typeof multipleOf === 'number' && multipleOf > 1) {
    if (quantity % multipleOf !== 0) {
      return buildUnavailableResult(
        `A quantidade solicitada (${quantity}) deve ser múltipla de ${multipleOf} unidades para este produto (embalagem fechada).`,
        true
      )
    }
  }

  // 4. Isolamento estrito por tenant
  const tenantPrices = rawPrices.filter(p => p.company_id === companyId)
  if (tenantPrices.length === 0) {
    return buildUnavailableResult('Produto não possui preço configurado ou está indisponível para esta empresa.')
  }

  // 5. Filtro de Vigência e Horário Comercial (Fuso de Brasília -03:00)
  const now = new Date()
  let hasExpired = false
  let hasFuture = false

  const activePrices = tenantPrices.filter(p => {
    if (p.active === false) return false

    const vFrom = parseCommercialValidityDate(p.valid_from, false)
    if (vFrom === 'INVALID') return false
    if (vFrom && vFrom > now) {
      hasFuture = true
      return false
    }

    const vUntil = parseCommercialValidityDate(p.valid_until, true)
    if (vUntil === 'INVALID') return false
    if (vUntil && vUntil < now) {
      hasExpired = true
      return false
    }

    if (vFrom && vUntil && vFrom > vUntil) return false

    // Filtros de filial ou canal comercial se configurados
    if (branchId && p.metadata?.branch_id && p.metadata.branch_id !== branchId) {
      return false
    }
    if (channel && p.metadata?.channel && p.metadata.channel !== channel) {
      return false
    }

    return true
  })

  if (activePrices.length === 0) {
    if (hasExpired && !hasFuture) {
      return buildUnavailableResult('Preço do produto expirado ou fora do período de vigência comercial.')
    }
    if (hasFuture && !hasExpired) {
      return buildUnavailableResult('Preço comercial ainda não vigente.')
    }
    return buildUnavailableResult('Produto não possui preço ativo ou vigente.')
  }

  // Helper para construir resultado confirmado em centavos inteiros
  function buildResult(rule: any): PriceResolutionResult {
    const rawPrice = Number(rule.price)
    const unitPriceCents = Math.round(rawPrice * 100)
    const subtotalCents = Math.round(unitPriceCents * quantity)

    // Proteção contra overflow numérico financeiro
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents > Number.MAX_SAFE_INTEGER) {
      return buildUnavailableResult('Valor financeiro calculado excede a precisão segura do sistema comercial.')
    }

    const unitPrice = unitPriceCents / 100
    const subtotal = subtotalCents / 100

    return {
      productId,
      companyId,
      priceTableId: rule.metadata?.price_table_id || rule.metadata?.table_code || null,
      unit: effectiveUnit,
      requestedQuantity: quantity,
      sellableQuantity: quantity,
      unitPriceCents,
      unitPrice,
      subtotalCents,
      subtotal,
      priceType: rule.price_type,
      appliedRule: `${rule.price_type} (min: ${rule.min_quantity != null ? Number(rule.min_quantity) : 1}${rule.max_quantity != null ? `, max: ${Number(rule.max_quantity)}` : ''})`,
      priceSourceId: rule.id,
      validFrom: rule.valid_from ? new Date(rule.valid_from).toISOString() : null,
      validUntil: rule.valid_until ? new Date(rule.valid_until).toISOString() : null,
      evaluatedAt,
      status: 'confirmed',
      requiresHumanValidation: false,
      currency: 'BRL',
      quantity,
      minQuantity: rule.min_quantity != null ? Number(rule.min_quantity) : 1,
      maxQuantity: rule.max_quantity != null ? Number(rule.max_quantity) : null,
      source: 'product_prices'
    }
  }

  // Helper para seleção da melhor regra dentro de uma modalidade
  function selectBestRuleInModality(rules: any[], modalityLabel: string): { selectedRule: any | null; error?: string } {
    const eligible = rules.filter(p => {
      const minQ = p.min_quantity != null ? Number(p.min_quantity) : 1
      const maxQ = p.max_quantity != null ? Number(p.max_quantity) : null
      return quantity >= minQ && (maxQ === null || quantity <= maxQ)
    })

    if (eligible.length === 0) return { selectedRule: null }

    // Detecção de ambiguidade e conflito de faixas sobrepostas
    if (eligible.length > 1) {
      const distinctPrices = new Set(eligible.map(p => Number(p.price)))
      if (distinctPrices.size > 1) {
        const hasExplicitOverlap = eligible.some(a => {
          const maxA = a.max_quantity != null ? Number(a.max_quantity) : null
          const minA = a.min_quantity != null ? Number(a.min_quantity) : 1
          return eligible.some(b => {
            const minB = b.min_quantity != null ? Number(b.min_quantity) : 1
            return minA < minB && maxA !== null && minB <= maxA
          })
        })

        const hasSameMin = eligible.some(a => 
          eligible.some(b => a !== b && (a.min_quantity || 1) === (b.min_quantity || 1))
        )

        if (hasExplicitOverlap || hasSameMin) {
          return {
            selectedRule: null,
            error: `Ambiguidade na precificação: foram encontradas múltiplas regras ativas ou faixas sobrepostas de ${modalityLabel} com valores divergentes para a quantidade informada (${quantity} unidades).`
          }
        }
      }
    }

    // Priorizar a faixa de maior volume (maior min_quantity)
    const maxMin = Math.max(...eligible.map(p => (p.min_quantity != null ? Number(p.min_quantity) : 1)))
    const topCandidates = eligible.filter(p => (p.min_quantity != null ? Number(p.min_quantity) : 1) === maxMin)

    if (topCandidates.length > 1) {
      const distinctPrices = new Set(topCandidates.map(p => Number(p.price)))
      if (distinctPrices.size > 1) {
        return {
          selectedRule: null,
          error: `Ambiguidade na precificação: foram encontradas múltiplas regras ativas de ${modalityLabel} com valores divergentes para a mesma faixa de quantidade.`
        }
      }

      // Desempate determinístico quando preços e faixas são idênticos:
      // Escolhe a regra atualizada mais recentemente ou com valid_from mais recente
      topCandidates.sort((a, b) => {
        const timeA = new Date(a.updated_at || a.created_at || 0).getTime()
        const timeB = new Date(b.updated_at || b.created_at || 0).getTime()
        if (timeB !== timeA) return timeB - timeA
        return String(a.id).localeCompare(String(b.id))
      })
    }

    return { selectedRule: topCandidates[0] }
  }

  // CASO 1: Modalidade explícita solicitada
  if (priceType) {
    if (priceType === 'club' && !isClubEligible) {
      return buildUnavailableResult(
        'Preço da modalidade "club" não disponível: requer comprovação de elegibilidade de membro do Clube Sumel.'
      )
    }

    const modalityPrices = activePrices.filter(p => p.price_type === priceType)
    if (modalityPrices.length === 0) {
      return buildUnavailableResult(`Produto não possui o tipo de preço solicitado (${priceType}).`)
    }

    const selection = selectBestRuleInModality(modalityPrices, priceType)
    if (selection.error) {
      return buildUnavailableResult(selection.error, true)
    }

    if (!selection.selectedRule) {
      if (priceType === 'wholesale') {
        const minWholesale = Math.min(
          ...modalityPrices.map(p => (p.min_quantity != null ? Number(p.min_quantity) : 1))
        )
        if (quantity < minWholesale) {
          return buildUnavailableResult(
            `A quantidade solicitada (${quantity}) não atinge o lote mínimo necessário para compra no atacado (mínimo: ${minWholesale} unidades).`
          )
        }
      }
      if (priceType === 'retail') {
        const maxRetail = Math.max(
          ...modalityPrices.map(p => (p.max_quantity != null ? Number(p.max_quantity) : Infinity))
        )
        if (quantity > maxRetail) {
          return buildUnavailableResult(
            `A quantidade solicitada (${quantity}) excede o limite máximo configurado para varejo (máximo: ${maxRetail} unidades).`
          )
        }
      }
      return buildUnavailableResult(
        `A quantidade solicitada (${quantity}) não atende aos requisitos de quantidade para o preço ${priceType}.`
      )
    }

    return buildResult(selection.selectedRule)
  }

  // CASO 2: Resolução comercial automática (Precedência Oficial: Promoção > Clube > Atacado > Varejo)
  
  // Regra 1: Promoção Ativa e Vigente tem precedência máxima se quantidade for elegível
  const promoPrices = activePrices.filter(p => p.price_type === 'promotion' || p.metadata?.is_promotion === true)
  if (promoPrices.length > 0) {
    const promoSelection = selectBestRuleInModality(promoPrices, 'promoção (promotion)')
    if (promoSelection.error) {
      return buildUnavailableResult(promoSelection.error, true)
    }
    if (promoSelection.selectedRule) {
      return buildResult(promoSelection.selectedRule)
    }
  }

  // Regra 2: Clube Sumel Apenas se o cliente tiver elegibilidade comprovada
  if (isClubEligible) {
    const clubPrices = activePrices.filter(p => p.price_type === 'club')
    if (clubPrices.length > 0) {
      const clubSelection = selectBestRuleInModality(clubPrices, 'clube (club)')
      if (clubSelection.error) {
        return buildUnavailableResult(clubSelection.error, true)
      }
      if (clubSelection.selectedRule) {
        return buildResult(clubSelection.selectedRule)
      }
    }
  }

  // Regra 3: Para clientes não-clube ou sem promoção, excluir 'club' da resolução automática
  const nonClubPrices = activePrices.filter(p => p.price_type !== 'club' && p.price_type !== 'promotion')

  if (nonClubPrices.length === 0) {
    return buildUnavailableResult('Produto não possui preço aplicável para clientes não associados ao Clube Sumel.')
  }

  // Regra 4: Para quantidades que atinjam uma faixa de atacado elegível, aplicar wholesale
  const wholesalePrices = nonClubPrices.filter(p => p.price_type === 'wholesale')
  if (wholesalePrices.length > 0) {
    const wholesaleSelection = selectBestRuleInModality(wholesalePrices, 'atacado (wholesale)')
    if (wholesaleSelection.error) {
      return buildUnavailableResult(wholesaleSelection.error, true)
    }
    if (wholesaleSelection.selectedRule) {
      return buildResult(wholesaleSelection.selectedRule)
    }
  }

  // Regra 5: Quando não houver atacado elegível, aplicar varejo
  const retailPrices = nonClubPrices.filter(p => p.price_type === 'retail')
  if (retailPrices.length > 0) {
    const retailSelection = selectBestRuleInModality(retailPrices, 'varejo (retail)')
    if (retailSelection.error) {
      return buildUnavailableResult(retailSelection.error, true)
    }
    if (retailSelection.selectedRule) {
      return buildResult(retailSelection.selectedRule)
    }
  }

  // Regra 6: Se não houver varejo nem atacado elegível para a quantidade, rejeitar claramente
  if (wholesalePrices.length > 0) {
    const minWholesale = Math.min(
      ...wholesalePrices.map(p => (p.min_quantity != null ? Number(p.min_quantity) : 1))
    )
    if (quantity < minWholesale) {
      return buildUnavailableResult(
        `A quantidade solicitada (${quantity}) não atinge o lote mínimo necessário para compra no atacado (mínimo: ${minWholesale} unidades).`
      )
    }
  }

  if (retailPrices.length > 0) {
    const maxRetail = Math.max(
      ...retailPrices.map(p => (p.max_quantity != null ? Number(p.max_quantity) : Infinity))
    )
    if (quantity > maxRetail) {
      return buildUnavailableResult(
        `A quantidade solicitada (${quantity}) excede o limite máximo configurado para varejo (máximo: ${maxRetail} unidades).`
      )
    }
  }

  return buildUnavailableResult(
    `A quantidade solicitada (${quantity}) não atende aos requisitos de quantidade para os preços disponíveis.`
  )
}

/**
 * Determina o preço aplicável de um produto para a quantidade desejada de forma determinística e segura
 */
export async function resolveProductPrice(params: PriceResolutionRequest): Promise<PriceResolutionResult> {
  const { companyId, productId, quantity, throwOnError = true } = params

  if (!companyId) {
    throw new Error('companyId é obrigatório para precificação comercial.')
  }

  if (!quantity || quantity <= 0) {
    if (throwOnError) {
      throw new Error('Quantidade inválida. Informe um número maior que zero.')
    }
  }

  const supabase = createAdminClient()

  // 1. Busca todos os preços ativos do produto nesta empresa
  const { data: rawPrices, error: pricesError } = await supabase
    .from('product_prices')
    .select('*')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .eq('active', true)

  if (pricesError) {
    throw new Error(`Erro ao buscar preços: ${pricesError.message}`)
  }

  // 2. Busca informações do produto (unidade, múltiplos, embalagem)
  const { data: rawProduct } = await supabase
    .from('products')
    .select('id, name, unit, package_description, metadata')
    .eq('company_id', companyId)
    .eq('id', productId)
    .maybeSingle()

  const evaluated = evaluateItemPricing(params, rawPrices || [], rawProduct)

  if (evaluated.status !== 'confirmed' && throwOnError) {
    throw new Error(evaluated.unavailableReason || 'Preço indisponível.')
  }

  return evaluated
}

/**
 * Consulta de Preços em Lote (Zero N+1 Queries) com Isolamento Multi-Tenant Estrito
 */
export async function resolveBatchProductPrices(
  request: BatchPriceResolutionRequest
): Promise<BatchPriceResolutionResult> {
  const { companyId, items, isClubEligible = false, defaultPriceType, branchId, channel } = request
  const evaluatedAt = new Date().toISOString()

  if (!companyId || typeof companyId !== 'string') {
    throw new Error('companyId é obrigatório para resolução de preços em lote.')
  }

  if (!items || items.length === 0) {
    return {
      companyId,
      items: [],
      totalCents: 0,
      total: 0,
      allConfirmed: true,
      hasUnavailable: false,
      evaluatedAt
    }
  }

  const uniqueProductIds = Array.from(new Set(items.map(i => i.productId).filter(Boolean)))

  if (uniqueProductIds.length === 0) {
    return {
      companyId,
      items: [],
      totalCents: 0,
      total: 0,
      allConfirmed: true,
      hasUnavailable: false,
      evaluatedAt
    }
  }

  const supabase = createAdminClient()

  // 1. Executa busca em lote única na tabela product_prices (ZERO N+1)
  const { data: rawPrices, error: pricesError } = await supabase
    .from('product_prices')
    .select('*')
    .eq('company_id', companyId)
    .in('product_id', uniqueProductIds)
    .eq('active', true)

  if (pricesError) {
    throw new Error(`Erro ao buscar preços em lote: ${pricesError.message}`)
  }

  // 2. Executa busca em lote única na tabela products (ZERO N+1)
  const { data: rawProducts, error: productsError } = await supabase
    .from('products')
    .select('id, name, unit, package_description, metadata')
    .eq('company_id', companyId)
    .in('id', uniqueProductIds)

  if (productsError) {
    throw new Error(`Erro ao buscar dados dos produtos em lote: ${productsError.message}`)
  }

  // Mapeia preços e produtos em memória por product_id
  const pricesByProduct = new Map<string, any[]>()
  for (const price of (rawPrices || [])) {
    const list = pricesByProduct.get(price.product_id) || []
    list.push(price)
    pricesByProduct.set(price.product_id, list)
  }

  const productInfoMap = new Map<string, any>()
  for (const prod of (rawProducts || [])) {
    productInfoMap.set(prod.id, prod)
  }

  // 3. Avalia cada item da lista individualmente e deterministicamente
  const resolvedItems: PriceResolutionResult[] = []
  let totalCents = 0

  for (const item of items) {
    const productPrices = pricesByProduct.get(item.productId) || []
    const prodInfo = productInfoMap.get(item.productId) || null

    const evaluated = evaluateItemPricing(
      {
        companyId,
        productId: item.productId,
        quantity: item.quantity,
        priceType: item.priceType || defaultPriceType,
        isClubEligible,
        unit: item.unit,
        branchId,
        channel
      },
      productPrices,
      prodInfo
    )

    resolvedItems.push(evaluated)

    if (evaluated.status === 'confirmed') {
      totalCents += evaluated.subtotalCents
    }
  }

  const allConfirmed = resolvedItems.length > 0 && resolvedItems.every(i => i.status === 'confirmed')
  const hasUnavailable = resolvedItems.some(i => i.status === 'unavailable')
  const total = totalCents / 100

  return {
    companyId,
    items: resolvedItems,
    totalCents,
    total,
    allConfirmed,
    hasUnavailable,
    evaluatedAt
  }
}

/**
 * Validador de Invalidação de Cache de Preço Comercial
 * Retorna true se a cotação em memória ainda for estritamente válida para os parâmetros atuais
 */
export function isPriceQuoteValid(
  cachedPrice: PriceResolutionResult,
  currentParams: {
    companyId: string
    productId: string
    quantity: number
    priceType?: string
    isClubEligible?: boolean
    unit?: string
  }
): boolean {
  if (!cachedPrice || cachedPrice.status !== 'confirmed') return false
  if (cachedPrice.companyId !== currentParams.companyId) return false
  if (cachedPrice.productId !== currentParams.productId) return false
  if (cachedPrice.quantity !== currentParams.quantity) return false
  if (currentParams.priceType && cachedPrice.priceType !== currentParams.priceType) return false
  if (currentParams.unit && cachedPrice.unit !== currentParams.unit) return false
  
  // Se o cliente perdeu elegibilidade ao clube e o preço era clube
  if (cachedPrice.priceType === 'club' && !currentParams.isClubEligible) return false

  // Se a vigência expirou
  if (cachedPrice.validUntil) {
    const until = new Date(cachedPrice.validUntil)
    if (new Date() > until) return false
  }

  return true
}
