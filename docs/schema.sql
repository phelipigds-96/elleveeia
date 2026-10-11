-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create companies table (Tenant)
create table public.companies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create profiles table (Linked to Auth users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete restrict,
  full_name text,
  email text,
  role text default 'user',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.companies enable row level security;
alter table public.profiles enable row level security;

-- Basic Policies for Multi-Tenancy (Requires proper auth.uid() checks)

-- Companies policy
create policy "Users can view their own company" 
  on public.companies for select 
  using ( id in (select company_id from public.profiles where id = auth.uid()) );

-- Profiles policy
create policy "Users can view profiles in their company" 
  on public.profiles for select 
  using ( company_id in (select company_id from public.profiles where id = auth.uid()) );

create policy "Users can update their own profile" 
  on public.profiles for update 
  using ( id = auth.uid() );

-- Triggers for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger companies_updated_at
  before update on public.companies
  for each row execute procedure public.handle_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.handle_updated_at();

-- Create message_outbox table (Autonomous outbox)
create table if not exists public.message_outbox (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  idempotency_key text unique not null,
  channel text not null default 'whatsapp',
  recipient text not null,
  payload jsonb not null,
  status text not null default 'pending', -- 'pending', 'sent', 'failed', 'suppressed'
  attempts integer not null default 0,
  last_error text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  sent_at timestamp with time zone
);

alter table public.message_outbox enable row level security;