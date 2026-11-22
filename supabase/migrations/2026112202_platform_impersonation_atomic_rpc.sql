-- ==============================================================================
-- MIGRATION: 2026112202_platform_impersonation_atomic_rpc.sql
-- DESCRIÇÃO: RPC Transacional com Lock de Serialização Pessimista (Advisory Lock)
--            e Tratamento Atômico de Concorrência para Sessões de Impersonação
-- CONTEXTO:  ELLEVEE IA - AC-SEC-01.4-I2
-- SEGURANÇA: Exclusivo service_role; search_path = public, pg_temp; Zero RLS bypass.
-- ==============================================================================

-- 1. RPC TRANSACIONAL DE INICIALIZAÇÃO ATÔMICA
CREATE OR REPLACE FUNCTION public.start_impersonation_session_atomic(
  p_operator_id UUID,
  p_target_company_id UUID,
  p_session_token_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_auth_session_id TEXT DEFAULT NULL,
  p_client_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_session_id UUID;
  v_company_status TEXT;
  v_company_name TEXT;
  v_company_slug TEXT;
BEGIN
  -- 1.1. Verificação Estrita de Privilégio: Restrito exclusivamente ao backend service_role
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: start_impersonation_session_atomic é restrito ao serviço backend (service_role).'
      USING ERRCODE = '42501';
  END IF;

  -- 1.2. Validação Estrita do Formato do Hash e Timestamp
  IF p_session_token_hash IS NULL OR p_session_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Hash do token de sessão inválido: deve ser um hash SHA-256 hexadecimal de 64 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Data de expiração da sessão inválida: deve ser um timestamp futuro.'
      USING ERRCODE = '22023';
  END IF;

  -- 1.3. Serialização Pessimista por Operador (Garante ausência total de Race Condition entre abas)
  -- Utiliza advisory xact lock que é liberado automaticamente ao fim da transação.
  PERFORM pg_advisory_xact_lock(hashtext('impersonation_operator_' || p_operator_id::text));

  -- 1.4. Validação do Operador em platform_admins com lock de leitura
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_admins 
    WHERE id = p_operator_id AND active = true AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'Operador não autorizado ou inativo em platform_admins.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 1.5. Validação da Empresa Alvo
  SELECT status, name, slug INTO v_company_status, v_company_name, v_company_slug
  FROM public.companies
  WHERE id = p_target_company_id;

  IF v_company_status IS NULL THEN
    RAISE EXCEPTION 'Empresa de destino não encontrada.'
      USING ERRCODE = 'P0002';
  ELSIF v_company_status = 'suspended' THEN
    RAISE EXCEPTION 'Não é possível iniciar suporte para uma organização suspensa.'
      USING ERRCODE = 'P0003';
  END IF;

  -- 1.6. Atomicidade: Marca sessões anteriores do mesmo operador como revogadas ou expiradas
  -- Tratando explicitamente sessões cujo tempo expirou mas mantinham status 'active'
  UPDATE public.platform_impersonation_sessions
  SET 
    status = CASE WHEN expires_at <= now() THEN 'expired' ELSE 'revoked' END,
    revoked_at = CASE WHEN expires_at <= now() THEN NULL ELSE now() END,
    revocation_reason = CASE 
      WHEN expires_at <= now() THEN 'EXPIRED_ON_ROTATION' 
      ELSE 'SUPERSEDED_BY_NEW_SESSION' 
    END,
    revoked_by = p_operator_id
  WHERE operator_id = p_operator_id 
    AND status = 'active';

  -- 1.6. Inserção Atômica da Nova Sessão com Proteção do Índice Único Parcial
  INSERT INTO public.platform_impersonation_sessions (
    operator_id,
    target_company_id,
    session_token_hash,
    auth_session_id,
    status,
    expires_at,
    client_ip,
    user_agent,
    metadata
  ) VALUES (
    p_operator_id,
    p_target_company_id,
    p_session_token_hash,
    p_auth_session_id,
    'active',
    p_expires_at,
    p_client_ip,
    p_user_agent,
    p_metadata
  )
  RETURNING id INTO v_new_session_id;

  RETURN jsonb_build_object(
    'session_id', v_new_session_id,
    'target_company_id', p_target_company_id,
    'target_company_name', v_company_name,
    'target_company_slug', v_company_slug,
    'expires_at', p_expires_at
  );
END;
$$;

-- 2. RPC TRANSACIONAL DE ENCERRAMENTO / REVOGAÇÃO
CREATE OR REPLACE FUNCTION public.terminate_impersonation_session_atomic(
  p_session_token_hash TEXT,
  p_revoked_by UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'VOLUNTARY_TERMINATION'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado: terminate_impersonation_session_atomic é restrito ao serviço backend.'
      USING ERRCODE = '42501';
  END IF;

  IF p_session_token_hash IS NULL OR p_session_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Hash do token de sessão inválido: deve ser um hash SHA-256 hexadecimal de 64 caracteres.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_impersonation_sessions
  SET 
    status = 'revoked',
    revoked_at = now(),
    revocation_reason = p_reason,
    revoked_by = COALESCE(p_revoked_by, operator_id)
  WHERE session_token_hash = p_session_token_hash
    AND status = 'active'
  RETURNING id, operator_id, target_company_id INTO v_session;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sessão não encontrada ou já inativa');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'operator_id', v_session.operator_id,
    'target_company_id', v_session.target_company_id
  );
END;
$$;

-- 3. PERMISSÕES DE MENOR PRIVILÉGIO (ZERO EXPOSIÇÃO PÚBLICA)
REVOKE ALL ON FUNCTION public.start_impersonation_session_atomic(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_impersonation_session_atomic(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.terminate_impersonation_session_atomic(TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminate_impersonation_session_atomic(TEXT, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.start_impersonation_session_atomic IS 'Inicia sessão efêmera de impersonação com lock de concorrência pessimista e rotação atômica.';
COMMENT ON FUNCTION public.terminate_impersonation_session_atomic IS 'Encerra/revoga atomicamente sessão efêmera de impersonação pelo hash do token.';
