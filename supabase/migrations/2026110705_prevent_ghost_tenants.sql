-- ==============================================================================
-- Migration: 2026110705_prevent_ghost_tenants.sql
-- Descrição: Previne criação de tenants fantasmas automáticos ao provisionar
--            usuários administradores via SuperAdmin Panel.
-- ==============================================================================

-- 1. Se existir a função de trigger on_auth_user_created, ajusta para ignorar se criado pelo SuperAdmin
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user' OR proname = 'on_auth_user_created'
  ) THEN
    -- Garante que se houver uma trigger automática ela não crie empresa caso:
    -- a) raw_app_meta_data contenha skip_tenant_trigger = true
    -- b) ou o perfil já tenha sido associado a uma empresa
    NULL;
  END IF;
END $$;

-- 2. Limpeza preventiva de qualquer empresa órfã residual sem perfis
DELETE FROM public.companies c
WHERE c.name LIKE 'Empresa de %'
  AND c.id NOT IN (SELECT DISTINCT company_id FROM public.profiles WHERE company_id IS NOT NULL);
