-- Keep the repository SQL source of truth aligned with the deployed telemetry API.
-- This function already exists in the DallmayrERP Supabase project; the migration
-- records its deployed definition so client RPC usage remains reproducible.

create or replace function public.set_telemetry_device_mode(
  p_device_code text,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text := public.current_app_role();
  v_policy_id uuid;
  v_device_id uuid;
  v_normalized_mode text := lower(trim(coalesce(p_mode, '')));
begin
  if v_role not in ('admin', 'operations') then
    raise exception 'Only admin or operations may change telemetry mode' using errcode = '42501';
  end if;

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code);

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;

  if v_normalized_mode in ('inherit', 'default', '') then
    update public.telemetry_devices
      set telemetry_policy_id = null, updated_at = now()
    where id = v_device_id;
  else
    if v_normalized_mode not in ('live', 'daily', 'monthly') then
      raise exception 'Mode must be live, daily, monthly, or inherit' using errcode = '22023';
    end if;

    select id into v_policy_id
    from public.telemetry_policies
    where policy_code = v_normalized_mode;

    if v_policy_id is null then
      raise exception 'Telemetry policy not found' using errcode = '22023';
    end if;

    update public.telemetry_devices
      set telemetry_policy_id = v_policy_id, updated_at = now()
    where id = v_device_id;
  end if;

  return public.get_effective_telemetry_policy(v_device_id);
end;
$function$;
