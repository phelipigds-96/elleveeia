-- ==============================================================================
-- FASE 8: BUSINESS DATA + CATÁLOGO DE PRODUTOS
-- ==============================================================================

-- 1. MARCAS
CREATE TABLE IF NOT EXISTS public.product_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, normalized_name)
);

-- 2. CATEGORIAS
CREATE TABLE IF NOT EXISTS public.product_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  parent_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, normalized_name)
);

-- 3. PRODUTOS
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  external_id TEXT,
  sku TEXT,
  barcode TEXT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  brand_id UUID REFERENCES public.product_brands(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.product_categories(id) ON DELETE SET NULL,
  unit TEXT,
  package_description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. PREÇOS
CREATE TABLE IF NOT EXISTS public.product_prices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_type TEXT NOT NULL, -- retail, wholesale, etc
  price NUMERIC(12,2) NOT NULL,
  min_quantity NUMERIC(12,3),
  max_quantity NUMERIC(12,3),
  active BOOLEAN NOT NULL DEFAULT true,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. ESTOQUE (INVENTORY)
CREATE TABLE IF NOT EXISTS public.product_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  location_name TEXT,
  quantity NUMERIC(12,3),
  available_quantity NUMERIC(12,3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- ÍNDICES (Otimização de busca no catálogo)
CREATE INDEX IF NOT EXISTS idx_products_company_id ON public.products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku);
CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON public.products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_prices_product_id ON public.product_prices(product_id);

-- RLS
ALTER TABLE public.product_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory ENABLE ROW LEVEL SECURITY;

-- POLICIES: Somente leitura e escrita restritas à empresa do usuário autenticado
DO $$ BEGIN
  CREATE POLICY "Users view own company product_brands" ON public.product_brands FOR SELECT USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
  CREATE POLICY "Users edit own company product_brands" ON public.product_brands FOR ALL USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );

  CREATE POLICY "Users view own company product_categories" ON public.product_categories FOR SELECT USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
  CREATE POLICY "Users edit own company product_categories" ON public.product_categories FOR ALL USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );

  CREATE POLICY "Users view own company products" ON public.products FOR SELECT USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
  CREATE POLICY "Users edit own company products" ON public.products FOR ALL USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );

  CREATE POLICY "Users view own company product_prices" ON public.product_prices FOR SELECT USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
  CREATE POLICY "Users edit own company product_prices" ON public.product_prices FOR ALL USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );

  CREATE POLICY "Users view own company product_inventory" ON public.product_inventory FOR SELECT USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
  CREATE POLICY "Users edit own company product_inventory" ON public.product_inventory FOR ALL USING ( company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()) );
EXCEPTION WHEN duplicate_object THEN null; END $$;
