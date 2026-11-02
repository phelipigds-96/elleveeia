-- ==============================================================================
-- Script: bootstrap_superadmin.sql
-- Procedimento Controlado para Bootstrap do Primeiro Superadministrador
-- ==============================================================================

-- INSTRUÇÕES DE SEGURANÇA:
-- 1. Este script NUNCA deve ser executado via cliente web ou endpoint público.
-- 2. O usuário DEVE ser previamente cadastrado no Supabase Auth (via Dashboard do Supabase ou CLI).
-- 3. Obtenha o UUID do usuário criado na tabela `auth.users`.
-- 4. Execute este script conectado com perfil com privilégios de superusuário do banco (postgres) ou Service Role.

DO $$
DECLARE
  v_user_email TEXT := 'proprietario@elleveeia.com.br'; -- Substitua pelo e-mail do proprietário
  v_user_name TEXT := 'Proprietário Ellevee IA';
  v_user_id UUID;
BEGIN
  -- 1. Localizar o UUID do usuário no Supabase Auth
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_user_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário % não encontrado no Supabase Auth. Crie o usuário antes de promovê-lo a Superadministrador.', v_user_email;
  END IF;

  -- 2. Inserir ou atualizar na tabela platform_admins
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
