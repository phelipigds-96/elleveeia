-- Adicionando constraints de unicidade para permitir UPSERT e garantir idempotência
ALTER TABLE public.products ADD CONSTRAINT products_company_sku_key UNIQUE (company_id, sku);
ALTER TABLE public.product_prices ADD CONSTRAINT product_prices_company_product_type_key UNIQUE (company_id, product_id, price_type);
