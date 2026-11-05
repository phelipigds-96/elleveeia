-- ==============================================================================
-- HARDENING DE IDEMPOTÊNCIA CONCORRENTE, IDENTIDADE DO REMETENTE E LIMITES DE ENTRADA
-- Migration: 2026110606_atomic_outbound_concurrency_identity_hardening.sql
-- ==============================================================================
-- Justificativa:
-- Corrige as vulnerabilidades identificadas na auditoria Q.2.8B.1:
-- 1. F-01: Elimina SQLSTATE 23505 em execuções concorrentes com mesma chave de idempotência.
--    Utiliza subtransação protegida e inspeção precisa da constraint de unicidade violada,
--    garantindo que uma sessão vença (was_inserted=true) e a outra receba duplicate=true com
--    os mesmos IDs gerados pela vencedora, sem gerar registros órfãos ou mascarar outras constraints.
-- 2. F-02: Valida rigorosamente a identidade do remetente (sender_type e sender_id):
--    - human: sender_id obrigatório, existente em public.profiles e do mesmo tenant.
--    - agent: sender_id deve ser NULL (já que messages.sender_id referencia profiles);
--             se especificado agent_id em metadata ou na conversa, valida existência, tenant e status ativo.
--    - system: sender_id deve ser NULL (não pode mascarar operador humano).
-- 3. F-03: Estabelece limites estritos de entrada:
--    - p_idempotency_key: 1 a 128 caracteres.
--    - p_content: 1 a 65.536 caracteres.
--    - p_payload: máximo de 262.144 bytes textuais.
--    - p_metadata: máximo de 65.536 bytes textuais.
--    - p_channel: máximo de 32 caracteres e canais suportados.
--    - p_recipient: validação de tamanho (máximo 64) e formato telefônico para whatsapp.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.create_outbound_message_atomic(
  p_company_id      UUID,
  p_conversation_id UUID,
  p_sender_type     TEXT,
  p_content         TEXT,
  p_idempotency_key TEXT,
  p_sender_id       UUID DEFAULT NULL,
  p_message_type    TEXT DEFAULT 'text',
  p_metadata        JSONB DEFAULT NULL,
  p_channel         TEXT DEFAULT NULL,
  p_recipient       TEXT DEFAULT NULL,
  p_payload         JSONB DEFAULT NULL
)
RETURNS TABLE (
  was_inserted   BOOLEAN,
  duplicate      BOOLEAN,
  message_id     UUID,
  outbox_id      UUID,
  status         TEXT,
  error_reason   TEXT
)
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  v_company_status    TEXT;
  v_conv_company_id   UUID;
  v_conv_channel      TEXT;
  v_conv_agent_id     UUID;
  v_customer_id       UUID;
  v_recipient_phone   TEXT;
  v_channel           TEXT;
  v_now               TIMESTAMPTZ := clock_timestamp();
  v_message_id        UUID;
  v_outbox_id         UUID;
  v_final_payload     JSONB;
  r_existing_msg_id   UUID;
  r_existing_out_id   UUID;
  r_existing_status   TEXT;
  v_constraint_name   TEXT;
  v_sender_company_id UUID;
  v_agent_id          UUID;
  v_agent_company_id  UUID;
  v_agent_is_active   BOOLEAN;
