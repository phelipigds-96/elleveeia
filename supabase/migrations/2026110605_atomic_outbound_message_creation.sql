-- ==============================================================================
-- CRIAÇÃO ATÔMICA DE MENSAGEM DE SAÍDA E OUTBOX (PIPELINE UNIFICADO)
-- Migration: 2026110605_atomic_outbound_message_creation.sql
-- ==============================================================================
-- Justificativa:
-- Elimina a assimetria e o risco de inconsistência entre as tabelas public.messages
-- e public.message_outbox, garantindo que qualquer mensagem de saída (humana, IA ou sistema)
-- seja persistida juntamente com o seu respectivo registro na outbox em uma única
-- transação atômica (ACID), com verificação de idempotência e validação de tenant.
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
  v_company_status  TEXT;
  v_conv_company_id UUID;
  v_conv_channel    TEXT;
  v_customer_id     UUID;
  v_recipient_phone TEXT;
  v_channel         TEXT;
  v_now             TIMESTAMPTZ := clock_timestamp();
  v_message_id      UUID;
  v_outbox_id       UUID;
  v_final_payload   JSONB;
  r_existing_msg_id UUID;
  r_existing_out_id UUID;
  r_existing_status TEXT;
BEGIN
  -- 1. Validações de parâmetros obrigatórios
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
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT FALSE, FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, 'idempotency_key_required'::TEXT;
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
  SELECT cv.company_id, cv.channel, cv.customer_id
  INTO v_conv_company_id, v_conv_channel, v_customer_id
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

  -- 4. Resolução do canal e destinatário (se não fornecidos explicitamente)
  v_channel := COALESCE(NULLIF(trim(p_channel), ''), v_conv_channel, 'whatsapp');

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

  -- 5. Checagem de Idempotência na Outbox (escopo de company_id + idempotency_key)
  SELECT mo.id, mo.message_id, mo.status
  INTO r_existing_out_id, r_existing_msg_id, r_existing_status
  FROM public.message_outbox mo
  WHERE mo.company_id = p_company_id
    AND mo.idempotency_key = trim(p_idempotency_key);

  IF r_existing_out_id IS NOT NULL THEN
    -- Mensagem e outbox já foram criadas anteriormente para esta idempotency_key
    RETURN QUERY SELECT FALSE, TRUE, r_existing_msg_id, r_existing_out_id, r_existing_status, NULL::TEXT;
    RETURN;
  END IF;

  -- 6. Inserção Atômica na tabela messages
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

  -- 7. Montagem do payload outbound
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

  -- 8. Inserção Atômica na tabela message_outbox vinculada à mensagem
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

  -- 9. Atualização temporal da conversa (last_message_at)
  UPDATE public.conversations cv
  SET
    last_message_at = v_now,
    updated_at      = v_now
  WHERE cv.id = p_conversation_id
    AND cv.company_id = p_company_id;

  -- 10. Retorno de Sucesso com criação atômica confirmada
  RETURN QUERY SELECT TRUE, FALSE, v_message_id, v_outbox_id, 'pending'::TEXT, NULL::TEXT;
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
  'Cria atomicamente uma mensagem de saída na tabela messages e o respectivo registro na outbox '
  'em uma única transação, com idempotência e validação de tenant. Exclusivo para service_role.';
