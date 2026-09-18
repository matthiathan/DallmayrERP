-- Protect detail SECURITY DEFINER RPCs while preserving their public signatures.

alter function public.get_telemetry_machine_identity(uuid) rename to get_telemetry_machine_identity_region_unscoped;
revoke execute on function public.get_telemetry_machine_identity_region_unscoped(uuid) from public, authenticated;
grant execute on function public.get_telemetry_machine_identity_region_unscoped(uuid) to service_role;
create function public.get_telemetry_machine_identity(p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    perform public.assert_telemetry_region_selected();
    if not public.telemetry_region_allows_machine(p_machine_id) then raise exception 'Machine not found in your telemetry region.' using errcode='42501'; end if;
  end if;
  return public.get_telemetry_machine_identity_region_unscoped(p_machine_id);
end; $$;
grant execute on function public.get_telemetry_machine_identity(uuid) to authenticated, service_role;

alter function public.get_telemetry_device_config_history(uuid,integer) rename to get_telemetry_device_config_history_region_unscoped;
revoke execute on function public.get_telemetry_device_config_history_region_unscoped(uuid,integer) from public, authenticated;
grant execute on function public.get_telemetry_device_config_history_region_unscoped(uuid,integer) to service_role;
create function public.get_telemetry_device_config_history(p_device_id uuid,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    perform public.assert_telemetry_region_selected();
    if not public.telemetry_region_allows_device(p_device_id) then raise exception 'Telemetry device not found in your region.' using errcode='42501'; end if;
  end if;
  return public.get_telemetry_device_config_history_region_unscoped(p_device_id,p_limit);
end; $$;
grant execute on function public.get_telemetry_device_config_history(uuid,integer) to authenticated, service_role;

alter function public.resolve_telemetry_device_profile(uuid) rename to resolve_telemetry_device_profile_region_unscoped;
revoke execute on function public.resolve_telemetry_device_profile_region_unscoped(uuid) from public, authenticated;
grant execute on function public.resolve_telemetry_device_profile_region_unscoped(uuid) to service_role;
create function public.resolve_telemetry_device_profile(p_device_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    perform public.assert_telemetry_region_selected();
    if not public.telemetry_region_allows_device(p_device_id) then raise exception 'Telemetry device not found in your region.' using errcode='42501'; end if;
  end if;
  return public.resolve_telemetry_device_profile_region_unscoped(p_device_id);
end; $$;
grant execute on function public.resolve_telemetry_device_profile(uuid) to authenticated, service_role;

alter function public.resolve_effective_telemetry_profile_key(uuid,uuid) rename to resolve_effective_telemetry_profile_key_region_unscoped;
revoke execute on function public.resolve_effective_telemetry_profile_key_region_unscoped(uuid,uuid) from public, authenticated;
grant execute on function public.resolve_effective_telemetry_profile_key_region_unscoped(uuid,uuid) to service_role;
create function public.resolve_effective_telemetry_profile_key(p_device_id uuid,p_machine_id uuid)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    perform public.assert_telemetry_region_selected();
    if p_device_id is not null and not public.telemetry_region_allows_device(p_device_id) then raise exception 'Telemetry device not found in your region.' using errcode='42501'; end if;
    if p_machine_id is not null and not public.telemetry_region_allows_machine(p_machine_id) then raise exception 'Machine not found in your telemetry region.' using errcode='42501'; end if;
  end if;
  return public.resolve_effective_telemetry_profile_key_region_unscoped(p_device_id,p_machine_id);
end; $$;
grant execute on function public.resolve_effective_telemetry_profile_key(uuid,uuid) to authenticated, service_role;

create or replace function public.get_recent_telemetry_selection_observations(p_limit integer default 50,p_device_id uuid default null,p_machine_id uuid default null)
returns table(id bigint,event_id text,device_id uuid,device_code text,machine_id uuid,machine_name text,machine_model text,interface text,selection_code text,item_number integer,price_minor bigint,currency text,result text,source text,confirmation text,confidence text,observed_at timestamptz,received_at timestamptz)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_region text;
begin
  if coalesce(auth.jwt()->>'role','')='service_role' then v_region:=null; else v_region:=public.assert_telemetry_region_selected(); end if;
  if p_device_id is not null and v_region is not null and not public.telemetry_region_allows_device(p_device_id) then raise exception 'Telemetry device not found in your region.' using errcode='42501'; end if;
  if p_machine_id is not null and v_region is not null and not public.telemetry_region_allows_machine(p_machine_id) then raise exception 'Machine not found in your telemetry region.' using errcode='42501'; end if;
  return query
  select o.id,o.event_id,o.device_id,d.device_code,o.machine_id,m.machine_name,m.model,o.interface,o.selection_code,o.item_number,o.price_minor,o.currency,o.result,o.source,o.confirmation,o.confidence,o.observed_at,o.received_at
  from public.telemetry_selection_observations o join public.telemetry_devices d on d.id=o.device_id left join public.machines m on m.id=o.machine_id
  where (v_region is null or d.telemetry_region=v_region) and (p_device_id is null or o.device_id=p_device_id) and (p_machine_id is null or o.machine_id=p_machine_id)
  order by o.observed_at desc,o.id desc limit least(greatest(coalesce(p_limit,50),1),200);
end; $$;
