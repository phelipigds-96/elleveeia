-- ==============================================================================
-- ELLEVEE IA — AC-04.5-P0.2 | ROTEIRO DE PRÉ-FLIGHT E TESTES EM POSTGRESQL REAL
-- ==============================================================================
-- Este script realiza:
-- 1. Consultas de compatibilidade (somente leitura) pré-aplicação da migration.
-- 2. Testes de permissões e controle de privilégios (anon, authenticated, service_role).
-- 3. Testes transacionais ACID (criação, atualização, rollback e concorrência).
-- 4. Testes de concorrência com duas conexões independentes (Advisory Lock).
-- 5. Teardown controlado das fixtures sintéticas.
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
-- Execute estas consultas ANTES de rodar a migration para garantir que a base
-- de dados não possui conflitos com o índice único parcial.

-- 1.1 Identifica se já existem múltiplos orçamentos ativos para a mesma conversa
-- (Se retornar registros, o operador deve arquivar os mais antigos antes da migration)
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
-- (Estes registros NÃO conflitam com o índice, pois ele filtra apenas NOT NULL)
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
-- Chamadas diretas como anon ou authenticated devem falhar com permissão negada (42501).

-- 2.1 Teste com role 'anon' (DEVE FALHAR com erro 42501)
SET ROLE anon;
DO $$
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
    );
    RAISE EXCEPTION 'VULNERABILIDADE: anon conseguiu executar save_enterprise_quote_atomic!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'SUCESSO: Execução como anon rejeitada com insufficient_privilege (42501).';
END $$;
RESET ROLE;

-- 2.2 Teste com role 'authenticated' (DEVE FALHAR com erro 42501)
SET ROLE authenticated;
DO $$
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 10.0, "subtotal": 10.0}]'::jsonb
    );
    RAISE EXCEPTION 'VULNERABILIDADE: authenticated conseguiu executar save_enterprise_quote_atomic!';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'SUCESSO: Execução como authenticated rejeitada com insufficient_privilege (42501).';
END $$;
RESET ROLE;


-- ==============================================================================
-- SEÇÃO 3: TESTES TRANSACIONAIS E CONCORRÊNCIA (EXECUTAR COMO service_role)
-- ==============================================================================

-- 3.1 Criação Legítima de Orçamento Inicial
SET ROLE service_role;

DO $$
DECLARE
    v_res JSONB;
    v_quote_id UUID;
BEGIN
    v_res := public.save_enterprise_quote_atomic(
        p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
        p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
        p_conversation_id := 'cccc1111-1111-1111-1111-111111111111',
        p_status := 'draft',
        p_total := 70.00,
        p_metadata := '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'::jsonb,
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 2, "unit_price": 35.00, "subtotal": 70.00}]'::jsonb
    );

    v_quote_id := (v_res->>'id')::uuid;
    IF v_quote_id IS NULL OR (v_res->>'version')::int <> 1 THEN
        RAISE EXCEPTION 'Falha ao criar orçamento inicial via RPC: %', v_res;
    END IF;
    RAISE NOTICE '3.1 SUCESSO: Orçamento criado com ID % na versão %', v_quote_id, v_res->>'version';
END $$;

-- 3.2 Atualização com Incremento de Versão
DO $$
DECLARE
    v_existing_id UUID;
    v_res JSONB;
BEGIN
    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = '11111111-1111-1111-1111-111111111111' 
      AND metadata @> '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'
    LIMIT 1;

    v_res := public.save_enterprise_quote_atomic(
        p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
        p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
        p_conversation_id := 'cccc1111-1111-1111-1111-111111111111',
        p_existing_quote_id := v_existing_id,
        p_expected_version := 1,
        p_status := 'ready',
        p_total := 105.00,
        p_metadata := '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'::jsonb,
        p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 3, "unit_price": 35.00, "subtotal": 105.00}]'::jsonb
    );

    IF (v_res->>'version')::int <> 2 THEN
        RAISE EXCEPTION 'Falha ao versionar orçamento: %', v_res;
    END IF;
    RAISE NOTICE '3.2 SUCESSO: Orçamento atualizado para versão % com total %', v_res->>'version', v_res->>'total';
END $$;

-- 3.3 Falha Induzida e Rollback Total ACID (Zero Lixo Residual)
BEGIN;
DO $$
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
        p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
        p_conversation_id := 'cccc-falha-induzida',
        p_status := 'draft',
        p_total := 50.00,
        p_metadata := '{"conversation_id": "cccc-falha-induzida"}'::jsonb,
        p_items := '[
            {"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 35.0, "subtotal": 35.0},
            {"product_id": "uuid-malformado-para-forcar-abort", "quantity": 1, "unit_price": 15.0, "subtotal": 15.0}
        ]'::jsonb
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '3.3 SUCESSO: Erro induzido capturado: %', SQLERRM;
END $$;

-- Comprova que nada foi gravado
DO $$
DECLARE
    v_c_quotes INT;
    v_c_items INT;
