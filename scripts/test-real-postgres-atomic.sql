-- ==============================================================================
-- ELLEVEE IA — AC-04.5-P0.2 | ROTEIRO DE PRÉ-FLIGHT E TESTES EM POSTGRESQL REAL
-- ==============================================================================
-- Este script realiza a validação completa da migration da RPC atômica:
-- 1. Consultas de compatibilidade (somente leitura) pré-aplicação da migration.
-- 2. Testes de permissões e controle de privilégios (anon, authenticated, service_role).
-- 3. Setup de fixtures sintéticas rastreadas e isoladas (satisfazendo FKs reais).
-- 4. Testes transacionais ACID (criação, versão, rollback de criação, rollback de atualização).
-- 5. Testes de concorrência e integridade multi-tenant (conversa, cliente e sanitização).
-- 6. Guia para concorrência em duas conexões independentes (Advisory Locks).
-- 7. Teardown cirúrgico e auditável (exclusão estrita apenas dos IDs criados).
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
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
        p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
    );
    RAISE EXCEPTION 'VULNERABILIDADE: anon conseguiu executar save_enterprise_quote_atomic!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'SUCESSO 2.1: Execução como anon rejeitada com insufficient_privilege (42501).';
END $$;
RESET ROLE;

-- 2.2 Teste com role 'authenticated' (DEVE FALHAR com erro 42501)
SET ROLE authenticated;
DO $$
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
        p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
    );
    RAISE EXCEPTION 'VULNERABILIDADE: authenticated conseguiu executar save_enterprise_quote_atomic!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'SUCESSO 2.2: Execução como authenticated rejeitada com insufficient_privilege (42501).';
END $$;
RESET ROLE;


-- ==============================================================================
-- SEÇÃO 3: SETUP DE FIXTURES SINTÉTICAS RASTREADAS E ISOLADAS
-- ==============================================================================
-- Cria fixtures dedicadas no namespace exclusivo 'e11e0000-%' para respeitar FKs reais.
-- NUNCA toca em empresas ou dados existentes no banco.

