-- Migration: 2026111102_customers_name_confirmation.sql
-- Descrição: Adiciona suporte a espelhamento de nome do WhatsApp (whatsapp_name),
-- confirmação híbrida de nome (name_confirmed / name_source) para CRM e Agente IA,
-- mantendo retrocompatibilidade segura com clientes já existentes.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS whatsapp_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS name_confirmed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS name_source TEXT DEFAULT 'whatsapp_push';

COMMENT ON COLUMN public.customers.whatsapp_name IS 'Último nome/pushName recebido via WhatsApp/omnichannel (referência original)';
COMMENT ON COLUMN public.customers.name_confirmed IS 'Indica se o nome oficial do cliente já foi validado/confirmado (CRM, humano, agenda ou agente IA)';
COMMENT ON COLUMN public.customers.name_source IS 'Origem do nome atual: manual, agent_collected, whatsapp_contact ou whatsapp_push';

-- Preserva o nome original recebido até então em whatsapp_name
UPDATE public.customers
SET whatsapp_name = name
WHERE whatsapp_name IS NULL
  AND name IS NOT NULL
  AND length(trim(name)) > 0;

-- Marca como confirmados clientes legados que já possuem nome alfabético plausível
-- (evita perguntar o nome novamente para quem já é cliente antigo identificado)
UPDATE public.customers
SET name_confirmed = true
WHERE name_confirmed = false
  AND name IS NOT NULL
  AND length(trim(name)) >= 2
  AND name !~ '^Cliente(\s|\(|$)'
  AND name ~ '[A-Za-zÀ-ÿ]{2,}'
  AND name !~ '[0-9]';

CREATE INDEX IF NOT EXISTS idx_customers_company_updated_at
  ON public.customers (company_id, updated_at DESC);
