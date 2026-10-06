import { createAdminClient } from '@/lib/supabase/service'
import { parseQuery, calculateMatchScore } from './search-logic'

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

export interface StructuredSearchResponse {
  status: 'exact_match' | 'ambiguous' | 'not_found'
  confidence: number
  matches: ProductSearchResult[]
}

export async function searchProducts(companyId: string, query: string, limit: number = 5): Promise<StructuredSearchResponse> {
  const supabase = createAdminClient()
  const parsed = parseQuery(query)

  if (!parsed.normalizedQuery || parsed.normalizedQuery.trim() === '') {
    return { status: 'not_found', confidence: 0, matches: [] }
  }

  const maxLimit = Math.min(limit, 10)

  // 1. Identificadores exatos
  if (parsed.identifiers.length > 0) {
    const { data: exactData } = await supabase
      .from('products')
      .select(`id, name, sku, barcode, unit, active, product_brands ( name ), product_categories ( name )`)
      .eq('company_id', companyId)
      .eq('active', true)
      .or(`barcode.eq."${query}",sku.ilike."${query}"`)
      .limit(1)
      
    if (exactData && exactData.length > 0) {
      return {
        status: 'exact_match',
        confidence: 1.0,
        matches: exactData.map(mapProductRow)
      }
    }
  }

  // 2. Candidate Retrieval no banco (PostgreSQL)
  const specificTokens = parsed.tokenGroups.filter(g => !g.isGeneric && !g.isUnit)
  let dbTokens = [...specificTokens]
  
  // CAMADA B - Se houver poucos tokens especÃ­ficos, preservamos informaÃ§Ã£o da categoria/genÃ©ricos
  if (dbTokens.length < 2 && parsed.tokenGroups.length > dbTokens.length) {
    const genericTokens = parsed.tokenGroups.filter(g => g.isGeneric)
    if (genericTokens.length > 0) {
      dbTokens.push(genericTokens[0])
    }
  }

  const requiredDbTokens = dbTokens.slice(0, 2)
  
  let dbQuery = supabase
    .from('products')
    .select(`id, name, sku, barcode, unit, active, normalized_name, product_brands ( name ), product_categories ( name )`)
    .eq('company_id', companyId)
    .eq('active', true)

  for (const group of requiredDbTokens) {
    const orCondition = group.variants.map(v => `normalized_name.ilike."%${v}%"`).join(',')
    dbQuery = dbQuery.or(orCondition)
  }

  if (requiredDbTokens.length === 0 && parsed.tokenGroups.length > 0) {
    const fallbackGroup = parsed.tokenGroups[0]
    const orCondition = fallbackGroup.variants.map(v => `normalized_name.ilike."%${v}%"`).join(',')
    dbQuery = dbQuery.or(orCondition)
  }

  let { data, error } = await dbQuery.limit(200)

  // CAMADA C - Fallback de RecuperaÃ§Ã£o Ampla
  // Se a busca conjunta (ex: "branca" + "cobertura") nÃ£o encontrou nada, tentamos apenas o token mais especÃ­fico.
  if ((!data || data.length === 0) && specificTokens.length > 0 && requiredDbTokens.length > 1) {
    const fallbackToken = specificTokens[0]
    let fallbackQuery = supabase
      .from('products')
      .select(`id, name, sku, barcode, unit, active, normalized_name, product_brands ( name ), product_categories ( name )`)
      .eq('company_id', companyId)
      .eq('active', true)
      
    const orCondition = fallbackToken.variants.map(v => `normalized_name.ilike."%${v}%"`).join(',')
    fallbackQuery = fallbackQuery.or(orCondition)
    
    const { data: fallbackData, error: fallbackError } = await fallbackQuery.limit(200)
    data = fallbackData
    error = fallbackError
  }

  if (error || !data || data.length === 0) {
    return { status: 'not_found', confidence: 0, matches: [] }
  }

  const isBulkRegex = /(?:^|[^0-9])\s+KG(?:\s|$)/i
  const validProducts = data.filter((row: any) => !isBulkRegex.test(row.name))

  // 3. Ranking e Avaliao de Confiana
  const scoredProducts = validProducts.map((row: any) => {
    const brand = row.product_brands?.name || null
    const category = row.product_categories?.name || null
    const { score, confidence } = calculateMatchScore(row.normalized_name, brand, category, parsed)
    
    return {
      product: mapProductRow(row),
      score,
      confidence
    }
  })

  // Ordena pelo maior score
  scoredProducts.sort((a, b) => b.score - a.score)
  
  // 4. Resolve Status e Ambiguidade
  const bestMatch = scoredProducts[0]
  
  if (!bestMatch || bestMatch.score <= 0 || bestMatch.confidence < 0.4) {
    return { status: 'not_found', confidence: 0, matches: [] }
  }

  // Define os candidatos relevantes (aqueles que esto prximos do melhor score)
  const threshold = bestMatch.score > 20 ? bestMatch.score - 5 : bestMatch.score
  const candidates = scoredProducts.filter(item => item.score >= threshold)

  let status: 'exact_match' | 'ambiguous' | 'not_found' = 'exact_match'

  if (candidates.length > 1) {
    // Se temos mltiplos candidatos excelentes empatados ou quase empatados, Ç¸ ambguo
    status = 'ambiguous'
  } else if (bestMatch.confidence < 0.8) {
    // Se a confiana Ç¸ mÇ¸dia (ex: acertou a marca mas errou o peso ou faltou algo), nÇœo afirmamos match exato
    status = 'ambiguous'
  }

    // 5. Diversidade Determinística
  // Intercala marcas dentro de cada faixa de pontuação para evitar monopólio de uma única marca
  const diverseMatches = []
  const scoreTiers = Array.from(new Set(candidates.map(c => c.score))).sort((a,b) => b - a)
  
  for (const score of scoreTiers) {
    let tierCandidates = candidates.filter(c => c.score === score)
    while (tierCandidates.length > 0) {
      const brandsInRound = new Set<string | null>()
      const nextRemaining = []
      
      for (const c of tierCandidates) {
        if (!brandsInRound.has(c.product.brand)) {
          brandsInRound.add(c.product.brand)
          diverseMatches.push(c)
        } else {
          nextRemaining.push(c)
        }
      }
      tierCandidates = nextRemaining
    }
  }

  // Reduzir carga para o LLM enviando no limite
  const finalMatches = diverseMatches.slice(0, maxLimit).map(c => ({
    ...c.product,
    match_score: c.score
  }))

  return {
    status,
    confidence: bestMatch.confidence,
    matches: finalMatches
  }
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
