-- Execute uma vez no SQL Editor de um projeto Supabase dedicado.
begin;
create table if not exists public.driver_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  data jsonb,
  previous_data jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint driver_data_size check (data is null or octet_length(data::text) <= 1500000)
);
alter table public.driver_accounts enable row level security;
revoke all on public.driver_accounts from public, anon, authenticated;
grant select, insert, update, delete on public.driver_accounts to service_role;
-- Sem políticas públicas: apenas o backend, que valida usuário e pagamento, acessa.
create table if not exists public.driver_rate_limits (
  key text primary key,
  started_at timestamptz not null,
  attempts integer not null
);
alter table public.driver_rate_limits enable row level security;
revoke all on public.driver_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.driver_rate_limits to service_role;
create or replace function public.driver_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  insert into public.driver_rate_limits as r (key, started_at, attempts)
  values (p_key, now(), 1)
  on conflict (key) do update set
    started_at = case when r.started_at < now() - make_interval(secs => p_seconds) then now() else r.started_at end,
    attempts = case when r.started_at < now() - make_interval(secs => p_seconds) then 1 else r.attempts + 1 end
  returning attempts into n;
  -- Mantém somente janelas recentes; nunca guarda IP ou e-mail em claro.
  delete from public.driver_rate_limits where started_at < now() - interval '1 day';
  return n <= p_limit;
end;
$$;
revoke all on function public.driver_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.driver_rate_limit(text, integer, integer) to service_role;
commit;
