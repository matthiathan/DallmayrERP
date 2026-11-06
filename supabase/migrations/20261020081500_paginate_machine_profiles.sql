-- Server-paginated machine profile register and bounded profile detail.

create or replace function public.get_machine_profile_directory(
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
  v_search text := lower(trim(coalesce(p_search,'')));
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
  v_result jsonb;
begin
  if not public.is_dallmayr_app_user() or public.current_app_role()<>'admin' then
    raise exception 'Only a Dallmayr Administrator may manage machine profiles.' using errcode='42501';
  end if;

  with device_stats as (
    select
      p.id profile_record_id,
      count(d.id)::bigint device_count,
      count(d.id) filter (
        where nullif(d.applied_config->>'profile_id','') is distinct from p.model_key
      )::bigint pending_devices
    from public.machine_model_profiles p
    left join public.telemetry_devices d
      on d.status<>'retired'
     and d.telemetry_region=v_region
     and public.telemetry_account_allows_device(d.id)
     and (
       d.profile_id=p.model_key
       or nullif(d.applied_config->>'profile_id','')=p.model_key
     )
    group by p.id
  ), mapping_stats as (
    select m.profile_id,count(*)::bigint mapping_count
    from public.machine_model_button_mappings m
    group by m.profile_id
  ), fault_stats as (
    select
      r.profile_id,
      count(*) filter(where r.is_active)::bigint fault_count,
      count(*) filter(where r.is_active and r.is_verified)::bigint verified_faults
    from public.machine_model_fault_rules r
    group by r.profile_id
  ), rows as (
    select
      p.id,p.model_key,p.display_name,p.button_count,p.created_at,p.updated_at,
      coalesce(ms.mapping_count,0)::bigint mapping_count,
      coalesce(fs.fault_count,0)::bigint fault_count,
      coalesce(fs.verified_faults,0)::bigint verified_faults,
      coalesce(ds.device_count,0)::bigint device_count,
      coalesce(ds.pending_devices,0)::bigint pending_devices
    from public.machine_model_profiles p
    left join mapping_stats ms on ms.profile_id=p.id
    left join fault_stats fs on fs.profile_id=p.id
    left join device_stats ds on ds.profile_record_id=p.id
  ), filtered as (
    select *
    from rows r
    where v_search=''
      or lower(coalesce(r.display_name,'')) like '%'||v_search||'%'
      or lower(coalesce(r.model_key,'')) like '%'||v_search||'%'
  ), page_rows as (
    select *
    from filtered
    order by lower(display_name),model_key,id
    limit v_limit offset v_offset
  ), totals as (
    select
      count(*)::bigint profile_count,
      coalesce(sum(mapping_count),0)::bigint mapping_count,
      coalesce(sum(verified_faults),0)::bigint verified_fault_rules,
      coalesce(sum(device_count),0)::bigint profile_devices,
      coalesce(sum(pending_devices),0)::bigint pending_config
    from rows
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.display_name),p.model_key,p.id) from page_rows p),'[]'::jsonb),
    'total',(select count(*) from filtered),
    'summary',jsonb_build_object(
      'profiles',t.profile_count,
      'product_mappings',t.mapping_count,
      'verified_fault_rules',t.verified_fault_rules,
      'profile_devices',t.profile_devices,
      'pending_config',t.pending_config
    ),
    'limit',v_limit,
    'offset',v_offset,
    'telemetry_region',v_region,
    'generated_at',now()
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;

create or replace function public.get_machine_profile_detail(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_profile public.machine_model_profiles%rowtype;
  v_result jsonb;
begin
  if not public.is_dallmayr_app_user() or public.current_app_role()<>'admin' then
    raise exception 'Only a Dallmayr Administrator may manage machine profiles.' using errcode='42501';
  end if;

  select * into v_profile
  from public.machine_model_profiles
  where id=p_profile_id;
  if not found then
    raise exception 'Machine profile was not found.' using errcode='22023';
  end if;

  select jsonb_build_object(
    'profile',to_jsonb(v_profile),
    'mappings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,
        'profile_id',m.profile_id,
        'button_number',m.button_number,
        'selection_code',m.selection_code,
        'product_id',m.product_id,
        'products',jsonb_build_object('product_name',p.product_name,'is_active',p.is_active)
      ) order by m.button_number,m.id)
      from public.machine_model_button_mappings m
      left join public.products p on p.id=m.product_id
      where m.profile_id=p_profile_id
    ),'[]'::jsonb),
    'fault_rules',coalesce((
      select jsonb_agg(to_jsonb(r) order by r.raw_fault_code,r.id)
      from public.machine_model_fault_rules r
      where r.profile_id=p_profile_id
    ),'[]'::jsonb),
    'devices',coalesce((
      select jsonb_agg(to_jsonb(q) order by q.device_code,q.id)
      from (
        select
          d.id,d.device_code,d.profile_id,d.profile_assignment_method,d.reported_machine_model,
          d.reported_machine_interface,d.firmware_version,d.last_config_ack_at,d.applied_config
        from public.telemetry_devices d
        where d.status<>'retired'
          and d.telemetry_region=v_region
          and public.telemetry_account_allows_device(d.id)
          and (
            d.profile_id=v_profile.model_key
            or nullif(d.applied_config->>'profile_id','')=v_profile.model_key
          )
        order by d.device_code,d.id
        limit 250
      ) q
    ),'[]'::jsonb),
    'telemetry_region',v_region
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_machine_profile_directory(text,integer,integer) from public,anon;
grant execute on function public.get_machine_profile_directory(text,integer,integer) to authenticated;
revoke all on function public.get_machine_profile_detail(uuid) from public,anon;
grant execute on function public.get_machine_profile_detail(uuid) to authenticated;
