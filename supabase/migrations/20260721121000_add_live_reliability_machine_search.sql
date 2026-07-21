create or replace function public.search_reliability_machines(
  p_search text,
  p_limit integer default 50
)
returns table(
  id uuid,
  machine_name text,
  serial_number text,
  machine_barcode text,
  branch text,
  meter_value numeric,
  meter_unit text,
  status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_app_role();
  v_search text := regexp_replace(trim(coalesce(p_search, '')), '[%_\\]+', '', 'g');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if v_role is null or v_role not in ('admin', 'operations', 'technician', 'road_technician', 'executive') then
    raise exception 'You do not have permission to search reliability machines' using errcode = '42501';
  end if;

  if char_length(v_search) < 2 then
    return;
  end if;

  return query
  with filtered as (
    select
      m.id,
      m.machine_name,
      m.serial_number,
      m.machine_barcode,
      m.branch,
      m.meter_value,
      m.meter_unit,
      m.status
    from public.machines m
    where lower(coalesce(m.status, 'active')) <> 'retired'
      and (
        coalesce(m.machine_name, '') ilike '%' || v_search || '%'
        or coalesce(m.serial_number, '') ilike '%' || v_search || '%'
        or coalesce(m.machine_barcode, '') ilike '%' || v_search || '%'
        or coalesce(m.branch, '') ilike '%' || v_search || '%'
      )
  )
  select
    f.id,
    f.machine_name,
    f.serial_number,
    f.machine_barcode,
    f.branch,
    f.meter_value,
    f.meter_unit,
    f.status,
    count(*) over() as total_count
  from filtered f
  order by
    case
      when lower(coalesce(f.serial_number, '')) = lower(v_search)
        or lower(coalesce(f.machine_barcode, '')) = lower(v_search) then 0
      when coalesce(f.serial_number, '') ilike v_search || '%'
        or coalesce(f.machine_barcode, '') ilike v_search || '%' then 1
      when coalesce(f.serial_number, '') ilike '%' || v_search || '%'
        or coalesce(f.machine_barcode, '') ilike '%' || v_search || '%' then 2
      when coalesce(f.machine_name, '') ilike v_search || '%' then 3
      when coalesce(f.machine_name, '') ilike '%' || v_search || '%' then 4
      else 5
    end,
    coalesce(f.machine_name, f.serial_number, f.machine_barcode, f.id::text)
  limit v_limit;
end;
$$;

revoke all on function public.search_reliability_machines(text, integer) from public;
grant execute on function public.search_reliability_machines(text, integer) to authenticated;
