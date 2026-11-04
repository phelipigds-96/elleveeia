-- ==============================================================================
-- ETAPA 8.4.3P — SCRIPT DE AUDITORIA OPERACIONAL DE INTEGRIDADE DE WORKFLOWS
-- Arquivo: supabase/scripts/audit_conversation_workflow_integrity.sql
-- ==============================================================================
-- Uso: Executar em caso de falha de validação pré-migration para inspecionar
--      conversas com inconsistências de tenant, workflow ou etapa no banco.
-- Operação estritamente de LEITURA (READ-ONLY).
-- ==============================================================================

-- 1. Resumo quantitativo de inconsistências
SELECT 
  (SELECT COUNT(*) FROM public.conversations c 
   JOIN public.workflows w ON w.id = c.workflow_id 
   WHERE w.company_id != c.company_id) AS cross_tenant_workflow_count,

  (SELECT COUNT(*) FROM public.conversations c 
   JOIN public.workflow_stages s ON s.id = c.workflow_stage_id 
   WHERE s.company_id != c.company_id) AS cross_tenant_stage_count,

  (SELECT COUNT(*) FROM public.conversations c 
   JOIN public.workflow_stages s ON s.id = c.workflow_stage_id 
   WHERE c.workflow_id IS NOT NULL AND s.workflow_id != c.workflow_id) AS stage_workflow_mismatch_count,

  (SELECT COUNT(*) FROM public.conversations c 
   LEFT JOIN public.workflow_stages s ON s.id = c.workflow_stage_id 
   WHERE c.workflow_stage_id IS NOT NULL AND s.id IS NULL) AS orphan_stage_count;

-- 2. Detalhamento de conversas com workflow de outra empresa
SELECT 
  c.id AS conversation_id,
  c.company_id AS conversation_company_id,
  c.workflow_id,
  w.company_id AS workflow_company_id,
  c.created_at AS conversation_created_at
FROM public.conversations c
JOIN public.workflows w ON w.id = c.workflow_id
WHERE w.company_id != c.company_id;

-- 3. Detalhamento de conversas com etapa de outra empresa
SELECT 
  c.id AS conversation_id,
  c.company_id AS conversation_company_id,
  c.workflow_stage_id,
  s.company_id AS stage_company_id,
  c.created_at AS conversation_created_at
FROM public.conversations c
JOIN public.workflow_stages s ON s.id = c.workflow_stage_id
WHERE s.company_id != c.company_id;

-- 4. Detalhamento de conversas com etapa associada a outro workflow
SELECT 
  c.id AS conversation_id,
  c.company_id,
  c.workflow_id AS conversation_workflow_id,
  c.workflow_stage_id,
  s.workflow_id AS stage_workflow_id,
  c.created_at AS conversation_created_at
FROM public.conversations c
JOIN public.workflow_stages s ON s.id = c.workflow_stage_id
WHERE c.workflow_id IS NOT NULL AND s.workflow_id != c.workflow_id;
