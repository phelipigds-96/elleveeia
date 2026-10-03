-- 1. Tabela api_keys para autenticação do webhook e identificação segura do tenant
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users view own company api_keys" 
    ON public.api_keys FOR SELECT 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own company api_keys" 
    ON public.api_keys FOR ALL 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- 2. Tabela webhook_events para controle de idempotência e auditoria de integrações
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Garantia absoluta de idempotência a nível de banco
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_unique ON public.webhook_events(company_id, event_id);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users view own webhook events" 
    ON public.webhook_events FOR SELECT 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- 3. Adiciona external_ids nas tabelas para cruzamento do motor de mensagens
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS external_id TEXT;

-- 4. Criação de índices de otimização de busca pelo motor backend
CREATE INDEX IF NOT EXISTS idx_conversations_ext_id ON public.conversations(company_id, external_id);
CREATE INDEX IF NOT EXISTS idx_messages_ext_id ON public.messages(company_id, external_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(company_id, phone);
