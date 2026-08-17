\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to authenticated, anon, service_role;

create table public.users (
  id uuid primary key,
  is_active boolean not null default true
);

create table public.user_details (
  user_id uuid primary key references public.users(id) on delete cascade,
  role text not null,
  branch text not null
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  actor_role text,
  branch text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text,
  before_payload jsonb,
  after_payload jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('app.test_role', true), '');
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('app.test_user_id', true), '')::uuid;
$$;

grant execute on function public.current_app_role() to authenticated, service_role;
grant execute on function public.current_app_user_id() to authenticated, service_role;
grant select on public.user_details to authenticated;

insert into public.users(id) values
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005');

insert into public.user_details(user_id, role, branch) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'national'),
  ('00000000-0000-0000-0000-000000000002', 'operations', 'jhb'),
  ('00000000-0000-0000-0000-000000000003', 'operations', 'cpt'),
  ('00000000-0000-0000-0000-000000000004', 'operations', 'national'),
  ('00000000-0000-0000-0000-000000000005', 'sales', 'jhb');
