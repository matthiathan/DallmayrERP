-- Production-readiness hardening for Security Definer operations used by
-- Machines and Telemetry Device Management. RLS cannot be relied upon inside
-- these functions, so every read/mutation must enforce the operator's selected
-- telemetry region explicitly.

create or replace function public.search_machine_assets(
  p_search text default null::text,
  p_branch text default null::text,
  p_status text default null::text,
  p_unlinked boolean default null::boolean,
  p_offset integer default 0,
  p_limit integer default 100
)
returns table(
  id uuid,
  branch text,
  customer_id uuid,
  site_id uuid,
  serial_number text,
  machine_barcode text,
  machine_name text,
  model text,
  status text,
  condition text,
  criticality text,
  custody_status text,
  current_custodian text,
  next_audit_at timestamp with time zone,
  created_at timestamp with time zone,
  customer_name text,
  site_name text,
  site_address text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
begin
  return query
  with filtered as (
    select
      m.id,
      m.branch,
      m.customer_id,
      m.site_id,
      m.serial_number,
      m.machine_barcode,
      m.machine_name,
      m.model,
      m.status,
      m.condition,
      m.criticality,
      m.custody_status,
      m.current_custodian,
      m.next_audit_at,
      m.created_at,
      c.customer_name,
      s.site_name,
      s.address as site_address
    from public.machines m
    left join public.customers c on c.id = m.customer_id
    left join public.customer_sites s on s.id = m.site_id
    where m.telemetry_region = v_region
      and (coalesce(p_branch, 'all') = 'all' or m.branch = p_branch)
      and (coalesce(p_status, 'all') = 'all' or m.status = p_status)
      and (
        p_unlinked is null
        or (p_unlinked = true and m.customer_id is null)
        or (p_unlinked = false and m.customer_id is not null)
      )
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or m.machine_name ilike '%' || trim(p_search) || '%'
        or m.serial_number ilike '%' || trim(p_search) || '%'
        or m.machine_barcode ilike '%' || trim(p_search) || '%'
        or m.model ilike '%' || trim(p_search) || '%'
        or m.branch ilike '%' || trim(p_search) || '%'
        or m.status ilike '%' || trim(p_search) || '%'
        or c.customer_name ilike '%' || trim(p_search) || '%'
        or s.site_name ilike '%' || trim(p_search) || '%'
        or s.address ilike '%' || trim(p_search) || '%'
        or m.id::text = trim(p_search)
      )
  )
  select
    filtered.*,
    count(*) over() as total_count
  from filtered
  order by coalesce(filtered.machine_name, filtered.serial_number, filtered.machine_barcode, filtered.id::text) asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.save_telemetry_device_configuration(
  p_device_id uuid,
  p_device_code text,
  p_machine_id uuid default null::uuid,
  p_status text default 'active'::text,
  p_mode text default 'live'::text,
  p_transport_preference text default 'auto'::text,
  p_wifi_enabled boolean default true,
  p_cellular_enabled boolean default true,
  p_mdb_master_polarity text default 'auto'::text,
  p_mdb_slave_polarity text default 'auto'::text,
  p_mdb_pin_swap boolean default false,
  p_location_enabled boolean default true,
  p_location_override text default null::text,
  p_location_interval_minutes integer default 15,
  p_location_min_move_m integer default 50,
  p_warning_megabytes integer default 100,
  p_critical_megabytes integer default 25,
  p_balance_check_interval_minutes integer default 360,
  p_balance_stale_after_minutes integer default 720
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_policy_id uuid;
  v_site_id uuid;
  v_status text := lower(trim(coalesce(p_status, 'active')));
  v_mode text := lower(trim(coalesce(p_mode, 'live')));
  v_transport text := lower(trim(coalesce(p_transport_preference, 'auto')));
  v_master_polarity text := lower(trim(coalesce(p_mdb_master_polarity, 'auto')));
  v_slave_polarity text := lower(trim(coalesce(p_mdb_slave_polarity, 'auto')));
  v_override text := nullif(trim(coalesce(p_location_override, '')), '');
  v_warning_bytes bigint;
  v_critical_bytes bigint;
  v_request_id uuid;
  v_requested jsonb;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Telemetry device not found in the selected region.' using errcode = '22023';
  end if;
  if trim(coalesce(p_device_code, '')) <> v_device.device_code then
    raise exception 'Telemetry device ID does not match.' using errcode = '22023';
  end if;

  if v_status not in ('active','disabled') then
    raise exception 'Device status must be active or disabled.' using errcode = '22023';
  end if;
  if v_mode not in ('live','daily','monthly') then
    raise exception 'Reporting mode must be live, daily or monthly.' using errcode = '22023';
  end if;
  if v_transport not in ('auto','wifi','cellular') then
    raise exception 'Transport must be auto, wifi or cellular.' using errcode = '22023';
  end if;
  if not coalesce(p_wifi_enabled, false) and not coalesce(p_cellular_enabled, false) then
    raise exception 'At least one telemetry transport must remain enabled.' using errcode = '22023';
  end if;
  if v_transport = 'wifi' and not coalesce(p_wifi_enabled, false) then
    raise exception 'Wi-Fi must be enabled when Wi-Fi is preferred.' using errcode = '22023';
  end if;
  if v_transport = 'cellular' and not coalesce(p_cellular_enabled, false) then
    raise exception 'Cellular must be enabled when cellular is preferred.' using errcode = '22023';
  end if;
  if v_master_polarity not in ('auto','normal','inverted') or v_slave_polarity not in ('auto','normal','inverted') then
    raise exception 'MDB polarity must be auto, normal or inverted.' using errcode = '22023';
  end if;
  if p_location_interval_minutes is null or p_location_interval_minutes not between 1 and 1440 then
    raise exception 'Location interval must be 1 to 1440 minutes.' using errcode = '22023';
  end if;
  if p_location_min_move_m is null or p_location_min_move_m not between 5 and 10000 then
    raise exception 'Movement threshold must be 5 to 10000 metres.' using errcode = '22023';
  end if;
  if p_critical_megabytes is null or p_warning_megabytes is null or p_critical_megabytes < 0 or p_warning_megabytes <= p_critical_megabytes then
    raise exception 'Warning MB must be greater than critical MB, and both must be non-negative.' using errcode = '22023';
  end if;
  if p_balance_check_interval_minutes is null or p_balance_check_interval_minutes not between 15 and 1440 then
    raise exception 'Balance check interval must be 15 to 1440 minutes.' using errcode = '22023';
  end if;
  if p_balance_stale_after_minutes is null or p_balance_stale_after_minutes not between p_balance_check_interval_minutes and 10080 then
    raise exception 'Balance stale interval must be at least the check interval and no more than 10080 minutes.' using errcode = '22023';
  end if;

  select id into v_policy_id
  from public.telemetry_policies
  where policy_code = v_mode
  limit 1;
  if v_policy_id is null then
    raise exception 'Telemetry reporting policy was not found.' using errcode = '22023';
  end if;

  if p_machine_id is not null then
    select m.site_id into v_site_id
    from public.machines m
    where m.id = p_machine_id
      and m.telemetry_region = v_region;
    if not found then
      raise exception 'Assigned machine was not found in the selected region.' using errcode = '22023';
    end if;
  end if;

  update public.telemetry_devices
  set machine_id = p_machine_id,
      site_id = v_site_id,
      status = v_status,
      telemetry_policy_id = v_policy_id,
      transport_preference = v_transport,
      wifi_enabled = p_wifi_enabled,
      cellular_enabled = p_cellular_enabled,
      mdb_master_polarity = v_master_polarity,
      mdb_slave_polarity = v_slave_polarity,
      mdb_pin_swap = coalesce(p_mdb_pin_swap, false),
      location_enabled = coalesce(p_location_enabled, true),
      location_override = v_override,
      location_interval_minutes = p_location_interval_minutes,
      location_min_move_m = p_location_min_move_m,
      updated_at = now()
  where id = p_device_id
    and telemetry_region = v_region;

  v_warning_bytes := p_warning_megabytes::bigint * 1048576;
  v_critical_bytes := p_critical_megabytes::bigint * 1048576;
  insert into public.telemetry_prepaid_balance_state (
    device_id, warning_threshold_bytes, critical_threshold_bytes,
    check_interval_minutes, stale_after_minutes, updated_at
  ) values (
    p_device_id, v_warning_bytes, v_critical_bytes,
    p_balance_check_interval_minutes, p_balance_stale_after_minutes, now()
  )
  on conflict (device_id) do update set
    warning_threshold_bytes = excluded.warning_threshold_bytes,
    critical_threshold_bytes = excluded.critical_threshold_bytes,
    check_interval_minutes = excluded.check_interval_minutes,
    stale_after_minutes = excluded.stale_after_minutes,
    updated_at = now();

  v_requested := jsonb_build_object(
    'machine_id', p_machine_id,
    'device_status', v_status,
    'mode', v_mode,
    'transport_preference', v_transport,
    'wifi_enabled', p_wifi_enabled,
    'cellular_enabled', p_cellular_enabled,
    'mdb_master_polarity', v_master_polarity,
    'mdb_slave_polarity', v_slave_polarity,
    'mdb_pin_swap', coalesce(p_mdb_pin_swap, false),
    'location_enabled', coalesce(p_location_enabled, true),
    'location_override', v_override,
    'location_interval_minutes', p_location_interval_minutes,
    'location_min_move_m', p_location_min_move_m,
    'prepaid_warning_megabytes', p_warning_megabytes,
    'prepaid_critical_megabytes', p_critical_megabytes,
    'prepaid_check_interval_minutes', p_balance_check_interval_minutes,
    'prepaid_stale_after_minutes', p_balance_stale_after_minutes
  );

  update public.telemetry_device_config_history
  set status = 'superseded'
  where device_id = p_device_id and status = 'pending';

  insert into public.telemetry_device_config_history (
    device_id, requested_by_auth_user_id, requested_config
  ) values (
    p_device_id, auth.uid(), v_requested
  ) returning id into v_request_id;

  return jsonb_build_object(
    'accepted', true,
    'device_id', p_device_id,
    'device_code', v_device.device_code,
    'request_id', v_request_id,
    'status', 'pending',
    'requested_at', now(),
    'requested_config', v_requested
  );
end;
$$;

create or replace function public.request_telemetry_prepaid_balance(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device_id uuid;
begin
  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code)
    and status = 'active'
    and telemetry_region = v_region;
  if not found then
    raise exception 'Active telemetry device not found in the selected region.' using errcode = '22023';
  end if;

  insert into public.telemetry_prepaid_balance_state (device_id, request_pending, requested_at, updated_at)
  values (v_device_id, true, now(), now())
  on conflict (device_id) do update
    set request_pending = true,
        requested_at = now(),
        updated_at = now();

  return jsonb_build_object('accepted', true, 'device_id', v_device_id, 'request_pending', true);
end;
$$;

create or replace function public.delete_telemetry_device(p_device_id uuid, p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_sales_rows bigint := 0;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Telemetry device not found in the selected region.' using errcode = 'P0002';
  end if;
  if trim(coalesce(p_device_code, '')) <> v_device.device_code then
    raise exception 'Enter the exact device ID to confirm deletion' using errcode = '22023';
  end if;

  select count(*) into v_sales_rows
  from public.telemetry_daily_item_sales
  where device_id = v_device.id;

  delete from public.telemetry_daily_item_sales where device_id = v_device.id;
  delete from public.telemetry_devices
  where id = v_device.id
    and telemetry_region = v_region;

  return jsonb_build_object(
    'deleted', true,
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'sales_rows_deleted', v_sales_rows
  );
end;
$$;

-- Preserve the existing callable surface: authenticated app sessions and the
-- service role may execute these RPCs; anon/public may not.
revoke all on function public.search_machine_assets(text, text, text, boolean, integer, integer) from public, anon;
revoke all on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) from public, anon;
revoke all on function public.request_telemetry_prepaid_balance(text) from public, anon;
revoke all on function public.delete_telemetry_device(uuid, text) from public, anon;

grant execute on function public.search_machine_assets(text, text, text, boolean, integer, integer) to authenticated, service_role;
grant execute on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.request_telemetry_prepaid_balance(text) to authenticated, service_role;
grant execute on function public.delete_telemetry_device(uuid, text) to authenticated, service_role;

comment on function public.search_machine_assets(text, text, text, boolean, integer, integer) is
  'Searches machine assets only within the authenticated operator selected telemetry region.';
comment on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) is
  'Atomically saves telemetry device configuration only when the device and assigned machine belong to the selected telemetry region.';
comment on function public.request_telemetry_prepaid_balance(text) is
  'Queues a prepaid balance check only for an active device in the selected telemetry region.';
comment on function public.delete_telemetry_device(uuid, text) is
  'Permanently deletes the exact confirmed telemetry device only from the selected telemetry region.';
