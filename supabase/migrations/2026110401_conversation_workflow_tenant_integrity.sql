-- ==============================================================================
-- ETAPA 8.4.3P — INTEGRIDADE REFERENCIAL MULTI-TENANT DE WORKFLOWS E KANBAN
-- Arquivo: supabase/migrations/20261104_conversation_workflow_tenant_integrity.sql
-- ==============================================================================
-- Objetivo:
-- 1. Pré-auditar dados preexistentes em public.conversations abortando a execução
--    caso existam inconsistências (sem expurgo ou mutação automática).
-- 2. Implementar trigger BEFORE INSERT OR UPDATE na tabela public.conversations
--    para blindar a integridade referencial entre empresa (company_id),
--    workflow (workflow_id) e etapa (workflow_stage_id), mesmo sob service_role.
-- 3. Desvincular explicitamente conversas via trigger BEFORE DELETE em public.workflows,
--    eliminando dependências frágeis de profundidade de execução
--    e garantindo compatibilidade atômica com ON DELETE CASCADE e ON DELETE SET NULL.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: PRÉ-AUDITORIA DETERMINÍSTICA DE REGISTROS PREEXISTENTES
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_cross_tenant_wf_count INTEGER;
  v_cross_tenant_stage_count INTEGER;
  v_stage_wf_mismatch_count INTEGER;
  v_orphan_stage_count INTEGER;
BEGIN
  -- 1. Conversas associadas a workflows de outra empresa
  SELECT COUNT(*) INTO v_cross_tenant_wf_count
  FROM public.conversations c
  JOIN public.workflows w ON w.id = c.workflow_id
  WHERE w.company_id != c.company_id;

  -- 2. Conversas associadas a etapas de outra empresa
  SELECT COUNT(*) INTO v_cross_tenant_stage_count
  FROM public.conversations c
  JOIN public.workflow_stages s ON s.id = c.workflow_stage_id
  WHERE s.company_id != c.company_id;

  -- 3. Conversas associadas a uma etapa que pertence a outro workflow
  SELECT COUNT(*) INTO v_stage_wf_mismatch_count
  FROM public.conversations c
  JOIN public.workflow_stages s ON s.id = c.workflow_stage_id
  WHERE c.workflow_id IS NOT NULL AND s.workflow_id != c.workflow_id;

  -- 4. Conversas com etapa definida cujo ID não existe em workflow_stages
  SELECT COUNT(*) INTO v_orphan_stage_count
  FROM public.conversations c
  LEFT JOIN public.workflow_stages s ON s.id = c.workflow_stage_id
  WHERE c.workflow_stage_id IS NOT NULL AND s.id IS NULL;

  -- Se existirem inconsistências, aborta a migration com diagnóstico informativo
  IF v_cross_tenant_wf_count > 0 OR v_cross_tenant_stage_count > 0 OR v_stage_wf_mismatch_count > 0 OR v_orphan_stage_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: Inconsistências encontradas em public.conversations. Diagnóstico: cross_tenant_wf=%, cross_tenant_stage=%, stage_wf_mismatch=%, orphan_stage=%. Nenhuma alteração foi realizada. Execute o script supabase/scripts/audit_conversation_workflow_integrity.sql para auditar os registros.',
      v_cross_tenant_wf_count, v_cross_tenant_stage_count, v_stage_wf_mismatch_count, v_orphan_stage_count;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PARTE 2: FUNÇÃO DE TRIGGER COM SECURITY DEFINER E SEARCH_PATH SEGURO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_conversation_workflow_tenant_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_stage_workflow_id UUID;
  v_stage_company_id UUID;
  v_wf_company_id UUID;
