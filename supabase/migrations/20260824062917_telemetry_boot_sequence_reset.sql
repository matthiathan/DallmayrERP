create or replace function public.record_telemetry_config_ack(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_device public.telemetry_devices%rowtype;
  v_applied jsonb := coalesce(p_payload -> 'applied_config', '{}'::jsonb);
  v_boot_id text := coalesce(p_payload ->> 'boot_id', '');
  v_sequence bigint := coalesce(nullif(p_payload ->> 'sequence', '')::bigint, 0);
  v_firmware text := nullif(p_payload ->> 'firmware', '');
  v_policy jsonb;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;
  if v_device.status <> 'active' then
    raise exception 'Telemetry device is not active' using errcode = '42501';
  end if;
  if jsonb_typeof(v_applied) <> 'object' then
    raise exception 'applied_config must be a JSON object' using errcode = '22023';
  end if;

  v_policy := public.get_effective_telemetry_policy(v_device.id);

  update public.telemetry_devices
  set firmware_version = coalesce(v_firmware, firmware_version),
      last_seen_at = now(),
      last_upload_at = now(),
      last_config_ack_at = now(),
      applied_config = v_applied,
      last_sequence = case
        when nullif(v_boot_id, '') is not null
         and last_boot_id is distinct from nullif(v_boot_id, '')
          then v_sequence
        else greatest(last_sequence, v_sequence)
      end,
      last_boot_id = nullif(v_boot_id, ''),
      updated_at = now()
  where id = v_device.id;

  insert into public.telemetry_machine_state (
    device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
    machine_status, active_fault_count, last_device_contact_at, updated_at
  ) values (
    v_device.id,
    v_device.machine_id,
    coalesce(v_device.site_id, nullif(v_policy ->> 'site_id', '')::uuid),
    nullif(v_policy ->> 'id', '')::uuid,
    coalesce(v_policy ->> 'mode', 'live'),
    'unknown', 0, now(), now()
  )
  on conflict (device_id) do update set
    machine_id = excluded.machine_id,
    site_id = excluded.site_id,
    effective_policy_id = excluded.effective_policy_id,
    telemetry_mode = excluded.telemetry_mode,
    last_device_contact_at = now(),
    updated_at = now();

  return jsonb_build_object(
    'accepted', true,
    'config_ack', true,
    'last_config_ack_at', now(),
    'applied_config', v_applied
  );
end;
$function$;

revoke all on function public.record_telemetry_config_ack(uuid, jsonb) from public;
revoke all on function public.record_telemetry_config_ack(uuid, jsonb) from anon;
revoke all on function public.record_telemetry_config_ack(uuid, jsonb) from authenticated;
grant execute on function public.record_telemetry_config_ack(uuid, jsonb) to service_role;

do $do$
declare
  v_definition text;
  v_old text := 'last_sequence = greatest(last_sequence, v_sequence)';
  v_new text := 'last_sequence = case when nullif(v_boot_id, '''') is not null and last_boot_id is distinct from nullif(v_boot_id, '''') then v_sequence else greatest(last_sequence, v_sequence) end';
begin
  v_definition := pg_get_functiondef('public.ingest_telemetry_payload_v3(uuid,jsonb)'::regprocedure);
  if position(v_old in v_definition) = 0 then
    raise exception 'Expected telemetry sequence assignment was not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$do$;
