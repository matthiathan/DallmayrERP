\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;

create schema auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.users (
  id uuid primary key,
  auth_user_id uuid unique,
  email text not null unique,
  is_active boolean not null default true
);

create table public.user_details (
  user_id uuid primary key references public.users(id) on delete cascade,
  first_name text,
  last_name text
);

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public, anon, authenticated;
grant execute on function public.current_app_user_id() to authenticated;

insert into public.users (id, auth_user_id, email, is_active) values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'member-a@example.invalid', true),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'member-b@example.invalid', true),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'non-member@example.invalid', true),
  ('00000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'inactive@example.invalid', false),
  ('00000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'admin-non-member@example.invalid', true);

insert into public.user_details (user_id, first_name, last_name) values
  ('00000000-0000-0000-0000-000000000001', 'Member', 'A'),
  ('00000000-0000-0000-0000-000000000002', 'Member', 'B'),
  ('00000000-0000-0000-0000-000000000003', 'Non', 'Member'),
  ('00000000-0000-0000-0000-000000000004', 'Inactive', 'User'),
  ('00000000-0000-0000-0000-000000000005', 'Admin', 'Observer');
