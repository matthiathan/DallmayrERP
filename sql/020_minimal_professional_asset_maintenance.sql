-- DallmayrERP professional asset lifecycle and preventive maintenance.
-- Idempotent migration for hierarchy, commercial lifecycle, meters, downtime and PM generation.

alter table public.machines
  add column if not exists parent_machine_id uuid,
  add column if not exists manufacturer text,
  add column if not exists purchase_date date,
  add column if not exists purchase_cost numeric(14,2),
  add column if not exists replacement_cost numeric(14,2),
  add column if not exists expected_life_months integer,
  add column if not exists replacement_due_at date,
  add column if not exists meter_value numeric(14,2) not null default 0,
  add column if not exists meter_unit text not null default 'hours',
  add column if not exists last_meter_at timestamptz,
  add column if not exists downtime_minutes_total integer not null default 0,
  add column if not exists last_service_at timestamptz,
  add column if not exists next_service_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='machines_parent_machine_id_fkey') then
    alter table public.machines add constraint machines_parent_machine_id_fkey foreign key(parent_machine_id) references public.machines(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='machines_purchase_cost_check') then
    alter table public.machines add constraint machines_purchase_cost_check check (purchase_cost is null or purchase_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='machines_replacement_cost_check') then
    alter table public.machines add constraint machines_replacement_cost_check check (replacement_cost is null or replacement_cost >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='machines_expected_life_months_check') then
    alter table public.machines add constraint machines_expected_life_months_check check (expected_life_months is null or expected_life_months > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='machines_meter_value_check') then
    alter table public.machines add constraint machines_meter_value_check check (meter_value >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='machines_meter_unit_check') then
    alter table public.machines add constraint machines_meter_unit_check check (meter_unit in ('hours','cycles','kilometres','units'));
  end if;
  if not exists (select 1 from pg_constraint where conname='machines_downtime_minutes_total_check') then
    alter table public.machines add constraint machines_downtime_minutes_total_check check (downtime_minutes_total >= 0);
  end if;
end $$;

create index if not exists machines_parent_machine_idx on public.machines(parent_machine_id);
create index if not exists machines_next_service_idx on public.machines(next_service_at) where next_service_at is not null;
create index if not exists machines_replacement_due_idx on public.machines(replacement_due_at) where replacement_due_at is not null;

create table if not exists public.asset_meter_readings (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  reading numeric(14,2) not null check (reading >= 0),
  unit text not null check (unit in ('hours','cycles','kilometres','units')),
  source text not null default 'manual' check (source in ('manual','service','inspection','sensor')),
  notes text,
  recorded_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create table if not exists public.asset_downtime_events (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  service_job_id uuid references public.service_jobs(id) on delete set null,
  work_item_id uuid references public.work_items(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  downtime_minutes integer not null check (downtime_minutes >= 0),
  reason text,
  notes text,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at)
);

create table if not exists public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  plan_number text not null unique,
  machine_id uuid not null references public.machines(id) on delete cascade,
  title text not null,
  description text,
  trigger_type text not null default 'calendar' check (trigger_type in ('calendar','meter','hybrid')),
  interval_days integer check (interval_days is null or interval_days > 0),
  interval_meter numeric(14,2) check (interval_meter is null or interval_meter > 0),
  next_due_at timestamptz,
  next_due_meter numeric(14,2),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  assigned_to uuid references public.users(id) on delete set null,
  checklist_template jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist_template)='array'),
  is_active boolean not null default true,
  last_generated_at timestamptz,
  last_generated_work_item_id uuid references public.work_items(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((trigger_type='calendar' and interval_days is not null)
      or (trigger_type='meter' and interval_meter is not null)
      or (trigger_type='hybrid' and interval_days is not null and interval_meter is not null))
);

create index if not exists asset_meter_readings_machine_idx on public.asset_meter_readings(machine_id, recorded_at desc);
create index if not exists asset_downtime_machine_idx on public.asset_downtime_events(machine_id, started_at desc);
create index if not exists maintenance_plans_machine_idx on public.maintenance_plans(machine_id);
create index if not exists maintenance_plans_due_idx on public.maintenance_plans(next_due_at) where is_active;

alter table public.work_items add column if not exists maintenance_plan_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='work_items_maintenance_plan_id_fkey') then
    alter table public.work_items add constraint work_items_maintenance_plan_id_fkey foreign key(maintenance_plan_id) references public.maintenance_plans(id) on delete set null;
  end if;
end $$;
create index if not exists work_items_maintenance_plan_idx on public.work_items(maintenance_plan_id);

alter table public.asset_meter_readings enable row level security;
alter table public.asset_downtime_events enable row level security;
alter table public.maintenance_plans enable row level security;

drop policy if exists asset_meter_readings_read on public.asset_meter_readings;
create policy asset_meter_readings_read on public.asset_meter_readings for select to authenticated using (public.current_app_role() is not null);
drop policy if exists asset_meter_readings_write on public.asset_meter_readings;
create policy asset_meter_readings_write on public.asset_meter_readings for all to authenticated using (public.current_app_role() in ('admin','operations','technician','road_technician')) with check (public.current_app_role() in ('admin','operations','technician','road_technician'));

