create or replace function public.get_telemetry_location_map()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
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

revoke all on function public.get_telemetry_location_map() from public, anon;
grant execute on function public.get_telemetry_location_map() to authenticated;
