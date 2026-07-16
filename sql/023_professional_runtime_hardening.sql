-- Runtime hardening for professional maintenance generation.
-- Allows any authorised meter recorder to generate due work only for the machine being read.

create or replace function public.generate_due_maintenance_for_machine(p_machine_id uuid)
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_plan record;
  v_work_id uuid;
  v_count integer:=0;
  v_item jsonb;
begin
  for v_plan in
    select mp.*,m.branch,m.customer_id,m.site_id,m.machine_name,m.serial_number,m.machine_barcode,m.meter_value
    from public.maintenance_plans mp join public.machines m on m.id=mp.machine_id
    where mp.is_active
      and mp.machine_id=p_machine_id
      and ((mp.trigger_type in ('calendar','hybrid') and mp.next_due_at is not null and mp.next_due_at<=now())
        or (mp.trigger_type in ('meter','hybrid') and mp.next_due_meter is not null and m.meter_value>=mp.next_due_meter))
      and not exists (select 1 from public.work_items w where w.maintenance_plan_id=mp.id and w.status not in ('completed','cancelled'))
    for update of mp
  loop
    v_work_id:=public.create_work_item(
      v_plan.title,
      coalesce(v_plan.description,concat('Preventive maintenance for ',coalesce(v_plan.machine_name,v_plan.serial_number,v_plan.machine_barcode,v_plan.machine_id::text))),
      'maintenance','operations',v_plan.branch,v_plan.priority,v_plan.assigned_to,v_plan.customer_id,v_plan.site_id,v_plan.machine_id,null,
      coalesce(v_plan.next_due_at,now()),null,false
    );
    update public.work_items set maintenance_plan_id=v_plan.id,estimated_minutes=v_plan.estimated_minutes where id=v_work_id;
    for v_item in select value from jsonb_array_elements(v_plan.checklist_template)
    loop
      insert into public.work_item_checklist(work_item_id,label,sort_order,is_required)
      values(v_work_id,coalesce(nullif(trim(v_item->>'label'),''),'Maintenance step'),coalesce((v_item->>'sort_order')::integer,0),coalesce((v_item->>'required')::boolean,true));
    end loop;
    update public.maintenance_plans set
      last_generated_at=now(),
      last_generated_work_item_id=v_work_id,
      next_due_at=case when interval_days is not null then greatest(coalesce(next_due_at,now()),now())+make_interval(days=>interval_days) else next_due_at end,
      next_due_meter=case when interval_meter is not null then greatest(coalesce(next_due_meter,v_plan.meter_value),v_plan.meter_value)+interval_meter else next_due_meter end,
      updated_at=now()
    where id=v_plan.id;
    update public.machines set next_service_at=(select min(next_due_at) from public.maintenance_plans where machine_id=v_plan.machine_id and is_active and next_due_at is not null),updated_at=now() where id=v_plan.machine_id;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

revoke all on function public.generate_due_maintenance_for_machine(uuid) from public,anon,authenticated;

create or replace function public.record_asset_meter_reading(
  p_machine_id uuid,
  p_reading numeric,
  p_unit text,
  p_source text default 'manual',
  p_notes text default null
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_current numeric; v_generated integer:=0;
begin
  if v_role not in ('admin','operations','technician','road_technician') then raise exception 'Not authorised'; end if;
  if p_unit not in ('hours','cycles','kilometres','units') then raise exception 'Invalid meter unit'; end if;
  if p_source not in ('manual','service','inspection','sensor') then raise exception 'Invalid meter source'; end if;
  select meter_value into v_current from public.machines where id=p_machine_id for update;
  if not found then raise exception 'Asset not found'; end if;
  if p_reading<v_current then raise exception 'Meter reading cannot move backwards from %',v_current; end if;
  insert into public.asset_meter_readings(machine_id,reading,unit,source,notes,recorded_by) values(p_machine_id,p_reading,p_unit,p_source,nullif(trim(coalesce(p_notes,'')),''),v_actor);
  update public.machines set meter_value=p_reading,meter_unit=p_unit,last_meter_at=now(),updated_at=now() where id=p_machine_id;
  v_generated:=public.generate_due_maintenance_for_machine(p_machine_id);
  return v_generated;
end $$;

notify pgrst,'reload schema';
