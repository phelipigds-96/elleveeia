-- Etapa 3D: Pacotes Adicionais (1k / 5k / 10k / 15k), Excedente Avulso e Prévia de Fatura Extra
-- Migration 100% aditiva e idempotente.
-- Regra de contagem justa no código: apenas mensagens enviadas (sender_type IN ('agent', 'human')).

-- 1. Tarifas configuráveis por plano (blocos adicionais e avulso por mensagem)
ALTER TABLE public.platform_plans
  ADD COLUMN IF NOT EXISTS addon_package_unit_price_brl NUMERIC(10, 4) NOT NULL DEFAULT 0.0400 CHECK (addon_package_unit_price_brl >= 0),
  ADD COLUMN IF NOT EXISTS overage_unit_price_brl NUMERIC(10, 4) NOT NULL DEFAULT 0.0700 CHECK (overage_unit_price_brl >= 0);

-- Plano Trial não gera cobrança automática de excedente por padrão
UPDATE public.platform_plans
SET
  addon_package_unit_price_brl = 0,
  overage_unit_price_brl = 0
WHERE key = 'trial';

-- 2. Tarifas customizadas opcionais por empresa (NULL = herda a tarifa do plano)
ALTER TABLE public.company_limits
  ADD COLUMN IF NOT EXISTS custom_addon_unit_price_brl NUMERIC(10, 4) CHECK (custom_addon_unit_price_brl IS NULL OR custom_addon_unit_price_brl >= 0),
  ADD COLUMN IF NOT EXISTS custom_overage_unit_price_brl NUMERIC(10, 4) CHECK (custom_overage_unit_price_brl IS NULL OR custom_overage_unit_price_brl >= 0);

-- 3. Registro auditável de pacotes extras contratados na competência (YYYY-MM)
CREATE TABLE IF NOT EXISTS public.company_message_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  billing_month TEXT NOT NULL CHECK (billing_month ~ '^\d{4}-\d{2}$'),
  package_messages INTEGER NOT NULL CHECK (package_messages IN (1000, 5000, 10000, 15000)),
  unit_price_brl NUMERIC(10, 4) NOT NULL CHECK (unit_price_brl >= 0),
  total_price_brl NUMERIC(10, 2) NOT NULL CHECK (total_price_brl >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_message_addons_company_month
  ON public.company_message_addons (company_id, billing_month)
  WHERE status = 'active';

ALTER TABLE public.company_message_addons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins manage company message addons" ON public.company_message_addons;
CREATE POLICY "Platform admins manage company message addons"
  ON public.company_message_addons
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

COMMENT ON TABLE public.company_message_addons IS
  'Pacotes adicionais de mensagens (1.000, 5.000, 10.000 ou 15.000) vinculados à competência mensal (YYYY-MM) para cálculo de cota efetiva e fatura extra.';
