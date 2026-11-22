-- Migration: 2026112204_enterprise_quotes_atomic_rpc.sql
-- ELLEVEE IA — AC-04.5-P0.1/P0.2: Persistência Atômica Transacional e Concorrência de Orçamentos
-- Garante gravação atômica (cabeçalho, itens, versão e integridade referencial) em transação única no PostgreSQL,
-- com serialização por conversa (pg_advisory_xact_lock), bloqueio pessimista (FOR UPDATE),
-- validação cruzada de tenant/conversa/cliente e constraint de unicidade parcial para orçamentos ativos por conversa.

-- 1. Índice de Unicidade Parcial: Garante que uma conversa tenha no máximo UM orçamento ativo
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_active_conversation_unique
ON public.quotes (company_id, (metadata->>'conversation_id'))
WHERE status IN ('draft', 'pending_validation', 'ready')
  AND (metadata->>'conversation_id') IS NOT NULL;

-- 2. Função RPC Atômica com Serialização, Controle de Concorrência e Isolamento Estrito
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
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
    v_target_quote_id UUID;
    v_current_version INTEGER := 1;
    v_new_version INTEGER := 1;
    v_existing_quote RECORD;
    v_conv_record RECORD;
    v_customer_record RECORD;
    v_effective_customer_id UUID;
    v_clean_metadata JSONB;
    v_item JSONB;
    v_result JSONB;
