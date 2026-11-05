-- ==============================================================================
-- MIGRATION: 2026110607_outbox_provider_id_and_gateway_locks.sql
-- ETAPA 8.4.3E.4 — FASE 3: PERSISTÊNCIA DE PROVIDER ID, MERGE MONOTÔNICO E LOCKS
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: ADIÇÃO DE PROVIDER_MESSAGE_ID NA OUTBOX E ÍNDICES DE PERFORMANCE
-- ------------------------------------------------------------------------------
ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- Índice para busca rápida de outbox por provider_message_id
CREATE INDEX IF NOT EXISTS idx_outbox_company_provider_msg
  ON public.message_outbox (company_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Índice para eliminar Sequential Scan em callbacks de status na tabela messages
CREATE INDEX IF NOT EXISTS idx_messages_company_external_id
  ON public.messages (company_id, external_id)
  WHERE external_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- PARTE 2: ATUALIZAÇÃO DA RPC complete_outbox_message COM 7º PARÂMETRO
-- ------------------------------------------------------------------------------
-- Remove a assinatura antiga de 6 parâmetros para evitar ambiguidade (PGRST202)
DROP FUNCTION IF EXISTS public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.complete_outbox_message(
  p_company_id          UUID,
  p_outbox_id           UUID,
  p_claim_token         UUID,
  p_claim_version       BIGINT,
  p_status              TEXT,
  p_last_error          TEXT DEFAULT NULL::TEXT,
  p_provider_message_id TEXT DEFAULT NULL::TEXT
)
RETURNS TABLE (
  was_completed   BOOLEAN,
  current_status  TEXT,
  error_reason    TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  r_status TEXT;
BEGIN
  -- 1. Validações de parâmetros obrigatórios
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'complete_outbox_message: p_company_id não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'complete_outbox_message: p_outbox_id não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'complete_outbox_message: p_claim_token não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_claim_version IS NULL THEN
    RAISE EXCEPTION 'complete_outbox_message: p_claim_version não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('sent', 'failed', 'suppressed') THEN
    RAISE EXCEPTION 'complete_outbox_message: p_status inválido (%). Aceitos: sent, failed, suppressed', p_status USING ERRCODE = 'P0001';
  END IF;

  -- 2. Atualização condicionada ao estado de processing e ao fencing exato
  UPDATE public.message_outbox mo
  SET
    status              = p_status,
    last_error          = CASE WHEN p_status = 'sent' THEN NULL ELSE p_last_error END,
    sent_at             = CASE WHEN p_status = 'sent' THEN v_now ELSE mo.sent_at END,
    provider_message_id = COALESCE(p_provider_message_id, mo.provider_message_id),
    locked_at           = NULL,
    locked_until        = NULL,
    claim_token         = NULL,
    updated_at          = v_now
  WHERE mo.id = p_outbox_id
    AND mo.company_id = p_company_id
    AND mo.status = 'processing'
    AND mo.claim_token = p_claim_token
    AND mo.claim_version = p_claim_version
  RETURNING mo.status INTO r_status;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, r_status, NULL::TEXT;
    RETURN;
  END IF;

  -- 3. Diagnóstico de falha de conclusão / fencing / chamada repetida
  SELECT mo.status INTO r_status
  FROM public.message_outbox mo
  WHERE mo.id = p_outbox_id AND mo.company_id = p_company_id;

  IF r_status IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'outbox_not_found'::TEXT;
  ELSIF r_status != 'processing' THEN
    RETURN QUERY SELECT FALSE, r_status, 'already_completed'::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, r_status, 'fencing_token_mismatch'::TEXT;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------------------------
-- PARTE 3: RPC merge_message_metadata_monotonic (LOCK DE LINHA E MONOTONIA NO SQL)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_message_metadata_monotonic(
  p_company_id          UUID,
  p_message_id          UUID,
  p_metadata_patch      JSONB,
  p_provider_message_id TEXT DEFAULT NULL::TEXT
)
RETURNS TABLE (
  was_updated           BOOLEAN,
  final_metadata        JSONB,
  current_status        TEXT,
  error_reason          TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_current_meta JSONB;
  v_current_ext_id TEXT;
  v_current_status TEXT;
  v_incoming_status TEXT;
  v_resolved_status TEXT;
  v_current_rank INT := 0;
  v_incoming_rank INT := 0;
  v_merged_meta JSONB;
  v_final_ext_id TEXT;
BEGIN
  -- 1. Validação sintática
  IF p_company_id IS NULL OR p_message_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::JSONB, NULL::TEXT, 'invalid_arguments'::TEXT;
    RETURN;
  END IF;

  -- 2. Lock pessimista FOR UPDATE na linha da mensagem (serialização multi-pod real)
  SELECT m.metadata, m.external_id
  INTO v_current_meta, v_current_ext_id
  FROM public.messages m
  WHERE m.id = p_message_id AND m.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::JSONB, NULL::TEXT, 'message_not_found'::TEXT;
    RETURN;
  END IF;

  v_current_meta := COALESCE(v_current_meta, '{}'::JSONB);
  v_current_status := v_current_meta->>'delivery_status';
  v_incoming_status := p_metadata_patch->>'delivery_status';

  -- 3. Resolução da máquina de estados monotônica no SQL
  -- Ranks: pending (0), sent (1), delivered (2), read (3), failed (-1)
  IF v_incoming_status IS NULL THEN
    v_resolved_status := v_current_status;
  ELSIF v_current_status IS NULL THEN
    v_resolved_status := v_incoming_status;
  ELSIF v_incoming_status = v_current_status THEN
    v_resolved_status := v_current_status;
  ELSE
    -- Cálculo de rank do status atual
    CASE v_current_status
      WHEN 'read' THEN v_current_rank := 3;
      WHEN 'delivered' THEN v_current_rank := 2;
      WHEN 'sent' THEN v_current_rank := 1;
      WHEN 'pending' THEN v_current_rank := 0;
      WHEN 'failed' THEN v_current_rank := -1;
      ELSE v_current_rank := 0;
    END CASE;

    -- Cálculo de rank do status recebido
    CASE v_incoming_status
      WHEN 'read' THEN v_incoming_rank := 3;
      WHEN 'delivered' THEN v_incoming_rank := 2;
      WHEN 'sent' THEN v_incoming_rank := 1;
      WHEN 'pending' THEN v_incoming_rank := 0;
      WHEN 'failed' THEN v_incoming_rank := -1;
      ELSE v_incoming_rank := 0;
    END CASE;

    -- Regras de transição
    IF v_incoming_status = 'failed' THEN
      IF v_current_status IN ('delivered', 'read') THEN
        v_resolved_status := v_current_status; -- Já entregue/lida não pode regredir para failed
      ELSE
        v_resolved_status := 'failed';
      END IF;
    ELSIF v_current_status = 'failed' THEN
      IF v_incoming_status IN ('sent', 'delivered', 'read') THEN
        v_resolved_status := v_incoming_status; -- Retry ou entrega tardia
      ELSE
        v_resolved_status := 'failed';
      END IF;
    ELSIF v_incoming_rank >= v_current_rank THEN
      v_resolved_status := v_incoming_status;
    ELSE
      v_resolved_status := v_current_status; -- Regressão ignorada (delivered não vira sent)
    END IF;
  END IF;

  -- 4. Merge atômico de metadados
  v_merged_meta := v_current_meta || COALESCE(p_metadata_patch, '{}'::JSONB);

  IF v_resolved_status IS NOT NULL THEN
    v_merged_meta := jsonb_set(v_merged_meta, '{delivery_status}', to_jsonb(v_resolved_status));
  END IF;

  -- Preserva provider_message_id existente ou aplica novo
  IF p_provider_message_id IS NOT NULL AND p_provider_message_id != '' THEN
    v_merged_meta := jsonb_set(v_merged_meta, '{provider_message_id}', to_jsonb(p_provider_message_id));
    v_final_ext_id := COALESCE(v_current_ext_id, p_provider_message_id);
  ELSE
    v_final_ext_id := v_current_ext_id;
  END IF;

  -- 5. Atualização atômica na tabela messages
  UPDATE public.messages
  SET
    metadata    = v_merged_meta,
    external_id = v_final_ext_id
  WHERE id = p_message_id AND company_id = p_company_id;

  RETURN QUERY SELECT TRUE, v_merged_meta, v_resolved_status, NULL::TEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_message_metadata_monotonic(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_message_metadata_monotonic(UUID, UUID, JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.merge_message_metadata_monotonic(UUID, UUID, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_message_metadata_monotonic(UUID, UUID, JSONB, TEXT) TO service_role;

-- ------------------------------------------------------------------------------
-- PARTE 4: TABELA gateway_outbound_locks E RPCs DE DEDUPLICAÇÃO NO n8n
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gateway_outbound_locks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id            TEXT NOT NULL,
  outbox_id           UUID REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  message_id          UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'in_flight',
  provider_message_id TEXT,
  claim_token         UUID NOT NULL DEFAULT gen_random_uuid(),
  locked_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  locked_until        TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_gateway_locks_company_event UNIQUE (company_id, event_id),
  CONSTRAINT chk_gateway_locks_status CHECK (status IN ('in_flight', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_gateway_locks_lease 
  ON public.gateway_outbound_locks (status, locked_until) 
  WHERE status = 'in_flight';

CREATE INDEX IF NOT EXISTS idx_gateway_locks_provider 
  ON public.gateway_outbound_locks (company_id, provider_message_id) 
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.gateway_outbound_locks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Gateway Locks: view for company users" 
    ON public.gateway_outbound_locks FOR SELECT 
    USING (company_id = get_auth_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RPC 4.1: acquire_gateway_outbound_lock (Reivindicação / Idempotência no Gateway)
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

-- RPC 4.2: complete_gateway_outbound_lock (Finalização do Envio pelo Gateway)
CREATE OR REPLACE FUNCTION public.complete_gateway_outbound_lock(
  p_company_id          UUID,
  p_event_id            TEXT,
  p_claim_token         UUID,
  p_status              TEXT,
  p_provider_message_id TEXT DEFAULT NULL::TEXT,
  p_last_error          TEXT DEFAULT NULL::TEXT
)
RETURNS TABLE (
  was_completed BOOLEAN,
  current_status TEXT,
  error_reason   TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  r_status TEXT;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'invalid_status'::TEXT;
    RETURN;
  END IF;

  UPDATE public.gateway_outbound_locks gol
  SET
    status              = p_status,
    provider_message_id = COALESCE(p_provider_message_id, gol.provider_message_id),
    completed_at        = CASE WHEN p_status = 'completed' THEN v_now ELSE gol.completed_at END,
    last_error          = CASE WHEN p_status = 'failed' THEN p_last_error ELSE NULL END,
    locked_until        = v_now,
    updated_at          = v_now
  WHERE gol.company_id = p_company_id
    AND gol.event_id = p_event_id
    AND gol.claim_token = p_claim_token
  RETURNING gol.status INTO r_status;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, r_status, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, NULL::TEXT, 'fencing_token_mismatch_or_not_found'::TEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.acquire_gateway_outbound_lock(UUID, TEXT, UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_gateway_outbound_lock(UUID, TEXT, UUID, UUID, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_gateway_outbound_lock(UUID, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_gateway_outbound_lock(UUID, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;
