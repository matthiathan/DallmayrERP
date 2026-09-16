-- Region-scope the aggregate SECURITY DEFINER reporting APIs.

create or replace function public.get_telemetry_reporting(p_period text default 'day', p_branch text default 'all', p_dataset text default 'production')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_period text := lower(coalesce(nullif(trim(p_period), ''), 'day'));
  v_dataset text := lower(coalesce(nullif(trim(p_dataset), ''), 'production'));
  v_branch text := lower(coalesce(nullif(trim(p_branch), ''), 'all'));
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_from date;
  v_result jsonb;
begin
  if v_dataset not in ('production','simulation') then raise exception 'dataset must be production or simulation' using errcode='22023'; end if;
  v_from := case v_period when 'today' then v_today when 'day' then v_today when 'week' then v_today-6 when 'month' then v_today-29 when 'six_months' then (v_today-interval '6 months')::date else v_today end;

  with production_rows as (
    select s.id::text id,s.sales_date,s.machine_id,s.machine_name_snapshot,s.machine_serial_snapshot,s.location_snapshot,s.branch,s.selection_code,s.product_key,s.sku,s.product_name,s.brand,
      s.units_sold::bigint units_sold,s.failed_vends::bigint failed_vends,s.revenue_cents::bigint revenue_cents,s.last_received_at
    from public.telemetry_daily_item_sales s join public.telemetry_devices d on d.id=s.device_id
    where v_dataset='production' and d.telemetry_region=v_region and s.sales_date between v_from and v_today and (v_branch='all' or lower(s.branch)=v_branch)
  ), simulation_rows as (
    select concat('sim:',s.device_id::text,':',s.sales_date::text,':',s.selection_code) id,s.sales_date,s.machine_id,s.machine_name_snapshot,s.machine_serial_snapshot,
      null::text location_snapshot,s.branch,s.selection_code,concat('sim:',s.selection_code) product_key,null::text sku,s.product_name,'POC simulation'::text brand,
      s.units_sold::bigint,s.failed_vends::bigint,s.revenue_cents::bigint,s.last_received_at
    from public.telemetry_daily_simulation_sales s join public.telemetry_devices d on d.id=s.device_id
    where v_dataset='simulation' and d.telemetry_region=v_region and s.sales_date between v_from and v_today and (v_branch='all' or lower(s.branch)=v_branch)
  ), filtered as (
    select * from production_rows union all select * from simulation_rows
  ), device_scope as (
    select d.id,d.machine_id,d.status,lower(coalesce(m.branch,cs.branch,'unassigned')) branch
    from public.telemetry_devices d left join public.machines m on m.id=d.machine_id left join public.customer_sites cs on cs.id=coalesce(d.site_id,m.site_id)
    where d.status='active' and d.telemetry_region=v_region and (v_branch='all' or lower(coalesce(m.branch,cs.branch,''))=v_branch)
  )
  select jsonb_build_object(
    'telemetry_region',v_region,'period',case when v_period='today' then 'day' else v_period end,'dataset',v_dataset,'date_from',v_from,'date_to',v_today,
    'availability',jsonb_build_object(
      'production_rows',(select count(*) from public.telemetry_daily_item_sales s join public.telemetry_devices d on d.id=s.device_id where d.telemetry_region=v_region and s.sales_date between v_from and v_today and (v_branch='all' or lower(s.branch)=v_branch)),
      'simulation_rows',(select count(*) from public.telemetry_daily_simulation_sales s join public.telemetry_devices d on d.id=s.device_id where d.telemetry_region=v_region and s.sales_date between v_from and v_today and (v_branch='all' or lower(s.branch)=v_branch)),
      'active_simulation_devices',(select count(*) from public.telemetry_machine_state ms join device_scope ds on ds.id=ms.device_id where ms.simulation_mode)),
    'summary',jsonb_build_object(
      'units_sold',coalesce((select sum(units_sold) from filtered),0),'revenue_cents',coalesce((select sum(revenue_cents) from filtered),0),
      'failed_vends',coalesce((select sum(failed_vends) from filtered),0),'active_machines',coalesce((select count(distinct machine_id) from filtered where machine_id is not null),0),
      'reporting_devices',(select count(*) from device_scope),
      'online_devices',(select count(*) from device_scope ds cross join lateral public.get_telemetry_connectivity_state(ds.id) c where c.communication_status='online'),
      'offline_devices',(select count(*) from device_scope ds cross join lateral public.get_telemetry_connectivity_state(ds.id) c where c.communication_status='offline'),
      'unassigned_devices',(select count(*) from device_scope where machine_id is null)),
    'daily_trend',coalesce((select jsonb_agg(jsonb_build_object('date',sales_date,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by sales_date)
      from (select sales_date,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by sales_date)d),'[]'::jsonb),
    'by_branch',coalesce((select jsonb_agg(jsonb_build_object('branch',branch,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by units_sold desc)
      from (select branch,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by branch)b),'[]'::jsonb),
    'top_items',coalesce((select jsonb_agg(jsonb_build_object('product_key',product_key,'sku',sku,'product_name',product_name,'brand',brand,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by units_sold desc)
      from (select product_key,max(sku) sku,max(product_name) product_name,max(brand) brand,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by product_key order by units_sold desc limit 10)i),'[]'::jsonb),
    'top_machines',coalesce((select jsonb_agg(jsonb_build_object('machine_id',machine_id,'machine_name',machine_name,'serial_number',serial_number,'location',location,'branch',branch,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by units_sold desc)
      from (select machine_id,max(machine_name_snapshot) machine_name,max(machine_serial_snapshot) serial_number,max(location_snapshot) location,max(branch) branch,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by machine_id order by units_sold desc limit 10)m),'[]'::jsonb),
    'recent_sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sales_date',sales_date,'machine_id',machine_id,'machine_name',machine_name_snapshot,'serial_number',machine_serial_snapshot,'location',location_snapshot,'branch',branch,'selection_code',selection_code,'sku',sku,'product_name',product_name,'brand',brand,'units_sold',units_sold,'failed_vends',failed_vends,'revenue_cents',revenue_cents,'last_received_at',last_received_at) order by sales_date desc,last_received_at desc)
      from (select * from filtered order by sales_date desc,last_received_at desc limit 250)r),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_telemetry_dashboard(p_period text default 'today', p_branch text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_from date;
  v_result jsonb;
begin
  v_from := case lower(coalesce(p_period,'today')) when 'today' then current_date when 'week' then current_date-6 when 'month' then date_trunc('month',current_date)::date when 'six_months' then (current_date-interval '6 months')::date else current_date end;
  with filtered as (
    select s.* from public.telemetry_daily_item_sales s join public.telemetry_devices d on d.id=s.device_id
    where d.telemetry_region=v_region and s.sales_date>=v_from and (coalesce(nullif(lower(p_branch),''),'all')='all' or lower(s.branch)=lower(p_branch))
  )
  select jsonb_build_object(
    'telemetry_region',v_region,'period',lower(coalesce(p_period,'today')),'date_from',v_from,'date_to',current_date,
    'summary',jsonb_build_object(
      'units_sold',coalesce((select sum(units_sold) from filtered),0),'revenue_cents',coalesce((select sum(revenue_cents) from filtered),0),'failed_vends',coalesce((select sum(failed_vends) from filtered),0),
      'active_machines',coalesce((select count(distinct machine_id) from filtered where machine_id is not null),0),
      'reporting_devices',(select count(*) from public.telemetry_devices where status='active' and telemetry_region=v_region),
      'online_devices',(select count(*) from public.telemetry_devices d left join lateral (select public.get_effective_telemetry_policy(d.id) policy)ep on true where d.status='active' and d.telemetry_region=v_region and d.last_seen_at is not null and d.last_seen_at>=now()-make_interval(mins=>2*greatest(1,(ep.policy->>'heartbeat_interval_minutes')::integer))),
      'offline_devices',(select count(*) from public.telemetry_devices d left join lateral (select public.get_effective_telemetry_policy(d.id) policy)ep on true where d.status='active' and d.telemetry_region=v_region and (d.last_seen_at is null or d.last_seen_at<now()-make_interval(mins=>2*greatest(1,(ep.policy->>'heartbeat_interval_minutes')::integer)))),
      'unassigned_devices',(select count(*) from public.telemetry_devices where status='active' and telemetry_region=v_region and machine_id is null),
      'active_faults',(select count(*) from public.telemetry_fault_events f join public.telemetry_devices d on d.id=f.device_id where f.cleared_at is null and d.telemetry_region=v_region)),
    'device_states',coalesce((select jsonb_agg(jsonb_build_object('device_id',d.id,'device_code',d.device_code,'machine_id',d.machine_id,'machine_name',m.machine_name,'serial_number',m.serial_number,'branch',coalesce(m.branch,'unassigned'),'profile_id',d.profile_id,'device_status',d.status,
      'telemetry_mode',coalesce(ms.telemetry_mode,ep.policy->>'mode','live'),'counter_interval_minutes',(ep.policy->>'counter_interval_minutes')::integer,'heartbeat_interval_minutes',(ep.policy->>'heartbeat_interval_minutes')::integer,'config_refresh_minutes',(ep.policy->>'config_refresh_minutes')::integer,
      'online',case when d.last_seen_at is null then false else d.last_seen_at>=now()-make_interval(mins=>2*greatest(1,(ep.policy->>'heartbeat_interval_minutes')::integer)) end,'machine_status',coalesce(ms.machine_status,'unknown'),'active_fault_count',coalesce(ms.active_fault_count,0),
      'transport_preference',d.transport_preference,'last_transport',d.last_transport,'wifi_enabled',d.wifi_enabled,'cellular_enabled',d.cellular_enabled,'wifi_rssi',d.wifi_rssi,'cellular_csq',d.cellular_csq,'cellular_operator',d.cellular_operator,'cellular_model',d.cellular_model,'firmware_version',d.firmware_version,'last_seen_at',d.last_seen_at,'last_counter_at',d.last_counter_at,'last_heartbeat_at',d.last_heartbeat_at,'last_config_at',d.last_config_at) order by d.device_code)
      from public.telemetry_devices d left join public.machines m on m.id=d.machine_id left join public.telemetry_machine_state ms on ms.device_id=d.id left join lateral (select public.get_effective_telemetry_policy(d.id) policy)ep on true
      where d.status='active' and d.telemetry_region=v_region and (coalesce(nullif(lower(p_branch),''),'all')='all' or lower(coalesce(m.branch,''))=lower(p_branch))),'[]'::jsonb),
    'active_faults',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'device_id',f.device_id,'device_code',d.device_code,'machine_id',f.machine_id,'machine_name',m.machine_name,'serial_number',m.serial_number,'fault_code',f.fault_code,'severity',f.severity,'detail',f.detail,'started_at',f.started_at,'last_seen_at',f.last_seen_at)
      order by case f.severity when 'critical' then 1 when 'fault' then 2 when 'warning' then 3 else 4 end,f.started_at desc)
      from public.telemetry_fault_events f join public.telemetry_devices d on d.id=f.device_id left join public.machines m on m.id=f.machine_id
      where f.cleared_at is null and d.telemetry_region=v_region and (coalesce(nullif(lower(p_branch),''),'all')='all' or lower(coalesce(m.branch,''))=lower(p_branch))),'[]'::jsonb),
    'daily_trend',coalesce((select jsonb_agg(jsonb_build_object('date',sales_date,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by sales_date) from (select sales_date,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by sales_date)d),'[]'::jsonb),
    'by_branch',coalesce((select jsonb_agg(jsonb_build_object('branch',branch,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by units_sold desc) from (select branch,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by branch)b),'[]'::jsonb),
    'top_items',coalesce((select jsonb_agg(jsonb_build_object('product_key',product_key,'sku',sku,'product_name',product_name,'brand',brand,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by units_sold desc) from (select product_key,max(sku) sku,max(product_name) product_name,max(brand) brand,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by product_key order by units_sold desc limit 10)i),'[]'::jsonb),
    'top_machines',coalesce((select jsonb_agg(jsonb_build_object('machine_id',machine_id,'machine_name',machine_name,'serial_number',serial_number,'location',location,'branch',branch,'units_sold',units_sold,'revenue_cents',revenue_cents,'failed_vends',failed_vends) order by units_sold desc) from (select machine_id,max(machine_name_snapshot) machine_name,max(machine_serial_snapshot) serial_number,max(location_snapshot) location,max(branch) branch,sum(units_sold)::bigint units_sold,sum(revenue_cents)::bigint revenue_cents,sum(failed_vends)::bigint failed_vends from filtered group by machine_id order by units_sold desc limit 10)m),'[]'::jsonb),
    'recent_sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sales_date',sales_date,'machine_id',machine_id,'machine_name',machine_name_snapshot,'serial_number',machine_serial_snapshot,'location',location_snapshot,'branch',branch,'selection_code',selection_code,'sku',sku,'product_name',product_name,'brand',brand,'units_sold',units_sold,'failed_vends',failed_vends,'revenue_cents',revenue_cents,'last_received_at',last_received_at) order by sales_date desc,last_received_at desc) from (select * from filtered order by sales_date desc,last_received_at desc limit 250)r),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_telemetry_activity(p_period text default 'day', p_branch text default 'all', p_dataset text default 'production', p_kind text default 'all', p_search text default '', p_sort text default 'newest', p_direction text default 'desc', p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text := public.assert_telemetry_region_selected();
  v_from date;
  v_dataset text := lower(coalesce(nullif(trim(p_dataset),''),'production'));
  v_kind text := lower(coalesce(nullif(trim(p_kind),''),'all'));
  v_sort text := lower(coalesce(nullif(trim(p_sort),''),'newest'));
  v_direction text := lower(coalesce(nullif(trim(p_direction),''),'desc'));
  v_search text := lower(trim(coalesce(p_search,'')));
  v_limit integer := greatest(1,least(coalesce(p_limit,100),250));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_result jsonb;
begin
  if coalesce(v_role,'') not in ('admin','executive','operations') then raise exception 'insufficient privileges' using errcode='42501'; end if;
  if v_dataset not in ('production','simulation') then raise exception 'Invalid telemetry dataset' using errcode='22023'; end if;
  if v_kind not in ('all','sale','error') then raise exception 'Invalid telemetry activity kind' using errcode='22023'; end if;
  if v_sort not in ('newest','error','sales','machine') then raise exception 'Invalid telemetry activity sort' using errcode='22023'; end if;
  if v_direction not in ('asc','desc') then raise exception 'Invalid telemetry activity sort direction' using errcode='22023'; end if;
  v_from := case lower(coalesce(p_period,'day')) when 'day' then (now() at time zone 'Africa/Johannesburg')::date when 'week' then (now() at time zone 'Africa/Johannesburg')::date-6 when 'month' then (now() at time zone 'Africa/Johannesburg')::date-29 when 'six_months' then ((now() at time zone 'Africa/Johannesburg')::date-interval '6 months')::date else (now() at time zone 'Africa/Johannesburg')::date end;
  with production_sales as (
    select 'sale:'||s.id::text activity_id,'sale'::text activity_type,s.last_received_at occurred_at,s.sales_date activity_date,s.device_id,d.device_code,s.machine_id,coalesce(s.machine_name_snapshot,m.machine_name) machine_name,coalesce(s.machine_serial_snapshot,m.serial_number) serial_number,coalesce(s.branch,m.branch,'unassigned') branch,s.selection_code,coalesce(s.product_name,s.sku,s.product_key) product_name,s.units_sold,s.failed_vends,s.revenue_cents,null::text error_code,null::text severity,null::text detail,false error_active,null::timestamptz cleared_at
    from public.telemetry_daily_item_sales s join public.telemetry_devices d on d.id=s.device_id left join public.machines m on m.id=s.machine_id
    where v_dataset='production' and d.telemetry_region=v_region and s.sales_date>=v_from and (coalesce(nullif(lower(p_branch),''),'all')='all' or lower(coalesce(s.branch,m.branch,''))=lower(p_branch))
  ), simulation_sales as (
    select 'sim-sale:'||s.device_id::text||':'||s.sales_date::text||':'||s.selection_code,'sale'::text,s.last_received_at,s.sales_date,s.device_id,d.device_code,s.machine_id,coalesce(s.machine_name_snapshot,m.machine_name),coalesce(s.machine_serial_snapshot,m.serial_number),coalesce(s.branch,m.branch,'unassigned'),s.selection_code,s.product_name,s.units_sold,s.failed_vends,s.revenue_cents,null::text,null::text,null::text,false,null::timestamptz
    from public.telemetry_daily_simulation_sales s join public.telemetry_devices d on d.id=s.device_id left join public.machines m on m.id=s.machine_id
    where v_dataset='simulation' and d.telemetry_region=v_region and s.sales_date>=v_from and (coalesce(nullif(lower(p_branch),''),'all')='all' or lower(coalesce(s.branch,m.branch,''))=lower(p_branch))
  ), fault_rows as (
    select 'error:'||f.id::text,'error'::text,f.started_at,(f.started_at at time zone 'Africa/Johannesburg')::date,f.device_id,d.device_code,f.machine_id,m.machine_name,m.serial_number,coalesce(m.branch,'unassigned'),null::text,null::text,0::bigint,0::bigint,0::bigint,f.fault_code,f.severity,f.detail,(f.cleared_at is null),f.cleared_at
    from public.telemetry_fault_events f join public.telemetry_devices d on d.id=f.device_id left join public.machines m on m.id=f.machine_id
    where v_dataset='production' and d.telemetry_region=v_region and (f.started_at at time zone 'Africa/Johannesburg')::date>=v_from and (coalesce(nullif(lower(p_branch),''),'all')='all' or lower(coalesce(m.branch,''))=lower(p_branch))
  ), activity as (select * from production_sales union all select * from simulation_sales union all select * from fault_rows), filtered as (
    select * from activity a where (v_kind='all' or a.activity_type=v_kind) and (v_search='' or lower(coalesce(a.machine_name,'')) like '%'||v_search||'%' or lower(coalesce(a.serial_number,'')) like '%'||v_search||'%' or lower(coalesce(a.device_code,'')) like '%'||v_search||'%' or lower(coalesce(a.product_name,'')) like '%'||v_search||'%' or lower(coalesce(a.selection_code,'')) like '%'||v_search||'%' or lower(coalesce(a.error_code,'')) like '%'||v_search||'%' or lower(coalesce(a.severity,'')) like '%'||v_search||'%' or lower(coalesce(a.detail,'')) like '%'||v_search||'%')
  ), ordered as (
    select * from filtered order by case when v_sort='error' then case when activity_type='error' and error_active then 0 when activity_type='error' then 1 else 2 end end asc,
      case when v_sort='sales' and v_direction='desc' then units_sold end desc nulls last,case when v_sort='sales' and v_direction='asc' then units_sold end asc nulls last,
      case when v_sort='machine' and v_direction='asc' then lower(coalesce(machine_name,serial_number,device_code,'')) end asc nulls last,case when v_sort='machine' and v_direction='desc' then lower(coalesce(machine_name,serial_number,device_code,'')) end desc nulls last,
      case when v_sort='newest' and v_direction='asc' then occurred_at end asc nulls last,case when v_sort='newest' and v_direction='desc' then occurred_at end desc nulls last,occurred_at desc,activity_id
  ), page_rows as (select * from ordered limit v_limit offset v_offset)
  select jsonb_build_object('telemetry_region',v_region,'period',lower(coalesce(p_period,'day')),'dataset',v_dataset,'date_from',v_from,'date_to',(now() at time zone 'Africa/Johannesburg')::date,'total',(select count(*) from filtered),
    'summary',jsonb_build_object('sale_rows',(select count(*) from filtered where activity_type='sale'),'units_sold',coalesce((select sum(units_sold) from filtered where activity_type='sale'),0),'revenue_cents',coalesce((select sum(revenue_cents) from filtered where activity_type='sale'),0),'error_events',(select count(*) from filtered where activity_type='error'),'active_errors',(select count(*) from filtered where activity_type='error' and error_active)),
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb),'limit',v_limit,'offset',v_offset) into v_result;
  return v_result;
end;
$$;
