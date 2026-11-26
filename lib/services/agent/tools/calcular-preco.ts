import { z } from 'zod'
import type { ToolDefinition } from '../tools'
import { resolveProductPrice } from '../../commercial/pricing'
import { searchProducts, extractProductPackageFactor } from '../../catalog/products'
import { parseStructuredQuery, splitMultiProductQuery } from '../../catalog/query-parser'
import { resolveReferenceQuery } from '../commercial-strategy'
import { createAdminClient } from '@/lib/supabase/service'

const InputSchema = z.object({
  product_id: z.string().optional().describe('ID do produto (UUID exato de [PRODUTOS APRESENTADOS RECENTEMENTE] ou do catálogo). Preencha preferencialmente junto com product_name.'),
  product_name: z.string().optional().describe('Nome ou termo do produto (ex: "LEITE CONDENSADO SEMIDESNATADO TIROL 395G"). Preencha SEMPRE para identificação precisa.'),
  quantity: z.number().int().positive().describe('Qtd desejada'),
  unit: z.string().optional().describe('Unidade solicitada pelo cliente: "caixa", "cx", "fardo", "fd", "pacote", "unidade". OBRIGATÓRIO informar quando o cliente falar em caixas ou fardos.'),
  price_type: z.string().optional().describe('Tipo preco (retail/wholesale/club)')
})

