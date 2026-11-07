-- Marco 1 - Personalização de funis Kanban por empresa
-- Adiciona cor e responsável (IA/Humano/Aguardando) às etapas de workflow,
-- preservando o enum existente stage_type ('initial' | 'in_progress' | 'final').

ALTER TABLE public.workflow_stages
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#64748b';

ALTER TABLE public.workflow_stages
  ADD COLUMN IF NOT EXISTS handled_by TEXT DEFAULT 'human';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.workflow_stages'::regclass
      AND conname = 'ck_workflow_stages_handled_by'
  ) THEN
    ALTER TABLE public.workflow_stages
      ADD CONSTRAINT ck_workflow_stages_handled_by
      CHECK (handled_by IS NULL OR handled_by IN ('ai', 'human', 'waiting'));
  END IF;
END $$;

-- Backfill inteligente: deriva o responsável do tipo de etapa já existente.
UPDATE public.workflow_stages
SET handled_by = CASE
    WHEN stage_type = 'initial' THEN 'ai'
    WHEN stage_type = 'in_progress' THEN 'human'
    WHEN stage_type = 'final' THEN 'human'
    ELSE 'human'
  END
WHERE handled_by IS NULL;

-- Colunas que já existiam sem valor explícito herdam o default da coluna.
UPDATE public.workflow_stages
SET color = '#64748b'
WHERE color IS NULL;

COMMENT ON COLUMN public.workflow_stages.color IS
  'Cor hexadecimal (ex.: #3b82f6) usada na coluna do funil Kanban.';
COMMENT ON COLUMN public.workflow_stages.handled_by IS
  'Responsavel da etapa: ai | human | waiting.';
