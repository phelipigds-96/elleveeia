-- ==============================================================================
-- ETAPA 8.4.3Q.1 — HARDENING DE CONVERSAS, MENSAGENS E SEGURANÇA MULTI-TENANT
-- Arquivo: supabase/migrations/20261105_conversations_security_hardening.sql
-- ==============================================================================
-- Objetivo:
-- 1. Pré-auditar a coluna status em public.conversations abortando a execução
--    caso existam registros com status inválido (sem alteração silenciosa).
-- 2. Adicionar constraint CHECK chk_conversations_status (open, closed, human).
-- 3. Blindar a imutabilidade do vínculo de empresa (company_id) em conversations
--    e messages via triggers dedicadas.
-- 4. Fortalecer as policies de UPDATE de conversations e messages com cláusulas
--    USING e WITH CHECK explícitas.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: PRÉ-AUDITORIA DETERMINÍSTICA DE STATUS EXISTENTES
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_invalid_count INTEGER;
BEGIN
  -- Identifica conversas com status divergente dos valores de negócio permitidos
  SELECT COUNT(*) INTO v_invalid_count
  FROM public.conversations
  WHERE status NOT IN ('open', 'closed', 'human');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION_ABORTED: Encontradas % conversa(s) com status incompatível. Valores aceitos: open, closed, human. Regularize os registros antes de aplicar a constraint CHECK.', v_invalid_count;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PARTE 2: CONSTRAINT CHECK NA COLUNA STATUS DE public.conversations
-- ------------------------------------------------------------------------------
ALTER TABLE public.conversations
DROP CONSTRAINT IF EXISTS chk_conversations_status;

ALTER TABLE public.conversations
ADD CONSTRAINT chk_conversations_status
CHECK (status IN ('open', 'closed', 'human'));

COMMENT ON CONSTRAINT chk_conversations_status ON public.conversations IS
  'Restringe os valores de status da conversa estritamente a open, closed ou human.';

-- ------------------------------------------------------------------------------
-- PARTE 3: TRIGGER DE IMUTABILIDADE DE TENANT (company_id) EM CONVERSAS E MENSAGENS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_conversation_and_message_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Impede qualquer tentativa de alterar a empresa (company_id) de uma conversa ou mensagem
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Operação negada: não é permitido alterar o vínculo de empresa (company_id) de uma conversa ou mensagem.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_conversation_tenant ON public.conversations;
CREATE TRIGGER trg_protect_conversation_tenant
BEFORE UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.protect_conversation_and_message_tenant();

DROP TRIGGER IF EXISTS trg_protect_message_tenant ON public.messages;
CREATE TRIGGER trg_protect_message_tenant
BEFORE UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.protect_conversation_and_message_tenant();

COMMENT ON FUNCTION public.protect_conversation_and_message_tenant() IS
  'Garante a imutabilidade estrita do tenant (company_id) em conversas e mensagens.';

-- ------------------------------------------------------------------------------
-- PARTE 4: POLICIES DE UPDATE COM USING E WITH CHECK EXPLÍCITOS
-- ------------------------------------------------------------------------------
-- Conversations UPDATE
DROP POLICY IF EXISTS "Users can update conversations of their company" ON public.conversations;
DROP POLICY IF EXISTS "Conversations: update for company users" ON public.conversations;

CREATE POLICY "Conversations: update for company users"
  ON public.conversations FOR UPDATE
  USING ( company_id = public.get_auth_company_id() )
  WITH CHECK ( company_id = public.get_auth_company_id() );

-- Messages UPDATE
DROP POLICY IF EXISTS "Users can update messages of their company" ON public.messages;
DROP POLICY IF EXISTS "Messages: update for company users" ON public.messages;

CREATE POLICY "Messages: update for company users"
  ON public.messages FOR UPDATE
  USING ( company_id = public.get_auth_company_id() )
  WITH CHECK ( company_id = public.get_auth_company_id() );
