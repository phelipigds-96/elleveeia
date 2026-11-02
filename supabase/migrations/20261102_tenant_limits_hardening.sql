-- ==============================================================================
-- Migration: 20261102_tenant_limits_hardening.sql
-- Etapa 8.3.3: Correção de Segurança dos Limites por Tenant e Restrição de Provisioning Jobs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. BLINDAGEM DE COMPANY_LIMITS (REMOÇÃO DE POLÍTICAS PERMISSIVAS PARA CLIENTES)
-- ------------------------------------------------------------------------------

-- Remover políticas que permitiam a administradores de empresas inserir ou alterar limites
DROP POLICY IF EXISTS "Company limits: update only for company admins" ON public.company_limits;
DROP POLICY IF EXISTS "Company limits: insert only for company admins" ON public.company_limits;

-- Manter exclusivamente a política de leitura para usuários da empresa
-- (Garantir idempotência na declaração)
DROP POLICY IF EXISTS "Company limits: view for company users" ON public.company_limits;
CREATE POLICY "Company limits: view for company users"
  ON public.company_limits FOR SELECT
  USING ( company_id = public.get_auth_company_id() );

-- Trigger de defesa em profundidade: Impede inserção, atualização ou exclusão por usuários autenticados comuns
CREATE OR REPLACE FUNCTION public.protect_company_limits_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Permite alterações exclusivamente por rotinas administrativas de backend (service_role)
  IF auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'Operação negada: limites comerciais são definidos e administrados exclusivamente pela plataforma Ellevee IA.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_company_limits_mutations ON public.company_limits;
CREATE TRIGGER trg_protect_company_limits_mutations
BEFORE INSERT OR UPDATE OR DELETE ON public.company_limits
FOR EACH ROW
EXECUTE FUNCTION public.protect_company_limits_mutations();


-- ------------------------------------------------------------------------------
-- 2. VALIDAÇÃO ESTRITA DE ALLOWED_LLM_PROVIDERS
-- ------------------------------------------------------------------------------

-- Provedores efetivamente suportados pelo projeto no código TypeScript: 'gemini' e 'openai'
ALTER TABLE public.company_limits
  DROP CONSTRAINT IF EXISTS company_limits_allowed_llm_providers_check;

ALTER TABLE public.company_limits
  ADD CONSTRAINT company_limits_allowed_llm_providers_check
  CHECK (
    allowed_llm_providers <@ ARRAY['gemini', 'openai']::TEXT[]
    AND cardinality(allowed_llm_providers) > 0
  );


-- ------------------------------------------------------------------------------
-- 3. RESTRIÇÃO DE ACESSO A PROVISIONING_JOBS (PREVENÇÃO DE EXPOSIÇÃO DE INFRAESTRUTURA)
-- ------------------------------------------------------------------------------

-- Remove política que expunha error_log e detalhes de orquestração interna aos clientes
DROP POLICY IF EXISTS "Provisioning jobs: view for company admins" ON public.provisioning_jobs;

-- Apenas Superadministradores da plataforma e rotinas de backend podem consultar os jobs
DROP POLICY IF EXISTS "Provisioning jobs: view only for platform admins" ON public.provisioning_jobs;
CREATE POLICY "Provisioning jobs: view only for platform admins"
  ON public.provisioning_jobs FOR SELECT
  USING ( public.is_platform_admin() );
