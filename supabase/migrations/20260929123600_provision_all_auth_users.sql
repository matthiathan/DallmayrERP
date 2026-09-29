-- Provision every Supabase Auth identity into the application access table,
-- regardless of email domain. New accounts remain inactive until an
-- administrator explicitly grants DallmayrERP access.

create or replace function public.provision_auth_user_for_app_access()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.email is null then
    return new;
  end if;

  insert into public.users (
    email,
    auth_user_id,
    is_active,
    account_scope,
    access_note,
    access_updated_at
  )
  values (
    lower(trim(new.email)),
    new.id,
    false,
    'dallmayr',
    'Awaiting administrator activation',
    now()
  )
  on conflict (email) do update
    set auth_user_id = excluded.auth_user_id,
        updated_at = now();

  return new;
end;
$function$;

drop trigger if exists provision_auth_user_for_app_access on auth.users;
create trigger provision_auth_user_for_app_access
after insert on auth.users
for each row
execute function public.provision_auth_user_for_app_access();

-- Backfill Auth accounts that pre-date the trigger. Existing app access is
-- preserved; only the Auth linkage is repaired when an email already exists.
insert into public.users (
  email,
  auth_user_id,
  is_active,
  account_scope,
  access_note,
  access_updated_at
)
select
  lower(trim(au.email)),
  au.id,
  false,
  'dallmayr',
  'Awaiting administrator activation',
  now()
from auth.users au
where au.email is not null
on conflict (email) do update
  set auth_user_id = excluded.auth_user_id,
      updated_at = now();
