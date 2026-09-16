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

-- Generic child-row guards protect mutations even inside SECURITY DEFINER workflows.
create or replace function public.guard_device_scoped_telemetry_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_device uuid; v_service boolean:=coalesce(auth.jwt()->>'role','')='service_role';
begin
  if v_service or auth.uid() is null then return case when tg_op='DELETE' then old else new end; end if;
  v_device:=coalesce(nullif(to_jsonb(case when tg_op='DELETE' then old else new end)->>'device_id','')::uuid,nullif(to_jsonb(case when tg_op='DELETE' then old else new end)->>'id','')::uuid);
  perform public.assert_telemetry_region_selected();
  if v_device is null or not public.telemetry_region_allows_device(v_device) then raise exception 'Telemetry record is outside your region.' using errcode='42501'; end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.guard_fault_scoped_telemetry_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_fault uuid; v_service boolean:=coalesce(auth.jwt()->>'role','')='service_role';
begin
  if v_service or auth.uid() is null then return case when tg_op='DELETE' then old else new end; end if;
  v_fault:=nullif(to_jsonb(case when tg_op='DELETE' then old else new end)->>'fault_id','')::uuid;
  perform public.assert_telemetry_region_selected();
  if v_fault is null or not public.telemetry_region_allows_fault(v_fault) then raise exception 'Telemetry alarm is outside your region.' using errcode='42501'; end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.guard_attention_scoped_telemetry_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_device uuid; v_key text; v_service boolean:=coalesce(auth.jwt()->>'role','')='service_role';
begin
  if v_service or auth.uid() is null then return case when tg_op='DELETE' then old else new end; end if;
  v_device:=nullif(to_jsonb(case when tg_op='DELETE' then old else new end)->>'device_id','')::uuid;
  v_key:=to_jsonb(case when tg_op='DELETE' then old else new end)->>'source_key';
  perform public.assert_telemetry_region_selected();
  if v_device is not null then
    if not public.telemetry_region_allows_device(v_device) then raise exception 'Fleet attention item is outside your region.' using errcode='42501'; end if;
  elsif v_key is null or not public.telemetry_region_allows_attention_source(v_key) then
    raise exception 'Fleet attention item is outside your region.' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

DO $$
declare t text;
begin
  foreach t in array array['telemetry_prepaid_balance_state','telemetry_device_config_history','telemetry_fault_rule_candidates','telemetry_test_sessions','telemetry_test_commands'] loop
    execute format('drop trigger if exists guard_region_mutation on public.%I',t);
    execute format('create trigger guard_region_mutation before insert or update or delete on public.%I for each row execute function public.guard_device_scoped_telemetry_row()',t);
  end loop;
end $$;

drop trigger if exists guard_region_mutation on public.telemetry_alarm_workflow;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_alarm_workflow for each row execute function public.guard_fault_scoped_telemetry_row();
drop trigger if exists guard_region_mutation on public.telemetry_alarm_workflow_history;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_alarm_workflow_history for each row execute function public.guard_fault_scoped_telemetry_row();
drop trigger if exists guard_region_mutation on public.telemetry_fleet_attention_workflow;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_fleet_attention_workflow for each row execute function public.guard_attention_scoped_telemetry_row();
drop trigger if exists guard_region_mutation on public.telemetry_fleet_attention_workflow_history;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_fleet_attention_workflow_history for each row execute function public.guard_attention_scoped_telemetry_row();
