-- Migration: 2026110610_customers_address_notes.sql
-- Descrição: Adiciona colunas de endereço e observações à tabela customers e ativa o Realtime para mensagens e conversas

-- 1. Colunas do Perfil do Cliente
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.customers.address IS 'Endereço residencial ou comercial do cliente';
COMMENT ON COLUMN public.customers.notes IS 'Observações e anotações perenes sobre o perfil do cliente';

-- 2. Habilitação de Realtime no Supabase para Mensagens e Conversas
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN
    -- Já adicionada anteriormente
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  EXCEPTION WHEN duplicate_object THEN
    -- Já adicionada anteriormente
  END;
END $$;

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
