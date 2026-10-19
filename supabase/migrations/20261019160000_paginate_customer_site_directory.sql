-- Paginated customer/site telemetry directory for large fleets.
-- Keeps customer list metrics server-side so the browser does not load the full
-- machine/site/service-job population for every customer.

create or replace function public.get_telemetry_customer_site_directory(
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_search text := lower(trim(coalesce(p_search,'')));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_result jsonb;
begin
  if not public.is_dallmayr_app_user() then
    raise exception 'Dallmayr staff access is required.' using errcode='42501';
  end if;

  with regional_sites as (
    select s.id,s.customer_id,s.site_name,s.address
    from public.customer_sites s
    where s.telemetry_region=v_region
  ), active_devices as (
    select distinct on (d.machine_id)
      d.machine_id,d.id device_id,coalesce(d.last_heartbeat_at,d.last_seen_at) last_contact
    from public.telemetry_devices d
    where d.status='active'
      and d.machine_id is not null
      and d.telemetry_region=v_region
      and public.telemetry_account_allows_device(d.id)
    order by d.machine_id,d.updated_at desc,d.id
  ), fault_counts as (
    select f.machine_id,count(*)::integer fault_count
    from public.telemetry_fault_events f
    join public.telemetry_devices d on d.id=f.device_id
    where f.cleared_at is null
      and f.machine_id is not null
      and d.telemetry_region=v_region
      and public.telemetry_account_allows_device(d.id)
    group by f.machine_id
  ), regional_machines as (
    select
      m.id,m.customer_id,m.site_id,
      case
        when ad.device_id is null then 'unlinked'
        when ad.last_contact is null then 'never'
        when ad.last_contact>=now()-interval '30 minutes' then 'online'
        when ad.last_contact>=now()-interval '24 hours' then 'delayed'
        else 'offline'
      end connection_status,
      coalesce(fc.fault_count,0)::integer fault_count
    from public.machines m
    left join active_devices ad on ad.machine_id=m.id
    left join fault_counts fc on fc.machine_id=m.id
    where m.telemetry_region=v_region
      and public.telemetry_account_allows_machine(m.id)
  ), eligible_customers as (
    select distinct customer_id
    from (
      select rs.customer_id from regional_sites rs where rs.customer_id is not null
      union all
      select rm.customer_id from regional_machines rm where rm.customer_id is not null
    ) q
  ), regional_jobs as (
    select j.id,j.customer_id,j.status
    from public.service_jobs j
    where j.customer_id is not null
      and (
        (j.site_id is not null and exists(select 1 from regional_sites rs where rs.id=j.site_id))
        or
        (j.machine_id is not null and exists(select 1 from regional_machines rm where rm.id=j.machine_id))
      )
  ), customer_rows as (
    select
      c.id,
      c.branch,
      c.customer_code,
      c.customer_name,
      c.phone,
      c.email,
      c.address,
      c.status,
      (select count(*) from regional_sites rs where rs.customer_id=c.id)::bigint site_count,
      (select count(*) from regional_machines rm where rm.customer_id=c.id)::bigint machine_count,
      (select count(*) from regional_machines rm where rm.customer_id=c.id and rm.connection_status='online')::bigint online_count,
      (select count(*) from regional_machines rm where rm.customer_id=c.id and rm.connection_status in ('offline','never','unlinked'))::bigint offline_count,
      (select coalesce(sum(rm.fault_count),0) from regional_machines rm where rm.customer_id=c.id)::bigint fault_count,
      (
        select count(*)
        from regional_jobs rj
        where rj.customer_id=c.id
          and rj.status not in ('completed','verified','closed','cancelled')
      )::bigint open_job_count
    from public.customers c
    join eligible_customers ec on ec.customer_id=c.id
  ), scored as (
    select
      cr.*,
      greatest(
        0,
        round(
          100
          - ((cr.offline_count::numeric / greatest(cr.machine_count,1)) * 55)
          - ((least(cr.fault_count,cr.machine_count)::numeric / greatest(cr.machine_count,1)) * 35)
        )
      )::integer health
    from customer_rows cr
  ), filtered as (
    select s.*
    from scored s
    where v_search=''
      or lower(coalesce(s.customer_name,'')) like '%'||v_search||'%'
      or lower(coalesce(s.customer_code,'')) like '%'||v_search||'%'
      or lower(coalesce(s.branch,'')) like '%'||v_search||'%'
      or lower(coalesce(s.address,'')) like '%'||v_search||'%'
      or exists (
        select 1
        from regional_sites rs
        where rs.customer_id=s.id
          and (
            lower(coalesce(rs.site_name,'')) like '%'||v_search||'%'
            or lower(coalesce(rs.address,'')) like '%'||v_search||'%'
          )
      )
  ), page_rows as (
    select f.*
    from filtered f
    order by lower(f.customer_name),f.id
    limit v_limit offset v_offset
  ), totals as (
    select
      count(*)::bigint customer_count,
      coalesce(sum(site_count),0)::bigint site_count,
      coalesce(sum(machine_count),0)::bigint machine_count,
      coalesce(sum(online_count),0)::bigint online_count,
      coalesce(sum(fault_count),0)::bigint fault_count,
      coalesce(sum(open_job_count),0)::bigint open_job_count
    from scored
  )
  select jsonb_build_object(
    'telemetry_region',v_region,
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.customer_name),p.id) from page_rows p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'customers',t.customer_count,
      'sites',t.site_count,
      'machines',t.machine_count,
      'online',t.online_count,
      'faults',t.fault_count,
      'open_jobs',t.open_job_count
    ),
    'limit',v_limit,
    'offset',v_offset,
    'generated_at',now()
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_customer_site_directory(text,integer,integer) from public,anon;
grant execute on function public.get_telemetry_customer_site_directory(text,integer,integer) to authenticated;
