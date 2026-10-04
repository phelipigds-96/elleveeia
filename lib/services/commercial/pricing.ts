import { createAdminClient } from '@/lib/supabase/service'

export interface PriceResolutionRequest {
  companyId: string
  productId: string
  quantity: number
  priceType?: string
}

export interface PriceResolutionResult {
  productId: string
  quantity: number
  unitPrice: number
  subtotal: number
  priceType: string
  minQuantity: number
  source: string
}

/**
 * Determina o preço aplicável de um produto para a quantidade desejada
 */
export async function resolveProductPrice(params: PriceResolutionRequest): Promise<PriceResolutionResult> {
  const { companyId, productId, quantity, priceType } = params

  if (quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('Quantidade inválida. Informe um número inteiro maior que zero.')
  }

  const supabase = createAdminClient()

  // Buscar todos os preços ativos do produto nesta empresa
  const { data: prices, error } = await supabase
    .from('product_prices')
    .select('*')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .eq('active', true)
    .order('min_quantity', { ascending: false }) // Prioriza as regras de maior volume primeiro

  if (error) {
    throw new Error(`Erro ao buscar preços: ${error.message}`)
  }

  if (!prices || prices.length === 0) {
    throw new Error('Produto não possui preço configurado ou está indisponível.')
  }

  // Filtrar pelo priceType solicitado, se houver
  let applicablePrices = prices
  if (priceType) {
    applicablePrices = prices.filter(p => p.price_type === priceType)
    if (applicablePrices.length === 0) {
      throw new Error(`Produto não possui o tipo de preço solicitado (${priceType}).`)
    }
  }

  // Encontrar o melhor preço baseado na quantidade
  // Como ordenamos decrescente, o primeiro que for <= quantity é a melhor regra (ex: atacado > varejo)
  let bestPrice = applicablePrices.find(p => quantity >= (p.min_quantity || 1))

  // Fallback: se não achar nenhuma regra de quantidade mínima que atenda, 
  // e se estiver pedindo um priceType específico, isso significa que não bateu a regra.
  if (!bestPrice) {
    // Pega o menor preço base (min_quantity == 1 ou 0) para não travar, ou rejeita se todas exigem mínimo.
    const basePrices = applicablePrices.filter(p => (p.min_quantity || 1) <= 1)
    if (basePrices.length > 0) {
      // Pega o mais barato dos preços base (embora deva ter só um do mesmo tipo)
      bestPrice = basePrices.sort((a, b) => Number(a.price) - Number(b.price))[0]
    } else {
      throw new Error(`A quantidade solicitada (${quantity}) não atinge o mínimo necessário para os preços configurados.`)
    }
  }

  const unitPrice = Number(bestPrice.price)
  
  // Cálculo financeiro preciso (evitando erro de ponto flutuante em JS)
  // Multiplica por 100, faz o math round, e divide
  const subtotalCents = Math.round(unitPrice * 100) * quantity
  const subtotal = subtotalCents / 100

  return {
    productId,
    quantity,
    unitPrice,
    subtotal,
    priceType: bestPrice.price_type,
    minQuantity: bestPrice.min_quantity || 1,
    source: 'product_prices'
  }
}
