-- ==============================================================================
-- ELLEVEE IA — AC-04.5-P0.3 | ROTEIRO DE PRÉ-FLIGHT E TESTES EM POSTGRESQL REAL
-- ==============================================================================
-- Este script realiza a validação completa da migration da RPC atômica:
-- 1. Consultas de compatibilidade (somente leitura) pré-aplicação da migration.
-- 2. Testes de permissões e controle de privilégios (anon, authenticated, service_role).
-- 3. Setup de fixtures sintéticas rastreadas e isoladas em TEMP TABLE (satisfazendo FKs reais).
-- 4. Testes transacionais ACID (criação, versão, rollback de criação, rollback de atualização).
-- 5. Testes de integridade multi-tenant, validação financeira e preservação de metadados.
-- 6. Guia para concorrência em duas conexões independentes (Advisory Locks).
-- 7. Teardown cirúrgico e auditável (exclusão estrita apenas dos IDs gerados nesta execução).
--
-- AMBIENTE AUTORIZADO:
-- Supabase Staging: dkjrpdhymtkgbknocijy
--
-- AMBIENTE PROIBIDO (NUNCA EXECUTAR):
-- Supabase Produção: ipxhkwirzrigttpwzwbl
-- ==============================================================================


-- ==============================================================================
-- SEÇÃO 1: CONSULTAS DE COMPATIBILIDADE PRÉ-MIGRATION (SOMENTE LEITURA)
-- ==============================================================================
-- Execute estas consultas ANTES de rodar a migration para certificar que o banco
-- de dados de Staging não possui conflitos prévios com o índice único parcial.

-- 1.1 Identifica se existem múltiplos orçamentos ativos para a mesma conversa
SELECT 
    company_id,
    (metadata->>'conversation_id') AS conversation_id,
    COUNT(*) AS total_ativos,
    ARRAY_AGG(id) AS quote_ids,
    ARRAY_AGG(status) AS statuses,
    ARRAY_AGG(created_at ORDER BY created_at DESC) AS criados_em
FROM public.quotes
WHERE status IN ('draft', 'pending_validation', 'ready')
  AND (metadata->>'conversation_id') IS NOT NULL
GROUP BY company_id, (metadata->>'conversation_id')
HAVING COUNT(*) > 1;

-- 1.2 Identifica orçamentos ativos sem conversation_id
SELECT 
    id,
    company_id,
    customer_id,
    status,
    total,
    metadata,
    created_at
FROM public.quotes
WHERE status IN ('draft', 'pending_validation', 'ready')
  AND (metadata->>'conversation_id' IS NULL OR (metadata->>'conversation_id') = '');

-- 1.3 Visão de distribuição geral de status de orçamentos por empresa
SELECT 
    company_id,
    status,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE (metadata->>'conversation_id') IS NOT NULL) AS com_conversation_id,
    COUNT(*) FILTER (WHERE (metadata->>'conversation_id') IS NULL) AS sem_conversation_id
FROM public.quotes
GROUP BY company_id, status
ORDER BY company_id, status;


-- ==============================================================================
-- SEÇÃO 2: VALIDAÇÃO DE PERMISSÕES E PRINCÍPIO DO MENOR PRIVILÉGIO
-- ==============================================================================
-- A RPC save_enterprise_quote_atomic deve ser EXCLUSIVA da role service_role.
-- Chamadas diretas como anon ou authenticated devem falhar com erro 42501 (insufficient_privilege).

-- 2.1 Teste com role 'anon' (DEVE FALHAR com erro 42501)
SET ROLE anon;
DO $$
DECLARE
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := gen_random_uuid(),
            p_items := '[{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'VULNERABILIDADE CRÍTICA: anon conseguiu executar save_enterprise_quote_atomic!';
    END IF;

    RAISE NOTICE 'SUCESSO 2.1: Execução como anon rejeitada com insufficient_privilege (42501).';
END $$;
RESET ROLE;

-- 2.2 Teste com role 'authenticated' (DEVE FALHAR com erro 42501)
SET ROLE authenticated;
DO $$
DECLARE
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := gen_random_uuid(),
            p_items := '[{"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
        );
    EXCEPTION WHEN insufficient_privilege THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'VULNERABILIDADE CRÍTICA: authenticated conseguiu executar save_enterprise_quote_atomic!';
    END IF;

    RAISE NOTICE 'SUCESSO 2.2: Execução como authenticated rejeitada com insufficient_privilege (42501).';
