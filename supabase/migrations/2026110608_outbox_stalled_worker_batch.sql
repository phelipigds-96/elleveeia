-- Migration: 2026110608_outbox_stalled_worker_batch.sql
-- Etapa: E.5 (Parte B) - Worker Assíncrono de Reconciliação
-- Descrição: Cria a RPC claim_stalled_outbox_batch com SELECT ... FOR UPDATE SKIP LOCKED
--            para reivindicar atomicamente mensagens abandonadas, com lease expirado ou falhas transitórias com backoff.

CREATE OR REPLACE FUNCTION public.claim_stalled_outbox_batch(
  p_batch_size    INT DEFAULT 25,
  p_lease_seconds INT DEFAULT 120
)
RETURNS TABLE (
  outbox_id           UUID,
  company_id          UUID,
  conversation_id     UUID,
  message_id          UUID,
  idempotency_key     TEXT,
  channel             TEXT,
  recipient           TEXT,
  payload             JSONB,
  claim_token         UUID,
  claim_version       BIGINT,
  attempts            INT,
  max_attempts        INT,
  old_status          TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_locked_until TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
BEGIN
  -- 1. Marcar como falha definitiva mensagens órfãs que já atingiram max_attempts
  -- e cujo lease expirou (Poison Pill Protection)
  UPDATE public.message_outbox mo
  SET
    status     = 'failed',
    last_error = 'max_attempts_reached',
    updated_at = v_now
  WHERE mo.status IN ('pending', 'processing', 'failed')
    AND mo.attempts >= COALESCE(mo.max_attempts, 5)
    AND (mo.locked_until IS NULL OR mo.locked_until < v_now);

  -- 2. Reivindicação atômica do lote com FOR UPDATE SKIP LOCKED
  RETURN QUERY
  WITH candidate_rows AS (
    SELECT mo.id, mo.status AS cand_status
    FROM public.message_outbox mo
    JOIN public.companies c ON c.id = mo.company_id
    WHERE c.status = 'active'
      AND mo.attempts < COALESCE(mo.max_attempts, 5)
      AND (
        -- Caso 1: Pending abandonada (> 30s)
        (mo.status = 'pending' AND mo.created_at <= v_now - INTERVAL '30 seconds')
        OR
        -- Caso 2: Processing cujo lease expirou
        (mo.status = 'processing' AND (mo.locked_until IS NULL OR mo.locked_until < v_now))
        OR
        -- Caso 3: Failed com backoff exponencial cumprido (base de 15s)
        (mo.status = 'failed' AND mo.updated_at <= v_now - (POWER(2, LEAST(mo.attempts, 4)) * INTERVAL '15 seconds'))
      )
    ORDER BY mo.created_at ASC
    LIMIT p_batch_size
    FOR UPDATE OF mo SKIP LOCKED
  )
  UPDATE public.message_outbox mo
  SET
    status        = 'processing',
    claim_token   = gen_random_uuid(),
    claim_version = mo.claim_version + 1,
    locked_at     = v_now,
    locked_until  = v_locked_until,
    attempts      = mo.attempts + 1,
    updated_at    = v_now
  FROM candidate_rows cr
  WHERE mo.id = cr.id
  RETURNING
    mo.id,
    mo.company_id,
    mo.conversation_id,
    mo.message_id,
    mo.idempotency_key,
    mo.channel,
    mo.recipient,
    mo.payload,
    mo.claim_token,
    mo.claim_version,
    mo.attempts,
    mo.max_attempts,
    cr.cand_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_stalled_outbox_batch(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_stalled_outbox_batch(INT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_stalled_outbox_batch(INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stalled_outbox_batch(INT, INT) TO service_role;

COMMENT ON FUNCTION public.claim_stalled_outbox_batch IS 
  'Reivindica atomicamente em lote mensagens pendentes abandonadas, processing com lease expirado ou failed elegíveis para retry usando FOR UPDATE SKIP LOCKED.';
