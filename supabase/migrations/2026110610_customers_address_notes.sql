-- Migration: 2026110610_customers_address_notes.sql
-- Descrição: Adiciona colunas de endereço e observações à tabela customers para o painel omnichannel

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.customers.address IS 'Endereço residencial ou comercial do cliente';
COMMENT ON COLUMN public.customers.notes IS 'Observações e anotações perenes sobre o perfil do cliente';