END $$;
RESET ROLE;


-- ==============================================================================
-- SEÇÃO 3: SETUP DE FIXTURES SINTÉTICAS RASTREADAS EM TABELA TEMPORÁRIA
-- ==============================================================================
-- Utiliza TEMP TABLE (escopo de sessão) para rastrear estritamente os IDs criados nesta execução.
-- Evita tabelas de controle persistentes em 'public' e garante que UUIDs gerados sejam únicos.
CREATE TEMP TABLE IF NOT EXISTS test_run_manifest (
    role TEXT PRIMARY KEY,
    id UUID NOT NULL
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE IF NOT EXISTS test_run_quotes (
    id UUID PRIMARY KEY
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
    v_company_id UUID := gen_random_uuid();
    v_customer_id UUID := gen_random_uuid();
    v_conv_id UUID := gen_random_uuid();
    v_conv_id_2 UUID := gen_random_uuid();
    v_conv_conc_id UUID := gen_random_uuid();
    v_prod_a_id UUID := gen_random_uuid();
    v_prod_b_id UUID := gen_random_uuid();
    v_inv_comp_id UUID := gen_random_uuid();
    v_inv_cust_id UUID := gen_random_uuid();
    v_inv_conv_id UUID := gen_random_uuid();
    v_run_suffix TEXT := substr(md5(random()::text), 1, 8);
BEGIN
    -- Limpa registros de manifest anteriores na sessão (se houver)
    TRUNCATE TABLE test_run_manifest;
    TRUNCATE TABLE test_run_quotes;

    -- 1. Tenant Principal A
    INSERT INTO public.companies (id, name, slug)
    VALUES (v_company_id, 'Empresa Teste AC-04.5 ' || v_run_suffix, 'empresa-teste-ac045-' || v_run_suffix);
    INSERT INTO test_run_manifest (role, id) VALUES ('company_a', v_company_id);

    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES (v_customer_id, v_company_id, 'Cliente Teste ' || v_run_suffix, '+5511999990001', 'teste-' || v_run_suffix || '@ellevee.ia');
    INSERT INTO test_run_manifest (role, id) VALUES ('customer_a', v_customer_id);

    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES 
        (v_conv_id, v_company_id, v_customer_id, 'whatsapp', 'open'),
        (v_conv_id_2, v_company_id, v_customer_id, 'whatsapp', 'open'),
        (v_conv_conc_id, v_company_id, v_customer_id, 'test_concorrencia', 'open');
    INSERT INTO test_run_manifest (role, id) VALUES ('conv_a', v_conv_id);
    INSERT INTO test_run_manifest (role, id) VALUES ('conv_a_2', v_conv_id_2);
    INSERT INTO test_run_manifest (role, id) VALUES ('conv_concorrencia', v_conv_conc_id);

    INSERT INTO public.products (id, company_id, name, normalized_name, active)
    VALUES 
        (v_prod_a_id, v_company_id, 'Produto Sintético A ' || v_run_suffix, 'produto sintetico a ' || v_run_suffix, true),
        (v_prod_b_id, v_company_id, 'Produto Sintético B ' || v_run_suffix, 'produto sintetico b ' || v_run_suffix, true);
    INSERT INTO test_run_manifest (role, id) VALUES ('prod_a', v_prod_a_id);
    INSERT INTO test_run_manifest (role, id) VALUES ('prod_b', v_prod_b_id);

    -- 2. Tenant Invasor B (para testes cross-tenant)
    INSERT INTO public.companies (id, name, slug)
    VALUES (v_inv_comp_id, 'Empresa Invasora B ' || v_run_suffix, 'empresa-invasora-b-' || v_run_suffix);
    INSERT INTO test_run_manifest (role, id) VALUES ('company_b', v_inv_comp_id);

    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES (v_inv_cust_id, v_inv_comp_id, 'Cliente Invasor B ' || v_run_suffix, '+5511888880002', 'invasor-b-' || v_run_suffix || '@ellevee.ia');
    INSERT INTO test_run_manifest (role, id) VALUES ('customer_b', v_inv_cust_id);

    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES (v_inv_conv_id, v_inv_comp_id, v_inv_cust_id, 'whatsapp', 'open');
    INSERT INTO test_run_manifest (role, id) VALUES ('conv_b', v_inv_conv_id);

    RAISE NOTICE 'SUCESSO SEÇÃO 3: Fixtures sintéticas criadas com integridade de FKs (sufixo=%)', v_run_suffix;
END $$;


-- ==============================================================================
-- SEÇÃO 4: TESTES TRANSACIONAIS ACID, INVARIANTES E CONCORRÊNCIA (service_role)
-- ==============================================================================
SET ROLE service_role;

-- 4.1 Criação de Orçamento Inicial (Versão 1)
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv TEXT;
    v_prod UUID;
    v_res JSONB;
    v_quote_id UUID;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv FROM test_run_manifest WHERE role = 'conv_a';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    v_res := public.save_enterprise_quote_atomic(
        p_company_id := v_comp,
        p_customer_id := v_cust,
        p_conversation_id := v_conv,
        p_status := 'draft',
        p_total := 70.00,
        p_metadata := '{"canal": "whatsapp_staging", "observacao_comercial": "pedido inicial"}'::jsonb,
        p_items := jsonb_build_array(
            jsonb_build_object('product_id', v_prod, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
        )
    );

    v_quote_id := (v_res->>'id')::uuid;
    IF v_quote_id IS NULL OR (v_res->>'version')::int <> 1 THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.1: Falha ao criar orçamento inicial via RPC: %', v_res;
    END IF;

    -- Rastreia o orçamento criado para limpeza cirúrgica
    INSERT INTO test_run_quotes (id) VALUES (v_quote_id);

    RAISE NOTICE 'SUCESSO 4.1: Orçamento criado com ID % na versão %', v_quote_id, v_res->>'version';
END $$;

-- 4.2 Atualização com Incremento de Versão e Preservação de Metadados (Versão 2)
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv TEXT;
    v_prod UUID;
    v_existing_id UUID;
    v_res JSONB;
    v_saved_metadata JSONB;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv FROM test_run_manifest WHERE role = 'conv_a';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = v_comp 
      AND metadata @> jsonb_build_object('conversation_id', v_conv)
    LIMIT 1;

    v_res := public.save_enterprise_quote_atomic(
        p_company_id := v_comp,
        p_customer_id := v_cust,
        p_conversation_id := v_conv,
        p_existing_quote_id := v_existing_id,
        p_expected_version := 1,
        p_status := 'ready',
        p_total := 105.00,
        p_metadata := '{"desconto_concedido": "5%"}'::jsonb, -- Metadado parcial
        p_items := jsonb_build_array(
            jsonb_build_object('product_id', v_prod, 'quantity', 3, 'unit_price', 35.00, 'subtotal', 105.00)
        )
    );

    IF (v_res->>'version')::int <> 2 THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.2: Falha ao versionar orçamento para versão 2: %', v_res;
    END IF;

    -- Comprova preservação de metadados anteriores (observacao_comercial não foi apagada)
    SELECT metadata INTO v_saved_metadata FROM public.quotes WHERE id = v_existing_id;
    IF v_saved_metadata->>'observacao_comercial' <> 'pedido inicial' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.2: Metadado anterior "observacao_comercial" foi perdido na atualização!';
    END IF;

    IF v_saved_metadata->>'desconto_concedido' <> '5%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.2: Novo metadado "desconto_concedido" não foi gravado!';
    END IF;

    RAISE NOTICE 'SUCESSO 4.2: Orçamento atualizado para versão % com preservação de metadados anteriores.', v_res->>'version';
END $$;

-- 4.3 Rollback Total em Falha de Criação (Zero Lixo Residual)
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv TEXT;
    v_prod UUID;
    v_invalid_prod UUID := gen_random_uuid();
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
    v_c_quotes INT;
    v_c_items INT;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv FROM test_run_manifest WHERE role = 'conv_a_2';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    -- Tentativa de criação com produto inexistente
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust,
            p_conversation_id := v_conv,
            p_status := 'draft',
            p_total := 50.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 35.0, 'subtotal', 35.0),
                jsonb_build_object('product_id', v_invalid_prod, 'quantity', 1, 'unit_price', 15.0, 'subtotal', 15.0)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.3: Criação com produto inexistente deveria ter gerado erro!';
    END IF;

    IF v_err_msg NOT LIKE '%PRODUTO_NOT_FOUND%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.3: Erro capturado inesperado: %', v_err_msg;
    END IF;

    -- Comprova ausência total de registros residuais
    SELECT COUNT(*) INTO v_c_quotes FROM public.quotes WHERE metadata @> jsonb_build_object('conversation_id', v_conv);
    SELECT COUNT(*) INTO v_c_items FROM public.quote_items WHERE quote_id IN (
        SELECT id FROM public.quotes WHERE metadata @> jsonb_build_object('conversation_id', v_conv)
    );

    IF v_c_quotes > 0 OR v_c_items > 0 THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE 4.3: Registros residuais encontrados após rollback de criação! (quotes=%, items=%)', v_c_quotes, v_c_items;
    END IF;

    RAISE NOTICE 'SUCESSO 4.3: Rollback em falha de criação comprovado (erro=%, quotes=0, items=0)', v_err_msg;
END $$;

-- 4.4 Rollback em Falha de Atualização: Preservação Integral dos Itens Anteriores
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv TEXT;
    v_prod UUID;
    v_invalid_prod UUID := gen_random_uuid();
    v_existing_id UUID;
    v_ver_before INT;
    v_ver_after INT;
    v_total_before NUMERIC;
    v_total_after NUMERIC;
    v_item_ids_before UUID[];
    v_item_ids_after UUID[];
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv FROM test_run_manifest WHERE role = 'conv_a';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    SELECT id, (metadata->>'version')::int, total
    INTO v_existing_id, v_ver_before, v_total_before
    FROM public.quotes 
    WHERE company_id = v_comp 
      AND metadata @> jsonb_build_object('conversation_id', v_conv)
    LIMIT 1;

    SELECT ARRAY_AGG(id ORDER BY id) INTO v_item_ids_before 
    FROM public.quote_items WHERE quote_id = v_existing_id;

    -- Tentativa de atualização fadada ao erro (produto inexistente)
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust,
            p_conversation_id := v_conv,
            p_existing_quote_id := v_existing_id,
            p_expected_version := v_ver_before,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 10, 'unit_price', 35.0, 'subtotal', 350.0),
                jsonb_build_object('product_id', v_invalid_prod, 'quantity', 1, 'unit_price', 10.0, 'subtotal', 10.0)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.4: Atualização inválida deveria ter gerado exceção!';
    END IF;

    IF v_err_msg NOT LIKE '%PRODUTO_NOT_FOUND%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.4: Erro inesperado capturado: %', v_err_msg;
    END IF;

    -- Comprova que o rollback restaurou integralmente a versão, total e itens originais
    SELECT (metadata->>'version')::int, total INTO v_ver_after, v_total_after FROM public.quotes WHERE id = v_existing_id;
    SELECT ARRAY_AGG(id ORDER BY id) INTO v_item_ids_after FROM public.quote_items WHERE quote_id = v_existing_id;

    IF v_ver_after <> v_ver_before THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE 4.4: Versão modificada após rollback de atualização! (antes=%, depois=%)', v_ver_before, v_ver_after;
    END IF;

    IF v_total_after <> v_total_before THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE 4.4: Total modificado após rollback de atualização! (antes=%, depois=%)', v_total_before, v_total_after;
    END IF;

    IF v_item_ids_after <> v_item_ids_before THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE 4.4: IDs dos itens corrompidos após rollback de atualização!';
    END IF;

    RAISE NOTICE 'SUCESSO 4.4: Preservação de itens e versão em rollback de atualização confirmada (versão=%, total=%, itens=% mantidos)',
        v_ver_after, v_total_after, array_length(v_item_ids_after, 1);
END $$;

-- 4.5 Concorrência Otimista: Rejeição de Versão Defasada
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv TEXT;
    v_prod UUID;
    v_existing_id UUID;
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv FROM test_run_manifest WHERE role = 'conv_a';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = v_comp 
      AND metadata @> jsonb_build_object('conversation_id', v_conv)
    LIMIT 1;

    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust,
            p_conversation_id := v_conv,
            p_existing_quote_id := v_existing_id,
            p_expected_version := 1, -- Versão obsoleta proposital (banco está na 2)!
            p_total := 35.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.5: Concorrência otimista permitiu sobrescrita de versão defasada!';
    END IF;

    IF v_err_msg NOT LIKE '%ORCAMENTO_CONCURRENCY_CONFLICT%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.5: Erro inesperado capturado: %', v_err_msg;
    END IF;

    RAISE NOTICE 'SUCESSO 4.5: Conflito de versão bloqueado como esperado: %', v_err_msg;
END $$;

-- 4.6 Isolamento entre Conversas (Bloqueio de Sequestro)
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv_a TEXT;
    v_conv_a_2 TEXT;
    v_prod UUID;
    v_existing_id UUID;
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv_a FROM test_run_manifest WHERE role = 'conv_a';
    SELECT id::text INTO v_conv_a_2 FROM test_run_manifest WHERE role = 'conv_a_2';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = v_comp 
      AND metadata @> jsonb_build_object('conversation_id', v_conv_a)
    LIMIT 1;

    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust,
            p_conversation_id := v_conv_a_2, -- Conversa divergente!
            p_existing_quote_id := v_existing_id,
            p_expected_version := 2,
            p_total := 35.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.6: Isolamento entre conversas permitiu alteração indevida!';
    END IF;

    IF v_err_msg NOT LIKE '%ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.6: Erro inesperado: %', v_err_msg;
    END IF;

    RAISE NOTICE 'SUCESSO 4.6: Acesso cruzado entre conversas bloqueado: %', v_err_msg;
END $$;

-- 4.7 Isolamento entre Clientes no Caminho de Conversa
DO $$
DECLARE
    v_comp UUID;
    v_cust_b UUID;
    v_conv_a TEXT;
    v_prod UUID;
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust_b FROM test_run_manifest WHERE role = 'customer_b';
    SELECT id::text INTO v_conv_a FROM test_run_manifest WHERE role = 'conv_a';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust_b, -- Cliente da Empresa B!
            p_conversation_id := v_conv_a,
            p_total := 35.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.7: Permitiu cliente divergente da conversa e da empresa!';
    END IF;

    IF v_err_msg NOT LIKE '%ORCAMENTO_CROSS_COMPANY_FORBIDDEN%' AND v_err_msg NOT LIKE '%ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.7: Erro inesperado: %', v_err_msg;
    END IF;

    RAISE NOTICE 'SUCESSO 4.7: Inconsistência de cliente/empresa bloqueada: %', v_err_msg;
END $$;

-- 4.8 Validação Financeira Estrita: Subtotal Inconsistente e Total Divergente
DO $$
DECLARE
    v_comp UUID;
    v_cust UUID;
    v_conv TEXT;
    v_prod UUID;
    v_failed_subtotal BOOLEAN := false;
    v_failed_total BOOLEAN := false;
    v_err_msg TEXT;
BEGIN
    SELECT id INTO v_comp FROM test_run_manifest WHERE role = 'company_a';
    SELECT id INTO v_cust FROM test_run_manifest WHERE role = 'customer_a';
    SELECT id::text INTO v_conv FROM test_run_manifest WHERE role = 'conv_a_2';
    SELECT id INTO v_prod FROM test_run_manifest WHERE role = 'prod_a';

    -- Teste A: Subtotal inconsistente (quantidade 2 x preco 35 = 70, mas envia 80)
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust,
            p_conversation_id := v_conv,
            p_status := 'draft',
            p_total := 80.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 80.00) -- Divergente!
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed_subtotal := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed_subtotal OR v_err_msg NOT LIKE '%FINANCEIRO_SUBTOTAL_INCONSISTENTE%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.8A: Subtotal inconsistente não foi rejeitado! (err=%)', v_err_msg;
    END IF;

    -- Teste B: Total divergente da soma dos itens (soma = 70, mas envia total = 100)
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_comp,
            p_customer_id := v_cust,
            p_conversation_id := v_conv,
            p_status := 'draft',
            p_total := 100.00, -- Divergente da soma (70)!
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed_total := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed_total OR v_err_msg NOT LIKE '%FINANCEIRO_TOTAL_INCONSISTENTE%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.8B: Total divergente da soma não foi rejeitado! (err=%)', v_err_msg;
    END IF;

    RAISE NOTICE 'SUCESSO 4.8: Validações financeiras de subtotal e total aprovadas com rigor.';
