create or replace function public.set_telemetry_device_control(
  p_device_code text,
  p_mode text default null,
  p_transport_preference text default null,
  p_wifi_enabled boolean default null,
  p_cellular_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_device_id uuid;
  v_policy_id uuid;
  v_mode text := lower(trim(coalesce(p_mode, '')));
  v_transport text := lower(trim(coalesce(p_transport_preference, '')));
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','operations') then
    raise exception 'Only admin or operations may control telemetry devices' using errcode = '42501';
  end if;

  select id into v_device_id from public.telemetry_devices where device_code = trim(p_device_code);
  if not found then raise exception 'Telemetry device not found' using errcode = '22023'; end if;

  if p_mode is not null then
    if v_mode in ('inherit','default','') then
      update public.telemetry_devices set telemetry_policy_id = null, updated_at = now() where id = v_device_id;
    else
      if v_mode not in ('live','daily','monthly') then
        raise exception 'Mode must be live, daily, monthly, or inherit' using errcode = '22023';
      end if;
      select id into v_policy_id from public.telemetry_policies where policy_code = v_mode;
      if v_policy_id is null then raise exception 'Telemetry policy not found' using errcode = '22023'; end if;
      update public.telemetry_devices set telemetry_policy_id = v_policy_id, updated_at = now() where id = v_device_id;
    end if;
  end if;

  if p_transport_preference is not null then
    if v_transport not in ('auto','wifi','cellular') then
      raise exception 'Transport must be auto, wifi, or cellular' using errcode = '22023';
    end if;
    update public.telemetry_devices set transport_preference = v_transport, updated_at = now() where id = v_device_id;
  end if;

  if p_wifi_enabled is not null or p_cellular_enabled is not null then
    update public.telemetry_devices
    set wifi_enabled = coalesce(p_wifi_enabled, wifi_enabled),
        cellular_enabled = coalesce(p_cellular_enabled, cellular_enabled),
        updated_at = now()
    where id = v_device_id;
  end if;

  select jsonb_build_object(
    'device_code', d.device_code,
    'transport_preference', d.transport_preference,
    'wifi_enabled', d.wifi_enabled,
    'cellular_enabled', d.cellular_enabled,
    'policy', public.get_effective_telemetry_policy(d.id)
  ) into v_result
  from public.telemetry_devices d where d.id = v_device_id;

  return v_result;
end;
$$;

revoke all on function public.set_telemetry_device_control(text,text,text,boolean,boolean) from public, anon;
grant execute on function public.set_telemetry_device_control(text,text,text,boolean,boolean) to authenticated;

create or replace function public.enroll_telemetry_device(
  p_token_hash text,
  p_hardware_uid text,
  p_machine_serial text,
  p_credential_hash text,
  p_firmware text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid, '')));
  v_device_code text;
  v_device_id uuid;
  v_live_policy_id uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_serial text := lower(trim(coalesce(p_machine_serial, '')));
  v_matches integer := 0;
  v_link_status text := 'unlinked';
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Invalid ESP32 hardware UID' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_credential_hash, '')), '') is null then
    raise exception 'Credential hash is required' using errcode = '22023';
  end if;

  select * into v_token from public.telemetry_enrollment_tokens where token_hash = p_token_hash for update;
  if not found or v_token.used_at is not null or v_token.expires_at <= now() then
    raise exception 'Invalid, expired, or already-used enrollment token' using errcode = '42501';
  end if;

  if exists (select 1 from public.telemetry_devices where hardware_uid = v_hardware_uid) then
    raise exception 'This ESP32 is already enrolled; recommission it with a new token if credentials were erased' using errcode = '23505';
  end if;

  v_device_code := 'DLM-ESP32-' || v_hardware_uid;

  if v_serial <> '' then
    select count(*)::integer into v_matches
    from public.machines
    where nullif(trim(serial_number), '') is not null and lower(trim(serial_number)) = v_serial;

    if v_matches = 1 then
      select id, site_id into v_machine_id, v_site_id
      from public.machines
      where nullif(trim(serial_number), '') is not null and lower(trim(serial_number)) = v_serial
      limit 1;
      v_link_status := 'linked';
    elsif v_matches = 0 then
      v_link_status := 'no_match';
    else
      v_link_status := 'ambiguous';
    end if;
  end if;

  select id into v_live_policy_id from public.telemetry_policies where policy_code = 'live' limit 1;

  insert into public.telemetry_devices (
    device_code, machine_id, site_id, status, credential_hash, firmware_version,
    telemetry_policy_id, transport_preference, wifi_enabled, cellular_enabled,
    hardware_uid, reported_machine_serial, machine_link_status, machine_link_method, machine_linked_at
  ) values (
    v_device_code, v_machine_id, v_site_id, 'active', p_credential_hash, nullif(p_firmware, ''),
    v_live_policy_id, 'auto', true, true, v_hardware_uid, nullif(trim(p_machine_serial), ''), v_link_status,
    case when v_link_status = 'linked' then 'serial_auto' else null end,
    case when v_link_status = 'linked' then now() else null end
  ) returning id into v_device_id;

  update public.telemetry_enrollment_tokens set used_at = now(), used_by_device_id = v_device_id where id = v_token.id;

  return jsonb_build_object(
    'accepted', true,
    'device_id', v_device_id,
    'device_code', v_device_code,
    'hardware_uid', v_hardware_uid,
    'machine_id', v_machine_id,
    'machine_link_status', v_link_status,
    'machine_match_count', v_matches,
    'telemetry_mode', 'live'
  );
end;
$$;

revoke all on function public.enroll_telemetry_device(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.enroll_telemetry_device(text,text,text,text,text) to service_role;
