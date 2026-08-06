create table if not exists public.telemetry_devices (
  id uuid primary key default gen_random_uuid(),
  device_code text not null unique
    check (char_length(device_code) between 3 and 80),
  machine_id uuid references public.machines(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'retired')),
  credential_hash text not null
    check (credential_hash ~ '^[0-9a-f]{64}$'),
  profile_id text,
  location_override text,
  firmware_version text,
  wifi_rssi integer,
  last_seen_at timestamptz,
  last_upload_at timestamptz,
  last_boot_id text,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_counter_epoch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telemetry_counter_state (
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  selection_code text not null
    check (char_length(selection_code) between 1 and 40),
  counter_epoch text not null,
  sold_total bigint not null default 0 check (sold_total >= 0),
  failed_total bigint not null default 0 check (failed_total >= 0),
  revenue_cents_total bigint not null default 0 check (revenue_cents_total >= 0),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now(),
  primary key (device_id, selection_code)
);

create table if not exists public.telemetry_daily_item_sales (
  id uuid primary key default gen_random_uuid(),
  sales_date date not null,
  device_id uuid not null references public.telemetry_devices(id) on delete restrict,
  machine_id uuid references public.machines(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  branch text not null default 'national'
    check (branch in ('jhb', 'cpt', 'kzn', 'national')),
  machine_serial_snapshot text not null,
  machine_name_snapshot text,
  location_snapshot text,
  selection_code text not null,
  product_key text not null,
  sku text,
  product_name text,
  brand text,
  configured_price_cents integer check (configured_price_cents is null or configured_price_cents >= 0),
  units_sold bigint not null default 0 check (units_sold >= 0),
  failed_vends bigint not null default 0 check (failed_vends >= 0),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  first_counter bigint,
  last_counter bigint,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  unique (sales_date, device_id, selection_code, product_key)
);

create table if not exists public.telemetry_diagnostics (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  diagnostic_type text not null,
  source text,
  raw_text text,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists telemetry_devices_last_seen_idx
  on public.telemetry_devices(last_seen_at desc);
create index if not exists telemetry_devices_machine_id_idx
  on public.telemetry_devices(machine_id) where machine_id is not null;
create index if not exists telemetry_devices_site_id_idx
  on public.telemetry_devices(site_id) where site_id is not null;
create index if not exists telemetry_daily_sales_date_idx
  on public.telemetry_daily_item_sales(sales_date desc);
create index if not exists telemetry_daily_machine_date_idx
  on public.telemetry_daily_item_sales(machine_id, sales_date desc);
create index if not exists telemetry_daily_sku_date_idx
  on public.telemetry_daily_item_sales(sku, sales_date desc);
create index if not exists telemetry_daily_branch_date_idx
  on public.telemetry_daily_item_sales(branch, sales_date desc);
create index if not exists telemetry_daily_device_id_idx
  on public.telemetry_daily_item_sales(device_id);
create index if not exists telemetry_daily_site_id_idx
  on public.telemetry_daily_item_sales(site_id) where site_id is not null;
create index if not exists telemetry_diagnostics_received_idx
  on public.telemetry_diagnostics(received_at desc);
create index if not exists telemetry_diagnostics_device_id_idx
  on public.telemetry_diagnostics(device_id);
create index if not exists telemetry_diagnostics_machine_id_idx
  on public.telemetry_diagnostics(machine_id) where machine_id is not null;

alter table public.telemetry_devices enable row level security;
alter table public.telemetry_counter_state enable row level security;
alter table public.telemetry_daily_item_sales enable row level security;
alter table public.telemetry_diagnostics enable row level security;

drop policy if exists telemetry_devices_read_admin_exec on public.telemetry_devices;
create policy telemetry_devices_read_admin_exec
  on public.telemetry_devices for select to authenticated
  using (public.current_app_role() in ('admin', 'executive'));

drop policy if exists telemetry_devices_admin_insert on public.telemetry_devices;
create policy telemetry_devices_admin_insert
  on public.telemetry_devices for insert to authenticated
  with check (public.current_app_role() = 'admin');

drop policy if exists telemetry_devices_admin_update on public.telemetry_devices;
create policy telemetry_devices_admin_update
  on public.telemetry_devices for update to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

drop policy if exists telemetry_devices_admin_delete on public.telemetry_devices;
create policy telemetry_devices_admin_delete
  on public.telemetry_devices for delete to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists telemetry_state_admin_read on public.telemetry_counter_state;
create policy telemetry_state_admin_read
  on public.telemetry_counter_state for select to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists telemetry_sales_read_admin_exec on public.telemetry_daily_item_sales;
create policy telemetry_sales_read_admin_exec
  on public.telemetry_daily_item_sales for select to authenticated
  using (public.current_app_role() in ('admin', 'executive'));

drop policy if exists telemetry_diagnostics_admin_read on public.telemetry_diagnostics;
create policy telemetry_diagnostics_admin_read
  on public.telemetry_diagnostics for select to authenticated
  using (public.current_app_role() = 'admin');

grant select, insert, update, delete on public.telemetry_devices to authenticated;
grant select on public.telemetry_counter_state to authenticated;
grant select on public.telemetry_daily_item_sales to authenticated;
grant select on public.telemetry_diagnostics to authenticated;

create or replace function public.ingest_telemetry_payload(
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
  v_type text := lower(coalesce(p_payload ->> 'type', ''));
  v_boot_id text := coalesce(p_payload ->> 'boot_id', '');
  v_counter_epoch text := coalesce(nullif(p_payload ->> 'counter_epoch', ''), 'unknown');
  v_sequence bigint := coalesce(nullif(p_payload ->> 'sequence', '')::bigint, 0);
  v_firmware text := coalesce(nullif(p_payload ->> 'firmware', ''), nullif(p_payload ->> 'firmware_version', ''));
  v_wifi_rssi integer := coalesce(nullif(p_payload ->> 'wifi_rssi', '')::integer, 0);
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_state public.telemetry_counter_state%rowtype;
  v_state_exists boolean;
  v_selection text;
  v_sku text;
  v_product text;
  v_brand text;
  v_product_key text;
  v_price integer;
  v_sold_total bigint;
  v_failed_total bigint;
  v_revenue_total bigint;
  v_delta_sold bigint;
  v_delta_failed bigint;
  v_delta_revenue bigint;
  v_processed_items integer := 0;
  v_changed_items integer := 0;
  v_sales_date date := (now() at time zone 'Africa/Johannesburg')::date;
  v_machine_id uuid;
  v_site_id uuid;
  v_branch text := 'national';
  v_machine_serial text;
  v_machine_name text;
  v_machine_location text;
  v_db_serial text;
  v_db_name text;
  v_db_location text;
  v_db_branch text;
  v_db_site_id uuid;
begin
  select *
    into v_device
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
       set last_seen_at = now(),
           firmware_version = coalesce(v_firmware, firmware_version),
           wifi_rssi = v_wifi_rssi,
           updated_at = now()
     where id = v_device.id;

    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'sequence', v_sequence,
      'assignment_status', case when v_device.machine_id is null then 'unassigned' else 'assigned' end
    );
  end if;

  v_machine_id := v_device.machine_id;
  v_site_id := v_device.site_id;

  if v_machine_id is not null then
    select m.serial_number, m.machine_name, m.current_custodian, m.branch, m.site_id
      into v_db_serial, v_db_name, v_db_location, v_db_branch, v_db_site_id
    from public.machines m
    where m.id = v_machine_id;

    v_site_id := coalesce(v_site_id, v_db_site_id);
    v_branch := coalesce(v_db_branch, 'national');
  end if;

  v_machine_serial := coalesce(v_db_serial, nullif(p_payload ->> 'machine_serial', ''), v_device.device_code);
  if v_machine_serial = 'SERVER_ASSIGNED' then
    v_machine_serial := v_device.device_code;
  end if;

  v_machine_name := coalesce(v_db_name, nullif(p_payload ->> 'profile_id', ''), v_device.profile_id, 'Unassigned telemetry machine');
  v_machine_location := coalesce(v_device.location_override, v_db_location, nullif(p_payload ->> 'location_code', ''), 'UNASSIGNED');
  if v_machine_location = 'SERVER_ASSIGNED' then
    v_machine_location := 'UNASSIGNED';
  end if;

  if v_type = 'diagnostic' then
    insert into public.telemetry_diagnostics (
      device_id, machine_id, diagnostic_type, source, raw_text, detail, metadata
    ) values (
      v_device.id,
      v_machine_id,
      left(coalesce(p_payload ->> 'diagnostic_type', 'unknown'), 80),
      left(coalesce(p_payload ->> 'source', ''), 80),
      left(coalesce(p_payload ->> 'raw', ''), 500),
      left(coalesce(p_payload ->> 'detail', ''), 500),
      jsonb_build_object('boot_id', v_boot_id, 'sequence', v_sequence, 'counter_epoch', v_counter_epoch)
    );

    update public.telemetry_devices
       set firmware_version = coalesce(v_firmware, firmware_version),
           wifi_rssi = v_wifi_rssi,
           last_seen_at = now(),
           last_upload_at = now(),
           last_boot_id = nullif(v_boot_id, ''),
           last_sequence = greatest(last_sequence, v_sequence),
           last_counter_epoch = v_counter_epoch,
           updated_at = now()
     where id = v_device.id;

    return jsonb_build_object('accepted', true, 'duplicate', false, 'diagnostic', true);
  end if;

  if v_type <> 'counter_snapshot' then
    raise exception 'Unsupported telemetry payload type: %', v_type using errcode = '22023';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(v_items) > 16 then
    raise exception 'A maximum of 16 items is allowed per batch' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    v_processed_items := v_processed_items + 1;
    v_selection := left(trim(coalesce(v_item ->> 'selection', '')), 40);
    if v_selection = '' then
      raise exception 'Each item requires a selection code' using errcode = '22023';
    end if;

    v_sku := nullif(left(trim(coalesce(v_item ->> 'sku', '')), 120), '');
    v_product := nullif(left(trim(coalesce(v_item ->> 'product', '')), 160), '');
    v_brand := nullif(left(trim(coalesce(v_item ->> 'brand', '')), 120), '');
    v_product_key := coalesce(v_sku, v_selection);
    v_price := case
      when nullif(v_item ->> 'configured_price_cents', '') is null then null
      else (v_item ->> 'configured_price_cents')::integer
    end;
    v_sold_total := coalesce(nullif(v_item ->> 'sold_total', '')::bigint, 0);
    v_failed_total := coalesce(nullif(v_item ->> 'failed_total', '')::bigint, 0);
    v_revenue_total := coalesce(nullif(v_item ->> 'revenue_cents_total', '')::bigint, 0);

    if v_sold_total < 0 or v_failed_total < 0 or v_revenue_total < 0 then
      raise exception 'Telemetry counters cannot be negative' using errcode = '22023';
    end if;

    select *
      into v_state
    from public.telemetry_counter_state
    where device_id = v_device.id
      and selection_code = v_selection
    for update;
    v_state_exists := found;

    if not v_state_exists or v_state.counter_epoch <> v_counter_epoch then
      v_delta_sold := v_sold_total;
      v_delta_failed := v_failed_total;
      v_delta_revenue := v_revenue_total;
    elsif v_sold_total < v_state.sold_total
       or v_failed_total < v_state.failed_total
       or v_revenue_total < v_state.revenue_cents_total then
      v_delta_sold := 0;
      v_delta_failed := 0;
      v_delta_revenue := 0;

      insert into public.telemetry_diagnostics (
        device_id, machine_id, diagnostic_type, source, detail, metadata
      ) values (
        v_device.id,
        v_machine_id,
        'counter_decrease',
        'ingest',
        'A cumulative counter decreased without a new counter epoch. The new value was accepted as the baseline without adding sales.',
        jsonb_build_object(
          'selection', v_selection,
          'previous_sold', v_state.sold_total,
          'new_sold', v_sold_total,
          'previous_failed', v_state.failed_total,
          'new_failed', v_failed_total,
          'previous_revenue', v_state.revenue_cents_total,
          'new_revenue', v_revenue_total
        )
      );
    else
      v_delta_sold := v_sold_total - v_state.sold_total;
      v_delta_failed := v_failed_total - v_state.failed_total;
      v_delta_revenue := v_revenue_total - v_state.revenue_cents_total;
    end if;

    insert into public.telemetry_counter_state (
      device_id, selection_code, counter_epoch, sold_total, failed_total,
      revenue_cents_total, last_sequence, updated_at
    ) values (
      v_device.id, v_selection, v_counter_epoch, v_sold_total, v_failed_total,
      v_revenue_total, v_sequence, now()
    )
    on conflict (device_id, selection_code)
    do update set
      counter_epoch = excluded.counter_epoch,
      sold_total = excluded.sold_total,
      failed_total = excluded.failed_total,
      revenue_cents_total = excluded.revenue_cents_total,
      last_sequence = excluded.last_sequence,
      updated_at = now();

    if v_delta_sold > 0 or v_delta_failed > 0 or v_delta_revenue > 0 then
      v_changed_items := v_changed_items + 1;

      insert into public.telemetry_daily_item_sales (
        sales_date, device_id, machine_id, site_id, branch,
        machine_serial_snapshot, machine_name_snapshot, location_snapshot,
        selection_code, product_key, sku, product_name, brand,
        configured_price_cents, units_sold, failed_vends, revenue_cents,
        first_counter, last_counter, first_received_at, last_received_at
      ) values (
        v_sales_date, v_device.id, v_machine_id, v_site_id, v_branch,
        v_machine_serial, v_machine_name, v_machine_location,
        v_selection, v_product_key, v_sku, v_product, v_brand,
        v_price, v_delta_sold, v_delta_failed, v_delta_revenue,
        case when v_state_exists then v_state.sold_total else 0 end,
        v_sold_total, now(), now()
      )
      on conflict (sales_date, device_id, selection_code, product_key)
      do update set
        machine_id = excluded.machine_id,
        site_id = excluded.site_id,
        branch = excluded.branch,
        machine_serial_snapshot = excluded.machine_serial_snapshot,
        machine_name_snapshot = excluded.machine_name_snapshot,
        location_snapshot = excluded.location_snapshot,
        sku = coalesce(excluded.sku, public.telemetry_daily_item_sales.sku),
        product_name = coalesce(excluded.product_name, public.telemetry_daily_item_sales.product_name),
        brand = coalesce(excluded.brand, public.telemetry_daily_item_sales.brand),
        configured_price_cents = coalesce(excluded.configured_price_cents, public.telemetry_daily_item_sales.configured_price_cents),
        units_sold = public.telemetry_daily_item_sales.units_sold + excluded.units_sold,
        failed_vends = public.telemetry_daily_item_sales.failed_vends + excluded.failed_vends,
        revenue_cents = public.telemetry_daily_item_sales.revenue_cents + excluded.revenue_cents,
        last_counter = excluded.last_counter,
        last_received_at = now();
    end if;
  end loop;

  update public.telemetry_devices
     set profile_id = coalesce(nullif(p_payload ->> 'profile_id', ''), profile_id),
         firmware_version = coalesce(v_firmware, firmware_version),
         wifi_rssi = v_wifi_rssi,
         last_seen_at = now(),
         last_upload_at = now(),
         last_boot_id = nullif(v_boot_id, ''),
         last_sequence = greatest(last_sequence, v_sequence),
         last_counter_epoch = v_counter_epoch,
         updated_at = now()
   where id = v_device.id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'processed_items', v_processed_items,
    'changed_items', v_changed_items,
    'sales_date', v_sales_date,
    'assignment_status', case when v_machine_id is null then 'unassigned' else 'assigned' end
  );
end;
$$;

revoke all on function public.ingest_telemetry_payload(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload(uuid, jsonb) to service_role;
