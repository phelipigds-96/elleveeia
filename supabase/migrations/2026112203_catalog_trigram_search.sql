-- ==============================================================================
-- MIGRATION: 2026112203_catalog_trigram_search.sql
-- ETAPA: AC-04.1 — Intelligent Product Search Engine
-- OBJETIVO: Habilitação de extensão pg_trgm e índices de similaridade trigram
-- NOTA DE HOMOLOGAÇÃO: Esta migration é puramente local de referência.
-- NÃO executar diretamente em ambiente remoto sem janela aprovada.
-- O motor TypeScript possui fallback in-memory completo e determinístico.
-- ==============================================================================

-- 1. Habilitar pg_trgm para cálculo nativo de similaridade trigram
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Índice GIN Trigram para busca rápida de substring e similaridade no catálogo
CREATE INDEX IF NOT EXISTS idx_products_normalized_name_trgm 
ON public.products 
USING gin (normalized_name gin_trgm_ops);

-- 3. Função RPC de busca por similaridade trigram isolada por company_id
CREATE OR REPLACE FUNCTION public.search_products_trigram(
  p_company_id uuid,
  p_search_term text,
  p_similarity_threshold float DEFAULT 0.3,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  name text,
  sku text,
  barcode text,
  unit text,
  active boolean,
  similarity_score float
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 
    p.id,
    p.name,
    p.sku,
    p.barcode,
    p.unit,
    p.active,
    similarity(p.normalized_name, p_search_term) AS similarity_score
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND p.active = true
    AND (
      p.normalized_name % p_search_term 
      OR similarity(p.normalized_name, p_search_term) >= p_similarity_threshold
    )
  ORDER BY similarity_score DESC
  LIMIT p_limit;
$$;

-- 4. Restrição de grants para usuários autenticados e service_role
REVOKE ALL ON FUNCTION public.search_products_trigram(uuid, text, float, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_trigram(uuid, text, float, int) TO authenticated, service_role;
