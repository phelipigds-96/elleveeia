-- ==============================================================================
-- ETAPA 8.4.3P.2 — SCRIPT DE AUDITORIA OPERACIONAL DE WORKFLOWS PADRÃO DUPLICADOS
-- Arquivo: supabase/scripts/audit_workflow_default_duplicates.sql
-- ==============================================================================
-- Uso: Executar em caso de falha de validação pré-migration para inspecionar
--      empresas com mais de um workflow padrão (is_default = true) no banco.
-- Operação estritamente de LEITURA (READ-ONLY).
-- ==============================================================================

-- 1. Resumo quantitativo de empresas e workflows padrão duplicados
SELECT 
  COUNT(DISTINCT company_id) AS companies_with_duplicate_default_wfs,
  COUNT(*) AS total_default_workflows_in_conflict
FROM public.workflows
WHERE is_default = true
  AND company_id IN (
    SELECT company_id 
    FROM public.workflows 
    WHERE is_default = true 
    GROUP BY company_id 
    HAVING COUNT(*) > 1
  );

-- 2. Detalhamento por empresa das duplicidades de workflow padrão
SELECT 
  w.company_id,
  c.name AS company_name,
  c.status AS company_status,
  COUNT(w.id) AS total_default_workflows,
  ARRAY_AGG(w.id ORDER BY w.created_at ASC) AS workflow_ids,
  ARRAY_AGG(w.name ORDER BY w.created_at ASC) AS workflow_names,
  MIN(w.created_at) AS first_created_at,
  MAX(w.created_at) AS last_created_at
FROM public.workflows w
LEFT JOIN public.companies c ON c.id = w.company_id
WHERE w.is_default = true
GROUP BY w.company_id, c.name, c.status
HAVING COUNT(w.id) > 1
ORDER BY total_default_workflows DESC;

-- 3. Detalhamento de cada registro conflitante
SELECT 
  w.id AS workflow_id,
  w.company_id,
  w.name,
  w.description,
  w.is_default,
  w.is_active,
  w.created_at,
  w.updated_at
FROM public.workflows w
WHERE w.is_default = true
  AND w.company_id IN (
    SELECT company_id 
    FROM public.workflows 
    WHERE is_default = true 
    GROUP BY company_id 
    HAVING COUNT(*) > 1
  )
ORDER BY w.company_id, w.created_at ASC;
