-- Server-paginated factory device evidence for large telemetry fleets.

create or replace function public.get_telemetry_factory_directory(
  p_view text default 'devices',
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
  v_view text := lower(trim(coalesce(p_view,'devices')));
  v_search text := lower(trim(coalesce(p_search,'')));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_result jsonb;
begin
  if not public.is_dallmayr_app_user() or public.current_app_role()<>'admin' then
    raise exception 'Only a Dallmayr Administrator may access Factory.' using errcode='42501';
  end if;
  if v_view not in ('devices','provisioning','testing','firmware') then
    raise exception 'Invalid Factory view.' using errcode='22023';
  end if;

  with base as (
    select
      d.id,d.device_code,d.hardware_uid,d.machine_id,d.profile_id,d.status,d.firmware_version,
      d.last_seen_at,d.last_heartbeat_at,d.last_config_at,d.last_config_ack_at,d.last_transport,
      d.wifi_rssi,d.cellular_csq,d.cellular_operator,d.updated_at,
      (d.hardware_uid is not null and btrim(d.hardware_uid)<>'') identity_ok,
      (d.firmware_version is not null and btrim(d.firmware_version)<>'') firmware_ok,
      (coalesce(d.last_heartbeat_at,d.last_seen_at) is not null) communication_ok,
      (d.last_transport is not null) network_ok,
      (d.last_transport='cellular' or nullif(btrim(coalesce(d.cellular_operator,'')),'') is not null or d.cellular_csq is not null) cellular_observed,
      (d.last_config_ack_at is not null) config_ok
    from public.telemetry_devices d
    where d.telemetry_region=v_region
      and public.telemetry_account_allows_device(d.id)
  ), scored as (
    select
      b.*,
      (
        identity_ok::integer
        + firmware_ok::integer
        + communication_ok::integer
        + network_ok::integer
        + config_ok::integer
      )::integer evidence_completed,
      case
        when b.status='disabled' then 'Disabled'
        when identity_ok and firmware_ok and communication_ok and network_ok and config_ok then 'Operational evidence complete'
        when identity_ok and firmware_ok then 'Testing evidence pending'
        else 'Provisioning evidence pending'
      end readiness_label
    from base b
  ), filtered as (
    select s.*
    from scored s
    where
      (v_view='devices'
       or (v_view='provisioning' and (not s.identity_ok or not s.firmware_ok))
       or (v_view='testing' and s.identity_ok and s.firmware_ok and s.evidence_completed<5)
       or v_view='firmware')
      and (
        v_search=''
        or lower(coalesce(s.device_code,'')) like '%'||v_search||'%'
        or lower(coalesce(s.hardware_uid,'')) like '%'||v_search||'%'
        or lower(coalesce(s.firmware_version,'')) like '%'||v_search||'%'
        or lower(coalesce(s.cellular_operator,'')) like '%'||v_search||'%'
        or lower(coalesce(s.readiness_label,'')) like '%'||v_search||'%'
      )
  ), page_rows as (
    select f.*
    from filtered f
    order by
      case when v_view='firmware' then lower(coalesce(f.firmware_version,'')) end asc nulls last,
      f.updated_at desc nulls last,
      f.id
    limit v_limit offset v_offset
  ), summary as (
    select
      count(*)::bigint total,
      count(*) filter(where identity_ok)::bigint identity,
      count(*) filter(where firmware_ok)::bigint firmware,
      count(*) filter(where cellular_observed)::bigint cellular,
      count(*) filter(where config_ok)::bigint config_ack,
      count(*) filter(where evidence_completed<5)::bigint needs_review
    from scored
  ), firmware_groups as (
    select
      coalesce(nullif(btrim(firmware_version),''),'Unknown') version,
      count(*)::bigint device_count
    from scored
    group by 1
  )
  select jsonb_build_object(
    'telemetry_region',v_region,
    'view',v_view,
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,
      'device_code',p.device_code,
      'hardware_uid',p.hardware_uid,
      'machine_id',p.machine_id,
      'profile_id',p.profile_id,
      'status',p.status,
      'firmware_version',p.firmware_version,
      'last_seen_at',p.last_seen_at,
      'last_heartbeat_at',p.last_heartbeat_at,
      'last_config_at',p.last_config_at,
      'last_config_ack_at',p.last_config_ack_at,
      'last_transport',p.last_transport,
      'wifi_rssi',p.wifi_rssi,
      'cellular_csq',p.cellular_csq,
      'cellular_operator',p.cellular_operator,
      'updated_at',p.updated_at
    ) order by
      case when v_view='firmware' then lower(coalesce(p.firmware_version,'')) end asc nulls last,
      p.updated_at desc nulls last,p.id
    ) from page_rows p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'total',s.total,
      'identity',s.identity,
      'firmware',s.firmware,
      'cellular',s.cellular,
      'config_ack',s.config_ack,
      'needs_review',s.needs_review
    ),
    'firmware_groups',coalesce((select jsonb_agg(jsonb_build_object('version',g.version,'count',g.device_count) order by g.device_count desc,g.version) from firmware_groups g),'[]'::jsonb),
    'limit',v_limit,
    'offset',v_offset,
    'generated_at',now()
  )
  into v_result
  from summary s;

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_factory_directory(text,text,integer,integer) from public,anon;
grant execute on function public.get_telemetry_factory_directory(text,text,integer,integer) to authenticated;
