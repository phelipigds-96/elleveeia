export interface CartItem {
  productId: string
  sku?: string | null
  name: string
  quantity: number
  unit?: string
  requestedQuantity?: number
  requestedUnit?: string
  packageFactor?: number | null
  internalQuantity?: number
  internalUnit?: string
  unitPriceCents?: number
  unitPrice?: number
  subtotalCents?: number
  subtotal?: number
  priceType?: string
  appliedRule?: string
  priceSourceId?: string
  lastPricingQueryId?: string
  isPriceConfirmed: boolean
  status?: 'confirmed' | 'pending' | 'unavailable' | 'ambiguous'
  pendingReason?: string
  differentiatingQuestion?: string
}

export interface DiscoveredProduct {
  id: string
  name: string
  unitPrice?: number
  subtotal?: number
  brand?: string | null
}

export interface WorkingMemory {
  activeProduct?: {
    id: string
    name: string
  }
  activePrice?: {
    unitPrice: number
    priceType?: string
  }
  activeQuantity?: number
  activeCart?: CartItem[]
  activeQuote?: {
    id: string
    total: number
    status: string
    version?: number
  }
  discoveredProducts?: DiscoveredProduct[]
  version?: number
  processedMessageIds?: string[]
  lastEventId?: string
  updatedAt?: string
  expiredAt?: string
}

export interface AddCartItemParams {
  productId: string
  sku?: string | null
  name: string
  quantity: number
  unit?: string
  requestedQuantity?: number
  requestedUnit?: string
  packageFactor?: number | null
  internalQuantity?: number
  internalUnit?: string
  unitPriceCents?: number
  unitPrice?: number
  subtotalCents?: number
  subtotal?: number
  priceType?: string
  appliedRule?: string
  priceSourceId?: string
  lastPricingQueryId?: string
  isPriceConfirmed?: boolean
  status?: 'confirmed' | 'pending' | 'unavailable' | 'ambiguous'
  pendingReason?: string
  differentiatingQuestion?: string
}

export interface CartCalculationResult {
  total: number
  totalConfirmedCents: number
  totalPendingCents: number
  itemCount: number
  allPricesConfirmed: boolean
  hasPendingItems: boolean
  unconfirmedProductIds: string[]
}

/**
 * Adiciona um item ao carrinho ou atualiza um item existente.
 * Regras:
 * - Adicionar um segundo produto não apaga o primeiro.
 * - Adicionar o mesmo produto atualiza sua quantidade sem duplicar.
 * - Se a quantidade mudar sem novo preço confirmado, invalida o preço definitivo.
 * - Valores não validados não são aceitos como preço confirmado.
 * - Conduz cálculos em centavos inteiros determinísticos.
 */
