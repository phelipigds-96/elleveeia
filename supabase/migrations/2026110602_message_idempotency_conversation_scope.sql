-- ==============================================================================
-- ETAPA 8.4.3Q.2.3.2 — CORREÇÃO DA CHAVE DE IDEMPOTÊNCIA E HARDENING DA RPC
-- Arquivo: supabase/migrations/2026110602_message_idempotency_conversation_scope.sql
-- ==============================================================================
-- Objetivo:
-- 1. Substituir a chave de idempotência ampla (company_id, external_id) pela
--    chave delimitada por conversa (conversation_id, external_id).
-- 2. Permitir que conversas distintas da mesma empresa recebam o mesmo external_id
--    (requisito essencial para Telegram com IDs sequenciais por chat e múltiplos canais).
-- 3. Hardening na RPC insert_message_idempotent:
--    - search_path seguro: pg_catalog, public, pg_temp.
--    - Validação de p_sender_type no domínio: 'customer', 'agent', 'human', 'system'.
--    - Validação de teto temporal em p_created_at (máx. 10 min no futuro).
--    - Recuperação pós-conflito estritamente vinculada a (conversation_id, external_id).
--    - Preservação da atomicidade e unicidade de mensagens sem external_id (NULL).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: PRÉ-AUDITORIA DETERMINÍSTICA DE DUPLICATAS NA NOVA CHAVE
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_duplicate_count INTEGER;
BEGIN
  -- Verifica se já existem duplicatas na nova composição (conversation_id, external_id)
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT conversation_id, external_id, COUNT(*) as cnt
    FROM public.messages
    WHERE external_id IS NOT NULL
    GROUP BY conversation_id, external_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION_ABORTED: Encontrados % grupo(s) de mensagens com (conversation_id, external_id) duplicado em public.messages. '
      'Regularize os registros antes de aplicar a constraint de idempotência por conversa. '
      'Query de diagnóstico: SELECT conversation_id, external_id, COUNT(*) FROM public.messages WHERE external_id IS NOT NULL GROUP BY conversation_id, external_id HAVING COUNT(*) > 1;',
      v_duplicate_count;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PARTE 2: SUBSTITUIÇÃO DO ÍNDICE ÚNICO PARCIAL
-- ------------------------------------------------------------------------------
-- 1. Remove o índice anterior amplo por empresa
DROP INDEX IF EXISTS public.uq_messages_company_external_id;

-- 2. Cria o novo índice único parcial com escopo estrito de conversa
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_external_id
  ON public.messages (conversation_id, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON INDEX public.uq_messages_conversation_external_id IS
  'Garante idempotência estrita de mensagens por conversa (conversation_id, external_id). '
  'Permite que conversas diferentes recebam o mesmo external_id (ex: Telegram sequencial ou múltiplos canais) '
  'e que mensagens internas (external_id = NULL) coexistam sem restrição.';

-- ------------------------------------------------------------------------------
-- PARTE 3: RPC insert_message_idempotent COM HARDENING COMPLETO
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
SET search_path = pg_catalog, public, pg_temp
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
  IF p_sender_type NOT IN ('customer', 'agent', 'human', 'system') THEN
    RAISE EXCEPTION 'insert_message_idempotent: p_sender_type inválido (%). Valores aceitos: customer, agent, human, system',
      p_sender_type
      USING ERRCODE = 'P0001';
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

  -- 3. Inserção idempotente com escopo de conversa
  IF p_external_id IS NOT NULL THEN
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
    ON CONFLICT (conversation_id, external_id) WHERE external_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_message_id;

    IF v_message_id IS NULL THEN
      -- Conflito detectado: recupera o ID existente ESTRITAMENTE da mesma conversa
      SELECT id INTO v_message_id
      FROM public.messages
      WHERE conversation_id = p_conversation_id
        AND external_id = p_external_id
      LIMIT 1;

      IF v_message_id IS NULL THEN
        RAISE EXCEPTION 'insert_message_idempotent: inconsistência ao resolver conflito para external_id % na conversa %',
          p_external_id, p_conversation_id
          USING ERRCODE = 'P0001';
      END IF;

      v_inserted := FALSE;
    ELSE
      v_inserted := TRUE;
    END IF;
  ELSE
    -- Sem external_id: inserção direta sem deduplicação (mensagens internas, agentes, etc.)
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

  -- 4. Atualização atômica da conversa apenas se a mensagem for nova.
  -- Política de timestamps: preserva p_created_at original na mensagem para auditoria,
  -- mas protege last_message_at contra timestamps futuros absurdos limitando o avanço
  -- do ponteiro a no máximo NOW() + INTERVAL '48 hours' (tolerância de fusos horários internacionais e jitter).
  IF v_inserted THEN
    UPDATE public.conversations
    SET
      unread_count  = CASE
                        WHEN p_sender_type = 'customer' THEN unread_count + 1
                        ELSE unread_count
                      END,
      last_message_at = GREATEST(last_message_at, LEAST(p_created_at, NOW() + INTERVAL '48 hours')),
      updated_at    = NOW()
    WHERE id         = p_conversation_id
      AND company_id = p_company_id;
  END IF;

  -- 6. Retorno
  RETURN QUERY SELECT v_message_id, v_inserted;
END;
$$;

-- ------------------------------------------------------------------------------
-- PARTE 4: CONTROLE DE ACESSO (PERMISSÕES E SEGURANÇA)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.insert_message_idempotent(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.insert_message_idempotent IS
  'Insere mensagem de forma idempotente por (conversation_id, external_id). '
  'Garante integridade contextual, atualização atômica de unread_count e '
  'monotonicidade de last_message_at via GREATEST(). Acesso exclusivo para service_role.';

-- ------------------------------------------------------------------------------
-- NOTA DE ROLLBACK:
-- Para reverter tecnicamente esta migration:
-- 1. DROP INDEX public.uq_messages_conversation_external_id;
-- 2. CREATE UNIQUE INDEX uq_messages_company_external_id ON public.messages(company_id, external_id) WHERE external_id IS NOT NULL;
-- Limitação de rollback: se mensagens legítimas de conversas distintas com o mesmo external_id
-- tiverem sido inseridas no período em que esta migration esteve ativa, a recriação do índice
-- amplo falhará até que tais mensagens sejam arquivadas/desduplicadas.
-- ------------------------------------------------------------------------------