BEGIN
    SELECT COUNT(*) INTO v_c_quotes FROM public.quotes WHERE metadata @> '{"conversation_id": "cccc-falha-induzida"}';
    SELECT COUNT(*) INTO v_c_items FROM public.quote_items WHERE quote_id IN (
        SELECT id FROM public.quotes WHERE metadata @> '{"conversation_id": "cccc-falha-induzida"}'
    );
    IF v_c_quotes > 0 OR v_c_items > 0 THEN
        RAISE EXCEPTION 'VIOLAÇÃO DE ATOMICIDADE: Registros residuais encontrados após falha!';
    END IF;
    RAISE NOTICE '3.3 SUCESSO: Ausência de lixo residual comprovada (quotes=%, items=%)', v_c_quotes, v_c_items;
END $$;
ROLLBACK;

-- 3.4 Concorrência Otimista: Rejeição de Versão Defasada
DO $$
DECLARE
    v_existing_id UUID;
BEGIN
    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = '11111111-1111-1111-1111-111111111111' 
      AND metadata @> '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'
    LIMIT 1;

    -- Tenta atualizar esperando versão 1 quando o banco já está na versão 2
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
            p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
            p_conversation_id := 'cccc1111-1111-1111-1111-111111111111',
            p_existing_quote_id := v_existing_id,
            p_expected_version := 1, -- Versão obsoleta proposital!
            p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
        );
        RAISE EXCEPTION 'Falha: Concorrência otimista permitiu sobrescrita de versão defasada!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ORCAMENTO_CONCURRENCY_CONFLICT%' THEN
            RAISE NOTICE '3.4 SUCESSO: Conflito de versão bloqueado como esperado: %', SQLERRM;
        ELSE
            RAISE;
        END IF;
    END;
END $$;

-- 3.5 Isolamento entre Conversas no Mesmo Tenant: Bloqueio de Sequestro
DO $$
DECLARE
    v_existing_id UUID;
BEGIN
    SELECT id INTO v_existing_id FROM public.quotes 
    WHERE company_id = '11111111-1111-1111-1111-111111111111' 
      AND metadata @> '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'
    LIMIT 1;

    -- Conversa B tenta atualizar o orçamento que pertence à conversa A
    BEGIN
        PERFORM public.save_enterprise_quote_atomic(
            p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
            p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
            p_conversation_id := 'cccc2222-2222-2222-2222-222222222222', -- Conversa B divergente!
            p_existing_quote_id := v_existing_id,
            p_expected_version := 2,
            p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
        );
        RAISE EXCEPTION 'Falha: Isolamento entre conversas permitiu alteração indevida!';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%ORCAMENTO_CROSS_CONVERSATION_FORBIDDEN%' THEN
            RAISE NOTICE '3.5 SUCESSO: Acesso cruzado entre conversas bloqueado: %', SQLERRM;
        ELSE
            RAISE;
        END IF;
    END;
END $$;

RESET ROLE;


-- ==============================================================================
-- SEÇÃO 4: CONCORRÊNCIA SIMULTÂNEA EM DUAS CONEXÕES INDEPENDENTES
-- ==============================================================================
-- Instruções para o operador: Abra dois terminais psql ou duas abas do SQL Editor.

-- CONEXÃO 1:
-- SET ROLE service_role;
-- BEGIN;
-- SELECT public.save_enterprise_quote_atomic(
--     p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
--     p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
--     p_conversation_id := 'cccc-concorrencia-teste',
--     p_status := 'draft',
--     p_total := 35.00,
--     p_metadata := '{"conversation_id": "cccc-concorrencia-teste"}'::jsonb,
--     p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
-- );
-- (Mantenha aberta sem fazer commit!)

-- CONEXÃO 2 (Executar imediatamente enquanto Conexão 1 está aberta):
-- SET ROLE service_role;
-- BEGIN;
-- SELECT public.save_enterprise_quote_atomic(
--     p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
--     p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
--     p_conversation_id := 'cccc-concorrencia-teste',
--     p_status := 'draft',
--     p_total := 70.00,
--     p_metadata := '{"conversation_id": "cccc-concorrencia-teste"}'::jsonb,
--     p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 2, "unit_price": 35.00, "subtotal": 70.00}]'::jsonb
-- );
-- (Observar que a Conexão 2 fica retida esperando o advisory lock da Conexão 1!)

-- CONEXÃO 1:
-- COMMIT;

-- CONEXÃO 2:
-- Ao comitar a Conexão 1, a Conexão 2 é liberada imediatamente e retorna:
-- ERROR: ORCAMENTO_ACTIVE_EXISTS: Já existe um orçamento ativo (...) para a conversa cccc-concorrencia-teste.
-- ROLLBACK;


-- ==============================================================================
-- SEÇÃO 5: TEARDOWN CONTROLADO DAS FIXTURES SINTÉTICAS
-- ==============================================================================
-- Limpa estritamente os dados sintéticos criados durante este roteiro de testes:

DELETE FROM public.quote_items 
WHERE company_id = '11111111-1111-1111-1111-111111111111';

DELETE FROM public.quotes 
WHERE company_id = '11111111-1111-1111-1111-111111111111';

-- Confirmação de limpeza:
SELECT COUNT(*) AS residual_quotes FROM public.quotes WHERE company_id = '11111111-1111-1111-1111-111111111111';
SELECT COUNT(*) AS residual_items FROM public.quote_items WHERE company_id = '11111111-1111-1111-1111-111111111111';
