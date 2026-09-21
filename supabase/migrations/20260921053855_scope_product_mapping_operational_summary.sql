-- Shared product/profile catalogue definitions remain global. Operational fleet
-- counts and observed device evidence follow the selected telemetry region for
-- authenticated users, while the service role retains its global maintenance view.

create or replace function public.get_product_mapping_operational_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_service_role boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_region text;
  v_result jsonb;
begin
  if not v_is_service_role then
    if not public.is_active_app_user() then
      raise exception 'An active authenticated DallmayrERP user is required.' using errcode = '42501';
    end if;
    v_region := public.assert_telemetry_region_selected();
  end if;

  with effective_devices as (
    select
      d.id as device_id,
      d.device_code,
      d.machine_id,
      m.machine_name,
      m.model as machine_model,
      coalesce(
        case when coalesce(d.profile_assignment_method, 'automatic') = 'manual' then nullif(btrim(d.profile_id), '') end,
        nullif(btrim(d.applied_config ->> 'profile_id'), ''),
        reported_profile.model_key,
        machine_profile.model_key
      ) as effective_profile_key
    from public.telemetry_devices d
    left join public.machines m on m.id = d.machine_id
    left join lateral (
      select mp.model_key
      from public.machine_model_profiles mp
      where regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(coalesce(d.reported_machine_model, '')), '[^a-z0-9]+', '', 'g')
        and btrim(coalesce(d.reported_machine_model, '')) <> ''
      limit 1
    ) reported_profile on true
    left join lateral (
      select mp.model_key
      from public.machine_model_profiles mp
      where regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(coalesce(m.model, m.machine_name, '')), '[^a-z0-9]+', '', 'g')
        and btrim(coalesce(m.model, m.machine_name, '')) <> ''
      limit 1
    ) machine_profile on true
    where d.status = 'active'
      and (v_is_service_role or d.telemetry_region = v_region)
  ),
  profile_rows as (
    select
      mp.id,
      mp.model_key,
      mp.display_name,
      mp.button_count,
      count(distinct mm.id)::integer as mapped_count,
      greatest(mp.button_count - count(distinct mm.id)::integer, 0) as unmapped_count,
      case when mp.button_count > 0
        then round((count(distinct mm.id)::numeric * 100) / mp.button_count)::integer
        else 0 end as completeness_percent,
      count(distinct case when p.is_active = false then mm.id end)::integer as inactive_product_count,
      (select count(*)::integer
       from public.machines m
       where regexp_replace(lower(coalesce(m.model, m.machine_name, '')), '[^a-z0-9]+', '', 'g') =
             regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g')
         and (v_is_service_role or m.telemetry_region = v_region)) as machine_count,
      (select count(*)::integer
       from effective_devices ed
       where lower(btrim(coalesce(ed.effective_profile_key, ''))) = lower(btrim(mp.model_key))) as active_device_count,
      mp.updated_at
    from public.machine_model_profiles mp
    left join public.machine_model_button_mappings mm on mm.profile_id = mp.id
    left join public.products p on p.id = mm.product_id
    group by mp.id, mp.model_key, mp.display_name, mp.button_count, mp.updated_at
  ),
  unmapped_rows as (
    select
      ed.device_id,
      ed.device_code,
      ed.machine_id,
      ed.machine_name,
      ed.machine_model,
      ed.effective_profile_key as profile_key,
      cs.selection_code,
      max(cs.sold_total)::bigint as sold_total,
      max(cs.failed_total)::bigint as failed_total,
      max(cs.updated_at) as last_seen_at
    from public.telemetry_counter_state cs
    join effective_devices ed on ed.device_id = cs.device_id
    left join public.machine_model_profiles mp
      on lower(btrim(mp.model_key)) = lower(btrim(coalesce(ed.effective_profile_key, '')))
    left join public.machine_model_button_mappings mm
      on mm.profile_id = mp.id
     and lower(btrim(mm.selection_code)) = lower(btrim(cs.selection_code))
    where mm.id is null
      and btrim(coalesce(cs.selection_code, '')) <> ''
      and (coalesce(cs.sold_total, 0) > 0 or coalesce(cs.failed_total, 0) > 0)
    group by ed.device_id, ed.device_code, ed.machine_id, ed.machine_name,
             ed.machine_model, ed.effective_profile_key, cs.selection_code
    order by max(cs.updated_at) desc
    limit 100
  )
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'model_key', pr.model_key,
        'display_name', pr.display_name,
        'button_count', pr.button_count,
        'mapped_count', pr.mapped_count,
        'unmapped_count', pr.unmapped_count,
        'completeness_percent', pr.completeness_percent,
        'inactive_product_count', pr.inactive_product_count,
        'machine_count', pr.machine_count,
        'active_device_count', pr.active_device_count,
        'updated_at', pr.updated_at
      ) order by pr.active_device_count desc, pr.machine_count desc, pr.display_name)
      from profile_rows pr
    ), '[]'::jsonb),
    'unmapped_selections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', ur.device_id,
        'device_code', ur.device_code,
        'machine_id', ur.machine_id,
        'machine_name', ur.machine_name,
        'machine_model', ur.machine_model,
        'profile_key', ur.profile_key,
        'selection_code', ur.selection_code,
        'sold_total', ur.sold_total,
        'failed_total', ur.failed_total,
        'last_seen_at', ur.last_seen_at
      ) order by ur.last_seen_at desc)
      from unmapped_rows ur
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_product_mapping_operational_summary() from public, anon;
grant execute on function public.get_product_mapping_operational_summary() to authenticated, service_role;

comment on function public.get_product_mapping_operational_summary() is
  'Returns the shared product/profile catalogue with operational machine counts and unmapped device evidence scoped to the authenticated operator selected telemetry region; service role remains global.';
