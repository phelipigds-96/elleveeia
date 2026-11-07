-- Migration: 2026110702_companies_cnpj_contact_email.sql
-- Description: Adds persistence for company fiscal registration (CNPJ) and contact/admin email

ALTER TABLE public.companies 
ADD COLUMN IF NOT EXISTS cnpj text,
ADD COLUMN IF NOT EXISTS contact_email text;

CREATE INDEX IF NOT EXISTS idx_companies_cnpj ON public.companies (cnpj);
CREATE INDEX IF NOT EXISTS idx_companies_contact_email ON public.companies (contact_email);
