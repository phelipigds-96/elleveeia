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
       const matches = res.data.matches || []
       
       if (res.data.status === 'exact_match' && matches.length === 1 && matches[0].id) {
           const newId = matches[0].id
           
           // Invalidaǜo de dependǦncias: se o produto mudou, descartamos os derivados antigos
           if (next.activeProduct && next.activeProduct.id !== newId) {
               delete next.activePrice
               delete next.activeQuantity
           }
           
           next.activeProduct = { id: newId, name: matches[0].name }
       }
       
       // Aplica preço novo se houver
       if (res.data.price) {
           next.activePrice = { unitPrice: res.data.price.unitPrice, priceType: res.data.price.priceType }
       }
    }
    
    if (toolName === 'calcular_preco_produto') {
       if (res.data.quantity) next.activeQuantity = res.data.quantity
       if (res.data.unitPrice) next.activePrice = { unitPrice: res.data.unitPrice }
    }

    if (toolName === 'gerar_orcamento') {
       next.activeQuote = { id: res.data.id, total: res.data.total, status: res.data.status }
    }
  }
  
  return next
}