BEGIN
  -- 1. Validações de parâmetros obrigatórios e limites de tamanho
  IF p_company_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'company_id_required'::TEXT;
    RETURN;
  END IF;

  IF p_conversation_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'conversation_id_required'::TEXT;
    RETURN;
  END IF;

  IF p_content IS NULL OR trim(p_content) = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'content_required'::TEXT;
    RETURN;
  END IF;

  IF length(p_content) > 65536 THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'content_too_long'::TEXT;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'idempotency_key_required'::TEXT;
    RETURN;
  END IF;

  IF length(trim(p_idempotency_key)) > 128 THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'idempotency_key_too_long'::TEXT;
    RETURN;
  END IF;

  IF p_payload IS NOT NULL AND octet_length(p_payload::text) > 262144 THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'payload_too_large'::TEXT;
    RETURN;
  END IF;

  IF p_metadata IS NOT NULL AND octet_length(p_metadata::text) > 65536 THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'metadata_too_large'::TEXT;
    RETURN;
  END IF;

  IF p_sender_type IS NULL OR p_sender_type NOT IN ('agent', 'human', 'system') THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'invalid_sender_type'::TEXT;
    RETURN;
  END IF;

  -- 2. Validação central do status da empresa (Defesa em Profundidade)
  SELECT c.status INTO v_company_status
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_company_status IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'company_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_company_status != 'active' THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, ('company_not_active:' || v_company_status)::TEXT;
    RETURN;
  END IF;

  -- 3. Validação de existência da conversa e pertencimento ao tenant
  SELECT cv.company_id, cv.channel, cv.customer_id, cv.agent_id
  INTO v_conv_company_id, v_conv_channel, v_customer_id, v_conv_agent_id
  FROM public.conversations cv
  WHERE cv.id = p_conversation_id;

  IF v_conv_company_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'conversation_not_found'::TEXT;
    RETURN;
  END IF;

  IF v_conv_company_id != p_company_id THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'conversation_tenant_mismatch'::TEXT;
    RETURN;
  END IF;

  -- 4. Validação de Identidade do Remetente (F-02)
  IF p_sender_type = 'human' THEN
    IF p_sender_id IS NULL THEN
      RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'sender_id_required_for_human'::TEXT;
      RETURN;
    END IF;

    SELECT pr.company_id INTO v_sender_company_id
    FROM public.profiles pr
    WHERE pr.id = p_sender_id;

    IF v_sender_company_id IS NULL THEN
      RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'sender_profile_not_found'::TEXT;
      RETURN;
    END IF;

    IF v_sender_company_id != p_company_id THEN
      RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'sender_tenant_mismatch'::TEXT;
      RETURN;
    END IF;

  ELSIF p_sender_type = 'system' THEN
    -- Mensagens do sistema não podem carregar sender_id simulando operador humano
    IF p_sender_id IS NOT NULL THEN
      RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'system_sender_id_must_be_null'::TEXT;
      RETURN;
    END IF;

  ELSIF p_sender_type = 'agent' THEN
    -- A tabela messages possui FK: messages_sender_id_fkey -> profiles(id).
    -- Não inventamos relação artificial com profiles; sender_id de agent deve ser NULL em messages.
    IF p_sender_id IS NOT NULL THEN
      RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'agent_sender_id_must_be_null'::TEXT;
      RETURN;
    END IF;

    -- Se houver identificador de agente especificado em metadata ou na conversa, validamos integridade
    IF p_metadata IS NOT NULL AND p_metadata ? 'agent_id' AND (p_metadata->>'agent_id') IS NOT NULL AND trim(p_metadata->>'agent_id') != '' THEN
      BEGIN
        v_agent_id := (p_metadata->>'agent_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'invalid_agent_id_format'::TEXT;
        RETURN;
      END;
    ELSE
      v_agent_id := v_conv_agent_id;
    END IF;

    IF v_agent_id IS NOT NULL THEN
      SELECT ag.company_id, ag.is_active
      INTO v_agent_company_id, v_agent_is_active
      FROM public.agents ag
      WHERE ag.id = v_agent_id;

      IF v_agent_company_id IS NULL THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'agent_not_found'::TEXT;
        RETURN;
      END IF;

      IF v_agent_company_id != p_company_id THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'agent_tenant_mismatch'::TEXT;
        RETURN;
      END IF;

      IF NOT v_agent_is_active THEN
        RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'agent_not_active'::TEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  -- 5. Resolução e validação de Canal e Destinatário (F-03)
  v_channel := lower(trim(COALESCE(NULLIF(trim(p_channel), ''), v_conv_channel, 'whatsapp')));

  IF length(v_channel) > 32 OR v_channel NOT IN ('whatsapp', 'instagram', 'chat', 'web', 'email') THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'invalid_channel'::TEXT;
    RETURN;
  END IF;

  IF p_recipient IS NOT NULL AND trim(p_recipient) != '' THEN
    v_recipient_phone := trim(p_recipient);
  ELSIF v_customer_id IS NOT NULL THEN
    SELECT cust.phone INTO v_recipient_phone
    FROM public.customers cust
    WHERE cust.id = v_customer_id AND cust.company_id = p_company_id;
  END IF;

  IF v_recipient_phone IS NULL OR trim(v_recipient_phone) = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'missing_recipient_phone'::TEXT;
    RETURN;
  END IF;

  IF length(v_recipient_phone) > 64 THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'invalid_recipient'::TEXT;
    RETURN;
  END IF;

  IF v_channel = 'whatsapp' THEN
    IF NOT (v_recipient_phone ~ '^\+?[0-9]{7,32}$') THEN
      RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'invalid_recipient'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- 6. Checagem de Idempotência Sequencial (Fast-path)
  SELECT mo.id, mo.message_id, mo.status
  INTO r_existing_out_id, r_existing_msg_id, r_existing_status
  FROM public.message_outbox mo
  WHERE mo.company_id = p_company_id
    AND mo.idempotency_key = trim(p_idempotency_key);

  IF r_existing_out_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, TRUE, r_existing_msg_id, r_existing_out_id, r_existing_status, NULL::TEXT;
    RETURN;
  END IF;

  -- 7. Inserção Atômica com Proteção Concorrente (F-01)
  BEGIN
    -- 7a. Inserção na tabela messages
    INSERT INTO public.messages (
      company_id,
      conversation_id,
      sender_type,
      sender_id,
      content,
      message_type,
      metadata,
      created_at,
      external_id
    ) VALUES (
      p_company_id,
      p_conversation_id,
      p_sender_type,
      p_sender_id,
      trim(p_content),
      COALESCE(NULLIF(trim(p_message_type), ''), 'text'),
      COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('delivery_status', 'pending'),
      v_now,
      trim(p_idempotency_key)
    )
    RETURNING public.messages.id INTO v_message_id;

    -- 7b. Montagem do payload outbound
    IF p_payload IS NOT NULL AND p_payload != '{}'::jsonb THEN
      v_final_payload := p_payload;
      IF v_final_payload ? 'metadata' THEN
        v_final_payload := jsonb_set(
          v_final_payload,
          '{metadata,message_id}',
          to_jsonb(v_message_id::text),
          true
        );
      ELSE
        v_final_payload := v_final_payload || jsonb_build_object('metadata', jsonb_build_object('message_id', v_message_id));
      END IF;
    ELSE
      v_final_payload := jsonb_build_object(
        'event_id', trim(p_idempotency_key),
        'event_type', 'message.send',
        'channel', v_channel,
        'conversation_id', p_conversation_id,
        'customer', jsonb_build_object('phone', v_recipient_phone),
        'message', jsonb_build_object(
          'content', trim(p_content),
          'message_type', COALESCE(NULLIF(trim(p_message_type), ''), 'text')
        ),
        'metadata', jsonb_build_object(
          'message_id', v_message_id,
          'sender_type', p_sender_type
        )
      );
    END IF;

    -- 7c. Inserção na tabela message_outbox vinculada à mensagem
    INSERT INTO public.message_outbox (
      company_id,
      conversation_id,
      message_id,
      idempotency_key,
      channel,
      recipient,
      payload,
      status,
      attempts,
      max_attempts,
      created_at,
      updated_at
    ) VALUES (
      p_company_id,
      p_conversation_id,
      v_message_id,
      trim(p_idempotency_key),
      v_channel,
      v_recipient_phone,
      v_final_payload,
      'pending',
      0,
      5,
      v_now,
      v_now
    )
    RETURNING public.message_outbox.id INTO v_outbox_id;

    -- 7d. Atualização temporal da conversa (last_message_at)
    UPDATE public.conversations cv
    SET
      last_message_at = v_now,
      updated_at      = v_now
    WHERE cv.id = p_conversation_id
      AND cv.company_id = p_company_id;

    -- Sucesso: Mensagem inserida
    RETURN QUERY SELECT TRUE, FALSE, v_message_id, v_outbox_id, 'pending'::TEXT, NULL::TEXT;
    RETURN;

  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
      
      -- Captura unicamente colisões decorrentes da idempotência da mensagem ou outbox
      IF v_constraint_name IN ('uq_messages_conversation_external_id', 'uq_outbox_company_idempotency') THEN
        -- Recupera registro persistido pela transação vencedora
        SELECT mo.id, mo.message_id, mo.status
        INTO r_existing_out_id, r_existing_msg_id, r_existing_status
        FROM public.message_outbox mo
        WHERE mo.company_id = p_company_id
          AND mo.idempotency_key = trim(p_idempotency_key);

        IF r_existing_out_id IS NOT NULL THEN
          RETURN QUERY SELECT FALSE, TRUE, r_existing_msg_id, r_existing_out_id, r_existing_status, NULL::TEXT;
          RETURN;
        ELSE
          -- Se a transação vencedora sofreu rollback ou registro não está acessível
          RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'concurrent_conflict_retry_required'::TEXT;
          RETURN;
        END IF;
      ELSE
        -- Colisão em qualquer outra constraint: NÃO mascarar como duplicata; relançar exceção!
        RAISE;
      END IF;
  END;
END;
$$;

-- ------------------------------------------------------------------------------
-- PERMISSÕES E SEGURANÇA (EXCLUSIVO SERVICE_ROLE)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_outbound_message_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_outbound_message_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_outbound_message_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_outbound_message_atomic(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.create_outbound_message_atomic IS
  'Cria atomicamente uma mensagem de saída e outbox com resolução atômica de concorrência idempotente, validação de limites e verificação de identidade do remetente. Exclusivo para service_role.';
