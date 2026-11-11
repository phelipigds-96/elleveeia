-- Migration: PWA Web Push Subscriptions (multi-tenant + per-user device tokens)
-- Permite que operadores ativem/silenciem notificações push no smartphone e desktop
-- respeitando isolamento estrito por empresa (company_id) e usuário (user_id).

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  device_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um mesmo aparelho/navegador (endpoint) pertence a um registro único por usuário
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_subscriptions_user_endpoint
  ON public.push_subscriptions (user_id, endpoint);

-- Lookup rápido no dispatch de webhooks por empresa ativa
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_company_active
  ON public.push_subscriptions (company_id, is_active)
  WHERE is_active = true;

-- Trigger de atualização de timestamp
DROP TRIGGER IF EXISTS trg_push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Row Level Security (RLS)
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can manage own push subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND company_id IN (
      SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND company_id IN (
      SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Service role manages all push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Service role manages all push_subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
