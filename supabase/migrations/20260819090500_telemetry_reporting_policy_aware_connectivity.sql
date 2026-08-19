create or replace function public.get_telemetry_reporting(
  p_period text default 'day'::text,
  p_branch text default 'all'::text,
  p_dataset text default 'production'::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_period text := lower(coalesce(nullif(trim(p_period), ''), 'day'));
  v_dataset text := lower(coalesce(nullif(trim(p_dataset), ''), 'production'));
  v_branch text := lower(coalesce(nullif(trim(p_branch), ''), 'all'));
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_from date;
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin', 'executive') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  if v_dataset not in ('production', 'simulation') then
    raise exception 'dataset must be production or simulation' using errcode = '22023';
  end if;

  v_from := case v_period
    when 'today' then v_today
    when 'day' then v_today
    when 'week' then v_today - 6
    when 'month' then v_today - 29
    when 'six_months' then (v_today - interval '6 months')::date
    else v_today
  end;

  with production_rows as (
    select
      s.id::text as id,
      s.sales_date,
      s.machine_id,
      s.machine_name_snapshot,
      s.machine_serial_snapshot,
      s.location_snapshot,
      s.branch,
      s.selection_code,
      s.product_key,
      s.sku,
      s.product_name,
      s.brand,
      s.units_sold::bigint as units_sold,
      s.failed_vends::bigint as failed_vends,
      s.revenue_cents::bigint as revenue_cents,
      s.last_received_at
    from public.telemetry_daily_item_sales s
    where v_dataset = 'production'
      and s.sales_date between v_from and v_today
      and (v_branch = 'all' or lower(s.branch) = v_branch)
  ),
  simulation_rows as (
    select
      concat('sim:', s.device_id::text, ':', s.sales_date::text, ':', s.selection_code) as id,
      s.sales_date,
      s.machine_id,
      s.machine_name_snapshot,
      s.machine_serial_snapshot,
      null::text as location_snapshot,
      s.branch,
      s.selection_code,
      concat('sim:', s.selection_code) as product_key,
      null::text as sku,
      s.product_name,
      'POC simulation'::text as brand,
      s.units_sold::bigint as units_sold,
      s.failed_vends::bigint as failed_vends,
      s.revenue_cents::bigint as revenue_cents,
      s.last_received_at
    from public.telemetry_daily_simulation_sales s
    where v_dataset = 'simulation'
      and s.sales_date between v_from and v_today
      and (v_branch = 'all' or lower(s.branch) = v_branch)
  ),
  filtered as (
    select * from production_rows
    union all
    select * from simulation_rows
  )
  select jsonb_build_object(
    'period', case when v_period = 'today' then 'day' else v_period end,
    'dataset', v_dataset,
    'date_from', v_from,
    'date_to', v_today,
    'availability', jsonb_build_object(
      'production_rows', (select count(*) from public.telemetry_daily_item_sales s where s.sales_date between v_from and v_today and (v_branch = 'all' or lower(s.branch) = v_branch)),
      'simulation_rows', (select count(*) from public.telemetry_daily_simulation_sales s where s.sales_date between v_from and v_today and (v_branch = 'all' or lower(s.branch) = v_branch)),
      'active_simulation_devices', (select count(*) from public.telemetry_machine_state ms join public.telemetry_devices d on d.id = ms.device_id where d.status='active' and ms.simulation_mode)
    ),
    'summary', jsonb_build_object(
      'units_sold', coalesce((select sum(units_sold) from filtered), 0),
      'revenue_cents', coalesce((select sum(revenue_cents) from filtered), 0),
      'failed_vends', coalesce((select sum(failed_vends) from filtered), 0),
      'active_machines', coalesce((select count(distinct machine_id) from filtered where machine_id is not null), 0),
      'reporting_devices', (select count(*) from public.telemetry_devices where status = 'active'),
      'online_devices', (
        select count(*)
        from public.telemetry_devices d
        cross join lateral public.get_telemetry_connectivity_state(d.id) c
        where d.status = 'active' and c.communication_status = 'online'
      ),
      'offline_devices', (
        select count(*)
        from public.telemetry_devices d
        cross join lateral public.get_telemetry_connectivity_state(d.id) c
        where d.status = 'active' and c.communication_status = 'offline'
      ),
      'unassigned_devices', (select count(*) from public.telemetry_devices where status = 'active' and machine_id is null)
    ),
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