END $$;

RESET ROLE;


-- ==============================================================================
-- SEÇÃO 5: GUIA PARA CONCORRÊNCIA EM DUAS CONEXÕES INDEPENDENTES
-- ==============================================================================
-- Instruções operacionais para testar concorrência real via pg_advisory_xact_lock:
-- Abra duas abas independentes do Supabase SQL Editor ou dois terminais psql.
-- Este teste localiza autonomamente a conversa sintética criada para concorrência
-- ('test_concorrencia'), sem depender de persistência de sessão entre abas.

-- --- ABA 1 (Conexão 1):
-- SET ROLE service_role;
-- BEGIN;
-- DO $$
-- DECLARE
--     v_comp UUID;
--     v_cust UUID;
--     v_conv TEXT;
--     v_prod UUID;
-- BEGIN
--     SELECT c.id, cust.id, conv.id::text, p.id
--     INTO v_comp, v_cust, v_conv, v_prod
--     FROM public.conversations conv
--     JOIN public.companies c ON c.id = conv.company_id
--     JOIN public.customers cust ON cust.id = conv.customer_id
--     JOIN public.products p ON p.company_id = c.id
--     WHERE conv.channel = 'test_concorrencia'
--     LIMIT 1;
-- 
--     PERFORM public.save_enterprise_quote_atomic(
--         p_company_id := v_comp,
--         p_customer_id := v_cust,
--         p_conversation_id := v_conv,
--         p_status := 'draft',
--         p_total := 35.00,
--         p_items := jsonb_build_array(
--             jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
--         )
--     );
-- END $$;
-- -- (MANTENHA A TRANSAÇÃO ABERTA! Não execute COMMIT ainda.)

