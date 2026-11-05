-- ==============================================================================
-- BASELINE HISTÓRICO MÍNIMO DO BANCO
-- Arquivo: supabase/migrations/2026093000_initial_baseline_schema.sql
-- ==============================================================================
-- Objetivo:
-- 1. Habilitar a extensão "uuid-ossp" necessária para uuid_generate_v4().
-- 2. Criar as entidades estruturais de base da plataforma (companies e profiles).
-- 3. Habilitar Row Level Security (RLS) nas entidades de base.
-- 4. Definir a função e os triggers automáticos de atualização de timestamp (updated_at).
-- ==============================================================================

-- 1. Extensão para identificadores UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabela de Empresas (Tenant Raiz)
CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Tabela de Perfis de Usuário (Vínculo com Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE RESTRICT,
  full_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Habilitação de Row Level Security (RLS)
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 5. Função Genérica para Atualização de Timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- 6. Triggers de Atualização Automática
DROP TRIGGER IF EXISTS companies_updated_at ON public.companies;
CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
