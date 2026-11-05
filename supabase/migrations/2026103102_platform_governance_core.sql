-- ==============================================================================
-- Migration: 20261031_platform_governance_core.sql
-- Etapa 8.3.2: Implementação do núcleo de governança do Superadministrador
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABELA PLATFORM_ADMINS (OPERADORES DA PLATAFORMA SAAS)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin', 'support_operator', 'billing_admin')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Usuários autorizados podem consultar exclusivamente seu próprio registro
DROP POLICY IF EXISTS "Platform admins view own record" ON public.platform_admins;
CREATE POLICY "Platform admins view own record"
  ON public.platform_admins FOR SELECT
  USING ( id = auth.uid() );

-- Trigger de proteção: Impede inserção, alteração ou exclusão por usuários autenticados comuns
CREATE OR REPLACE FUNCTION public.protect_platform_admin_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Permite apenas modificações via Service Role (processos administrativos controlados de backend)
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Operação negada: gerenciamento de operadores da plataforma só é permitido via serviço administrativo de backend.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_platform_admin_mutations ON public.platform_admins;
CREATE TRIGGER trg_protect_platform_admin_mutations
BEFORE INSERT OR UPDATE OR DELETE ON public.platform_admins
FOR EACH ROW
EXECUTE FUNCTION public.protect_platform_admin_mutations();

-- Função segura para validar se o usuário autenticado é um Superadministrador ativo
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE id = auth.uid()
      AND active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;


-- ------------------------------------------------------------------------------
-- 2. EXTENSÃO DA TABELA COMPANIES (STATUS OPERACIONAL E GOVERNANÇA)
-- ------------------------------------------------------------------------------

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning', 'active', 'suspended', 'cancelled')),
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'standard' CHECK (plan_tier IN ('trial', 'standard', 'pro', 'enterprise'));

-- Garantir compatibilidade e funcionamento ininterrupto de tenants existentes
UPDATE public.companies
SET status = 'active'
WHERE status IS NULL;


-- ------------------------------------------------------------------------------
-- 3. TABELA COMPANY_LIMITS (LIMITES E COTAS POR EMPRESA)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  max_agents INTEGER NOT NULL DEFAULT 1 CHECK (max_agents >= 1),
  max_monthly_messages INTEGER NOT NULL DEFAULT 5000 CHECK (max_monthly_messages >= 0),
  max_monthly_quotes INTEGER NOT NULL DEFAULT 1000 CHECK (max_monthly_quotes >= 0),
  max_catalog_items INTEGER NOT NULL DEFAULT 50000 CHECK (max_catalog_items >= 0),
  allowed_llm_providers TEXT[] NOT NULL DEFAULT ARRAY['gemini'],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_limits ENABLE ROW LEVEL SECURITY;

-- Usuários da empresa podem consultar as cotas de sua empresa
DROP POLICY IF EXISTS "Company limits: view for company users" ON public.company_limits;
CREATE POLICY "Company limits: view for company users"
  ON public.company_limits FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

-- Somente administradores da empresa podem atualizar parâmetros de limite atribuídos à empresa
DROP POLICY IF EXISTS "Company limits: update only for company admins" ON public.company_limits;
CREATE POLICY "Company limits: update only for company admins"
  ON public.company_limits FOR UPDATE
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() )
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

-- Inserção de limites permitida apenas para administradores da empresa ou service_role
DROP POLICY IF EXISTS "Company limits: insert only for company admins" ON public.company_limits;
CREATE POLICY "Company limits: insert only for company admins"
  ON public.company_limits FOR INSERT
  WITH CHECK ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

-- Provisionamento retroativo de limites padrão para empresas já existentes
INSERT INTO public.company_limits (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;


-- ------------------------------------------------------------------------------
-- 4. TABELA PROVISIONING_JOBS (RASTREAMENTO DE IMPLANTAÇÃO E IDEMPOTÊNCIA)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.provisioning_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  admin_email TEXT NOT NULL,
  admin_name TEXT NOT NULL,
  current_step TEXT NOT NULL DEFAULT 'initialized',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  error_log TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.provisioning_jobs ENABLE ROW LEVEL SECURITY;

-- Administradores da empresa podem consultar o status da sua própria implantação
DROP POLICY IF EXISTS "Provisioning jobs: view for company admins" ON public.provisioning_jobs;
CREATE POLICY "Provisioning jobs: view for company admins"
  ON public.provisioning_jobs FOR SELECT
  USING ( company_id = public.get_auth_company_id() AND public.is_company_admin() );

-- Inserção, atualização e exclusão são bloqueadas para usuários comuns (gerenciadas exclusivamente pelo backend)
DROP POLICY IF EXISTS "Provisioning jobs: manage only via service role" ON public.provisioning_jobs;


-- ------------------------------------------------------------------------------
-- 5. TABELA PLATFORM_AUDIT_LOGS (AUDITORIA GLOBAL E IMUTABILIDADE)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_company_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  payload_summary JSONB,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

-- Apenas Superadministradores ativos podem visualizar a trilha global de auditoria
DROP POLICY IF EXISTS "Platform audit logs: view only for platform admins" ON public.platform_audit_logs;
CREATE POLICY "Platform audit logs: view only for platform admins"
  ON public.platform_audit_logs FOR SELECT
  USING ( public.is_platform_admin() );

-- Trigger de Imutabilidade Estrita: Bloqueia integralmente UPDATE e DELETE
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Operação proibida: logs de auditoria da plataforma são estritamente imutáveis.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_modification ON public.platform_audit_logs;
CREATE TRIGGER trg_prevent_audit_log_modification
BEFORE UPDATE OR DELETE ON public.platform_audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_modification();
