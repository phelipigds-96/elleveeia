-- Migration: 2026110701_workflow_stages_handled_by_and_color.sql
-- Marco 1 — Personalização de funis Kanban por empresa (Parte 1: modelo de dados)
--
-- Objetivo:
--   1. Adicionar `color` (cor da coluna no Kanban) e `handled_by` (quem conduz a etapa)
--      à tabela `workflow_stages`.
--   2. Preservar integralmente o enum existente `stage_type` ('initial' | 'in_progress' | 'final'),
--      que continua sendo a única fonte de verdade para a sincronização com
--      `conversations.status` / `assigned_to` (ver moveConversationStage).
--   3. Nenhuma empresa é afetada por outras: a configuração é sempre por `company_id`.
--
-- Compatibilidade:
--   - Colunas novas são aditivas, com DEFAULT, portanto nao quebram inserts legados
--     nem o enum `stage_type` (que não é alterado).
--   - A migração é idempotente (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS).

-- ---------------------------------------------------------------------------
-- 1. Novas colunas
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflow_stages
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#64748b';

ALTER TABLE public.workflow_stages
  ADD COLUMN IF NOT EXISTS handled_by TEXT DEFAULT 'human';

-- ---------------------------------------------------------------------------
-- 2. Constraint de domínio de `handled_by`
-- ---------------------------------------------------------------------------
ALTER TABLE public.workflow_stages
  DROP CONSTRAINT IF EXISTS ck_workflow_stages_handled_by;

ALTER TABLE public.workflow_stages
  ADD CONSTRAINT ck_workflow_stages_handled_by
  CHECK (handled_by IS NULL OR handled_by IN ('ai', 'human', 'waiting'));

-- ---------------------------------------------------------------------------
-- 3. Backfill inteligente dos registros existentes
--    - initial     -> 'ai'    (fila conduzida pela IA)
--    - in_progress -> 'human' (atendimento humano)
--    - final       -> 'human' (encerramento humano)
--    Valores já válidos ('waiting') são preservados.
--
--    ATENÇÃO: o DEFAULT 'human' da coluna já preencheu as linhas existentes,
--    portanto o backfill NÃO pode depender de `handled_by IS NULL`. A regra
--    abaixo reescreve o valor a partir de `stage_type`, preservando apenas
--    as linhas explicitamente marcadas como 'waiting'.
-- ---------------------------------------------------------------------------
UPDATE public.workflow_stages
SET handled_by = CASE stage_type
      WHEN 'initial' THEN 'ai'
      WHEN 'in_progress' THEN 'human'
      WHEN 'final' THEN 'human'
      ELSE 'human'
    END
WHERE handled_by IS DISTINCT FROM 'waiting'
  AND handled_by IS DISTINCT FROM CASE stage_type
        WHEN 'initial' THEN 'ai'
        WHEN 'in_progress' THEN 'human'
        WHEN 'final' THEN 'human'
        ELSE 'human'
      END;

UPDATE public.workflow_stages
SET color = '#64748b'
WHERE color IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Metadados
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.workflow_stages.color IS
  'Cor hexadecimal (ex.: #eab308) exibida no cabeçalho da coluna do Kanban. Afeta apenas a apresentação.';

COMMENT ON COLUMN public.workflow_stages.handled_by IS
  'Responsável operacional pela etapa: ai (conduzida pela IA), human (atendente) ou waiting (aguardando terceiros). Não substitui stage_type.';

-- ---------------------------------------------------------------------------
-- 5. Verificação pós-migração: nenhuma linha inválida deve permanecer
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workflow_stages
    WHERE handled_by IS NOT NULL
      AND handled_by NOT IN ('ai', 'human', 'waiting')
  ) THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: workflow_stages.handled_by possui valores fora do domínio (ai|human|waiting).';
  END IF;
END $$;