export const calcularPrecoProdutoTool: ToolDefinition = {
  name: 'calcular_preco_produto',
  description: 'Calcula preco final de um produto conforme a quantidade e unidade (converte caixas/fardos automaticamente para unidades base).',
  metadata: { category: 'pricing', capabilities: ['price.calculate'] },
  schema: InputSchema,
  execute: async (input, context) => {
    const { product_id, product_name, quantity, unit, price_type } = input as any

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    let targetProductId = product_id && UUID_REGEX.test(product_id.trim()) ? product_id.trim() : null
    let resolvedProductName: string | undefined = product_name?.trim() || undefined

    // 0. Resolução Ordinal / Anafórica via Working Memory (ex: "aquele primeiro", "o segundo", "opcao 1")
    const refTerm = product_name || product_id || ''
    if (!targetProductId && refTerm) {
      const refRes = resolveReferenceQuery(refTerm, context.workingMemory)
      if (refRes.resolvedProduct) {
        targetProductId = refRes.resolvedProduct.id
        resolvedProductName = refRes.resolvedProduct.name
      } else if (refRes.resolvedQuery && refRes.resolvedQuery !== refTerm) {
        resolvedProductName = refRes.resolvedQuery
      }
    }

    // 1. Tenta identificar o nome nos produtos descobertos recentemente ou contexto ativo
    if (targetProductId && context.workingMemory?.discoveredProducts) {
      const found = context.workingMemory.discoveredProducts.find((p: any) => p.id === targetProductId)
      if (found && !resolvedProductName) resolvedProductName = found.name
    }
    if (targetProductId && !resolvedProductName && context.workingMemory?.activeProduct?.id === targetProductId) {
      resolvedProductName = context.workingMemory.activeProduct.name
    }

    // 2. Fallback de busca por nome se ID for ausente ou inválido
    if (!targetProductId && (product_name || resolvedProductName)) {
      const term = (product_name || resolvedProductName)!.trim()
      const searchRes = await searchProducts(context.companyId, term, 1)
      if (searchRes.matches && searchRes.matches.length > 0) {
        targetProductId = searchRes.matches[0].id
        resolvedProductName = searchRes.matches[0].name
      }
    }

    if (targetProductId) {
      try {
        // Verifica se há conversão de embalagem (caixa/fardo) necessária no backend
        const normUnit = (unit || '').toLowerCase().trim()
        const isExplicitWholesale = /^(?:cx|caixa|caixas|fardo|fardos|fd|display|displays)$/i.test(normUnit)
        let inferredUnit: 'CX' | 'FD' | 'UN' = isExplicitWholesale
          ? (/^(?:fd|fardo|fardos)$/i.test(normUnit) ? 'FD' : 'CX')
          : 'UN'

        if (!isExplicitWholesale && !normUnit && context.currentUserMessage) {
          const subs = splitMultiProductQuery(context.currentUserMessage)
          if (subs.length === 1) {
            const msgParsed = parseStructuredQuery(context.currentUserMessage)
            if (msgParsed.saleUnit === 'CX' || msgParsed.saleUnit === 'FD') {
              inferredUnit = msgParsed.saleUnit
            }
          }
        }

        let effectiveQuantity = quantity
        let packageFactor: number | null = null
        let convertedFromPackaging = false

        if (inferredUnit === 'CX' || inferredUnit === 'FD') {
          try {
            const sb = context.adminClient || createAdminClient()
            const { data: prodRow } = await sb
              .from('products')
              .select('id, name, unit, package_description, metadata')
              .eq('id', targetProductId)
              .eq('company_id', context.companyId)
              .maybeSingle()

            if (prodRow) {
              if (!resolvedProductName) resolvedProductName = prodRow.name
              const factorInfo = extractProductPackageFactor(prodRow)
              if (factorInfo.factor && factorInfo.factor > 1 && (prodRow.unit || 'UN').toUpperCase() === 'UN') {
                packageFactor = factorInfo.factor
                // Converte quando a LLM passou a quantidade em caixas/fardos (não já pré-multiplicada em unidades)
                if (isExplicitWholesale || quantity < packageFactor) {
                  effectiveQuantity = quantity * packageFactor
                  convertedFromPackaging = true
                }
              }
            }
          } catch {
            // Fallback seguro caso o mock não implemente products lookup
          }
        }

        const effectivePriceType = (convertedFromPackaging && price_type === 'retail') ? undefined : price_type
        const result = await resolveProductPrice({
          companyId: context.companyId,
          productId: targetProductId,
          quantity: effectiveQuantity,
          priceType: effectivePriceType
        })

        const fmtBRL = (v: number) => v.toFixed(2).replace('.', ',')
        const packagePrice = convertedFromPackaging && packageFactor
          ? Math.round((result.unitPrice * packageFactor) * 100) / 100
          : null
        const packSingular = inferredUnit === 'FD' ? 'fardo' : 'caixa'
        const packPlural = inferredUnit === 'FD' ? 'fardos' : 'caixas'
        const packLabel = quantity === 1 ? packSingular : packPlural
        const clarityHint = convertedFromPackaging && packageFactor
          ? (quantity === 1
              ? `São 1 ${packSingular}, com ${packageFactor} unidades, totalizando ${result.quantity} unidades. O valor é R$ ${fmtBRL(result.unitPrice)} por unidade, ficando R$ ${fmtBRL(result.subtotal)} por 1 ${packSingular}.`
              : `São ${quantity} ${packPlural}, com ${packageFactor} unidades cada (R$ ${fmtBRL(packagePrice || 0)} por ${packSingular}), totalizando ${result.quantity} unidades. O valor é R$ ${fmtBRL(result.unitPrice)} por unidade, ficando R$ ${fmtBRL(result.subtotal)} pelas ${quantity} ${packPlural}.`)
          : ''

        return {
          success: true,
          data: {
            product_id: result.productId,
            product_name: resolvedProductName,
            quantity: result.quantity,
            requested_quantity: convertedFromPackaging ? quantity : result.quantity,
            requested_unit: convertedFromPackaging ? inferredUnit : 'UN',
            package_factor: packageFactor,
            package_price: packagePrice,
            base_quantity: result.quantity,
            unit_price: result.unitPrice,
            subtotal: result.subtotal,
            ...(convertedFromPackaging ? {
              consultative_hint: `${clarityHint} Preserva exatamente essa distinção clara entre preço unitário, preço por ${packSingular} e total para as ${quantity} ${packLabel}.`
            } : {})
          }
        }
      } catch (error: any) {
        // Se a precificação pelo ID falhar (ex: UUID alucinado ou desatualizado),
        // tenta fallback de busca pelo nome ou itens em memória
        const candidateTerm = product_name?.trim() || resolvedProductName || 
          context.workingMemory?.activeProduct?.name ||
          (context.workingMemory?.discoveredProducts?.length === 1 ? context.workingMemory.discoveredProducts[0].name : undefined)

        if (candidateTerm) {
          try {
            const fallbackSearch = await searchProducts(context.companyId, candidateTerm, 3)
            const validMatch = fallbackSearch.matches?.find(m => m.id !== targetProductId) || fallbackSearch.matches?.[0]
            if (validMatch && validMatch.id !== targetProductId) {
              const fallbackResult = await resolveProductPrice({
                companyId: context.companyId,
                productId: validMatch.id,
                quantity,
                priceType: price_type
              })

              return {
                success: true,
                data: {
                  product_id: fallbackResult.productId,
                  product_name: validMatch.name,
                  quantity: fallbackResult.quantity,
                  unit_price: fallbackResult.unitPrice,
                  subtotal: fallbackResult.subtotal
                }
              }
            }
          } catch {
            // Preserva o erro original
          }
        }

        return {
          success: false,
          error: error.message
        }
      }
    }

    return {
      success: false,
      error: `Produto não localizado no catálogo para "${product_name || product_id || 'item não informado'}".`
    }
  }
}
