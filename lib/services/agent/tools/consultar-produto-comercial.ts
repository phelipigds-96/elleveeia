import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { searchProducts, extractProductPackageFactor } from '../../catalog/products'
import { parseQuery } from '../../catalog/search-logic'
import { splitMultiProductQuery, parseStructuredQuery } from '../../catalog/query-parser'
import { resolveProductPrice, resolveBatchProductPrices, resolveProductPriceTiers } from '../../commercial/pricing'
import { applyCommercialStrategy, resolveReferenceQuery } from '../commercial-strategy'

export const consultarProdutoComercialTool: ToolDefinition = {
  name: 'consultar_produto_comercial',
  description: 'Busca produto e calcula preco numa unica etapa. Se a consulta for ampla (apenas marca ou termo geral), utilize as orientações consultivas retornadas para qualificar a necessidade do cliente antes de listar produtos desnecessários. Se "not_found", diga que nao achou (nao presuma estoque). Se "ambiguous", peca para esclarecer.',
  metadata: { category: 'commercial', capabilities: ['product.search', 'price.calculate'] },
  schema: z.object({
    product_query: z.string().describe('Termo buscado ou nome do produto.'),
    quantity: z.number().int().positive().optional().describe('Qtd desejada (padrao 1).'),
    unit: z.string().optional().describe('OBRIGATÓRIO sempre que o cliente mencionar embalagem: "caixa", "cx", "fardo", "fd", "pacote", "unidade". NUNCA omita quando o cliente disser caixa, fardo ou pacote; o sistema converte automaticamente para o fator da embalagem.'),
    price_type: z.string().optional().describe('Tipo de preco (retail/wholesale/club). Deixe vazio p/ regra automatica.')
  }),
  execute: async (input, context) => {
    const { product_query, unit, price_type } = input
    let quantity = input.quantity ?? 1
    
    // Normalização da unidade informada explicitamente
    const normUnit = (unit || '').toLowerCase().trim()
    const isWholesaleFromInput = /^(?:cx|caixa|caixas|fardo|fardos|fd|display|displays)$/i.test(normUnit)
    const isPackFromInput = /^(?:pacote|pacotes|pct|pc)$/i.test(normUnit)
    const isUnitFromInput = /^(?:un|und|unidade|unidades|lata|latas|garrafa|garrafas)$/i.test(normUnit)

    let forcedSaleUnit: 'UN' | 'CX' | 'FD' | 'PC' | undefined = isWholesaleFromInput
      ? (/^(?:fd|fardo|fardos)$/i.test(normUnit) ? 'FD' : 'CX')
      : isPackFromInput
      ? 'PC'
      : isUnitFromInput
      ? 'UN'
      : undefined

    // Defesa em profundidade no backend: se a LLM omitir unit ou quantity mas a mensagem do cliente
    // neste turno for de item único com caixa/fardo explícito, herda do parser determinístico da mensagem
    if (context.currentUserMessage && !forcedSaleUnit) {
      const msgSubQueries = splitMultiProductQuery(context.currentUserMessage)
      if (msgSubQueries.length === 1) {
        const msgParsed = parseStructuredQuery(context.currentUserMessage)
        if (msgParsed.saleUnit === 'CX' || msgParsed.saleUnit === 'FD') {
          forcedSaleUnit = msgParsed.saleUnit
          if (input.quantity === undefined && msgParsed.quantity > 1) {
            quantity = msgParsed.quantity
          }
        }
      }
    }

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
          const isWholesaleReq = part.parsed.saleUnit === 'CX' || part.parsed.saleUnit === 'FD'
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
        requestedQuantity?: number
        requestedUnit?: string
        packageFactor?: number | null
        internalQuantity?: number
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
          requestedQuantity: m.requestedQuantity,
          requestedUnit: m.requestedUnit,
          packageFactor: m.packageFactor,
          internalQuantity: m.quantity,
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
            requestedQuantity: (i as any).requestedQuantity,
            requestedUnit: (i as any).requestedUnit,
            packageFactor: (i as any).packageFactor,
            internalQuantity: (i as any).internalQuantity,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
            price: { unit_price: i.unitPrice, subtotal: i.subtotal }
          })),
          total: sumCents / 100,
          total_confirmed_cents: sumCents,
          all_prices_confirmed: allConfirmed,
          consultative_hint: `Localizei os ${pricedItems.length} produtos e calculei os preços oficiais: ${pricedItems.map(p => `${(p as any).requestedQuantity ?? p.quantity} ${(p as any).requestedUnit ?? p.unit} de ${p.name} = R$ ${p.subtotal.toFixed(2)}`).join(' + ')}. Total: R$ ${(sumCents / 100).toFixed(2)}.`
        }
      }
    }

    const parsedQuery = parseQuery(effectiveQuery)
    const structuredParsed = parseStructuredQuery(effectiveQuery)
    const msgParsed = context.currentUserMessage ? parseStructuredQuery(context.currentUserMessage) : null
    const isPriceTierComparison = Boolean(
      structuredParsed.isPriceTierComparison ||
      msgParsed?.isPriceTierComparison ||
      /\bvarejo\b/i.test(normUnit) && /\batacado\b/i.test(normUnit)
    )
    if (isPriceTierComparison) {
      structuredParsed.isPriceTierComparison = true
    }
    if (forcedSaleUnit) {
      structuredParsed.saleUnit = forcedSaleUnit
    }
    const isWholesaleReq = !isPriceTierComparison && (
      structuredParsed.saleUnit === 'CX' ||
      structuredParsed.saleUnit === 'FD' ||
      /\b(?:caixas?|cx|fardos?|fd)\b/i.test(effectiveQuery)
    )

    const searchResult = await searchProducts(context.companyId, effectiveQuery, 12, {
      forcedSaleUnit,
      isPriceTierComparison
    })

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

    // Validação estrita de fator de embalagem e conversão para produto único/exato
    let singlePkgFactor: number | null = null
    let hasPackagingConversion = false
    let effectiveBaseQty = quantity

    if (searchResult.status === 'exact_match' || (searchResult.matches && searchResult.matches.length === 1)) {
      const bestProduct = searchResult.matches[0]
      const isProdUn = (bestProduct.unit || 'UN').toUpperCase() === 'UN'
      singlePkgFactor = bestProduct.packageFactor ?? (bestProduct.packageDescription ? extractProductPackageFactor(bestProduct).factor : null)

      // Se o cliente pediu caixa/fardo e o produto é vendido por UN sem fator confirmado
      if (isWholesaleReq && isProdUn && (!singlePkgFactor || singlePkgFactor <= 1)) {
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

      if (isWholesaleReq && isProdUn && singlePkgFactor && singlePkgFactor > 1) {
        hasPackagingConversion = true
        effectiveBaseQty = quantity * singlePkgFactor
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
      effectiveBaseQty,
      pricingData,
      candidatePrices,
      refResolution,
      parsedQuery
    )

    const fmtBRL = (v: number) => v.toFixed(2).replace('.', ',')

    if (isPriceTierComparison && searchResult.matches && searchResult.matches.length > 0) {
      const targetMatches = searchResult.matches.slice(0, 5)
      const tiersMap = await resolveProductPriceTiers({
        companyId: context.companyId,
        productIds: targetMatches.map(m => m.id)
      })

      const packageCandidates = targetMatches
        .map(m => {
          const factor = m.packageFactor ?? (m.packageDescription ? extractProductPackageFactor(m).factor : null)
          return factor && factor > 1 ? { prod: m, factor } : null
        })
        .filter((x): x is { prod: any; factor: number } => Boolean(x))

      const packagePrices = new Map<string, { unit_price: number; subtotal: number; factor: number }>()
      if (packageCandidates.length > 0) {
        const pkgBatch = await resolveBatchProductPrices({
          companyId: context.companyId,
          items: packageCandidates.map(pc => ({
            productId: pc.prod.id,
            quantity: pc.factor
          }))
        })
        for (const item of pkgBatch.items) {
          if (item.status === 'confirmed') {
            const matched = packageCandidates.find(pc => pc.prod.id === item.productId)
            if (matched) {
              packagePrices.set(item.productId, {
                unit_price: item.unitPrice,
                subtotal: item.subtotal,
                factor: matched.factor
              })
            }
          }
        }
      }

      const buildTierSummary = (prod: any) => {
        const rawTiers = tiersMap.get(prod.id) || []
        const formattedTiers = rawTiers.map(t => ({
          price_type: t.priceType,
          min_quantity: t.minQuantity,
          max_quantity: t.effectiveMaxQuantity,
          unit_price: t.price
        }))
        const pkg = packagePrices.get(prod.id)
        const isFardo = /\b(?:fd|fardo)\b/i.test(prod.name || '') || /\bfardo\b/i.test(prod.packageDescription || '')
        const packLabel = isFardo ? 'Fardo' : 'Caixa'
        const packageOption = pkg
          ? {
              unit_label: packLabel,
              units_per_package: pkg.factor,
              unit_price: pkg.unit_price,
              package_total: pkg.subtotal
            }
          : null

        const lines: string[] = []
        for (const t of formattedTiers) {
          if (t.price_type === 'retail') {
            const rangeText = t.max_quantity != null
              ? `de ${t.min_quantity} a ${t.max_quantity} unidades`
              : `a partir de ${t.min_quantity} unidade(s)`
            lines.push(`• Varejo (${rangeText}): R$ ${fmtBRL(t.unit_price)} por unidade`)
          } else if (t.price_type === 'wholesale') {
            const rangeText = t.max_quantity != null
              ? `de ${t.min_quantity} a ${t.max_quantity} unidades`
              : `a partir de ${t.min_quantity} unidades`
            lines.push(`• Atacado (${rangeText}): R$ ${fmtBRL(t.unit_price)} por unidade`)
          }
        }
        if (packageOption) {
          lines.push(`• ${packageOption.unit_label} fechado com ${packageOption.units_per_package} unidades: R$ ${fmtBRL(packageOption.package_total)} (R$ ${fmtBRL(packageOption.unit_price)}/un)`)
        }
        return { formattedTiers, packageOption, summaryLines: lines }
      }

      if (strategyPayload.product) {
        const best = searchResult.matches[0]
        const { formattedTiers, packageOption, summaryLines } = buildTierSummary(best)
        strategyPayload.strategy = 'price_tier_comparison'
        strategyPayload.price_tiers = formattedTiers
        if (packageOption) strategyPayload.package_option = packageOption
        if (summaryLines.length > 0) {
          strategyPayload.consultative_hint = `Localizei o **${best.name}**. Apresente todas as modalidades oficiais de preço abaixo com clareza:\n${summaryLines.join('\n')}`
        }
      } else if (Array.isArray(strategyPayload.products) && strategyPayload.products.length > 0) {
        const hints: string[] = []
        strategyPayload.products = strategyPayload.products.map((pItem: any) => {
          const matchObj = targetMatches.find(m => m.id === pItem.id) || pItem
          const { formattedTiers, packageOption, summaryLines } = buildTierSummary(matchObj)
          if (summaryLines.length > 0) {
            hints.push(`**${pItem.name}**:\n${summaryLines.join('\n')}`)
          }
          return {
            ...pItem,
            price_tiers: formattedTiers,
            ...(packageOption ? { package_option: packageOption } : {})
          }
        })
        if (hints.length > 0) {
          strategyPayload.consultative_hint = `Apresente claramente as faixas de varejo, atacado e embalagem fechada retornadas abaixo:\n${hints.join('\n\n')}`
        }
      }
    }

    // Enriquece strategyPayload com metadados de embalagem e conversão para a Working Memory
    strategyPayload.requested_quantity = quantity
    strategyPayload.requested_unit = isWholesaleReq ? (structuredParsed.saleUnit || 'CX') : (unit || 'UN')
    strategyPayload.package_factor = singlePkgFactor
    strategyPayload.base_quantity = effectiveBaseQty
    strategyPayload.base_unit = searchResult.matches[0]?.unit || 'UN'
    if (hasPackagingConversion && searchResult.matches[0] && singlePkgFactor) {
      const best = searchResult.matches[0]
      const unitPrice = pricingData?.unit_price || 0
      const subtotal = pricingData?.subtotal || 0
      const packagePrice = Math.round((unitPrice * singlePkgFactor) * 100) / 100
      strategyPayload.packaging_conversion = {
        requested_quantity: quantity,
        requested_unit: strategyPayload.requested_unit,
        package_factor: singlePkgFactor,
        total_units: effectiveBaseQty,
        unit_price: unitPrice,
        package_price: packagePrice,
        subtotal
      }
      const isFD = strategyPayload.requested_unit === 'FD'
      const packSingular = isFD ? 'fardo' : 'caixa'
      const packPlural = isFD ? 'fardos' : 'caixas'
      const packLabel = quantity === 1 ? packSingular : packPlural
      const qtyPhrase = quantity === 1
        ? `1 ${packSingular}, com ${singlePkgFactor} unidades, ficando R$ ${fmtBRL(subtotal)} (R$ ${fmtBRL(unitPrice)} por unidade)`
        : `${quantity} ${packPlural}, com ${singlePkgFactor} unidades cada (R$ ${fmtBRL(packagePrice)} por ${packSingular}), totalizando ${effectiveBaseQty} unidades. O valor é R$ ${fmtBRL(unitPrice)} por unidade, ficando R$ ${fmtBRL(subtotal)} pelas ${quantity} ${packPlural}`
      const activeQuoteHint = context.workingMemory?.activeQuote?.id
        ? ' Como já existe um orçamento ativo nesta conversa e o cliente pediu para acrescentar/incluir este item, chame agora a ferramenta gerar_orcamento para atualizar o orçamento para a nova versão com todos os itens do carrinho.'
        : ' Apresente exatamente essa distinção entre preço unitário, preço por embalagem e total do pedido, e pergunte se deseja confirmar.'
      strategyPayload.consultative_hint = `Localizei o **${best.name}**. São ${qtyPhrase}.${activeQuoteHint}`
    } else if (isWholesaleReq && Array.isArray(strategyPayload.products) && strategyPayload.products.length > 0) {
      const isFD = strategyPayload.requested_unit === 'FD'
      const packSingular = isFD ? 'fardo' : 'caixa'
      const packPlural = isFD ? 'fardos' : 'caixas'
      const packLabel = quantity === 1 ? packSingular : packPlural
      const optionLines: string[] = []

      strategyPayload.products = strategyPayload.products.map((pItem: any) => {
        const matchObj = searchResult.matches.find(m => m.id === pItem.id)
        const factor = matchObj?.packageFactor ?? (matchObj?.packageDescription ? extractProductPackageFactor(matchObj).factor : null)
        if (factor && factor > 1 && pItem.price) {
          const totalUnits = quantity * factor
          const unitPrice = pItem.price.unit_price || 0
          const packagePrice = Math.round((unitPrice * factor) * 100) / 100
          const subtotal = pItem.price.subtotal || Math.round((unitPrice * totalUnits) * 100) / 100
          optionLines.push(
            `• **${pItem.name}**: R$ ${fmtBRL(unitPrice)}/un | R$ ${fmtBRL(packagePrice)} por ${packSingular} (${factor} un) | Total para ${quantity} ${packLabel} (${totalUnits} un): R$ ${fmtBRL(subtotal)}`
          )
          return {
            ...pItem,
            requested_quantity: quantity,
            requested_unit: strategyPayload.requested_unit,
            package_factor: factor,
            total_units: totalUnits,
            price: {
              ...pItem.price,
              package_price: packagePrice,
              subtotal
            }
          }
        }
        return pItem
      })

      if (optionLines.length > 0) {
        strategyPayload.consultative_hint = `O cliente solicitou ${quantity} ${packLabel} e existem múltiplas variantes no catálogo. NUNCA confunda o valor de ${quantity} ${packLabel} com o valor de 1 ${packSingular}. Apresente as opções distinguindo preço unitário, preço por ${packSingular} e total para ${quantity} ${packLabel}:\n${optionLines.join('\n')}`
      }
    }

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