-- Extend the secured machine-fleet API with server-side customer/site filters
-- and a set-based commissioning readiness state. The existing 5-argument
-- signature is retained for compatibility.

create or replace function public.get_telemetry_machine_fleet(
  p_search text,
  p_branch text,
  p_status text,
  p_customer_id uuid,
  p_site_id uuid,
  p_commissioning text,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_search text := lower(trim(coalesce(p_search,'')));
  v_branch text := lower(trim(coalesce(nullif(p_branch,''),'all')));
  v_status text := lower(trim(coalesce(nullif(p_status,''),'all')));
  v_commissioning text := lower(trim(coalesce(nullif(p_commissioning,''),'all')));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,75),1),250);
  v_result jsonb;
begin
  if v_status not in (
    'all','online','delayed','offline','never','unlinked','unconnected','faults',
    'profile_attention','profile_configured','profile_pending','profile_ambiguous','profile_unmatched'
  ) then
    raise exception 'Invalid machine fleet filter status' using errcode='22023';
  end if;

  if v_commissioning not in (
    'all','ready','no_device','never_connected','profile_attention','configuration_pending','mapping_attention'
  ) then
    raise exception 'Invalid commissioning filter status' using errcode='22023';
  end if;

  with mapping_readiness as (
    select
      m.profile_id,
      coalesce(bool_or(lower(btrim(p.product_name)) = 'instant porridge'), false) has_instant_porridge,
      coalesce(bool_or(lower(btrim(p.product_name)) = 'caramel cappuccino'), false) has_caramel_cappuccino,
      count(*) filter (
        where lower(btrim(p.product_name)) not in ('instant porridge','caramel cappuccino')
      )::integer other_mapped_product_count
    from public.machine_model_button_mappings m
    join public.products p on p.id=m.product_id and p.is_active=true
    group by m.profile_id
  ), active_devices as (
    select distinct on (d.machine_id)
      d.machine_id,
      d.id device_id,
      d.device_code,
      coalesce(ms.telemetry_mode,ep.policy->>'mode','live') telemetry_mode,
      coalesce(ms.machine_status,'unknown') machine_status,
      d.last_transport,
      d.wifi_rssi,
      d.cellular_csq,
      d.cellular_operator,
      d.firmware_version,
      d.last_seen_at,
      d.last_heartbeat_at,
      d.last_config_at,
      d.last_config_ack_at,
      d.machine_link_status,
      d.profile_id,
      coalesce(d.profile_assignment_method,'automatic') profile_assignment_method,
      d.reported_machine_interface,
      d.reported_machine_model,
      d.reported_machine_profile_fingerprint,
      d.reported_machine_revision,
      d.reported_machine_identity_source,
      d.reported_machine_identity_at,
      d.profile_updated_at,
      nullif(pr.resolution->>'effective_profile_key','') effective_profile_key,
      nullif(pr.resolution->>'profile_resolution','') profile_resolution,
      nullif(pr.resolution->>'confidence','') profile_confidence,
      nullif(d.applied_config->>'profile_id','') applied_profile_key,
      mp.model_key profile_model_key,
      mp.display_name profile_display_name,
      trusted_mp.id trusted_profile_record_id,
      coalesce(mr.has_instant_porridge,false) has_instant_porridge,
      coalesce(mr.has_caramel_cappuccino,false) has_caramel_cappuccino,
      coalesce(mr.other_mapped_product_count,0) other_mapped_product_count,
      case
        when coalesce(pr.resolution->>'profile_resolution','')='automatic_ambiguous' then 'ambiguous'
        when nullif(pr.resolution->>'effective_profile_key','') is null then 'unmatched'
        when nullif(d.applied_config->>'profile_id','') is distinct from nullif(pr.resolution->>'effective_profile_key','') then 'pending'
        else 'configured'
      end profile_status
    from public.telemetry_devices d
    left join public.telemetry_machine_state ms on ms.device_id=d.id
    left join lateral (
      select public.get_effective_telemetry_policy(d.id) policy
    ) ep on true
    left join lateral (
      select public.resolve_telemetry_device_profile_region_unscoped(d.id) resolution
    ) pr on true
    left join public.machine_model_profiles mp
      on mp.model_key=nullif(pr.resolution->>'effective_profile_key','')
    left join public.machine_model_profiles trusted_mp
      on trusted_mp.model_key=nullif(btrim(d.profile_id),'')
    left join mapping_readiness mr on mr.profile_id=trusted_mp.id
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
  ), base as (
    select
      m.id,m.branch,m.customer_id,m.site_id,m.serial_number,m.machine_barcode,m.asset_tag,m.machine_name,m.model,
      m.status asset_status,m.current_custodian,m.manufacturer,
      c.customer_name,c.customer_code,
      coalesce(s.site_name,'Unassigned site') site_name,
      coalesce(s.address,m.current_custodian,upper(m.branch),'Location not assigned') location,
      d.device_id,d.device_code,d.telemetry_mode,d.machine_status,d.last_transport,d.wifi_rssi,d.cellular_csq,
      d.cellular_operator,d.firmware_version,d.last_seen_at,d.last_heartbeat_at,
      d.profile_id,d.profile_assignment_method,d.reported_machine_interface,d.reported_machine_model,
      d.reported_machine_profile_fingerprint,d.reported_machine_revision,d.reported_machine_identity_source,
      d.reported_machine_identity_at,d.effective_profile_key,d.applied_profile_key,d.profile_resolution,
      d.profile_confidence,d.profile_model_key,d.profile_display_name,
      coalesce(d.profile_status,case when d.device_id is null then 'unlinked' else 'unmatched' end) profile_status,
      coalesce(fc.fault_count,0) fault_count,
      coalesce(d.last_heartbeat_at,d.last_seen_at) last_contact,
      case
        when d.device_id is null then 'unlinked'
        when coalesce(d.last_heartbeat_at,d.last_seen_at) is null then 'never'
        when coalesce(d.last_heartbeat_at,d.last_seen_at)>=now()-interval '30 minutes' then 'online'
        when coalesce(d.last_heartbeat_at,d.last_seen_at)>=now()-interval '24 hours' then 'delayed'
        else 'offline'
      end connection_status,
      case
        when d.device_id is null then 'no_device'
        when coalesce(d.last_heartbeat_at,d.last_seen_at) is null then 'never_connected'
        when coalesce(d.machine_link_status,'')<>'linked' or d.trusted_profile_record_id is null then 'profile_attention'
        when d.last_config_at is not null and (d.last_config_ack_at is null or d.last_config_ack_at<d.last_config_at) then 'configuration_pending'
        when not (d.has_instant_porridge and d.has_caramel_cappuccino and d.other_mapped_product_count>=1) then 'mapping_attention'
        else 'ready'
      end commissioning_status,
      (d.last_config_at is not null and (d.last_config_ack_at is null or d.last_config_ack_at<d.last_config_at)) configuration_pending,
      not coalesce(d.has_instant_porridge and d.has_caramel_cappuccino and d.other_mapped_product_count>=1,false) mapping_attention
    from public.machines m
    left join public.customers c on c.id=m.customer_id
    left join public.customer_sites s on s.id=m.site_id
    left join active_devices d on d.machine_id=m.id
    left join fault_counts fc on fc.machine_id=m.id
    where m.telemetry_region=v_region
      and public.telemetry_account_allows_machine(m.id)
  ), filtered as (
    select b.*
    from base b
    where (v_branch='all' or lower(b.branch)=v_branch)
      and (p_customer_id is null or b.customer_id=p_customer_id)
      and (p_site_id is null or b.site_id=p_site_id)
      and (
        v_status='all'
        or (v_status in ('online','delayed','offline','never','unlinked') and b.connection_status=v_status)
        or (v_status='unconnected' and b.connection_status in ('unlinked','never'))
        or (v_status='faults' and b.fault_count>0)
        or (v_status='profile_attention' and b.device_id is not null and b.profile_status in ('ambiguous','unmatched','pending'))
        or (v_status='profile_configured' and b.device_id is not null and b.profile_status='configured')
        or (v_status='profile_pending' and b.device_id is not null and b.profile_status='pending')
        or (v_status='profile_ambiguous' and b.device_id is not null and b.profile_status='ambiguous')
        or (v_status='profile_unmatched' and b.device_id is not null and b.profile_status='unmatched')
      )
      and (v_commissioning='all' or b.commissioning_status=v_commissioning)
      and (
        v_search=''
        or lower(coalesce(b.machine_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.serial_number,'')) like '%'||v_search||'%'
        or lower(coalesce(b.machine_barcode,'')) like '%'||v_search||'%'
        or lower(coalesce(b.asset_tag,'')) like '%'||v_search||'%'
        or lower(coalesce(b.model,'')) like '%'||v_search||'%'
        or lower(coalesce(b.manufacturer,'')) like '%'||v_search||'%'
        or lower(coalesce(b.customer_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.customer_code,'')) like '%'||v_search||'%'
        or lower(coalesce(b.site_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.location,'')) like '%'||v_search||'%'
        or lower(coalesce(b.device_code,'')) like '%'||v_search||'%'
        or lower(coalesce(b.profile_display_name,'')) like '%'||v_search||'%'
        or lower(coalesce(b.effective_profile_key,'')) like '%'||v_search||'%'
        or lower(coalesce(b.reported_machine_model,'')) like '%'||v_search||'%'
        or lower(coalesce(b.reported_machine_interface,'')) like '%'||v_search||'%'
        or lower(coalesce(b.reported_machine_profile_fingerprint,'')) like '%'||v_search||'%'
        or b.id::text=v_search
      )
  ), page_rows as (
    select f.*
    from filtered f
    order by
      case f.commissioning_status
        when 'profile_attention' then 0
        when 'configuration_pending' then 1
        when 'mapping_attention' then 2
        when 'never_connected' then 3
        when 'no_device' then 4
        else 5
      end,
      case when f.fault_count>0 then 0 else 1 end,
      lower(coalesce(f.machine_name,f.model,f.serial_number,f.asset_tag,f.id::text)),
      f.id
    limit v_limit offset v_offset
  ), fleet_summary as (
    select
      count(*)::bigint fleet_total,
      count(*) filter(where connection_status='online')::bigint online,
      count(*) filter(where connection_status='delayed')::bigint delayed,
      count(*) filter(where connection_status='offline')::bigint offline,
      count(*) filter(where connection_status='never')::bigint never,
      count(*) filter(where connection_status='unlinked')::bigint unlinked,
      coalesce(sum(fault_count),0)::bigint active_faults,
      count(*) filter(where device_id is not null and profile_status in ('ambiguous','unmatched','pending'))::bigint profile_attention,
      count(*) filter(where commissioning_status='ready')::bigint commissioning_ready,
      count(*) filter(where commissioning_status<>'ready')::bigint commissioning_attention
    from base
  )
  select jsonb_build_object(
    'telemetry_region',v_region,
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'fleet_total',fs.fleet_total,
    'summary',jsonb_build_object(
      'online',fs.online,
      'delayed',fs.delayed,
      'offline',fs.offline,
      'never',fs.never,
      'unlinked',fs.unlinked,
      'active_faults',fs.active_faults,
      'profile_attention',fs.profile_attention,
      'commissioning_ready',fs.commissioning_ready,
      'commissioning_attention',fs.commissioning_attention
    ),
    'branches',coalesce((select jsonb_agg(branch order by branch) from (select distinct lower(branch) branch from base where nullif(trim(branch),'') is not null) q),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(q) order by q.customer_name,q.customer_id) from (
      select distinct customer_id,coalesce(customer_name,'Unassigned customer') customer_name,customer_code
      from base where customer_id is not null
    ) q),'[]'::jsonb),
    'sites',coalesce((select jsonb_agg(to_jsonb(q) order by q.site_name,q.site_id) from (
      select distinct site_id,customer_id,site_name
      from base where site_id is not null
    ) q),'[]'::jsonb),
    'limit',v_limit,
    'offset',v_offset,
    'generated_at',now()
  ) into v_result
  from fleet_summary fs;

  return v_result;
