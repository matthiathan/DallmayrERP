create table if not exists public.telemetry_simulation_counter_state (
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  selection_code text not null,
  boot_id text,
  sold_total bigint not null default 0,
  failed_total bigint not null default 0,
  revenue_cents_total bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, selection_code),
  constraint telemetry_simulation_counter_nonnegative check (sold_total >= 0 and failed_total >= 0 and revenue_cents_total >= 0)
);

create table if not exists public.telemetry_daily_simulation_sales (
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  sales_date date not null,
  selection_code text not null,
  machine_id uuid references public.machines(id) on delete set null,
  machine_name_snapshot text,
  machine_serial_snapshot text,
  branch text not null default 'unassigned',
  product_name text,
  units_sold bigint not null default 0,
  failed_vends bigint not null default 0,
  revenue_cents bigint not null default 0,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  primary key (device_id, sales_date, selection_code),
  constraint telemetry_daily_simulation_nonnegative check (units_sold >= 0 and failed_vends >= 0 and revenue_cents >= 0)
);

alter table public.telemetry_simulation_counter_state enable row level security;
alter table public.telemetry_daily_simulation_sales enable row level security;
revoke all on table public.telemetry_simulation_counter_state from public, anon, authenticated;
revoke all on table public.telemetry_daily_simulation_sales from public, anon, authenticated;
grant select, insert, update, delete on table public.telemetry_simulation_counter_state to service_role;
grant select, insert, update, delete on table public.telemetry_daily_simulation_sales to service_role;

create index if not exists telemetry_daily_simulation_sales_date_idx
  on public.telemetry_daily_simulation_sales(sales_date desc);
create index if not exists telemetry_daily_simulation_sales_branch_date_idx
  on public.telemetry_daily_simulation_sales(branch, sales_date desc);
create index if not exists telemetry_daily_simulation_sales_machine_date_idx
  on public.telemetry_daily_simulation_sales(machine_id, sales_date desc)
  where machine_id is not null;

