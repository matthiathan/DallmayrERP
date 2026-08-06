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
      'unassigned_devices', (select count(*) from public.telemetry_devices where status = 'active' and machine_id is null)
    ),
    'daily_trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', sales_date,
        'units_sold', units_sold,
        'revenue_cents', revenue_cents,
        'failed_vends', failed_vends
      ) order by sales_date)
      from (
        select sales_date,
               sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered
        group by sales_date
      ) d
    ), '[]'::jsonb),
    'by_branch', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch', branch,
        'units_sold', units_sold,
        'revenue_cents', revenue_cents,
        'failed_vends', failed_vends
      ) order by units_sold desc)
      from (
        select branch,
               sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered
        group by branch
      ) b
    ), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_key', product_key,
        'sku', sku,
        'product_name', product_name,
        'brand', brand,
        'units_sold', units_sold,
        'revenue_cents', revenue_cents,
        'failed_vends', failed_vends
      ) order by units_sold desc)
      from (
        select product_key,
               max(sku) as sku,
               max(product_name) as product_name,
               max(brand) as brand,
               sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered
        group by product_key
        order by units_sold desc
        limit 10
      ) i
    ), '[]'::jsonb),
    'top_machines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'machine_id', machine_id,
        'machine_name', machine_name,
        'serial_number', serial_number,
        'location', location,
        'branch', branch,
        'units_sold', units_sold,
        'revenue_cents', revenue_cents,
        'failed_vends', failed_vends
      ) order by units_sold desc)
      from (
        select machine_id,
               max(machine_name_snapshot) as machine_name,
               max(machine_serial_snapshot) as serial_number,
               max(location_snapshot) as location,
               max(branch) as branch,
               sum(units_sold)::bigint as units_sold,
               sum(revenue_cents)::bigint as revenue_cents,
               sum(failed_vends)::bigint as failed_vends
        from filtered
        group by machine_id
        order by units_sold desc
        limit 10
      ) m
    ), '[]'::jsonb),
    'recent_sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'sales_date', sales_date,
        'machine_id', machine_id,
        'machine_name', machine_name_snapshot,
        'serial_number', machine_serial_snapshot,
        'location', location_snapshot,
        'branch', branch,
        'selection_code', selection_code,
        'sku', sku,
        'product_name', product_name,
        'brand', brand,
        'units_sold', units_sold,
        'failed_vends', failed_vends,
        'revenue_cents', revenue_cents,
        'last_received_at', last_received_at
      ) order by sales_date desc, last_received_at desc)
      from (
        select *
        from filtered
        order by sales_date desc, last_received_at desc
        limit 250
      ) r
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_dashboard(text, text) from public, anon;
grant execute on function public.get_telemetry_dashboard(text, text) to authenticated;
