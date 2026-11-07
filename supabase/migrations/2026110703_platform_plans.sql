-- ==============================================================================
-- Migration: 2026110703_platform_plans.sql
-- Governança de Planos e Limites da Plataforma (SuperAdmin)
-- Suporte nativo a OpenAI por padrão com cotas e limites editáveis
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.platform_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (key IN ('trial', 'starter', 'pro', 'enterprise')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_monthly NUMERIC(10, 2) NOT NULL DEFAULT 0,
  max_monthly_messages INTEGER NOT NULL DEFAULT 5000 CHECK (max_monthly_messages >= 0),
  max_agents INTEGER NOT NULL DEFAULT 1 CHECK (max_agents >= 1),
  max_catalog_items INTEGER NOT NULL DEFAULT 10000 CHECK (max_catalog_items >= 0),
  max_monthly_quotes INTEGER NOT NULL DEFAULT 1000 CHECK (max_monthly_quotes >= 0),
  default_ai_provider TEXT NOT NULL DEFAULT 'openai' CHECK (default_ai_provider IN ('openai', 'gemini', 'hybrid')),
  default_ai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  allowed_llm_providers TEXT[] NOT NULL DEFAULT ARRAY['openai'],
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  badge TEXT,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem consultar os planos da plataforma
DROP POLICY IF EXISTS "Platform plans: read for authenticated" ON public.platform_plans;
CREATE POLICY "Platform plans: read for authenticated"
  ON public.platform_plans FOR SELECT
  TO authenticated
  USING (true);

-- Modificações restritas a Superadministradores da plataforma via service_role ou verificação
DROP POLICY IF EXISTS "Platform plans: manage only for platform admins" ON public.platform_plans;
CREATE POLICY "Platform plans: manage only for platform admins"
  ON public.platform_plans FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Seed inicial idempotente com OpenAI configurada por padrão
INSERT INTO public.platform_plans (
  key, name, description, price_monthly, max_monthly_messages, max_agents, 
  max_catalog_items, max_monthly_quotes, default_ai_provider, default_ai_model, 
  allowed_llm_providers, badge, is_popular, features
)
VALUES
  (
    'trial',
    'Trial',
    'Ambiente de degustação e homologação para novos clientes validarem os agentes da Ellevee IA.',
    0.00,
    1000,
    1,
    1000,
    100,
    'openai',
    'gpt-4o-mini',
    ARRAY['openai'],
    'Degustação',
    false,
    '[
      "1 Agente de IA Ativo",
      "1.000 mensagens incluídas/mês",
      "Catálogo de até 1.000 produtos",
      "OpenAI GPT-4o Mini nativo",
      "Auditoria e governança básica",
      "Suporte via comunidade e docs"
    ]'::jsonb
  ),
  (
    'starter',
    'Starter',
    'Ideal para pequenas operações de delivery e varejo iniciando no atendimento conversacional com IA.',
    297.00,
    5000,
    2,
    10000,
    1000,
    'openai',
    'gpt-4o-mini',
    ARRAY['openai'],
    NULL,
    false,
    '[
      "Até 2 Agentes de Atendimento",
      "5.000 mensagens incluídas/mês",
      "Catálogo de até 10.000 itens",
      "OpenAI GPT-4o Mini de baixa latência",
      "Kanban de Atendimento integrado",
      "Disparo ativo via Outbox seguro"
    ]'::jsonb
  ),
  (
    'pro',
    'Pro',
    'Plano recomendado para operações de alto volume como a Sumel (Doceria e Delivery), com inteligência avançada.',
    697.00,
    25000,
    5,
    50000,
    5000,
    'openai',
    'gpt-4o',
    ARRAY['openai'],
    'Mais Popular · Recomendado Sumel',
    true,
    '[
      "Até 5 Agentes de IA Especializados",
      "25.000 mensagens incluídas/mês",
      "Catálogo de até 50.000 produtos",
      "OpenAI GPT-4o (Raciocínio avançado)",
      "Funil Kanban personalizado por setor",
      "Histórico completo e auditoria avançada",
      "Suporte prioritário via WhatsApp"
    ]'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    'Infraestrutura dedicada para redes e franquias com demandas intensivas e volume customizado.',
    1997.00,
    100000,
    15,
    200000,
    20000,
    'openai',
    'gpt-4o',
    ARRAY['openai'],
    'Corporativo',
    false,
    '[
      "15+ Agentes e fluxos autônomos",
      "100.000 mensagens incluídas/mês",
      "Catálogo e orçamentos ilimitados",
      "OpenAI GPT-4o com throughput dedicado",
      "Impersonate auditado para suporte",
      "SLA garantido de 99,9%",
      "Gerente de conta e CS dedicado"
    ]'::jsonb
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  default_ai_provider = EXCLUDED.default_ai_provider,
  default_ai_model = EXCLUDED.default_ai_model,
  allowed_llm_providers = EXCLUDED.allowed_llm_providers,
  updated_at = now();
