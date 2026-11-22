import { createAdminClient } from '@/lib/supabase/service'
import { parseQuery } from './search-logic'
import { parseStructuredQuery, type StructuredParsedQuery } from './query-parser'
import { 
  rankProductsIntelligently, 
  normalizeCatalogName,
  type StructuredProductMatch, 
  type IntelligentSearchResponse,
  type StructuredProductCandidate 
} from './search-engine'

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
  matchType?: 'exact_match' | 'probable_match' | 'compatible_alternative' | 'ambiguous' | 'not_found'
  verifiedAttributes?: any
  justification?: string
}

export interface StructuredSearchResponse {
  status: 'exact_match' | 'probable_match' | 'compatible_alternative' | 'ambiguous' | 'not_found'
  confidence: number
  matches: ProductSearchResult[]
  differentiatingQuestion?: string
  alternativeRecommendation?: any
  parsedQuery?: any
}

export async function searchProducts(
  companyId: string, 
  query: string, 
  limit: number = 10
): Promise<StructuredSearchResponse> {
  const supabase = createAdminClient()
  const structuredParsed = parseStructuredQuery(query)
  const parsed = parseQuery(query)

  if (!structuredParsed.normalizedQuery || structuredParsed.normalizedQuery.trim() === '') {
    return { status: 'not_found', confidence: 0, matches: [] }
  }

  const maxLimit = Math.min(limit, 20)

  // 1. Identificadores exatos (Código de barras ou SKU)
  if (structuredParsed.identifiers.length > 0) {
    const cleanId = structuredParsed.identifiers[0].replace(/["\\]/g, '').trim()
    const { data: exactData } = await supabase
      .from('products')
      .select(`id, name, sku, barcode, unit, active, company_id, product_brands ( name ), product_categories ( name )`)
      .eq('company_id', companyId)
      .eq('active', true)
      .or(`barcode.eq."${cleanId}",sku.ilike."${cleanId}"`)
      .limit(1)
      
    if (exactData && exactData.length > 0) {
      const p = mapCandidateRow(exactData[0])
      return {
        status: 'exact_match',
        confidence: 1.0,
        matches: [{
          id: p.id,
          name: p.name,
          sku: p.sku || null,
          barcode: p.barcode || null,
          brand: p.brand,
          category: p.category,
          unit: p.unit,
          active: p.active !== false,
          match_score: 100,
          matchType: 'exact_match',
          justification: `Correspondência exata por código (${cleanId})`
        }],
        parsedQuery: structuredParsed
      }
    }
  }

  // 2. Candidate Retrieval no banco (PostgreSQL)
  // Reúne tokens da consulta estruturada e tokens legados
  const candidateTokens = new Set<string>()

  // Tokens significativos
  for (const t of structuredParsed.significantTokens) {
    if (t.length >= 3) candidateTokens.add(t)
  }

  // Marca identificada e variantes
  if (structuredParsed.brand) {
    candidateTokens.add(structuredParsed.brand.toLowerCase())
  }

  // Sabor / variante
  if (structuredParsed.flavor) {
    candidateTokens.add(structuredParsed.flavor.toLowerCase())
  }

  // Tokens legados
  const specificTokens = parsed.tokenGroups.filter(g => !g.isGeneric && !g.isUnit)
  for (const g of specificTokens) {
    for (const v of g.variants) {
      if (v.length >= 3) candidateTokens.add(v)
    }
  }

  // Se houver poucos tokens, inclui categorias ou genéricos
  if (candidateTokens.size < 2) {
    const genericTokens = parsed.tokenGroups.filter(g => g.isGeneric)
    for (const g of genericTokens) {
      for (const v of g.variants) {
        if (v.length >= 3) candidateTokens.add(v)
      }
    }
  }

  let dbQuery = supabase
    .from('products')
    .select(`id, name, sku, barcode, unit, active, normalized_name, company_id, product_brands ( name ), product_categories ( name )`)
    .eq('company_id', companyId)
    .eq('active', true)

  const tokensList = Array.from(candidateTokens).slice(0, 6)
  if (tokensList.length > 0) {
    const orCondition = tokensList
      .map(t => t.replace(/["\\]/g, '').trim())
      .filter(t => t.length > 0)
      .map(t => `normalized_name.ilike."%${t}%"`)
      .join(',')
    if (orCondition) {
      dbQuery = dbQuery.or(orCondition)
    }
  }

  // Se a consulta for sobre aplicação de casquinha/moldagem, garante recuperação de coberturas e chocolates
  if (structuredParsed.application === 'casquinha' || parsed.applicationNeed === 'casquinha') {
    dbQuery = dbQuery.or('normalized_name.ilike."%cobertura%",normalized_name.ilike."%chocolate%"')
  }

  let { data, error } = await dbQuery.limit(200)

  // Fallback se nada foi retornado: tenta apenas o primeiro token específico
  if ((!data || data.length === 0) && tokensList.length > 0) {
    const fallbackToken = tokensList[0].replace(/["\\]/g, '').trim()
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('products')
      .select(`id, name, sku, barcode, unit, active, normalized_name, company_id, product_brands ( name ), product_categories ( name )`)
      .eq('company_id', companyId)
      .eq('active', true)
      .or(`normalized_name.ilike."%${fallbackToken}%"`)
      .limit(100)
    data = fallbackData
    error = fallbackError
  }

  if (error || !data || data.length === 0) {
    return { status: 'not_found', confidence: 0, matches: [], parsedQuery: structuredParsed }
  }

  const isBulkRegex = /(?:^|[^0-9])\s+KG(?:\s|$)/i
  const validProducts = data.filter((row: any) => !isBulkRegex.test(row.name))

  if (validProducts.length === 0) {
    return { status: 'not_found', confidence: 0, matches: [], parsedQuery: structuredParsed }
  }

  // 3. Execução do Intelligent Search Engine com Ranking Determinístico
  const candidates: StructuredProductCandidate[] = validProducts.map(mapCandidateRow)
  const rankedResponse = rankProductsIntelligently(query, candidates)

  // Mapeia os matches para a interface ProductSearchResult com compatibilidade total
  const matches: ProductSearchResult[] = rankedResponse.matches.slice(0, maxLimit).map(m => ({
    id: m.id,
    name: m.name,
    sku: m.sku,
    barcode: m.barcode,
    brand: m.brand,
    category: m.category,
    unit: m.unit,
    active: m.active,
    match_score: m.score,
    matchType: m.matchType,
    verifiedAttributes: m.verifiedAttributes,
    justification: m.justification
  }))

  return {
    status: rankedResponse.status,
    confidence: rankedResponse.confidence,
    matches,
    differentiatingQuestion: rankedResponse.differentiatingQuestion,
    alternativeRecommendation: rankedResponse.alternativeRecommendation,
    parsedQuery: structuredParsed
  }
}

function mapCandidateRow(row: any): StructuredProductCandidate {
  return {
    id: row.id,
    name: normalizeCatalogName(row.name),
    sku: row.sku || null,
    barcode: row.barcode || null,
    unit: row.unit || null,
    active: row.active !== false,
    company_id: row.company_id,
    brand: row.product_brands?.name || null,
    category: row.product_categories?.name || null
  }
}

export const normalizeCatalogProductName = normalizeCatalogName
