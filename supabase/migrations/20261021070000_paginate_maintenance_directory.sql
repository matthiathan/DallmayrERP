-- Region-scoped, server-filtered maintenance directory; read-only.
create or replace function public.get_telemetry_maintenance_directory(
 p_search text default '', p_status text default 'active', p_priority text default 'all',
 p_technician text default 'all', p_offset integer default 0, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 v_region text := public.assert_telemetry_region_selected();
 v_search text := lower(trim(coalesce(p_search,'')));
 v_status text := lower(coalesce(p_status,'active'));
 v_priority text := lower(coalesce(p_priority,'all'));
 v_technician text := coalesce(p_technician,'all');
 v_offset integer := greatest(coalesce(p_offset,0),0);
 v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
 v_result jsonb;
begin
 if not public.is_dallmayr_app_user() then
  raise exception 'Dallmayr staff access is required.' using errcode='42501';
 end if;
 if v_status not in ('all','active','new','assigned','in_progress','completed','verified','closed','cancelled')
   or v_priority not in ('all','critical','high','medium','low')
   or (v_technician not in ('all','unassigned') and v_technician !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
  raise exception 'Invalid maintenance filters.' using errcode='22023';
 end if;
 with scoped as materialized (
   select j.*,c.customer_name,m.machine_name,m.serial_number,s.site_name,s.address site_address
   from public.service_jobs j
   left join public.machines m on m.id=j.machine_id
   left join public.customer_sites s on s.id=j.site_id
   left join public.customers c on c.id=j.customer_id
   where (
     (m.id is not null and m.telemetry_region=v_region and public.telemetry_account_allows_machine(m.id))
     or (s.id is not null and s.telemetry_region=v_region and
       exists(select 1 from public.machines sm where sm.site_id=s.id and sm.telemetry_region=v_region and public.telemetry_account_allows_machine(sm.id)))
   )
 ), filtered as (
   select * from scoped j
   where (v_status='all' or (v_status='active' and j.status in ('new','assigned','in_progress')) or j.status::text=v_status)
    and (v_priority='all' or j.priority::text=v_priority)
    and (v_technician='all' or (v_technician='unassigned' and j.assigned_to is null)
      or (v_technician not in ('all','unassigned') and j.assigned_to::text=v_technician))
    and (v_search='' or lower(concat_ws(' ',j.job_number,j.incident_number,j.summary,j.complaint_details,
      j.category,j.sub_category,j.service_type,j.customer_name_snapshot,j.customer_name,
      j.machine_name,j.serial_number,j.site_name,j.branch,j.work_order_number,
      j.ticket_reference,j.ticket_case_number)) like '%'||v_search||'%')
 ), page_rows as (
   select * from filtered order by reported_at desc nulls last,id limit v_limit offset v_offset
 ), metrics as (
   select
    count(*) filter(where status in ('new','assigned','in_progress')) active_jobs,
    count(*) filter(where status in ('new','assigned','in_progress') and due_at<now()) overdue,
    count(*) filter(where status in ('new','assigned','in_progress') and due_at between now() and now()+interval '24 hours') due_soon,
    count(*) filter(where status in ('new','assigned','in_progress') and assigned_to is null) unassigned,
    count(*) filter(where status='in_progress') in_progress,
    count(*) filter(where status in ('completed','verified','closed')
      and coalesce(completed_at,closed_at,reported_at)>=now()-interval '30 days') completed_30d,
    count(*) filter(where reported_at>=now()-interval '30 days') reported_30d
   from scoped
 )
 select jsonb_build_object(
   'rows',coalesce((select jsonb_agg(
       (to_jsonb(p) - 'customer_name' - 'machine_name' - 'serial_number' - 'site_name' - 'site_address')
       || jsonb_build_object('customers',jsonb_build_object('customer_name',p.customer_name),
         'machines',jsonb_build_object('machine_name',p.machine_name,'serial_number',p.serial_number),
         'customer_sites',jsonb_build_object('site_name',p.site_name,'address',p.site_address))
       order by p.reported_at desc nulls last,p.id) from page_rows p),'[]'::jsonb),
   'total',(select count(*) from filtered),
   'summary',jsonb_build_object('active_jobs',metrics.active_jobs,'overdue',metrics.overdue,
    'due_soon',metrics.due_soon,'unassigned',metrics.unassigned,'in_progress',metrics.in_progress,
    'completed_30d',metrics.completed_30d,'reported_30d',metrics.reported_30d,
    'plans_due',(select count(*) from public.maintenance_plans mp join public.machines mm on mm.id=mp.machine_id
      where mp.is_active and mp.next_due_at<=now() and mm.telemetry_region=v_region and public.telemetry_account_allows_machine(mm.id)),
    'active_plans',(select count(*) from public.maintenance_plans mp join public.machines mm on mm.id=mp.machine_id
      where mp.is_active and mm.telemetry_region=v_region and public.telemetry_account_allows_machine(mm.id))),
   'limit',v_limit,'offset',v_offset,'telemetry_region',v_region
 ) into v_result from metrics;
 return v_result;
end;
$$;
revoke all on function public.get_telemetry_maintenance_directory(text,text,text,text,integer,integer) from public,anon;
grant execute on function public.get_telemetry_maintenance_directory(text,text,text,text,integer,integer) to authenticated;
