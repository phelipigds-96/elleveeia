-- RPC para criar empresa e perfil associado no cadastro
create or replace function public.create_tenant(full_name text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_company_id uuid;
  company_name text;
  slug_val text;
  user_email text;
begin
  user_email := auth.jwt() ->> 'email';
  company_name := 'Empresa de ' || split_part(full_name, ' ', 1);
  -- Gera um slug unico baseado no nome e timestamp
  slug_val := lower(regexp_replace(company_name, '\W+', '-', 'g')) || '-' || extract(epoch from now())::int;

  insert into public.companies (name, slug)
  values (company_name, slug_val)
  returning id into new_company_id;

  insert into public.profiles (id, company_id, full_name, email, role)
  values (auth.uid(), new_company_id, full_name, user_email, 'admin');

  return new_company_id;
end;
$$;

-- Ajustes finos de RLS
drop policy if exists "Users can view their own company" on public.companies;
create policy "Users can view their own company" 
  on public.companies for select 
  using ( id in (select company_id from public.profiles where id = auth.uid()) );

drop policy if exists "Users can update their own company" on public.companies;
create policy "Users can update their own company" 
  on public.companies for update 
  using ( id in (select company_id from public.profiles where id = auth.uid() and role = 'admin') );

drop policy if exists "Users can view profiles in their company" on public.profiles;
create policy "Users can view profiles in their company" 
  on public.profiles for select 
  using ( company_id in (select company_id from public.profiles where id = auth.uid()) );

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" 
  on public.profiles for update 
  using ( id = auth.uid() );