export function addItemToCart(
  memory: WorkingMemory | null | undefined,
  item: AddCartItemParams
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  const currentCart: CartItem[] = next.activeCart ? [...next.activeCart] : []

  if (!item.productId || typeof item.productId !== 'string' || item.productId.trim() === '') {
    throw new Error('productId inválido para adicionar ao carrinho.')
  }
  if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
    throw new Error('Nome do produto inválido para adicionar ao carrinho.')
  }
  if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
    throw new Error(`Quantidade inválida (${item.quantity}). Deve ser um número inteiro positivo.`)
  }

  const pId = item.productId.trim()
  const pName = item.name.trim()

  const hasValidPrice = typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice > 0
  const isConfirmed = hasValidPrice && item.isPriceConfirmed !== false

  const unitPriceCents = item.unitPriceCents ?? (hasValidPrice ? Math.round(item.unitPrice! * 100) : 0)
  const subtotalCents = unitPriceCents > 0 ? unitPriceCents * item.quantity : undefined
  const subtotal = subtotalCents != null ? subtotalCents / 100 : (typeof item.subtotal === 'number' ? item.subtotal : undefined)

  const existingIndex = currentCart.findIndex(i => i.productId === pId)

  if (existingIndex >= 0) {
    const existing = currentCart[existingIndex]
    const quantityChanged = existing.quantity !== item.quantity

    const updatedItem: CartItem = {
      ...existing,
      sku: item.sku ?? existing.sku,
      name: pName,
      quantity: item.quantity,
      unit: item.unit ?? existing.unit ?? 'UN',
      requestedQuantity: item.requestedQuantity ?? existing.requestedQuantity,
      requestedUnit: item.requestedUnit ?? existing.requestedUnit,
      packageFactor: item.packageFactor !== undefined ? item.packageFactor : existing.packageFactor,
      internalQuantity: item.internalQuantity ?? existing.internalQuantity,
      internalUnit: item.internalUnit ?? existing.internalUnit,
      priceType: item.priceType ?? existing.priceType,
      appliedRule: item.appliedRule ?? existing.appliedRule,
      priceSourceId: item.priceSourceId ?? existing.priceSourceId,
      lastPricingQueryId: item.lastPricingQueryId ?? existing.lastPricingQueryId,
      status: item.status ?? (isConfirmed ? 'confirmed' : existing.status),
      pendingReason: item.pendingReason ?? existing.pendingReason,
      differentiatingQuestion: item.differentiatingQuestion ?? existing.differentiatingQuestion
    }

    if (hasValidPrice && item.isPriceConfirmed) {
      updatedItem.unitPriceCents = unitPriceCents
      updatedItem.unitPrice = item.unitPrice
      updatedItem.subtotalCents = subtotalCents
      updatedItem.subtotal = subtotal
      updatedItem.isPriceConfirmed = true
      updatedItem.status = 'confirmed'
    } else if (quantityChanged) {
      // Invalidação determinística de preço: mudança de quantidade sem nova precificação
      updatedItem.isPriceConfirmed = false
      updatedItem.status = 'pending'
      delete updatedItem.subtotal
      delete updatedItem.subtotalCents
    }

    currentCart[existingIndex] = updatedItem
  } else {
    const newItem: CartItem = {
      productId: pId,
      sku: item.sku || null,
      name: pName,
      quantity: item.quantity,
      unit: item.unit || 'UN',
      requestedQuantity: item.requestedQuantity ?? item.quantity,
      requestedUnit: item.requestedUnit ?? item.unit ?? 'UN',
      packageFactor: item.packageFactor ?? null,
      internalQuantity: item.internalQuantity ?? item.quantity,
      internalUnit: item.internalUnit ?? item.unit ?? 'UN',
      priceType: item.priceType,
      appliedRule: item.appliedRule,
      priceSourceId: item.priceSourceId,
      lastPricingQueryId: item.lastPricingQueryId,
      isPriceConfirmed: isConfirmed,
      status: item.status || (isConfirmed ? 'confirmed' : 'pending'),
      pendingReason: item.pendingReason,
      differentiatingQuestion: item.differentiatingQuestion
    }

    if (isConfirmed && hasValidPrice) {
      newItem.unitPriceCents = unitPriceCents
      newItem.unitPrice = item.unitPrice
      newItem.subtotalCents = subtotalCents
      newItem.subtotal = subtotal
    }

    currentCart.push(newItem)
  }

  next.activeCart = currentCart
  next.version = (next.version || 0) + 1
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Adiciona múltiplos itens ao carrinho em lote de forma atômica
 */
export function addMultipleItemsToCart(
  memory: WorkingMemory | null | undefined,
  items: AddCartItemParams[]
): WorkingMemory {
  let current = memory
  for (const item of items) {
    current = addItemToCart(current, item)
  }
  return current || {}
}

/**
 * Substitui um item existente no carrinho por outro produto (ex: troca de marca ou apresentação)
 */
