-- ==============================================================================
-- Migration: 20261031_product_prices_tiers_unique.sql
-- Objetivo: Permitir múltiplas faixas de quantidade para a mesma modalidade de preço
-- (ex: Atacado lote 10, Atacado lote 50) para um mesmo produto e empresa.
-- ==============================================================================

-- 1. Normalizar registros existentes que possuam min_quantity nulo para o padrão 1 (varejo base)
UPDATE public.product_prices 
SET min_quantity = 1 
WHERE min_quantity IS NULL;

-- 2. Garantir DEFAULT 1 e NOT NULL para min_quantity, evitando ambiguidades com NULLs na chave única
ALTER TABLE public.product_prices 
ALTER COLUMN min_quantity SET DEFAULT 1;

ALTER TABLE public.product_prices 
ALTER COLUMN min_quantity SET NOT NULL;

-- 3. Remover a constraint legada que limitava a 1 regra por modalidade (retail/wholesale)
ALTER TABLE public.product_prices 
DROP CONSTRAINT IF EXISTS product_prices_company_product_type_key;

-- 4. Adicionar a nova constraint que inclui min_quantity na chave de unicidade
ALTER TABLE public.product_prices 
ADD CONSTRAINT product_prices_company_product_type_min_qty_key 
UNIQUE (company_id, product_id, price_type, min_quantity);