BEGIN
    -- 1. Validações preliminares obrigatórias e fail-closed
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_id é obrigatório para persistir orçamento.';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'O orçamento deve conter pelo menos um item.';
    END IF;

    -- Validação consistente de vínculos (Empresa, Cliente, Conversa)
    -- A) Se cliente informado, valida consistência com empresa (se registro existir no catálogo)
    IF p_customer_id IS NOT NULL THEN
        SELECT company_id INTO v_customer_record
        FROM public.customers
        WHERE id = p_customer_id;

        IF FOUND AND v_customer_record.company_id <> p_company_id THEN
            RAISE EXCEPTION 'ORCAMENTO_CROSS_COMPANY_FORBIDDEN: O cliente % pertence a outra empresa.', p_customer_id;
        END IF;
    END IF;

    -- B) Se conversa informada, valida consistência com empresa e cliente (se conversa for UUID válido e existir)
    v_effective_customer_id := p_customer_id;
    IF p_conversation_id IS NOT NULL AND p_conversation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id, company_id, customer_id INTO v_conv_record
        FROM public.conversations
        WHERE id = p_conversation_id::uuid;

        IF FOUND THEN
            IF v_conv_record.company_id <> p_company_id THEN
                RAISE EXCEPTION 'ORCAMENTO_CROSS_COMPANY_FORBIDDEN: A conversa % pertence a outra empresa.', p_conversation_id;
            END IF;

            IF p_customer_id IS NOT NULL AND v_conv_record.customer_id IS NOT NULL AND v_conv_record.customer_id <> p_customer_id THEN
                RAISE EXCEPTION 'ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: O cliente % não corresponde ao cliente vinculado à conversa %.', p_customer_id, p_conversation_id;
            END IF;

            -- Auto-associa customer_id da conversa caso tenha sido omitido na chamada
            IF v_effective_customer_id IS NULL AND v_conv_record.customer_id IS NOT NULL THEN
                v_effective_customer_id := v_conv_record.customer_id;
            END IF;
        END IF;
    END IF;

    -- 2. Serialização transacional de concorrência por conversa
    IF p_conversation_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || p_conversation_id));
    END IF;

    -- 3. Localização e Bloqueio de Orçamento Existente (Pessimistic Concurrency Lock)
    IF p_existing_quote_id IS NOT NULL THEN
        -- Exige controle de versão explícito para qualquer atualização direta por ID
        IF p_expected_version IS NULL THEN
            RAISE EXCEPTION 'ORCAMENTO_VERSION_REQUIRED: Controle de versão (expectedVersion) é obrigatório para atualização de orçamento existente.';
        END IF;

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
        IF v_effective_customer_id IS NOT NULL 
           AND v_existing_quote.customer_id IS NOT NULL 
           AND v_existing_quote.customer_id <> v_effective_customer_id THEN
            RAISE EXCEPTION 'ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: Orçamento pertence a outro cliente.';
        END IF;

        -- Concorrência Otimista Atômica no Banco (Gate 2)
        v_current_version := COALESCE((v_existing_quote.metadata->>'version')::INTEGER, 1);
        IF v_current_version <> p_expected_version THEN
            RAISE EXCEPTION 'ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada % difere da versão atual % no banco de dados.',
                p_expected_version, v_current_version;
        END IF;

        v_target_quote_id := v_existing_quote.id;
        v_new_version := v_current_version + 1;

    ELSIF p_conversation_id IS NOT NULL THEN
        -- Tentativa de gravação por conversa sem existing_quote_id explícito
        -- Busca se já existe orçamento ativo para esta conversa
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
            -- Validação de isolamento de cliente no caminho de conversa (Gate 1)
            IF v_effective_customer_id IS NOT NULL 
               AND v_existing_quote.customer_id IS NOT NULL 
               AND v_existing_quote.customer_id <> v_effective_customer_id THEN
                RAISE EXCEPTION 'ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN: Orçamento ativo da conversa pertence a outro cliente.';
            END IF;

            -- Exige controle de versão: se expectedVersion for NULL, impede sobrescrita cega
            IF p_expected_version IS NULL THEN
                RAISE EXCEPTION 'ORCAMENTO_ACTIVE_EXISTS: Já existe um orçamento ativo (%) para a conversa %. Informe existingQuoteId e expectedVersion para atualizar.',
                    v_existing_quote.id, p_conversation_id;
            END IF;

            v_current_version := COALESCE((v_existing_quote.metadata->>'version')::INTEGER, 1);
            IF v_current_version <> p_expected_version THEN
                RAISE EXCEPTION 'ORCAMENTO_CONCURRENCY_CONFLICT: Versão esperada % difere da versão atual % no banco de dados.',
                    p_expected_version, v_current_version;
            END IF;

            v_target_quote_id := v_existing_quote.id;
            v_new_version := v_current_version + 1;
        END IF;
    END IF;

    -- 4. Sanitização e Proteção de Metadados e Campos de Controle
    -- Remove campos de controle para impedir adulteração arbitrária via p_metadata
    v_clean_metadata := COALESCE(p_metadata, '{}'::jsonb)
        - 'version'
        - 'company_id'
        - 'customer_id'
        - 'id'
        - 'created_at'
        - 'updated_at'
        - 'status'
        - 'total';

    -- Governança estrita do conversation_id:
    IF p_conversation_id IS NOT NULL THEN
        v_clean_metadata := jsonb_set(v_clean_metadata, '{conversation_id}', to_jsonb(p_conversation_id));
    ELSIF v_existing_quote.id IS NOT NULL AND (v_existing_quote.metadata->>'conversation_id') IS NOT NULL THEN
        v_clean_metadata := jsonb_set(v_clean_metadata, '{conversation_id}', to_jsonb(v_existing_quote.metadata->>'conversation_id'));
    ELSE
        v_clean_metadata := v_clean_metadata - 'conversation_id';
    END IF;

    -- Define a versão autorizada e calculada pelo motor
    v_clean_metadata := jsonb_set(v_clean_metadata, '{version}', to_jsonb(v_new_version));

    -- 5. Atualização ou Inserção do Cabeçalho
    IF v_target_quote_id IS NOT NULL THEN
        UPDATE public.quotes
        SET total = p_total,
            status = p_status,
            customer_id = COALESCE(v_effective_customer_id, customer_id),
            metadata = v_clean_metadata,
            updated_at = NOW()
        WHERE id = v_target_quote_id;

        -- Exclui itens anteriores atomicamente dentro da transação
        DELETE FROM public.quote_items WHERE quote_id = v_target_quote_id;
    ELSE
        -- Criação de novo orçamento
        v_target_quote_id := gen_random_uuid();
        v_new_version := 1;
        v_clean_metadata := jsonb_set(v_clean_metadata, '{version}', to_jsonb(1));

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
            v_effective_customer_id,
            p_status,
            p_total,
            v_clean_metadata,
            NOW(),
            NOW()
        );
    END IF;

    -- 6. Inserção Atômica dos Itens
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

    -- 7. Retorno estruturado atômico
    v_result := jsonb_build_object(
        'id', v_target_quote_id,
        'company_id', p_company_id,
        'customer_id', v_effective_customer_id,
        'conversation_id', p_conversation_id,
        'status', p_status,
        'version', v_new_version,
        'total', p_total,
        'item_count', jsonb_array_length(p_items)
    );

    RETURN v_result;
END;
$$;

-- 3. Permissões de Segurança Estritas (Princípio do Menor Privilégio)
-- A RPC manipula dados financeiros críticos de orçamentos e só deve ser invocada
-- a partir do backend confiável da aplicação (Node.js/Next.js) autenticado via service_role.
-- Chamadas diretas do cliente (browser) via chave pública anon ou JWT de authenticated são estritamente revogadas.
REVOKE ALL ON FUNCTION public.save_enterprise_quote_atomic(UUID, UUID, TEXT, UUID, INTEGER, TEXT, NUMERIC, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_enterprise_quote_atomic(UUID, UUID, TEXT, UUID, INTEGER, TEXT, NUMERIC, JSONB, JSONB) TO service_role;
