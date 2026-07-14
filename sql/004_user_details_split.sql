-- DallmayrERP user invite/access split
-- public.users remains the access/invite table.
-- public.user_details stores personal information completed by users after first login.

create table if not exists public.user_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  first_name text,
  last_name text,
  full_name text generated always as (trim(both ' ' from (coalesce(first_name, '') || ' ' || coalesce(last_name, '')))) stored,
  phone_number text,
  birthday date,
  emergency_contact_name text,
  emergency_contact_phone text,
  profile_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_details enable row level security;

comment on table public.user_details is 'Personal profile details completed by staff after first login. Roles and access remain controlled in public.users.';
comment on column public.user_details.user_id is 'References the access/invite record in public.users.';

insert into public.user_details (
  user_id,
  first_name,
  last_name,
  phone_number,
  birthday,
  profile_completed_at,
  created_at,
  updated_at
)
select
  u.id,
  nullif(trim(coalesce(u.first_name, '')), ''),
  nullif(trim(coalesce(u.last_name, '')), ''),
  nullif(trim(coalesce(u.phone_number, '')), ''),
  u.birthday,
  u.profile_completed_at,
  now(),
  now()
from public.users u
where not exists (
  select 1 from public.user_details d where d.user_id = u.id
)
and (
  nullif(trim(coalesce(u.first_name, '')), '') is not null
  or nullif(trim(coalesce(u.last_name, '')), '') is not null
  or nullif(trim(coalesce(u.phone_number, '')), '') is not null
  or u.birthday is not null
);

update public.users u
set onboarding_required = false,
    profile_completed_at = coalesce(u.profile_completed_at, d.profile_completed_at, now())
from public.user_details d
where d.user_id = u.id
  and nullif(trim(coalesce(d.first_name, '')), '') is not null
  and nullif(trim(coalesce(d.last_name, '')), '') is not null
  and nullif(trim(coalesce(d.phone_number, '')), '') is not null;

-- Public users remains the access table. Make personal fields optional and no longer required by app code.
alter table public.users
  alter column first_name drop not null,
  alter column last_name drop not null;

-- Policies: admin policy hardening will be handled later. For now, keep authenticated app access working.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_details' and policyname = 'authenticated_select'
  ) then
    create policy authenticated_select on public.user_details for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_details' and policyname = 'authenticated_insert'
  ) then
    create policy authenticated_insert on public.user_details for insert to authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'user_details' and policyname = 'authenticated_update'
  ) then
    create policy authenticated_update on public.user_details for update to authenticated using (true) with check (true);
  end if;
end $$;
