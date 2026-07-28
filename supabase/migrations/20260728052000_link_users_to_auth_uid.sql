-- Link internal ERP users to Supabase Auth identities by immutable UUID.
-- Email remains contact/display data and is no longer used for authorization.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

alter table public.users
  add column if not exists auth_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_auth_user_id_fkey'
  ) then
    alter table public.users
      add constraint users_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists users_auth_user_id_key
  on public.users (auth_user_id)
  where auth_user_id is not null;

create or replace function private.assign_auth_identity_to_app_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.auth_user_id is null
     and nullif(trim(coalesce(new.email, '')), '') is not null then
    select au.id
      into new.auth_user_id
    from auth.users au
    where lower(au.email) = lower(new.email)
    order by au.created_at asc
    limit 1;
  end if;

  return new;
end;
$$;

create or replace function private.link_app_user_after_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if nullif(trim(coalesce(new.email, '')), '') is not null then
    update public.users u
    set auth_user_id = new.id,
        updated_at = now()
    where u.auth_user_id is null
      and lower(u.email) = lower(new.email);
  end if;

  return new;
end;
$$;

revoke all on function private.assign_auth_identity_to_app_user() from public, anon, authenticated;
revoke all on function private.link_app_user_after_auth_signup() from public, anon, authenticated;

drop trigger if exists users_assign_auth_identity on public.users;
create trigger users_assign_auth_identity
before insert or update of email on public.users
for each row
execute function private.assign_auth_identity_to_app_user();

drop trigger if exists auth_users_link_app_identity on auth.users;
create trigger auth_users_link_app_identity
after insert or update of email on auth.users
for each row
execute function private.link_app_user_after_auth_signup();

update public.users u
set auth_user_id = au.id,
    updated_at = now()
from auth.users au
where u.auth_user_id is null
  and lower(u.email) = lower(au.email);

do $$
begin
  if exists (
    select 1
    from public.users u
    join auth.users au on lower(au.email) = lower(u.email)
    where u.auth_user_id is distinct from au.id
  ) then
    raise exception 'Could not link every matching ERP user to its Supabase Auth identity';
  end if;
end
$$;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from public.users u
  where u.auth_user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.role
  from public.users u
  join public.user_details d on d.user_id = u.id
  where u.auth_user_id = (select auth.uid())
    and u.is_active = true
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public, anon;
revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;

comment on column public.users.auth_user_id
  is 'Stable Supabase Auth identity linked to the internal ERP user record.';

comment on function public.current_app_user_id()
  is 'Returns the internal ERP user ID linked to the authenticated Supabase user via auth.uid().';

comment on function public.current_app_role()
  is 'Returns the active ERP role linked to the authenticated Supabase user via auth.uid().';
