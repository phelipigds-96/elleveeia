import { createAdminClient } from '@/lib/supabase/service'
import { normalizeCatalogText } from './normalization'

export interface ProductSearchResult {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  brand: string | null
  category: string | null
  unit: string | null
  active: boolean
}

export async function searchProducts(companyId: string, query: string, limit: number = 5): Promise<ProductSearchResult[]> {
  const supabase = createAdminClient()
  const normalizedQuery = normalizeCatalogText(query)

  // Previne queries vazias
  if (!normalizedQuery || normalizedQuery.trim() === '') {
    return []
  }

  // Previne abusos no limit
  const maxLimit = Math.min(limit, 10)
  
  // Realiza a busca considerando Barcode, SKU ou nome normalizado
  // A busca usa ilike '%query%' no nome normalizado, permitindo matches parciais.
  // IMPORTANTE: company_id é obrigatoriamente filtrado.
  // Aumentamos o limite para poder filtrar os produtos de balança localmente
  const fetchLimit = maxLimit * 4

  const { data, error } = await supabase
    .from('products')
    .select(`
      id,
      name,
      sku,
      barcode,
      unit,
      active,
      product_brands ( name ),
      product_categories ( name )
    `)
    .eq('company_id', companyId)
    .eq('active', true)
    .or(`barcode.eq."${query}",sku.ilike."%${query}%",normalized_name.ilike."%${normalizedQuery}%"`)
    .limit(fetchLimit)

  if (error) {
    console.error('[searchProducts] Erro na busca de produtos:', error.message)
    return []
  }

  // Filtra produtos de balança (produtos que têm "KG" solto no nome, sem número colado como 1.01KG)
  const isBulkRegex = /(?:^|[^0-9])\s+KG(?:\s|$)/i

  const validProducts = (data || []).filter((row: any) => {
    return !isBulkRegex.test(row.name)
  })

  return validProducts.slice(0, maxLimit).map((row: any) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    unit: row.unit,
    active: row.active,
    brand: row.product_brands?.name || null,
    category: row.product_categories?.name || null
  }))
}
