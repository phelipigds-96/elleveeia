-- ==============================================================================
-- ELLEVEE IA — AC-04.5-P0.3 / P0.4 | ROTEIRO DE HOMOLOGAÇÃO POSTGRESQL REAL
-- ==============================================================================
-- Este roteiro e o runner automatizado realizam a validação completa da migration:
-- 1. Consultas de compatibilidade (somente leitura) pré-aplicação da migration.
-- 2. Testes de permissões e princípio do menor privilégio (anon, authenticated, service_role).
-- 3. Setup de fixtures sintéticas rastreadas e isoladas com integridade referencial.
-- 4. Testes transacionais ACID (criação, versionamento, rollback de criação e rollback de atualização).
-- 5. Testes de integridade multi-tenant, invariantes financeiros e preservação de metadados.
-- 6. Teste de concorrência atômica com duas conexões independentes (Advisory Locks).
-- 7. Teardown cirúrgico e garantido (exclusão estrita apenas dos registros criados).
--
-- ==============================================================================
-- PROCEDIMENTO OPERACIONAL RECOMENDADO:
-- ==============================================================================
-- Devido à natureza do Supabase SQL Editor (que utiliza pooler de conexões PgBouncer
-- em modo de transação, sem afinidade de sessão entre abas ou comandos sequenciais),
-- a forma oficial, reproduzível e segura de executar esta homologação é via:
--
--   node scripts/run-real-postgres-atomic-test.mjs
--
-- O runner local:
-- 1. Abre duas conexões TCP persistentes com o PostgreSQL (pg.Client nativo).
-- 2. Torna as fixtures criadas pela Conexão 1 imediatamente visíveis à Conexão 2.
-- 3. Mantém o manifesto de UUIDs em memória no Node.js e gravado em disco (.staging-workspace).
-- 4. Executa o teardown cirúrgico no bloco FINALLY incondicional, mesmo se houver falha.
-- 5. Não depende de tabelas temporárias entre sessões nem de afinidade do SQL Editor.
--
-- Caso deseje executar manualmente via SQL Editor ou psql, utilize os blocos abaixo.
--
-- AMBIENTE AUTORIZADO:
-- Supabase Staging: dkjrpdhymtkgbknocijy (db.dkjrpdhymtkgbknocijy.supabase.co)
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
-- SEÇÃO 3 E 4: EXECUÇÃO CONTÍGUA DE FIXTURES E TESTES ACID (service_role)
-- ==============================================================================
-- Para execução no SQL Editor ou psql em uma única sessão persistente.
-- Utiliza sufixo rastreável exclusivo (v_run_suffix) para identificar todas as entidades
-- criadas, permitindo tanto o rastreamento em TEMP TABLE na sessão atual quanto o teardown
-- cirúrgico infalível mesmo se a conexão cair ou for reaberta.

SET ROLE service_role;

DO $$
DECLARE
    v_run_suffix TEXT := substr(md5(random()::text), 1, 8);
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

    -- Variáveis para testes ACID
    v_res JSONB;
    v_quote_id UUID;
    v_saved_metadata JSONB;
    v_invalid_prod UUID := gen_random_uuid();
    v_failed BOOLEAN := false;
    v_err_msg TEXT;
    v_c_quotes INT;
    v_c_items INT;
    v_ver_before INT;
    v_ver_after INT;
    v_total_before NUMERIC;
    v_total_after NUMERIC;
    v_item_ids_before UUID[];
    v_item_ids_after UUID[];
    v_failed_subtotal BOOLEAN := false;
    v_failed_total BOOLEAN := false;
