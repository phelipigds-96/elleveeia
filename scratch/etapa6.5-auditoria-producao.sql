-- ==============================================================================
-- ELLEVEE IA — CONSULTAS SQL DE AUDITORIA DE PRODUÇÃO (SOMENTE LEITURA)
-- Etapa 6.5: Preparação para Homologação com Dados Reais da Sumel
--
-- REGRAS E DIRETRIZES:
-- 1. Todas as consultas são estritamente SELECT (somente leitura).
-- 2. Não realizam INSERT, UPDATE, DELETE, ALTER ou DROP.
-- 3. Não expõem dados pessoais (clientes, telefones, conversas).
-- 4. O filtro company_id deve ser preenchido com o UUID da Sumel identificado na Query 1.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. IDENTIFICAÇÃO DAS EMPRESAS CADASTRADAS (SEM LIMIT ARBITRÁRIO)
-- Objetivo: Identificar o UUID exato da empresa Sumel e conferir todos os tenants.
-- ------------------------------------------------------------------------------
SELECT 
    id AS company_id, 
    name AS company_name, 
    slug, 
    created_at
FROM public.companies
ORDER BY created_at ASC;


-- ------------------------------------------------------------------------------
-- 2. CONTAGEM DE PRODUTOS ATIVOS E TOTAIS POR EMPRESA
-- Objetivo: Mapear o tamanho do catálogo por tenant e verificar o volume ativo.
-- ------------------------------------------------------------------------------
SELECT 
    c.id AS company_id,
    c.name AS company_name,
    COUNT(p.id) AS total_produtos,
    COUNT(p.id) FILTER (WHERE p.active = true) AS produtos_ativos,
    COUNT(p.id) FILTER (WHERE p.active = false) AS produtos_inativos
FROM public.companies c
LEFT JOIN public.products p ON p.company_id = c.id
GROUP BY c.id, c.name
ORDER BY produtos_ativos DESC;


-- ------------------------------------------------------------------------------
-- 3. DETECÇÃO DE REGRAS DE PREÇO DUPLICADAS / CONCORRENTES
-- Objetivo: Identificar produtos que possuem mais de um preço ativo para a mesma
-- modalidade e mesma faixa de quantidade mínima.
-- Impacto comercial: O motor da Ellevee IA detecta ambiguidade e bloqueia a venda
-- para impedir venda arbitrária pelo menor valor.
-- ------------------------------------------------------------------------------
SELECT 
    pp.company_id,
    c.name AS company_name,
    pp.product_id,
    p.sku,
    p.name AS product_name,
    pp.price_type,
    COALESCE(pp.min_quantity, 1) AS min_quantity,
    COUNT(*) AS total_regras_ativas,
    ARRAY_AGG(pp.price ORDER BY pp.price ASC) AS precos_concorrentes,
    ARRAY_AGG(pp.id) AS ids_regras_concorrentes
FROM public.product_prices pp
JOIN public.products p ON p.id = pp.product_id AND p.company_id = pp.company_id
JOIN public.companies c ON c.id = pp.company_id
WHERE pp.active = true
GROUP BY pp.company_id, c.name, pp.product_id, p.sku, p.name, pp.price_type, COALESCE(pp.min_quantity, 1)
HAVING COUNT(*) > 1;


-- ------------------------------------------------------------------------------
-- 4. IDENTIFICAÇÃO DE PRODUTOS ATIVOS SEM PREÇO DE VAREJO (RETAIL)
-- Objetivo: Localizar produtos ativos no catálogo que não possuem preço de varejo.
-- ------------------------------------------------------------------------------
SELECT 
    p.company_id,
    c.name AS company_name,
    p.id AS product_id,
    p.sku,
    p.name AS product_name,
    pb.name AS brand_name,
    p.unit
FROM public.products p
JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.product_brands pb ON pb.id = p.brand_id
WHERE p.active = true
  AND NOT EXISTS (
      SELECT 1 
      FROM public.product_prices pp 
      WHERE pp.company_id = p.company_id 
        AND pp.product_id = p.id 
        AND pp.active = true 
        AND pp.price_type = 'retail'
  )
ORDER BY p.name ASC;


-- ------------------------------------------------------------------------------
-- 5. IDENTIFICAÇÃO DE PRODUTOS COM SOMENTE PREÇO DE ATACADO (SEM VAREJO)
-- Objetivo: Listar produtos comercializados exclusivamente em lote fechado/atacado.
-- A Ellevee IA exigirá a quantidade mínima e não venderá unidades avulsas.
-- ------------------------------------------------------------------------------
SELECT 
    p.company_id,
    c.name AS company_name,
    p.id AS product_id,
    p.sku,
    p.name AS product_name,
    pb.name AS brand_name,
    MIN(pp.min_quantity) AS lote_minimo_atacado,
    MIN(pp.price) AS preco_atacado
