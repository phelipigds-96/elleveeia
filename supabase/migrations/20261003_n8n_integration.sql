-- Tabela para gerenciar configurações de integrações externas
CREATE TABLE IF NOT EXISTS public.integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'n8n', 'whatsapp', 'openai', etc
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'error'
  config JSONB DEFAULT '{}'::jsonb,
  credentials JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_connected_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ
);

-- Garantir que cada empresa tenha apenas uma integração ativa por tipo (ex: 1 n8n por empresa)
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_company_type ON public.integrations(company_id, type);

-- Tabela para rastreabilidade de eventos e auditoria
CREATE TABLE IF NOT EXISTS public.integration_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL, -- 'inbound', 'outbound'
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success', 'failed'
  payload_metadata JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_events_lookup ON public.integration_events(company_id, integration_id, created_at);

-- RLS
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own company integrations" 
    ON public.integrations FOR ALL 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users view own company integration events" 
    ON public.integration_events FOR SELECT 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;
