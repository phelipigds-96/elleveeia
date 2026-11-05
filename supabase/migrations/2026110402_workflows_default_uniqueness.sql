-- ==============================================================================
-- ETAPA 8.4.3P.2 — UNICIDADE DE WORKFLOW PADRÃO POR EMPRESA (BUG-02)
-- Arquivo: supabase/migrations/20261104_workflows_default_uniqueness.sql
-- ==============================================================================
-- Objetivo:
-- 1. Pré-auditar dados preexistentes em public.workflows abortando a execução
--    caso existam empresas com múltiplos workflows padrão (is_default = true).
-- 2. Criar índice único parcial uq_workflows_company_default para garantir
--    estruturalmente no banco de dados que cada empresa possua no máximo um
--    workflow padrão ativo/configurado.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: PRÉ-AUDITORIA DETERMINÍSTICA DE REGISTROS DUPLICADOS
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicate_companies_count INTEGER;
  v_total_duplicate_wfs INTEGER;
BEGIN
  -- Contar empresas com mais de um workflow padrão
  SELECT COUNT(*), COALESCE(SUM(wf_count), 0)
  INTO v_duplicate_companies_count, v_total_duplicate_wfs
  FROM (
    SELECT company_id, COUNT(*) AS wf_count
    FROM public.workflows
    WHERE is_default = true
    GROUP BY company_id
    HAVING COUNT(*) > 1
  ) dupes;

  -- Se existirem inconsistências, aborta a migration com diagnóstico informativo
  IF v_duplicate_companies_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: Encontradas % empresa(s) com um total de % workflows marcados como is_default = true. Nenhuma alteração foi realizada. Execute o script supabase/scripts/audit_workflow_default_duplicates.sql para auditar e regularizar os registros antes de aplicar esta migration.',
      v_duplicate_companies_count, v_total_duplicate_wfs;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PARTE 2: ÍNDICE ÚNICO PARCIAL DE WORKFLOW PADRÃO POR EMPRESA
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_company_default
ON public.workflows (company_id)
WHERE is_default = true;

-- Comentário de governança
COMMENT ON INDEX public.uq_workflows_company_default IS 
  'Garante estruturalmente que cada empresa (company_id) possua no máximo um workflow configurado como padrão (is_default = true), prevenindo condições de corrida e duplicações operacionais.';