BEGIN
    RAISE NOTICE '====================================================================';
    RAISE NOTICE 'INICIANDO SETUP E TESTES ACID COM SUFIXO: %', v_run_suffix;
    RAISE NOTICE '====================================================================';

    -- 1. Setup de Fixtures Sintéticas com Rastreamento por Sufixo
    INSERT INTO public.companies (id, name, slug)
    VALUES (v_company_id, 'Empresa Teste AC-04.5 ' || v_run_suffix, 'empresa-teste-ac045-' || v_run_suffix);

    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES (v_customer_id, v_company_id, 'Cliente Teste ' || v_run_suffix, '+5511999990001', 'teste-' || v_run_suffix || '@ellevee.ia');

    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES 
        (v_conv_id, v_company_id, v_customer_id, 'whatsapp', 'open'),
        (v_conv_id_2, v_company_id, v_customer_id, 'whatsapp', 'open'),
        (v_conv_conc_id, v_company_id, v_customer_id, 'test_concorrencia_' || v_run_suffix, 'open');

    INSERT INTO public.products (id, company_id, name, normalized_name, active)
    VALUES 
        (v_prod_a_id, v_company_id, 'Produto Sintético A ' || v_run_suffix, 'produto sintetico a ' || v_run_suffix, true),
        (v_prod_b_id, v_company_id, 'Produto Sintético B ' || v_run_suffix, 'produto sintetico b ' || v_run_suffix, true);

    -- Tenant Invasor B
    INSERT INTO public.companies (id, name, slug)
    VALUES (v_inv_comp_id, 'Empresa Invasora B ' || v_run_suffix, 'empresa-invasora-b-' || v_run_suffix);

    INSERT INTO public.customers (id, company_id, name, phone, email)
    VALUES (v_inv_cust_id, v_inv_comp_id, 'Cliente Invasor B ' || v_run_suffix, '+5511888880002', 'invasor-b-' || v_run_suffix || '@ellevee.ia');

    INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
    VALUES (v_inv_conv_id, v_inv_comp_id, v_inv_cust_id, 'whatsapp', 'open');

    RAISE NOTICE '✓ Fixtures sintéticas inseridas com integridade referencial.';

    -- -------------------------------------------------------------------------
    -- 4.1 Criação de Orçamento Inicial (Versão 1)
    -- -------------------------------------------------------------------------
    v_res := public.save_enterprise_quote_atomic(
        p_company_id := v_company_id,
        p_customer_id := v_customer_id,
        p_conversation_id := v_conv_id::text,
        p_status := 'draft',
        p_total := 70.00,
        p_metadata := '{"canal": "whatsapp_staging", "observacao_comercial": "pedido inicial"}'::jsonb,
        p_items := jsonb_build_array(
            jsonb_build_object('product_id', v_prod_a_id, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
        )
    );
    v_quote_id := (v_res->>'id')::uuid;

    IF v_quote_id IS NULL OR (v_res->>'version')::int <> 1 THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.1: Falha ao criar orçamento inicial via RPC: %', v_res;
    END IF;
    RAISE NOTICE '✓ 4.1 Criação inicial aprovada (ID: %, versão: %)', v_quote_id, v_res->>'version';

    -- -------------------------------------------------------------------------
    -- 4.2 Atualização com Incremento de Versão e Preservação de Metadados (Versão 2)
    -- -------------------------------------------------------------------------
    v_res := public.save_enterprise_quote_atomic(
        p_company_id := v_company_id,
        p_customer_id := v_customer_id,
        p_conversation_id := v_conv_id::text,
        p_existing_quote_id := v_quote_id,
        p_expected_version := 1,
        p_status := 'ready',
        p_total := 105.00,
        p_metadata := '{"desconto_concedido": "5%"}'::jsonb,
        p_items := jsonb_build_array(
            jsonb_build_object('product_id', v_prod_a_id, 'quantity', 3, 'unit_price', 35.00, 'subtotal', 105.00)
        )
    );

    IF (v_res->>'version')::int <> 2 THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.2: Falha ao versionar orçamento para versão 2: %', v_res;
    END IF;

    SELECT metadata INTO v_saved_metadata FROM public.quotes WHERE id = v_quote_id;
    IF v_saved_metadata->>'observacao_comercial' <> 'pedido inicial' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.2: Metadado anterior "observacao_comercial" foi perdido na atualização!';
    END IF;
    IF v_saved_metadata->>'desconto_concedido' <> '5%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.2: Novo metadado "desconto_concedido" não foi gravado!';
    END IF;
    RAISE NOTICE '✓ 4.2 Atualização de versão e mesclagem de metadados confirmadas.';

    -- -------------------------------------------------------------------------
    -- 4.3 Rollback Total em Falha de Criação (Zero Lixo Residual)
    -- -------------------------------------------------------------------------
    v_failed := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_customer_id,
            p_conversation_id := v_conv_id_2::text,
            p_status := 'draft',
            p_total := 50.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 1, 'unit_price', 35.0, 'subtotal', 35.0),
                jsonb_build_object('product_id', v_invalid_prod, 'quantity', 1, 'unit_price', 15.0, 'subtotal', 15.0)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed OR v_err_msg NOT LIKE '%PRODUTO_NOT_FOUND%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.3: Criação inválida não falhou como esperado: %', v_err_msg;
    END IF;

    SELECT COUNT(*) INTO v_c_quotes FROM public.quotes WHERE metadata @> jsonb_build_object('conversation_id', v_conv_id_2::text);
    IF v_c_quotes > 0 THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE 4.3: Orçamento residual gravado após falha!';
    END IF;
    RAISE NOTICE '✓ 4.3 Rollback total em falha de criação comprovado (0 resíduos).';

    -- -------------------------------------------------------------------------
    -- 4.4 Rollback em Falha de Atualização: Preservação Integral dos Itens Anteriores
    -- -------------------------------------------------------------------------
    SELECT (metadata->>'version')::int, total INTO v_ver_before, v_total_before FROM public.quotes WHERE id = v_quote_id;
    SELECT ARRAY_AGG(id ORDER BY id) INTO v_item_ids_before FROM public.quote_items WHERE quote_id = v_quote_id;

    v_failed := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_customer_id,
            p_conversation_id := v_conv_id::text,
            p_existing_quote_id := v_quote_id,
            p_expected_version := v_ver_before,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 10, 'unit_price', 35.0, 'subtotal', 350.0),
                jsonb_build_object('product_id', v_invalid_prod, 'quantity', 1, 'unit_price', 10.0, 'subtotal', 10.0)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed OR v_err_msg NOT LIKE '%PRODUTO_NOT_FOUND%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.4: Atualização inválida não falhou como esperado!';
    END IF;

    SELECT (metadata->>'version')::int, total INTO v_ver_after, v_total_after FROM public.quotes WHERE id = v_quote_id;
    SELECT ARRAY_AGG(id ORDER BY id) INTO v_item_ids_after FROM public.quote_items WHERE quote_id = v_quote_id;

    IF v_ver_after <> v_ver_before OR v_total_after <> v_total_before OR v_item_ids_after <> v_item_ids_before THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE 4.4: Estado do orçamento alterado após rollback de update!';
    END IF;
    RAISE NOTICE '✓ 4.4 Preservação integral em rollback de atualização confirmada.';

    -- -------------------------------------------------------------------------
    -- 4.5 Concorrência Otimista: Rejeição de Versão Defasada
    -- -------------------------------------------------------------------------
    v_failed := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_customer_id,
            p_conversation_id := v_conv_id::text,
            p_existing_quote_id := v_quote_id,
            p_expected_version := 1, -- Versão 1 está defasada (banco está na 2)
            p_total := 35.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed OR v_err_msg NOT LIKE '%ORCAMENTO_CONCURRENCY_CONFLICT%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.5: Versão defasada permitida sem conflito: %', v_err_msg;
    END IF;
    RAISE NOTICE '✓ 4.5 Concorrência otimista comprovada: rejeição de versão obsoleta.';

    -- -------------------------------------------------------------------------
    -- 4.6 Isolamento entre Conversas (Bloqueio de Sequestro)
    -- -------------------------------------------------------------------------
    v_failed := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_customer_id,
            p_conversation_id := v_conv_id_2::text, -- Conversa divergente!
            p_existing_quote_id := v_quote_id,
            p_expected_version := 2,
            p_total := 35.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed OR v_err_msg NOT LIKE '%ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.6: Sequestro entre conversas permitido: %', v_err_msg;
    END IF;
    RAISE NOTICE '✓ 4.6 Isolamento entre conversas comprovado.';

    -- -------------------------------------------------------------------------
    -- 4.7 Isolamento entre Clientes no Caminho de Conversa
    -- -------------------------------------------------------------------------
    v_failed := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_inv_cust_id, -- Cliente da Empresa B!
            p_conversation_id := v_conv_id::text,
            p_total := 35.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 1, 'unit_price', 35.00, 'subtotal', 35.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed OR (v_err_msg NOT LIKE '%ORCAMENTO_CROSS_COMPANY_FORBIDDEN%' AND v_err_msg NOT LIKE '%ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN%') THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.7: Cliente inconsistente com empresa/conversa permitido: %', v_err_msg;
    END IF;
    RAISE NOTICE '✓ 4.7 Isolamento multi-tenant de cliente comprovado.';

    -- -------------------------------------------------------------------------
    -- 4.8 Validação Financeira Estrita: Subtotal Inconsistente e Total Divergente
    -- -------------------------------------------------------------------------
    v_failed_subtotal := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_customer_id,
            p_conversation_id := v_conv_id_2::text,
            p_status := 'draft',
            p_total := 80.00,
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 80.00) -- Divergente de 70.00!
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed_subtotal := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed_subtotal OR v_err_msg NOT LIKE '%FINANCEIRO_SUBTOTAL_INCONSISTENTE%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.8A: Subtotal inconsistente não rejeitado: %', v_err_msg;
    END IF;

    v_failed_total := false;
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := v_company_id,
            p_customer_id := v_customer_id,
            p_conversation_id := v_conv_id_2::text,
            p_status := 'draft',
            p_total := 100.00, -- Divergente de 70.00!
            p_items := jsonb_build_array(
                jsonb_build_object('product_id', v_prod_a_id, 'quantity', 2, 'unit_price', 35.00, 'subtotal', 70.00)
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_failed_total := true;
        v_err_msg := SQLERRM;
    END;

    IF NOT v_failed_total OR v_err_msg NOT LIKE '%FINANCEIRO_TOTAL_INCONSISTENTE%' THEN
        RAISE EXCEPTION 'TESTE FALHOU 4.8B: Total divergente da soma não rejeitado: %', v_err_msg;
    END IF;
    RAISE NOTICE '✓ 4.8 Invariantes financeiros validados (subtotal e total validados com rigor).';

    -- -------------------------------------------------------------------------
    -- TEARDOWN CIRÚRGICO IMEDIATO (Mesma Sessão)
    -- -------------------------------------------------------------------------
    DELETE FROM public.quote_items WHERE quote_id IN (SELECT id FROM public.quotes WHERE company_id IN (v_company_id, v_inv_comp_id));
    DELETE FROM public.quotes WHERE company_id IN (v_company_id, v_inv_comp_id);
    DELETE FROM public.conversations WHERE company_id IN (v_company_id, v_inv_comp_id);
    DELETE FROM public.products WHERE company_id IN (v_company_id, v_inv_comp_id);
    DELETE FROM public.customers WHERE company_id IN (v_company_id, v_inv_comp_id);
    DELETE FROM public.companies WHERE id IN (v_company_id, v_inv_comp_id);

    RAISE NOTICE '====================================================================';
    RAISE NOTICE 'SUCESSO TOTAL: TODOS OS TESTES ACID PASSARAM E FIXTURES FORAM LIMPAS';
    RAISE NOTICE '====================================================================';
END $$;

RESET ROLE;


-- ==============================================================================
-- SEÇÃO 5: GUIA PARA CONCORRÊNCIA EM DUAS CONEXÕES INDEPENDENTES
-- ==============================================================================
-- Para validar concorrência real entre duas conexões sem qualquer dependência
-- de afinidade de sessão ou tabelas temporárias:
--
-- MÉTODO 1 (RECOMENDADO):
--   node scripts/run-real-postgres-atomic-test.mjs
--
-- MÉTODO 2 (MANUAL VIA DOIS TERMINAIS PSQL OU DUAS ABAS):
-- 1. Crie uma conversa dedicada com channel específico (ex: 'test_concorrencia_manual').
-- 2. Na Conexão 1 (Aba 1):
--      BEGIN;
--      SELECT public.save_enterprise_quote_atomic(...); -- Retém lock
-- 3. Na Conexão 2 (Aba 2):
--      BEGIN;
--      SELECT public.save_enterprise_quote_atomic(...); -- Aguarda lock
-- 4. Na Conexão 1:
--      COMMIT;
-- 5. Na Conexão 2:
--      Recebe erro: ORCAMENTO_ACTIVE_EXISTS
--      ROLLBACK;


-- ==============================================================================
-- SEÇÃO 6: TEARDOWN DE CONTINGÊNCIA POR RUN SUFFIX (SE NECESSÁRIO)
-- ==============================================================================
-- Se uma execução manual for interrompida e deixar fixtures sintéticas, execute
-- este bloco substituindo o sufixo 'SUFIXO_AQUI' pelo sufixo exibido nos logs:
/*
DO $$
DECLARE
    v_clean_suffix TEXT := 'SUFIXO_AQUI';
BEGIN
    DELETE FROM public.quote_items 
    WHERE company_id IN (SELECT id FROM public.companies WHERE slug LIKE 'empresa-teste-ac045-' || v_clean_suffix || '%' OR slug LIKE 'empresa-invasora-b-' || v_clean_suffix || '%');

    DELETE FROM public.quotes 
    WHERE company_id IN (SELECT id FROM public.companies WHERE slug LIKE 'empresa-teste-ac045-' || v_clean_suffix || '%' OR slug LIKE 'empresa-invasora-b-' || v_clean_suffix || '%');

    DELETE FROM public.conversations 
    WHERE company_id IN (SELECT id FROM public.companies WHERE slug LIKE 'empresa-teste-ac045-' || v_clean_suffix || '%' OR slug LIKE 'empresa-invasora-b-' || v_clean_suffix || '%');

    DELETE FROM public.products 
    WHERE company_id IN (SELECT id FROM public.companies WHERE slug LIKE 'empresa-teste-ac045-' || v_clean_suffix || '%' OR slug LIKE 'empresa-invasora-b-' || v_clean_suffix || '%');

    DELETE FROM public.customers 
    WHERE company_id IN (SELECT id FROM public.companies WHERE slug LIKE 'empresa-teste-ac045-' || v_clean_suffix || '%' OR slug LIKE 'empresa-invasora-b-' || v_clean_suffix || '%');

    DELETE FROM public.companies 
    WHERE slug LIKE 'empresa-teste-ac045-' || v_clean_suffix || '%' 
       OR slug LIKE 'empresa-invasora-b-' || v_clean_suffix || '%';

    RAISE NOTICE 'Teardown cirúrgico concluído para o sufixo %', v_clean_suffix;
END $$;
*/
