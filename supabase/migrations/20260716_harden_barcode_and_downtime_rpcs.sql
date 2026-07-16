-- DallmayrERP hardening: safe stock barcode resolution and transactional asset downtime.

create or replace function public.resolve_stock_barcode(p_barcode text)
returns table(
  id uuid,
  stock_name text,
  item_barcode text,
  box_barcode text,
  matched_unit text,
  item_quantity integer,
  box_quantity integer,
  items_per_box integer,
  reorder_level integer,
  warehouse_location text,
  default_location_id uuid,
  unit_cost numeric
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if public.current_app_role() is null then
    raise exception 'Not authorised';
  end if;

  if nullif(trim(coalesce(p_barcode,'')),'') is null then
    return;
  end if;

  return query
  select
    si.id,
    si.stock_name,
    si.item_barcode,
    si.box_barcode,
    case when si.box_barcode = trim(p_barcode) then 'box' else 'item' end as matched_unit,
    si.item_quantity,
    si.box_quantity,
    si.items_per_box,
    si.reorder_level,
    si.warehouse_location,
    si.default_location_id,
    si.unit_cost
  from public.stock_items si
  where si.is_active
    and (si.item_barcode = trim(p_barcode) or si.box_barcode = trim(p_barcode))
  order by case when si.item_barcode = trim(p_barcode) then 0 else 1 end, si.stock_name
  limit 1;
end;
$$;

drop function if exists public.record_asset_downtime(uuid,timestamp with time zone,timestamp with time zone,text,text,uuid,uuid);

create function public.record_asset_downtime(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text default null,
  p_notes text default null,
  p_service_job_id uuid default null,
  p_work_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text:=public.current_app_role();
  v_actor uuid:=public.current_app_user_id();
  v_minutes integer;
  v_event_id uuid;
  v_branch text;
begin
  if v_role not in ('admin','operations','technician','road_technician') then
    raise exception 'Not authorised to record downtime';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'Downtime start and end are required';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'Downtime end must be after the start';
  end if;

  select branch into v_branch from public.machines where id=p_machine_id;
  if not found then
    raise exception 'Asset not found';
  end if;

  v_minutes:=greatest(1,round(extract(epoch from (p_ended_at-p_started_at))/60)::integer);

  insert into public.asset_downtime_events(
    machine_id,service_job_id,work_item_id,started_at,ended_at,downtime_minutes,reason,notes,recorded_by
  ) values (
    p_machine_id,p_service_job_id,p_work_item_id,p_started_at,p_ended_at,v_minutes,
    nullif(trim(coalesce(p_reason,'')),''),nullif(trim(coalesce(p_notes,'')),''),v_actor
  ) returning id into v_event_id;

  insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,after_payload)
  values(
    v_actor,
    v_role,
    v_branch,
    'machine',
    p_machine_id,
    'asset_downtime_recorded',
    concat('Asset downtime recorded for ',v_minutes,' minute(s)'),
    jsonb_build_object('downtime_event_id',v_event_id,'started_at',p_started_at,'ended_at',p_ended_at,'minutes',v_minutes,'reason',nullif(trim(coalesce(p_reason,'')),''))
  );

  update public.machines
  set condition=case when v_minutes>=480 and condition not in ('critical') then 'poor' else condition end,
      updated_at=now()
  where id=p_machine_id;

  return v_event_id;
end;
$$;

grant execute on function public.resolve_stock_barcode(text) to authenticated;
grant execute on function public.record_asset_downtime(uuid,timestamptz,timestamptz,text,text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
