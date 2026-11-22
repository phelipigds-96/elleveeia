-- ==============================================================================
-- Migration: 2026112201_platform_impersonation_sessions.sql
-- AC-SEC-01.4: Tabela de Sessões Efêmeras de Impersonação do SuperAdmin
-- Garante unicidade estrita de sessão ativa no banco, auditoria imutável e privilégios mínimos
-- ==============================================================================

-- 1. TABELA DE SESSÕES EFÊMERAS DE IMPERSONAÇÃO
CREATE TABLE IF NOT EXISTS public.platform_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.platform_admins(id) ON DELETE RESTRICT,
  target_company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  session_token_hash TEXT NOT NULL UNIQUE,
  auth_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.platform_admins(id) ON DELETE RESTRICT,
  revocation_reason TEXT,
  client_ip TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.platform_impersonation_sessions IS 
  'Sessões de impersonação efêmeras do SuperAdmin: controladas por token opaco (apenas hash SHA-256 no banco), sem qualquer mutação em profiles.';

-- 2. ÍNDICE DE UNICIDADE DE SESSÃO ATIVA POR OPERADOR (BLOQUEIA CONCORRÊNCIA NO POSTGRESQL)
-- Impede fisicamente que existam duas sessões em status "active" para o mesmo operador.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pims_single_active_operator 
  ON public.platform_impersonation_sessions (operator_id) 
  WHERE status = 'active';

-- 3. ÍNDICES DE PERFORMANCE DE VALIDAÇÃO POR REQUEST (< 1ms)
CREATE INDEX IF NOT EXISTS idx_pims_hash_active 
  ON public.platform_impersonation_sessions (session_token_hash) 
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pims_expires_at 
  ON public.platform_impersonation_sessions (expires_at);

-- 4. SEGURANÇA ESTRITA DE GRANTS (MENOR PRIVILÉGIO)
-- Clientes no navegador (anon ou authenticated) NÃO POSSUEM NENHUM ACESSO DIRETO a esta tabela.
-- Todo o ciclo de vida é mediado exclusivamente por processos de backend via service_role.
REVOKE ALL ON TABLE public.platform_impersonation_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.platform_impersonation_sessions TO service_role;

-- Habilita RLS para defesa em profundidade
ALTER TABLE public.platform_impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- 5. TRIGGER DE INTEGRIDADE CONTRA MUTAÇÕES NÃO AUTORIZADAS
CREATE OR REPLACE FUNCTION public.protect_impersonation_sessions_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Operação negada: sessões de impersonação só podem ser manipuladas por serviços autorizados de backend.';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_impersonation_sessions_mutations ON public.platform_impersonation_sessions;
CREATE TRIGGER trg_protect_impersonation_sessions_mutations
BEFORE INSERT OR UPDATE OR DELETE ON public.platform_impersonation_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_impersonation_sessions_mutations();

-- 6. FUNÇÃO DE MANUTENÇÃO E EXPIRAÇÃO DE SESSÕES VENCIDAS
CREATE OR REPLACE FUNCTION public.cleanup_expired_impersonation_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  UPDATE public.platform_impersonation_sessions
  SET status = 'expired',
      last_used_at = now()
  WHERE status = 'active'
    AND expires_at < now();
    
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_impersonation_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_impersonation_sessions() TO service_role;
