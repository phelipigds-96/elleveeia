import { createAdminClient } from '@/lib/supabase/service'
import { normalizeCatalogText } from './normalization'
import { tokenizeQuery, calculateMatchScore } from './search-logic'

export interface ProductSearchResult {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  brand: string | null
  category: string | null
  unit: string | null
  active: boolean
  match_score?: number
}

export async function searchProducts(companyId: string, query: string, limit: number = 5): Promise<ProductSearchResult[]> {
  const supabase = createAdminClient()
  const normalizedQuery = normalizeCatalogText(query)

  if (!normalizedQuery || normalizedQuery.trim() === '') {
    return []
  }

  const maxLimit = Math.min(limit, 10)

  // 1. Verificar se Ǹ um identificador exato (EAN ou SKU)
  // Se for apenas nǧmeros ou cdigo alfanumǸrico curto, tentar match exato primeiro
  if (/^[a-zA-Z0-9]+$/.test(normalizedQuery) && normalizedQuery.length >= 4) {
    const { data: exactData } = await supabase
      .from('products')
      .select(`id, name, sku, barcode, unit, active, product_brands ( name ), product_categories ( name )`)
      .eq('company_id', companyId)
      .eq('active', true)
      .or(`barcode.eq."${query}",sku.ilike."${query}"`)
      .limit(1)
      
    if (exactData && exactData.length > 0) {
      return exactData.map(mapProductRow)
    }
  }

  // 2. Tokenizar e classificar a query
  const tokenGroups = tokenizeQuery(query)
  
  // Separar tokens especficos (alta relevǦncia)
  const specificTokens = tokenGroups.filter(g => !g.isGeneric && !g.isUnit)
  const unitTokens = tokenGroups.filter(g => g.isUnit)
  
  // Vamos usar no mǭximo os 2 tokens mais especficos para forar no DB (AND)
  // Isso reduz o conjunto retornado sem ser restritivo demais
  const requiredDbTokens = specificTokens.slice(0, 2)
  
  let dbQuery = supabase
    .from('products')
    .select(`id, name, sku, barcode, unit, active, normalized_name, product_brands ( name ), product_categories ( name )`)
    .eq('company_id', companyId)
    .eq('active', true)

  // Adicionar filtros .or para cada token obrigatrio (atuam como AND entre si no Supabase)
  for (const group of requiredDbTokens) {
    const orCondition = group.variants.map(v => `normalized_name.ilike."%${v}%"`).join(',')
    dbQuery = dbQuery.or(orCondition)
  }

  // Se nǜo houver tokens especficos, talvez a busca seja s "cobertura" ou "1kg"
  // Nesse caso, usamos os tokens genǸricos/unidades para nǜo buscar tudo
  if (requiredDbTokens.length === 0 && tokenGroups.length > 0) {
    const fallbackGroup = tokenGroups[0]
    const orCondition = fallbackGroup.variants.map(v => `normalized_name.ilike."%${v}%"`).join(',')
    dbQuery = dbQuery.or(orCondition)
  }

  const { data, error } = await dbQuery.limit(200)

  if (error || !data) {
    console.error('[searchProducts] Erro na busca de produtos:', error?.message)
    return []
  }

  // Filtra produtos de balana
  const isBulkRegex = /(?:^|[^0-9])\s+KG(?:\s|$)/i
  const validProducts = data.filter((row: any) => !isBulkRegex.test(row.name))

  // 3. Avaliar relevǦncia no backend (Scoring)
  const scoredProducts = validProducts.map((row: any) => {
    const score = calculateMatchScore(row.normalized_name, tokenGroups)
    return {
      product: mapProductRow(row),
      score
    }
  })

  // 4. Ordenar e retornar os melhores
  scoredProducts.sort((a, b) => b.score - a.score)
  
  // Se tivermos candidatos com score negativo (penalizados por falta de token chave), 
  // ns ignoramos se o melhor score for decente.
  const bestScore = scoredProducts[0]?.score || 0
  const threshold = bestScore > 10 ? bestScore - 15 : 0 // Filtro de qualidade
  
  const finalCandidates = scoredProducts
    .filter(item => item.score >= threshold && item.score > 0)
    .slice(0, maxLimit)

  return finalCandidates.map(c => ({
    ...c.product,
    match_score: c.score // Exposto internamente
  }))
}

function mapProductRow(row: any): ProductSearchResult {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    unit: row.unit,
    active: row.active,
    brand: row.product_brands?.name || null,
    category: row.product_categories?.name || null
  }
}