BEGIN
  -- Cenário 1: Conversa sem workflow e sem etapa (estado nulo válido)
  IF NEW.workflow_id IS NULL AND NEW.workflow_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cenário 2: Validação da Etapa (se informada)
  IF NEW.workflow_stage_id IS NOT NULL THEN
    SELECT workflow_id, company_id
    INTO v_stage_workflow_id, v_stage_company_id
    FROM public.workflow_stages
    WHERE id = NEW.workflow_stage_id;

    -- Etapa inexistente ou de outra empresa
    IF v_stage_company_id IS NULL OR v_stage_company_id != NEW.company_id THEN
      RAISE EXCEPTION 'Violação de integridade multi-tenant: a etapa de atendimento (workflow_stage_id) não existe ou não pertence à mesma empresa da conversa.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Avaliação quando workflow_id é nulo
    IF NEW.workflow_id IS NULL THEN
      -- Se for INSERT ou se a conversa estiver recebendo uma nova etapa (movimentação normal):
      IF TG_OP = 'INSERT' OR (OLD.workflow_stage_id IS DISTINCT FROM NEW.workflow_stage_id) THEN
        -- Sincroniza automaticamente o workflow_id com o workflow da etapa
        NEW.workflow_id := v_stage_workflow_id;
      ELSE
        -- Tentativa manual de anular workflow_id mantendo a etapa vinculada (inconsistência operacional)
        RAISE EXCEPTION 'Violação de integridade de workflow: não é permitido anular o workflow (workflow_id = NULL) enquanto a conversa mantém uma etapa vinculada. Para desvincular o workflow, anule também a etapa (workflow_stage_id = NULL) ou use uma etapa válida.'
          USING ERRCODE = 'P0001';
      END IF;
    -- Se a conversa já possuía workflow_id associado, valida coerência referencial
    ELSIF NEW.workflow_id != v_stage_workflow_id THEN
      RAISE EXCEPTION 'Violação de integridade de workflow: a etapa informada (workflow_stage_id) pertence a outro workflow e não corresponde ao workflow associado à conversa (workflow_id).'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Cenário 3: Validação do Workflow quando etapa for nula (estado válido de conversa no início do funil sem etapa inicial)
  IF NEW.workflow_id IS NOT NULL AND NEW.workflow_stage_id IS NULL THEN
    SELECT company_id
    INTO v_wf_company_id
    FROM public.workflows
    WHERE id = NEW.workflow_id;

    -- Workflow inexistente ou de outra empresa
    IF v_wf_company_id IS NULL OR v_wf_company_id != NEW.company_id THEN
      RAISE EXCEPTION 'Violação de integridade multi-tenant: o workflow associado (workflow_id) não existe ou não pertence à mesma empresa da conversa.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- PARTE 3: ATIVAÇÃO DA TRIGGER NA TABELA public.conversations
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_check_conversation_workflow_tenant_integrity ON public.conversations;

CREATE TRIGGER trg_check_conversation_workflow_tenant_integrity
BEFORE INSERT OR UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.check_conversation_workflow_tenant_integrity();

COMMENT ON FUNCTION public.check_conversation_workflow_tenant_integrity() IS 
  'Garante integridade referencial multi-tenant entre conversas, workflows e etapas de funil Kanban, mesmo sob service_role.';

COMMENT ON TRIGGER trg_check_conversation_workflow_tenant_integrity ON public.conversations IS 
  'Trigger de barreira que bloqueia cross-tenant workflow/stage e inconsistências entre etapa e funil.';

-- ------------------------------------------------------------------------------
-- PARTE 4: TRIGGER BEFORE DELETE EM public.workflows PARA DESVINCULAÇÃO ATÔMICA
-- ------------------------------------------------------------------------------
-- Remove o acoplamento de conversas antes da exclusão física do workflow,
-- desvinculando atomicamente workflow_id e workflow_stage_id. Isso elimina
-- completamente a necessidade de heurísticas frágeis de profundidade de execução
-- e assegura que nenhuma conversa viole chaves estrangeiras durante o CASCADE/SET NULL.
CREATE OR REPLACE FUNCTION public.unlink_conversations_before_workflow_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Desvincula atomicamente todas as conversas vinculadas a este workflow
  -- ou a qualquer uma de suas etapas antes que a exclusão física ocorra.
  UPDATE public.conversations
  SET workflow_id = NULL,
      workflow_stage_id = NULL
  WHERE workflow_id = OLD.id
     OR workflow_stage_id IN (
       SELECT id FROM public.workflow_stages WHERE workflow_id = OLD.id
     );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_unlink_conversations_before_workflow_delete ON public.workflows;

CREATE TRIGGER trg_unlink_conversations_before_workflow_delete
BEFORE DELETE ON public.workflows
FOR EACH ROW
EXECUTE FUNCTION public.unlink_conversations_before_workflow_delete();

COMMENT ON FUNCTION public.unlink_conversations_before_workflow_delete() IS 
  'Desvincula atomicamente conversas associadas a um workflow e suas etapas antes da exclusão.';

COMMENT ON TRIGGER trg_unlink_conversations_before_workflow_delete ON public.workflows IS 
  'Trigger de barreira pré-exclusão que desacopla atomicamente conversas de workflows a serem excluídos.';
