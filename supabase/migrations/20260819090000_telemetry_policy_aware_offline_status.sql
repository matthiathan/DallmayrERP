create or replace function public.get_telemetry_connectivity_state(p_device_id uuid)
returns table (
  expected_update_minutes integer,
  grace_minutes integer,
  offline_after_minutes integer,
  update_deadline_at timestamptz,
  communication_status text,
  communication_error boolean,
  minutes_overdue integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with source as (
    select
      d.id,
      coalesce(d.last_seen_at, d.created_at) as reference_seen_at,
      public.get_effective_telemetry_policy(d.id) as policy
    from public.telemetry_devices d
    where d.id = p_device_id
  ), policy_values as (
    select
      reference_seen_at,
      greatest(1, coalesce(nullif(policy ->> 'heartbeat_interval_minutes', '')::integer, 10)) as expected_minutes
    from source
  ), thresholds as (
    select
      reference_seen_at,
      expected_minutes,
      greatest(5, least(30, ceil(expected_minutes * 0.10)::integer)) as allowed_grace_minutes
    from policy_values
  ), calculated as (
    select
      expected_minutes,
      allowed_grace_minutes,
      expected_minutes + allowed_grace_minutes as allowed_offline_minutes,
      reference_seen_at + make_interval(mins => expected_minutes + allowed_grace_minutes) as deadline_at
    from thresholds
  )
  select
    expected_minutes,
    allowed_grace_minutes,
    allowed_offline_minutes,
    deadline_at,
    case when now() > deadline_at then 'offline' else 'online' end,
    now() > deadline_at,
    case
      when now() > deadline_at then greatest(0, floor(extract(epoch from (now() - deadline_at)) / 60.0)::integer)
      else 0
    end
  from calculated;
$$;

revoke all on function public.get_telemetry_connectivity_state(uuid) from public, anon, authenticated;
grant execute on function public.get_telemetry_connectivity_state(uuid) to service_role;

create or replace function public.get_telemetry_live_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin', 'executive', 'operations') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  with device_rows as (
    select
      d.id as device_id,
      d.device_code,
      d.machine_id,
      m.machine_name,
      m.serial_number,
      coalesce(m.branch, 'unassigned') as branch,
      d.profile_id,
      d.status as device_status,
      coalesce(ms.telemetry_mode, ep.policy ->> 'mode', 'live') as telemetry_mode,
      coalesce(ms.machine_status, 'unknown') as machine_status,
      coalesce(ms.active_fault_count, 0) as active_fault_count,
      d.transport_preference,
      d.last_transport,
      d.wifi_enabled,
      d.cellular_enabled,
      d.wifi_rssi,
      d.cellular_csq,
      d.cellular_operator,
      d.cellular_model,
      d.firmware_version,
      d.last_seen_at,
      d.last_counter_at,
      d.last_heartbeat_at,
      d.last_config_at,
      c.expected_update_minutes,
      c.grace_minutes,
      c.offline_after_minutes,
      c.update_deadline_at,
      c.communication_status,
      c.communication_error,
      c.minutes_overdue
    from public.telemetry_devices d
    left join public.machines m on m.id = d.machine_id
    left join public.telemetry_machine_state ms on ms.device_id = d.id
    left join lateral (select public.get_effective_telemetry_policy(d.id) as policy) ep on true
    left join lateral public.get_telemetry_connectivity_state(d.id) c on true
    where d.status = 'active'
  ), fault_rows as (
    select
      f.id::text as id,
      f.device_id,
      d.device_code,
      f.machine_id,
      m.machine_name,
      m.serial_number,
      f.fault_code,
      f.severity,
      f.detail,
      f.started_at,
      f.last_seen_at,
      'machine'::text as fault_source
    from public.telemetry_fault_events f
    join public.telemetry_devices d on d.id = f.device_id
    left join public.machines m on m.id = f.machine_id
    where f.cleared_at is null

    union all

    select
      'connectivity:' || dr.device_id::text as id,
      dr.device_id,
      dr.device_code,
      dr.machine_id,
      dr.machine_name,
      dr.serial_number,
      'TELEMETRY_TIMEOUT'::text as fault_code,
      'fault'::text as severity,
      format(
        'No telemetry update was received by the required deadline. Expected contact every %s minute(s) with %s minute(s) grace.',
        dr.expected_update_minutes,
        dr.grace_minutes
      ) as detail,
      dr.update_deadline_at as started_at,
      dr.last_seen_at,
      'connectivity'::text as fault_source
    from device_rows dr
    where dr.communication_error
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'reporting_devices', (select count(*) from device_rows),
      'online_devices', (select count(*) from device_rows where communication_status = 'online'),
      'offline_devices', (select count(*) from device_rows where communication_status = 'offline'),
      'communication_errors', (select count(*) from device_rows where communication_error),
      'unassigned_devices', (select count(*) from device_rows where machine_id is null),
      'active_faults', (select count(*) from fault_rows)
    ),
    'device_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', dr.device_id,
        'device_code', dr.device_code,
        'machine_id', dr.machine_id,
        'machine_name', dr.machine_name,
        'serial_number', dr.serial_number,
        'branch', dr.branch,
        'profile_id', dr.profile_id,
        'device_status', dr.device_status,
        'telemetry_mode', dr.telemetry_mode,
        'machine_status', dr.machine_status,
        'active_fault_count', dr.active_fault_count,
        'transport_preference', dr.transport_preference,
        'last_transport', dr.last_transport,
        'wifi_enabled', dr.wifi_enabled,
        'cellular_enabled', dr.cellular_enabled,
        'wifi_rssi', dr.wifi_rssi,
        'cellular_csq', dr.cellular_csq,
        'cellular_operator', dr.cellular_operator,
        'cellular_model', dr.cellular_model,
        'firmware_version', dr.firmware_version,
        'last_seen_at', dr.last_seen_at,
        'last_counter_at', dr.last_counter_at,
        'last_heartbeat_at', dr.last_heartbeat_at,
        'last_config_at', dr.last_config_at,
        'expected_update_minutes', dr.expected_update_minutes,
        'grace_minutes', dr.grace_minutes,
        'offline_after_minutes', dr.offline_after_minutes,
        'update_deadline_at', dr.update_deadline_at,
        'communication_status', dr.communication_status,
        'communication_error', dr.communication_error,
        'communication_error_code', case when dr.communication_error then 'TELEMETRY_TIMEOUT' else null end,
        'minutes_overdue', dr.minutes_overdue
      ) order by dr.communication_error desc, dr.device_code)
      from device_rows dr
    ), '[]'::jsonb),
    'active_faults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fr.id,
        'device_id', fr.device_id,
        'device_code', fr.device_code,
        'machine_id', fr.machine_id,
        'machine_name', fr.machine_name,
        'serial_number', fr.serial_number,
        'fault_code', fr.fault_code,
        'severity', fr.severity,
        'detail', fr.detail,
        'started_at', fr.started_at,
        'last_seen_at', fr.last_seen_at,
        'fault_source', fr.fault_source
      ) order by case fr.severity when 'critical' then 1 when 'fault' then 2 when 'warning' then 3 else 4 end, fr.started_at desc)
      from fault_rows fr
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.get_telemetry_live_status() to authenticated;

