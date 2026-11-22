-- ==============================================================================
-- ELLEVEE IA — AC-04.5-P0.1 | ROTEIRO DE VERIFICAÇÃO EM POSTGRESQL REAL (STAGING)
-- ==============================================================================
-- Este script valida a atomicidade financeira, o rollback completo em falha induzida
-- e a serialização de concorrência com duas conexões simultâneas no PostgreSQL.
--
-- ATENÇÃO: Executar exclusivamente em ambiente de STAGING autorizado (dkjrpdhymtkgbknocijy).
-- NUNCA executar em Produção (ipxhkwirzrigttpwzwbl).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PREPARAÇÃO: IDs Sintéticos Isolados para Teste
-- ------------------------------------------------------------------------------
-- Company ID:   '11111111-1111-1111-1111-111111111111'
-- Customer ID:  'aaaa1111-1111-1111-1111-111111111111'
-- Conversation: 'cccc1111-1111-1111-1111-111111111111'
-- Product 1:    '00000000-0000-0000-0000-000000000001'

-- ==============================================================================
-- TESTE 1: Atomicidade e Rollback com Falha Induzida (Conexão 1)
-- ==============================================================================
-- Objetivo: Demonstrar que qualquer falha durante a execução da RPC resulta
-- em ROLLBACK TOTAL, sem deixar cabeçalho sem itens ou itens sem cabeçalho.

BEGIN;

-- 1.1 Tenta gravar orçamento com um item válido e um item propositalmente inválido (UUID malformado)
DO $$
BEGIN
    PERFORM public.save_enterprise_quote_atomic(
        p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
        p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
        p_conversation_id := 'cccc1111-1111-1111-1111-111111111111',
        p_status := 'draft',
        p_total := 70.00,
        p_metadata := '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'::jsonb,
        p_items := '[
            {"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 2, "unit_price": 35.00, "subtotal": 70.00},
            {"product_id": "uuid-invalido-forca-erro", "quantity": 1, "unit_price": 10.00, "subtotal": 10.00}
        ]'::jsonb
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Falha induzida capturada com sucesso: %', SQLERRM;
END $$;

-- 1.2 Verifica que NENHUM registro residual foi gravado nesta transação
SELECT COUNT(*) AS quotes_pendentes FROM public.quotes 
WHERE company_id = '11111111-1111-1111-1111-111111111111';

SELECT COUNT(*) AS items_pendentes FROM public.quote_items 
WHERE company_id = '11111111-1111-1111-1111-111111111111';

ROLLBACK;


-- ==============================================================================
-- TESTE 2: Concorrência Simultânea com Duas Conexões (Advisory Lock + Unicidade)
-- ==============================================================================
-- Procedimento para executar em DOIS terminais psql simultâneos:

-- ------------------------------------------------------------------------------
-- TERMINAL 1 (Sessão A)
-- ------------------------------------------------------------------------------
BEGIN;
SELECT public.save_enterprise_quote_atomic(
    p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
    p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
    p_conversation_id := 'cccc1111-1111-1111-1111-111111111111',
    p_status := 'draft',
    p_total := 35.00,
    p_metadata := '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'::jsonb,
    p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 1, "unit_price": 35.00, "subtotal": 35.00}]'::jsonb
);
-- NÃO FAÇA COMMIT AINDA. O lock pg_advisory_xact_lock está retido pela Sessão A.

-- ------------------------------------------------------------------------------
-- TERMINAL 2 (Sessão B - Executar enquanto a Sessão A está aberta)
-- ------------------------------------------------------------------------------
-- Tenta criar um NOVO rascunho para a mesma conversa simultaneamente:
BEGIN;
SELECT public.save_enterprise_quote_atomic(
    p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
    p_customer_id := 'aaaa1111-1111-1111-1111-111111111111'::uuid,
    p_conversation_id := 'cccc1111-1111-1111-1111-111111111111',
    p_status := 'draft',
    p_total := 70.00,
    p_metadata := '{"conversation_id": "cccc1111-1111-1111-1111-111111111111"}'::jsonb,
    p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 2, "unit_price": 35.00, "subtotal": 70.00}]'::jsonb
);
-- OBSERVAÇÃO: O Terminal 2 fica BLOQUEADO aguardando o lock da Sessão A.

-- ------------------------------------------------------------------------------
-- TERMINAL 1 (Sessão A)
-- ------------------------------------------------------------------------------
COMMIT;
-- Ao commitar, a Sessão A libera o lock.

-- ------------------------------------------------------------------------------
-- TERMINAL 2 (Sessão B)
-- ------------------------------------------------------------------------------
-- Imediatamente após o COMMIT da Sessão A, a Sessão B adquire o lock,
-- detecta que já existe um orçamento ativo para a conversa 'cccc1111-1111-1111-1111-111111111111'
-- e lança a exceção:
-- ERROR: ORCAMENTO_ACTIVE_EXISTS: Já existe um orçamento ativo (...) para a conversa cccc1111-1111-1111-1111-111111111111.
ROLLBACK;


-- ==============================================================================
-- TESTE 3: Verificação de Independência de Conversas Paralelas (Sem Contenção)
-- ==============================================================================
-- Conversa A (chave 1) e Conversa B (chave 2) devem executar simultaneamente sem espera:
BEGIN;
SELECT public.save_enterprise_quote_atomic(
    p_company_id := '11111111-1111-1111-1111-111111111111'::uuid,
    p_customer_id := 'bbbb2222-2222-2222-2222-222222222222'::uuid,
    p_conversation_id := 'cccc2222-2222-2222-2222-222222222222',
    p_status := 'draft',
    p_total := 105.00,
    p_metadata := '{"conversation_id": "cccc2222-2222-2222-2222-222222222222"}'::jsonb,
    p_items := '[{"product_id": "00000000-0000-0000-0000-000000000001", "quantity": 3, "unit_price": 35.00, "subtotal": 105.00}]'::jsonb
);
COMMIT;

-- Limpeza sintética após o teste:
-- DELETE FROM public.quote_items WHERE company_id = '11111111-1111-1111-1111-111111111111';
-- DELETE FROM public.quotes WHERE company_id = '11111111-1111-1111-1111-111111111111';
