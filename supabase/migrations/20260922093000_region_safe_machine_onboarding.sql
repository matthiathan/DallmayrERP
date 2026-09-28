-- Region-safe machine onboarding for single-machine creation and CSV bulk import.
-- The browser never supplies telemetry_region or branch. Both are derived on the
-- server from the selected application region and trusted customer/site rows.
-- SECURITY INVOKER deliberately keeps the existing restrictive machine RLS
-- policy authoritative for every insert.

create or replace function public.create_telemetry_machine(
  p_machine_name text,
  p_model text,
  p_manufacturer text,
  p_customer_id uuid,
  p_site_id uuid default null,
  p_serial_number text default null,
  p_machine_barcode text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_machine_name text := nullif(btrim(coalesce(p_machine_name, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_manufacturer text := nullif(btrim(coalesce(p_manufacturer, '')), '');
  v_serial text := nullif(btrim(coalesce(p_serial_number, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_machine_barcode, '')), '');
  v_customer public.customers%rowtype;
  v_site public.customer_sites%rowtype;
  v_machine_id uuid;
  v_branch text;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin', 'operations', 'technician', 'road_technician']);

  if v_machine_name is null or v_model is null or v_manufacturer is null
     or p_customer_id is null or v_serial is null or v_barcode is null then
    raise exception 'Asset Name, Machine Type, Brand, Client, Serial Number and QR Code Number are required.' using errcode = '22023';
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
    where m.telemetry_region = v_region
      and lower(btrim(coalesce(m.serial_number, ''))) = lower(v_serial)
  ) then
    raise exception 'Serial Number % already exists in the selected telemetry region.', v_serial using errcode = '23505';
  end if;

  if exists (
    select 1 from public.machines m
    where m.telemetry_region = v_region
      and lower(btrim(coalesce(m.machine_barcode, ''))) = lower(v_barcode)
  ) then
    raise exception 'QR Code Number % already exists in the selected telemetry region.', v_barcode using errcode = '23505';
  end if;

  v_branch := coalesce(nullif(btrim(v_site.branch), ''), nullif(btrim(v_customer.branch), ''), 'national');

  begin
    insert into public.machines (
      machine_name,
      model,
      manufacturer,
      customer_id,
      site_id,
      branch,
      serial_number,
      machine_barcode,
      telemetry_region
    ) values (
      v_machine_name,
      v_model,
      v_manufacturer,
      p_customer_id,
      p_site_id,
      v_branch,
      v_serial,
      v_barcode,
      v_region
    )
    returning id into v_machine_id;
  exception
    when unique_violation then
      raise exception 'Serial Number or QR Code Number already exists.' using errcode = '23505';
  end;

  return jsonb_build_object(
    'accepted', true,
    'machine_id', v_machine_id,
    'telemetry_region', v_region,
    'branch', v_branch
  );
end;
$$;

revoke all on function public.create_telemetry_machine(text,text,text,uuid,uuid,text,text) from public, anon;
grant execute on function public.create_telemetry_machine(text,text,text,uuid,uuid,text,text) to authenticated;

create or replace function public.import_telemetry_machines(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_count integer;
  v_imported integer := 0;
  v_invalid_row integer;
  v_duplicate_value text;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin', 'operations', 'technician', 'road_technician']);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Machine import payload must be a JSON array.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 5000 then
    raise exception 'Machine import must contain between 1 and 5000 rows.' using errcode = '22023';
  end if;

  -- Required fields are revalidated server-side even after the browser CSV preflight.
  with incoming as (
    select
      x.ordinality::integer as row_number,
      nullif(btrim(x.item ->> 'machine_name'), '') as machine_name,
      nullif(btrim(x.item ->> 'model'), '') as model,
      nullif(btrim(x.item ->> 'manufacturer'), '') as manufacturer,
      nullif(btrim(x.item ->> 'customer_id'), '')::uuid as customer_id,
      nullif(btrim(x.item ->> 'site_id'), '')::uuid as site_id,
      nullif(btrim(x.item ->> 'serial_number'), '') as serial_number,
      nullif(btrim(x.item ->> 'machine_barcode'), '') as machine_barcode
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
  )
  select row_number into v_invalid_row
  from incoming
  where machine_name is null
     or customer_id is null
     or serial_number is null
     or machine_barcode is null
  order by row_number
  limit 1;
  if v_invalid_row is not null then
    raise exception 'Import row % is missing Asset Name, Client, Serial Number or QR Code Number.', v_invalid_row using errcode = '22023';
  end if;

  -- Reject duplicate identifiers inside the submitted file before writing anything.
  with incoming as (
    select x.ordinality::integer as row_number,
           lower(btrim(x.item ->> 'serial_number')) as serial_key,
           lower(btrim(x.item ->> 'machine_barcode')) as barcode_key
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
  ), duplicate_serials as (
    select serial_key from incoming where serial_key <> '' group by serial_key having count(*) > 1
  )
  select serial_key into v_duplicate_value from duplicate_serials limit 1;
  if v_duplicate_value is not null then
    raise exception 'Duplicate Serial Number exists inside the import payload: %', v_duplicate_value using errcode = '23505';
  end if;

  v_duplicate_value := null;
  with incoming as (
    select lower(btrim(x.item ->> 'machine_barcode')) as barcode_key
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
  ), duplicate_barcodes as (
    select barcode_key from incoming where barcode_key <> '' group by barcode_key having count(*) > 1
  )
  select barcode_key into v_duplicate_value from duplicate_barcodes limit 1;
  if v_duplicate_value is not null then
    raise exception 'Duplicate QR Code Number exists inside the import payload: %', v_duplicate_value using errcode = '23505';
  end if;

  -- Validate every client and, when supplied, every site in the current telemetry region.
  v_invalid_row := null;
  with incoming as (
    select x.ordinality::integer as row_number,
           nullif(btrim(x.item ->> 'customer_id'), '')::uuid as customer_id,
           nullif(btrim(x.item ->> 'site_id'), '')::uuid as site_id
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
  )
  select i.row_number into v_invalid_row
  from incoming i
  left join public.customers c on c.id = i.customer_id and c.status = 'active'
  left join public.customer_sites s
    on s.id = i.site_id
   and s.customer_id = i.customer_id
   and s.telemetry_region = v_region
   and s.status = 'active'
  where c.id is null
     or (i.site_id is not null and s.id is null)
  order by i.row_number
  limit 1;
  if v_invalid_row is not null then
    raise exception 'Import row % references an invalid client or a site outside the selected telemetry region.', v_invalid_row using errcode = '22023';
  end if;

  -- Recheck selected-region identifiers at commit time. This closes the race between CSV preview and import.
  v_duplicate_value := null;
  with incoming as (
    select lower(btrim(x.item ->> 'serial_number')) as serial_key
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
  )
  select i.serial_key into v_duplicate_value
  from incoming i
  join public.machines m
    on m.telemetry_region = v_region
   and lower(btrim(coalesce(m.serial_number, ''))) = i.serial_key
  limit 1;
  if v_duplicate_value is not null then
    raise exception 'Serial Number already exists in the selected telemetry region: %', v_duplicate_value using errcode = '23505';
  end if;

  v_duplicate_value := null;
  with incoming as (
    select lower(btrim(x.item ->> 'machine_barcode')) as barcode_key
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
  )
  select i.barcode_key into v_duplicate_value
  from incoming i
  join public.machines m
    on m.telemetry_region = v_region
   and lower(btrim(coalesce(m.machine_barcode, ''))) = i.barcode_key
  limit 1;
  if v_duplicate_value is not null then
    raise exception 'QR Code Number already exists in the selected telemetry region: %', v_duplicate_value using errcode = '23505';
  end if;

  begin
    with incoming as (
      select
        x.ordinality::integer as row_number,
        nullif(btrim(x.item ->> 'machine_name'), '') as machine_name,
        nullif(btrim(x.item ->> 'model'), '') as model,
        nullif(btrim(x.item ->> 'manufacturer'), '') as manufacturer,
        nullif(btrim(x.item ->> 'customer_id'), '')::uuid as customer_id,
        nullif(btrim(x.item ->> 'site_id'), '')::uuid as site_id,
        nullif(btrim(x.item ->> 'serial_number'), '') as serial_number,
        nullif(btrim(x.item ->> 'machine_barcode'), '') as machine_barcode
      from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
    ), validated as (
      select
        i.*,
        coalesce(nullif(btrim(s.branch), ''), nullif(btrim(c.branch), ''), 'national') as branch
      from incoming i
      join public.customers c on c.id = i.customer_id and c.status = 'active'
      left join public.customer_sites s
        on s.id = i.site_id
       and s.customer_id = i.customer_id
       and s.telemetry_region = v_region
       and s.status = 'active'
    )
    insert into public.machines (
      machine_name,
      model,
      manufacturer,
      customer_id,
      site_id,
      branch,
      serial_number,
      machine_barcode,
      telemetry_region
    )
    select
      v.machine_name,
      v.model,
      v.manufacturer,
      v.customer_id,
      v.site_id,
      v.branch,
      v.serial_number,
      v.machine_barcode,
      v_region
    from validated v
    order by v.row_number;

    get diagnostics v_imported = row_count;
  exception
    when unique_violation then
      raise exception 'Serial Number or QR Code Number already exists. No machines were imported.' using errcode = '23505';
  end;

  if v_imported <> v_count then
    raise exception 'Machine import validation changed during the transaction. No partial result should be accepted.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'accepted', true,
    'imported_count', v_imported,
    'telemetry_region', v_region
  );
end;
$$;

revoke all on function public.import_telemetry_machines(jsonb) from public, anon;
grant execute on function public.import_telemetry_machines(jsonb) to authenticated;
