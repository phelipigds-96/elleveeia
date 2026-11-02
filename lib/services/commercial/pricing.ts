import { createAdminClient } from '@/lib/supabase/service'

export interface PriceResolutionRequest {
  companyId: string
  productId: string
  quantity: number
  priceType?: string
  isClubEligible?: boolean
}

export interface PriceResolutionResult {
  productId: string
  quantity: number
  unitPrice: number
  subtotal: number
  priceType: string
  minQuantity: number
  maxQuantity?: number | null
  source: string
}

/**
 * Converte strings de vigência recebidas do banco/ERP respeitando o fuso de Brasília.
 * Se a data vier apenas como "YYYY-MM-DD", assume o final do dia (23:59:59.999) para valid_until
 * e o início do dia (00:00:00.000) para valid_from.
 * Retorna 'INVALID' se a data for inválida ou corrompida.
 */
export function parseCommercialValidityDate(val: string | null | undefined, isEndOfDay: boolean): Date | null | 'INVALID' {
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
 * Determina o preço aplicável de um produto para a quantidade desejada de forma determinística e segura
 */
export async function resolveProductPrice(params: PriceResolutionRequest): Promise<PriceResolutionResult> {
  const { companyId, productId, quantity, priceType, isClubEligible = false } = params

  if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new Error('Quantidade inválida. Informe um número inteiro maior que zero.')
  }

  const supabase = createAdminClient()

  // Buscar todos os preços ativos do produto nesta empresa
  const { data: rawPrices, error } = await supabase
    .from('product_prices')
    .select('*')
    .eq('company_id', companyId)
    .eq('product_id', productId)
    .eq('active', true)

  if (error) {
    throw new Error(`Erro ao buscar preços: ${error.message}`)
  }

  if (!rawPrices || rawPrices.length === 0) {
    throw new Error('Produto não possui preço configurado ou está indisponível.')
  }

  // Filtrar vigência (valid_from / valid_until) com timezone comercial
  const now = new Date()
  const activePrices = rawPrices.filter(p => {
    if (p.active === false) return false

    const vFrom = parseCommercialValidityDate(p.valid_from, false)
    if (vFrom === 'INVALID') return false
    if (vFrom && vFrom > now) return false

    const vUntil = parseCommercialValidityDate(p.valid_until, true)
    if (vUntil === 'INVALID') return false
    if (vUntil && vUntil < now) return false

    if (vFrom && vUntil && vFrom > vUntil) return false

    return true
  })

  if (activePrices.length === 0) {
    throw new Error('Produto não possui preço ativo ou vigente.')
  }

  function buildResult(rule: any): PriceResolutionResult {
    const unitPrice = Number(rule.price)
    const subtotalCents = Math.round(unitPrice * 100) * quantity
    const subtotal = Math.round(subtotalCents) / 100

    return {
      productId,
      quantity,
      unitPrice,
      subtotal,
      priceType: rule.price_type,
      minQuantity: rule.min_quantity != null ? Number(rule.min_quantity) : 1,
      maxQuantity: rule.max_quantity != null ? Number(rule.max_quantity) : null,
      source: 'product_prices'
    }
  }

  function selectBestRuleInModality(rules: any[], modalityLabel: string) {
    // 1. Filtrar regras que satisfazem quantidade mínima e máxima
    const eligible = rules.filter(p => {
      const minQ = p.min_quantity != null ? Number(p.min_quantity) : 1
      const maxQ = p.max_quantity != null ? Number(p.max_quantity) : null
      return quantity >= minQ && (maxQ === null || quantity <= maxQ)
    })

    if (eligible.length === 0) return null

    // 2. Verificar se há conflito de faixas sobrepostas entre as regras elegíveis
    // Se múltiplas regras atendem à quantidade e têm preços divergentes:
    if (eligible.length > 1) {
      const distinctPrices = new Set(eligible.map(p => Number(p.price)))
      if (distinctPrices.size > 1) {
        // Verificar se alguma regra tem max_quantity explícito que colide com outra regra
        const hasExplicitOverlap = eligible.some(a => {
          const maxA = a.max_quantity != null ? Number(a.max_quantity) : null
          const minA = a.min_quantity != null ? Number(a.min_quantity) : 1
          return eligible.some(b => {
            const minB = b.min_quantity != null ? Number(b.min_quantity) : 1
            return minA < minB && maxA !== null && minB <= maxA
          })
        })

        // Ou se têm o mesmo min_quantity
        const hasSameMin = eligible.some(a => 
          eligible.some(b => a !== b && (a.min_quantity || 1) === (b.min_quantity || 1))
        )

        if (hasExplicitOverlap || hasSameMin) {
          throw new Error(
            `Ambiguidade na precificação: foram encontradas múltiplas regras ativas ou faixas sobrepostas de ${modalityLabel} com valores divergentes para a quantidade informada (${quantity} unidades).`
          )
        }
      }
    }

    // 3. Priorizar a faixa de maior volume (maior min_quantity)
    const maxMin = Math.max(...eligible.map(p => (p.min_quantity != null ? Number(p.min_quantity) : 1)))
    const topCandidates = eligible.filter(p => (p.min_quantity != null ? Number(p.min_quantity) : 1) === maxMin)

    // 4. Detecção de ambiguidade dentro da mesma modalidade (mesmo min_quantity e preços divergentes)
    if (topCandidates.length > 1) {
      const distinctPrices = new Set(topCandidates.map(p => Number(p.price)))
      if (distinctPrices.size > 1) {
        throw new Error(
          `Ambiguidade na precificação: foram encontradas múltiplas regras ativas de ${modalityLabel} com valores divergentes para a mesma faixa de quantidade.`
        )
      }
    }

    return topCandidates[0]
  }

  // CASO 1: Modalidade explícita solicitada
  if (priceType) {
    // Proteção estrita do Clube Sumel: não conceder preço sem elegibilidade comprovada
    if (priceType === 'club' && !isClubEligible) {
      throw new Error(
        'Preço da modalidade "club" não disponível: requer comprovação de elegibilidade de membro do Clube Sumel.'
      )
    }

    const modalityPrices = activePrices.filter(p => p.price_type === priceType)
    if (modalityPrices.length === 0) {
      throw new Error(`Produto não possui o tipo de preço solicitado (${priceType}).`)
    }

    const selectedRule = selectBestRuleInModality(modalityPrices, priceType)
    if (!selectedRule) {
      if (priceType === 'wholesale') {
        const minWholesale = Math.min(
          ...modalityPrices.map(p => (p.min_quantity != null ? Number(p.min_quantity) : 1))
        )
        if (quantity < minWholesale) {
          throw new Error(
            `A quantidade solicitada (${quantity}) não atinge o lote mínimo necessário para compra no atacado (mínimo: ${minWholesale} unidades).`
          )
        }
      }
      if (priceType === 'retail') {
        const maxRetail = Math.max(
          ...modalityPrices.map(p => (p.max_quantity != null ? Number(p.max_quantity) : Infinity))
        )
        if (quantity > maxRetail) {
          throw new Error(
            `A quantidade solicitada (${quantity}) excede o limite máximo configurado para varejo (máximo: ${maxRetail} unidades).`
          )
        }
      }
      throw new Error(
        `A quantidade solicitada (${quantity}) não atende aos requisitos de quantidade para o preço ${priceType}.`
      )
    }

    return buildResult(selectedRule)
  }

  // CASO 2: Resolução automática (priceType não especificado)
  // Regra 1: NUNCA selecionar automaticamente 'club'
  const nonClubPrices = activePrices.filter(p => p.price_type !== 'club')

  if (nonClubPrices.length === 0) {
    throw new Error('Produto não possui preço aplicável para clientes não associados ao Clube Sumel.')
  }

  // Regra 2: Para quantidades que atinjam uma faixa de atacado elegível, aplicar wholesale
  const wholesalePrices = nonClubPrices.filter(p => p.price_type === 'wholesale')
  const bestWholesale = selectBestRuleInModality(wholesalePrices, 'atacado (wholesale)')

  if (bestWholesale) {
    return buildResult(bestWholesale)
  }

  // Regra 3: Quando não houver faixa de atacado elegível, aplicar varejo
  const retailPrices = nonClubPrices.filter(p => p.price_type === 'retail')
  const bestRetail = selectBestRuleInModality(retailPrices, 'varejo (retail)')

  if (bestRetail) {
    return buildResult(bestRetail)
  }

  // Regra 4: Se não houver varejo nem atacado elegível, rejeitar com clareza sem inventar preço
  if (wholesalePrices.length > 0) {
    const minWholesale = Math.min(
      ...wholesalePrices.map(p => (p.min_quantity != null ? Number(p.min_quantity) : 1))
    )
    if (quantity < minWholesale) {
      throw new Error(
        `A quantidade solicitada (${quantity}) não atinge o lote mínimo necessário para compra no atacado (mínimo: ${minWholesale} unidades).`
      )
    }
  }

  if (retailPrices.length > 0) {
    const maxRetail = Math.max(
      ...retailPrices.map(p => (p.max_quantity != null ? Number(p.max_quantity) : Infinity))
    )
    if (quantity > maxRetail) {
      throw new Error(
        `A quantidade solicitada (${quantity}) excede o limite máximo configurado para varejo (máximo: ${maxRetail} unidades).`
      )
    }
  }

  throw new Error(
    `A quantidade solicitada (${quantity}) não atende aos requisitos de quantidade para os preços disponíveis.`
  )
}
