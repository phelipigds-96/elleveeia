"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/service"
import { requireCompanyAdmin } from "@/lib/services/auth/guard"
import { requireActiveCompany } from "@/lib/services/platform/tenant-access"
import { normalizeCatalogText } from "@/lib/services/catalog/normalization"

export interface ProductInput {
  name: string
  price: number
  description?: string | null
  sku?: string | null
  unit?: string | null
  active?: boolean
}

export interface ActionResult<T = any> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Cria manualmente um produto ou serviço com seu preço de varejo oficial
 */
export async function createProductAction(input: ProductInput): Promise<ActionResult> {
  try {
    const currentProfile = await requireCompanyAdmin()
    if (!currentProfile.company_id) {
      return { success: false, error: "Empresa não vinculada ao perfil do usuário." }
    }
    const companyId = currentProfile.company_id

    await requireActiveCompany(companyId)

    const name = input.name?.trim()
    if (!name || name.length < 2) {
      return { success: false, error: "O nome do item ou serviço deve ter pelo menos 2 caracteres." }
    }

    const price = typeof input.price === "number" ? input.price : parseFloat(String(input.price).replace(",", "."))
    if (isNaN(price) || price < 0) {
      return { success: false, error: "Preço inválido. Informe um valor numérico maior ou igual a zero." }
    }

    const adminClient = createAdminClient()

    // 1. Validação de limites comerciais da empresa (max_catalog_items)
    const { data: limits } = await adminClient
      .from("company_limits")
      .select("max_catalog_items")
      .eq("company_id", companyId)
      .maybeSingle()

    const maxCatalogItems = limits?.max_catalog_items ?? 50000

    const { count: currentProductCount } = await adminClient
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)

    if ((currentProductCount || 0) >= maxCatalogItems) {
      return {
        success: false,
        error: `Limite de catálogo atingido (${maxCatalogItems} itens). Contate o suporte para expandir sua cota.`
      }
    }

    // 2. Tratamento de SKU / Código
    let sku = input.sku?.trim()
    if (!sku) {
      const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase()
      sku = `PROD-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`
    }

    const normalized_name = normalizeCatalogText(name)

    // 3. Inserir Produto
    const { data: product, error: prodErr } = await adminClient
      .from("products")
      .insert({
        company_id: companyId,
        name,
        normalized_name,
        description: input.description?.trim() || null,
        sku,
        external_id: sku,
        unit: input.unit?.trim() || "un",
        active: input.active !== false,
        updated_at: new Date().toISOString()
      })
      .select("id, name, sku, unit, active, description")
      .single()

    if (prodErr || !product) {
      console.error("[CatalogActions] Erro ao criar produto:", prodErr)
      return { success: false, error: prodErr?.message || "Falha ao cadastrar o item no catálogo." }
    }

    // 4. Inserir Preço Varejo Oficial
    const { error: priceErr } = await adminClient
      .from("product_prices")
      .insert({
        company_id: companyId,
        product_id: product.id,
        price_type: "retail",
        price,
        min_quantity: 1,
        active: input.active !== false,
        updated_at: new Date().toISOString()
      })

    if (priceErr) {
      console.error("[CatalogActions] Erro ao registrar preço:", priceErr)
    }

    revalidatePath("/catalog")
    return { success: true, data: { ...product, price } }
  } catch (err: any) {
    console.error("[CatalogActions] Erro inesperado ao criar produto:", err)
    return { success: false, error: err.message || "Erro interno do servidor." }
  }
}

/**
 * Atualiza um produto ou serviço e seu preço de varejo
 */
export async function updateProductAction(productId: string, input: ProductInput): Promise<ActionResult> {
  try {
    const currentProfile = await requireCompanyAdmin()
    if (!currentProfile.company_id) {
      return { success: false, error: "Empresa não vinculada ao perfil do usuário." }
    }
    const companyId = currentProfile.company_id

    await requireActiveCompany(companyId)

    if (!productId) {
      return { success: false, error: "ID do produto não fornecido." }
    }

    const name = input.name?.trim()
    if (!name || name.length < 2) {
      return { success: false, error: "O nome do item ou serviço deve ter pelo menos 2 caracteres." }
    }

    const price = typeof input.price === "number" ? input.price : parseFloat(String(input.price).replace(",", "."))
    if (isNaN(price) || price < 0) {
      return { success: false, error: "Preço inválido. Informe um valor numérico maior ou igual a zero." }
    }

    const adminClient = createAdminClient()
    const normalized_name = normalizeCatalogText(name)

    // 1. Atualizar Produto
    const { error: prodErr } = await adminClient
      .from("products")
      .update({
        name,
        normalized_name,
        description: input.description?.trim() || null,
        sku: input.sku?.trim() || null,
        unit: input.unit?.trim() || "un",
        active: input.active !== false,
        updated_at: new Date().toISOString()
      })
      .eq("id", productId)
      .eq("company_id", companyId)

    if (prodErr) {
      console.error("[CatalogActions] Erro ao atualizar produto:", prodErr)
      return { success: false, error: prodErr?.message || "Falha ao atualizar o item." }
    }

    // 2. Atualizar Preço Varejo ou Inserir se não existia
    const { data: existingPrice } = await adminClient
      .from("product_prices")
      .select("id")
      .eq("company_id", companyId)
      .eq("product_id", productId)
      .eq("price_type", "retail")
      .maybeSingle()

    if (existingPrice) {
      await adminClient
        .from("product_prices")
        .update({
          price,
          active: input.active !== false,
          updated_at: new Date().toISOString()
        })
        .eq("id", existingPrice.id)
    } else {
      await adminClient
        .from("product_prices")
        .insert({
          company_id: companyId,
          product_id: productId,
          price_type: "retail",
          price,
          min_quantity: 1,
          active: input.active !== false,
          updated_at: new Date().toISOString()
        })
    }

    revalidatePath("/catalog")
    return { success: true }
  } catch (err: any) {
    console.error("[CatalogActions] Erro inesperado ao atualizar produto:", err)
    return { success: false, error: err.message || "Erro interno do servidor." }
  }
}

/**
 * Exclui um produto do catálogo (com cascata automática de preços)
 */
export async function deleteProductAction(productId: string): Promise<ActionResult> {
  try {
    const currentProfile = await requireCompanyAdmin()
    if (!currentProfile.company_id) {
      return { success: false, error: "Empresa não vinculada ao perfil do usuário." }
    }
    const companyId = currentProfile.company_id

    await requireActiveCompany(companyId)

    if (!productId) {
      return { success: false, error: "ID do produto não fornecido." }
    }

    const adminClient = createAdminClient()

    // Deletar da tabela products (ON DELETE CASCADE cuidará de product_prices)
    const { error: delErr } = await adminClient
      .from("products")
      .delete()
      .eq("id", productId)
      .eq("company_id", companyId)

    if (delErr) {
      console.error("[CatalogActions] Erro ao excluir produto:", delErr)
      return { success: false, error: delErr?.message || "Falha ao excluir o item do catálogo." }
    }

    revalidatePath("/catalog")
    return { success: true }
  } catch (err: any) {
    console.error("[CatalogActions] Erro inesperado ao excluir produto:", err)
    return { success: false, error: err.message || "Erro interno do servidor." }
  }
}
