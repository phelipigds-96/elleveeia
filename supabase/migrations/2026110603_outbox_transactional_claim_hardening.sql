-- ==============================================================================
-- ETAPA 8.4.3Q.2.5 — FUNDAÇÃO TRANSACIONAL E REIVINDICAÇÃO ATÔMICA DA OUTBOX
-- Arquivo: supabase/migrations/2026110603_outbox_transactional_claim_hardening.sql
-- ==============================================================================
-- Objetivo:
-- 1. Substituir a constraint global UNIQUE(idempotency_key) pela constraint
--    composta UNIQUE(company_id, idempotency_key) em public.message_outbox,
--    eliminando o risco de negação de serviço cross-tenant entre empresas.
-- 2. Adicionar colunas de processamento, lease e fencing:
--    - status: suporte a 'processing'
--    - locked_at: TIMESTAMPTZ
--    - locked_until: TIMESTAMPTZ
--    - claim_token: UUID
--    - claim_version: BIGINT NOT NULL DEFAULT 0
-- 3. Implementar RPC claim_outbox_message:
--    - Transição de estado atômica com RowExclusiveLock
--    - Reivindicação exclusiva (pending, failed ou processing com lease expirado)
--    - Incremento atômico de attempts e claim_version
--    - SECURITY DEFINER com search_path = pg_catalog, public, pg_temp
-- 4. Implementar RPC complete_outbox_message:
--    - Fencing determinístico via claim_token e claim_version
--    - Previne que processos antigos/zumbis sobrescrevam o estado
-- 5. Conceder permissão exclusiva para service_role.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: PRÉ-AUDITORIA DETERMINÍSTICA DE DUPLICATAS NA NOVA CHAVE
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT company_id, idempotency_key, COUNT(*) as cnt
    FROM public.message_outbox
    WHERE idempotency_key IS NOT NULL
    GROUP BY company_id, idempotency_key
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_ABORTED: Encontrados % grupo(s) de outbox com (company_id, idempotency_key) duplicado em public.message_outbox. '
      'Regularize os registros antes de aplicar a constraint de unicidade por empresa. '
      'Query de diagnóstico: SELECT company_id, idempotency_key, COUNT(*) FROM public.message_outbox WHERE idempotency_key IS NOT NULL GROUP BY company_id, idempotency_key HAVING COUNT(*) > 1;',
      v_duplicate_count;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PARTE 2: SUBSTITUIÇÃO DA CONSTRAINT GLOBAL POR COMPOSITE UNIQUE POR EMPRESA
-- ------------------------------------------------------------------------------
-- 1. Remove a constraint de unicidade global anterior se existir
ALTER TABLE public.message_outbox
  DROP CONSTRAINT IF EXISTS message_outbox_idempotency_key_key;

DROP INDEX IF EXISTS public.idx_outbox_idempotency;

