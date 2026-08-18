alter table public.telemetry_devices
  add column if not exists transport_preference text not null default 'auto',
  add column if not exists wifi_enabled boolean not null default true,
  add column if not exists cellular_enabled boolean not null default true,
  add column if not exists last_transport text,
  add column if not exists cellular_csq integer,
  add column if not exists cellular_operator text,
  add column if not exists cellular_model text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'telemetry_devices_transport_preference_check'
      and conrelid = 'public.telemetry_devices'::regclass
  ) then
    alter table public.telemetry_devices
      add constraint telemetry_devices_transport_preference_check
      check (transport_preference in ('auto','wifi','cellular'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'telemetry_devices_last_transport_check'
      and conrelid = 'public.telemetry_devices'::regclass
  ) then
    alter table public.telemetry_devices
      add constraint telemetry_devices_last_transport_check
      check (last_transport is null or last_transport in ('wifi','cellular'));
  end if;
end $$;

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

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code);

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;

  if p_mode is not null then
    if v_mode in ('inherit','default','') then
      update public.telemetry_devices
      set telemetry_policy_id = null, updated_at = now()
      where id = v_device_id;
    else
      if v_mode not in ('live','daily','monthly') then
        raise exception 'Mode must be live, daily, monthly, or inherit' using errcode = '22023';
      end if;
      select id into v_policy_id
      from public.telemetry_policies
      where policy_code = v_mode and is_active;
      if v_policy_id is null then
        raise exception 'Telemetry policy not found' using errcode = '22023';
      end if;
      update public.telemetry_devices
      set telemetry_policy_id = v_policy_id, updated_at = now()
      where id = v_device_id;
    end if;
  end if;

  if p_transport_preference is not null then
    if v_transport not in ('auto','wifi','cellular') then
      raise exception 'Transport must be auto, wifi, or cellular' using errcode = '22023';
    end if;
    update public.telemetry_devices
    set transport_preference = v_transport, updated_at = now()
    where id = v_device_id;
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
  )
  into v_result
  from public.telemetry_devices d
  where d.id = v_device_id;

  return v_result;
end;
$$;

revoke all on function public.set_telemetry_device_control(text,text,text,boolean,boolean) from public, anon;
grant execute on function public.set_telemetry_device_control(text,text,text,boolean,boolean) to authenticated;