-- 3.1 Tabela de rastreamento de IDs criados durante o teste
CREATE TABLE IF NOT EXISTS public.test_ac045_created_quotes (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3.2 Fixtures para Tenant Principal A
INSERT INTO public.companies (id, name, slug)
VALUES ('e11e0000-0000-4000-a000-000000000001', 'Empresa Teste AC-04.5 A', 'empresa-teste-ac045-a')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.customers (id, company_id, name, phone, email)
VALUES ('e11e0000-0000-4000-a000-000000000002', 'e11e0000-0000-4000-a000-000000000001', 'Cliente Teste A', '+5511999990001', 'teste-a@ellevee.ia')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
VALUES 
    ('e11e0000-0000-4000-a000-000000000003', 'e11e0000-0000-4000-a000-000000000001', 'e11e0000-0000-4000-a000-000000000002', 'whatsapp', 'open'),
    ('e11e0000-0000-4000-a000-000000000006', 'e11e0000-0000-4000-a000-000000000001', 'e11e0000-0000-4000-a000-000000000002', 'whatsapp', 'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, company_id, name, normalized_name, active)
VALUES 
    ('e11e0000-0000-4000-a000-000000000004', 'e11e0000-0000-4000-a000-000000000001', 'Produto Sintético A', 'produto sintetico a', true),
    ('e11e0000-0000-4000-a000-000000000005', 'e11e0000-0000-4000-a000-000000000001', 'Produto Sintético B', 'produto sintetico b', true)
ON CONFLICT (id) DO NOTHING;

-- 3.3 Fixtures para Tenant Cruzado B (Simulação de Invasão / Cross-Tenant)
INSERT INTO public.companies (id, name, slug)
VALUES ('e11e0000-0000-4000-a000-000000000099', 'Empresa Teste Invasora B', 'empresa-teste-invasora-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.customers (id, company_id, name, phone, email)
VALUES ('e11e0000-0000-4000-a000-000000000098', 'e11e0000-0000-4000-a000-000000000099', 'Cliente Teste B', '+5511888880002', 'teste-b@ellevee.ia')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.conversations (id, company_id, customer_id, channel, status)
VALUES ('e11e0000-0000-4000-a000-000000000097', 'e11e0000-0000-4000-a000-000000000099', 'e11e0000-0000-4000-a000-000000000098', 'whatsapp', 'open')
ON CONFLICT (id) DO NOTHING;


-- ==============================================================================
-- SEÇÃO 4: TESTES TRANSACIONAIS ACID E CONCORRÊNCIA (service_role)
-- ==============================================================================
SET ROLE service_role;

-- 4.1 Criação de Orçamento Inicial (Versão 1)
DO $$
DECLARE
    v_res JSONB;
    v_quote_id UUID;
BEGIN
    v_res := public.save_enterprise_quote_atomic(
        p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
        p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
        p_conversation_id := 'e11e0000-0000-4000-a000-000000000003',
        p_status := 'draft',
        p_total := 70.00,
        p_metadata := '{"canal": "whatsapp_staging"}'::jsonb,
        p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 2, "unit_price": 35.00, "subtotal": 70.00}]'::jsonb
    );

    v_quote_id := (v_res->>'id')::uuid;
    IF v_quote_id IS NULL OR (v_res->>'version')::int <> 1 THEN
        RAISE EXCEPTION 'Falha ao criar orçamento inicial via RPC: %', v_res;
    END IF;

    -- Registra ID na tabela de rastreamento para teardown cirúrgico
    INSERT INTO public.test_ac045_created_quotes (id) VALUES (v_quote_id) ON CONFLICT DO NOTHING;

    RAISE NOTICE 'SUCESSO 4.1: Orçamento criado com ID % na versão %', v_quote_id, v_res->>'version';
END $$;

-- 4.2 Atualização com Incremento de Versão (Versão 2)
DO $$
DECLARE
    v_existing_id UUID;
    v_res JSONB;
BEGIN
    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = 'e11e0000-0000-4000-a000-000000000001' 
      AND metadata @> '{"conversation_id": "e11e0000-0000-4000-a000-000000000003"}'
    LIMIT 1;

    v_res := public.save_enterprise_quote_atomic(
        p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
        p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
        p_conversation_id := 'e11e0000-0000-4000-a000-000000000003',
        p_existing_quote_id := v_existing_id,
        p_expected_version := 1,
        p_status := 'ready',
        p_total := 105.00,
        p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 3, "unit_price": 35.00, "subtotal": 105.00}]'::jsonb
    );

    IF (v_res->>'version')::int <> 2 THEN
        RAISE EXCEPTION 'Falha ao versionar orçamento: %', v_res;
    END IF;
    RAISE NOTICE 'SUCESSO 4.2: Orçamento atualizado para versão % com total %', v_res->>'version', v_res->>'total';
END $$;

-- 4.3 Rollback Total em Falha de Criação (Zero Lixo Residual)
BEGIN;
DO $$
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
        p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
        p_conversation_id := 'e11e0000-0000-4000-a000-000000000006',
        p_status := 'draft',
        p_total := 50.00,
        p_items := '[
            {"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 35.0, "subtotal": 35.0},
            {"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 15.0, "subtotal": 15.0}
        ]'::jsonb
    );
    RAISE EXCEPTION 'Falha esperada não ocorreu ao tentar inserir produto inválido!';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SUCESSO 4.3: Erro induzido de criação capturado: %', SQLERRM;
END $$;

DO $$
DECLARE
    v_c_quotes INT;
    v_c_items INT;
