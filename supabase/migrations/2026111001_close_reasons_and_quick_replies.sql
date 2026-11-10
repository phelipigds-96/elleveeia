-- ==============================================================================
-- Migration: 2026111001_close_reasons_and_quick_replies.sql
-- Descrição: Tabelas e colunas para Motivos de Finalização (Close Reasons) 
--            e Mensagens Rápidas (Quick Replies) com isolamento Multi-tenant (RLS).
-- ==============================================================================

-- 1. Coluna de obrigatoriedade de motivo de finalização na tabela companies
ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS require_close_reason BOOLEAN NOT NULL DEFAULT false;

-- 2. Tabela de Motivos de Finalização por Empresa
CREATE TABLE IF NOT EXISTS public.conversation_close_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL DEFAULT 'slate', -- slate, emerald, blue, violet, amber, rose, cyan
    is_active BOOLEAN NOT NULL DEFAULT true,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger de updated_at para conversation_close_reasons
CREATE OR REPLACE FUNCTION public.handle_conversation_close_reasons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_close_reasons_updated_at ON public.conversation_close_reasons;
CREATE TRIGGER trg_conversation_close_reasons_updated_at
BEFORE UPDATE ON public.conversation_close_reasons
FOR EACH ROW
EXECUTE FUNCTION public.handle_conversation_close_reasons_updated_at();

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_close_reasons_company ON public.conversation_close_reasons(company_id, is_active, order_index);

-- RLS para conversation_close_reasons
ALTER TABLE public.conversation_close_reasons ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view close reasons of their company"
    ON public.conversation_close_reasons FOR SELECT
    USING (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert close reasons for their company"
    ON public.conversation_close_reasons FOR INSERT
    WITH CHECK (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update close reasons of their company"
    ON public.conversation_close_reasons FOR UPDATE
    USING (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete close reasons of their company"
    ON public.conversation_close_reasons FOR DELETE
    USING (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Associação na tabela de Conversas
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS close_reason_id UUID REFERENCES public.conversation_close_reasons(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS close_reason_text TEXT,
ADD COLUMN IF NOT EXISTS closed_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_close_reason ON public.conversations(close_reason_id);

-- 4. Tabela de Mensagens Rápidas (Canned Responses / Quick Replies)
CREATE TABLE IF NOT EXISTS public.quick_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    shortcut TEXT, -- ex: "pix", "horario", "chave"
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Geral', -- 'Geral', 'Financeiro', 'Vendas', 'Suporte', 'Horários'
    is_active BOOLEAN NOT NULL DEFAULT true,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Trigger de updated_at para quick_replies
CREATE OR REPLACE FUNCTION public.handle_quick_replies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quick_replies_updated_at ON public.quick_replies;
CREATE TRIGGER trg_quick_replies_updated_at
BEFORE UPDATE ON public.quick_replies
FOR EACH ROW
EXECUTE FUNCTION public.handle_quick_replies_updated_at();

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_quick_replies_company ON public.quick_replies(company_id, is_active, order_index);
CREATE INDEX IF NOT EXISTS idx_quick_replies_shortcut ON public.quick_replies(company_id, shortcut);

-- RLS para quick_replies
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view quick replies of their company"
    ON public.quick_replies FOR SELECT
    USING (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert quick replies for their company"
    ON public.quick_replies FOR INSERT
    WITH CHECK (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update quick replies of their company"
    ON public.quick_replies FOR UPDATE
    USING (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete quick replies of their company"
    ON public.quick_replies FOR DELETE
    USING (
      company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      OR (SELECT current_user = 'service_role')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;
