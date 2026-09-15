create or replace function public.get_telemetry_test_logs(
  p_session_id uuid,
  p_after_id bigint default 0,
  p_limit integer default 200
)
returns table (
  id bigint,
  session_id uuid,
  device_id uuid,
  boot_id text,
  device_sequence bigint,
  device_uptime_ms bigint,
  category text,
  message text,
  received_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_after_id bigint := greatest(coalesce(p_after_id, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.telemetry_test_sessions s
    where s.id = p_session_id
  ) then
    raise exception 'Unknown telemetry test session.' using errcode = '22023';
  end if;

  if v_after_id > 0 then
    return query
    select
      l.id,
      l.session_id,
      l.device_id,
      l.boot_id,
      l.device_sequence,
      l.device_uptime_ms,
      l.category,
      l.message,
      l.received_at
    from public.telemetry_debug_logs l
    where l.session_id = p_session_id
      and l.id > v_after_id
    order by l.id asc
    limit v_limit;
    return;
  end if;

  return query
  select initial_rows.id,
         initial_rows.session_id,
         initial_rows.device_id,
         initial_rows.boot_id,
         initial_rows.device_sequence,
         initial_rows.device_uptime_ms,
         initial_rows.category,
         initial_rows.message,
         initial_rows.received_at
  from (
    select
      l.id,
      l.session_id,
      l.device_id,
      l.boot_id,
      l.device_sequence,
      l.device_uptime_ms,
      l.category,
      l.message,
      l.received_at
    from public.telemetry_debug_logs l
    where l.session_id = p_session_id
    order by l.id desc
    limit v_limit
  ) initial_rows
  order by initial_rows.id asc;
end;
$$;

revoke all on function public.get_telemetry_test_logs(uuid, bigint, integer) from public, anon;
grant execute on function public.get_telemetry_test_logs(uuid, bigint, integer) to authenticated;

create or replace function public.search_telemetry_test_devices(
  p_search text default '',
  p_limit integer default 75
)
returns table (
  id uuid,
  device_code text,
  machine_id uuid,
  status text,
  firmware_version text,
  last_seen_at timestamptz,
  last_transport text,
  wifi_rssi integer,
  cellular_csq integer,
  cellular_operator text,
  profile_id text,
  profile_assignment_method text,
  reported_machine_interface text,
  reported_machine_model text,
  last_config_ack_at timestamptz,
  applied_config jsonb,
  mdb_master_polarity text,
  mdb_slave_polarity text,
  mdb_pin_swap boolean,
  machine_name text,
  machine_model text,
  machine_serial_number text,
  machine_asset_tag text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 75), 1), 150);
begin
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.device_code,
    d.machine_id,
    d.status,
    d.firmware_version,
    d.last_seen_at,
    d.last_transport,
    d.wifi_rssi,
    d.cellular_csq,
    d.cellular_operator,
    d.profile_id,
    d.profile_assignment_method,
    d.reported_machine_interface,
    d.reported_machine_model,
    d.last_config_ack_at,
    d.applied_config,
    d.mdb_master_polarity,
    d.mdb_slave_polarity,
    coalesce(d.mdb_pin_swap, false),
    m.machine_name,
    m.model,
    m.serial_number,
    m.asset_tag
  from public.telemetry_devices d
  left join public.machines m on m.id = d.machine_id
  where d.status = 'active'
    and (
      v_search = ''
      or lower(coalesce(d.device_code, '')) like '%' || v_search || '%'
      or lower(coalesce(d.firmware_version, '')) like '%' || v_search || '%'
      or lower(coalesce(d.reported_machine_model, '')) like '%' || v_search || '%'
      or lower(coalesce(d.reported_machine_interface, '')) like '%' || v_search || '%'
      or lower(coalesce(m.machine_name, '')) like '%' || v_search || '%'
      or lower(coalesce(m.model, '')) like '%' || v_search || '%'
      or lower(coalesce(m.serial_number, '')) like '%' || v_search || '%'
      or lower(coalesce(m.asset_tag, '')) like '%' || v_search || '%'
      or d.id::text = v_search
      or d.machine_id::text = v_search
    )
  order by
    case when lower(coalesce(d.device_code, '')) = v_search and v_search <> '' then 0 else 1 end,
    lower(d.device_code),
    d.id
  limit v_limit;
end;
$$;

revoke all on function public.search_telemetry_test_devices(text, integer) from public, anon;
grant execute on function public.search_telemetry_test_devices(text, integer) to authenticated;