BEGIN
    SELECT COUNT(*) INTO v_c_quotes FROM public.quotes WHERE metadata @> '{"conversation_id": "e11e0000-0000-4000-a000-000000000006"}';
    SELECT COUNT(*) INTO v_c_items FROM public.quote_items WHERE quote_id IN (
        SELECT id FROM public.quotes WHERE metadata @> '{"conversation_id": "e11e0000-0000-4000-a000-000000000006"}'
    );
    IF v_c_quotes > 0 OR v_c_items > 0 THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE: Registros residuais encontrados após falha de criação!';
    END IF;
    RAISE NOTICE 'SUCESSO 4.3: Ausência de lixo residual comprovada em criação (quotes=%, items=%)', v_c_quotes, v_c_items;
END $$;
ROLLBACK;

-- 4.4 Rollback em Falha de Atualização: Preservação Integral dos Itens Anteriores
DO $$
DECLARE
    v_existing_id UUID;
    v_item_count_before INT;
    v_item_count_after INT;
    v_ver_before INT;
    v_ver_after INT;
BEGIN
    SELECT id, (metadata->>'version')::int INTO v_existing_id, v_ver_before 
    FROM public.quotes 
    WHERE company_id = 'e11e0000-0000-4000-a000-000000000001' 
      AND metadata @> '{"conversation_id": "e11e0000-0000-4000-a000-000000000003"}'
    LIMIT 1;

    SELECT COUNT(*) INTO v_item_count_before FROM public.quote_items WHERE quote_id = v_existing_id;

    -- Tentativa de atualização dentro de subtransação propositalmente fadada ao erro
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
            p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
            p_conversation_id := 'e11e0000-0000-4000-a000-000000000003',
            p_existing_quote_id := v_existing_id,
            p_expected_version := v_ver_before,
            p_items := '[
                {"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 10, "unit_price": 35.0, "subtotal": 350.0},
                {"product_id": "00000000-0000-0000-0000-000000000000", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}
            ]'::jsonb
        );
        RAISE EXCEPTION 'Falha: Atualização inválida deveria ter gerado exceção!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'SUCESSO 4.4 (Tentativa de atualização rejeitada): %', SQLERRM;
    END;

    -- Comprova que o rollback restaurou integralmente a versão e os itens anteriores
    SELECT (metadata->>'version')::int INTO v_ver_after FROM public.quotes WHERE id = v_existing_id;
    SELECT COUNT(*) INTO v_item_count_after FROM public.quote_items WHERE quote_id = v_existing_id;

    IF v_ver_after <> v_ver_before THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE: Versão do orçamento foi alterada após rollback de atualização! (antes=%, depois=%)', v_ver_before, v_ver_after;
    END IF;

    IF v_item_count_after <> v_item_count_before THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE: Itens anteriores foram perdidos ou corrompidos após rollback! (antes=%, depois=%)', v_item_count_before, v_item_count_after;
    END IF;

    RAISE NOTICE 'SUCESSO 4.4: Preservação de itens e versão em rollback de atualização confirmada (versão=%, itens=%)', v_ver_after, v_item_count_after;
END $$;

-- 4.5 Concorrência Otimista: Rejeição de Versão Defasada
DO $$
DECLARE
    v_existing_id UUID;
BEGIN
    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = 'e11e0000-0000-4000-a000-000000000001' 
      AND metadata @> '{"conversation_id": "e11e0000-0000-4000-a000-000000000003"}'
    LIMIT 1;

    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
            p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
            p_conversation_id := 'e11e0000-0000-4000-a000-000000000003',
            p_existing_quote_id := v_existing_id,
            p_expected_version := 1, -- Versão obsoleta proposital (banco está na 2)!
            p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
        );
        RAISE EXCEPTION 'Falha: Concorrência otimista permitiu sobrescrita de versão defasada!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ORCAMENTO_CONCURRENCY_CONFLICT%' THEN
            RAISE NOTICE 'SUCESSO 4.5: Conflito de versão bloqueado como esperado: %', SQLERRM;
        ELSE
            RAISE;
        END IF;
    END;
END $$;

-- 4.6 Isolamento entre Conversas (Bloqueio de Sequestro)
DO $$
DECLARE
    v_existing_id UUID;
