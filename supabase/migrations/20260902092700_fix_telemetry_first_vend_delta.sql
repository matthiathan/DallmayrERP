-- Preserve the first real cumulative vend as a reporting delta.
-- ingest_telemetry_payload_v3 must not pre-seed telemetry_counter_state before
-- delegating to ingest_telemetry_payload, otherwise a first observed vend is
-- mistaken for an unchanged baseline and telemetry_daily_item_sales remains empty.

CREATE OR REPLACE FUNCTION public.ingest_telemetry_payload_v3(p_device_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_device public.telemetry_devices%rowtype;
  v_type text := lower(coalesce(p_payload ->> 'type', ''));
  v_boot_id text := coalesce(p_payload ->> 'boot_id', '');
  v_sequence bigint := coalesce(nullif(p_payload ->> 'sequence', '')::bigint, 0);
  v_firmware text := nullif(p_payload ->> 'firmware', '');
  v_wifi_rssi integer := coalesce(nullif(p_payload ->> 'wifi_rssi', '')::integer, 0);
  v_policy jsonb;
  v_policy_id uuid;
  v_mode text;
  v_result jsonb;
  v_fault_code text;
  v_severity text;
  v_active boolean;
  v_open_count integer := 0;
  v_highest_severity text;
  v_machine_status text;
  v_item jsonb;
  v_counter_epoch text := coalesce(nullif(p_payload ->> 'counter_epoch', ''), 'unknown');
  v_sold_total bigint;
  v_failed_total bigint;
  v_revenue_total bigint;
  v_selection text;
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

  if v_boot_id <> ''
     and v_device.last_boot_id = v_boot_id
     and v_sequence > 0
     and v_sequence <= v_device.last_sequence then
    update public.telemetry_devices
      set last_seen_at = now(), updated_at = now()
    where id = v_device.id;
    return jsonb_build_object('accepted', true, 'duplicate', true, 'sequence', v_sequence);
  end if;

  v_policy := public.get_effective_telemetry_policy(v_device.id);
  v_policy_id := (v_policy ->> 'id')::uuid;
  v_mode := coalesce(v_policy ->> 'mode', 'live');

  if v_type = 'heartbeat' then
    update public.telemetry_devices
      set firmware_version = coalesce(v_firmware, firmware_version),
          wifi_rssi = v_wifi_rssi,
          last_seen_at = now(),
          last_upload_at = now(),
          last_heartbeat_at = now(),
          last_boot_id = nullif(v_boot_id, ''),
          last_sequence = case when nullif(v_boot_id, '') is not null and last_boot_id is distinct from nullif(v_boot_id, '') then v_sequence else greatest(last_sequence, v_sequence) end,
          updated_at = now()
    where id = v_device.id;

    insert into public.telemetry_machine_state (
      device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
      machine_status, active_fault_count, last_heartbeat_at,
      last_device_contact_at, updated_at
    ) values (
      v_device.id, v_device.machine_id, coalesce(v_device.site_id, (v_policy ->> 'site_id')::uuid),
      v_policy_id, v_mode, 'unknown', 0, now(), now(), now()
    )
    on conflict (device_id) do update set
      machine_id = excluded.machine_id,
      site_id = excluded.site_id,
      effective_policy_id = excluded.effective_policy_id,
      telemetry_mode = excluded.telemetry_mode,
      machine_status = public.telemetry_machine_state.machine_status,
      last_heartbeat_at = now(),
      last_device_contact_at = now(),
      updated_at = now();

    return jsonb_build_object('accepted', true, 'duplicate', false, 'heartbeat', true, 'telemetry_mode', v_mode);
  end if;

  if v_type = 'fault_state' then
    v_fault_code := left(trim(coalesce(p_payload ->> 'fault_code', p_payload ->> 'code', 'UNKNOWN')), 80);
    if v_fault_code = '' then v_fault_code := 'UNKNOWN'; end if;
    v_severity := lower(left(trim(coalesce(p_payload ->> 'severity', 'fault')), 16));
    if v_severity not in ('info','warning','fault','critical') then v_severity := 'fault'; end if;
    v_active := coalesce((p_payload ->> 'active')::boolean, true);

    if v_active then
      insert into public.telemetry_fault_events (
        device_id, machine_id, fault_code, severity, source, detail, raw_text, started_at, last_seen_at, metadata
      ) values (
        v_device.id, v_device.machine_id, v_fault_code, v_severity,
        left(coalesce(p_payload ->> 'source', ''), 80),
        left(coalesce(p_payload ->> 'detail', ''), 500),
        left(coalesce(p_payload ->> 'raw', ''), 500),
        now(), now(),
        jsonb_build_object('boot_id', v_boot_id, 'sequence', v_sequence, 'telemetry_mode', v_mode)
      )
      on conflict (device_id, fault_code) where cleared_at is null
      do update set
        severity = excluded.severity,
        source = coalesce(nullif(excluded.source, ''), public.telemetry_fault_events.source),
        detail = coalesce(nullif(excluded.detail, ''), public.telemetry_fault_events.detail),
        raw_text = coalesce(nullif(excluded.raw_text, ''), public.telemetry_fault_events.raw_text),
        last_seen_at = now();

      update public.telemetry_devices
        set last_fault_at = now()
      where id = v_device.id;
    else
      update public.telemetry_fault_events
        set cleared_at = now(), last_seen_at = now()
      where device_id = v_device.id
        and fault_code = v_fault_code
        and cleared_at is null;

      update public.telemetry_devices
        set last_recovery_at = now()
      where id = v_device.id;
    end if;

    select count(*)::integer,
           case max(case severity when 'critical' then 4 when 'fault' then 3 when 'warning' then 2 else 1 end)
             when 4 then 'critical'
             when 3 then 'fault'
             when 2 then 'warning'
             when 1 then 'info'
             else null
           end
      into v_open_count, v_highest_severity
    from public.telemetry_fault_events
    where device_id = v_device.id and cleared_at is null;

    v_machine_status := case
      when v_open_count = 0 then 'online'
      when v_highest_severity = 'critical' then 'critical'
      when v_highest_severity = 'fault' then 'fault'
      else 'warning'
    end;

    insert into public.telemetry_machine_state (
      device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
      machine_status, active_fault_count, last_fault_at, last_recovery_at,
      last_device_contact_at, last_fault_code, last_fault_severity, updated_at
    ) values (
      v_device.id, v_device.machine_id, coalesce(v_device.site_id, (v_policy ->> 'site_id')::uuid),
      v_policy_id, v_mode, v_machine_status, v_open_count,
      case when v_active then now() else null end,
      case when not v_active then now() else null end,
      now(), v_fault_code, v_severity, now()
    )
    on conflict (device_id) do update set
      machine_id = excluded.machine_id,
      site_id = excluded.site_id,
      effective_policy_id = excluded.effective_policy_id,
      telemetry_mode = excluded.telemetry_mode,
      machine_status = excluded.machine_status,
      active_fault_count = excluded.active_fault_count,
      last_fault_at = case when v_active then now() else public.telemetry_machine_state.last_fault_at end,
      last_recovery_at = case when not v_active then now() else public.telemetry_machine_state.last_recovery_at end,
      last_device_contact_at = now(),
      last_fault_code = excluded.last_fault_code,
      last_fault_severity = excluded.last_fault_severity,
      updated_at = now();

    insert into public.telemetry_diagnostics (
      device_id, machine_id, diagnostic_type, source, raw_text, detail, metadata
    ) values (
      v_device.id, v_device.machine_id,
      case when v_active then 'fault_started' else 'fault_cleared' end,
      left(coalesce(p_payload ->> 'source', ''), 80),
      left(coalesce(p_payload ->> 'raw', ''), 500),
      left(coalesce(p_payload ->> 'detail', ''), 500),
      jsonb_build_object('fault_code', v_fault_code, 'severity', v_severity, 'boot_id', v_boot_id, 'sequence', v_sequence)
    );

    update public.telemetry_devices
      set firmware_version = coalesce(v_firmware, firmware_version),
          wifi_rssi = v_wifi_rssi,
          last_seen_at = now(),
          last_upload_at = now(),
          last_boot_id = nullif(v_boot_id, ''),
          last_sequence = case when nullif(v_boot_id, '') is not null and last_boot_id is distinct from nullif(v_boot_id, '') then v_sequence else greatest(last_sequence, v_sequence) end,
          updated_at = now()
    where id = v_device.id;

    return jsonb_build_object(
      'accepted', true,
      'duplicate', false,
      'fault_state', true,
      'active', v_active,
      'fault_code', v_fault_code,
      'active_fault_count', v_open_count,
      'machine_status', v_machine_status,
      'telemetry_mode', v_mode
    );
  end if;

  if v_type = 'counter_snapshot' then
    -- Do not pre-seed telemetry_counter_state here. The underlying cumulative
    -- ingest function must see a new selection as new so its first observed
    -- sold/failed/revenue totals are recorded as the initial daily delta.

    v_result := public.ingest_telemetry_payload(p_device_id, p_payload);

    update public.telemetry_devices
      set last_counter_at = now(), updated_at = now()
    where id = v_device.id;

    insert into public.telemetry_machine_state (
      device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
      machine_status, active_fault_count, last_counter_at,
      last_device_contact_at, updated_at
    ) values (
      v_device.id, v_device.machine_id, coalesce(v_device.site_id, (v_policy ->> 'site_id')::uuid),
      v_policy_id, v_mode, 'online', 0, now(), now(), now()
    )
    on conflict (device_id) do update set
      machine_id = excluded.machine_id,
      site_id = excluded.site_id,
      effective_policy_id = excluded.effective_policy_id,
      telemetry_mode = excluded.telemetry_mode,
      machine_status = case when public.telemetry_machine_state.active_fault_count = 0 then 'online' else public.telemetry_machine_state.machine_status end,
      last_counter_at = now(),
      last_device_contact_at = now(),
      updated_at = now();

    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('telemetry_mode', v_mode);
  end if;

  v_result := public.ingest_telemetry_payload(p_device_id, p_payload);
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('telemetry_mode', v_mode);
end;
$function$

