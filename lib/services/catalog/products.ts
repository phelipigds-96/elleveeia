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

export interface PackageFactorResult {
  factor: number | null
  source: 'metadata' | 'package_description' | 'name' | null
  confidence: 'exact' | 'probable' | 'unconfirmed'
}

/**
 * Extrai o fator de embalagem (unidades internas por caixa/fardo/pacote)
 * com validação estrita e determinística.
 */
export function extractProductPackageFactor(product: {
  name?: string
  unit?: string | null
  package_description?: string | null
  metadata?: any
}): PackageFactorResult {
  if (!product) {
    return { factor: null, source: null, confidence: 'unconfirmed' }
  }

  // 1. Metadata explícito do produto (ex: { package_factor: 27 }, { units_per_package: 27 }, { fator_conversao: 27 })
  const metaFactor = product.metadata?.package_factor 
    ?? product.metadata?.units_per_package 
    ?? product.metadata?.fator_conversao
    ?? product.metadata?.itens_por_caixa
  if (typeof metaFactor === 'number' && metaFactor > 1 && metaFactor <= 1000) {
    return { factor: Math.round(metaFactor), source: 'metadata', confidence: 'exact' }
  }

  // 2. package_description (ex: "Caixa com 27 unidades", "Cx c/ 27 latas", "Fardo c/ 6", "Pacote com 10")
  if (product.package_description && typeof product.package_description === 'string') {
    const desc = product.package_description.trim()
    const descMatch = desc.match(/\b(?:c\/|com|contem|cx|caixa|fd|fardo|pct|pacote)\s*(\d+)\s*(?:un|und|unidades?|latas?|barras?|saches?|pcts?|itens?)?\b/i)
      || desc.match(/\b(\d+)\s*(?:un|und|unidades?|latas?|barras?|saches?|pcts?|itens?)\b/i)
    if (descMatch) {
      const val = parseInt(descMatch[1], 10)
      if (val > 1 && val <= 1000) {
        return { factor: val, source: 'package_description', confidence: 'exact' }
      }
    }
  }

  // 3. Extração a partir do nome do produto (ex: "CX 27X395G", "C/ 24 UN", "CX COM 27", "FD C/ 6 UN", "DISPLAY 12X")
  if (product.name && typeof product.name === 'string') {
    const name = product.name
    // Padrão multiplicador "27X395G", "12X90G", "6X1KG"
    const multMatch = name.match(/\b(\d+)\s*x\s*\d+\s*(?:g|kg|ml|l|mg)?\b/i)
    if (multMatch) {
      const val = parseInt(multMatch[1], 10)
      if (val > 1 && val <= 1000) {
        return { factor: val, source: 'name', confidence: 'exact' }
      }
    }

    // Padrão explícito "CX C/ 27", "FD C/ 6", "C/ 24 UN", "CX 27 UN"
    const cMatch = name.match(/\b(?:c\/|com|cx|caixa|fd|fardo|pct|pacote)\s*(\d+)\s*(?:un|und|unidades?|latas?|barras?|saches?)?\b/i)
    if (cMatch) {
      const val = parseInt(cMatch[1], 10)
      if (val > 1 && val <= 1000) {
        return { factor: val, source: 'name', confidence: 'probable' }
      }
    }
  }

  return { factor: null, source: null, confidence: 'unconfirmed' }
}

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
  packageDescription?: string | null
  packageFactor?: number | null
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
      .select(`id, name, sku, barcode, unit, package_description, metadata, active, company_id, product_brands ( name ), product_categories ( name )`)
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
          packageDescription: p.package_description || null,
          packageFactor: p.package_factor || null,
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
    .select(`id, name, sku, barcode, unit, package_description, metadata, active, normalized_name, company_id, product_brands ( name ), product_categories ( name )`)
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

  let { data, error } = await dbQuery.limit(500)

  // Fallback se nada foi retornado: tenta apenas o primeiro token específico
  if ((!data || data.length === 0) && tokensList.length > 0) {
    const fallbackToken = tokensList[0].replace(/["\\]/g, '').trim()
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('products')
      .select(`id, name, sku, barcode, unit, package_description, metadata, active, normalized_name, company_id, product_brands ( name ), product_categories ( name )`)
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
    packageDescription: m.packageDescription || null,
    packageFactor: m.packageFactor || null,
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
  const pkgFactorInfo = extractProductPackageFactor({
    name: row.name,
    unit: row.unit,
    package_description: row.package_description,
    metadata: row.metadata
  })

  return {
    id: row.id,
    name: normalizeCatalogName(row.name),
    sku: row.sku || null,
    barcode: row.barcode || null,
    unit: row.unit || null,
    package_description: row.package_description || null,
    package_factor: pkgFactorInfo.factor,
    metadata: row.metadata || {},
    active: row.active !== false,
    company_id: row.company_id,
    brand: row.product_brands?.name || null,
    category: row.product_categories?.name || null
  }
}

export const normalizeCatalogProductName = normalizeCatalogName
