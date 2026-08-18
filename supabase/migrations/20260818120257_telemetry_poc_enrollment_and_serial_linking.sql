alter table public.telemetry_devices
  add column if not exists hardware_uid text,
  add column if not exists reported_machine_serial text,
  add column if not exists machine_link_status text not null default 'unlinked',
  add column if not exists machine_link_method text,
  add column if not exists machine_linked_at timestamptz;

alter table public.telemetry_machine_state
  add column if not exists simulation_mode boolean not null default false,
  add column if not exists simulated_counters jsonb not null default '[]'::jsonb,
  add column if not exists last_simulation_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'telemetry_devices_machine_link_status_check'
      and conrelid = 'public.telemetry_devices'::regclass
  ) then
    alter table public.telemetry_devices
      add constraint telemetry_devices_machine_link_status_check
      check (machine_link_status in ('unlinked','linked','no_match','ambiguous'));
  end if;
end $$;

create unique index if not exists telemetry_devices_hardware_uid_key
  on public.telemetry_devices (hardware_uid)
  where hardware_uid is not null;

create index if not exists machines_serial_normalized_idx
  on public.machines ((lower(trim(serial_number))))
  where nullif(trim(serial_number), '') is not null;

create table if not exists public.telemetry_enrollment_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_device_id uuid references public.telemetry_devices(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.telemetry_enrollment_tokens enable row level security;
revoke all on table public.telemetry_enrollment_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.telemetry_enrollment_tokens to service_role;

create or replace function public.try_auto_link_telemetry_device(
  p_device_id uuid,
  p_machine_serial text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_serial text := lower(trim(coalesce(p_machine_serial, '')));
  v_existing_machine uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_matches integer := 0;
  v_status text;
begin
  if v_serial = '' then
    return jsonb_build_object('status', 'unlinked', 'reason', 'serial_missing');
  end if;

  select machine_id into v_existing_machine
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;

  update public.telemetry_devices
  set reported_machine_serial = left(trim(p_machine_serial), 160),
      updated_at = now()
  where id = p_device_id;

  if v_existing_machine is not null then
    update public.telemetry_devices
    set machine_link_status = 'linked'
    where id = p_device_id;
    return jsonb_build_object('status', 'linked', 'machine_id', v_existing_machine, 'reason', 'already_assigned');
  end if;

  select count(*)::integer into v_matches
  from public.machines
  where nullif(trim(serial_number), '') is not null
    and lower(trim(serial_number)) = v_serial;

  if v_matches = 1 then
    select id, site_id into v_machine_id, v_site_id
    from public.machines
    where nullif(trim(serial_number), '') is not null
      and lower(trim(serial_number)) = v_serial
    limit 1;

    update public.telemetry_devices
    set machine_id = v_machine_id,
        site_id = v_site_id,
        machine_link_status = 'linked',
        machine_link_method = 'serial_auto',
        machine_linked_at = now(),
        updated_at = now()
    where id = p_device_id
      and machine_id is null;

    update public.telemetry_machine_state
    set machine_id = v_machine_id,
        site_id = v_site_id,
        updated_at = now()
    where device_id = p_device_id;

    return jsonb_build_object('status', 'linked', 'machine_id', v_machine_id, 'match_count', 1);
  elsif v_matches = 0 then
    v_status := 'no_match';
  else
    v_status := 'ambiguous';
  end if;

  update public.telemetry_devices
  set machine_link_status = v_status,
      machine_link_method = null,
      machine_linked_at = null,
      updated_at = now()
  where id = p_device_id and machine_id is null;

  return jsonb_build_object('status', v_status, 'match_count', v_matches);
end;
$$;

revoke all on function public.try_auto_link_telemetry_device(uuid,text) from public, anon, authenticated;
grant execute on function public.try_auto_link_telemetry_device(uuid,text) to service_role;

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

  select * into v_token
  from public.telemetry_enrollment_tokens
  where token_hash = p_token_hash
  for update;

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
    where nullif(trim(serial_number), '') is not null
      and lower(trim(serial_number)) = v_serial;

    if v_matches = 1 then
      select id, site_id into v_machine_id, v_site_id
      from public.machines
      where nullif(trim(serial_number), '') is not null
        and lower(trim(serial_number)) = v_serial
      limit 1;
      v_link_status := 'linked';
    elsif v_matches = 0 then
      v_link_status := 'no_match';
    else
      v_link_status := 'ambiguous';
    end if;
  end if;

  select id into v_live_policy_id
  from public.telemetry_policies
  where policy_code = 'live' and is_active
  limit 1;

  insert into public.telemetry_devices (
    device_code, machine_id, site_id, status, credential_hash, firmware_version,
    telemetry_policy_id, transport_preference, wifi_enabled, cellular_enabled,
    hardware_uid, reported_machine_serial, machine_link_status,
    machine_link_method, machine_linked_at
  ) values (
    v_device_code, v_machine_id, v_site_id, 'active', p_credential_hash, nullif(p_firmware, ''),
    v_live_policy_id, 'auto', true, true,
    v_hardware_uid, nullif(trim(p_machine_serial), ''), v_link_status,
    case when v_link_status = 'linked' then 'serial_auto' else null end,
    case when v_link_status = 'linked' then now() else null end
  )
  returning id into v_device_id;

  update public.telemetry_enrollment_tokens
  set used_at = now(), used_by_device_id = v_device_id
  where id = v_token.id;

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

create or replace function public.ingest_telemetry_simulation_snapshot(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_policy jsonb;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_boot_id text := nullif(p_payload ->> 'boot_id', '');
  v_sequence bigint := coalesce(nullif(p_payload ->> 'sequence', '')::bigint, 0);
  v_firmware text := nullif(p_payload ->> 'firmware', '');
begin
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Simulation items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 16 then
    raise exception 'Simulation snapshot supports at most 16 items' using errcode = '22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then raise exception 'Telemetry device not found' using errcode = '22023'; end if;
  if v_device.status <> 'active' then raise exception 'Telemetry device is not active' using errcode = '42501'; end if;

  v_policy := public.get_effective_telemetry_policy(v_device.id);

  update public.telemetry_devices
  set firmware_version = coalesce(v_firmware, firmware_version),
      last_seen_at = now(),
      last_upload_at = now(),
      last_counter_at = now(),
      last_boot_id = coalesce(v_boot_id, last_boot_id),
      last_sequence = greatest(last_sequence, v_sequence),
      updated_at = now()
  where id = v_device.id;

  insert into public.telemetry_machine_state (
    device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
    machine_status, active_fault_count, last_counter_at, last_device_contact_at,
    simulation_mode, simulated_counters, last_simulation_at, updated_at
  ) values (
    v_device.id, v_device.machine_id, v_device.site_id,
    nullif(v_policy ->> 'id', '')::uuid, coalesce(v_policy ->> 'mode', 'live'),
    'online', 0, now(), now(), true, v_items, now(), now()
  )
  on conflict (device_id) do update set
    machine_id = excluded.machine_id,
    site_id = excluded.site_id,
    effective_policy_id = excluded.effective_policy_id,
    telemetry_mode = excluded.telemetry_mode,
    machine_status = case when public.telemetry_machine_state.active_fault_count = 0 then 'online' else public.telemetry_machine_state.machine_status end,
    last_counter_at = now(),
    last_device_contact_at = now(),
    simulation_mode = true,
    simulated_counters = excluded.simulated_counters,
    last_simulation_at = now(),
    updated_at = now();

  return jsonb_build_object(
    'accepted', true,
    'simulation', true,
    'item_count', jsonb_array_length(v_items),
    'telemetry_mode', coalesce(v_policy ->> 'mode', 'live')
  );
end;
$$;

revoke all on function public.ingest_telemetry_simulation_snapshot(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_simulation_snapshot(uuid,jsonb) to service_role;

create or replace function public.get_telemetry_simulation_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','executive') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', d.id,
    'device_code', d.device_code,
    'hardware_uid', d.hardware_uid,
    'reported_machine_serial', d.reported_machine_serial,
    'machine_link_status', d.machine_link_status,
    'machine_id', d.machine_id,
    'simulation_mode', coalesce(ms.simulation_mode, false),
    'simulated_counters', coalesce(ms.simulated_counters, '[]'::jsonb),
    'last_simulation_at', ms.last_simulation_at
  ) order by d.device_code), '[]'::jsonb)
  into v_result
  from public.telemetry_devices d
  left join public.telemetry_machine_state ms on ms.device_id = d.id
  where d.status = 'active';

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_simulation_state() from public, anon;
grant execute on function public.get_telemetry_simulation_state() to authenticated;
