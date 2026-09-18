-- SECURITY DEFINER telemetry read APIs must explicitly apply the signed-in region.

create or replace function public.get_telemetry_data_usage(p_days integer default 30)
returns table(device_id uuid, request_count bigint, request_bytes bigint, response_bytes bigint, application_bytes bigint, device_application_tx_bytes bigint, device_application_rx_bytes bigint, device_application_bytes bigint, device_application_sample_count bigint, modem_tx_bytes bigint, modem_rx_bytes bigint, measured_modem_bytes bigint, modem_sample_count bigint, days_observed bigint, last_reported_at timestamptz, projected_monthly_application_bytes numeric, projected_monthly_device_application_bytes numeric, projected_monthly_modem_bytes numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
begin
  return query
  with usage as (
    select u.*
    from public.telemetry_data_usage_daily u
    join public.telemetry_devices d on d.id = u.device_id
    where d.telemetry_region = v_region
      and u.usage_date >= (now() at time zone 'Africa/Johannesburg')::date - greatest(1, least(coalesce(p_days, 30), 366)) + 1
  ), totals as (
    select u.device_id,
      sum(u.request_count)::bigint as request_count,
      sum(u.request_bytes)::bigint as request_bytes,
      sum(u.response_bytes)::bigint as response_bytes,
      sum(u.device_application_tx_bytes)::bigint as device_application_tx_bytes,
      sum(u.device_application_rx_bytes)::bigint as device_application_rx_bytes,
      sum(u.device_application_sample_count)::bigint as device_application_sample_count,
      sum(u.modem_tx_bytes)::bigint as modem_tx_bytes,
      sum(u.modem_rx_bytes)::bigint as modem_rx_bytes,
      sum(u.modem_sample_count)::bigint as modem_sample_count,
      count(distinct u.usage_date)::bigint as days_observed,
      max(u.last_reported_at) as last_reported_at
    from usage u group by u.device_id
  )
  select t.device_id,t.request_count,t.request_bytes,t.response_bytes,
    (t.request_bytes+t.response_bytes)::bigint,
    t.device_application_tx_bytes,t.device_application_rx_bytes,
    (t.device_application_tx_bytes+t.device_application_rx_bytes)::bigint,
    t.device_application_sample_count,t.modem_tx_bytes,t.modem_rx_bytes,
    (t.modem_tx_bytes+t.modem_rx_bytes)::bigint,t.modem_sample_count,t.days_observed,t.last_reported_at,
    round(((t.request_bytes+t.response_bytes)::numeric/greatest(t.days_observed,1))*30),
    case when t.device_application_sample_count>0 then round(((t.device_application_tx_bytes+t.device_application_rx_bytes)::numeric/greatest(t.days_observed,1))*30) else null end,
    case when t.modem_sample_count>0 then round(((t.modem_tx_bytes+t.modem_rx_bytes)::numeric/greatest(t.days_observed,1))*30) else null end
  from totals t;
end;
$$;

create or replace function public.get_telemetry_prepaid_balances()
returns table(device_id uuid, device_code text, carrier text, ussd_code text, remaining_bytes bigint, balance_text text, query_status text, last_error text, checked_at timestamptz, received_at timestamptz, request_pending boolean, requested_at timestamptz, warning_threshold_bytes bigint, critical_threshold_bytes bigint, check_interval_minutes integer, stale_after_minutes integer, next_check_at timestamptz, is_stale boolean, alert_level text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
begin
  return query
  select d.id,d.device_code,
    coalesce(s.carrier,'Vodacom South Africa'::text),coalesce(s.ussd_code,'*111*502#'::text),
    s.remaining_bytes,s.balance_text,coalesce(s.query_status,'unknown'::text),s.last_error,s.checked_at,s.received_at,
    coalesce(s.request_pending,false),s.requested_at,coalesce(s.warning_threshold_bytes,104857600::bigint),
    coalesce(s.critical_threshold_bytes,26214400::bigint),coalesce(s.check_interval_minutes,360),coalesce(s.stale_after_minutes,720),
    case when s.checked_at is null then now() else s.checked_at+make_interval(mins=>coalesce(s.check_interval_minutes,360)) end,
    s.checked_at is null or s.checked_at+make_interval(mins=>coalesce(s.stale_after_minutes,720))<=now(),
    case when s.checked_at is null then 'unknown'
      when s.checked_at+make_interval(mins=>coalesce(s.stale_after_minutes,720))<=now() then 'stale'
      when s.query_status<>'ok' then s.query_status
      when s.remaining_bytes=0 then 'depleted'
      when s.remaining_bytes<=s.critical_threshold_bytes then 'critical'
      when s.remaining_bytes<=s.warning_threshold_bytes then 'low'
      else 'ok' end
  from public.telemetry_devices d
  left join public.telemetry_prepaid_balance_state s on s.device_id=d.id
  where d.telemetry_region=v_region
  order by d.device_code;
end;
$$;

create or replace function public.get_telemetry_transport_usage(p_days integer default 30)
returns table(device_id uuid, transport text, request_count bigint, request_bytes bigint, response_bytes bigint, application_bytes bigint, device_application_tx_bytes bigint, device_application_rx_bytes bigint, device_application_bytes bigint, device_application_sample_count bigint, modem_tx_bytes bigint, modem_rx_bytes bigint, measured_modem_bytes bigint, modem_sample_count bigint, days_observed bigint, last_reported_at timestamptz, current_application_tx_bytes_total bigint, current_application_rx_bytes_total bigint, current_application_bytes_total bigint, current_modem_tx_bytes_total bigint, current_modem_rx_bytes_total bigint, current_modem_bytes_total bigint, current_counter_updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
begin
  return query
  with allowed_devices as (
    select id from public.telemetry_devices where telemetry_region=v_region
  ), usage as (
    select u.* from public.telemetry_data_usage_daily u join allowed_devices ad on ad.id=u.device_id
    where u.usage_date >= (now() at time zone 'Africa/Johannesburg')::date - greatest(1,least(coalesce(p_days,30),366))+1
      and u.transport in ('wifi','cellular')
  ), totals as (
    select u.device_id,u.transport,sum(u.request_count)::bigint request_count,sum(u.request_bytes)::bigint request_bytes,
      sum(u.response_bytes)::bigint response_bytes,sum(u.device_application_tx_bytes)::bigint device_application_tx_bytes,
      sum(u.device_application_rx_bytes)::bigint device_application_rx_bytes,sum(u.device_application_sample_count)::bigint device_application_sample_count,
      sum(u.modem_tx_bytes)::bigint modem_tx_bytes,sum(u.modem_rx_bytes)::bigint modem_rx_bytes,sum(u.modem_sample_count)::bigint modem_sample_count,
      count(distinct u.usage_date)::bigint days_observed,max(u.last_reported_at) last_reported_at
    from usage u group by u.device_id,u.transport
  ), state_rows as (
    select s.* from public.telemetry_data_usage_state s join allowed_devices ad on ad.id=s.device_id
    where s.transport in ('wifi','cellular')
  ), combined as (
    select coalesce(t.device_id,s.device_id) device_id,coalesce(t.transport,s.transport) transport,
      t.request_count,t.request_bytes,t.response_bytes,t.device_application_tx_bytes,t.device_application_rx_bytes,t.device_application_sample_count,
      t.modem_tx_bytes,t.modem_rx_bytes,t.modem_sample_count,t.days_observed,t.last_reported_at,
      s.application_tx_bytes_total current_application_tx_bytes_total,s.application_rx_bytes_total current_application_rx_bytes_total,
      s.modem_tx_bytes_total current_modem_tx_bytes_total,s.modem_rx_bytes_total current_modem_rx_bytes_total,s.updated_at current_counter_updated_at
    from totals t full join state_rows s on s.device_id=t.device_id and s.transport=t.transport
  )
  select c.device_id,c.transport,coalesce(c.request_count,0)::bigint,coalesce(c.request_bytes,0)::bigint,coalesce(c.response_bytes,0)::bigint,
    (coalesce(c.request_bytes,0)+coalesce(c.response_bytes,0))::bigint,
    coalesce(c.device_application_tx_bytes,0)::bigint,coalesce(c.device_application_rx_bytes,0)::bigint,
    (coalesce(c.device_application_tx_bytes,0)+coalesce(c.device_application_rx_bytes,0))::bigint,coalesce(c.device_application_sample_count,0)::bigint,
    coalesce(c.modem_tx_bytes,0)::bigint,coalesce(c.modem_rx_bytes,0)::bigint,(coalesce(c.modem_tx_bytes,0)+coalesce(c.modem_rx_bytes,0))::bigint,
    coalesce(c.modem_sample_count,0)::bigint,coalesce(c.days_observed,0)::bigint,c.last_reported_at,
    c.current_application_tx_bytes_total,c.current_application_rx_bytes_total,
    case when c.current_application_tx_bytes_total is null and c.current_application_rx_bytes_total is null then null else coalesce(c.current_application_tx_bytes_total,0)+coalesce(c.current_application_rx_bytes_total,0) end::bigint,
    c.current_modem_tx_bytes_total,c.current_modem_rx_bytes_total,
    case when c.current_modem_tx_bytes_total is null and c.current_modem_rx_bytes_total is null then null else coalesce(c.current_modem_tx_bytes_total,0)+coalesce(c.current_modem_rx_bytes_total,0) end::bigint,
    c.current_counter_updated_at
  from combined c;
end;
$$;

create or replace function public.get_telemetry_location_map()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id',d.id,'device_code',d.device_code,'machine_id',d.machine_id,'machine_name',m.machine_name,'serial_number',m.serial_number,
    'branch',coalesce(m.branch,s.branch,'unassigned'),'machine_status',case when c.communication_error then 'error' else coalesce(ms.machine_status,'unknown') end,
    'active_fault_count',coalesce(ms.active_fault_count,0)+case when c.communication_error then 1 else 0 end,'last_seen_at',d.last_seen_at,
    'last_transport',d.last_transport,'expected_update_minutes',c.expected_update_minutes,'offline_after_minutes',c.offline_after_minutes,
    'update_deadline_at',c.update_deadline_at,'communication_status',c.communication_status,'communication_error',c.communication_error,
    'communication_error_code',case when c.communication_error then 'TELEMETRY_TIMEOUT' else null end,'minutes_overdue',c.minutes_overdue,
    'location_enabled',d.location_enabled,'location_interval_minutes',d.location_interval_minutes,'location_min_move_m',d.location_min_move_m,
    'latitude',coalesce(ls.latitude,s.latitude::double precision),'longitude',coalesce(ls.longitude,s.longitude::double precision),
    'accuracy_m',ls.accuracy_m,'altitude_m',ls.altitude_m,'speed_mps',ls.speed_mps,'satellites',ls.satellites,'hdop',ls.hdop,
    'location_source',case when ls.device_id is not null then ls.source when s.latitude is not null and s.longitude is not null then 'site' else null end,
    'location_fix_at',ls.fix_at,'location_received_at',ls.received_at,'movement_detected',coalesce(ls.movement_detected,false),
    'distance_from_previous_m',ls.distance_from_previous_m,
    'location_stale',case when ls.device_id is null then false else ls.received_at<now()-make_interval(mins=>greatest(d.location_interval_minutes*3,30)) end,
    'has_location',(ls.device_id is not null or (s.latitude is not null and s.longitude is not null))
  ) order by c.communication_error desc,d.device_code),'[]'::jsonb)
  into v_result
  from public.telemetry_devices d
  left join public.machines m on m.id=d.machine_id
  left join public.customer_sites s on s.id=coalesce(d.site_id,m.site_id)
  left join public.telemetry_machine_state ms on ms.device_id=d.id
  left join public.telemetry_device_location_state ls on ls.device_id=d.id
  left join lateral public.get_telemetry_connectivity_state(d.id) c on true
  where d.status='active' and d.telemetry_region=v_region;
  return v_result;