end;
$function$;

create or replace function public.get_telemetry_machine_fleet(
  p_search text,
  p_branch text,
  p_status text,
  p_customer_id uuid,
  p_site_id uuid,
  p_offset integer,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.get_telemetry_machine_fleet(
    p_search,p_branch,p_status,p_customer_id,p_site_id,'all',p_offset,p_limit
  );
$function$;

create or replace function public.get_telemetry_machine_fleet(
  p_search text default '',
  p_branch text default 'all',
  p_status text default 'all',
  p_offset integer default 0,
  p_limit integer default 75
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.get_telemetry_machine_fleet(
    p_search,p_branch,p_status,null::uuid,null::uuid,'all',p_offset,p_limit
  );
$function$;

revoke all on function public.get_telemetry_machine_fleet(text,text,text,uuid,uuid,text,integer,integer) from public, anon;
revoke all on function public.get_telemetry_machine_fleet(text,text,text,uuid,uuid,integer,integer) from public, anon;
revoke all on function public.get_telemetry_machine_fleet(text,text,text,integer,integer) from public, anon;

grant execute on function public.get_telemetry_machine_fleet(text,text,text,uuid,uuid,text,integer,integer) to authenticated, service_role;
grant execute on function public.get_telemetry_machine_fleet(text,text,text,uuid,uuid,integer,integer) to authenticated, service_role;
grant execute on function public.get_telemetry_machine_fleet(text,text,text,integer,integer) to authenticated, service_role;
