-- Region-safe machine management: edit machine metadata and manually link/unlink
-- telemetry devices without bypassing selected-region boundaries.

create or replace function public.update_telemetry_machine(
  p_machine_id uuid,
  p_machine_name text,
  p_model text,
  p_manufacturer text,
  p_customer_id uuid,
  p_site_id uuid default null,
  p_serial_number text default null,
  p_machine_barcode text default null,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_machine public.machines%rowtype;
  v_customer public.customers%rowtype;
  v_site public.customer_sites%rowtype;
  v_name text := nullif(btrim(coalesce(p_machine_name, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_manufacturer text := nullif(btrim(coalesce(p_manufacturer, '')), '');
  v_serial text := nullif(btrim(coalesce(p_serial_number, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_machine_barcode, '')), '');
  v_status text := lower(btrim(coalesce(p_status, 'active')));
  v_branch text;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin', 'operations', 'technician', 'road_technician']);

  if p_machine_id is null or v_name is null or v_model is null or v_manufacturer is null
     or p_customer_id is null or v_serial is null or v_barcode is null then
    raise exception 'Asset Name, Machine Type, Brand, Client, Serial Number and QR Code Number are required.' using errcode = '22023';
  end if;
  if v_status not in ('active', 'inactive', 'repair', 'retired', 'unknown') then
    raise exception 'Machine status is invalid.' using errcode = '22023';
  end if;

  select m.* into v_machine
  from public.machines m
  where m.id = p_machine_id
    and m.telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Machine was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  select c.* into v_customer
  from public.customers c
  where c.id = p_customer_id
    and c.status = 'active'
  limit 1;
  if not found then
    raise exception 'Active client was not found.' using errcode = '22023';
  end if;

  if p_site_id is not null then
    select s.* into v_site
    from public.customer_sites s
    where s.id = p_site_id
      and s.customer_id = p_customer_id
      and s.telemetry_region = v_region
      and s.status = 'active'
    limit 1;
    if not found then
      raise exception 'Active site was not found for this client in the selected telemetry region.' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from public.machines m
    where m.id <> p_machine_id
      and m.telemetry_region = v_region
      and lower(btrim(coalesce(m.serial_number, ''))) = lower(v_serial)
  ) then
    raise exception 'Serial Number % already exists in the selected telemetry region.', v_serial using errcode = '23505';
  end if;

  if exists (
    select 1 from public.machines m
    where m.id <> p_machine_id
      and lower(btrim(coalesce(m.machine_barcode, ''))) = lower(v_barcode)
  ) then
    raise exception 'QR Code Number % already exists.', v_barcode using errcode = '23505';
  end if;

  v_branch := coalesce(nullif(btrim(v_site.branch), ''), nullif(btrim(v_customer.branch), ''), 'national');

  begin
    update public.machines
    set machine_name = v_name,
        model = v_model,
        manufacturer = v_manufacturer,
        customer_id = p_customer_id,
        site_id = p_site_id,
        branch = v_branch,
        serial_number = v_serial,
        machine_barcode = v_barcode,
        status = v_status,
        updated_at = now()
    where id = p_machine_id
      and telemetry_region = v_region;
  exception
    when unique_violation then
      raise exception 'Serial Number or QR Code Number already exists.' using errcode = '23505';
  end;

  update public.telemetry_devices
  set site_id = p_site_id,
      updated_at = now()
  where machine_id = p_machine_id
    and telemetry_region = v_region;

  return jsonb_build_object(
    'accepted', true,
    'machine_id', p_machine_id,
    'telemetry_region', v_region,
    'branch', v_branch,
    'status', v_status
  );
end;
$$;

create or replace function public.search_unlinked_telemetry_devices(
  p_search text default null,
  p_limit integer default 100
)
returns table(
  id uuid,
  device_code text,
  status text,
  hardware_uid text,
  firmware_version text,
  last_seen_at timestamp with time zone,
  last_transport text,
  cellular_operator text,
  machine_link_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.device_code,
    d.status,
    d.hardware_uid,
    d.firmware_version,
    d.last_seen_at,
    d.last_transport,
    d.cellular_operator,
    d.machine_link_status
  from public.telemetry_devices d
  where d.telemetry_region = v_region
    and d.machine_id is null
    and d.status <> 'retired'
    and (
      v_search is null
      or d.device_code ilike '%' || v_search || '%'
      or d.hardware_uid ilike '%' || v_search || '%'
      or d.firmware_version ilike '%' || v_search || '%'
      or d.cellular_operator ilike '%' || v_search || '%'
    )
  order by coalesce(d.last_seen_at, d.updated_at) desc nulls last, d.device_code asc
  limit least(greatest(coalesce(p_limit, 100), 1), 250);
end;
$$;

create or replace function public.link_telemetry_device(
  p_machine_id uuid,
  p_device_id uuid,
  p_device_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_machine public.machines%rowtype;
  v_device public.telemetry_devices%rowtype;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin', 'operations', 'technician', 'road_technician']);

  select m.* into v_machine
  from public.machines m
  where m.id = p_machine_id
    and m.telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Machine was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  select d.* into v_device
  from public.telemetry_devices d
  where d.id = p_device_id
    and d.telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Telemetry device was not found in the selected telemetry region.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_device_code, '')) <> v_device.device_code then
    raise exception 'Telemetry device ID does not match.' using errcode = '22023';
  end if;
  if v_device.status = 'retired' then
    raise exception 'A retired telemetry device cannot be linked.' using errcode = '22023';
  end if;
  if v_device.machine_id is not null and v_device.machine_id <> p_machine_id then
    raise exception 'Telemetry device is already linked to another machine.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.telemetry_devices d
    where d.machine_id = p_machine_id
      and d.telemetry_region = v_region
      and d.status <> 'retired'
      and d.id <> p_device_id
  ) then
    raise exception 'This machine already has a telemetry device linked.' using errcode = '23505';
  end if;

  update public.telemetry_devices
  set machine_id = p_machine_id,
      site_id = v_machine.site_id,
      machine_link_status = 'linked',
      machine_link_method = 'manual',
      machine_linked_at = now(),
      updated_at = now()
  where id = p_device_id
    and telemetry_region = v_region;

  return jsonb_build_object(
    'accepted', true,
    'machine_id', p_machine_id,
    'device_id', p_device_id,
    'device_code', v_device.device_code,
    'telemetry_region', v_region
  );
end;
$$;

create or replace function public.unlink_telemetry_device(
  p_machine_id uuid,
  p_device_id uuid,
  p_device_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin', 'operations', 'technician', 'road_technician']);

  if not exists (
    select 1 from public.machines m
    where m.id = p_machine_id
      and m.telemetry_region = v_region
  ) then
    raise exception 'Machine was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  select d.* into v_device
  from public.telemetry_devices d
  where d.id = p_device_id
    and d.telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Telemetry device was not found in the selected telemetry region.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_device_code, '')) <> v_device.device_code then
    raise exception 'Telemetry device ID does not match.' using errcode = '22023';
  end if;
  if v_device.machine_id is distinct from p_machine_id then
    raise exception 'Telemetry device is not linked to this machine.' using errcode = '22023';
  end if;

  update public.telemetry_devices
  set machine_id = null,
      site_id = null,
      machine_link_status = 'unlinked',
      machine_link_method = 'manual',
      machine_linked_at = null,
      updated_at = now()
  where id = p_device_id
    and telemetry_region = v_region;

  return jsonb_build_object(
    'accepted', true,
    'machine_id', p_machine_id,
    'device_id', p_device_id,
    'device_code', v_device.device_code,
    'telemetry_region', v_region
  );
end;
$$;

revoke all on function public.update_telemetry_machine(uuid,text,text,text,uuid,uuid,text,text,text) from public, anon;
revoke all on function public.search_unlinked_telemetry_devices(text,integer) from public, anon;
revoke all on function public.link_telemetry_device(uuid,uuid,text) from public, anon;
revoke all on function public.unlink_telemetry_device(uuid,uuid,text) from public, anon;

grant execute on function public.update_telemetry_machine(uuid,text,text,text,uuid,uuid,text,text,text) to authenticated, service_role;
grant execute on function public.search_unlinked_telemetry_devices(text,integer) to authenticated, service_role;
grant execute on function public.link_telemetry_device(uuid,uuid,text) to authenticated, service_role;
grant execute on function public.unlink_telemetry_device(uuid,uuid,text) to authenticated, service_role;

comment on function public.update_telemetry_machine(uuid,text,text,text,uuid,uuid,text,text,text) is
  'Updates a machine only within the operator selected telemetry region and keeps linked device site metadata aligned.';
comment on function public.search_unlinked_telemetry_devices(text,integer) is
  'Returns unlinked, non-retired telemetry devices only from the operator selected telemetry region.';
comment on function public.link_telemetry_device(uuid,uuid,text) is
  'Manually links one telemetry device to one machine within the operator selected telemetry region.';
comment on function public.unlink_telemetry_device(uuid,uuid,text) is
  'Manually unlinks a telemetry device from a machine within the operator selected telemetry region.';
