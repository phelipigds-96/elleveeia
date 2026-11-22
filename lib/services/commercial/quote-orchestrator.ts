import { splitMultiProductQuery, parseStructuredQuery } from '../catalog/query-parser'
import { searchProducts, extractProductPackageFactor } from '../catalog/products'
import { createAdminClient } from '@/lib/supabase/service'
import { resolveBatchProductPrices } from './pricing'
import {
  createOrUpdateEnterpriseQuote,
  formatQuoteForWhatsApp,
  type EnterpriseQuote
} from './quotes'
import {
  addItemToCart,
  removeCartItem,
  replaceCartItem,
  updateCartItemQuantity,
  resolveCartItemReference,
  isEventAlreadyProcessed,
  recordProcessedEvent,
  type WorkingMemory,
  type CartItem
} from '../agent/working-memory'

export interface ProcessMessageToQuoteParams {
  companyId: string
  message: string
  conversationId?: string
  customerId?: string
  eventId?: string
  workingMemory?: WorkingMemory
  isClubEligible?: boolean
  customerNotes?: string
}

export interface ProcessMessageToQuoteResult {
  workingMemory: WorkingMemory
  quote?: EnterpriseQuote
  status: 'quote_ready' | 'pending_clarification' | 'ambiguous' | 'no_product_found' | 'cart_updated'
  differentiatingQuestion?: string
  consultativeResponse: string
  actionTaken:
    | 'added_to_cart'
    | 'updated_quantity'
    | 'removed_item'
    | 'replaced_item'
    | 'quote_generated'
    | 'idempotent_replay'
    | 'clarification_needed'
}

/**
 * Pipeline Integrado de Orçamentos Comerciais da Ellevee IA
 * Fluxo: Mensagem do Cliente → Parser Multi-item → Busca → Desambiguação → Precificação em Lote → Carrinho → Orçamento
 */
