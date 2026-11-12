-- ==============================================================================
-- Migration: 2026111202_enterprise_observability_3a.sql
-- Etapa 3A: Observabilidade Operacional do Motor & Dead Letter Queue (SuperAdmin)
-- ==============================================================================
-- Totalmente aditiva e retrocompatível:
--   1. Cria `public.cron_execution_logs` para persistir histórico real do worker.
--   2. Aplica RLS fail-closed (apenas `service_role` grava; `is_platform_admin()` lê).
--   3. Cria índices parciais leves para leitura O(k) da Dead Letter Queue (DLQ)
--      em `message_outbox` e `webhook_events`.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.cron_execution_logs (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name                  TEXT NOT NULL DEFAULT 'outbox-worker',
  method                       TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'MANUAL')),
  status                       TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  http_status                  INTEGER NOT NULL DEFAULT 200,
  duration_ms                  INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  outbox_processed             INTEGER NOT NULL DEFAULT 0,
  outbox_succeeded             INTEGER NOT NULL DEFAULT 0,
  outbox_failed                INTEGER NOT NULL DEFAULT 0,
  outbox_suppressed            INTEGER NOT NULL DEFAULT 0,
  outbox_deferred              INTEGER NOT NULL DEFAULT 0,
  webhook_processed            INTEGER NOT NULL DEFAULT 0,
  webhook_recovered_ingest     INTEGER NOT NULL DEFAULT 0,
  webhook_recovered_autonomous INTEGER NOT NULL DEFAULT 0,
  webhook_deferred             INTEGER NOT NULL DEFAULT 0,
  webhook_failed               INTEGER NOT NULL DEFAULT 0,
  error_message                TEXT,
  details                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_worker_created
  ON public.cron_execution_logs (worker_name, created_at DESC);

ALTER TABLE public.cron_execution_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins view cron execution logs" ON public.cron_execution_logs;
CREATE POLICY "Platform admins view cron execution logs"
  ON public.cron_execution_logs
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

REVOKE ALL ON public.cron_execution_logs FROM PUBLIC, anon;
GRANT SELECT ON public.cron_execution_logs TO authenticated;
GRANT ALL ON public.cron_execution_logs TO service_role;

-- Índices parciais para consulta rápida da Dead Letter Queue no SuperAdmin
CREATE INDEX IF NOT EXISTS idx_message_outbox_dead_letter
  ON public.message_outbox (updated_at DESC)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_webhook_events_dead_letter
  ON public.webhook_events (updated_at DESC)
  WHERE status = 'error' OR autonomous_status = 'failed';

COMMENT ON TABLE public.cron_execution_logs IS
  'Histórico operacional das execuções do worker de reconciliação (outbox e webhook recovery) para observabilidade no SuperAdmin.';
