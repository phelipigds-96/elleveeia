import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import {
  removeCartItem,
  replaceCartItem,
  updateCartItemQuantity,
  resolveCartItemReference,
  calculateCartTotal,
  clearCart,
  type AddCartItemParams
} from '../working-memory'
import { resolveBatchProductPrices } from '../../commercial/pricing'
import { searchProducts } from '../../catalog/products'

const InputSchema = z.object({
  action: z.enum(['update_quantity', 'remove_item', 'replace_item', 'clear_cart', 'get_cart'])
    .describe('Ação a realizar no carrinho: "update_quantity" para alterar quantidade, "remove_item" para excluir, "replace_item" para substituir, "clear_cart" para esvaziar, ou "get_cart" para consultar.'),
  product_reference: z.string().optional()
    .describe('Identificador, SKU, nome do produto ou referência ordinal ("1", "2", "primeiro", "segundo", "último", etc.)'),
  quantity: z.number().int().positive().optional()
    .describe('Nova quantidade inteira desejada (obrigatório para "update_quantity")'),
  unit: z.string().optional()
    .describe('Unidade da nova quantidade (ex: "caixa", "cx", "fardo", "fd", "unidade"). Se caixa ou fardo, o sistema converte automaticamente para o fator de embalagem.'),
  replacement_query: z.string().optional()
    .describe('Termo de busca para o produto substituto (obrigatório para "replace_item")'),
  price_type: z.string().optional()
    .describe('Tipo de preço desejado (retail/wholesale/club). Deixe vazio para cálculo automático.')
})

