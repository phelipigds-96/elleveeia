-- ==============================================================================
-- ETAPA 8.4.3Q.2.3 — IDEMPOTÊNCIA DE MENSAGENS E CONSISTÊNCIA TRANSACIONAL
-- Arquivo: supabase/migrations/20261106_message_idempotency_unread_monotonic.sql
-- ==============================================================================
-- Objetivo:
-- 1. Garantir idempotência no nível da mensagem via UNIQUE(company_id, external_id)
--    em public.messages — com verificação prévia de duplicatas existentes.
-- 2. Garantir incremento atômico de unread_count sem race condition.
-- 3. Garantir que last_message_at seja monotônico (nunca retrocede).
-- 4. Implementar RPC insert_message_idempotent com SECURITY DEFINER,
--    SET search_path = public, filtros company_id, e permissão exclusiva para service_role.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: PRÉ-AUDITORIA — Detectar external_id duplicados em messages
-- ------------------------------------------------------------------------------
-- Abort the migration if there are already duplicate (company_id, external_id)
-- pairs that would violate the new unique constraint.
-- Only non-null external_ids are considered (NULLs are always distinct per SQL standard).
DO $$
DECLARE
  v_duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT company_id, external_id, COUNT(*) as cnt
    FROM public.messages
    WHERE external_id IS NOT NULL
    GROUP BY company_id, external_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_ABORTED: Encontrados % grupo(s) de mensagens com (company_id, external_id) duplicado em public.messages. '
      'Regularize os registros antes de aplicar a constraint de idempotência. '
      'Query de diagnóstico: SELECT company_id, external_id, COUNT(*) FROM public.messages WHERE external_id IS NOT NULL GROUP BY company_id, external_id HAVING COUNT(*) > 1;',
      v_duplicate_count;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PARTE 2: ÍNDICE ÚNICO PARCIAL — Idempotência de external_id por empresa
-- ------------------------------------------------------------------------------
-- Partial unique index: only non-null external_ids are constrained.
-- This allows multiple messages with external_id = NULL (e.g., internal/agent messages).
-- idx_messages_ext_id already exists as a non-unique index (from 20261003_message_engine.sql).
-- We drop it and recreate as UNIQUE PARTIAL.
DROP INDEX IF EXISTS public.idx_messages_ext_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_company_external_id
  ON public.messages (company_id, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON INDEX public.uq_messages_company_external_id IS
  'Garante que cada external_id de mensagem seja único por empresa. '
  'Apenas valores não-nulos são restritos — mensagens internas (sem external_id) podem coexistir.';

-- ------------------------------------------------------------------------------
-- PARTE 3: RPC insert_message_idempotent
-- Insere uma mensagem de forma idempotente e atualiza atomicamente unread_count
-- e last_message_at da conversa. Retorna (message_id, was_inserted).
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_message_idempotent(
  p_company_id      UUID,
  p_conversation_id UUID,
  p_external_id     TEXT,
  p_sender_type     TEXT,
  p_content         TEXT,
  p_created_at      TIMESTAMPTZ,
  p_metadata        JSONB DEFAULT NULL,
  p_message_type    TEXT DEFAULT 'text'
)
RETURNS TABLE(message_id UUID, was_inserted BOOLEAN)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_message_id  UUID;
  v_inserted    BOOLEAN := FALSE;
BEGIN
  -- 1. Validação de parâmetros obrigatórios
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_company_id não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_conversation_id não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_sender_type IS NULL OR p_sender_type = '' THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_sender_type não pode ser NULL ou vazio' USING ERRCODE = 'P0001';
  END IF;
  IF p_content IS NULL THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_content não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_created_at IS NULL THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_created_at não pode ser NULL' USING ERRCODE = 'P0001';
  END IF;
  IF p_external_id IS NOT NULL AND LENGTH(TRIM(p_external_id)) = 0 THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_external_id não pode ser uma string vazia' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Verificação de que a conversa pertence à empresa — impede operações cross-tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id
      AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'insert_message_idempotent: conversa % não encontrada ou não pertence à empresa %',
      p_conversation_id, p_company_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Tentativa de inserção idempotente
  --    Se external_id já existir para esta empresa → ON CONFLICT DO NOTHING
  --    Se external_id for NULL → sempre insere (NULLs não conflitam)
  IF p_external_id IS NOT NULL THEN
    -- Idempotente por (company_id, external_id)
    INSERT INTO public.messages (
      company_id,
      conversation_id,
      sender_type,
      content,
      message_type,
      external_id,
      metadata,
      created_at
    )
    VALUES (
      p_company_id,
      p_conversation_id,
      p_sender_type,
      p_content,
      COALESCE(p_message_type, 'text'),
      p_external_id,
      p_metadata,
      p_created_at
    )
    ON CONFLICT (company_id, external_id) WHERE external_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_message_id;

    IF v_message_id IS NULL THEN
      -- Conflito detectado: recupera o ID já existente
      SELECT id INTO v_message_id
      FROM public.messages
      WHERE company_id = p_company_id
        AND external_id = p_external_id
      LIMIT 1;

      v_inserted := FALSE;
    ELSE
      v_inserted := TRUE;
    END IF;
  ELSE
    -- Sem external_id: inserção sem deduplicação (mensagens internas, respostas do agente)
    INSERT INTO public.messages (
      company_id,
      conversation_id,
      sender_type,
      content,
      message_type,
      external_id,
      metadata,
      created_at
    )
    VALUES (
      p_company_id,
      p_conversation_id,
      p_sender_type,
      p_content,
      COALESCE(p_message_type, 'text'),
      NULL,
      p_metadata,
      p_created_at
    )
    RETURNING id INTO v_message_id;

    v_inserted := TRUE;
  END IF;

  -- 4. Atualização atômica da conversa — apenas se a mensagem foi inserida agora
  IF v_inserted THEN
    UPDATE public.conversations
    SET
      unread_count  = CASE
                        WHEN p_sender_type = 'customer' THEN unread_count + 1
                        ELSE unread_count
                      END,
      last_message_at = GREATEST(last_message_at, p_created_at),
      updated_at    = NOW()
    WHERE id         = p_conversation_id
      AND company_id = p_company_id;
  END IF;

  -- 5. Retorno
  RETURN QUERY SELECT v_message_id, v_inserted;
END;
$$;

-- Revogação de acesso público — acesso exclusivo para service_role
REVOKE EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.insert_message_idempotent IS
  'Insere mensagem com deduplicação por (company_id, external_id) e atualiza '
  'unread_count atomicamente e last_message_at de forma monotônica (GREATEST). '
  'Retorna (message_id, was_inserted). Acesso exclusivo para service_role.';