create or replace function public.get_telemetry_dashboard(
  p_period text default 'today',
  p_branch text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_from date;
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin', 'executive') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  v_from := case lower(coalesce(p_period, 'today'))
    when 'today' then current_date
    when 'week' then current_date - 6
    when 'month' then date_trunc('month', current_date)::date
    when 'six_months' then (current_date - interval '6 months')::date
    else current_date
  end;

  with filtered as (
    select *
    from public.telemetry_daily_item_sales s
    where s.sales_date >= v_from
      and (coalesce(nullif(lower(p_branch), ''), 'all') = 'all' or lower(s.branch) = lower(p_branch))
  )
  select jsonb_build_object(
    'period', lower(coalesce(p_period, 'today')),
    'date_from', v_from,
    'date_to', current_date,
    'summary', jsonb_build_object(
      'units_sold', coalesce((select sum(units_sold) from filtered), 0),
      'revenue_cents', coalesce((select sum(revenue_cents) from filtered), 0),
      'failed_vends', coalesce((select sum(failed_vends) from filtered), 0),
      'active_machines', coalesce((select count(distinct machine_id) from filtered where machine_id is not null), 0),
      'reporting_devices', (select count(*) from public.telemetry_devices where status = 'active'),
      'online_devices', (select count(*) from public.telemetry_devices where status = 'active' and last_seen_at >= now() - interval '30 minutes'),
      'offline_devices', (select count(*) from public.telemetry_devices where status = 'active' and (last_seen_at is null or last_seen_at < now() - interval '30 minutes')),
      'unassigned_devices', (select count(*) from public.telemetry_devices where status = 'active' and machine_id is null),
      'active_faults', (select count(*) from public.telemetry_fault_events where cleared_at is null)
    ),
    'device_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', d.id,
        'device_code', d.device_code,
        'machine_id', d.machine_id,
        'machine_name', m.machine_name,
        'serial_number', m.serial_number,
        'branch', coalesce(m.branch, 'unassigned'),
        'profile_id', d.profile_id,
        'device_status', d.status,
        'telemetry_mode', coalesce(ms.telemetry_mode, ep.policy ->> 'mode', 'live'),
        'machine_status', coalesce(ms.machine_status, 'unknown'),
        'active_fault_count', coalesce(ms.active_fault_count, 0),
        'transport_preference', d.transport_preference,
        'last_transport', d.last_transport,
        'wifi_enabled', d.wifi_enabled,
        'cellular_enabled', d.cellular_enabled,
        'wifi_rssi', d.wifi_rssi,
        'cellular_csq', d.cellular_csq,
        'cellular_operator', d.cellular_operator,
        'cellular_model', d.cellular_model,
        'firmware_version', d.firmware_version,
        'last_seen_at', d.last_seen_at,
        'last_counter_at', d.last_counter_at,
        'last_heartbeat_at', d.last_heartbeat_at,
        'last_config_at', d.last_config_at
      ) order by d.device_code)
      from public.telemetry_devices d
      left join public.machines m on m.id = d.machine_id
      left join public.telemetry_machine_state ms on ms.device_id = d.id
      left join lateral (select public.get_effective_telemetry_policy(d.id) as policy) ep on true
      where d.status = 'active'
        and (
          coalesce(nullif(lower(p_branch), ''), 'all') = 'all'
          or lower(coalesce(m.branch, '')) = lower(p_branch)
        )
    ), '[]'::jsonb),
    'active_faults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'device_id', f.device_id,
        'device_code', d.device_code,
        'machine_id', f.machine_id,
        'machine_name', m.machine_name,
        'serial_number', m.serial_number,
        'fault_code', f.fault_code,
        'severity', f.severity,
        'detail', f.detail,
        'started_at', f.started_at,
        'last_seen_at', f.last_seen_at
      ) order by
        case f.severity when 'critical' then 1 when 'fault' then 2 when 'warning' then 3 else 4 end,
        f.started_at desc)
      from public.telemetry_fault_events f
      join public.telemetry_devices d on d.id = f.device_id
      left join public.machines m on m.id = f.machine_id
      where f.cleared_at is null
        and (
          coalesce(nullif(lower(p_branch), ''), 'all') = 'all'
          or lower(coalesce(m.branch, '')) = lower(p_branch)
        )
    ), '[]'::jsonb),
    'daily_trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', sales_date, 'units_sold', units_sold,
        'revenue_cents', revenue_cents, 'failed_vends', failed_vends
      ) order by sales_date)
      from (
        select sales_date, sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered group by sales_date
      ) d
    ), '[]'::jsonb),
    'by_branch', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch', branch, 'units_sold', units_sold,
        'revenue_cents', revenue_cents, 'failed_vends', failed_vends
      ) order by units_sold desc)
      from (
        select branch, sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered group by branch
      ) b
    ), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_key', product_key, 'sku', sku, 'product_name', product_name,
        'brand', brand, 'units_sold', units_sold,
        'revenue_cents', revenue_cents, 'failed_vends', failed_vends
      ) order by units_sold desc)
      from (
        select product_key, max(sku) as sku, max(product_name) as product_name,
               max(brand) as brand, sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered group by product_key order by units_sold desc limit 10
      ) i
    ), '[]'::jsonb),
    'top_machines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'machine_id', machine_id, 'machine_name', machine_name,
        'serial_number', serial_number, 'location', location, 'branch', branch,
        'units_sold', units_sold, 'revenue_cents', revenue_cents,
        'failed_vends', failed_vends
      ) order by units_sold desc)
      from (
        select machine_id, max(machine_name_snapshot) as machine_name,
               max(machine_serial_snapshot) as serial_number,
               max(location_snapshot) as location, max(branch) as branch,
               sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered group by machine_id order by units_sold desc limit 10
      ) m
    ), '[]'::jsonb),
    'recent_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'sales_date', sales_date, 'machine_id', machine_id,
        'machine_name', machine_name_snapshot, 'serial_number', machine_serial_snapshot,
        'location', location_snapshot, 'branch', branch,
        'selection_code', selection_code, 'sku', sku, 'product_name', product_name,
        'brand', brand, 'units_sold', units_sold, 'failed_vends', failed_vends,
        'revenue_cents', revenue_cents, 'last_received_at', last_received_at
      ) order by sales_date desc, last_received_at desc)
      from (select * from filtered order by sales_date desc, last_received_at desc limit 250) r
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;
