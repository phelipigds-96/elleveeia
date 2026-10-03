-- ==============================================================================
-- FASE 7: MIGRATION PARA RASTREAMENTO E OBSERVABILIDADE DO AGENT ENGINE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- 'success', 'error', 'timeout'
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para relatórios de consumo e performance
CREATE INDEX IF NOT EXISTS idx_agent_runs_company_id ON public.agent_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON public.agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON public.agent_runs(created_at);

-- RLS
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users view own company agent runs" 
    ON public.agent_runs FOR SELECT 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Observação: Inserções na agent_runs serão primordialmente feitas via 
-- backend bypass (Service Role) no Agent Engine para maior controle, 
-- mas deixaremos o RLS seguro de visualização para o frontend.