-- 2. Cria o novo índice único composto por (company_id, idempotency_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_company_idempotency
  ON public.message_outbox (company_id, idempotency_key);

COMMENT ON INDEX public.uq_outbox_company_idempotency IS
  'Garante que idempotency_key seja única estritamente dentro da empresa (company_id, idempotency_key), '
  'eliminando riscos de colisão ou negação de serviço cross-tenant entre clientes distintos.';

-- ------------------------------------------------------------------------------
-- PARTE 3: ADIÇÃO DE COLUNAS DE LEASE, FENCING, PROCESSAMENTO E LIMITES
-- ------------------------------------------------------------------------------
ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS claim_version BIGINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.message_outbox
    ADD CONSTRAINT chk_outbox_max_attempts CHECK (max_attempts > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Índice para acelerar a busca e recuperação de mensagens em processamento expiradas
CREATE INDEX IF NOT EXISTS idx_outbox_processing_lease
  ON public.message_outbox (status, locked_until)
  WHERE status = 'processing';

-- ------------------------------------------------------------------------------
-- PARTE 4: RPC claim_outbox_message (REIVINDICAÇÃO ATÔMICA, LEASE E MAX_ATTEMPTS)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_outbox_message(
  p_company_id    UUID,
  p_outbox_id     UUID,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  was_claimed    BOOLEAN,
  claim_token    UUID,
  claim_version  BIGINT,
  status         TEXT,
  attempts       INTEGER,
  locked_until   TIMESTAMPTZ,
  payload        JSONB,
  message_id     UUID,
  error_reason   TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_company_status TEXT;
  v_now            TIMESTAMPTZ := clock_timestamp();
  v_locked_until   TIMESTAMPTZ;
  v_new_token      UUID;
  r_token          UUID;
  r_version        BIGINT;
  r_status         TEXT;
  r_attempts       INTEGER;
  r_max_attempts   INTEGER;
  r_locked_until   TIMESTAMPTZ;
  r_payload        JSONB;
  r_message_id     UUID;
BEGIN
  -- 1. Validações de parâmetros obrigatórios
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'claim_outbox_message: p_company_id não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'claim_outbox_message: p_outbox_id não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 15 THEN
    RAISE EXCEPTION 'claim_outbox_message: p_lease_seconds deve ser de no mínimo 15 segundos' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Validação central do status da empresa (Defesa em Profundidade)
  SELECT c.status INTO v_company_status
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_company_status IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, NULL::INTEGER, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::UUID, 'company_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_company_status != 'active' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, NULL::INTEGER, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::UUID, ('company_not_active:' || v_company_status)::TEXT;
    RETURN;
  END IF;

  -- 3. Transição atômica de reivindicação:
  -- Apenas registros com status 'pending', 'failed', ou 'processing' cujo lease expirou podem ser reivindicados,
  -- DESDE QUE attempts < max_attempts.
  -- Gera novo token de claim, incrementa claim_version e attempts, e define o teto de lease (locked_until).
  v_new_token := gen_random_uuid();
  v_locked_until := v_now + (p_lease_seconds || ' seconds')::INTERVAL;

  UPDATE public.message_outbox
  SET
    status        = 'processing',
    claim_token   = v_new_token,
    claim_version = claim_version + 1,
    locked_at     = v_now,
    locked_until  = v_locked_until,
    attempts      = attempts + 1,
    updated_at    = v_now
  WHERE id = p_outbox_id
    AND company_id = p_company_id
    AND (
      status IN ('pending', 'failed')
      OR (status = 'processing' AND (locked_until IS NULL OR locked_until < v_now))
    )
    AND attempts < COALESCE(max_attempts, 5)
  RETURNING
    public.message_outbox.claim_token,
    public.message_outbox.claim_version,
    public.message_outbox.status,
    public.message_outbox.attempts,
    public.message_outbox.locked_until,
    public.message_outbox.payload,
    public.message_outbox.message_id
  INTO
    r_token, r_version, r_status, r_attempts, r_locked_until, r_payload, r_message_id;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, r_token, r_version, r_status, r_attempts, r_locked_until, r_payload, r_message_id, NULL::TEXT;
    RETURN;
  END IF;

  -- 4. Reivindicação não concedida: diagnóstico determinístico e tratamento atômico de limite excedido
  SELECT o.status, o.attempts, COALESCE(o.max_attempts, 5), o.locked_until
  INTO r_status, r_attempts, r_max_attempts, r_locked_until
  FROM public.message_outbox o
  WHERE o.id = p_outbox_id AND o.company_id = p_company_id;

  IF r_status IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, NULL::TEXT, NULL::INTEGER, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::UUID, 'outbox_not_found'::TEXT;
    RETURN;
  END IF;

  IF r_status = 'sent' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, r_status, r_attempts, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::UUID, 'already_sent'::TEXT;
    RETURN;
  END IF;

  IF r_status = 'suppressed' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, r_status, r_attempts, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::UUID, 'suppressed'::TEXT;
    RETURN;
  END IF;

  IF r_status = 'processing' AND r_locked_until >= v_now THEN
    -- Há um lease ativo vigente pertencente a outro worker: preserva sem alteração
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, r_status, r_attempts, r_locked_until, NULL::JSONB, NULL::UUID, 'active_lease'::TEXT;
    RETURN;
  END IF;

  -- Se o lease NÃO está ativo (está pending, failed ou processing expirado) E attempts >= max_attempts:
  IF r_attempts >= r_max_attempts THEN
    -- Marca atomicamente como 'failed' com last_error = 'max_attempts_reached',
    -- limpando os campos de lease e invalidando o claim_token antigo.
    UPDATE public.message_outbox
    SET
      status       = 'failed',
      last_error   = 'max_attempts_reached',
      locked_at    = NULL,
      locked_until = NULL,
      claim_token  = NULL,
      updated_at   = v_now
    WHERE id = p_outbox_id
      AND company_id = p_company_id
      AND (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND (locked_until IS NULL OR locked_until < v_now))
      )
      AND attempts >= COALESCE(max_attempts, 5);

    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, 'failed'::TEXT, r_attempts, NULL::TIMESTAMPTZ, NULL::JSONB, NULL::UUID, 'max_attempts_reached'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::BIGINT, r_status, r_attempts, r_locked_until, NULL::JSONB, NULL::UUID, 'not_eligible'::TEXT;
END;
$$;

-- ------------------------------------------------------------------------------
-- PARTE 5: RPC complete_outbox_message (FENCING, ATUALIZAÇÃO E INVALIDAÇÃO DE TOKEN)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_outbox_message(
  p_company_id    UUID,
  p_outbox_id     UUID,
  p_claim_token   UUID,
  p_claim_version BIGINT,
  p_status        TEXT,
  p_last_error    TEXT DEFAULT NULL
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

  -- 2. Atualização condicionada ao estado de processing e ao fencing exato.
  -- Ao concluir, invalida o claim_token (NULL) e limpa locked_at e locked_until,
  -- impedindo que chamadas repetidas com o mesmo token alterem novamente o estado.
  UPDATE public.message_outbox
  SET
    status       = p_status,
    last_error   = CASE WHEN p_status = 'sent' THEN NULL ELSE p_last_error END,
    sent_at      = CASE WHEN p_status = 'sent' THEN v_now ELSE sent_at END,
    locked_at    = NULL,
    locked_until = NULL,
    claim_token  = NULL,
    updated_at   = v_now
  WHERE id = p_outbox_id
    AND company_id = p_company_id
    AND status = 'processing'
    AND claim_token = p_claim_token
    AND claim_version = p_claim_version
  RETURNING status INTO r_status;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, r_status, NULL::TEXT;
    RETURN;
  END IF;

  -- 3. Diagnóstico de falha de conclusão / fencing / chamada repetida
  SELECT o.status INTO r_status
  FROM public.message_outbox o
  WHERE o.id = p_outbox_id AND o.company_id = p_company_id;

  IF r_status IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'outbox_not_found'::TEXT;
  ELSIF r_status != 'processing' THEN
    RETURN QUERY SELECT FALSE, r_status, 'already_completed'::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, r_status, 'fencing_token_mismatch'::TEXT;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- PARTE 6: PERMISSÕES E SEGURANÇA (EXCLUSIVO SERVICE_ROLE)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.claim_outbox_message(UUID, UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_outbox_message(UUID, UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_outbox_message(UUID, UUID, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_message(UUID, UUID, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_outbox_message(UUID, UUID, UUID, BIGINT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.claim_outbox_message IS
  'Reivindica atomicamente uma mensagem da outbox para despacho com lease e fencing token. '
  'Impede concorrência entre processos de envio. Exclusivo para service_role.';

COMMENT ON FUNCTION public.complete_outbox_message IS
  'Finaliza o estado da mensagem da outbox com verificação de fencing (claim_token e claim_version). '
  'Impede que processos zumbis com lease vencido sobrescrevam novos envios. Exclusivo para service_role.';