end;
$$;

create or replace function public.get_telemetry_device_policy_states()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text := public.assert_telemetry_region_selected();
  v_result jsonb;
begin
  if coalesce(v_role,'') not in ('admin','operations','executive') then raise exception 'insufficient privileges' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('device_id',d.id,'device_code',d.device_code,'mode',ep.policy->>'mode','policy_code',ep.policy->>'policy_code','counter_interval_minutes',(ep.policy->>'counter_interval_minutes')::integer,'heartbeat_interval_minutes',(ep.policy->>'heartbeat_interval_minutes')::integer,'config_refresh_minutes',(ep.policy->>'config_refresh_minutes')::integer,'last_seen_at',d.last_seen_at,'online',case when d.last_seen_at is null then false else d.last_seen_at>=now()-make_interval(mins=>2*greatest(1,(ep.policy->>'heartbeat_interval_minutes')::integer)) end) order by d.device_code),'[]'::jsonb)
  into v_result from public.telemetry_devices d left join lateral (select public.get_effective_telemetry_policy(d.id) as policy) ep on true
  where d.status='active' and d.telemetry_region=v_region;
  return v_result;
end;
$$;

create or replace function public.get_telemetry_simulation_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text := public.assert_telemetry_region_selected();
  v_result jsonb;
begin
  if coalesce(v_role,'') not in ('admin','executive') then raise exception 'insufficient privileges' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id',d.id,'device_code',d.device_code,'hardware_uid',d.hardware_uid,'reported_machine_serial',d.reported_machine_serial,
    'machine_link_status',d.machine_link_status,'machine_id',d.machine_id,'simulation_mode',coalesce(ms.simulation_mode,false),
    'simulated_counters',coalesce(ms.simulated_counters,'[]'::jsonb),'last_simulation_at',ms.last_simulation_at
  ) order by d.device_code),'[]'::jsonb)
  into v_result from public.telemetry_devices d left join public.telemetry_machine_state ms on ms.device_id=d.id
  where d.status='active' and d.telemetry_region=v_region;
  return v_result;