create or replace function public.ingest_telemetry_simulation_snapshot(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_policy jsonb;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_boot_id text := nullif(p_payload ->> 'boot_id', '');
  v_sequence bigint := coalesce(nullif(p_payload ->> 'sequence', '')::bigint, 0);
  v_firmware text := nullif(p_payload ->> 'firmware', '');
  v_item jsonb;
  v_selection text;
  v_product text;
  v_current_sold bigint;
  v_current_failed bigint;
  v_current_revenue bigint;
  v_previous public.telemetry_simulation_counter_state%rowtype;
  v_delta_sold bigint;
  v_delta_failed bigint;
  v_delta_revenue bigint;
  v_delta_units_total bigint := 0;
  v_delta_revenue_total bigint := 0;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_machine_name text;
  v_machine_serial text;
  v_branch text := 'unassigned';
begin
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Simulation items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 16 then
    raise exception 'Simulation snapshot supports at most 16 items' using errcode = '22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then raise exception 'Telemetry device not found' using errcode = '22023'; end if;
  if v_device.status <> 'active' then raise exception 'Telemetry device is not active' using errcode = '42501'; end if;

  if v_device.machine_id is not null then
    select m.machine_name, m.serial_number, coalesce(nullif(m.branch, ''), 'unassigned')
      into v_machine_name, v_machine_serial, v_branch
    from public.machines m
    where m.id = v_device.machine_id;
  end if;

  v_policy := public.get_effective_telemetry_policy(v_device.id);

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    v_selection := left(coalesce(nullif(trim(v_item ->> 'selection'), ''), 'unknown'), 80);
    v_product := left(coalesce(nullif(trim(v_item ->> 'product'), ''), v_selection), 160);
    v_current_sold := greatest(coalesce(nullif(v_item ->> 'sold_total', '')::bigint, 0), 0);
    v_current_failed := greatest(coalesce(nullif(v_item ->> 'failed_total', '')::bigint, 0), 0);
    v_current_revenue := greatest(coalesce(nullif(v_item ->> 'revenue_cents_total', '')::bigint, 0), 0);

    select * into v_previous
    from public.telemetry_simulation_counter_state
    where device_id = v_device.id and selection_code = v_selection
    for update;

    if not found then
      insert into public.telemetry_simulation_counter_state(
        device_id, selection_code, boot_id, sold_total, failed_total, revenue_cents_total, updated_at
      ) values (
        v_device.id, v_selection, v_boot_id, v_current_sold, v_current_failed, v_current_revenue, now()
      );
      continue;
    end if;

    if v_previous.boot_id is distinct from v_boot_id
       or v_current_sold < v_previous.sold_total
       or v_current_failed < v_previous.failed_total
       or v_current_revenue < v_previous.revenue_cents_total then
      v_delta_sold := 0;
      v_delta_failed := 0;
      v_delta_revenue := 0;
    else
      v_delta_sold := v_current_sold - v_previous.sold_total;
      v_delta_failed := v_current_failed - v_previous.failed_total;
      v_delta_revenue := v_current_revenue - v_previous.revenue_cents_total;
    end if;

    update public.telemetry_simulation_counter_state
    set boot_id = v_boot_id,
        sold_total = v_current_sold,
        failed_total = v_current_failed,
        revenue_cents_total = v_current_revenue,
        updated_at = now()
    where device_id = v_device.id and selection_code = v_selection;

    if v_delta_sold > 0 or v_delta_failed > 0 or v_delta_revenue > 0 then
      insert into public.telemetry_daily_simulation_sales(
        device_id, sales_date, selection_code, machine_id, machine_name_snapshot,
        machine_serial_snapshot, branch, product_name, units_sold, failed_vends,
        revenue_cents, first_received_at, last_received_at
      ) values (
        v_device.id, v_today, v_selection, v_device.machine_id, v_machine_name,
        v_machine_serial, v_branch, v_product, v_delta_sold, v_delta_failed,
        v_delta_revenue, now(), now()
      )
      on conflict (device_id, sales_date, selection_code) do update set
        machine_id = excluded.machine_id,
        machine_name_snapshot = excluded.machine_name_snapshot,
        machine_serial_snapshot = excluded.machine_serial_snapshot,
        branch = excluded.branch,
        product_name = excluded.product_name,
        units_sold = public.telemetry_daily_simulation_sales.units_sold + excluded.units_sold,
        failed_vends = public.telemetry_daily_simulation_sales.failed_vends + excluded.failed_vends,
        revenue_cents = public.telemetry_daily_simulation_sales.revenue_cents + excluded.revenue_cents,
        last_received_at = now();

      v_delta_units_total := v_delta_units_total + v_delta_sold;
      v_delta_revenue_total := v_delta_revenue_total + v_delta_revenue;
    end if;
  end loop;

  update public.telemetry_devices
  set firmware_version = coalesce(v_firmware, firmware_version),
      last_seen_at = now(),
      last_upload_at = now(),
      last_counter_at = now(),
      last_boot_id = coalesce(v_boot_id, last_boot_id),
      last_sequence = greatest(last_sequence, v_sequence),
      updated_at = now()
  where id = v_device.id;

  insert into public.telemetry_machine_state (
    device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
    machine_status, active_fault_count, last_counter_at, last_device_contact_at,
    simulation_mode, simulated_counters, last_simulation_at, updated_at
  ) values (
    v_device.id, v_device.machine_id, v_device.site_id,
    nullif(v_policy ->> 'id', '')::uuid, coalesce(v_policy ->> 'mode', 'live'),
    'online', 0, now(), now(), true, v_items, now(), now()
  )
  on conflict (device_id) do update set
    machine_id = excluded.machine_id,
    site_id = excluded.site_id,
    effective_policy_id = excluded.effective_policy_id,
    telemetry_mode = excluded.telemetry_mode,
    machine_status = case when public.telemetry_machine_state.active_fault_count = 0 then 'online' else public.telemetry_machine_state.machine_status end,
    last_counter_at = now(),
    last_device_contact_at = now(),
    simulation_mode = true,
    simulated_counters = excluded.simulated_counters,
    last_simulation_at = now(),
    updated_at = now();

  return jsonb_build_object(
    'accepted', true,
    'simulation', true,
    'item_count', jsonb_array_length(v_items),
    'daily_delta_units', v_delta_units_total,
    'daily_delta_revenue_cents', v_delta_revenue_total,
    'telemetry_mode', coalesce(v_policy ->> 'mode', 'live')
  );
end;
$$;

revoke all on function public.ingest_telemetry_simulation_snapshot(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_simulation_snapshot(uuid,jsonb) to service_role;

create or replace function public.get_telemetry_reporting(
  p_period text default 'day',
  p_branch text default 'all',
  p_dataset text default 'production'
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
      'online_devices', (select count(*) from public.telemetry_devices where status = 'active' and last_seen_at >= now() - interval '30 minutes'),
      'offline_devices', (select count(*) from public.telemetry_devices where status = 'active' and (last_seen_at is null or last_seen_at < now() - interval '30 minutes')),
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

revoke all on function public.get_telemetry_reporting(text,text,text) from public, anon;
grant execute on function public.get_telemetry_reporting(text,text,text) to authenticated;
