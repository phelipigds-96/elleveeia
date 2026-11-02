export interface CartItem {
  productId: string
  name: string
  quantity: number
  unitPrice?: number
  subtotal?: number
  priceType?: string
  lastPricingQueryId?: string
  isPriceConfirmed: boolean
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
  }
}

export interface AddCartItemParams {
  productId: string
  name: string
  quantity: number
  unitPrice?: number
  subtotal?: number
  priceType?: string
  lastPricingQueryId?: string
  isPriceConfirmed?: boolean
}

export interface CartCalculationResult {
  total: number
  itemCount: number
  allPricesConfirmed: boolean
  unconfirmedProductIds: string[]
}

/**
 * Adiciona um item ao carrinho ou atualiza um item existente.
 * Regras:
 * - Adicionar um segundo produto não apaga o primeiro.
 * - Adicionar o mesmo produto atualiza sua quantidade sem duplicar.
 * - Se a quantidade mudar sem novo preço confirmado, invalida o preço definitivo.
 * - Valores não validados não são aceitos como preço confirmado.
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

  const existingIndex = currentCart.findIndex(i => i.productId === pId)

  if (existingIndex >= 0) {
    const existing = currentCart[existingIndex]
    const quantityChanged = existing.quantity !== item.quantity

    const updatedItem: CartItem = {
      ...existing,
      name: pName,
      quantity: item.quantity,
      priceType: item.priceType ?? existing.priceType,
      lastPricingQueryId: item.lastPricingQueryId ?? existing.lastPricingQueryId
    }

    if (hasValidPrice && item.isPriceConfirmed) {
      updatedItem.unitPrice = item.unitPrice
      updatedItem.subtotal = typeof item.subtotal === 'number'
        ? Math.round(item.subtotal * 100) / 100
        : Math.round(item.unitPrice! * item.quantity * 100) / 100
      updatedItem.isPriceConfirmed = true
    } else if (quantityChanged) {
      // Invalidação determinística de preço: mudança de quantidade sem nova precificação
      updatedItem.isPriceConfirmed = false
      delete updatedItem.subtotal
    }

    currentCart[existingIndex] = updatedItem
  } else {
    const newItem: CartItem = {
      productId: pId,
      name: pName,
      quantity: item.quantity,
      priceType: item.priceType,
      lastPricingQueryId: item.lastPricingQueryId,
      isPriceConfirmed: isConfirmed
    }

    if (isConfirmed && hasValidPrice) {
      newItem.unitPrice = item.unitPrice
      newItem.subtotal = typeof item.subtotal === 'number'
        ? Math.round(item.subtotal * 100) / 100
        : Math.round(item.unitPrice! * item.quantity * 100) / 100
    }

    currentCart.push(newItem)
  }

  next.activeCart = currentCart
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
  let totalCents = 0
  let allPricesConfirmed = true
  const unconfirmedProductIds: string[] = []

  for (const item of items) {
    if (item.isPriceConfirmed && typeof item.subtotal === 'number' && item.subtotal > 0) {
      totalCents += Math.round(item.subtotal * 100)
    } else {
      allPricesConfirmed = false
      unconfirmedProductIds.push(item.productId)
    }
  }

  return {
    total: totalCents / 100,
    itemCount: items.length,
    allPricesConfirmed: items.length > 0 ? allPricesConfirmed : true,
    unconfirmedProductIds
  }
}

/**
 * Limpa todos os itens do carrinho em memória.
 */
export function clearCart(memory: WorkingMemory | null | undefined): WorkingMemory {
  const next: WorkingMemory = { ...(memory || {}) }
  next.activeCart = []
  return next
}

/**
 * Atualiza deterministicamente a Working Memory a partir dos resultados reais das ferramentas executadas.
 */
export function applyWorkingMemoryUpdate(previous: WorkingMemory | null | undefined, toolResults: any[]): WorkingMemory {
  let next: WorkingMemory = { ...(previous || {}) }

  for (const res of toolResults) {
    if (!res || !res.success || !res.data) continue

    const toolName = res.toolName
    
    if (toolName === 'buscar_produto' || toolName === 'consultar_produto_comercial') {
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

      // Se o produto calculado está no activeCart, atualizamos sua precificação com o valor validado
      const prodId = res.data.product_id ?? next.activeProduct?.id
      if (prodId && next.activeCart?.some(i => i.productId === prodId)) {
        next = updateCartItemPrice(next, prodId, {
          unitPrice,
          subtotal: res.data.subtotal,
          priceType
        })
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
  
  return next
}
