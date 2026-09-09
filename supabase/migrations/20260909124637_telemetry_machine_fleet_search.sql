create index if not exists telemetry_fault_events_active_machine_idx
  on public.telemetry_fault_events(machine_id)
  where cleared_at is null and machine_id is not null;

create or replace function public.get_telemetry_machine_fleet(
  p_search text default '',
  p_branch text default 'all',
  p_status text default 'all',
  p_offset integer default 0,
  p_limit integer default 75
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := lower(trim(coalesce(p_search, '')));
  v_branch text := lower(trim(coalesce(nullif(p_branch, ''), 'all')));
  v_status text := lower(trim(coalesce(nullif(p_status, ''), 'all')));
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 75), 1), 250);
  v_result jsonb;
begin
  if v_status not in ('all', 'online', 'delayed', 'offline', 'never', 'unlinked') then
    raise exception 'Invalid machine connection status' using errcode = '22023';
  end if;

  with active_devices as (
    select distinct on (d.machine_id)
      d.machine_id,
      d.id as device_id,
      d.device_code,
      coalesce(ms.telemetry_mode, ep.policy ->> 'mode', 'live') as telemetry_mode,
      coalesce(ms.machine_status, 'unknown') as machine_status,
      d.last_transport,
      d.wifi_rssi,
      d.cellular_csq,
      d.cellular_operator,
      d.firmware_version,
      d.last_seen_at,
      d.last_heartbeat_at
    from public.telemetry_devices d
    left join public.telemetry_machine_state ms on ms.device_id = d.id
    left join lateral (
      select public.get_effective_telemetry_policy(d.id) as policy
    ) ep on true
    where d.status = 'active'
      and d.machine_id is not null
    order by d.machine_id, d.updated_at desc, d.id
  ),
  fault_counts as (
    select f.machine_id, count(*)::integer as fault_count
    from public.telemetry_fault_events f
    where f.cleared_at is null
      and f.machine_id is not null
    group by f.machine_id
  ),
  base as (
    select
      m.id,
      m.branch,
      m.site_id,
      m.serial_number,
      m.machine_barcode,
      m.asset_tag,
      m.machine_name,
      m.model,
      m.status as asset_status,
      m.current_custodian,
      m.manufacturer,
      coalesce(s.site_name, 'Unassigned site') as site_name,
      coalesce(s.address, m.current_custodian, upper(m.branch), 'Location not assigned') as location,
      d.device_id,
      d.device_code,
      d.telemetry_mode,
      d.machine_status,
      d.last_transport,
      d.wifi_rssi,
      d.cellular_csq,
      d.cellular_operator,
      d.firmware_version,
      d.last_seen_at,
      d.last_heartbeat_at,
      coalesce(fc.fault_count, 0) as fault_count,
      coalesce(d.last_heartbeat_at, d.last_seen_at) as last_contact,
      case
        when d.device_id is null then 'unlinked'
        when coalesce(d.last_heartbeat_at, d.last_seen_at) is null then 'never'
        when coalesce(d.last_heartbeat_at, d.last_seen_at) >= now() - interval '30 minutes' then 'online'
        when coalesce(d.last_heartbeat_at, d.last_seen_at) >= now() - interval '24 hours' then 'delayed'
        else 'offline'
      end as connection_status
    from public.machines m
    left join public.customer_sites s on s.id = m.site_id
    left join active_devices d on d.machine_id = m.id
    left join fault_counts fc on fc.machine_id = m.id
  ),
  filtered as (
    select b.*
    from base b
    where (v_branch = 'all' or lower(b.branch) = v_branch)
      and (v_status = 'all' or b.connection_status = v_status)
      and (
        v_search = ''
        or lower(coalesce(b.machine_name, '')) like '%' || v_search || '%'
        or lower(coalesce(b.serial_number, '')) like '%' || v_search || '%'
        or lower(coalesce(b.machine_barcode, '')) like '%' || v_search || '%'
        or lower(coalesce(b.asset_tag, '')) like '%' || v_search || '%'
        or lower(coalesce(b.model, '')) like '%' || v_search || '%'
        or lower(coalesce(b.manufacturer, '')) like '%' || v_search || '%'
        or lower(coalesce(b.site_name, '')) like '%' || v_search || '%'
        or lower(coalesce(b.location, '')) like '%' || v_search || '%'
        or lower(coalesce(b.device_code, '')) like '%' || v_search || '%'
        or b.id::text = v_search
      )
  ),
  page_rows as (
    select f.*
    from filtered f
    order by lower(coalesce(f.machine_name, f.model, f.serial_number, f.asset_tag, f.id::text)), f.id
    limit v_limit
    offset v_offset
  ),
  fleet_summary as (
    select
      count(*)::bigint as fleet_total,
      count(*) filter (where connection_status = 'online')::bigint as online,
      count(*) filter (where connection_status = 'delayed')::bigint as delayed,
      count(*) filter (where connection_status = 'offline')::bigint as offline,
      count(*) filter (where connection_status = 'never')::bigint as never,
      count(*) filter (where connection_status = 'unlinked')::bigint as unlinked,
      coalesce(sum(fault_count), 0)::bigint as active_faults
    from base
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'fleet_total', fs.fleet_total,
    'summary', jsonb_build_object(
      'online', fs.online,
      'delayed', fs.delayed,
      'offline', fs.offline,
      'never', fs.never,
      'unlinked', fs.unlinked,
      'active_faults', fs.active_faults
    ),
    'branches', coalesce((
      select jsonb_agg(branch order by branch)
      from (select distinct lower(branch) as branch from base where nullif(trim(branch), '') is not null) branches
    ), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset,
    'generated_at', now()
  )
  into v_result
  from fleet_summary fs;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_machine_fleet(text, text, text, integer, integer) from public, anon;
grant execute on function public.get_telemetry_machine_fleet(text, text, text, integer, integer) to authenticated;
