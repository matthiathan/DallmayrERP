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
  v_search_key text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if v_role is null or v_role not in ('admin', 'operations', 'technician', 'road_technician', 'executive') then
    raise exception 'You do not have permission to search reliability machines' using errcode = '42501';
  end if;

  if char_length(v_search) < 2 then
    return;
  end if;

  v_search_key := lower(v_search);

  return query
  with positions as (
    select
      m.id,
      m.machine_name,
      m.serial_number,
      m.machine_barcode,
      m.branch,
      m.meter_value,
      m.meter_unit,
      m.status,
      nullif(strpos(lower(coalesce(m.serial_number, '')), v_search_key), 0) as serial_position,
      nullif(strpos(lower(coalesce(m.machine_barcode, '')), v_search_key), 0) as barcode_position,
      nullif(strpos(lower(coalesce(m.machine_name, '')), v_search_key), 0) as name_position,
      nullif(strpos(lower(coalesce(m.branch, '')), v_search_key), 0) as branch_position
    from public.machines m
    where lower(coalesce(m.status, 'active')) <> 'retired'
  ),
  scored as (
    select
      p.*,
      least(p.serial_position, p.barcode_position, p.name_position, p.branch_position) as match_position,
      case
        when lower(coalesce(p.serial_number, '')) = v_search_key
          or lower(coalesce(p.machine_barcode, '')) = v_search_key
          or lower(coalesce(p.machine_name, '')) = v_search_key
          or lower(coalesce(p.branch, '')) = v_search_key then 0
        else 1
      end as exact_rank
    from positions p
    where p.serial_position is not null
       or p.barcode_position is not null
       or p.name_position is not null
       or p.branch_position is not null
  )
  select
    s.id,
    s.machine_name,
    s.serial_number,
    s.machine_barcode,
    s.branch,
    s.meter_value,
    s.meter_unit,
    s.status,
    count(*) over() as total_count
  from scored s
  order by
    s.exact_rank,
    s.match_position,
    case
      when s.serial_position = s.match_position then 0
      when s.barcode_position = s.match_position then 1
      when s.name_position = s.match_position then 2
      else 3
    end,
    coalesce(s.machine_name, s.serial_number, s.machine_barcode, s.id::text)
  limit v_limit;
end;
$$;

revoke all on function public.search_reliability_machines(text, integer) from public;
grant execute on function public.search_reliability_machines(text, integer) to authenticated;
