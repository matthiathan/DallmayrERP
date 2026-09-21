-- Production-readiness hardening: a valid Supabase Auth identity is not, by
-- itself, application authorization. All app identity resolution must stop as
-- soon as the linked DallmayrERP user is suspended.

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
    and u.is_active = true
  limit 1;
$$;

create or replace function public.claim_current_app_user()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_app_user_id uuid;
begin
  if v_auth_user_id is null or v_email = '' then
    raise exception 'An authenticated Supabase user is required'
      using errcode = '42501';
  end if;

  select u.id
    into v_app_user_id
  from public.users u
  where u.auth_user_id = v_auth_user_id
    and u.is_active = true
  limit 1;

  if v_app_user_id is not null then
    return v_app_user_id;
  end if;

  update public.users u
  set auth_user_id = v_auth_user_id,
      updated_at = now()
  where u.auth_user_id is null
    and lower(u.email) = v_email
    and u.is_active = true
  returning u.id into v_app_user_id;

  return v_app_user_id;
end;
$$;

-- Preserve the existing execution surface exactly: these helpers are callable
-- by authenticated application sessions and the service role, never anon/public.
revoke all on function public.current_app_user_id() from public, anon;
revoke all on function public.claim_current_app_user() from public, anon;
grant execute on function public.current_app_user_id() to authenticated, service_role;
grant execute on function public.claim_current_app_user() to authenticated, service_role;

comment on function public.current_app_user_id() is
  'Returns the active DallmayrERP application user linked to auth.uid(); suspended users resolve to null.';

comment on function public.claim_current_app_user() is
  'Links the authenticated Supabase identity to an existing active DallmayrERP user with the same email; suspended users cannot be claimed.';
