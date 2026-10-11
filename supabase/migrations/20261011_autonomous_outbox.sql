-- ==============================================================================
-- MIGRATION: OUTBOX DE SAÍDA E SUPORTE AO CICLO AUTÔNOMO DE ATENDIMENTO
-- ==============================================================================
-- Garante entrega confiável de mensagens para n8n/canais externos com
-- idempotência, controle de tentativas e desacoplamento da execução do LLM.

CREATE TABLE IF NOT EXISTS public.message_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  idempotency_key TEXT UNIQUE NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  recipient TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'suppressed'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_company_status ON public.message_outbox(company_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_idempotency ON public.message_outbox(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_outbox_conversation ON public.message_outbox(conversation_id);

ALTER TABLE public.message_outbox ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users view own company outbox" 
    ON public.message_outbox FOR SELECT 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users manage own company outbox" 
    ON public.message_outbox FOR ALL 
    USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;