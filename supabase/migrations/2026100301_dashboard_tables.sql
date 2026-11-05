-- Create customers table
create table public.customers (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create conversations table
create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel text not null default 'whatsapp',
  status text not null default 'open', -- open, closed, human
  assigned_to uuid references public.profiles(id) on delete set null,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_message_at timestamp with time zone default timezone('utc'::text, now()) not null,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS setup for customers
alter table public.customers enable row level security;

create policy "Users can view customers of their company" 
  on public.customers for select 
  using ( company_id in (select company_id from public.profiles where id = auth.uid()) );

create policy "Users can insert customers to their company" 
  on public.customers for insert 
  with check ( company_id in (select company_id from public.profiles where id = auth.uid()) );

create policy "Users can update customers of their company" 
  on public.customers for update 
  using ( company_id in (select company_id from public.profiles where id = auth.uid()) );

-- RLS setup for conversations
alter table public.conversations enable row level security;

create policy "Users can view conversations of their company" 
  on public.conversations for select 
  using ( company_id in (select company_id from public.profiles where id = auth.uid()) );

create policy "Users can insert conversations to their company" 
  on public.conversations for insert 
  with check ( company_id in (select company_id from public.profiles where id = auth.uid()) );

create policy "Users can update conversations of their company" 
  on public.conversations for update 
  using ( company_id in (select company_id from public.profiles where id = auth.uid()) );

-- Triggers for updated_at
create trigger customers_updated_at
  before update on public.customers
  for each row execute procedure public.handle_updated_at();

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute procedure public.handle_updated_at();

-- RPC for securely fetching dashboard metrics based on user session
create or replace function public.get_dashboard_metrics(p_days int)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_company_id uuid;
  v_start_date timestamp;
  v_total_conv int;
  v_open_conv int;
  v_human_conv int;
  v_unique_customers int;
begin
  -- Resolve user company safely
  select company_id into v_company_id from public.profiles where id = auth.uid() limit 1;

  if v_company_id is null then
    return json_build_object('error', 'Usuário não vinculado a uma empresa');
  end if;

  if p_days = 0 then
    v_start_date := date_trunc('day', now()); -- Hoje
  else
    v_start_date := now() - (p_days || ' days')::interval;
  end if;

  select count(*) into v_total_conv from public.conversations 
  where company_id = v_company_id and created_at >= v_start_date;

  select count(*) into v_open_conv from public.conversations 
  where company_id = v_company_id and status = 'open' and created_at >= v_start_date;

  select count(*) into v_human_conv from public.conversations 
  where company_id = v_company_id and status = 'human' and created_at >= v_start_date;

  select count(distinct customer_id) into v_unique_customers from public.conversations 
  where company_id = v_company_id and created_at >= v_start_date and customer_id is not null;

  return json_build_object(
    'total_conversations', v_total_conv,
    'open_conversations', v_open_conv,
    'transfers', v_human_conv,
    'unique_customers', coalesce(v_unique_customers, 0)
  );
end;
$$;