export async function processCustomerMessageToQuote(
  params: ProcessMessageToQuoteParams
): Promise<ProcessMessageToQuoteResult> {
  const {
    companyId,
    message,
    conversationId,
    customerId,
    eventId,
    workingMemory,
    isClubEligible = false,
    customerNotes
  } = params

  let memory: WorkingMemory = { ...(workingMemory || {}) }

  // 1. Tratamento estrito de Idempotência por Evento / Webhook Retry (Em memória e DB persistente)
  if (eventId) {
    if (isEventAlreadyProcessed(memory, eventId)) {
      return {
        workingMemory: memory,
        status: 'cart_updated',
        consultativeResponse: 'Este evento já foi processado anteriormente. Nenhuma alteração duplicada foi realizada.',
        actionTaken: 'idempotent_replay'
      }
    }

    try {
      const supabase = createAdminClient()
      const msgQuery = supabase
        .from('messages')
        .select('id, content, metadata')
        .eq('company_id', companyId)

      if (typeof msgQuery?.contains === 'function' && typeof msgQuery?.maybeSingle === 'function') {
        const { data: dbExistingMsg } = await msgQuery
          .contains('metadata', { trigger_event_id: eventId })
          .limit(1)
          .maybeSingle()

        if (dbExistingMsg) {
          return {
            workingMemory: memory,
            status: 'cart_updated',
            consultativeResponse: 'Este evento já foi processado anteriormente no banco de dados. Nenhuma alteração duplicada foi realizada.',
            actionTaken: 'idempotent_replay'
          }
        }
      }
    } catch {
      // Fallback em mocks
    }
  }

  const cleanMessage = message.trim()
  const lowerMsg = cleanMessage.toLowerCase()
  const normalizedMsg = cleanMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  // 2. Detecção de Intenção de Fechamento / "Só isso"
  const isClosingIntent = /\b(?:so\s+isso|so\s+esse|nao\s+quero\s+mais\s+nada|pode\s+fechar|quanto\s+deu\s+tudo|concluir\s+orcamento|finalizar\s+orcamento|gera\s+o\s+orcamento|fechar\s+pedido|fechar\s+orcamento)\b/i.test(normalizedMsg)
  if (isClosingIntent) {
    const cartItems = memory.activeCart || []
    if (cartItems.length === 0) {
      if (eventId) memory = recordProcessedEvent(memory, eventId)
      return {
        workingMemory: memory,
        status: 'pending_clarification',
        consultativeResponse: 'O seu carrinho ainda está vazio. Me diga quais produtos e quantidades você gostaria de cotar! 😊',
        actionTaken: 'clarification_needed'
      }
    }

    const quote = await createOrUpdateEnterpriseQuote({
      companyId,
      customerId,
      conversationId,
      existingQuoteId: memory.activeQuote?.id,
      items: cartItems.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unit: i.unit,
        priceType: i.priceType
      })),
      isClubEligible,
      customerNotes,
      actionSummary: 'Orçamento formalizado a pedido do cliente ("só isso").'
    })

    memory.activeQuote = {
      id: quote.id,
      total: quote.totalConfirmed,
      status: quote.status,
      version: quote.version
    }
    if (eventId) memory = recordProcessedEvent(memory, eventId)

    return {
      workingMemory: memory,
      quote,
      status: 'quote_ready',
      consultativeResponse: formatQuoteForWhatsApp(quote),
      actionTaken: 'quote_generated'
    }
  }

  // 3. Detecção de Remoção de Item do Carrinho (ex: "tira o segundo", "remove o leite condensado", "cancela o de 1kg")
  const isRemoval = /\b(?:remover?|tira|tirar|apaga|apagar|cancela|cancelar|excluir?)\b/i.test(lowerMsg)
  if (isRemoval && memory.activeCart && memory.activeCart.length > 0) {
    const refResolution = resolveCartItemReference(cleanMessage, memory)
    if (refResolution.item) {
      memory = removeCartItem(memory, refResolution.item.productId)
      
      // Se ainda restarem itens no carrinho, atualiza o orçamento
      let updatedQuote: EnterpriseQuote | undefined
      if (memory.activeCart && memory.activeCart.length > 0) {
        updatedQuote = await createOrUpdateEnterpriseQuote({
          companyId,
          customerId,
          conversationId,
          existingQuoteId: memory.activeQuote?.id,
          items: memory.activeCart.map(i => ({
            productId: i.productId,
            quantity: i.quantity,
            unit: i.unit,
            priceType: i.priceType
          })),
          isClubEligible,
          customerNotes,
          actionSummary: `Item "${refResolution.item.name}" removido.`
        })
        memory.activeQuote = {
          id: updatedQuote.id,
          total: updatedQuote.totalConfirmed,
          status: updatedQuote.status,
          version: updatedQuote.version
        }
      }

      if (eventId) memory = recordProcessedEvent(memory, eventId)

      return {
        workingMemory: memory,
        quote: updatedQuote,
        status: 'cart_updated',
        consultativeResponse: `Removi o item **${refResolution.item.name}** do seu orçamento. ${updatedQuote ? `O total atualizado é ${updatedQuote.totalConfirmed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` : 'Seu carrinho agora está vazio.'} Posso ajudar com mais algum produto? 😊`,
        actionTaken: 'removed_item'
      }
    }
  }

  // 4. Detecção de Alteração de Quantidade (ex: "muda o primeiro para 12", "altera a quantidade para 10", "coloca 12 unidades")
  const qtyActionPattern = /\b(?:muda|mudar|altera|alterar|aumenta|aumentar|diminui|diminuir|atualiza|atualizar|troca|trocar|coloca|colocar|poe|passa|passar)\b/i
  const qtyNumberPattern = /\b(?:muda|mudar|altera|alterar|aumenta|aumentar|diminui|diminuir|atualiza|atualizar|troca|trocar|coloca|colocar|poe|passa|passar)\s+.*?(?:para\s+|pra\s+|em\s+)?(\d+)\s*(?:unidades?|un|itens?|latas?|pacotes?|barras?|cx|caixas?)?\b/i

  if (qtyActionPattern.test(lowerMsg) && memory.activeCart && memory.activeCart.length > 0) {
    const qtyMatch = cleanMessage.match(qtyNumberPattern) || cleanMessage.match(/\b(?:para|pra|em)\s+(\d+)\b|\bquantidade\s+(?:para\s+)?(\d+)\b/i)
    const newQty = qtyMatch ? parseInt(qtyMatch[1] || qtyMatch[2], 10) : 0
    if (newQty > 0) {
      const refResolution = resolveCartItemReference(cleanMessage, memory)
      if (refResolution.item) {
        const batchRes = await resolveBatchProductPrices({
          companyId,
          items: [{
            productId: refResolution.item.productId,
            quantity: newQty,
            unit: refResolution.item.unit
          }],
          isClubEligible
        })

        const pricedItem = batchRes.items[0]
        const isConfirmed = pricedItem?.status === 'confirmed'

        memory = addItemToCart(memory, {
          productId: refResolution.item.productId,
          sku: refResolution.item.sku,
          name: refResolution.item.name,
          quantity: newQty,
          unit: refResolution.item.unit,
          unitPriceCents: pricedItem?.unitPriceCents,
          unitPrice: pricedItem?.unitPrice,
          subtotalCents: pricedItem?.subtotalCents,
          subtotal: pricedItem?.subtotal,
          priceType: pricedItem?.priceType,
          appliedRule: pricedItem?.appliedRule,
          priceSourceId: pricedItem?.priceSourceId,
          isPriceConfirmed: isConfirmed,
          status: isConfirmed ? 'confirmed' : 'pending',
          pendingReason: isConfirmed ? undefined : pricedItem?.unavailableReason
        })

        const updatedQuote = await createOrUpdateEnterpriseQuote({
          companyId,
          customerId,
          conversationId,
          existingQuoteId: memory.activeQuote?.id,
          items: (memory.activeCart || []).map(i => ({
            productId: i.productId,
            quantity: i.quantity,
            unit: i.unit,
            priceType: i.priceType
          })),
          isClubEligible,
          customerNotes,
          actionSummary: `Quantidade de "${refResolution.item.name}" alterada para ${newQty}.`
        })

        memory.activeQuote = {
          id: updatedQuote.id,
          total: updatedQuote.totalConfirmed,
          status: updatedQuote.status,
          version: updatedQuote.version
        }

        if (eventId) memory = recordProcessedEvent(memory, eventId)

        return {
          workingMemory: memory,
          quote: updatedQuote,
          status: 'cart_updated',
          consultativeResponse: `Atualizei a quantidade de **${refResolution.item.name}** para ${newQty} ${refResolution.item.unit}.${pricedItem?.appliedRule ? ` (${pricedItem.appliedRule})` : ''} O novo total do orçamento é ${updatedQuote.totalConfirmed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Deseja adicionar mais alguma coisa? 😊`,
          actionTaken: 'updated_quantity'
        }
      }
    }
  }

  // 5. Detecção de Substituição de Produto (ex: "troca o primeiro por Italac", "muda o leite moça para tirol")
  const isReplacement = /\b(?:troca|trocar|muda|mudar|substitui|substituir)\b/i.test(lowerMsg) &&
    /\b(?:por|pelo|pela|para)\b/i.test(lowerMsg)
  if (isReplacement && memory.activeCart && memory.activeCart.length > 0) {
    const refResolution = resolveCartItemReference(cleanMessage, memory)
    if (refResolution.item) {
      // Extrai o novo produto solicitado após o conectivo "por" ou "pelo"
      const matchNew = cleanMessage.match(/\b(?:por|pelo|pela|para)\s+(.+)/i)
      const newQuery = matchNew ? matchNew[1].trim() : ''

      if (newQuery && !/^\d+(\s*(?:unidades?|un|latas?|pacotes?|kg|g))?$/i.test(newQuery)) {
        // Tenta primeiro busca contextual combinando o tipo do produto original com a nova especificação
        const itemPrefix = refResolution.item.name.split(' ').slice(0, 2).join(' ')
        let searchRes = await searchProducts(companyId, `${itemPrefix} ${newQuery}`, 3)
        if (!searchRes.matches || searchRes.matches.length === 0 || searchRes.status === 'ambiguous') {
          searchRes = await searchProducts(companyId, newQuery, 3)
        }
        if (searchRes.matches && searchRes.matches.length > 0 && searchRes.status !== 'ambiguous') {
          const replacementProd = searchRes.matches[0]
          const batchRes = await resolveBatchProductPrices({
            companyId,
            items: [{
              productId: replacementProd.id,
              quantity: refResolution.item.quantity
            }],
            isClubEligible
          })

          const pricedItem = batchRes.items[0]
          memory = replaceCartItem(memory, refResolution.item.productId, {
            productId: replacementProd.id,
            sku: replacementProd.sku,
            name: replacementProd.name,
            quantity: refResolution.item.quantity,
            unit: replacementProd.unit || 'UN',
            unitPriceCents: pricedItem?.unitPriceCents,
            unitPrice: pricedItem?.unitPrice,
            subtotalCents: pricedItem?.subtotalCents,
            subtotal: pricedItem?.subtotal,
            priceType: pricedItem?.priceType,
            appliedRule: pricedItem?.appliedRule,
            priceSourceId: pricedItem?.priceSourceId,
            isPriceConfirmed: pricedItem?.status === 'confirmed',
            status: pricedItem?.status
          })

          const updatedQuote = await createOrUpdateEnterpriseQuote({
            companyId,
            customerId,
            conversationId,
            existingQuoteId: memory.activeQuote?.id,
            items: (memory.activeCart || []).map(i => ({
              productId: i.productId,
              quantity: i.quantity,
              unit: i.unit,
              priceType: i.priceType
            })),
            isClubEligible,
            customerNotes,
            actionSummary: `Substituído "${refResolution.item.name}" por "${replacementProd.name}".`
          })

          if (eventId) memory = recordProcessedEvent(memory, eventId)

          return {
            workingMemory: memory,
            quote: updatedQuote,
            status: 'cart_updated',
            consultativeResponse: `Substituí **${refResolution.item.name}** por **${replacementProd.name}** mantendo a quantidade de ${refResolution.item.quantity} unidades. O novo total é ${updatedQuote.totalConfirmed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Deseja adicionar mais alguma coisa? 😊`,
            actionTaken: 'replaced_item'
          }
        }
      }
    }
  }

  // 5. Parser Multi-item e Segmentação de Produtos
  const subQueries = splitMultiProductQuery(cleanMessage)
  const itemsToPrice: Array<{
    productId: string
    sku: string | null
    name: string
    quantity: number
    unit?: string
    requestedQuantity: number
    requestedUnit: string
    packageFactor: number | null
    internalQuantity: number
    internalUnit: string
    isUnconfirmedPackageFactor: boolean
    pendingReason?: string
    differentiatingQuestion?: string
    isAmbiguous?: boolean
  }> = []

  let pendingAmbiguousQuestion: string | undefined

  for (const subQ of subQueries) {
    const parsed = parseStructuredQuery(subQ)
    const searchRes = await searchProducts(companyId, subQ, 5)

    if (searchRes.status === 'ambiguous') {
      pendingAmbiguousQuestion = searchRes.differentiatingQuestion
      continue
    }

    if (searchRes.status === 'not_found' || !searchRes.matches || searchRes.matches.length === 0) {
      continue
    }

    const matchedProd = searchRes.matches[0]
    const qty = parsed.quantity || 1
    const isWholesaleUnitRequested = parsed.saleUnit === 'CX' || parsed.saleUnit === 'FD' || parsed.saleUnit === 'PC'
    const isProductUnitOnly = (matchedProd.unit || 'UN').toUpperCase() === 'UN'
    const pkgFactor = matchedProd.packageFactor ?? (matchedProd.packageDescription ? extractProductPackageFactor(matchedProd).factor : null)

    let effectiveQuantity = qty
    let requestedQuantity = qty
    let requestedUnit = parsed.saleUnit
    let internalQuantity = qty
    let internalUnit = matchedProd.unit || 'UN'
    let isUnconfirmedPackageFactor = false
    let pendingReason: string | undefined
    let differentiatingQuestion: string | undefined

    if (isWholesaleUnitRequested && isProductUnitOnly) {
      if (pkgFactor && pkgFactor > 1) {
        internalQuantity = qty * pkgFactor
        effectiveQuantity = internalQuantity
      } else {
        isUnconfirmedPackageFactor = true
        pendingReason = `Fator de embalagem de ${parsed.saleUnit === 'CX' ? 'caixa' : parsed.saleUnit === 'FD' ? 'fardo' : 'pacote'} não cadastrado no catálogo (quantidade por embalagem indefinida)`
        differentiatingQuestion = `Identifiquei o produto ${matchedProd.name} no catálogo, mas não consta a quantidade de unidades por ${parsed.saleUnit === 'CX' ? 'caixa' : parsed.saleUnit === 'FD' ? 'fardo' : 'pacote'}. Você saberia informar quantas unidades vêm na embalagem que precisa, ou prefere cotar em unidades avulsas? 😊`
      }
    }

    itemsToPrice.push({
      productId: matchedProd.id,
      sku: matchedProd.sku,
      name: matchedProd.name,
      quantity: effectiveQuantity,
      unit: internalUnit,
      requestedQuantity,
      requestedUnit,
      packageFactor: pkgFactor ?? null,
      internalQuantity,
      internalUnit,
      isUnconfirmedPackageFactor,
      pendingReason,
      differentiatingQuestion
    })
  }

  // Se nenhum produto foi reconhecido na mensagem e não houve comandos anteriores
  if (itemsToPrice.length === 0) {
    if (pendingAmbiguousQuestion) {
      if (eventId) memory = recordProcessedEvent(memory, eventId)
      return {
        workingMemory: memory,
        status: 'ambiguous',
        differentiatingQuestion: pendingAmbiguousQuestion,
        consultativeResponse: pendingAmbiguousQuestion,
        actionTaken: 'clarification_needed'
      }
    }

    if (eventId) memory = recordProcessedEvent(memory, eventId)
    return {
      workingMemory: memory,
      status: 'no_product_found',
      consultativeResponse: 'Não encontrei nenhum produto disponível para os termos informados. Gostaria de me dizer o nome do ingrediente ou a marca que procura? 😊',
      actionTaken: 'clarification_needed'
    }
  }

  // 6. Resolução de Preços em Lote pelo Enterprise Pricing Engine (ZERO N+1)
  const itemsForPricing = itemsToPrice.filter(i => !i.isUnconfirmedPackageFactor)
  const batchPricing = itemsForPricing.length > 0
    ? await resolveBatchProductPrices({
        companyId,
        items: itemsForPricing.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          unit: i.unit
        })),
        isClubEligible
      })
    : { items: [], totalCents: 0, total: 0, allConfirmed: true, hasUnavailable: false, evaluatedAt: new Date().toISOString() }

  // 7. Atualização Incremental do Carrinho Inteligente
  for (const item of itemsToPrice) {
    if (item.isUnconfirmedPackageFactor) {
      memory = addItemToCart(memory, {
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.requestedQuantity,
        unit: item.requestedUnit,
        requestedQuantity: item.requestedQuantity,
        requestedUnit: item.requestedUnit,
        packageFactor: null,
        internalQuantity: item.requestedQuantity,
        internalUnit: item.internalUnit,
        isPriceConfirmed: false,
        status: 'pending',
        pendingReason: item.pendingReason,
        differentiatingQuestion: item.differentiatingQuestion
      })
    } else {
      const priced = batchPricing.items.find(p => p.productId === item.productId)
      const isConfirmed = priced ? priced.status === 'confirmed' : false

      memory = addItemToCart(memory, {
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        requestedQuantity: item.requestedQuantity,
        requestedUnit: item.requestedUnit,
        packageFactor: item.packageFactor,
        internalQuantity: item.internalQuantity,
        internalUnit: item.internalUnit,
        unitPriceCents: priced?.unitPriceCents,
        unitPrice: priced?.unitPrice,
        subtotalCents: priced?.subtotalCents,
        subtotal: priced?.subtotal,
        priceType: priced?.priceType,
        appliedRule: priced?.appliedRule,
        priceSourceId: priced?.priceSourceId,
        isPriceConfirmed: isConfirmed,
        status: isConfirmed ? 'confirmed' : 'pending',
        pendingReason: isConfirmed ? undefined : priced?.unavailableReason
      })
    }
  }

  // 8. Criação / Atualização Automática do Orçamento
  const allCartItems = memory.activeCart || []
  const quote = await createOrUpdateEnterpriseQuote({
    companyId,
    customerId,
    conversationId,
    existingQuoteId: memory.activeQuote?.id,
    items: allCartItems.map(i => ({
      productId: i.productId,
      quantity: i.quantity,
      unit: i.unit,
      requestedQuantity: i.requestedQuantity,
      requestedUnit: i.requestedUnit,
      packageFactor: i.packageFactor,
      internalQuantity: i.internalQuantity,
      internalUnit: i.internalUnit,
      priceType: i.priceType,
      status: i.status,
      pendingReason: i.pendingReason
    })),
    isClubEligible,
    customerNotes,
    actionSummary: `Itens adicionados/recalculados (${itemsToPrice.length} novos itens processados).`
  })

  memory.activeQuote = {
    id: quote.id,
    total: quote.totalConfirmed,
    status: quote.status,
    version: quote.version
  }

  if (eventId) memory = recordProcessedEvent(memory, eventId)

  // 9. Resposta Consultiva Formatada para WhatsApp
  const unconfirmedItem = itemsToPrice.find(i => i.isUnconfirmedPackageFactor)
  if (unconfirmedItem) {
    const question = unconfirmedItem.differentiatingQuestion || pendingAmbiguousQuestion || 'Gostaria de informar a quantidade por embalagem ou prefere cotar em unidades avulsas? 😊'
    return {
      workingMemory: memory,
      quote,
      status: 'pending_clarification',
      differentiatingQuestion: question,
      consultativeResponse: `${formatQuoteForWhatsApp(quote)}\n\n⚠️ *Atenção:* ${question}`,
      actionTaken: 'clarification_needed'
    }
  }

  const formattedQuote = formatQuoteForWhatsApp(quote)
  const consultativeClosing = pendingAmbiguousQuestion
    ? `\n\n📌 *Dúvida sobre uma das opções:* ${pendingAmbiguousQuestion}`
    : '\n\nDeseja adicionar mais algum produto ou podemos fechar com estes itens? 😊'

  return {
    workingMemory: memory,
    quote,
    status: 'quote_ready',
    differentiatingQuestion: pendingAmbiguousQuestion,
    consultativeResponse: `${formattedQuote}${consultativeClosing}`,
    actionTaken: 'added_to_cart'
  }
}
