create or replace function public.search_machine_assets(
  p_search text default null,
  p_branch text default null,
  p_status text default null,
  p_unlinked boolean default null,
  p_offset integer default 0,
  p_limit integer default 100
)
returns table (
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
  next_audit_at timestamptz,
  created_at timestamptz,
  customer_name text,
  site_name text,
  site_address text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
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
    where (coalesce(p_branch, 'all') = 'all' or m.branch = p_branch)
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
$$;

grant execute on function public.search_machine_assets(text, text, text, boolean, integer, integer) to authenticated;

create or replace function public.get_master_data_quality_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with metrics as (
    select jsonb_build_object(
      'customer_count', (select count(*) from public.customers),
      'active_customer_count', (select count(*) from public.customers where coalesce(status, 'active') = 'active'),
      'machine_count', (select count(*) from public.machines),
      'machines_without_customer', (select count(*) from public.machines where customer_id is null),
      'machines_without_site', (select count(*) from public.machines where site_id is null),
      'duplicate_customer_codes', (
        select count(*) from (
          select customer_code from public.customers
          where nullif(trim(coalesce(customer_code, '')), '') is not null
          group by customer_code
          having count(*) > 1
        ) duplicate_codes
      ),
      'duplicate_customer_names', (
        select count(*) from (
          select lower(trim(customer_name)) from public.customers
          where nullif(trim(coalesce(customer_name, '')), '') is not null
          group by lower(trim(customer_name))
          having count(*) > 1
        ) duplicate_names
      ),
      'duplicate_machine_barcodes', (
        select count(*) from (
          select machine_barcode from public.machines
          where nullif(trim(coalesce(machine_barcode, '')), '') is not null
          group by machine_barcode
          having count(*) > 1
        ) duplicate_barcodes
      ),
      'duplicate_serial_numbers', (
        select count(*) from (
          select serial_number from public.machines
          where nullif(trim(coalesce(serial_number, '')), '') is not null
          group by serial_number
          having count(*) > 1
        ) duplicate_serials
      )
    ) as value
  ),
  duplicate_customer_codes as (
    select coalesce(jsonb_agg(jsonb_build_object('value', customer_code, 'count', record_count) order by record_count desc, customer_code), '[]'::jsonb) as value
    from (
      select customer_code, count(*) as record_count
      from public.customers
      where nullif(trim(coalesce(customer_code, '')), '') is not null
      group by customer_code
      having count(*) > 1
      order by count(*) desc, customer_code
      limit 20
    ) groups
  ),
  duplicate_customer_names as (
    select coalesce(jsonb_agg(jsonb_build_object('value', customer_name_key, 'count', record_count) order by record_count desc, customer_name_key), '[]'::jsonb) as value
    from (
      select lower(trim(customer_name)) as customer_name_key, count(*) as record_count
      from public.customers
      where nullif(trim(coalesce(customer_name, '')), '') is not null
      group by lower(trim(customer_name))
      having count(*) > 1
      order by count(*) desc, lower(trim(customer_name))
      limit 20
    ) groups
  ),
  duplicate_machine_barcodes as (
    select coalesce(jsonb_agg(jsonb_build_object('value', machine_barcode, 'count', record_count) order by record_count desc, machine_barcode), '[]'::jsonb) as value
    from (
      select machine_barcode, count(*) as record_count
      from public.machines
      where nullif(trim(coalesce(machine_barcode, '')), '') is not null
      group by machine_barcode
      having count(*) > 1
      order by count(*) desc, machine_barcode
      limit 20
    ) groups
  ),
  duplicate_serial_numbers as (
    select coalesce(jsonb_agg(jsonb_build_object('value', serial_number, 'count', record_count) order by record_count desc, serial_number), '[]'::jsonb) as value
    from (
      select serial_number, count(*) as record_count
      from public.machines
      where nullif(trim(coalesce(serial_number, '')), '') is not null
      group by serial_number
      having count(*) > 1
      order by count(*) desc, serial_number
      limit 20
    ) groups
  )
  select metrics.value
    || jsonb_build_object(
      'top_duplicate_customer_codes', duplicate_customer_codes.value,
      'top_duplicate_customer_names', duplicate_customer_names.value,
      'top_duplicate_machine_barcodes', duplicate_machine_barcodes.value,
      'top_duplicate_serial_numbers', duplicate_serial_numbers.value
    )
  from metrics, duplicate_customer_codes, duplicate_customer_names, duplicate_machine_barcodes, duplicate_serial_numbers;
$$;

grant execute on function public.get_master_data_quality_summary() to authenticated;
