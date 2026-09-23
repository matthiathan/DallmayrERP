-- If a pre-paired machine has a known serial and the controller can report a
-- serial, require those two pieces of evidence to agree. MDB-only controllers
-- that cannot report a serial still use the explicit commissioning pre-pair.

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
  v_region text;
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid,'')));
  v_device_code text;
  v_device_id uuid;
  v_live_policy_id uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_serial text := lower(trim(coalesce(p_machine_serial,'')));
  v_expected_serial text;
  v_matches integer := 0;
  v_link_status text := 'unlinked';
  v_link_method text := null;
  v_expected_machine public.machines%rowtype;
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Invalid ESP32 hardware UID' using errcode='22023';
  end if;
  if nullif(trim(coalesce(p_credential_hash,'')),'') is null then
    raise exception 'Credential hash is required' using errcode='22023';
  end if;

  select * into v_token
  from public.telemetry_enrollment_tokens
  where token_hash = lower(trim(coalesce(p_token_hash,'')))
  for update;

  if not found
     or v_token.used_at is not null
     or v_token.revoked_at is not null
     or v_token.expires_at <= now()
     or v_token.expected_hardware_uid is distinct from v_hardware_uid then
    raise exception 'Invalid, expired, already-used, or UID-mismatched enrollment token' using errcode='42501';
  end if;

  v_region := v_token.telemetry_region;

  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then
    raise exception 'This ESP32 is already enrolled; recommission it with a new token if credentials were erased' using errcode='23505';
  end if;

  v_device_code := 'DLM-ESP32-' || v_hardware_uid;

  if v_token.expected_machine_id is not null then
    select * into v_expected_machine
    from public.machines
    where id = v_token.expected_machine_id
      and telemetry_region = v_region
    for update;

    if not found then
      raise exception 'The machine preassigned to this enrollment token is no longer available in the token region.' using errcode='42501';
    end if;

    v_expected_serial := lower(trim(coalesce(v_expected_machine.serial_number, '')));
    if v_serial <> '' and v_expected_serial <> '' and v_serial <> v_expected_serial then
      raise exception 'Reported machine serial does not match the machine preassigned to this enrollment token.' using errcode='23514';
    end if;

    if exists (
      select 1 from public.telemetry_devices d
      where d.machine_id = v_expected_machine.id and d.status = 'active'
    ) then
      raise exception 'The machine preassigned to this enrollment token already has an active telemetry controller.' using errcode='23505';
    end if;

    v_machine_id := v_expected_machine.id;
    v_site_id := v_expected_machine.site_id;
    v_matches := 1;
    v_link_status := 'linked';
    v_link_method := 'token_preassigned';
  elsif v_serial <> '' then
    select count(*)::integer into v_matches
    from public.machines
    where telemetry_region = v_region
      and nullif(trim(serial_number),'') is not null
      and lower(trim(serial_number)) = v_serial;

    if v_matches = 1 then
      select id,site_id into v_machine_id,v_site_id
      from public.machines
      where telemetry_region = v_region
        and nullif(trim(serial_number),'') is not null
        and lower(trim(serial_number)) = v_serial
      limit 1;
      v_link_status := 'linked';
      v_link_method := 'serial_auto';
    elsif v_matches = 0 then
      v_link_status := 'no_match';
    else
      v_link_status := 'ambiguous';
    end if;
  end if;

  select id into v_live_policy_id
  from public.telemetry_policies
  where policy_code='live'
  limit 1;

  insert into public.telemetry_devices(
    device_code,machine_id,site_id,status,credential_hash,firmware_version,
    telemetry_policy_id,transport_preference,wifi_enabled,cellular_enabled,
    hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,
    machine_linked_at,telemetry_region
  ) values (
    v_device_code,v_machine_id,v_site_id,'active',p_credential_hash,nullif(p_firmware,''),
    v_live_policy_id,'auto',true,true,v_hardware_uid,nullif(trim(p_machine_serial),''),
    v_link_status,v_link_method,case when v_link_status='linked' then now() else null end,v_region
  ) returning id into v_device_id;

  update public.telemetry_enrollment_tokens
  set used_at=now(),used_by_device_id=v_device_id
  where id=v_token.id;

  return jsonb_build_object(
    'accepted',true,
    'enrollment_method','one_time_token',
    'telemetry_region',v_region,
    'device_id',v_device_id,
    'device_code',v_device_code,
    'hardware_uid',v_hardware_uid,
    'machine_id',v_machine_id,
    'machine_link_status',v_link_status,
    'machine_link_method',v_link_method,
    'machine_match_count',v_matches,
    'telemetry_mode','live'
  );
end;
$$;

revoke all on function public.enroll_telemetry_device(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.enroll_telemetry_device(text,text,text,text,text) to service_role;
