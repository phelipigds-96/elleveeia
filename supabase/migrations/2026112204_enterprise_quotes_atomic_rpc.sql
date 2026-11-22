-- Migration: 2026112204_enterprise_quotes_atomic_rpc.sql
-- ELLEVEE IA — AC-04.5-P0: Persistência Atômica Transacional de Orçamentos Comerciais
-- Garante gravação atômica (cabeçalho, itens, versão e histórico) em transação única no PostgreSQL,
-- com bloqueio pessimista (FOR UPDATE) e validação de concorrência e autorização.

CREATE OR REPLACE FUNCTION public.save_enterprise_quote_atomic(
    p_company_id UUID,
    p_customer_id UUID DEFAULT NULL,
    p_conversation_id TEXT DEFAULT NULL,
    p_existing_quote_id UUID DEFAULT NULL,
    p_expected_version INTEGER DEFAULT NULL,
    p_status TEXT DEFAULT 'draft',
    p_total NUMERIC DEFAULT 0,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_quote_id UUID;
    v_current_version INTEGER := 1;
    v_new_version INTEGER := 1;
    v_existing_quote RECORD;
    v_item JSONB;
    v_result JSONB;
BEGIN
    -- 1. Validações preliminares obrigatórias
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_id é obrigatório para persistir orçamento.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'O orçamento deve conter pelo menos um item.';
    END IF;

    -- 2. Localização e Bloqueio de Orçamento Existente (Pessimistic Concurrency Lock)
    IF p_existing_quote_id IS NOT NULL THEN
        SELECT id, company_id, customer_id, status, metadata
        INTO v_existing_quote
        FROM public.quotes
        WHERE id = p_existing_quote_id
          AND company_id = p_company_id
          AND status IN ('draft', 'pending_validation', 'ready')
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ORCAMENTO_NOT_FOUND_OR_FORBIDDEN: Orçamento % não localizado ou status não modificável.', p_existing_quote_id;
        END IF;

        -- Validação de isolamento de conversa (Gate 1)
        IF p_conversation_id IS NOT NULL 
           AND (v_existing_quote.metadata->>'conversation_id') IS NOT NULL 
           AND (v_existing_quote.metadata->>'conversation_id') <> p_conversation_id THEN
            RAISE EXCEPTION 'ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN: Orçamento pertence à conversa % e não pode ser alterado por %.',
                v_existing_quote.metadata->>'conversation_id', p_conversation_id;
        END IF;

        -- Validação de isolamento de cliente (Gate 1)
        IF p_customer_id IS NOT NULL 
           AND v_existing_quote.customer_id IS NOT NULL 
           AND v_existing_quote.customer_id <> p_customer_id THEN
            RAISE EXCEPTION 'ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: Orçamento pertence a outro cliente.';
        END IF;

        -- Concorrência Otimista Atômica no Banco (Gate 2)
        v_current_version := COALESCE((v_existing_quote.metadata->>'version')::INTEGER, 1);
        IF p_expected_version IS NOT NULL AND v_current_version <> p_expected_version THEN
            RAISE EXCEPTION 'ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada % difere da versão atual % no banco de dados.',
                p_expected_version, v_current_version;
        END IF;

        v_target_quote_id := v_existing_quote.id;
        v_new_version := v_current_version + 1;

    ELSIF p_conversation_id IS NOT NULL THEN
        -- Busca por conversa com lock pessimista
        SELECT id, company_id, customer_id, status, metadata
        INTO v_existing_quote
        FROM public.quotes
        WHERE company_id = p_company_id
          AND metadata @> jsonb_build_object('conversation_id', p_conversation_id)
          AND status IN ('draft', 'pending_validation', 'ready')
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            v_current_version := COALESCE((v_existing_quote.metadata->>'version')::INTEGER, 1);
            IF p_expected_version IS NOT NULL AND v_current_version <> p_expected_version THEN
                RAISE EXCEPTION 'ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada % difere da versão atual % no banco de dados.',
                    p_expected_version, v_current_version;
            END IF;

            v_target_quote_id := v_existing_quote.id;
            v_new_version := v_current_version + 1;
        END IF;
    END IF;

    -- 3. Atualização ou Inserção do Cabeçalho
    IF v_target_quote_id IS NOT NULL THEN
        -- Atualiza cabeçalho existente
        UPDATE public.quotes
        SET total = p_total,
            status = p_status,
            customer_id = COALESCE(p_customer_id, customer_id),
            metadata = p_metadata || jsonb_build_object('version', v_new_version),
            updated_at = NOW()
        WHERE id = v_target_quote_id;

        -- Exclui itens anteriores atomicamente dentro da transação
        DELETE FROM public.quote_items WHERE quote_id = v_target_quote_id;
    ELSE
        -- Cria novo orçamento
        v_target_quote_id := gen_random_uuid();
        v_new_version := 1;

        INSERT INTO public.quotes (
            id,
            company_id,
            customer_id,
            status,
            total,
            metadata,
            created_at,
            updated_at
        ) VALUES (
            v_target_quote_id,
            p_company_id,
            p_customer_id,
            p_status,
            p_total,
            p_metadata || jsonb_build_object('version', 1),
            NOW(),
            NOW()
        );
    END IF;

    -- 4. Inserção Atômica dos Itens
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.quote_items (
            id,
            quote_id,
            company_id,
            product_id,
            quantity,
            unit_price,
            subtotal,
            metadata,
            created_at
        ) VALUES (
            gen_random_uuid(),
            v_target_quote_id,
            p_company_id,
            (v_item->>'product_id')::UUID,
            (v_item->>'quantity')::INTEGER,
            (v_item->>'unit_price')::NUMERIC,
            (v_item->>'subtotal')::NUMERIC,
            COALESCE(v_item->'metadata', '{}'::jsonb),
            NOW()
        );
    END LOOP;

    -- 5. Retorno estruturado atômico
    v_result := jsonb_build_object(
        'id', v_target_quote_id,
        'company_id', p_company_id,
        'customer_id', p_customer_id,
        'conversation_id', p_conversation_id,
        'status', p_status,
        'version', v_new_version,
        'total', p_total,
        'item_count', jsonb_array_length(p_items)
    );

    RETURN v_result;
END;
$$;
