import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { searchProducts, extractProductPackageFactor } from '../../catalog/products'
import { parseQuery } from '../../catalog/search-logic'
import { splitMultiProductQuery, parseStructuredQuery } from '../../catalog/query-parser'
import { resolveProductPrice, resolveBatchProductPrices } from '../../commercial/pricing'
import { applyCommercialStrategy, resolveReferenceQuery } from '../commercial-strategy'

export const consultarProdutoComercialTool: ToolDefinition = {
  name: 'consultar_produto_comercial',
  description: 'Busca produto e calcula preco numa unica etapa. Se a consulta for ampla (apenas marca ou termo geral), utilize as orientações consultivas retornadas para qualificar a necessidade do cliente antes de listar produtos desnecessários. Se "not_found", diga que nao achou (nao presuma estoque). Se "ambiguous", peca para esclarecer.',
  metadata: { category: 'commercial', capabilities: ['product.search', 'price.calculate'] },
  schema: z.object({
    product_query: z.string().describe('Termo buscado.'),
    quantity: z.number().int().positive().optional().describe('Qtd desejada (padrao 1).'),
    price_type: z.string().optional().describe('Tipo de preco (retail/wholesale/club). Deixe vazio p/ regra automatica.')
  }),
  execute: async (input, context) => {
    const { product_query, quantity = 1, price_type } = input
    
    // 1. Resolução Anafórica e Ordinal via Working Memory
    const refResolution = resolveReferenceQuery(product_query, context.workingMemory)

    // Se a referência for ambígua e exigir desambiguação amigável
    if (refResolution.isAmbiguous) {
      return {
        success: true,
        data: {
          strategy: 'ambiguous_product',
          consultative_hint: refResolution.ambiguityMessage,
          options: refResolution.candidateOptions?.map((o: any) => ({
            id: o.id || o.product?.id,
            name: o.name || o.product?.name
          }))
        }
      }
    }

    const effectiveQuery = refResolution.resolvedQuery || product_query

    // 2. Detecção e Atendimento de Múltiplos Produtos na Mesma Consulta
    const subQueries = splitMultiProductQuery(effectiveQuery)
    if (subQueries.length > 1) {
      const parsedParts = subQueries.map(part => {
        const parsed = parseStructuredQuery(part)
        return {
          originalPart: part,
          parsed,
          effectiveTerm: parsed.normalizedQuery || part,
          quantity: parsed.quantity > 0 ? parsed.quantity : (quantity || 1)
        }
      })

      // Busca paralela no catálogo oficial do tenant
      const searchResults = await Promise.all(
        parsedParts.map(p => searchProducts(context.companyId, p.effectiveTerm, 5))
      )

      const matchedProducts: Array<{
        partIndex: number
        product: any
        quantity: number
        requestedQuantity: number
        requestedUnit: string
        packageFactor: number | null
        isUnconfirmed: boolean
        unconfirmedReason?: string
        part: typeof parsedParts[0]
      }> = []

      for (let i = 0; i < searchResults.length; i++) {
        const sr = searchResults[i]
        const part = parsedParts[i]
        if (sr.matches && sr.matches.length > 0) {
          const prod = sr.matches[0]
          const isWholesaleReq = part.parsed.saleUnit === 'CX' || part.parsed.saleUnit === 'FD' || part.parsed.saleUnit === 'PC'
          const isProdUn = (prod.unit || 'UN').toUpperCase() === 'UN'
          const pkgFactor = prod.packageFactor ?? (prod.packageDescription ? extractProductPackageFactor(prod).factor : null)

          let effectiveQty = part.quantity
          let isUnconfirmed = false
          let unconfirmedReason: string | undefined

          if (isWholesaleReq && isProdUn) {
            if (pkgFactor && pkgFactor > 1) {
              effectiveQty = part.quantity * pkgFactor
            } else {
              isUnconfirmed = true
              unconfirmedReason = `Fator de embalagem de ${part.parsed.saleUnit === 'CX' ? 'caixa' : 'embalagem'} não cadastrado`
            }
          }

          matchedProducts.push({
            partIndex: i,
            product: prod,
            quantity: effectiveQty,
            requestedQuantity: part.quantity,
            requestedUnit: part.parsed.saleUnit,
            packageFactor: pkgFactor ?? null,
            isUnconfirmed,
            unconfirmedReason,
            part
          })
        }
      }

      if (matchedProducts.length === 0) {
        return {
          success: true,
          data: {
            strategy: 'not_found',
            consultative_hint: 'Não localizei esses produtos no catálogo oficial. Gostaria de verificar outras marcas ou opções?',
            products: []
          }
        }
      }

      // Precificação em lote oficial (apenas itens com fator confirmado)
      const confirmedToPrice = matchedProducts.filter(m => !m.isUnconfirmed)
      const batchResult = confirmedToPrice.length > 0
        ? await resolveBatchProductPrices({
            companyId: context.companyId,
            items: confirmedToPrice.map(m => ({
              productId: m.product.id,
              quantity: m.quantity,
              priceType: price_type
            }))
          })
        : { items: [], allConfirmed: true }

      let sumCents = 0
      let allConfirmed = true
      const pricedItems: Array<{
        productId: string
        sku?: string | null
        name: string
        quantity: number
        unit?: string
        unitPrice: number
        subtotal: number
        unitPriceCents: number
        subtotalCents: number
        priceType?: string
        appliedRule?: string
        isPriceConfirmed: boolean
        status: 'confirmed' | 'pending' | 'unavailable'
        pendingReason?: string
      }> = []

      for (const m of matchedProducts) {
        if (m.isUnconfirmed) {
          allConfirmed = false
          pricedItems.push({
            productId: m.product.id,
            sku: m.product.sku,
            name: m.product.name,
            quantity: m.requestedQuantity,
            unit: m.requestedUnit,
            unitPrice: 0,
            subtotal: 0,
            unitPriceCents: 0,
            subtotalCents: 0,
            priceType: 'pending',
            isPriceConfirmed: false,
            status: 'pending',
            pendingReason: m.unconfirmedReason
          })
          continue
        }

        const priceItem = batchResult.items.find(pi => pi.productId === m.product.id)
        const isConfirmed = priceItem?.status === 'confirmed' && (priceItem.unitPriceCents > 0 || priceItem.unitPrice > 0)
        const unitPriceCents = priceItem?.unitPriceCents ?? Math.round((priceItem?.unitPrice || 0) * 100)
        const subtotalCents = priceItem?.subtotalCents ?? (unitPriceCents * m.quantity)
        const unitPrice = unitPriceCents / 100
        const subtotal = subtotalCents / 100

        if (isConfirmed) {
          sumCents += subtotalCents
        } else {
          allConfirmed = false
        }

        pricedItems.push({
          productId: m.product.id,
          sku: m.product.sku,
          name: m.product.name,
          quantity: m.quantity,
          unit: m.product.unit || 'UN',
          unitPrice,
          subtotal,
          unitPriceCents,
          subtotalCents,
          priceType: priceItem?.priceType || price_type || 'retail',
          appliedRule: priceItem?.appliedRule,
          isPriceConfirmed: isConfirmed,
          status: isConfirmed ? 'confirmed' : 'pending'
        })
      }

      return {
        success: true,
        data: {
          strategy: 'multi_product_pricing',
          items: pricedItems,
          products: pricedItems.map(i => ({
            id: i.productId,
            name: i.name,
            sku: i.sku,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
            price: { unit_price: i.unitPrice, subtotal: i.subtotal }
          })),
          total: sumCents / 100,
          total_confirmed_cents: sumCents,
          all_prices_confirmed: allConfirmed,
          consultative_hint: `Localizei ${pricedItems.length} produtos e calculei os preços correspondentes. Valor parcial confirmado: R$ ${(sumCents / 100).toFixed(2)}.`
        }
      }
    }

    const parsedQuery = parseQuery(effectiveQuery)
    const structuredParsed = parseStructuredQuery(effectiveQuery)
    const isWholesaleReq = structuredParsed.saleUnit === 'CX' || structuredParsed.saleUnit === 'FD' || structuredParsed.saleUnit === 'PC'

    const searchResult = await searchProducts(context.companyId, effectiveQuery, 12)

    // Se o cliente pediu outra marca e temos a marca anterior identificada para exclusão
    if (refResolution.excludeBrand && searchResult.matches.length > 0) {
      const excl = refResolution.excludeBrand.toLowerCase()
      const nonExcluded = searchResult.matches.filter(m => {
        const b = (m.brand || '').toLowerCase()
        const n = (m.name || '').toLowerCase()
        return !b.includes(excl) && !n.includes(excl)
      })
      if (nonExcluded.length > 0) {
        searchResult.matches = nonExcluded
      }
    }

    // Validação estrita de fator de embalagem para produto único/exato
    if (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1)) {
      const bestProduct = searchResult.matches[0]
      const isProdUn = (bestProduct.unit || 'UN').toUpperCase() === 'UN'
      const pkgFactor = bestProduct.packageFactor ?? (bestProduct.packageDescription ? extractProductPackageFactor(bestProduct).factor : null)

      // Se o cliente pediu caixa/fardo e o produto é vendido por UN sem fator confirmado
      if (isWholesaleReq && isProdUn && (!pkgFactor || pkgFactor <= 1)) {
        return {
          success: true,
          data: {
            strategy: 'unconfirmed_package_factor',
            status: 'pending',
            product: {
              id: bestProduct.id,
              name: bestProduct.name,
              unit: bestProduct.unit
            },
            consultative_hint: `Consta em nosso catálogo o **${bestProduct.name}**, mas não temos cadastrada a quantidade de unidades que vem na ${structuredParsed.saleUnit === 'CX' ? 'caixa' : 'embalagem'} fechada. Você saberia informar quantas unidades vêm na caixa que você precisa, ou prefere cotar em unidades avulsas? 😊`,
            differentiatingQuestion: `Você saberia informar quantas unidades vêm na ${structuredParsed.saleUnit === 'CX' ? 'caixa' : 'embalagem'} fechada ou prefere cotar em unidades avulsas?`,
            requiresHumanValidation: true
          }
        }
      }
    }

    // Resolução individual de preços para os candidatos retornados (máximo 10)
    const candidatePrices = new Map<string, { unit_price: number, subtotal: number }>()
    const candidateErrors = new Map<string, string>()

    if (searchResult.matches && searchResult.matches.length > 0) {
      const targetMatches = searchResult.matches.slice(0, 10)
      const batchResult = await resolveBatchProductPrices({
        companyId: context.companyId,
        items: targetMatches.map(prod => {
          const isProdUn = (prod.unit || 'UN').toUpperCase() === 'UN'
          const factor = prod.packageFactor ?? (prod.packageDescription ? extractProductPackageFactor(prod).factor : null)
          const effQty = (isWholesaleReq && isProdUn && factor && factor > 1)
            ? quantity * factor
            : quantity
          return {
            productId: prod.id,
            quantity: effQty,
            priceType: price_type
          }
        })
      })

      for (const item of batchResult.items) {
        if (item.status === 'confirmed') {
          candidatePrices.set(item.productId, {
            unit_price: item.unitPrice,
            subtotal: item.subtotal
          })
        } else {
          candidateErrors.set(item.productId, item.unavailableReason || 'Produto não possui preço configurado ou está indisponível.')
        }
      }
    }

    let pricingData: any = undefined
    let hasPricingError = false
    let pricingErrorMessage = ''

    if (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1)) {
      const bestProduct = searchResult.matches[0]
      const resolved = candidatePrices.get(bestProduct.id)
      if (resolved) {
        pricingData = resolved
      } else {
        hasPricingError = true
        pricingErrorMessage = candidateErrors.get(bestProduct.id) || 'Produto não possui preço configurado ou está indisponível.'
      }
    }

    const strategyPayload = applyCommercialStrategy(
      effectiveQuery,
      searchResult,
      quantity,
      pricingData,
      candidatePrices,
      refResolution,
      parsedQuery
    )

    if (hasPricingError && (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1))) {
      return {
        success: false,
        error: `Falha ao calcular preco: ${pricingErrorMessage}`,
        data: strategyPayload
      }
    }

    return {
      success: true,
      data: strategyPayload
    }
  }
}