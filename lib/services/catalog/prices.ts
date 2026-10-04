import { createAdminClient } from '@/lib/supabase/service'

export interface PriceResult {
  priceType: string
  price: number
  minQuantity: number | null
}

export interface ProductPriceResponse {
  success: boolean
  product?: {
    id: string
    name: string
  }
  prices?: PriceResult[]
  reason?: string
}

export async function getProductPrices(
  companyId: string, 
  productId: string, 
  priceType?: string, 
  quantity?: number
): Promise<ProductPriceResponse> {
  const supabase = createAdminClient()

  // 1. Valida se o produto existe e pertence à empresa correta
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('id, name')
    .eq('company_id', companyId)
    .eq('id', productId)
    .single()

  if (productError || !product) {
    return { success: false, reason: 'product_not_found_or_access_denied' }
  }

  // 2. Busca os preços ativos
  let query = supabase
    .from('product_prices')
    .select('price_type, price, min_quantity, max_quantity')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .eq('active', true)

  if (priceType) {
    query = query.eq('price_type', priceType)
  }

  const { data: prices, error: pricesError } = await query

  if (pricesError || !prices || prices.length === 0) {
    return { success: false, reason: 'price_not_found' }
  }

  // 3. Aplica regras de quantidade se fornecido
  let validPrices = prices
  if (quantity !== undefined && quantity > 0) {
    validPrices = prices.filter(p => {
      if (p.min_quantity && quantity < p.min_quantity) return false
      if (p.max_quantity && quantity > p.max_quantity) return false
      return true
    })
  }

  if (validPrices.length === 0) {
    return { success: false, reason: 'no_price_for_this_quantity' }
  }

  return {
    success: true,
    product: {
      id: product.id,
      name: product.name
    },
    prices: validPrices.map(p => ({
      priceType: p.price_type,
      price: Number(p.price),
      minQuantity: p.min_quantity ? Number(p.min_quantity) : null
    }))
  }
}
