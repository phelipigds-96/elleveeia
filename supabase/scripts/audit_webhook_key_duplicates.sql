-- ============================================================================
-- SCRIPT DE AUDITORIA: PRÉ-VERIFICAÇÃO DE CHAVES AUTOMÁTICAS DUPLICADAS
-- ============================================================================
-- OBJETIVO:
--   Mapear e auditar todas as empresas que possuem duplicatas de
--   "Chave Automatica Webhook" antes da aplicação da migration de unicidade:
--   supabase/migrations/20261103_api_keys_webhook_uniqueness.sql
--
-- REGRAS E GARANTIAS DE SEGURANÇA:
--   1. Operação estritamente de LEITURA (SELECT puro).
--   2. NÃO exibe valores de chaves (segredos/tokens) para evitar vazamento em logs.
--   3. Apresenta IDs, datas de criação e a decisão determinística da regra.
--
-- AVISO OPERACIONAL CRÍTICO:
--   A limpeza de duplicatas mantém estritamente a chave mais recente (created_at DESC, id DESC).
--   Caso um workflow ativo no n8n esteja configurado com uma das chaves mais antigas (candidatas ao expurgo),
--   o recebimento de mensagens resultará em HTTP 401 (Unauthorized) após a limpeza até que a URL/token
--   no n8n seja atualizada com o token preservado.
-- ============================================================================

WITH ranked_keys AS (
  SELECT
    id,
    company_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY company_id
      ORDER BY created_at DESC, id DESC
    ) AS ranking
  FROM public.api_keys
  WHERE description = 'Chave Automatica Webhook'
),
companies_with_duplicates AS (
  SELECT
    company_id,
    COUNT(*) AS total_auto_keys,
    MAX(CASE WHEN ranking = 1 THEN id END) AS preserved_key_id,
    MAX(CASE WHEN ranking = 1 THEN created_at END) AS preserved_created_at,
    ARRAY_AGG(id ORDER BY created_at DESC, id DESC) FILTER (WHERE ranking > 1) AS duplicate_key_ids,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', id,
        'created_at', created_at,
        'action', 'CANDIDATO_AO_EXPURGO'
      ) ORDER BY created_at DESC, id DESC
    ) FILTER (WHERE ranking > 1) AS duplicate_details
  FROM ranked_keys
  GROUP BY company_id
  HAVING COUNT(*) > 1
)
SELECT
  company_id,
  total_auto_keys,
  preserved_key_id,
  preserved_created_at,
  duplicate_key_ids,
  duplicate_details,
  'ALERTA OPERACIONAL: A exclusão dessas duplicatas invalidará integrações n8n que estejam apontando para as chaves descartadas. Atualize o n8n com a chave preservada.' AS impact_warning
FROM companies_with_duplicates
ORDER BY total_auto_keys DESC, preserved_created_at DESC;