-- --- ABA 2 (Conexão 2 - Executar enquanto Aba 1 está aberta):
-- SET ROLE service_role;
-- BEGIN;
-- DO $$
-- DECLARE
--     v_comp UUID;
--     v_cust UUID;
--     v_conv TEXT;
--     v_prod UUID;
-- BEGIN
--     SELECT c.id, cust.id, conv.id::text, p.id
--     INTO v_comp, v_cust, v_conv, v_prod
--     FROM public.conversations conv
--     JOIN public.companies c ON c.id = conv.company_id
--     JOIN public.customers cust ON cust.id = conv.customer_id
--     JOIN public.products p ON p.company_id = c.id
--     WHERE conv.channel = 'test_concorrencia'
--     LIMIT 1;
-- 
--     PERFORM public.save_enterprise_quote_atomic(
--         p_company_id := v_comp,
--         p_customer_id := v_cust,
--         p_conversation_id := v_conv,
--         p_status := 'draft',
--         p_total := 70.00,
--         p_items := jsonb_build_array(
--             jsonb_build_object('product_id', v_prod, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
--         )
--     );
-- END $$;
-- -- (Observe que a Aba 2 fica retida esperando o lock da Aba 1.)

-- --- ABA 1:
-- COMMIT;

-- --- ABA 2:
-- -- Ao comitar a Aba 1, a Aba 2 é imediatamente liberada e falha fail-closed com:
-- -- ERROR: ORCAMENTO_ACTIVE_EXISTS: Já existe um orçamento ativo (...) para a conversa ...
-- ROLLBACK;


-- ==============================================================================
-- SEÇÃO 6: TEARDOWN CONTROLADO E CIRÚRGICO DAS FIXTURES SINTÉTICAS
-- ==============================================================================
-- Exclui exclusivamente os registros que pertencem estritamente aos IDs gerados
-- e rastreados em test_run_manifest nesta sessão.
-- NUNCA executa exclusão em massa por company_id genérico nem afeta dados preexistentes.

-- 1. Exclui quote_items vinculados exclusivamente aos quotes rastreados:
DELETE FROM public.quote_items 
WHERE quote_id IN (SELECT id FROM test_run_quotes)
   OR quote_id IN (
       SELECT id FROM public.quotes 
       WHERE company_id IN (SELECT id FROM test_run_manifest WHERE role LIKE 'company%')
   );

-- 2. Exclui quotes rastreados criados pelo teste:
DELETE FROM public.quotes 
WHERE id IN (SELECT id FROM test_run_quotes)
   OR company_id IN (SELECT id FROM test_run_manifest WHERE role LIKE 'company%');

-- 3. Exclui exclusivamente as fixtures sintéticas criadas:
DELETE FROM public.conversations 
WHERE id IN (SELECT id FROM test_run_manifest WHERE role LIKE 'conv%');

DELETE FROM public.products 
WHERE id IN (SELECT id FROM test_run_manifest WHERE role LIKE 'prod%');

DELETE FROM public.customers 
WHERE id IN (SELECT id FROM test_run_manifest WHERE role LIKE 'customer%');

DELETE FROM public.companies 
WHERE id IN (SELECT id FROM test_run_manifest WHERE role LIKE 'company%');

-- 4. Dropar tabelas temporárias
DROP TABLE IF EXISTS test_run_quotes;
DROP TABLE IF EXISTS test_run_manifest;

RAISE NOTICE 'SUCESSO SEÇÃO 6: Teardown cirúrgico concluído sem registros residuais.';