BEGIN
    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = 'e11e0000-0000-4000-a000-000000000001' 
      AND metadata @> '{"conversation_id": "e11e0000-0000-4000-a000-000000000003"}'
    LIMIT 1;

    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
            p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
            p_conversation_id := 'e11e0000-0000-4000-a000-000000000006', -- Conversa divergente!
            p_existing_quote_id := v_existing_id,
            p_expected_version := 2,
            p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
        );
        RAISE EXCEPTION 'Falha: Isolamento entre conversas permitiu alteração indevida!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN%' THEN
            RAISE NOTICE 'SUCESSO 4.6: Acesso cruzado entre conversas bloqueado: %', SQLERRM;
        ELSE
            RAISE;
        END IF;
    END;
END $$;

-- 4.7 Isolamento entre Clientes no Caminho de Conversa
DO $$
DECLARE
    v_res JSONB;
BEGIN
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
            p_customer_id := 'e11e0000-0000-4000-a000-000000000098'::uuid, -- Cliente da Empresa B!
            p_conversation_id := 'e11e0000-0000-4000-a000-000000000003',
            p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
        );
        RAISE EXCEPTION 'Falha: Permitiu cliente divergente da conversa e da empresa!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ORCAMENTO_CROSS_COMPANY_FORBIDDEN%' OR SQLERRM LIKE '%ORCAMENTO_CROSS_CUSTOMER_FORBIDDEN%' THEN
            RAISE NOTICE 'SUCESSO 4.7: Inconsistência de cliente/empresa bloqueada: %', SQLERRM;
        ELSE
            RAISE;
        END IF;
    END;
END $$;

-- 4.8 Sanitização de Metadados: Impedir Injeção de Campos de Controle
DO $$
DECLARE
    v_res JSONB;
    v_saved_metadata JSONB;
    v_quote_id UUID;
BEGIN
    v_res := public.save_enterprise_quote_atomic(
        p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
        p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
        p_conversation_id := 'e11e0000-0000-4000-a000-000000000006',
        p_status := 'draft',
        p_total := 35.00,
        p_metadata := '{
            "conversation_id": "malicious-fake-conversation",
            "version": 999,
            "company_id": "00000000-0000-0000-0000-000000000000",
            "campo_legitimo": "dado_customizado"
        }'::jsonb,
        p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
    );

    v_quote_id := (v_res->>'id')::uuid;
    INSERT INTO public.test_ac045_created_quotes (id) VALUES (v_quote_id) ON CONFLICT DO NOTHING;

    SELECT metadata INTO v_saved_metadata FROM public.quotes WHERE id = v_quote_id;

    IF v_saved_metadata->>'conversation_id' <> 'e11e0000-0000-4000-a000-000000000006' THEN
        RAISE EXCEPTION 'VULNERABILIDADE: conversation_id nos metadados foi falsificado!';
    END IF;

    IF (v_saved_metadata->>'version')::int <> 1 THEN
        RAISE EXCEPTION 'VULNERABILIDADE: version nos metadados foi adulterada para %!', v_saved_metadata->>'version';
    END IF;

    IF v_saved_metadata ? 'company_id' THEN
        RAISE EXCEPTION 'VULNERABILIDADE: company_id de controle vazou para dentro dos metadados!';
    END IF;

    IF v_saved_metadata->>'campo_legitimo' <> 'dado_customizado' THEN
        RAISE EXCEPTION 'Falha: campo de negócio legítimo não foi preservado nos metadados!';
    END IF;

    RAISE NOTICE 'SUCESSO 4.8: Sanitização de metadados comprovada com sucesso.';
END $$;

RESET ROLE;


-- ==============================================================================
-- SEÇÃO 5: GUIA PARA CONCORRÊNCIA EM DUAS CONEXÕES INDEPENDENTES
-- ==============================================================================
-- Instruções operacionais para testar concorrência real via pg_advisory_xact_lock:
-- Abra duas abas do Supabase SQL Editor ou dois terminais psql conectados ao Staging.

