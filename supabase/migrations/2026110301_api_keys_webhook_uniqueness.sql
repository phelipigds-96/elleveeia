-- ============================================================================
-- ETAPA 8.4.3N.6: HARDENING FINAL DA MIGRATION E SECURITY DEFINER
-- ============================================================================
-- 1. BLOQUEIO DE EXPURGO AUTOMÁTICO DE DUPLICATAS:
--    A migration NÃO executa DELETE automático de tokens.
--    Caso existam múltiplas chaves automáticas para uma mesma empresa, a migration
--    é imediatamente interrompida (RAISE EXCEPTION), exigindo prévia análise operacional
--    para evitar a quebra acidental de webhooks n8n em produção.
--    Script para auditoria e tomada de decisão: supabase/scripts/audit_webhook_key_duplicates.sql
-- 2. CRIAÇÃO DE ÍNDICE ÚNICO PARCIAL:
--    Garante no PostgreSQL que cada empresa (company_id) tenha no máximo UMA chave automática
--    após a regularização dos dados.
-- 3. HARDENING RIGOROSO DE SECURITY DEFINER E SEARCH_PATH:
--    - Configuração restrita: SET search_path = pg_catalog, public, pg_temp
--    - pg_catalog em primeiro lugar garante resolução imediata de tipos, operadores e funções do sistema.
--    - pg_temp em último lugar previne interceptações de objetos temporários.
--    - Todas as tabelas e referências estão totalmente qualificadas (public.api_keys).
-- 4. GOVERNANÇA DE PRIVILÉGIOS (LEAST PRIVILEGE):
--    - EXECUTE revogado de PUBLIC, anon e authenticated.
--    - EXECUTE concedido exclusivamente a service_role.
-- ============================================================================

-- 1. Verificação preventiva: interromper a migration se existirem duplicatas pré-existentes.
--    O expurgo automático foi bloqueado para impedir a invalidação acidental de tokens ativos no n8n.
DO $$
DECLARE
  v_dup_count INT;
BEGIN
  WITH ranked_keys AS (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY company_id 
        ORDER BY created_at DESC, id DESC
      ) as rn
    FROM public.api_keys
    WHERE description = 'Chave Automatica Webhook'
  )
  SELECT COUNT(*) INTO v_dup_count 
  FROM ranked_keys 
  WHERE rn > 1;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION ABORTADA: Foram encontradas % chave(s) automática(s) duplicada(s). A exclusão automática de tokens foi bloqueada por governança operacional para evitar invalidar integrações n8n em uso. Execute o script de auditoria para identificar as chaves ativas antes de criar o índice único: supabase/scripts/audit_webhook_key_duplicates.sql', v_dup_count;
  END IF;
END;
$$;

-- 2. Índice único parcial para unicidade de token automático por empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_company_auto_webhook
ON public.api_keys (company_id)
WHERE description = 'Chave Automatica Webhook';

-- 3. Função RPC transacional para rotação e inicialização atômica concorrente
CREATE OR REPLACE FUNCTION public.rotate_company_webhook_key(
  p_company_id UUID,
  p_new_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_key_id UUID;
  v_final_key TEXT;
BEGIN
  -- 3.1. Validação estrita de parâmetros obrigatórios
  IF p_company_id IS NULL OR p_new_key IS NULL OR btrim(p_new_key) = '' THEN
    RAISE EXCEPTION 'Parâmetros inválidos para rotate_company_webhook_key: company_id e new_key são obrigatórios';
  END IF;

  -- 3.2. Bloqueio pessimista na chave automática existente para serializar rotações concorrentes
  SELECT id INTO v_key_id
  FROM public.api_keys
  WHERE company_id = p_company_id
    AND description = 'Chave Automatica Webhook'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_key_id IS NOT NULL THEN
    -- 3.3. Atualização atômica in-place estritamente restrita à chave automática da empresa informada
    UPDATE public.api_keys
    SET key = p_new_key
    WHERE id = v_key_id
      AND company_id = p_company_id
      AND description = 'Chave Automatica Webhook'
    RETURNING key INTO v_final_key;
  ELSE
    -- 3.4. Inserção atômica com resolução de concorrência no índice parcial
    INSERT INTO public.api_keys (company_id, key, description)
    VALUES (p_company_id, p_new_key, 'Chave Automatica Webhook')
    ON CONFLICT (company_id) WHERE description = 'Chave Automatica Webhook'
    DO UPDATE SET key = EXCLUDED.key
    WHERE public.api_keys.company_id = p_company_id
      AND public.api_keys.description = 'Chave Automatica Webhook'
    RETURNING key INTO v_final_key;
  END IF;

  RETURN v_final_key;
END;
$$;

-- 4. Governança estrita de permissões da RPC: proibir execução pública/direta e restringir a service_role
REVOKE ALL ON FUNCTION public.rotate_company_webhook_key(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_company_webhook_key(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_company_webhook_key(UUID, TEXT) TO service_role;
