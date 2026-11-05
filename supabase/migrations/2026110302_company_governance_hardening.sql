-- ==============================================================================
-- Migration: 20261103_company_governance_hardening.sql
-- Etapa 8.4.3K: Hardening de RLS e Proteção de Campos de Governança na Tabela Companies
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. POLÍTICAS DE RLS REFORÇADAS NA TABELA COMPANIES
-- ------------------------------------------------------------------------------

-- Permitir que usuários visualizem sua própria empresa ou operadores ativos da plataforma
DROP POLICY IF EXISTS "Users can view their own company" ON public.companies;
CREATE POLICY "Users can view their own company" 
  ON public.companies FOR SELECT 
  USING ( 
    id = public.get_auth_company_id() 
    OR public.is_platform_admin() 
  );

-- Permitir atualização da empresa por administradores do tenant (campos comuns)
-- ou por operadores ativos da plataforma (Superadmin)
DROP POLICY IF EXISTS "Users can update their own company" ON public.companies;
CREATE POLICY "Users can update their own company" 
  ON public.companies FOR UPDATE 
  USING ( 
    (id = public.get_auth_company_id() AND public.is_company_admin())
    OR public.is_platform_admin() 
  )
  WITH CHECK (
    (id = public.get_auth_company_id() AND public.is_company_admin())
    OR public.is_platform_admin()
  );


-- ------------------------------------------------------------------------------
-- 2. TRIGGER DE PROTEÇÃO DOS CAMPOS DE GOVERNANÇA (STATUS, SUSPENSION_REASON, PLAN_TIER)
-- ------------------------------------------------------------------------------

-- Função de trigger para proteger os campos de governança contra alterações não autorizadas
CREATE OR REPLACE FUNCTION public.protect_company_governance_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_auth_plat_admin BOOLEAN := false;
BEGIN
  -- 1. Se nenhum campo de governança foi alterado, permite a operação imediatamente
  IF (OLD.status IS NOT DISTINCT FROM NEW.status) AND
     (OLD.suspension_reason IS NOT DISTINCT FROM NEW.suspension_reason) AND
     (OLD.plan_tier IS NOT DISTINCT FROM NEW.plan_tier) THEN
    RETURN NEW;
  END IF;

  -- 2. Autorização via service_role (processos internos/administrativos confiáveis de backend)
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- 3. Autorização via operador ativo da plataforma (is_platform_admin checa auth.uid() e active = true)
  is_auth_plat_admin := public.is_platform_admin();

  IF is_auth_plat_admin THEN
    RETURN NEW;
  END IF;

  -- 4. Rejeição incondicional caso usuário comum ou administrador de tenant tente alterar governança
  RAISE EXCEPTION 'Operação negada: os campos status, suspension_reason e plan_tier são de governança restrita da plataforma Ellevee IA e não podem ser alterados por usuários do tenant.';
END;
$$;

-- Criar trigger BEFORE UPDATE na tabela companies
DROP TRIGGER IF EXISTS trg_protect_company_governance_fields ON public.companies;
CREATE TRIGGER trg_protect_company_governance_fields
BEFORE UPDATE ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.protect_company_governance_fields();