export const gerenciarCarrinhoTool: ToolDefinition = {
  name: 'gerenciar_carrinho',
  description: 'Gerencia itens do carrinho de compras em negociação (atualizar quantidade, remover produto, substituir marca/produto, esvaziar ou listar itens). Recalcula preços oficiais pelo sistema e garante precisão financeira.',
  metadata: { category: 'cart', capabilities: ['cart.manage', 'cart.update'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { action, product_reference, quantity, unit, replacement_query, price_type } = input as z.infer<typeof InputSchema>
    const currentMemory = context.workingMemory
    const cart = currentMemory?.activeCart || []

    // 1. Consultar carrinho atual
    if (action === 'get_cart') {
      const totals = calculateCartTotal(currentMemory)
      return {
        success: true,
        data: {
          action: 'get_cart',
          items: cart,
          item_count: cart.length,
          total_confirmed: totals.total,
          total_confirmed_cents: totals.totalConfirmedCents,
          total_pending_cents: totals.totalPendingCents,
          has_pending_items: totals.hasPendingItems
        }
      }
    }

    // 2. Limpar carrinho
    if (action === 'clear_cart') {
      return {
        success: true,
        data: {
          action: 'clear_cart',
          items: [],
          item_count: 0,
          total_confirmed: 0,
          total_confirmed_cents: 0,
          has_pending_items: false,
          message: 'Carrinho esvaziado com sucesso.'
        }
      }
    }

    // 3. Validação de carrinho vazio para ações de edição
    if (cart.length === 0) {
      return {
        success: false,
        error: 'O carrinho está vazio. Adicione produtos antes de realizar alterações.'
      }
    }

    // 4. Resolução do produto alvo
    const refText = product_reference || ''
    const { item: targetItem, resolvedReason } = resolveCartItemReference(refText, currentMemory)

    if (!targetItem) {
      return {
        success: false,
        error: `Não foi possível identificar o item no carrinho correspondente a "${refText}". Itens atuais: ${cart.map((i: any, idx: number) => `${idx + 1}. ${i.name}`).join(', ')}.`
      }
    }

    // 5. Remover item
    if (action === 'remove_item') {
      const updatedMemory = removeCartItem(currentMemory, targetItem.productId)
      const totals = calculateCartTotal(updatedMemory)
      return {
        success: true,
        data: {
          action: 'remove_item',
          removed_product_id: targetItem.productId,
          removed_item_name: targetItem.name,
          resolved_reason: resolvedReason,
          remaining_items: updatedMemory.activeCart || [],
          item_count: updatedMemory.activeCart?.length || 0,
          total_confirmed: totals.total,
          total_confirmed_cents: totals.totalConfirmedCents,
          total_pending_cents: totals.totalPendingCents,
          has_pending_items: totals.hasPendingItems
        }
      }
    }

    // 6. Atualizar quantidade com reprecificação oficial
    if (action === 'update_quantity') {
      if (!quantity || quantity <= 0) {
        return {
          success: false,
          error: 'Informe uma quantidade inteira positiva para atualizar o item.'
        }
      }

      // Detecção de unidade de embalagem (caixa / fardo) e conversão para unidades-base
      const normUnit = (unit || '').toLowerCase().trim()
      const isWholesaleUnit = /^(?:cx|caixa|caixas|fardo|fardos|fd|display|displays)$/i.test(normUnit)
      const targetPkgFactor = targetItem.packageFactor
      const isTargetWholesale = Boolean(targetItem.requestedUnit && /^(?:cx|caixa|caixas|fardo|fardos|fd)$/i.test(targetItem.requestedUnit))

      let effectiveBaseQty = quantity
      let newRequestedQty = quantity
      let newRequestedUnit = targetItem.requestedUnit || 'UN'

      if (targetPkgFactor && targetPkgFactor > 1) {
        const isAlreadyMultiplied =
          quantity >= targetPkgFactor &&
          quantity % targetPkgFactor === 0 &&
          Boolean(
            context.currentUserMessage &&
            new RegExp(`\\b${quantity / targetPkgFactor}\\b`).test(context.currentUserMessage) &&
            !new RegExp(`\\b${quantity}\\b`).test(context.currentUserMessage)
          )

        if (isAlreadyMultiplied) {
          effectiveBaseQty = quantity
          newRequestedQty = quantity / targetPkgFactor
          newRequestedUnit = isWholesaleUnit
            ? (/^(?:fd|fardo|fardos)$/i.test(normUnit) ? 'FD' : 'CX')
            : (targetItem.requestedUnit || 'CX')
        } else if (isWholesaleUnit) {
          effectiveBaseQty = quantity * targetPkgFactor
          newRequestedQty = quantity
          newRequestedUnit = /^(?:fd|fardo|fardos)$/i.test(normUnit) ? 'FD' : 'CX'
        } else if (isTargetWholesale && quantity < targetPkgFactor) {
          // Se o item já estava em caixa/fardo e a nova quantidade solicitada é pequena (ex: 3 caixas em vez de 2 caixas),
          // o número refere-se à quantidade de caixas, e não unidades avulsas
          effectiveBaseQty = quantity * targetPkgFactor
          newRequestedQty = quantity
          newRequestedUnit = targetItem.requestedUnit || 'UN'
        }
      }

      // Reprecificação via motor oficial em lote com a quantidade base convertida
      const batchResult = await resolveBatchProductPrices({
        companyId: context.companyId,
        items: [{
          productId: targetItem.productId,
          quantity: effectiveBaseQty,
          priceType: price_type
        }]
      })

      const priceResult = batchResult.items[0]
      const isConfirmed = priceResult?.status === 'confirmed' && (priceResult.unitPriceCents > 0 || priceResult.unitPrice > 0)
      const unitPriceCents = priceResult?.unitPriceCents ?? Math.round((priceResult?.unitPrice || 0) * 100)
      const subtotalCents = priceResult?.subtotalCents ?? (unitPriceCents * effectiveBaseQty)
      const unitPrice = unitPriceCents / 100
      const subtotal = subtotalCents / 100

      const updatedItem = {
        ...targetItem,
        quantity: effectiveBaseQty,
        requestedQuantity: newRequestedQty,
        requestedUnit: newRequestedUnit,
        packageFactor: targetPkgFactor,
        internalQuantity: effectiveBaseQty,
        unitPrice,
        subtotal,
        unitPriceCents,
        subtotalCents,
        priceType: priceResult?.priceType || targetItem.priceType,
        appliedRule: priceResult?.appliedRule,
        isPriceConfirmed: isConfirmed,
        status: isConfirmed ? ('confirmed' as const) : ('pending' as const)
      }

      const tempMemory = updateCartItemQuantity(currentMemory, targetItem.productId, effectiveBaseQty)
      const totals = calculateCartTotal({
        ...tempMemory,
        activeCart: (tempMemory.activeCart || []).map(i => i.productId === targetItem.productId ? updatedItem : i)
      })

      return {
        success: true,
        data: {
          action: 'update_quantity',
          updated_item: updatedItem,
          resolved_reason: resolvedReason,
          total_confirmed: totals.total,
          total_confirmed_cents: totals.totalConfirmedCents,
          total_pending_cents: totals.totalPendingCents,
          has_pending_items: totals.hasPendingItems,
          consultative_hint: targetPkgFactor && targetPkgFactor > 1 && newRequestedQty !== effectiveBaseQty
            ? `Quantidade atualizada para ${newRequestedQty} ${newRequestedQty === 1 ? 'caixa' : 'caixas'} (${effectiveBaseQty} unidades no total) a R$ ${unitPrice.toFixed(2)} cada = R$ ${subtotal.toFixed(2)}. Total geral do carrinho: R$ ${totals.total.toFixed(2)}.`
            : `Quantidade atualizada para ${effectiveBaseQty} unidades a R$ ${unitPrice.toFixed(2)} cada = R$ ${subtotal.toFixed(2)}. Total geral do carrinho: R$ ${totals.total.toFixed(2)}.`
        }
      }
    }

    // 7. Substituir produto
    if (action === 'replace_item') {
      if (!replacement_query || replacement_query.trim() === '') {
        return {
          success: false,
          error: 'Informe o termo de busca para o produto substituto.'
        }
      }

      const searchRes = await searchProducts(context.companyId, replacement_query.trim(), 5)
      if (!searchRes.matches || searchRes.matches.length === 0) {
        return {
          success: false,
          error: `Nenhum produto substituto encontrado para "${replacement_query}".`
        }
      }

      const bestReplacement = searchRes.matches[0]
      const targetQty = quantity || targetItem.quantity || 1

      const batchResult = await resolveBatchProductPrices({
        companyId: context.companyId,
        items: [{
          productId: bestReplacement.id,
          quantity: targetQty,
          priceType: price_type
        }]
      })

      const priceResult = batchResult.items[0]
      const isConfirmed = priceResult?.status === 'confirmed' && (priceResult.unitPriceCents > 0 || priceResult.unitPrice > 0)
      const unitPriceCents = priceResult?.unitPriceCents ?? Math.round((priceResult?.unitPrice || 0) * 100)
      const subtotalCents = priceResult?.subtotalCents ?? (unitPriceCents * targetQty)
      const unitPrice = unitPriceCents / 100
      const subtotal = subtotalCents / 100

      const newItem: AddCartItemParams = {
        productId: bestReplacement.id,
        sku: bestReplacement.sku,
        name: bestReplacement.name,
        quantity: targetQty,
        unit: bestReplacement.unit || 'UN',
        unitPrice,
        subtotal,
        unitPriceCents,
        subtotalCents,
        priceType: priceResult?.priceType || price_type || 'retail',
        appliedRule: priceResult?.appliedRule,
        isPriceConfirmed: isConfirmed,
        status: isConfirmed ? 'confirmed' : 'pending'
      }

      const nextMem = replaceCartItem(currentMemory, targetItem.productId, newItem)
      const totals = calculateCartTotal(nextMem)

      return {
        success: true,
        data: {
          action: 'replace_item',
          replaced_product_id: targetItem.productId,
          replaced_item_name: targetItem.name,
          new_item: newItem,
          resolved_reason: resolvedReason,
          total_confirmed: totals.total,
          total_confirmed_cents: totals.totalConfirmedCents,
          total_pending_cents: totals.totalPendingCents,
          has_pending_items: totals.hasPendingItems
        }
      }
    }

    return {
      success: false,
      error: `Ação "${action}" não reconhecida.`
    }
  }
}
