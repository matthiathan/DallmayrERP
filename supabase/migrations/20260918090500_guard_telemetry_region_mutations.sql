-- Child-table triggers ensure SECURITY DEFINER workflows cannot mutate a different region.
-- Human/anonymous Data API calls must pass regional checks. Only service_role and
-- internal database execution without a JWT bypass the human regional boundary.

create or replace function public.guard_device_scoped_telemetry_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_device uuid;
  v_row jsonb;
  v_jwt_role text:=coalesce(auth.jwt()->>'role','');
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  if v_jwt_role in ('service_role','') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_device:=nullif(v_row->>'device_id','')::uuid;
  perform public.assert_telemetry_region_selected();
  if v_device is null or not public.telemetry_region_allows_device(v_device) then
    raise exception 'Telemetry record is outside your region.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.guard_fault_scoped_telemetry_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_fault uuid;
  v_row jsonb;
  v_jwt_role text:=coalesce(auth.jwt()->>'role','');
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  if v_jwt_role in ('service_role','') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_fault:=nullif(v_row->>'fault_id','')::uuid;
  perform public.assert_telemetry_region_selected();
  if v_fault is null or not public.telemetry_region_allows_fault(v_fault) then
    raise exception 'Telemetry alarm is outside your region.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.guard_attention_scoped_telemetry_row()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_device uuid;
  v_key text;
  v_row jsonb;
  v_jwt_role text:=coalesce(auth.jwt()->>'role','');
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old); else v_row:=to_jsonb(new); end if;
  if v_jwt_role in ('service_role','') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_device:=nullif(v_row->>'device_id','')::uuid;
  v_key:=v_row->>'source_key';
  perform public.assert_telemetry_region_selected();
  if v_device is not null then
    if not public.telemetry_region_allows_device(v_device) then
      raise exception 'Fleet attention item is outside your region.' using errcode='42501';
    end if;
  elsif v_key is null or not public.telemetry_region_allows_attention_source(v_key) then
    raise exception 'Fleet attention item is outside your region.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'telemetry_prepaid_balance_state',
    'telemetry_device_config_history',
    'telemetry_fault_rule_candidates',
    'telemetry_test_sessions',
    'telemetry_test_commands'
  ] loop
    execute format('drop trigger if exists guard_region_mutation on public.%I',t);
    execute format('create trigger guard_region_mutation before insert or update or delete on public.%I for each row execute function public.guard_device_scoped_telemetry_row()',t);
  end loop;
end
$$;

drop trigger if exists guard_region_mutation on public.telemetry_alarm_workflow;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_alarm_workflow for each row execute function public.guard_fault_scoped_telemetry_row();

drop trigger if exists guard_region_mutation on public.telemetry_alarm_workflow_history;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_alarm_workflow_history for each row execute function public.guard_fault_scoped_telemetry_row();

drop trigger if exists guard_region_mutation on public.telemetry_fleet_attention_workflow;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_fleet_attention_workflow for each row execute function public.guard_attention_scoped_telemetry_row();

drop trigger if exists guard_region_mutation on public.telemetry_fleet_attention_workflow_history;
create trigger guard_region_mutation before insert or update or delete on public.telemetry_fleet_attention_workflow_history for each row execute function public.guard_attention_scoped_telemetry_row();

revoke all on function public.guard_device_scoped_telemetry_row() from public,anon,authenticated;
revoke all on function public.guard_fault_scoped_telemetry_row() from public,anon,authenticated;
revoke all on function public.guard_attention_scoped_telemetry_row() from public,anon,authenticated;
