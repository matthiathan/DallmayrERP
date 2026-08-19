create or replace function public.get_telemetry_activity(
  p_period text default 'day',
  p_branch text default 'all',
  p_dataset text default 'production',
  p_kind text default 'all',
  p_search text default '',
  p_sort text default 'newest',
  p_direction text default 'desc',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_from date;
  v_dataset text := lower(coalesce(nullif(trim(p_dataset), ''), 'production'));
  v_kind text := lower(coalesce(nullif(trim(p_kind), ''), 'all'));
  v_sort text := lower(coalesce(nullif(trim(p_sort), ''), 'newest'));
  v_direction text := lower(coalesce(nullif(trim(p_direction), ''), 'desc'));
  v_search text := lower(trim(coalesce(p_search, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','executive','operations') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  if v_dataset not in ('production','simulation') then
    raise exception 'Invalid telemetry dataset' using errcode = '22023';
  end if;
  if v_kind not in ('all','sale','error') then
    raise exception 'Invalid telemetry activity kind' using errcode = '22023';
  end if;
  if v_sort not in ('newest','error','sales','machine') then
    raise exception 'Invalid telemetry activity sort' using errcode = '22023';
  end if;
  if v_direction not in ('asc','desc') then
    raise exception 'Invalid telemetry activity sort direction' using errcode = '22023';
  end if;

  v_from := case lower(coalesce(p_period, 'day'))
    when 'day' then (now() at time zone 'Africa/Johannesburg')::date
    when 'week' then (now() at time zone 'Africa/Johannesburg')::date - 6
    when 'month' then (now() at time zone 'Africa/Johannesburg')::date - 29
    when 'six_months' then ((now() at time zone 'Africa/Johannesburg')::date - interval '6 months')::date
    else (now() at time zone 'Africa/Johannesburg')::date
  end;

  with production_sales as (
    select
      'sale:' || s.id::text as activity_id,
      'sale'::text as activity_type,
      s.last_received_at as occurred_at,
      s.sales_date as activity_date,
      s.device_id,
      d.device_code,
      s.machine_id,
      coalesce(s.machine_name_snapshot, m.machine_name) as machine_name,
      coalesce(s.machine_serial_snapshot, m.serial_number) as serial_number,
      coalesce(s.branch, m.branch, 'unassigned') as branch,
      s.selection_code,
      coalesce(s.product_name, s.sku, s.product_key) as product_name,
      s.units_sold,
      s.failed_vends,
      s.revenue_cents,
      null::text as error_code,
      null::text as severity,
      null::text as detail,
      false as error_active,
      null::timestamptz as cleared_at
    from public.telemetry_daily_item_sales s
    left join public.telemetry_devices d on d.id = s.device_id
    left join public.machines m on m.id = s.machine_id
    where v_dataset = 'production'
      and s.sales_date >= v_from
      and (coalesce(nullif(lower(p_branch), ''), 'all') = 'all' or lower(coalesce(s.branch, m.branch, '')) = lower(p_branch))
  ),
  simulation_sales as (
    select
      'sim-sale:' || s.device_id::text || ':' || s.sales_date::text || ':' || s.selection_code as activity_id,
      'sale'::text as activity_type,
      s.last_received_at as occurred_at,
      s.sales_date as activity_date,
      s.device_id,
      d.device_code,
      s.machine_id,
      coalesce(s.machine_name_snapshot, m.machine_name) as machine_name,
      coalesce(s.machine_serial_snapshot, m.serial_number) as serial_number,
      coalesce(s.branch, m.branch, 'unassigned') as branch,
      s.selection_code,
      s.product_name,
      s.units_sold,
      s.failed_vends,
      s.revenue_cents,
      null::text as error_code,
      null::text as severity,
      null::text as detail,
      false as error_active,
      null::timestamptz as cleared_at
    from public.telemetry_daily_simulation_sales s
    join public.telemetry_devices d on d.id = s.device_id
    left join public.machines m on m.id = s.machine_id
    where v_dataset = 'simulation'
      and s.sales_date >= v_from
      and (coalesce(nullif(lower(p_branch), ''), 'all') = 'all' or lower(coalesce(s.branch, m.branch, '')) = lower(p_branch))
  ),
  fault_rows as (
    select
      'error:' || f.id::text as activity_id,
      'error'::text as activity_type,
      f.started_at as occurred_at,
      (f.started_at at time zone 'Africa/Johannesburg')::date as activity_date,
      f.device_id,
      d.device_code,
      f.machine_id,
      m.machine_name,
      m.serial_number,
      coalesce(m.branch, 'unassigned') as branch,
      null::text as selection_code,
      null::text as product_name,
      0::bigint as units_sold,
      0::bigint as failed_vends,
      0::bigint as revenue_cents,
      f.fault_code as error_code,
      f.severity,
      f.detail,
      (f.cleared_at is null) as error_active,
      f.cleared_at
    from public.telemetry_fault_events f
    join public.telemetry_devices d on d.id = f.device_id
    left join public.machines m on m.id = f.machine_id
    where v_dataset = 'production'
      and (f.started_at at time zone 'Africa/Johannesburg')::date >= v_from
      and (coalesce(nullif(lower(p_branch), ''), 'all') = 'all' or lower(coalesce(m.branch, '')) = lower(p_branch))
  ),
  activity as (
    select * from production_sales
    union all
    select * from simulation_sales
    union all
    select * from fault_rows
  ),
  filtered as (
    select *
    from activity a
    where (v_kind = 'all' or a.activity_type = v_kind)
      and (
        v_search = ''
        or lower(coalesce(a.machine_name, '')) like '%' || v_search || '%'
        or lower(coalesce(a.serial_number, '')) like '%' || v_search || '%'
        or lower(coalesce(a.device_code, '')) like '%' || v_search || '%'
        or lower(coalesce(a.product_name, '')) like '%' || v_search || '%'
        or lower(coalesce(a.selection_code, '')) like '%' || v_search || '%'
        or lower(coalesce(a.error_code, '')) like '%' || v_search || '%'
        or lower(coalesce(a.severity, '')) like '%' || v_search || '%'
        or lower(coalesce(a.detail, '')) like '%' || v_search || '%'
      )
  ),
  ordered as (
    select *
    from filtered
    order by
      case when v_sort = 'error' then case when activity_type = 'error' and error_active then 0 when activity_type = 'error' then 1 else 2 end end asc,
      case when v_sort = 'sales' and v_direction = 'desc' then units_sold end desc nulls last,
      case when v_sort = 'sales' and v_direction = 'asc' then units_sold end asc nulls last,
      case when v_sort = 'machine' and v_direction = 'asc' then lower(coalesce(machine_name, serial_number, device_code, '')) end asc nulls last,
      case when v_sort = 'machine' and v_direction = 'desc' then lower(coalesce(machine_name, serial_number, device_code, '')) end desc nulls last,
      case when v_sort = 'newest' and v_direction = 'asc' then occurred_at end asc nulls last,
      case when v_sort = 'newest' and v_direction = 'desc' then occurred_at end desc nulls last,
      occurred_at desc,
      activity_id
  ),
  page_rows as (
    select * from ordered limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'period', lower(coalesce(p_period, 'day')),
    'dataset', v_dataset,
    'date_from', v_from,
    'date_to', (now() at time zone 'Africa/Johannesburg')::date,
    'total', (select count(*) from filtered),
    'summary', jsonb_build_object(
      'sale_rows', (select count(*) from filtered where activity_type = 'sale'),
      'units_sold', coalesce((select sum(units_sold) from filtered where activity_type = 'sale'), 0),
      'revenue_cents', coalesce((select sum(revenue_cents) from filtered where activity_type = 'sale'), 0),
      'error_events', (select count(*) from filtered where activity_type = 'error'),
      'active_errors', (select count(*) from filtered where activity_type = 'error' and error_active)
    ),
    'rows', coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_activity(text,text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.get_telemetry_activity(text,text,text,text,text,text,text,integer,integer) to authenticated;
