-- ==============================================================================
-- Migration: 2026112200_fix_platform_admin_trigger.sql
-- Correção cirúrgica do trigger protect_platform_admin_mutations()
-- Corrige o tratamento de operações BEFORE DELETE (retornando OLD em vez de NEW)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.protect_platform_admin_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Permite apenas modificações via Service Role (processos administrativos controlados de backend)
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Operação negada: gerenciamento de operadores da plataforma só é permitido via serviço administrativo de backend.';
END;
$$;

COMMENT ON FUNCTION public.protect_platform_admin_mutations() IS 
  'Trigger de integridade para platform_admins: restringe mutações a service_role e trata adequadamente BEFORE DELETE retornando OLD.';