end;
$$;

create or replace function public.get_telemetry_live_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text := public.assert_telemetry_region_selected();
  v_result jsonb;
begin
  if coalesce(v_role,'') not in ('admin','executive','operations') then raise exception 'insufficient privileges' using errcode='42501'; end if;
  with device_rows as (
    select d.id device_id,d.device_code,d.machine_id,m.machine_name,m.serial_number,coalesce(m.branch,'unassigned') branch,d.profile_id,d.status device_status,
      coalesce(ms.telemetry_mode,ep.policy->>'mode','live') telemetry_mode,coalesce(ms.machine_status,'unknown') machine_status,coalesce(ms.active_fault_count,0) active_fault_count,
      d.transport_preference,d.last_transport,d.wifi_enabled,d.cellular_enabled,d.wifi_rssi,d.cellular_csq,d.cellular_operator,d.cellular_model,d.firmware_version,
      d.last_seen_at,d.last_counter_at,d.last_heartbeat_at,d.last_config_at,c.expected_update_minutes,c.grace_minutes,c.offline_after_minutes,c.update_deadline_at,
      c.communication_status,c.communication_error,c.minutes_overdue
    from public.telemetry_devices d
    left join public.machines m on m.id=d.machine_id left join public.telemetry_machine_state ms on ms.device_id=d.id
    left join lateral (select public.get_effective_telemetry_policy(d.id) policy) ep on true
    left join lateral public.get_telemetry_connectivity_state(d.id) c on true
    where d.status='active' and d.telemetry_region=v_region
  ), fault_rows as (
    select f.id::text id,f.device_id,d.device_code,f.machine_id,m.machine_name,m.serial_number,f.fault_code,f.severity,f.detail,f.started_at,f.last_seen_at,'machine'::text fault_source
    from public.telemetry_fault_events f join public.telemetry_devices d on d.id=f.device_id left join public.machines m on m.id=f.machine_id
    where f.cleared_at is null and d.telemetry_region=v_region
    union all
    select 'connectivity:'||dr.device_id::text,dr.device_id,dr.device_code,dr.machine_id,dr.machine_name,dr.serial_number,'TELEMETRY_TIMEOUT','fault',
      format('No telemetry update was received by the required deadline. Expected contact every %s minute(s) with %s minute(s) grace.',dr.expected_update_minutes,dr.grace_minutes),
      dr.update_deadline_at,dr.last_seen_at,'connectivity'::text
    from device_rows dr where dr.communication_error
  )
  select jsonb_build_object(
    'telemetry_region',v_region,
    'summary',jsonb_build_object('reporting_devices',(select count(*) from device_rows),'online_devices',(select count(*) from device_rows where communication_status='online'),
      'offline_devices',(select count(*) from device_rows where communication_status='offline'),'communication_errors',(select count(*) from device_rows where communication_error),
      'unassigned_devices',(select count(*) from device_rows where machine_id is null),'active_faults',(select count(*) from fault_rows)),
    'device_states',coalesce((select jsonb_agg(jsonb_build_object(
      'device_id',dr.device_id,'device_code',dr.device_code,'machine_id',dr.machine_id,'machine_name',dr.machine_name,'serial_number',dr.serial_number,'branch',dr.branch,
      'profile_id',dr.profile_id,'device_status',dr.device_status,'telemetry_mode',dr.telemetry_mode,'machine_status',dr.machine_status,'active_fault_count',dr.active_fault_count,
      'transport_preference',dr.transport_preference,'last_transport',dr.last_transport,'wifi_enabled',dr.wifi_enabled,'cellular_enabled',dr.cellular_enabled,'wifi_rssi',dr.wifi_rssi,
      'cellular_csq',dr.cellular_csq,'cellular_operator',dr.cellular_operator,'cellular_model',dr.cellular_model,'firmware_version',dr.firmware_version,
      'last_seen_at',dr.last_seen_at,'last_counter_at',dr.last_counter_at,'last_heartbeat_at',dr.last_heartbeat_at,'last_config_at',dr.last_config_at,
      'expected_update_minutes',dr.expected_update_minutes,'grace_minutes',dr.grace_minutes,'offline_after_minutes',dr.offline_after_minutes,'update_deadline_at',dr.update_deadline_at,
      'communication_status',dr.communication_status,'communication_error',dr.communication_error,'communication_error_code',case when dr.communication_error then 'TELEMETRY_TIMEOUT' else null end,
      'minutes_overdue',dr.minutes_overdue) order by dr.communication_error desc,dr.device_code) from device_rows dr),'[]'::jsonb),
    'active_faults',coalesce((select jsonb_agg(jsonb_build_object('id',fr.id,'device_id',fr.device_id,'device_code',fr.device_code,'machine_id',fr.machine_id,'machine_name',fr.machine_name,
      'serial_number',fr.serial_number,'fault_code',fr.fault_code,'severity',fr.severity,'detail',fr.detail,'started_at',fr.started_at,'last_seen_at',fr.last_seen_at,'fault_source',fr.fault_source)
      order by case fr.severity when 'critical' then 1 when 'fault' then 2 when 'warning' then 3 else 4 end,fr.started_at desc) from fault_rows fr),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.get_telemetry_machine_fleet(p_search text default '', p_branch text default 'all', p_status text default 'all', p_offset integer default 0, p_limit integer default 75)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_search text := lower(trim(coalesce(p_search,'')));
  v_branch text := lower(trim(coalesce(nullif(p_branch,''),'all')));
  v_status text := lower(trim(coalesce(nullif(p_status,''),'all')));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,75),1),250);
  v_result jsonb;
