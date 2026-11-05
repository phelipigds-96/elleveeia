-- ==============================================================================
-- AUDITORIA ARQUITETURAL: FUNDAÇÃO PARA O AGENT ENGINE (MULTI-SEGMENTO)
-- ==============================================================================
-- Esta migration prepara o esquema do banco para a Fase 7, garantindo a
-- escalabilidade Company -> Agents -> Tools, sem acoplar a empresa a um único
-- agente global.

CREATE TABLE IF NOT EXISTS public.agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  segment TEXT, -- Classificação livre do negócio (ex: 'consultorio', 'salao', 'loja')
  personality TEXT, -- Comportamento e tom de voz
  instructions TEXT, -- System prompt base
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb, -- Configurações genéricas extras
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_agents_company_id ON public.agents(company_id);

-- Preparar a tabela de conversas para registrar qual agente a atendeu
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_agent_id ON public.conversations(agent_id);

-- Segurança e Isolamento Multi-tenant (RLS)
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users view own company agents" 
    ON public.agents FOR SELECT 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own company agents" 
    ON public.agents FOR ALL 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Observação: Ferramentas (tools) e vinculação Agent <-> Tools serão criadas
-- no momento de sua efetiva implementação (Fase 7+), pois podem depender da
-- modelagem escolhida (tabela própria ou array no JSONB).