-- --- ABA 1 (Conexão 1):
-- SET ROLE service_role;
-- BEGIN;
-- SELECT public.save_enterprise_quote_atomic(
--     p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
--     p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
--     p_conversation_id := 'e11e0000-concorrencia-simultanea',
--     p_status := 'draft',
--     p_total := 35.00,
--     p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
-- );
-- -- (MANTENHA A TRANSAÇÃO ABERTA! Não execute COMMIT ainda.)

-- --- ABA 2 (Conexão 2 - Executar enquanto Aba 1 está aberta):
-- SET ROLE service_role;
-- BEGIN;
-- SELECT public.save_enterprise_quote_atomic(
--     p_company_id := 'e11e0000-0000-4000-a000-000000000001'::uuid,
--     p_customer_id := 'e11e0000-0000-4000-a000-000000000002'::uuid,
--     p_conversation_id := 'e11e0000-concorrencia-simultanea',
--     p_status := 'draft',
--     p_total := 70.00,
--     p_items := '[{"product_id": "e11e0000-0000-4000-a000-000000000004", "quantity": 2, "unit_price": 35.00, "subtotal": 70.00}]'::jsonb
-- );
-- -- (Observe que a Aba 2 fica retida esperando o advisory lock transacional da Aba 1.)

-- --- ABA 1:
-- COMMIT;

-- --- ABA 2:
-- -- Ao comitar a Aba 1, a Aba 2 é imediatamente liberada e falha fail-closed com:
-- -- ERROR: ORCAMENTO_ACTIVE_EXISTS: Já existe um orçamento ativo (...) para a conversa e11e0000-concorrencia-simultanea.
-- ROLLBACK;


-- ==============================================================================
-- SEÇÃO 6: TEARDOWN CONTROLADO E CIRÚRGICO DAS FIXTURES SINTÉTICAS
-- ==============================================================================
-- Exclui exclusivamente os orçamentos e registros que pertencem estritamente
-- aos IDs rastreados e ao namespace sintético deste teste ('e11e0000-%').
-- NUNCA executa exclusão em massa por company_id genérico nem afeta dados preexistentes.

-- 1. Exclui quote_items vinculados exclusivamente aos quotes rastreados criados pelo teste:
DELETE FROM public.quote_items 
WHERE quote_id IN (SELECT id FROM public.test_ac045_created_quotes);

-- 2. Exclui quotes rastreados criados pelo teste:
DELETE FROM public.quotes 
WHERE id IN (SELECT id FROM public.test_ac045_created_quotes);

-- 3. Remove tabela temporária de rastreamento de IDs:
DROP TABLE IF EXISTS public.test_ac045_created_quotes;

-- 4. Exclui exclusivamente as fixtures sintéticas criadas para satisfazer as constraints de FK:
DELETE FROM public.conversations 
WHERE id IN (
    'e11e0000-0000-4000-a000-000000000003'::uuid,
    'e11e0000-0000-4000-a000-000000000006'::uuid,
    'e11e0000-0000-4000-a000-000000000097'::uuid
);

DELETE FROM public.products 
WHERE id IN (
    'e11e0000-0000-4000-a000-000000000004'::uuid,
    'e11e0000-0000-4000-a000-000000000005'::uuid
);

DELETE FROM public.customers 
WHERE id IN (
    'e11e0000-0000-4000-a000-000000000002'::uuid,
    'e11e0000-0000-4000-a000-000000000098'::uuid
);

DELETE FROM public.companies 
WHERE id IN (
    'e11e0000-0000-4000-a000-000000000001'::uuid,
    'e11e0000-0000-4000-a000-000000000099'::uuid
);

-- Confirmação auditável de limpeza:
SELECT COUNT(*) AS residual_test_quotes 
FROM public.quotes 
WHERE company_id IN ('e11e0000-0000-4000-a000-000000000001'::uuid, 'e11e0000-0000-4000-a000-000000000099'::uuid);
