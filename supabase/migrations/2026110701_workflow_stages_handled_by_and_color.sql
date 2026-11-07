-- Migration: 2026110701_workflow_stages_handled_by_and_color.sql
-- Description: Adds visual color and operational responsibility (handled_by) to workflow_stages

ALTER TABLE workflow_stages 
ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#64748b',
ADD COLUMN IF NOT EXISTS handled_by TEXT DEFAULT 'human';

DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_stages_handled_by'
  ) THEN 
    ALTER TABLE workflow_stages 
    ADD CONSTRAINT chk_workflow_stages_handled_by 
    CHECK (handled_by IN ('ai', 'human', 'waiting'));
  END IF; 
END $$;

-- Backfill existing default stages with meaningful colors and responsibility
UPDATE workflow_stages SET 
  handled_by = CASE 
    WHEN stage_type = 'initial' THEN 'ai'
    WHEN stage_type = 'in_progress' THEN 'human'
    WHEN stage_type = 'final' THEN 'human'
    ELSE 'human'
  END,
  color = CASE 
    WHEN stage_type = 'initial' THEN '#eab308'
    WHEN stage_type = 'in_progress' THEN '#3b82f6'
    WHEN stage_type = 'final' THEN '#22c55e'
    ELSE '#64748b'
  END
WHERE color IS NULL OR color = '#64748b' OR handled_by IS NULL;
