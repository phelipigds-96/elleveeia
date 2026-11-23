-- Migration: 2026112204_enterprise_quotes_atomic_rpc.sql
-- ELLEVEE IA — AC-04.5-P0.3: Persistência Atômica Transacional e Concorrência de Orçamentos
-- Garante gravação atômica (cabeçalho, itens, versão e integridade referencial) em transação única no PostgreSQL,
-- com serialização por conversa (pg_advisory_xact_lock), bloqueio pessimista (FOR UPDATE),
-- validação cruzada rigorosa de empresa/conversa/cliente/produtos, preservação de metadados
-- e validação financeira estrita de invariantes (quantidades, preços, subtotais e totais).

-- 1. Índice de Unicidade Parcial: Garante que uma conversa tenha no máximo UM orçamento ativo
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_active_conversation_unique
ON public.quotes (company_id, (metadata->>'conversation_id'))
WHERE status IN ('draft', 'pending_validation', 'ready')
  AND (metadata->>'conversation_id') IS NOT NULL;

-- 2. Função RPC Atômica com Serialização, Controle de Concorrência e Validações Rigorosas
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
    v_product_record RECORD;
    v_effective_customer_id UUID;
    v_effective_conversation_id TEXT;
    v_clean_metadata JSONB;
    v_item JSONB;
    v_item_product_id UUID;
    v_item_qty INTEGER;
    v_item_price NUMERIC;
    v_item_subtotal NUMERIC;
    v_calculated_subtotal NUMERIC;
    v_sum_subtotals NUMERIC := 0;
    v_result JSONB;
