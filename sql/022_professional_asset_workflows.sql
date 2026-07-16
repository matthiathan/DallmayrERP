-- DallmayrERP professional machine-asset lifecycle RPCs and audit history.

create or replace function public.update_asset_custody(
  p_machine_id uuid,
  p_action text,
  p_custodian text default null,
  p_condition text default 'unknown',
  p_notes text default null
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_role text:=public.current_app_role();
  v_status text;
  v_event text;
begin
  if v_role not in ('admin','operations','technician','road_technician') then raise exception 'Not authorised'; end if;
  if p_action not in ('assign','checkout','checkin','service') then raise exception 'Invalid custody action'; end if;
  if p_condition not in ('good','fair','poor','critical','unknown') then raise exception 'Invalid condition'; end if;
  v_status:=case p_action when 'assign' then 'assigned' when 'checkout' then 'checked_out' when 'checkin' then 'available' else 'in_service' end;
  v_event:=case p_action when 'assign' then 'assigned' when 'checkout' then 'checked_out' when 'checkin' then 'checked_in' else 'maintenance' end;
  update public.machines
  set current_custodian=case when p_action='checkin' then null else nullif(trim(coalesce(p_custodian,'')),'') end,
      custody_status=v_status,
      condition=p_condition,
      updated_at=now()
  where id=p_machine_id;
  if not found then raise exception 'Machine not found'; end if;
  insert into public.asset_events(machine_id,event_type,actor_user_id,custodian,condition,notes)
  values(p_machine_id,v_event,v_actor,nullif(trim(coalesce(p_custodian,'')),''),p_condition,nullif(trim(coalesce(p_notes,'')),''));
end; $$;
grant execute on function public.update_asset_custody(uuid,text,text,text,text) to authenticated;

create or replace function public.record_asset_audit(
  p_machine_id uuid,
  p_result text,
  p_condition text,
  p_notes text default null,
  p_next_audit_at timestamptz default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_role text:=public.current_app_role();
  v_id uuid;
begin
  if v_role not in ('admin','operations','technician','road_technician') then raise exception 'Not authorised'; end if;
  if p_result not in ('passed','attention','failed') then raise exception 'Invalid audit result'; end if;
  if p_condition not in ('good','fair','poor','critical','unknown') then raise exception 'Invalid condition'; end if;
  insert into public.asset_audits(machine_id,audited_by,result,condition,notes,next_audit_at)
  values(p_machine_id,v_actor,p_result,p_condition,nullif(trim(coalesce(p_notes,'')),''),p_next_audit_at)
  returning id into v_id;
  update public.machines set last_audit_at=now(),next_audit_at=p_next_audit_at,condition=p_condition,updated_at=now() where id=p_machine_id;
  insert into public.asset_events(machine_id,event_type,actor_user_id,condition,notes,metadata)
  values(p_machine_id,'audited',v_actor,p_condition,nullif(trim(coalesce(p_notes,'')),''),jsonb_build_object('audit_id',v_id,'result',p_result,'next_audit_at',p_next_audit_at));
  return v_id;
end; $$;
grant execute on function public.record_asset_audit(uuid,text,text,text,timestamptz) to authenticated;

create or replace function public.update_asset_profile(
  p_machine_id uuid,
  p_criticality text,
  p_condition text,
  p_installed_at date default null,
  p_warranty_expires_at date default null,
  p_next_audit_at timestamptz default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role();
begin
  if v_role not in ('admin','operations') then raise exception 'Not authorised'; end if;
  if p_criticality not in ('low','medium','high','critical') then raise exception 'Invalid criticality'; end if;
  if p_condition not in ('good','fair','poor','critical','unknown') then raise exception 'Invalid condition'; end if;
  update public.machines
  set criticality=p_criticality,
      condition=p_condition,
      installed_at=p_installed_at,
      warranty_expires_at=p_warranty_expires_at,
      next_audit_at=p_next_audit_at,
      updated_at=now()
  where id=p_machine_id;
  if not found then raise exception 'Machine not found'; end if;
end; $$;
grant execute on function public.update_asset_profile(uuid,text,text,date,date,timestamptz) to authenticated;

create or replace function public.log_machine_creation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.asset_events(machine_id,event_type,actor_user_id,condition,notes,metadata)
  values(new.id,'created',public.current_app_user_id(),new.condition,'Asset record created',jsonb_build_object('branch',new.branch,'serial_number',new.serial_number,'machine_barcode',new.machine_barcode));
  return new;
end; $$;
drop trigger if exists log_machine_creation_trigger on public.machines;
create trigger log_machine_creation_trigger after insert on public.machines for each row execute function public.log_machine_creation();

notify pgrst,'reload schema';
