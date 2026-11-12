-- ==============================================================================
-- MIGRATION: 2026111201_engine_reliability_2b.sql
-- ETAPA 2B: CONFIABILIDADE DO MOTOR AUTONOMO, LOCK DE CONVERSA E MEMORIA LONGA
-- ==============================================================================
-- Garantias:
--   1. Estritamente aditiva e idempotente (zero quebra se codigo antigo rodar antes/depois)
--   2. Backfill imediato de webhook_events historicos (nunca reprocessa mensagens antigas)
--   3. Lock distribuido PostgREST/Supavisor-safe (conversation_processing_locks)
--   4. Memoria resumida persistente em conversations (summary, summary_updated_at, summary_message_count)
--   5. Security Definer + search_path travado + REVOKE/GRANT exclusivo service_role
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: COLUNAS ADITIVAS DE RECUPERACAO E CICLO AUTONOMO EM webhook_events
-- ------------------------------------------------------------------------------
ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS autonomous_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS autonomous_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS autonomous_max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS autonomous_locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autonomous_claim_token UUID,
  ADD COLUMN IF NOT EXISTS autonomous_last_error TEXT,
  ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT clock_timestamp();

DO $$ BEGIN
  ALTER TABLE public.webhook_events
    ADD CONSTRAINT chk_webhook_events_autonomous_status
    CHECK (autonomous_status IN ('pending', 'processing', 'completed', 'skipped', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- BACKFILL CRITICO:
-- Marca imediatamente todas as linhas pre-existentes (antes da Etapa 2B, sem vinculo
-- conversation_id/message_id) para que o worker de recuperacao NUNCA reenvie ou
-- processe eventos historicos de ingestao ou ciclo autonomo anteriores a esta migration.
UPDATE public.webhook_events
SET
  autonomous_status = CASE
    WHEN status = 'processed' THEN 'completed'
    ELSE 'failed'
  END,
  autonomous_last_error = COALESCE(
    autonomous_last_error,
    CASE WHEN status = 'processed' THEN NULL ELSE 'historical_backfill_prior_to_2b' END
  ),
  recovery_attempts = CASE
    WHEN status = 'processed' THEN recovery_attempts
    ELSE GREATEST(recovery_attempts, autonomous_max_attempts)
  END,
  updated_at = COALESCE(updated_at, clock_timestamp())
WHERE conversation_id IS NULL
  AND message_id IS NULL
  AND (
    autonomous_status IN ('pending', 'processing')
    OR status IN ('processing', 'error')
  );

CREATE INDEX IF NOT EXISTS idx_webhook_events_autonomous_stalled
  ON public.webhook_events (created_at)
  WHERE status = 'processed'
    AND conversation_id IS NOT NULL
    AND message_id IS NOT NULL
    AND autonomous_status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_webhook_events_ingest_stalled
  ON public.webhook_events (created_at)
  WHERE status IN ('processing', 'error');

-- ------------------------------------------------------------------------------
-- PARTE 2: TABELA E RPCs DE LOCK POR CONVERSA (PostgREST / Supavisor-safe)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_processing_locks (
  conversation_id UUID PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  lock_token      UUID NOT NULL,
  locked_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  locked_until    TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_conv_proc_locks_company_lease
  ON public.conversation_processing_locks (company_id, locked_until);

ALTER TABLE public.conversation_processing_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.acquire_conversation_processing_lock(
  p_company_id      UUID,
  p_conversation_id UUID,
  p_lease_seconds   INT DEFAULT 65
)
RETURNS TABLE (
  was_acquired BOOLEAN,
  lock_token   UUID,
  locked_until TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now   TIMESTAMPTZ := clock_timestamp();
  v_sec   INT := GREATEST(15, LEAST(COALESCE(p_lease_seconds, 65), 300));
  v_until TIMESTAMPTZ := v_now + (v_sec || ' seconds')::INTERVAL;
  v_token UUID := gen_random_uuid();
  r_rec   RECORD;
BEGIN
  IF p_company_id IS NULL OR p_conversation_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Verifica isolamento multi-tenant antes de criar ou renovar o lock
  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.company_id = p_company_id
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  INSERT INTO public.conversation_processing_locks (
    conversation_id, company_id, lock_token, locked_at, locked_until, updated_at
  )
  VALUES (
    p_conversation_id, p_company_id, v_token, v_now, v_until, v_now
  )
  ON CONFLICT (conversation_id) DO UPDATE
    SET
      company_id   = EXCLUDED.company_id,
      lock_token   = EXCLUDED.lock_token,
      locked_at    = EXCLUDED.locked_at,
      locked_until = EXCLUDED.locked_until,
      updated_at   = EXCLUDED.updated_at
    WHERE public.conversation_processing_locks.locked_until < v_now
      AND public.conversation_processing_locks.company_id = p_company_id
  RETURNING
    public.conversation_processing_locks.lock_token,
    public.conversation_processing_locks.locked_until
  INTO r_rec;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, r_rec.lock_token, r_rec.locked_until;
    RETURN;
  END IF;

  SELECT cpl.locked_until INTO r_rec
  FROM public.conversation_processing_locks cpl
  WHERE cpl.conversation_id = p_conversation_id
    AND cpl.company_id = p_company_id;

  RETURN QUERY SELECT FALSE, NULL::UUID, r_rec.locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_conversation_processing_lock(
  p_company_id      UUID,
  p_conversation_id UUID,
  p_lock_token      UUID
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
  IF p_company_id IS NULL OR p_conversation_id IS NULL OR p_lock_token IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.conversation_processing_locks cpl
  WHERE cpl.conversation_id = p_conversation_id
    AND cpl.company_id = p_company_id
    AND cpl.lock_token = p_lock_token;

  RETURN FOUND;
END;
$$;

-- ------------------------------------------------------------------------------
-- PARTE 3: RPCs ATOMICAS DE RECUPERACAO DE webhook_events PARA O WORKER OFICIAL
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_stalled_webhook_events_batch(
  p_batch_size    INT DEFAULT 5,
  p_lease_seconds INT DEFAULT 90
)
RETURNS TABLE (
  webhook_event_id UUID,
  company_id       UUID,
  event_id         TEXT,
  recovery_mode    TEXT,
  conversation_id  UUID,
  message_id       UUID,
  payload          JSONB,
  attempts         INT,
  claim_token      UUID
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now         TIMESTAMPTZ := clock_timestamp();
  v_cutoff      TIMESTAMPTZ := v_now - INTERVAL '24 hours';
  v_limit       INT := GREATEST(1, LEAST(COALESCE(p_batch_size, 5), 50));
  v_lease_sec   INT := GREATEST(15, LEAST(COALESCE(p_lease_seconds, 90), 600));
  v_lease_until TIMESTAMPTZ := v_now + (v_lease_sec || ' seconds')::INTERVAL;
BEGIN
  -- 1A. Poison Pill e expiracao (>24h) para ciclos autonomos travados
  UPDATE public.webhook_events we
  SET
    autonomous_status      = 'failed',
    autonomous_locked_until = NULL,
    autonomous_claim_token = NULL,
    autonomous_last_error  = COALESCE(
      NULLIF(we.autonomous_last_error, ''),
      CASE
        WHEN we.created_at < v_cutoff THEN 'expired_24h_recovery_window'
        ELSE 'max_autonomous_attempts_reached'
      END
    ),
    updated_at             = v_now
  WHERE we.status = 'processed'
    AND we.conversation_id IS NOT NULL
    AND we.message_id IS NOT NULL
    AND we.autonomous_status IN ('pending', 'processing')
    AND (
      we.created_at < v_cutoff
      OR (
        COALESCE(we.autonomous_attempts, 0) >= COALESCE(we.autonomous_max_attempts, 3)
        AND (
          (we.autonomous_status = 'pending' AND (we.autonomous_locked_until IS NULL OR we.autonomous_locked_until < v_now))
          OR (we.autonomous_status = 'processing' AND we.autonomous_locked_until IS NOT NULL AND we.autonomous_locked_until < v_now)
        )
      )
    );

  -- 1B. Poison Pill e expiracao (>24h) para ingestoes travadas ou com erro
  UPDATE public.webhook_events we
  SET
    status                 = 'error',
    autonomous_status      = 'failed',
    autonomous_locked_until = NULL,
    autonomous_claim_token = NULL,
    autonomous_last_error  = COALESCE(
      NULLIF(we.autonomous_last_error, ''),
      CASE
        WHEN we.created_at < v_cutoff THEN 'expired_24h_ingest_window'
        ELSE 'max_ingest_recovery_attempts_reached'
      END
    ),
    updated_at             = v_now
  WHERE we.status IN ('processing', 'error')
    AND (
      we.created_at < v_cutoff
      OR (
        COALESCE(we.recovery_attempts, 0) >= COALESCE(we.autonomous_max_attempts, 3)
        AND COALESCE(we.autonomous_locked_until, we.updated_at, we.created_at) < (v_now - INTERVAL '45 seconds')
      )
    );

  -- 2. Reivindicacao atomica concorrente (FOR UPDATE SKIP LOCKED) de ate v_limit eventos
  RETURN QUERY
  WITH candidates AS (
    SELECT
      we.id,
      CASE
        WHEN we.status IN ('processing', 'error') THEN 'ingest'
        ELSE 'autonomous'
      END AS mode
    FROM public.webhook_events we
    WHERE we.created_at >= v_cutoff
      AND (
        (
          we.status IN ('processing', 'error')
          AND (we.payload ? 'customer')
          AND (we.payload ? 'message')
          AND COALESCE(we.recovery_attempts, 0) < COALESCE(we.autonomous_max_attempts, 3)
          AND COALESCE(we.autonomous_locked_until, we.updated_at, we.created_at) < (v_now - INTERVAL '45 seconds')
        )
        OR
        (
          we.status = 'processed'
          AND we.conversation_id IS NOT NULL
          AND we.message_id IS NOT NULL
          AND we.autonomous_status IN ('pending', 'processing')
          AND COALESCE(we.autonomous_attempts, 0) < COALESCE(we.autonomous_max_attempts, 3)
          AND (
            (we.autonomous_status = 'pending' AND (we.autonomous_locked_until IS NULL OR we.autonomous_locked_until < v_now))
            OR
            (we.autonomous_status = 'processing' AND we.autonomous_locked_until IS NOT NULL AND we.autonomous_locked_until < v_now)
          )
        )
      )
    ORDER BY we.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF we SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.webhook_events we
    SET
      status = CASE
        WHEN c.mode = 'ingest' THEN 'processing'
        ELSE we.status
      END,
      recovery_attempts = CASE
        WHEN c.mode = 'ingest' THEN COALESCE(we.recovery_attempts, 0) + 1
        ELSE we.recovery_attempts
      END,
      autonomous_status = CASE
        WHEN c.mode = 'autonomous' THEN 'processing'
        ELSE we.autonomous_status
      END,
      autonomous_attempts = CASE
        WHEN c.mode = 'autonomous' THEN COALESCE(we.autonomous_attempts, 0) + 1
        ELSE we.autonomous_attempts
      END,
      autonomous_locked_until = v_lease_until,
      autonomous_claim_token  = gen_random_uuid(),
      updated_at              = v_now
    FROM candidates c
    WHERE we.id = c.id
    RETURNING
      we.id AS webhook_event_id,
      we.company_id,
      we.event_id,
      c.mode AS recovery_mode,
      we.conversation_id,
      we.message_id,
      we.payload,
      CASE
        WHEN c.mode = 'ingest' THEN we.recovery_attempts
        ELSE we.autonomous_attempts
      END AS attempts,
      we.autonomous_claim_token AS claim_token
  )
  SELECT
    cl.webhook_event_id,
    cl.company_id,
    cl.event_id,
    cl.recovery_mode,
    cl.conversation_id,
    cl.message_id,
    cl.payload,
    cl.attempts,
    cl.claim_token
  FROM claimed cl;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_webhook_autonomous_event(
  p_company_id        UUID,
  p_webhook_event_id  UUID,
  p_claim_token       UUID DEFAULT NULL,
  p_autonomous_status TEXT DEFAULT 'completed',
  p_last_error        TEXT DEFAULT NULL,
  p_retry_after_sec   INT DEFAULT NULL
)
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_company_id IS NULL OR p_webhook_event_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_autonomous_status IS NULL OR p_autonomous_status NOT IN ('pending', 'completed', 'skipped', 'failed') THEN
    RETURN FALSE;
  END IF;

  UPDATE public.webhook_events we
  SET
    autonomous_status       = p_autonomous_status,
    autonomous_claim_token  = NULL,
    autonomous_locked_until = CASE
      WHEN p_autonomous_status = 'pending' AND p_retry_after_sec IS NOT NULL AND p_retry_after_sec > 0
        THEN v_now + (LEAST(p_retry_after_sec, 600) || ' seconds')::INTERVAL
      ELSE NULL
    END,
    autonomous_last_error   = CASE
      WHEN p_autonomous_status = 'completed' THEN NULL
      ELSE p_last_error
    END,
    updated_at              = v_now
  WHERE we.id = p_webhook_event_id
    AND we.company_id = p_company_id
    AND (
      (p_claim_token IS NOT NULL AND we.autonomous_claim_token = p_claim_token)
      OR (p_claim_token IS NULL AND we.autonomous_claim_token IS NULL)
    );

  RETURN FOUND;
END;
$$;

-- ------------------------------------------------------------------------------
-- PARTE 4: MEMORIA LONGA PERSISTENTE NA TABELA conversations
-- ------------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS summary_message_count INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------------------------------------------
-- PARTE 5: PERMISSOES ESTRITAS PARA service_role APENAS
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.acquire_conversation_processing_lock(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_conversation_processing_lock(UUID, UUID, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_conversation_processing_lock(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_conversation_processing_lock(UUID, UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_stalled_webhook_events_batch(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_stalled_webhook_events_batch(INT, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_webhook_autonomous_event(UUID, UUID, UUID, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_webhook_autonomous_event(UUID, UUID, UUID, TEXT, TEXT, INT) TO service_role;
