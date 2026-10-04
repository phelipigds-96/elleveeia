-- Migration: 20261004_quotes_engine.sql
-- Fase 9: Motor de Orçamentos e Regras Comerciais

CREATE TABLE IF NOT EXISTS public.quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    total NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.quote_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    subtotal NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_quotes_company_id ON public.quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_id ON public.quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON public.quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_company_id ON public.quote_items(company_id);
CREATE INDEX IF NOT EXISTS idx_quote_items_product_id ON public.quote_items(product_id);

-- Habilitar RLS
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS (Isolamento por company_id)
CREATE POLICY "Usuários podem ver orçamentos de suas empresas"
    ON public.quotes FOR SELECT
    USING (company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
    ));

CREATE POLICY "Usuários podem inserir orçamentos em suas empresas"
    ON public.quotes FOR INSERT
    WITH CHECK (company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
    ));

CREATE POLICY "Usuários podem atualizar orçamentos de suas empresas"
    ON public.quotes FOR UPDATE
    USING (company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
    ));

CREATE POLICY "Usuários podem ver itens de orçamentos de suas empresas"
    ON public.quote_items FOR SELECT
    USING (company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
    ));

CREATE POLICY "Usuários podem inserir itens de orçamentos em suas empresas"
    ON public.quote_items FOR INSERT
    WITH CHECK (company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
    ));

CREATE POLICY "Usuários podem atualizar itens de orçamentos de suas empresas"
    ON public.quote_items FOR UPDATE
    USING (company_id IN (
        SELECT company_id FROM public.profiles WHERE id = auth.uid()
    ));

-- Trigger para updated_at na tabela quotes
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_quotes_updated_at
BEFORE UPDATE ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
