-- =====================================================================
-- CAPITALEX DRIVER — BANCO DE DADOS SUPABASE (VERSÃO ASSINATURA MANUAL)
-- Execute no SQL Editor do seu projeto Supabase dedicado.
-- =====================================================================

begin;

-- 1. Tabela principal dos motoristas
create table if not exists public.driver_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  customer_email text,
  subscription_status text not null default 'inactive', -- 'active' ou 'inactive'
  subscription_expires_at timestamptz,
  is_admin boolean not null default false,
  data jsonb,
  previous_data jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint driver_data_size check (data is null or octet_length(data::text) <= 1500000)
);

-- Adicionar colunas se a tabela já existia antes
alter table public.driver_accounts add column if not exists customer_email text;
alter table public.driver_accounts add column if not exists subscription_status text not null default 'inactive';
alter table public.driver_accounts add column if not exists subscription_expires_at timestamptz;
alter table public.driver_accounts add column if not exists is_admin boolean not null default false;

-- Índices de performance
create index if not exists idx_driver_accounts_email on public.driver_accounts(customer_email);

-- Segurança: Somente as funções da Netlify via service_role acessam
alter table public.driver_accounts enable row level security;
revoke all on public.driver_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.driver_accounts to service_role;

-- 2. Tabela de proteção contra força bruta
create table if not exists public.driver_rate_limits (
  key text primary key,
  started_at timestamptz not null default now(),
  count int not null default 1
);
alter table public.driver_rate_limits enable row level security;
revoke all on public.driver_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.driver_rate_limits to service_role;

-- 3. Função RPC para rate limit atômico
create or replace function public.driver_rate_limit(p_key text, p_limit int, p_seconds int)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count int;
  v_started timestamptz;
begin
  select started_at, count into v_started, v_count from public.driver_rate_limits where key = p_key for update;
  if not found then
    insert into public.driver_rate_limits(key, started_at, count) values(p_key, now(), 1);
    return true;
  end if;
  if now() - v_started > make_interval(secs => p_seconds) then
    update public.driver_rate_limits set started_at = now(), count = 1 where key = p_key;
    return true;
  end if;
  if v_count >= p_limit then
    return false;
  end if;
  update public.driver_rate_limits set count = count + 1 where key = p_key;
  return true;
end;
$$;

-- 4. Definir o Flavio Rodrigues como Administrador Mestre
update public.driver_accounts 
set is_admin = true, subscription_status = 'active'
where user_id in (
  select id from auth.users where email = 'flaviofilhors15@gmail.com'
);

commit;