FROM public.products p
JOIN public.companies c ON c.id = p.company_id
LEFT JOIN public.product_brands pb ON pb.id = p.brand_id
JOIN public.product_prices pp ON pp.product_id = p.id AND pp.company_id = p.company_id AND pp.active = true
WHERE p.active = true
  AND pp.price_type = 'wholesale'
  AND NOT EXISTS (
      SELECT 1 
      FROM public.product_prices pp_ret 
      WHERE pp_ret.company_id = p.company_id 
        AND pp_ret.product_id = p.id 
        AND pp_ret.active = true 
        AND pp_ret.price_type = 'retail'
  )
GROUP BY p.company_id, c.name, p.id, p.sku, p.name, pb.name
ORDER BY p.name ASC;


-- ------------------------------------------------------------------------------
-- 6. IDENTIFICAÇÃO DE PREÇOS COM QUANTIDADE MÍNIMA OU MÁXIMA INCONSISTENTE
-- Objetivo: Detectar inconsistências cadastrais numéricas que impeçam o cálculo.
-- ------------------------------------------------------------------------------
SELECT 
    pp.company_id,
    pp.id AS price_id,
    p.sku,
    p.name AS product_name,
    pp.price_type,
    pp.price,
    pp.min_quantity,
    pp.max_quantity,
    CASE 
        WHEN pp.min_quantity < 0 THEN 'min_quantity_negativo'
        WHEN pp.max_quantity < 0 THEN 'max_quantity_negativo'
        WHEN pp.max_quantity IS NOT NULL AND pp.min_quantity IS NOT NULL AND pp.max_quantity < pp.min_quantity THEN 'max_menor_que_min'
        WHEN pp.price <= 0 THEN 'preco_zerado_ou_negativo'
        ELSE 'outra_inconsistencia'
    END AS motivo_inconsistencia
FROM public.product_prices pp
JOIN public.products p ON p.id = pp.product_id AND p.company_id = pp.company_id
WHERE pp.active = true
  AND (
      pp.min_quantity < 0 
      OR pp.max_quantity < 0 
      OR (pp.max_quantity IS NOT NULL AND pp.min_quantity IS NOT NULL AND pp.max_quantity < pp.min_quantity)
      OR pp.price <= 0
  );


-- ------------------------------------------------------------------------------
-- 7. IDENTIFICAÇÃO DE PREÇOS COM VIGÊNCIA VENCIDA OU PERÍODO INVÁLIDO
-- Objetivo: Localizar registros com active = true mas cujo prazo de vigência
-- já expirou ou cujo valid_from é posterior a valid_until.
-- ------------------------------------------------------------------------------
SELECT 
    pp.company_id,
    pp.id AS price_id,
    p.sku,
    p.name AS product_name,
    pp.price_type,
    pp.price,
    pp.valid_from,
    pp.valid_until,
    NOW() AS current_db_time,
    CASE 
        WHEN pp.valid_until IS NOT NULL AND pp.valid_until < NOW() THEN 'vigencia_expirada'
        WHEN pp.valid_from IS NOT NULL AND pp.valid_from > NOW() THEN 'vigencia_futura'
        WHEN pp.valid_from IS NOT NULL AND pp.valid_until IS NOT NULL AND pp.valid_from > pp.valid_until THEN 'periodo_invalido_inicio_maior_fim'
        ELSE 'vigente'
    END AS status_vigencia
FROM public.product_prices pp
JOIN public.products p ON p.id = pp.product_id AND p.company_id = pp.company_id
WHERE pp.active = true
  AND (
      (pp.valid_until IS NOT NULL AND pp.valid_until < NOW())
      OR (pp.valid_from IS NOT NULL AND pp.valid_from > NOW())
      OR (pp.valid_from IS NOT NULL AND pp.valid_until IS NOT NULL AND pp.valid_from > pp.valid_until)
  )
ORDER BY pp.valid_until ASC NULLS LAST;


-- ------------------------------------------------------------------------------
-- 8. AMOSTRA DE PRODUTOS E RESPECTIVAS MODALIDADES DE PREÇO (SEM DADOS PESSOAIS)
-- Objetivo: Amostra controlada de 50 produtos com suas faixas de preço ativas
-- para cruzamento prévio com o ERP Sysmo.
-- ------------------------------------------------------------------------------
SELECT 
    p.company_id,
    p.id AS product_id,
    p.sku,
    p.name AS product_name,
    pb.name AS brand_name,
    pp.price_type,
    pp.price,
    COALESCE(pp.min_quantity, 1) AS min_quantity,
    pp.max_quantity,
    pp.active AS preco_ativo,
    pp.valid_from,
    pp.valid_until
FROM public.products p
LEFT JOIN public.product_brands pb ON pb.id = p.brand_id
JOIN public.product_prices pp ON pp.product_id = p.id AND pp.company_id = p.company_id
WHERE p.active = true
  AND pp.active = true
ORDER BY pb.name ASC NULLS LAST, p.name ASC, pp.price_type ASC, COALESCE(pp.min_quantity, 1) ASC
LIMIT 50;
