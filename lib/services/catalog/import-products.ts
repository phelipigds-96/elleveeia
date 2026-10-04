import { createAdminClient } from '@/lib/supabase/service'
import { normalizeCatalogText } from './normalization'

export interface CatalogImportRow {
  name: string
  sku?: string
  barcode?: string
  brandName?: string
  categoryName?: string
  priceRetail?: number
}

/**
 * Função utilitária para importar produtos. (Mock/Estrutura preparada)
 * Em uma próxima fase, essa função pode ser chamada por um Webhook ou upload de CSV.
 */
export async function importProductsCSV(companyId: string, rows: CatalogImportRow[]) {
  const supabase = createAdminClient()
  let successCount = 0
  let errorCount = 0

  for (const row of rows) {
    try {
      // 1. Resolve ou cria Marca (se fornecida)
      let brandId = null
      if (row.brandName) {
        const normalizedBrand = normalizeCatalogText(row.brandName)
        const { data: brand } = await supabase
          .from('product_brands')
          .select('id')
          .eq('company_id', companyId)
          .eq('normalized_name', normalizedBrand)
          .single()
        
        if (brand) {
          brandId = brand.id
        } else {
          const { data: newBrand } = await supabase
            .from('product_brands')
            .insert({
              company_id: companyId,
              name: row.brandName,
              normalized_name: normalizedBrand
            })
            .select('id')
            .single()
          brandId = newBrand?.id
        }
      }

      // 2. Resolve ou cria Categoria (se fornecida)
      let categoryId = null
      if (row.categoryName) {
        const normalizedCat = normalizeCatalogText(row.categoryName)
        const { data: cat } = await supabase
          .from('product_categories')
          .select('id')
          .eq('company_id', companyId)
          .eq('normalized_name', normalizedCat)
          .single()
        
        if (cat) {
          categoryId = cat.id
        } else {
          const { data: newCat } = await supabase
            .from('product_categories')
            .insert({
              company_id: companyId,
              name: row.categoryName,
              normalized_name: normalizedCat
            })
            .select('id')
            .single()
          categoryId = newCat?.id
        }
      }

      // 3. Cria Produto
      const { data: product, error: prodErr } = await supabase
        .from('products')
        .insert({
          company_id: companyId,
          name: row.name,
          normalized_name: normalizeCatalogText(row.name),
          sku: row.sku || null,
          barcode: row.barcode || null,
          brand_id: brandId,
          category_id: categoryId
        })
        .select('id')
        .single()
      
      if (prodErr || !product) throw prodErr

      // 4. Cria Preço (se fornecido)
      if (row.priceRetail !== undefined && row.priceRetail > 0) {
        await supabase
          .from('product_prices')
          .insert({
            company_id: companyId,
            product_id: product.id,
            price_type: 'retail',
            price: row.priceRetail
          })
      }

      successCount++
    } catch (error) {
      console.error('[importProductsCSV] Falha ao importar linha:', row.name, error)
      errorCount++
    }
  }

  return { successCount, errorCount }
}
