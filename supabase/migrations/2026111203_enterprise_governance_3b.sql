-- Etapa 3B: Governança Multi-Tenant (Custos, Quotas e Correlação End-to-End)
-- Migration 100% aditiva e idempotente para correlação de agent_runs e indexação analítica de custos/quotas.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS correlation_event_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_event_id UUID REFERENCES public.webhook_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agent_runs_correlation_event
  ON public.agent_runs (company_id, correlation_event_id)
  WHERE correlation_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_webhook_event
  ON public.agent_runs (webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_company_created
  ON public.agent_runs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_outbox_company_created
  ON public.message_outbox (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_company_created
  ON public.messages (company_id, created_at DESC);

COMMENT ON COLUMN public.agent_runs.correlation_event_id IS
  'Identificador externo do evento (event_id) para correlação ponta a ponta entre webhook_events, agent_runs, messages e message_outbox.';

COMMENT ON COLUMN public.agent_runs.webhook_event_id IS
  'FK opcional para public.webhook_events(id) originador da execução autônoma do agente.';

COMMENT ON COLUMN public.agent_runs.estimated_cost_usd IS
  'Custo estimado em USD calculado deterministicamente a partir do modelo e dos tokens de prompt/completion da execução.';