begin
  if v_status not in ('all','online','delayed','offline','never','unlinked','unconnected','faults','profile_attention') then raise exception 'Invalid machine fleet filter status' using errcode='22023'; end if;
  with active_devices as (
    select distinct on (d.machine_id) d.machine_id,d.id device_id,d.device_code,coalesce(ms.telemetry_mode,ep.policy->>'mode','live') telemetry_mode,
      coalesce(ms.machine_status,'unknown') machine_status,d.last_transport,d.wifi_rssi,d.cellular_csq,d.cellular_operator,d.firmware_version,d.last_seen_at,d.last_heartbeat_at,
      d.profile_id,coalesce(d.profile_assignment_method,'automatic') profile_assignment_method,d.reported_machine_interface,d.reported_machine_model,d.profile_updated_at,d.last_config_ack_at,
      mp.model_key profile_model_key,mp.display_name profile_display_name,
      case when d.profile_id is null then 'unmatched' when d.profile_updated_at is not null and (d.last_config_ack_at is null or d.last_config_ack_at<d.profile_updated_at) then 'pending' else 'configured' end profile_status
    from public.telemetry_devices d left join public.telemetry_machine_state ms on ms.device_id=d.id left join public.machine_model_profiles mp on mp.id=d.profile_id
    left join lateral (select public.get_effective_telemetry_policy(d.id) policy) ep on true
    where d.status='active' and d.machine_id is not null and d.telemetry_region=v_region
    order by d.machine_id,d.updated_at desc,d.id
  ), fault_counts as (
    select f.machine_id,count(*)::integer fault_count from public.telemetry_fault_events f join public.telemetry_devices d on d.id=f.device_id
    where f.cleared_at is null and f.machine_id is not null and d.telemetry_region=v_region group by f.machine_id
  ), base as (
    select m.id,m.branch,m.site_id,m.serial_number,m.machine_barcode,m.asset_tag,m.machine_name,m.model,m.status asset_status,m.current_custodian,m.manufacturer,
      coalesce(s.site_name,'Unassigned site') site_name,coalesce(s.address,m.current_custodian,upper(m.branch),'Location not assigned') location,
      d.device_id,d.device_code,d.telemetry_mode,d.machine_status,d.last_transport,d.wifi_rssi,d.cellular_csq,d.cellular_operator,d.firmware_version,d.last_seen_at,d.last_heartbeat_at,
      d.profile_id,d.profile_assignment_method,d.reported_machine_interface,d.reported_machine_model,d.profile_model_key,d.profile_display_name,
      coalesce(d.profile_status,case when d.device_id is null then 'unlinked' else 'unmatched' end) profile_status,coalesce(fc.fault_count,0) fault_count,
      coalesce(d.last_heartbeat_at,d.last_seen_at) last_contact,
      case when d.device_id is null then 'unlinked' when coalesce(d.last_heartbeat_at,d.last_seen_at) is null then 'never'
        when coalesce(d.last_heartbeat_at,d.last_seen_at)>=now()-interval '30 minutes' then 'online'
        when coalesce(d.last_heartbeat_at,d.last_seen_at)>=now()-interval '24 hours' then 'delayed' else 'offline' end connection_status
    from public.machines m left join public.customer_sites s on s.id=m.site_id left join active_devices d on d.machine_id=m.id left join fault_counts fc on fc.machine_id=m.id
    where m.telemetry_region=v_region
  ), filtered as (
    select b.* from base b where (v_branch='all' or lower(b.branch)=v_branch)
      and (v_status='all' or (v_status in ('online','delayed','offline','never','unlinked') and b.connection_status=v_status)
        or (v_status='unconnected' and b.connection_status in ('unlinked','never')) or (v_status='faults' and b.fault_count>0)
        or (v_status='profile_attention' and b.device_id is not null and b.profile_status in ('unmatched','pending')))
      and (v_search='' or lower(coalesce(b.machine_name,'')) like '%'||v_search||'%' or lower(coalesce(b.serial_number,'')) like '%'||v_search||'%'
        or lower(coalesce(b.machine_barcode,'')) like '%'||v_search||'%' or lower(coalesce(b.asset_tag,'')) like '%'||v_search||'%'
        or lower(coalesce(b.model,'')) like '%'||v_search||'%' or lower(coalesce(b.manufacturer,'')) like '%'||v_search||'%'
        or lower(coalesce(b.site_name,'')) like '%'||v_search||'%' or lower(coalesce(b.location,'')) like '%'||v_search||'%'
        or lower(coalesce(b.device_code,'')) like '%'||v_search||'%' or lower(coalesce(b.profile_display_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.reported_machine_model,'')) like '%'||v_search||'%' or lower(coalesce(b.reported_machine_interface,'')) like '%'||v_search||'%' or b.id::text=v_search)
  ), page_rows as (
    select f.* from filtered f order by case when f.fault_count>0 then 0 else 1 end,case f.profile_status when 'pending' then 0 when 'unmatched' then 1 else 2 end,
      lower(coalesce(f.machine_name,f.model,f.serial_number,f.asset_tag,f.id::text)),f.id limit v_limit offset v_offset
  ), fleet_summary as (
    select count(*)::bigint fleet_total,count(*) filter(where connection_status='online')::bigint online,count(*) filter(where connection_status='delayed')::bigint delayed,
      count(*) filter(where connection_status='offline')::bigint offline,count(*) filter(where connection_status='never')::bigint never,count(*) filter(where connection_status='unlinked')::bigint unlinked,
      coalesce(sum(fault_count),0)::bigint active_faults,count(*) filter(where device_id is not null and profile_status in ('unmatched','pending'))::bigint profile_attention from base
  )
  select jsonb_build_object('telemetry_region',v_region,'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb),'total',(select count(*) from filtered),
    'fleet_total',fs.fleet_total,'summary',jsonb_build_object('online',fs.online,'delayed',fs.delayed,'offline',fs.offline,'never',fs.never,'unlinked',fs.unlinked,
      'active_faults',fs.active_faults,'profile_attention',fs.profile_attention),
    'branches',coalesce((select jsonb_agg(branch order by branch) from (select distinct lower(branch) branch from base where nullif(trim(branch),'') is not null) branches),'[]'::jsonb),
    'limit',v_limit,'offset',v_offset,'generated_at',now()) into v_result from fleet_summary fs;
  return v_result;
end;
$$;
