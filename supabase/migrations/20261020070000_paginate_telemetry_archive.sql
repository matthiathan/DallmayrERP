-- Server-paginated retired machine/device archive for large telemetry fleets.

create or replace function public.get_telemetry_archive(
  p_kind text default 'machines',
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_kind text := lower(trim(coalesce(p_kind,'machines')));
  v_search text := lower(trim(coalesce(p_search,'')));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_rows jsonb;
  v_total bigint;
  v_machine_total bigint;
  v_device_total bigint;
  v_linked_device_total bigint;
begin
  if not public.is_dallmayr_app_user() then
    raise exception 'Dallmayr staff access is required.' using errcode='42501';
  end if;
  if v_kind not in ('machines','devices') then
    raise exception 'Archive kind must be machines or devices.' using errcode='22023';
  end if;

  select count(*) into v_machine_total
  from public.machines m
  where m.status='retired'
    and m.telemetry_region=v_region
    and public.telemetry_account_allows_machine(m.id);

  select
    count(*),
    count(*) filter(where d.machine_id is not null)
  into v_device_total,v_linked_device_total
  from public.telemetry_devices d
  where d.status='retired'
    and d.telemetry_region=v_region
    and public.telemetry_account_allows_device(d.id);

  if v_kind='machines' then
    with base as (
      select
        m.id,m.machine_name,m.model,m.manufacturer,m.customer_id,m.site_id,m.serial_number,m.machine_barcode,
        m.status,m.branch,m.updated_at,
        c.customer_name,c.status customer_status,
        s.site_name,s.address site_address,s.status site_status
      from public.machines m
      left join public.customers c on c.id=m.customer_id
      left join public.customer_sites s on s.id=m.site_id
      where m.status='retired'
        and m.telemetry_region=v_region
        and public.telemetry_account_allows_machine(m.id)
    ), filtered as (
      select *
      from base b
      where v_search=''
        or lower(coalesce(b.machine_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.model,'')) like '%'||v_search||'%'
        or lower(coalesce(b.manufacturer,'')) like '%'||v_search||'%'
        or lower(coalesce(b.serial_number,'')) like '%'||v_search||'%'
        or lower(coalesce(b.machine_barcode,'')) like '%'||v_search||'%'
        or lower(coalesce(b.branch,'')) like '%'||v_search||'%'
        or lower(coalesce(b.customer_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.site_name,'')) like '%'||v_search||'%'
    ), page_rows as (
      select *
      from filtered
      order by updated_at desc nulls last,id
      limit v_limit offset v_offset
    )
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,
        'machine_name',p.machine_name,
        'model',p.model,
        'manufacturer',p.manufacturer,
        'customer_id',p.customer_id,
        'site_id',p.site_id,
        'serial_number',p.serial_number,
        'machine_barcode',p.machine_barcode,
        'status',p.status,
        'branch',p.branch,
        'updated_at',p.updated_at,
        'customers',case when p.customer_id is null then null else jsonb_build_object('customer_name',p.customer_name,'status',p.customer_status) end,
        'customer_sites',case when p.site_id is null then null else jsonb_build_object('site_name',p.site_name,'address',p.site_address,'status',p.site_status) end
      ) order by p.updated_at desc nulls last,p.id),'[]'::jsonb),
      (select count(*) from filtered)
    into v_rows,v_total
    from page_rows p;
  else
    with base as (
      select
        d.id,d.device_code,d.hardware_uid,d.machine_id,d.site_id,d.status,d.firmware_version,
        d.last_seen_at,d.last_heartbeat_at,d.last_transport,d.cellular_operator,d.machine_link_status,d.updated_at
      from public.telemetry_devices d
      where d.status='retired'
        and d.telemetry_region=v_region
        and public.telemetry_account_allows_device(d.id)
    ), filtered as (
      select *
      from base b
      where v_search=''
        or lower(coalesce(b.device_code,'')) like '%'||v_search||'%'
        or lower(coalesce(b.hardware_uid,'')) like '%'||v_search||'%'
        or lower(coalesce(b.firmware_version,'')) like '%'||v_search||'%'
        or lower(coalesce(b.cellular_operator,'')) like '%'||v_search||'%'
        or lower(coalesce(b.machine_link_status,'')) like '%'||v_search||'%'
    ), page_rows as (
      select *
      from filtered
      order by updated_at desc nulls last,id
      limit v_limit offset v_offset
    )
    select
      coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc nulls last,p.id),'[]'::jsonb),
      (select count(*) from filtered)
    into v_rows,v_total
    from page_rows p;
  end if;

  return jsonb_build_object(
    'telemetry_region',v_region,
    'kind',v_kind,
    'rows',coalesce(v_rows,'[]'::jsonb),
    'total',coalesce(v_total,0),
    'summary',jsonb_build_object(
      'retired_machines',v_machine_total,
      'retired_devices',v_device_total,
      'linked_retired_devices',v_linked_device_total
    ),
    'limit',v_limit,
    'offset',v_offset,
    'generated_at',now()
  );
end;
$$;

revoke all on function public.get_telemetry_archive(text,text,integer,integer) from public,anon;
grant execute on function public.get_telemetry_archive(text,text,integer,integer) to authenticated;
