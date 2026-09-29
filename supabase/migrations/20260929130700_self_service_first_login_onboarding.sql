-- Applied to the DallmayrERP Supabase project on 2026-09-29.
-- New accounts are active immediately with least-privilege access, a national
-- branch, no telemetry region, and a blank personal profile. The user must
-- complete region selection and personal details on first login.

create or replace function public.provision_auth_user_for_app_access()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_app_user_id uuid;
begin
  if new.email is null then return new; end if;

  insert into public.users(email, auth_user_id, is_active, account_scope, access_note, access_updated_at)
  values (lower(trim(new.email)), new.id, true, 'dallmayr', 'Self-service onboarding', now())
  on conflict (email) do update
    set auth_user_id = excluded.auth_user_id,
        is_active = true,
        account_scope = 'dallmayr',
        access_note = 'Self-service onboarding',
        access_updated_at = now(),
        updated_at = now()
  returning id into v_app_user_id;

  insert into public.user_details(user_id, role, branch, telemetry_region)
  values (v_app_user_id, 'client_viewer', 'national', null)
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

create or replace function public.update_my_personal_details(
  p_first_name text,
  p_last_name text,
  p_phone_number text,
  p_birthday date,
  p_emergency_contact_name text,
  p_emergency_contact_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := public.current_app_user_id();
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone_number, '')), '');
  v_emergency_name text := nullif(btrim(coalesce(p_emergency_contact_name, '')), '');
  v_emergency_phone text := nullif(btrim(coalesce(p_emergency_contact_phone, '')), '');
begin
  if v_user_id is null or not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  if v_first_name is null or v_last_name is null then
    raise exception 'First name and last name are required.' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'Phone number is required.' using errcode = '22023';
  end if;
  if p_birthday is null or p_birthday > current_date then
    raise exception 'Enter a valid birthday.' using errcode = '22023';
  end if;
  if v_emergency_name is null or v_emergency_phone is null then
    raise exception 'Emergency contact name and phone number are required.' using errcode = '22023';
  end if;

  update public.user_details
  set first_name = v_first_name,
      last_name = v_last_name,
      phone_number = v_phone,
      birthday = p_birthday,
      emergency_contact_name = v_emergency_name,
      emergency_contact_phone = v_emergency_phone,
      updated_at = now()
  where user_id = v_user_id;

  if not found then raise exception 'User profile was not found.' using errcode = '22023'; end if;

  return jsonb_build_object('user_id', v_user_id, 'profile_complete', true, 'updated_at', now());
end;
$function$;

grant execute on function public.update_my_personal_details(text,text,text,date,text,text) to authenticated;