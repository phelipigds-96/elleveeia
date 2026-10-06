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
  activeQuote?: {
    id: string
    total: number
    status: string
  }
}

export function applyWorkingMemoryUpdate(previous: WorkingMemory | null | undefined, toolResults: any[]): WorkingMemory {
  const next: WorkingMemory = { ...(previous || {}) }

  for (const res of toolResults) {
    if (!res.success || !res.data) continue

    const toolName = res.toolName
    
    if (toolName === 'buscar_produto' || toolName === 'consultar_produto_comercial') {
       if (res.data.status === 'exact_match') {
           const product = res.data.product ?? res.data.matches?.[0]
           
           if (product && product.id) {
               const newId = product.id
               
               // Invalidacao de dependencias: se o produto mudou, descartamos os derivados antigos
               if (next.activeProduct && next.activeProduct.id !== newId) {
                   delete next.activePrice
                   delete next.activeQuantity
               }
               
               next.activeProduct = { id: newId, name: product.name }
           }
       }
       
       // Aplica preco novo se houver
       const pricingData = res.data.pricing ?? res.data.price
       if (pricingData) {
           const unitPrice = pricingData.unit_price ?? pricingData.unitPrice
           const priceType = pricingData.price_type ?? pricingData.priceType
           if (unitPrice !== undefined) {
               next.activePrice = { unitPrice, priceType }
           }
       }
    }
    
    if (toolName === 'calcular_preco_produto') {
       if (res.data.quantity !== undefined) next.activeQuantity = res.data.quantity
       
       const unitPrice = res.data.unit_price ?? res.data.unitPrice
       const priceType = res.data.price_type ?? res.data.priceType
       if (unitPrice !== undefined) {
           next.activePrice = { unitPrice, priceType }
       }
    }

    if (toolName === 'gerar_orcamento') {
       next.activeQuote = { id: res.data.id, total: res.data.total, status: res.data.status }
    }
  }
  
  return next
}