drop policy if exists asset_downtime_read on public.asset_downtime_events;
create policy asset_downtime_read on public.asset_downtime_events for select to authenticated using (public.current_app_role() is not null);
drop policy if exists asset_downtime_write on public.asset_downtime_events;
create policy asset_downtime_write on public.asset_downtime_events for all to authenticated using (public.current_app_role() in ('admin','operations','technician','road_technician')) with check (public.current_app_role() in ('admin','operations','technician','road_technician'));

drop policy if exists maintenance_plans_read on public.maintenance_plans;
create policy maintenance_plans_read on public.maintenance_plans for select to authenticated using (public.current_app_role() is not null);
drop policy if exists maintenance_plans_write on public.maintenance_plans;
create policy maintenance_plans_write on public.maintenance_plans for all to authenticated using (public.current_app_role() in ('admin','operations')) with check (public.current_app_role() in ('admin','operations'));

create or replace function public.update_asset_professional_profile(
  p_machine_id uuid,
  p_parent_machine_id uuid default null,
  p_manufacturer text default null,
  p_purchase_date date default null,
  p_purchase_cost numeric default null,
  p_replacement_cost numeric default null,
  p_expected_life_months integer default null,
  p_replacement_due_at date default null,
  p_meter_unit text default 'hours'
) returns void
language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id();
begin
  if v_role not in ('admin','operations') then raise exception 'Not authorised'; end if;
  if p_parent_machine_id=p_machine_id then raise exception 'An asset cannot be its own parent'; end if;
  if p_meter_unit not in ('hours','cycles','kilometres','units') then raise exception 'Invalid meter unit'; end if;
  update public.machines set
    parent_machine_id=p_parent_machine_id,
    manufacturer=nullif(trim(coalesce(p_manufacturer,'')),''),
    purchase_date=p_purchase_date,
    purchase_cost=p_purchase_cost,
    replacement_cost=p_replacement_cost,
    expected_life_months=p_expected_life_months,
    replacement_due_at=p_replacement_due_at,
    meter_unit=p_meter_unit,
    updated_at=now()
  where id=p_machine_id;
  if not found then raise exception 'Asset not found'; end if;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,after_payload)
  values(v_actor,v_role,'machine',p_machine_id,'asset_professional_profile_updated','Asset commercial and hierarchy profile updated',jsonb_build_object('parent_machine_id',p_parent_machine_id,'manufacturer',p_manufacturer,'purchase_date',p_purchase_date,'purchase_cost',p_purchase_cost,'replacement_cost',p_replacement_cost,'expected_life_months',p_expected_life_months,'replacement_due_at',p_replacement_due_at,'meter_unit',p_meter_unit));
end $$;

create or replace function public.generate_due_maintenance_work(p_plan_id uuid default null)
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_role text:=public.current_app_role();
  v_plan record;
  v_work_id uuid;
  v_count integer:=0;
  v_item jsonb;
begin
  if v_role not in ('admin','operations') then raise exception 'Not authorised to generate maintenance work'; end if;
  for v_plan in
    select mp.*,m.branch,m.customer_id,m.site_id,m.machine_name,m.serial_number,m.machine_barcode,m.meter_value
    from public.maintenance_plans mp join public.machines m on m.id=mp.machine_id
    where mp.is_active
      and (p_plan_id is null or mp.id=p_plan_id)
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
  if v_role in ('admin','operations') then v_generated:=public.generate_due_maintenance_work(null); end if;
  return v_generated;
end $$;

create or replace function public.record_asset_downtime(
  p_machine_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text default null,
  p_notes text default null,
  p_work_item_id uuid default null,
  p_service_job_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_minutes integer; v_id uuid;
begin
  if v_role not in ('admin','operations','technician','road_technician') then raise exception 'Not authorised'; end if;
  if p_ended_at<p_started_at then raise exception 'End time must be after start time'; end if;
  v_minutes:=greatest(0,floor(extract(epoch from (p_ended_at-p_started_at))/60)::integer);
  insert into public.asset_downtime_events(machine_id,service_job_id,work_item_id,started_at,ended_at,downtime_minutes,reason,notes,recorded_by)
  values(p_machine_id,p_service_job_id,p_work_item_id,p_started_at,p_ended_at,v_minutes,nullif(trim(coalesce(p_reason,'')),''),nullif(trim(coalesce(p_notes,'')),''),v_actor) returning id into v_id;
  update public.machines set downtime_minutes_total=downtime_minutes_total+v_minutes,updated_at=now() where id=p_machine_id;
  return v_id;
end $$;

grant execute on function public.update_asset_professional_profile(uuid,uuid,text,date,numeric,numeric,integer,date,text) to authenticated;
grant execute on function public.generate_due_maintenance_work(uuid) to authenticated;
grant execute on function public.record_asset_meter_reading(uuid,numeric,text,text,text) to authenticated;
grant execute on function public.record_asset_downtime(uuid,timestamptz,timestamptz,text,text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