create or replace function public.get_telemetry_location_map()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','executive','operations') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', d.id,
    'device_code', d.device_code,
    'machine_id', d.machine_id,
    'machine_name', m.machine_name,
    'serial_number', m.serial_number,
    'branch', coalesce(m.branch, s.branch, 'unassigned'),
    'machine_status', case when c.communication_error then 'error' else coalesce(ms.machine_status, 'unknown') end,
    'active_fault_count', coalesce(ms.active_fault_count, 0) + case when c.communication_error then 1 else 0 end,
    'last_seen_at', d.last_seen_at,
    'last_transport', d.last_transport,
    'expected_update_minutes', c.expected_update_minutes,
    'offline_after_minutes', c.offline_after_minutes,
    'update_deadline_at', c.update_deadline_at,
    'communication_status', c.communication_status,
    'communication_error', c.communication_error,
    'communication_error_code', case when c.communication_error then 'TELEMETRY_TIMEOUT' else null end,
    'minutes_overdue', c.minutes_overdue,
    'location_enabled', d.location_enabled,
    'location_interval_minutes', d.location_interval_minutes,
    'location_min_move_m', d.location_min_move_m,
    'latitude', coalesce(ls.latitude, s.latitude::double precision),
    'longitude', coalesce(ls.longitude, s.longitude::double precision),
    'accuracy_m', ls.accuracy_m,
    'altitude_m', ls.altitude_m,
    'speed_mps', ls.speed_mps,
    'satellites', ls.satellites,
    'hdop', ls.hdop,
    'location_source', case
      when ls.device_id is not null then ls.source
      when s.latitude is not null and s.longitude is not null then 'site'
      else null
    end,
    'location_fix_at', ls.fix_at,
    'location_received_at', ls.received_at,
    'movement_detected', coalesce(ls.movement_detected, false),
    'distance_from_previous_m', ls.distance_from_previous_m,
    'location_stale', case
      when ls.device_id is null then false
      else ls.received_at < now() - make_interval(mins => greatest(d.location_interval_minutes * 3, 30))
    end,
    'has_location', (ls.device_id is not null or (s.latitude is not null and s.longitude is not null))
  ) order by c.communication_error desc, d.device_code), '[]'::jsonb)
  into v_result
  from public.telemetry_devices d
  left join public.machines m on m.id = d.machine_id
  left join public.customer_sites s on s.id = coalesce(d.site_id, m.site_id)
  left join public.telemetry_machine_state ms on ms.device_id = d.id
  left join public.telemetry_device_location_state ls on ls.device_id = d.id
  left join lateral public.get_telemetry_connectivity_state(d.id) c on true
  where d.status = 'active';

  return v_result;
end;
$$;