export function replaceCartItem(
  memory: WorkingMemory | null | undefined,
  oldProductId: string,
  newItem: AddCartItemParams
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  if (!next.activeCart || next.activeCart.length === 0) {
    return addItemToCart(next, newItem)
  }

  const cleanOldId = oldProductId.trim()
  const index = next.activeCart.findIndex(i => i.productId === cleanOldId)
  if (index === -1) {
    return addItemToCart(next, newItem)
  }

  const updatedCart = [...next.activeCart]
  
  const hasValidPrice = typeof newItem.unitPrice === 'number' && Number.isFinite(newItem.unitPrice) && newItem.unitPrice > 0
  const isConfirmed = hasValidPrice && newItem.isPriceConfirmed !== false
  const unitPriceCents = newItem.unitPriceCents ?? (hasValidPrice ? Math.round(newItem.unitPrice! * 100) : 0)
  const subtotalCents = unitPriceCents > 0 ? unitPriceCents * newItem.quantity : undefined
  const subtotal = subtotalCents != null ? subtotalCents / 100 : (typeof newItem.subtotal === 'number' ? newItem.subtotal : undefined)

  updatedCart[index] = {
    productId: newItem.productId.trim(),
    sku: newItem.sku || null,
    name: newItem.name.trim(),
    quantity: newItem.quantity,
    unit: newItem.unit || 'UN',
    unitPriceCents: unitPriceCents > 0 ? unitPriceCents : undefined,
    unitPrice: hasValidPrice ? newItem.unitPrice : undefined,
    subtotalCents,
    subtotal,
    priceType: newItem.priceType,
    appliedRule: newItem.appliedRule,
    priceSourceId: newItem.priceSourceId,
    lastPricingQueryId: newItem.lastPricingQueryId,
    isPriceConfirmed: isConfirmed,
    status: newItem.status || (isConfirmed ? 'confirmed' : 'pending'),
    pendingReason: newItem.pendingReason,
    differentiatingQuestion: newItem.differentiatingQuestion
  }

  next.activeCart = updatedCart
  next.activeProduct = { id: newItem.productId.trim(), name: newItem.name.trim() }
  next.version = (next.version || 0) + 1
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Resolve referências a itens do carrinho (ex: "o segundo", "aquele branco", "o de 1kg", "o da tirol")
 */
export function resolveCartItemReference(
  referenceText: string,
  memory: WorkingMemory | null | undefined
): { item: CartItem | null; index: number; resolvedReason?: string } {
  if (!memory?.activeCart || memory.activeCart.length === 0) {
    return { item: null, index: -1 }
  }

  const norm = referenceText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  const cart = memory.activeCart

  // 1. Ordinais ("primeiro", "segundo", "terceiro", "ultimo", "1", "2")
  const ordinalMap: Array<{ regex: RegExp; index: number }> = [
    { regex: /\b(?:o\s+)?(?:primeir[oa]|1[oºaª]|opcao\s+1|item\s+1|o\s+1)\b/i, index: 0 },
    { regex: /\b(?:o\s+)?(?:segund[oa]|2[oºaª]|opcao\s+2|item\s+2|o\s+2)\b/i, index: 1 },
    { regex: /\b(?:o\s+)?(?:terceir[oa]|3[oºaª]|opcao\s+3|item\s+3|o\s+3)\b/i, index: 2 },
    { regex: /\b(?:o\s+)?(?:quart[oa]|4[oºaª]|opcao\s+4|item\s+4|o\s+4)\b/i, index: 3 },
    { regex: /\b(?:o\s+)?(?:quint[oa]|5[oºaª]|opcao\s+5|item\s+5|o\s+5)\b/i, index: 4 },
    { regex: /\b(?:o\s+)?(?:ultim[oa]|ultimo\s+item)\b/i, index: -1 }
  ]

  for (const { regex, index } of ordinalMap) {
    if (regex.test(norm)) {
      const targetIdx = index === -1 ? cart.length - 1 : index
      if (targetIdx >= 0 && targetIdx < cart.length) {
        return { item: cart[targetIdx], index: targetIdx, resolvedReason: `Ordinal (${index === -1 ? 'último' : `${targetIdx + 1}º`})` }
      }
    }
  }

  // 2. Peso / Gramagem ("o de 1kg", "o de 400g", "o de 395g")
  const weightMatch = norm.match(/\b(\d+(?:[.,]\d+)?)\s*(?:kg|k|g|ml|l)\b/i)
  if (weightMatch) {
    const rawWeight = weightMatch[0].replace(/\s+/g, '')
    const foundIdx = cart.findIndex(i => {
      const iname = i.name.toLowerCase().replace(/\s+/g, '')
      return iname.includes(rawWeight)
    })
    if (foundIdx >= 0) {
      return { item: cart[foundIdx], index: foundIdx, resolvedReason: `Gramagem (${weightMatch[0]})` }
    }
  }

  // 3. Sabor / Cor / Tipo ("aquele branco", "o meio amargo", "ao leite", "fracionada", "em po")
  const flavorTokens = ['branco', 'meio amargo', 'amargo', 'ao leite', 'blend', 'fracionad', 'nobre', 'po', 'barra', 'gotas']
  for (const ft of flavorTokens) {
    if (norm.includes(ft)) {
      const foundIdx = cart.findIndex(i => i.name.toLowerCase().includes(ft))
      if (foundIdx >= 0) {
        return { item: cart[foundIdx], index: foundIdx, resolvedReason: `Variante/Sabor (${ft})` }
      }
    }
  }

  // 4. Marca ("tirol", "italac", "sicao", "nestle", "harald")
  const brandTokens = ['tirol', 'italac', 'sicao', 'nestle', 'moca', 'harald', 'melken', 'cargill', 'arcolor']
  for (const bt of brandTokens) {
    if (norm.includes(bt)) {
      const foundIdx = cart.findIndex(i => i.name.toLowerCase().includes(bt))
      if (foundIdx >= 0) {
        return { item: cart[foundIdx], index: foundIdx, resolvedReason: `Marca (${bt})` }
      }
    }
  }

  // 5. Fallback para carrinho com item único
  if (cart.length === 1) {
    return { item: cart[0], index: 0, resolvedReason: 'Item único no carrinho' }
  }

  return { item: null, index: -1 }
}

/**
 * Idempotência: verifica se um evento/mensagem de entrada já foi processado
 */
export function isEventAlreadyProcessed(
  memory: WorkingMemory | null | undefined,
  eventId: string | null | undefined
): boolean {
  if (!eventId || typeof eventId !== 'string' || eventId.trim() === '') return false
  const cleanId = eventId.trim()
  if (memory?.lastEventId === cleanId) return true
  if (Array.isArray(memory?.processedMessageIds) && memory.processedMessageIds.includes(cleanId)) {
    return true
  }
  return false
}

/**
 * Idempotência: registra um evento/mensagem de entrada como processado
 */
export function recordProcessedEvent(
  memory: WorkingMemory | null | undefined,
  eventId: string
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  if (!eventId || typeof eventId !== 'string' || eventId.trim() === '') return next
  const cleanId = eventId.trim()
  const existingList = Array.isArray(next.processedMessageIds) ? [...next.processedMessageIds] : []
  if (!existingList.includes(cleanId)) {
    existingList.push(cleanId)
    if (existingList.length > 50) {
      existingList.splice(0, existingList.length - 50)
    }
  }
  next.processedMessageIds = existingList
  next.lastEventId = cleanId
  return next
}

/**
 * Concorrência: mescla deterministicamente duas atualizações simultâneas da mesma conversa
 * sem perda de nenhum item do carrinho
 */
export function mergeConcurrentWorkingMemories(
  base: WorkingMemory | null | undefined,
  updateA: WorkingMemory,
  updateB: WorkingMemory
): WorkingMemory {
  const merged: WorkingMemory = { ...(base || {}) }
  const cartMap = new Map<string, CartItem>()

  for (const item of (base?.activeCart || [])) {
    cartMap.set(item.productId, { ...item })
  }
  for (const item of (updateA.activeCart || [])) {
    cartMap.set(item.productId, { ...item })
  }
  for (const item of (updateB.activeCart || [])) {
    const existing = cartMap.get(item.productId)
    if (existing) {
      cartMap.set(item.productId, { ...existing, ...item })
    } else {
      cartMap.set(item.productId, { ...item })
    }
  }

  merged.activeCart = Array.from(cartMap.values())
  merged.version = Math.max(base?.version || 0, updateA.version || 0, updateB.version || 0) + 1
  merged.updatedAt = new Date().toISOString()

  const allEvents = new Set([
    ...(base?.processedMessageIds || []),
    ...(updateA.processedMessageIds || []),
    ...(updateB.processedMessageIds || [])
  ])
  merged.processedMessageIds = Array.from(allEvents).slice(-50)
  merged.lastEventId = updateB.lastEventId || updateA.lastEventId || base?.lastEventId
  merged.activeProduct = updateB.activeProduct || updateA.activeProduct || base?.activeProduct
  merged.activeQuote = updateB.activeQuote || updateA.activeQuote || base?.activeQuote

  return merged
}

/**
 * Invalidação: desmarca preços confirmados quando condições comerciais mudarem
 */
export function invalidateCartPricesOnConditionChange(
  memory: WorkingMemory | null | undefined,
  reason: string
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  if (!next.activeCart || next.activeCart.length === 0) return next

  const updatedCart: CartItem[] = next.activeCart.map(item => ({
    ...item,
    isPriceConfirmed: false,
    status: 'pending',
    pendingReason: reason
  }))

  next.activeCart = updatedCart
  next.version = (next.version || 0) + 1
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Atualiza a quantidade de um item no carrinho.
 * Invalida o preço definitivo anterior (isPriceConfirmed = false) para exigir nova precificação.
 */
export function updateCartItemQuantity(
  memory: WorkingMemory | null | undefined,
  productId: string,
  quantity: number
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  if (!next.activeCart || next.activeCart.length === 0) return next

  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Quantidade inválida (${quantity}). Deve ser um número inteiro positivo.`)
  }

  const pId = productId.trim()
  const index = next.activeCart.findIndex(i => i.productId === pId)
  if (index === -1) return next

  const existing = next.activeCart[index]
  if (existing.quantity === quantity) return next

  const updatedCart = [...next.activeCart]
  const updatedItem: CartItem = {
    ...existing,
    quantity,
    isPriceConfirmed: false // Alteração de quantidade invalida o preço definitivo anterior
  }
  delete updatedItem.subtotal
  updatedCart[index] = updatedItem

  next.activeCart = updatedCart
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Atualiza o preço validado de um item no carrinho.
 */
export function updateCartItemPrice(
  memory: WorkingMemory | null | undefined,
  productId: string,
  pricing: {
    unitPrice: number
    subtotal?: number
    priceType?: string
    lastPricingQueryId?: string
  }
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  if (!next.activeCart || next.activeCart.length === 0) return next

  if (typeof pricing.unitPrice !== 'number' || !Number.isFinite(pricing.unitPrice) || pricing.unitPrice <= 0) {
    throw new Error(`Preço unitário inválido (${pricing.unitPrice}). Deve ser um número positivo.`)
  }

  const pId = productId.trim()
  const index = next.activeCart.findIndex(i => i.productId === pId)
  if (index === -1) return next

  const existing = next.activeCart[index]
  const subtotal = typeof pricing.subtotal === 'number'
    ? Math.round(pricing.subtotal * 100) / 100
    : Math.round(pricing.unitPrice * existing.quantity * 100) / 100

  const updatedCart = [...next.activeCart]
  updatedCart[index] = {
    ...existing,
    unitPrice: pricing.unitPrice,
    subtotal,
    priceType: pricing.priceType ?? existing.priceType,
    lastPricingQueryId: pricing.lastPricingQueryId ?? existing.lastPricingQueryId,
    isPriceConfirmed: true
  }

  next.activeCart = updatedCart
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Remove um item do carrinho, preservando todos os demais.
 */
export function removeCartItem(
  memory: WorkingMemory | null | undefined,
  productId: string
): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  if (!next.activeCart) return next

  const pId = productId.trim()
  next.activeCart = next.activeCart.filter(item => item.productId !== pId)
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Consulta todos os itens do carrinho.
 */
export function getCartItems(memory: WorkingMemory | null | undefined): CartItem[] {
  return memory?.activeCart ? [...memory.activeCart] : []
}

/**
 * Calcula o subtotal consolidado do carrinho utilizando apenas valores validados.
 */
export function calculateCartTotal(memory: WorkingMemory | null | undefined): CartCalculationResult {
  const items = memory?.activeCart || []
  let totalConfirmedCents = 0
  let totalPendingCents = 0
  let allPricesConfirmed = true
  const unconfirmedProductIds: string[] = []

  for (const item of items) {
    const itemSubtotalCents = item.subtotalCents ?? (typeof item.subtotal === 'number' ? Math.round(item.subtotal * 100) : 0)
    if (item.isPriceConfirmed && itemSubtotalCents > 0) {
      totalConfirmedCents += itemSubtotalCents
    } else {
      allPricesConfirmed = false
      unconfirmedProductIds.push(item.productId)
      if (itemSubtotalCents > 0) {
        totalPendingCents += itemSubtotalCents
      }
    }
  }

  const hasPendingItems = !allPricesConfirmed || unconfirmedProductIds.length > 0

  return {
    total: totalConfirmedCents / 100,
    totalConfirmedCents,
    totalPendingCents,
    itemCount: items.length,
    allPricesConfirmed: items.length > 0 ? allPricesConfirmed : true,
    hasPendingItems,
    unconfirmedProductIds
  }
}

/**
 * Constante padrão de expiração (TTL) da Working Memory Operacional (24 horas)
 */
export const DEFAULT_WORKING_MEMORY_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Obtém o TTL configurado para o carrinho e memória de trabalho em milissegundos.
 * Permite customização por variável de ambiente AGENT_CART_TTL_HOURS (default: 24h).
 */
export function getConfiguredCartTtlMs(): number {
  const envHours = process.env.AGENT_CART_TTL_HOURS ? Number(process.env.AGENT_CART_TTL_HOURS) : null
  if (typeof envHours === 'number' && !isNaN(envHours) && envHours > 0) {
    return envHours * 60 * 60 * 1000
  }
  return DEFAULT_WORKING_MEMORY_TTL_MS
}

export interface WorkingMemoryExpiryOptions {
  /**
   * Se true, timestamps ausentes, vazios ou inválidos são tratados como expirados (Fail-Closed).
   * Padrão: false para retrocompatibilidade direta quando chamado sem opções.
   */
  failClosed?: boolean
}

/**
 * Verifica se a Working Memory expirou devido a inatividade prolongada (> TTL).
 * Aceita timestamp ISO, Date ou milissegundos.
 * Quando options.failClosed for true, timestamps ausentes ou inválidos retornam true (expirados por segurança).
 */
export function isWorkingMemoryExpired(
  timestamp: string | Date | number | null | undefined,
  now: number = Date.now(),
  ttlMs: number = getConfiguredCartTtlMs(),
  options?: WorkingMemoryExpiryOptions
): boolean {
  if (!timestamp) return Boolean(options?.failClosed)
  const timeMs = typeof timestamp === 'number'
    ? timestamp
    : new Date(timestamp).getTime()
  if (isNaN(timeMs)) return Boolean(options?.failClosed)
  return (now - timeMs) > ttlMs
}

/**
 * Reseta deterministicamente os dados voláteis da Working Memory (carrinho não finalizado,
 * produto em foco e buffer de buscas anteriores), preservando apenas histórico
 * estritamente permanente.
 */
export function expireWorkingMemory(
  memory: WorkingMemory | null | undefined,
  nowIso: string = new Date().toISOString()
): WorkingMemory {
  if (!memory) return {}
  const next: WorkingMemory = { ...memory }
  delete next.activeCart
  delete next.activeProduct
  delete next.activePrice
  delete next.activeQuantity
  delete next.discoveredProducts
  // Se o orçamento era um rascunho (draft) não finalizado, expira junto com o carrinho
  if (next.activeQuote?.status === 'draft') {
    delete next.activeQuote
  }
  next.expiredAt = nowIso
  next.updatedAt = nowIso
  return next
}

/**
 * Limpa todos os itens do carrinho em memória.
 */
export function clearCart(memory: WorkingMemory | null | undefined): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  next.activeCart = []
  next.updatedAt = new Date().toISOString()
  return next
}

/**
 * Atualiza deterministicamente a Working Memory a partir dos resultados reais das ferramentas executadas.
 */
export function applyWorkingMemoryUpdate(previous: WorkingMemory | null | undefined, toolResults: any[]): WorkingMemory {
  let next: WorkingMemory = { ...(previous || {}) }
  let hasValidToolResult = false

  for (const res of toolResults) {
    if (!res || !res.success || !res.data) continue
    hasValidToolResult = true

    const toolName = res.toolName
    
    if (toolName === 'buscar_produto' || toolName === 'consultar_produto_comercial') {
      // 1. Atualizar buffer contínuo de produtos descobertos/apresentados (discoveredProducts)
      const incomingProducts: DiscoveredProduct[] = []
      if (Array.isArray(res.data.products)) {
        for (const p of res.data.products) {
          if (p?.id && p?.name) {
            incomingProducts.push({
              id: p.id,
              name: p.name,
              unitPrice: p.price?.unit_price ?? p.unit_price ?? p.unitPrice,
              subtotal: p.price?.subtotal ?? p.subtotal,
              brand: p.brand || null
            })
          }
        }
      } else if (res.data.product?.id && res.data.product?.name) {
        incomingProducts.push({
          id: res.data.product.id,
          name: res.data.product.name,
          unitPrice: res.data.price?.unit_price ?? res.data.pricing?.unit_price ?? res.data.unit_price,
          subtotal: res.data.price?.subtotal ?? res.data.pricing?.subtotal ?? res.data.subtotal,
          brand: res.data.product.brand || null
        })
      } else if (Array.isArray(res.data.matches)) {
        for (const m of res.data.matches) {
          if (m?.id && m?.name) {
            incomingProducts.push({
              id: m.id,
              name: m.name,
              unitPrice: m.price?.unit_price ?? m.unit_price,
              brand: m.brand || null
            })
          }
        }
      }

      if (incomingProducts.length > 0) {
        const existingList = next.discoveredProducts ? [...next.discoveredProducts] : []
        const mergedIncoming: DiscoveredProduct[] = incomingProducts.map(inc => {
          const old = existingList.find(e => e.id === inc.id)
          return old ? { ...old, ...inc } : inc
        })
        const incomingIds = new Set(mergedIncoming.map(p => p.id))
        const remaining = existingList.filter(e => !incomingIds.has(e.id))
        // Produtos recém-apresentados ou atualizados sempre no topo (mais recentes primeiro)
        next.discoveredProducts = [...mergedIncoming, ...remaining].slice(0, 20)
      }



      const isConfirmedMatch = 
        res.data.strategy === 'specific_product' ||
        res.data.strategy === 'quantity_pricing' ||
        res.data.status === 'exact_match'

      if (isConfirmedMatch) {
        const product = res.data.product ?? res.data.matches?.[0]
        
        if (product && typeof product.id === 'string' && product.id.trim() !== '' && typeof product.name === 'string' && product.name.trim() !== '') {
          const newId = product.id.trim()
          
          // Invalidação de dependências: se o produto mudou para outro ID, descartamos os derivados antigos
          if (next.activeProduct && next.activeProduct.id !== newId) {
            delete next.activePrice
            delete next.activeQuantity
          }
          
          next.activeProduct = { id: newId, name: product.name.trim() }
        }

        // Atualiza quantidade se a ferramenta comercial confirmou uma quantidade válida
        if (typeof res.data.quantity === 'number' && res.data.quantity > 0) {
          next.activeQuantity = res.data.quantity
        }

        // Aplica preço novo se houver
        const pricingData = res.data.pricing ?? res.data.price
        if (pricingData) {
          const unitPrice = pricingData.unit_price ?? pricingData.unitPrice
          const priceType = pricingData.price_type ?? pricingData.priceType
          if (typeof unitPrice === 'number') {
            next.activePrice = { unitPrice, priceType }
          }
        }

        // Regra do Carrinho: se a estratégia for explicitamente de quantidade (quantity_pricing),
        // o cliente solicitou uma quantidade específica com precificação confirmada, sincronizamos o item no carrinho.
        // Consultas puras de produto (specific_product, exact_match sem quantidade) NÃO inserem no carrinho automaticamente.
        if (res.data.strategy === 'quantity_pricing' && next.activeProduct && typeof next.activeQuantity === 'number' && next.activePrice) {
          const subtotal = pricingData?.subtotal ?? Math.round(next.activePrice.unitPrice * next.activeQuantity * 100) / 100
          next = addItemToCart(next, {
            productId: next.activeProduct.id,
            name: next.activeProduct.name,
            quantity: next.activeQuantity,
            unitPrice: next.activePrice.unitPrice,
            subtotal,
            priceType: next.activePrice.priceType,
            isPriceConfirmed: true
          })
        }

        // Regra Multi-Produto: Se a ferramenta processou múltiplos produtos estruturados em lote,
        // adiciona todos os itens confirmados ao carrinho multi-item.
        if (res.data.strategy === 'multi_product_pricing' && Array.isArray(res.data.items)) {
          for (const it of res.data.items) {
            if (it.productId && it.name) {
              next = addItemToCart(next, {
                productId: it.productId,
                sku: it.sku,
                name: it.name,
                quantity: it.quantity || 1,
                unit: it.unit,
                unitPrice: it.unitPrice,
                subtotal: it.subtotal,
                unitPriceCents: it.unitPriceCents,
                subtotalCents: it.subtotalCents,
                priceType: it.priceType,
                appliedRule: it.appliedRule,
                isPriceConfirmed: it.isPriceConfirmed !== false,
                status: it.isPriceConfirmed !== false ? 'confirmed' : 'pending'
              })
            }
          }
          if (res.data.items.length > 0) {
            const first = res.data.items[0]
            next.activeProduct = { id: first.productId, name: first.name }
            if (first.unitPrice) {
              next.activePrice = { unitPrice: first.unitPrice, priceType: first.priceType }
            }
            next.activeQuantity = first.quantity
          }
        }
      }
    }
    
    if (toolName === 'gerenciar_carrinho') {
      const action = res.data.action
      if (action === 'clear_cart') {
        next = clearCart(next)
      } else if (action === 'remove_item' && res.data.removed_product_id) {
        next = removeCartItem(next, res.data.removed_product_id)
      } else if (action === 'update_quantity' && res.data.updated_item) {
        const item = res.data.updated_item
        next = updateCartItemQuantity(next, item.productId, item.quantity)
        if (typeof item.unitPrice === 'number') {
          next = updateCartItemPrice(next, item.productId, {
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            priceType: item.priceType
          })
        }
      } else if (action === 'replace_item' && res.data.replaced_product_id && res.data.new_item) {
        next = replaceCartItem(next, res.data.replaced_product_id, res.data.new_item)
      }
    }
    
    if (toolName === 'calcular_preco_produto') {
      if (typeof res.data.quantity === 'number' && res.data.quantity > 0) {
        next.activeQuantity = res.data.quantity
      }
      
      const unitPrice = res.data.unit_price ?? res.data.unitPrice
      const priceType = res.data.price_type ?? res.data.priceType
      if (typeof unitPrice === 'number') {
        next.activePrice = { unitPrice, priceType }
      }

      const prodId = res.data.product_id ?? next.activeProduct?.id
      if (prodId) {
        const prodName = res.data.product_name ?? 
          next.discoveredProducts?.find(p => p.id === prodId)?.name ?? 
          (next.activeProduct && next.activeProduct.id === prodId ? next.activeProduct.name : undefined) ??
          next.activeCart?.find(i => i.productId === prodId)?.name

        if (prodName && typeof unitPrice === 'number') {
          const qty = res.data.quantity ?? next.activeQuantity ?? 1
          const subtotal = res.data.subtotal ?? Math.round(unitPrice * qty * 100) / 100
          next = addItemToCart(next, {
            productId: prodId,
            name: prodName,
            quantity: qty,
            unitPrice,
            subtotal,
            priceType,
            isPriceConfirmed: true
          })
          next.activeProduct = { id: prodId, name: prodName }
        } else if (next.activeCart?.some(i => i.productId === prodId)) {
          next = updateCartItemPrice(next, prodId, {
            unitPrice,
            subtotal: res.data.subtotal,
            priceType
          })
        }
      }
    }

    if (toolName === 'consultar_preco') {
      const unitPrice = res.data.unit_price ?? res.data.unitPrice
      const priceType = res.data.price_type ?? res.data.priceType
      if (typeof unitPrice === 'number') {
        next.activePrice = { unitPrice, priceType }
      }

      const prodId = res.data.product_id ?? next.activeProduct?.id
      if (prodId && next.activeCart?.some(i => i.productId === prodId)) {
        const item = next.activeCart.find(i => i.productId === prodId)
        if (item && item.quantity === 1) {
          next = updateCartItemPrice(next, prodId, {
            unitPrice,
            priceType
          })
        }
      }
    }

    if (toolName === 'gerar_orcamento' || toolName === 'consultar_orcamento') {
      if (res.data.id) {
        next.activeQuote = { 
          id: res.data.id, 
          total: typeof res.data.total === 'number' ? res.data.total : 0, 
          status: res.data.status || 'draft' 
        }
      }

      // Se o orçamento foi gerado ou consultado com sucesso e retornou itens confirmados,
      // sincronizamos o activeCart com a composição do orçamento
      if (Array.isArray(res.data.items) && res.data.items.length > 0) {
        const existingCart = next.activeCart || []
        const quoteItems: CartItem[] = res.data.items.map((it: any) => {
          const pId = it.productId ?? it.product_id
          const existingItem = existingCart.find(e => e.productId === pId)
          return {
            productId: pId,
            name: it.productName ?? it.name ?? existingItem?.name ?? (next.activeProduct && next.activeProduct.id === pId ? next.activeProduct.name : 'Produto'),
            quantity: it.quantity,
            unitPrice: it.unitPrice ?? it.unit_price,
            subtotal: it.subtotal,
            priceType: it.priceType ?? it.price_type ?? existingItem?.priceType,
            isPriceConfirmed: true
          }
        })
        next.activeCart = quoteItems
      }
    }
  }

  if (hasValidToolResult) {
    next.updatedAt = new Date().toISOString()
  } else if (!next.updatedAt && (Boolean(next.activeCart?.length) || Boolean(next.activeProduct) || Boolean(next.activePrice) || Boolean(next.activeQuote))) {
    // Garante que qualquer memória operacional com dados ativos possua timestamp inicial
    next.updatedAt = new Date().toISOString()
  }
  
  return next
}
