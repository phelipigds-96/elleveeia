-- ==============================================================================
-- Script: bootstrap_superadmin.sql
-- Procedimento Controlado para Bootstrap do Primeiro Superadministrador
-- ==============================================================================

-- INSTRUÇÕES DE SEGURANÇA:
-- 1. Este script NUNCA deve ser executado via cliente web ou endpoint público.
-- 2. O usuário DEVE ser previamente cadastrado no Supabase Auth (via Dashboard do Supabase ou CLI).
-- 3. Obtenha o UUID do usuário criado na tabela `auth.users`.
-- 4. Execute este script no SQL Editor do Supabase com perfil postgres ou Service Role.

-- 1. Atualizar a trigger de proteção para reconhecer tanto o JWT service_role
-- quanto o superusuário postgres / supabase_admin do SQL Editor
CREATE OR REPLACE FUNCTION public.protect_platform_admin_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Permite modificações via Service Role (PostgREST) ou superusuário de banco (SQL Editor)
  IF auth.role() = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'Operação negada: gerenciamento de operadores da plataforma só é permitido via serviço administrativo de backend.';
END;
$$;

-- 2. Procedimento de Bootstrap do Superadministrador
DO $$
DECLARE
  v_user_email TEXT := 'proprietario@elleveeia.com.br'; -- Substitua pelo seu e-mail cadastrado no Auth
  v_user_name TEXT := 'Proprietário Ellevee IA';
  v_user_id UUID;
BEGIN
  -- Localizar o UUID do usuário no Supabase Auth
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_user_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário % não encontrado no Supabase Auth. Crie o usuário antes de promovê-lo a Superadministrador.', v_user_email;
  END IF;

  -- Inserir ou atualizar na tabela platform_admins
  INSERT INTO public.platform_admins (
    id,
    email,
    full_name,
    role,
    active
  )
  VALUES (
    v_user_id,
    v_user_email,
    v_user_name,
    'superadmin',
    true
  )
  ON CONFLICT (id) DO UPDATE SET
    role = 'superadmin',
    active = true,
    updated_at = now();

  RAISE NOTICE 'Superadministrador % (UUID: %) provisionado com sucesso.', v_user_email, v_user_id;
END;
$$;
