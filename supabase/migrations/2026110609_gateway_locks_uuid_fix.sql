-- ==============================================================================
-- MIGRATION: 2026110609_gateway_locks_uuid_fix.sql
-- SANEAMENTO DE SEARCH_PATH E FUNÇÃO DE UUID EM GATEWAY_OUTBOUND_LOCKS
-- ==============================================================================

-- 1. Substitui o default das colunas para gen_random_uuid() (nativo do pg_catalog)
ALTER TABLE public.gateway_outbound_locks 
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN claim_token SET DEFAULT gen_random_uuid();

-- 2. Atualiza acquire_gateway_outbound_lock para utilizar gen_random_uuid()
CREATE OR REPLACE FUNCTION public.acquire_gateway_outbound_lock(
  p_company_id    UUID,
  p_event_id      TEXT,
  p_outbox_id     UUID DEFAULT NULL,
  p_message_id    UUID DEFAULT NULL,
  p_lease_seconds INT DEFAULT 60
)
RETURNS TABLE (
  was_acquired        BOOLEAN,
  claim_token         UUID,
  status              TEXT,
  provider_message_id TEXT,
  error_reason        TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
  v_new_token UUID := gen_random_uuid();
  r_rec RECORD;
BEGIN
  -- Tenta inserir novo lock in_flight
  INSERT INTO public.gateway_outbound_locks (
    company_id, event_id, outbox_id, message_id, status, claim_token, locked_at, locked_until, updated_at
  )
  VALUES (
    p_company_id, p_event_id, p_outbox_id, p_message_id, 'in_flight', v_new_token, v_now, v_until, v_now
  )
  ON CONFLICT (company_id, event_id) DO NOTHING
  RETURNING status, claim_token, provider_message_id INTO r_rec;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, r_rec.claim_token, r_rec.status, r_rec.provider_message_id, NULL::TEXT;
    RETURN;
  END IF;

  -- Se já existia, analisa concorrência com lock FOR UPDATE
  SELECT gol.id, gol.status, gol.locked_until, gol.claim_token, gol.provider_message_id
  INTO r_rec
  FROM public.gateway_outbound_locks gol
  WHERE gol.company_id = p_company_id AND gol.event_id = p_event_id
  FOR UPDATE;

  IF r_rec.status = 'completed' THEN
    -- Já enviado com sucesso anteriormente: n8n retorna provider_message_id em cache sem reenviar
    RETURN QUERY SELECT FALSE, r_rec.claim_token, 'completed'::TEXT, r_rec.provider_message_id, 'already_completed'::TEXT;
    RETURN;
  ELSIF r_rec.status = 'in_flight' AND r_rec.locked_until > v_now THEN
    -- Envio concorrente em andamento com lease ativo
    RETURN QUERY SELECT FALSE, NULL::UUID, 'in_flight'::TEXT, NULL::TEXT, 'concurrency_active_lease'::TEXT;
    RETURN;
  ELSE
    -- Lease expirou (crash do n8n) ou falhou previamente: concede nova tentativa
    UPDATE public.gateway_outbound_locks gol
    SET
      status       = 'in_flight',
      claim_token  = v_new_token,
      locked_at    = v_now,
      locked_until = v_until,
      updated_at   = v_now
    WHERE gol.id = r_rec.id;

    RETURN QUERY SELECT TRUE, v_new_token, 'in_flight'::TEXT, r_rec.provider_message_id, NULL::TEXT;
    RETURN;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acquire_gateway_outbound_lock(UUID, TEXT, UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_gateway_outbound_lock(UUID, TEXT, UUID, UUID, INT) TO service_role;