BEGIN
    -- 1. Validações preliminares de parâmetros obrigatórios
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'EMPRESA_OBRIGATORIA: company_id é obrigatório para persistir orçamento.';
    END IF;

    -- Validação de existência da empresa no banco
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'EMPRESA_NOT_FOUND: Empresa % não localizada no banco de dados.', p_company_id;
    END IF;

    -- Validação de status permitido
    IF p_status NOT IN ('draft', 'pending_validation', 'ready', 'approved', 'rejected', 'expired') THEN
        RAISE EXCEPTION 'STATUS_INVALIDO: Status % não é permitido para orçamentos comerciais.', p_status;
    END IF;

    -- Validação de total não-negativo
    IF p_total IS NULL OR p_total < 0 THEN
        RAISE EXCEPTION 'TOTAL_INVALIDO: Total do orçamento não pode ser negativo ou nulo (recebido: %).', p_total;
    END IF;

    -- Validação de itens obrigatórios
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'ITENS_OBRIGATORIOS: O orçamento deve conter pelo menos um item.';
    END IF;

    -- 2. Validação estrita de vínculos de Conversa e Cliente no PostgreSQL
    v_effective_customer_id := p_customer_id;
    v_effective_conversation_id := p_conversation_id;

    -- Exigência de conversa para operações comerciais convencionais
    IF p_existing_quote_id IS NULL AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'CONVERSATION_ID_REQUIRED: conversation_id é obrigatório para criação de novos orçamentos comerciais.';
    END IF;

    -- Validação da conversa no banco (se informada)
    IF p_conversation_id IS NOT NULL THEN
        IF p_conversation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'CONVERSA_INVALIDA: Identificador de conversa inválido: % (deve ser UUID).', p_conversation_id;
        END IF;

        SELECT id, company_id, customer_id INTO v_conv_record
        FROM public.conversations
        WHERE id = p_conversation_id::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CONVERSA_NOT_FOUND: Conversa % não encontrada no banco de dados.', p_conversation_id;
        END IF;

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

    -- Validação do cliente no banco (se informado ou inferido da conversa)
    IF v_effective_customer_id IS NOT NULL THEN
        SELECT id, company_id INTO v_customer_record
        FROM public.customers
        WHERE id = v_effective_customer_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'CLIENTE_NOT_FOUND: Cliente % não localizado no banco de dados.', v_effective_customer_id;
        END IF;

        IF v_customer_record.company_id <> p_company_id THEN
            RAISE EXCEPTION 'ORCAMENTO_CROSS_COMPANY_FORBIDDEN: O cliente % pertence a outra empresa.', v_effective_customer_id;
        END IF;
    END IF;

    -- 3. Validação financeira de cada item e consistência com produtos do catálogo
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Extração de campos
        v_item_product_id := (v_item->>'product_id')::UUID;
        v_item_qty := (v_item->>'quantity')::INTEGER;
        v_item_price := (v_item->>'unit_price')::NUMERIC;
        v_item_subtotal := (v_item->>'subtotal')::NUMERIC;

        IF v_item_product_id IS NULL THEN
            RAISE EXCEPTION 'PRODUTO_INVALIDO: product_id é obrigatório e deve ser um UUID válido em cada item.';
        END IF;

        -- Validação de quantidade estritamente positiva
        IF v_item_qty IS NULL OR v_item_qty <= 0 THEN
            RAISE EXCEPTION 'FINANCEIRO_QUANTIDADE_INVALIDA: Quantidade deve ser maior que zero (recebido: %).', v_item_qty;
        END IF;

        -- Validação de preço unitário não negativo
        IF v_item_price IS NULL OR v_item_price < 0 THEN
            RAISE EXCEPTION 'FINANCEIRO_PRECO_INVALIDO: Preço unitário não pode ser negativo (recebido: %).', v_item_price;
        END IF;

        -- Validação de subtotal não negativo
        IF v_item_subtotal IS NULL OR v_item_subtotal < 0 THEN
            RAISE EXCEPTION 'FINANCEIRO_SUBTOTAL_INVALIDO: Subtotal não pode ser negativo (recebido: %).', v_item_subtotal;
        END IF;

        -- Validação de consistência matemática do subtotal
        v_calculated_subtotal := ROUND(v_item_qty * v_item_price, 2);
        IF ABS(v_item_subtotal - v_calculated_subtotal) > 0.001 THEN
            RAISE EXCEPTION 'FINANCEIRO_SUBTOTAL_INCONSISTENTE: Subtotal % diverge da multiplicação quantidade (%) x preço unitário (%) = %.',
                v_item_subtotal, v_item_qty, v_item_price, v_calculated_subtotal;
        END IF;

        -- Validação de existência do produto e titularidade da empresa
        SELECT id, company_id INTO v_product_record
        FROM public.products
        WHERE id = v_item_product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'PRODUTO_NOT_FOUND: Produto % não localizado no banco de dados.', v_item_product_id;
        END IF;

        IF v_product_record.company_id <> p_company_id THEN
            RAISE EXCEPTION 'ORCAMENTO_CROSS_COMPANY_FORBIDDEN: O produto % pertence a outra empresa.', v_item_product_id;
        END IF;

        v_sum_subtotals := v_sum_subtotals + v_item_subtotal;
    END LOOP;

    -- Validação de integridade do total do orçamento contra a soma dos itens
    IF ABS(v_sum_subtotals - p_total) > 0.001 THEN
        RAISE EXCEPTION 'FINANCEIRO_TOTAL_INCONSISTENTE: Total informado (%) diverge da soma dos itens (%).',
            p_total, v_sum_subtotals;
    END IF;

    -- 4. Serialização transacional de concorrência por conversa
    IF p_conversation_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(p_company_id::text || ':' || p_conversation_id));
    END IF;

    -- 5. Localização e Bloqueio de Orçamento Existente (Pessimistic Concurrency Lock)
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
        IF (v_existing_quote.metadata->>'conversation_id') IS NOT NULL THEN
            IF p_conversation_id IS NULL THEN
                RAISE EXCEPTION 'ORCAMENTO_CONVERSATION_REQUIRED: O orçamento % pertence a uma conversa e não pode ser atualizado sem conversation_id.', p_existing_quote_id;
            END IF;
            IF (v_existing_quote.metadata->>'conversation_id') <> p_conversation_id THEN
                RAISE EXCEPTION 'ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN: Orçamento pertence à conversa % e não pode ser alterado por %.',
                    v_existing_quote.metadata->>'conversation_id', p_conversation_id;
            END IF;
        ELSE
            -- Orçamento legado sem conversa: preserva conversation_id nulo se não fornecido
            v_effective_conversation_id := p_conversation_id;
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

    -- 6. Preservação e Sanitização de Metadados
    -- Preserva metadados anteriores no UPDATE e mescla novos campos legítimos
    IF v_target_quote_id IS NOT NULL THEN
        v_clean_metadata := COALESCE(v_existing_quote.metadata, '{}'::jsonb)
            || (COALESCE(p_metadata, '{}'::jsonb)
                - 'version'
                - 'company_id'
                - 'customer_id'
                - 'id'
                - 'created_at'
                - 'updated_at'
                - 'status'
                - 'total');
    ELSE
        v_clean_metadata := COALESCE(p_metadata, '{}'::jsonb)
            - 'version'
            - 'company_id'
            - 'customer_id'
            - 'id'
            - 'created_at'
            - 'updated_at'
            - 'status'
            - 'total';
    END IF;

    -- Governança estrita do conversation_id nos metadados
    IF v_effective_conversation_id IS NOT NULL THEN
        v_clean_metadata := jsonb_set(v_clean_metadata, '{conversation_id}', to_jsonb(v_effective_conversation_id));
    ELSE
        v_clean_metadata := v_clean_metadata - 'conversation_id';
    END IF;

    -- Define a versão autorizada e calculada pelo motor
    v_clean_metadata := jsonb_set(v_clean_metadata, '{version}', to_jsonb(v_new_version));

    -- 7. Atualização ou Inserção do Cabeçalho
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

    -- 8. Inserção Atômica dos Itens
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

    -- 9. Retorno estruturado atômico
    v_result := jsonb_build_object(
        'id', v_target_quote_id,
        'company_id', p_company_id,
        'customer_id', v_effective_customer_id,
        'conversation_id', v_effective_conversation_id,
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
