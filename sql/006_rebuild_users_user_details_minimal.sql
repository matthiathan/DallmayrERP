-- Rebuild DallmayrERP staff model
-- users = authentication-linked email identity only
-- user_details = staff profile, role and branch

create temp table if not exists staff_rebuild_backup as
select
  lower(trim(u.email)) as email,
  nullif(trim(coalesce(d.first_name, u.first_name, '')), '') as first_name,
  nullif(trim(coalesce(d.last_name, u.last_name, '')), '') as last_name,
  nullif(trim(coalesce(d.phone_number, u.phone_number, '')), '') as phone_number,
  coalesce(d.birthday, u.birthday) as birthday,
  coalesce(d.role, u.role, 'operations') as role,
  coalesce(d.branch, u.branch, 'national') as branch,
  d.emergency_contact_name,
  d.emergency_contact_phone
from public.users u
left join public.user_details d on d.user_id = u.id
where nullif(trim(u.email), '') is not null;

-- Drop the current staff tables and dependent foreign keys/policies.
drop table if exists public.user_details cascade;
drop table if exists public.users cascade;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_email_lowercase_check check (email = lower(email)),
  constraint users_email_format_check check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')
);

create table public.user_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone_number text,
  birthday date,
  role text not null check (role in ('admin', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse_staff', 'technician', 'road_technician')),
  branch text not null check (branch in ('jhb', 'cpt', 'kzn', 'national')),
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_details_user_id_idx on public.user_details(user_id);
create index user_details_role_idx on public.user_details(role);
create index user_details_branch_idx on public.user_details(branch);

insert into public.users (email)
select distinct email
from staff_rebuild_backup
where email is not null
on conflict (email) do nothing;

insert into public.user_details (
  user_id,
  first_name,
  last_name,
  phone_number,
  birthday,
  role,
  branch,
  emergency_contact_name,
  emergency_contact_phone
)
select
  u.id,
  b.first_name,
  b.last_name,
  b.phone_number,
  b.birthday,
  case when b.role in ('admin', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse_staff', 'technician', 'road_technician') then b.role else 'operations' end,
  case when b.branch in ('jhb', 'cpt', 'kzn', 'national') then b.branch else 'national' end,
  b.emergency_contact_name,
  b.emergency_contact_phone
from staff_rebuild_backup b
join public.users u on u.email = b.email
on conflict (user_id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  phone_number = excluded.phone_number,
  birthday = excluded.birthday,
  role = excluded.role,
  branch = excluded.branch,
  emergency_contact_name = excluded.emergency_contact_name,
  emergency_contact_phone = excluded.emergency_contact_phone,
  updated_at = now();

alter table public.users enable row level security;
alter table public.user_details enable row level security;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.users
  where lower(email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.role
  from public.users u
  join public.user_details d on d.user_id = u.id
  where lower(u.email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public;
revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;

create policy users_select_own_or_admin
on public.users
for select
to authenticated
using (id = public.current_app_user_id() or public.current_app_role() = 'admin');

create policy users_insert_admin
on public.users
for insert
to authenticated
with check (public.current_app_role() = 'admin');

create policy users_update_admin
on public.users
for update
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create policy user_details_select_own_or_admin
on public.user_details
for select
to authenticated
using (user_id = public.current_app_user_id() or public.current_app_role() = 'admin');

create policy user_details_insert_own_or_admin
on public.user_details
for insert
to authenticated
with check (user_id = public.current_app_user_id() or public.current_app_role() = 'admin');

create policy user_details_update_own_or_admin
on public.user_details
for update
to authenticated
using (user_id = public.current_app_user_id() or public.current_app_role() = 'admin')
with check (user_id = public.current_app_user_id() or public.current_app_role() = 'admin');

comment on table public.users is 'DallmayrERP access identity. Email must match the Supabase Auth email.';
comment on table public.user_details is 'DallmayrERP staff details, role and branch linked to public.users.';
