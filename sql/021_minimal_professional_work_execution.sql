-- DallmayrERP professional work execution.
-- Reusable SOPs, time, parts, structured completion and evidence.

alter table public.work_items
  add column if not exists estimated_minutes integer,
  add column if not exists completion_code text,
  add column if not exists root_cause text,
  add column if not exists resolution_notes text,
  add column if not exists first_time_fix boolean;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='work_items_estimated_minutes_check') then
    alter table public.work_items add constraint work_items_estimated_minutes_check check (estimated_minutes is null or estimated_minutes > 0);
  end if;
end $$;

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  template_name text not null unique,
  description text,
  work_type text check (work_type is null or work_type in ('request','task','approval','inspection','maintenance','incident')),
  department text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.work_time_entries (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  entry_type text not null check (entry_type in ('labour','travel','downtime')),
  minutes integer not null check (minutes > 0),
  hourly_rate numeric(12,2) check (hourly_rate is null or hourly_rate >= 0),
  notes text,
  user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.work_parts_used (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  quantity_unit text not null default 'item' check (quantity_unit in ('item','box')),
  source_location_id uuid references public.stock_locations(id) on delete set null,
  inventory_movement_id uuid references public.inventory_movements(id) on delete set null,
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  notes text,
  used_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.work_evidence (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('photo','signature','gps','meter','document','completion')),
  file_path text,
  file_name text,
  value_text text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (file_path is not null or value_text is not null or latitude is not null or longitude is not null)
);

create index if not exists checklist_template_items_template_idx on public.checklist_template_items(template_id,sort_order);
create index if not exists work_time_entries_work_idx on public.work_time_entries(work_item_id,created_at desc);
create index if not exists work_parts_used_work_idx on public.work_parts_used(work_item_id,created_at desc);
create index if not exists work_evidence_work_idx on public.work_evidence(work_item_id,created_at desc);

alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.work_time_entries enable row level security;
alter table public.work_parts_used enable row level security;
alter table public.work_evidence enable row level security;

drop policy if exists checklist_templates_read on public.checklist_templates;
create policy checklist_templates_read on public.checklist_templates for select to authenticated using (public.current_app_role() is not null);
drop policy if exists checklist_templates_write on public.checklist_templates;
create policy checklist_templates_write on public.checklist_templates for all to authenticated using (public.current_app_role() in ('admin','operations')) with check (public.current_app_role() in ('admin','operations'));

drop policy if exists checklist_template_items_read on public.checklist_template_items;
create policy checklist_template_items_read on public.checklist_template_items for select to authenticated using (public.current_app_role() is not null);
drop policy if exists checklist_template_items_write on public.checklist_template_items;
create policy checklist_template_items_write on public.checklist_template_items for all to authenticated using (public.current_app_role() in ('admin','operations')) with check (public.current_app_role() in ('admin','operations'));

drop policy if exists work_time_entries_read on public.work_time_entries;
create policy work_time_entries_read on public.work_time_entries for select to authenticated using (public.current_app_role() is not null);
drop policy if exists work_time_entries_write on public.work_time_entries;
create policy work_time_entries_write on public.work_time_entries for all to authenticated using (public.current_app_role() in ('admin','operations','technician','road_technician')) with check (public.current_app_role() in ('admin','operations','technician','road_technician'));

drop policy if exists work_parts_used_read on public.work_parts_used;
create policy work_parts_used_read on public.work_parts_used for select to authenticated using (public.current_app_role() is not null);
drop policy if exists work_parts_used_write on public.work_parts_used;
create policy work_parts_used_write on public.work_parts_used for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','technician','road_technician')) with check (public.current_app_role() in ('admin','operations','warehouse_staff','technician','road_technician'));

drop policy if exists work_evidence_read on public.work_evidence;
create policy work_evidence_read on public.work_evidence for select to authenticated using (public.current_app_role() is not null);
drop policy if exists work_evidence_write on public.work_evidence;
create policy work_evidence_write on public.work_evidence for all to authenticated using (public.current_app_role() in ('admin','operations','technician','road_technician')) with check (public.current_app_role() in ('admin','operations','technician','road_technician'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dallmayrerp-work-evidence','dallmayrerp-work-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists work_evidence_storage_read on storage.objects;
create policy work_evidence_storage_read on storage.objects for select to authenticated using (bucket_id='dallmayrerp-work-evidence' and public.current_app_role() is not null);
drop policy if exists work_evidence_storage_insert on storage.objects;
create policy work_evidence_storage_insert on storage.objects for insert to authenticated with check (bucket_id='dallmayrerp-work-evidence' and public.current_app_role() in ('admin','operations','technician','road_technician'));
drop policy if exists work_evidence_storage_delete on storage.objects;
create policy work_evidence_storage_delete on storage.objects for delete to authenticated using (bucket_id='dallmayrerp-work-evidence' and public.current_app_role() in ('admin','operations'));

create or replace function public.apply_checklist_template(p_work_item_id uuid,p_template_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_assigned uuid; v_requested uuid; v_count integer;
begin
  select assigned_to,requested_by into v_assigned,v_requested from public.work_items where id=p_work_item_id;
  if not found then raise exception 'Work item not found'; end if;
  if not (v_role in ('admin','operations') or v_actor=v_assigned or v_actor=v_requested) then raise exception 'Not authorised'; end if;
  insert into public.work_item_checklist(work_item_id,label,sort_order,is_required)
  select p_work_item_id,i.label,i.sort_order,i.is_required from public.checklist_template_items i where i.template_id=p_template_id order by i.sort_order;
  get diagnostics v_count=row_count;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,metadata)
  values(v_actor,v_role,'work_item',p_work_item_id,'checklist_template_applied',concat(v_count,' checklist step(s) applied'),jsonb_build_object('template_id',p_template_id));
  return v_count;
end $$;

create or replace function public.log_work_time(p_work_item_id uuid,p_entry_type text,p_minutes integer,p_hourly_rate numeric default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_assigned uuid; v_requested uuid; v_id uuid;
begin
  if p_entry_type not in ('labour','travel','downtime') then raise exception 'Invalid time type'; end if;
  if p_minutes<=0 then raise exception 'Minutes must be greater than zero'; end if;
  select assigned_to,requested_by into v_assigned,v_requested from public.work_items where id=p_work_item_id;
  if not found then raise exception 'Work item not found'; end if;
  if not (v_role in ('admin','operations') or v_actor=v_assigned or v_actor=v_requested) then raise exception 'Not authorised'; end if;
  insert into public.work_time_entries(work_item_id,entry_type,minutes,hourly_rate,notes,user_id)
  values(p_work_item_id,p_entry_type,p_minutes,p_hourly_rate,nullif(trim(coalesce(p_notes,'')),''),v_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public.consume_work_part(
  p_work_item_id uuid,
  p_stock_item_id uuid,
  p_quantity integer,
  p_quantity_unit text default 'item',
  p_source_location_id uuid default null,
  p_notes text default null,
  p_barcode text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_assigned uuid; v_branch text;
  v_item_qty integer; v_box_qty integer; v_new_item_qty integer; v_new_box_qty integer; v_location_id uuid;
  v_location_item integer; v_location_box integer; v_unit_cost numeric; v_movement_id uuid; v_part_id uuid;
begin
  if p_quantity<=0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_quantity_unit not in ('item','box') then raise exception 'Invalid quantity unit'; end if;
  select assigned_to,branch into v_assigned,v_branch from public.work_items where id=p_work_item_id for update;
  if not found then raise exception 'Work item not found'; end if;
  if not (v_role in ('admin','operations','warehouse_staff') or (v_role in ('technician','road_technician') and v_actor=v_assigned)) then raise exception 'Not authorised to consume parts'; end if;
  select item_quantity,box_quantity,unit_cost,coalesce(p_source_location_id,default_location_id)
  into v_item_qty,v_box_qty,v_unit_cost,v_location_id from public.stock_items where id=p_stock_item_id for update;
  if not found then raise exception 'Stock item not found'; end if;
  v_new_item_qty:=v_item_qty; v_new_box_qty:=v_box_qty;
  if p_quantity_unit='item' then v_new_item_qty:=v_item_qty-p_quantity; else v_new_box_qty:=v_box_qty-p_quantity; end if;
  if v_new_item_qty<0 or v_new_box_qty<0 then raise exception 'Insufficient on-hand stock'; end if;
  if v_location_id is not null then
    insert into public.stock_balances(stock_item_id,location_id) values(p_stock_item_id,v_location_id) on conflict(stock_item_id,location_id) do nothing;
    select item_quantity,box_quantity into v_location_item,v_location_box from public.stock_balances where stock_item_id=p_stock_item_id and location_id=v_location_id for update;
    if p_quantity_unit='item' then
      if v_location_item<p_quantity then raise exception 'Insufficient stock at selected location'; end if;
      update public.stock_balances set item_quantity=item_quantity-p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=v_location_id;
    else
      if v_location_box<p_quantity then raise exception 'Insufficient stock at selected location'; end if;
      update public.stock_balances set box_quantity=box_quantity-p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=v_location_id;
    end if;
  end if;
  update public.stock_items set item_quantity=v_new_item_qty,box_quantity=v_new_box_qty,updated_at=now() where id=p_stock_item_id;
  insert into public.inventory_movements(stock_item_id,branch,movement_type,quantity,quantity_unit,source_location_id,reference_type,reference_id,notes,created_by,balance_after_items,balance_after_boxes)
  values(p_stock_item_id,v_branch,'issued',-p_quantity,p_quantity_unit,v_location_id,'work_item',p_work_item_id,nullif(trim(coalesce(p_notes,'')),''),v_actor,v_new_item_qty,v_new_box_qty) returning id into v_movement_id;
  insert into public.work_parts_used(work_item_id,stock_item_id,quantity,quantity_unit,source_location_id,inventory_movement_id,unit_cost,notes,used_by)
  values(p_work_item_id,p_stock_item_id,p_quantity,p_quantity_unit,v_location_id,v_movement_id,v_unit_cost,nullif(trim(coalesce(p_notes,'')),''),v_actor) returning id into v_part_id;
  if nullif(trim(coalesce(p_barcode,'')),'') is not null then
    insert into public.stock_scan_events(barcode,scan_type,branch,quantity,stock_item_id,scanned_by,notes)
    values(trim(p_barcode),'stock_issue',v_branch,p_quantity,p_stock_item_id,v_actor,concat('Used on work item ',p_work_item_id));
  end if;
  insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,after_payload,metadata)
  values(v_actor,v_role,v_branch,'work_item',p_work_item_id,'work_part_consumed','Part consumed on work item',jsonb_build_object('stock_item_id',p_stock_item_id,'quantity',p_quantity,'unit',p_quantity_unit),jsonb_build_object('movement_id',v_movement_id,'part_usage_id',v_part_id));
  return v_part_id;
end $$;

create or replace function public.save_work_completion(
  p_work_item_id uuid,
  p_completion_code text default null,
  p_root_cause text default null,
  p_resolution_notes text default null,
  p_first_time_fix boolean default null,
  p_estimated_minutes integer default null
) returns void language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_assigned uuid; v_requested uuid;
begin
  select assigned_to,requested_by into v_assigned,v_requested from public.work_items where id=p_work_item_id for update;
  if not found then raise exception 'Work item not found'; end if;
  if not (v_role in ('admin','operations') or v_actor=v_assigned or v_actor=v_requested) then raise exception 'Not authorised'; end if;
  update public.work_items set completion_code=nullif(trim(coalesce(p_completion_code,'')),''),root_cause=nullif(trim(coalesce(p_root_cause,'')),''),resolution_notes=nullif(trim(coalesce(p_resolution_notes,'')),''),first_time_fix=p_first_time_fix,estimated_minutes=p_estimated_minutes,updated_at=now() where id=p_work_item_id;
end $$;

create or replace function public.transition_work_item(p_work_item_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.current_app_user_id(); v_role text:=public.current_app_role(); v_old text; v_assigned uuid; v_requested uuid;
  v_approval_required boolean; v_approval_status text; v_incomplete integer; v_work_type text; v_resolution text; v_machine_id uuid;
begin
  select status,assigned_to,requested_by,approval_required,approval_status,work_type,resolution_notes,machine_id
  into v_old,v_assigned,v_requested,v_approval_required,v_approval_status,v_work_type,v_resolution,v_machine_id
  from public.work_items where id=p_work_item_id for update;
  if not found then raise exception 'Work item not found'; end if;
  if not (v_role in ('admin','operations') or v_actor=v_assigned or v_actor=v_requested) then raise exception 'Not authorised'; end if;
  if p_new_status='assigned' and v_assigned is null then raise exception 'Assign an owner before moving work to assigned'; end if;
  if not ((v_old='new' and p_new_status in ('triaged','assigned','cancelled')) or
          (v_old='triaged' and p_new_status in ('assigned','in_progress','cancelled')) or
          (v_old='assigned' and p_new_status in ('in_progress','blocked','cancelled')) or
          (v_old='in_progress' and p_new_status in ('blocked','waiting_approval','completed','cancelled')) or
          (v_old='blocked' and p_new_status in ('assigned','in_progress','cancelled')) or
          (v_old='waiting_approval' and p_new_status in ('in_progress','completed','blocked')) or v_old=p_new_status) then raise exception 'Invalid transition from % to %',v_old,p_new_status; end if;
  if p_new_status in ('waiting_approval','completed') then
    select count(*) into v_incomplete from public.work_item_checklist where work_item_id=p_work_item_id and is_required and not is_completed;
    if v_incomplete>0 then raise exception '% required checklist item(s) are incomplete',v_incomplete; end if;
    if v_work_type in ('maintenance','incident') and nullif(trim(coalesce(v_resolution,'')),'') is null then raise exception 'Resolution notes are required before completion'; end if;
  end if;
  if p_new_status='completed' and v_approval_required and v_approval_status<>'approved' then raise exception 'Approval is required before completion'; end if;
  update public.work_items set status=p_new_status,completed_at=case when p_new_status='completed' then now() else completed_at end,updated_at=now() where id=p_work_item_id;
  if p_new_status='completed' and v_machine_id is not null then update public.machines set last_service_at=now(),updated_at=now() where id=v_machine_id; end if;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,before_payload,after_payload)
  values(v_actor,v_role,'work_item',p_work_item_id,'work_item_status_changed','Work item status changed',jsonb_build_object('status',v_old),jsonb_build_object('status',p_new_status));
end $$;

grant execute on function public.apply_checklist_template(uuid,uuid) to authenticated;
grant execute on function public.log_work_time(uuid,text,integer,numeric,text) to authenticated;
grant execute on function public.consume_work_part(uuid,uuid,integer,text,uuid,text,text) to authenticated;
grant execute on function public.save_work_completion(uuid,text,text,text,boolean,integer) to authenticated;

insert into public.checklist_templates(template_name,description,work_type,department,is_active)
values
  ('Preventive machine service','Standard preventive-service procedure for customer machines.','maintenance','operations',true),
  ('Machine installation and commissioning','Installation, safety and handover procedure.','task','operations',true),
  ('Incident diagnosis and resolution','Structured incident response and root-cause procedure.','incident','operations',true),
  ('Asset condition audit','Physical verification, condition and custody audit.','inspection','operations',true)
on conflict(template_name) do nothing;

insert into public.checklist_template_items(template_id,label,sort_order,is_required)
select t.id,v.label,v.sort_order,v.is_required
from public.checklist_templates t
join (values
  ('Preventive machine service','Verify machine QR and serial number',1,true),
  ('Preventive machine service','Inspect external condition and safety',2,true),
  ('Preventive machine service','Clean and test serviceable components',3,true),
  ('Preventive machine service','Record meter reading',4,true),
  ('Preventive machine service','Confirm operation with customer',5,true),
  ('Machine installation and commissioning','Verify customer and site',1,true),
  ('Machine installation and commissioning','Record machine serial and QR code',2,true),
  ('Machine installation and commissioning','Complete electrical and water safety checks',3,true),
  ('Machine installation and commissioning','Run commissioning test',4,true),
  ('Machine installation and commissioning','Capture customer sign-off',5,true),
  ('Incident diagnosis and resolution','Confirm reported symptom',1,true),
  ('Incident diagnosis and resolution','Record diagnostic findings',2,true),
  ('Incident diagnosis and resolution','Identify root cause',3,true),
  ('Incident diagnosis and resolution','Test the resolution',4,true),
  ('Incident diagnosis and resolution','Record completion evidence',5,true),
  ('Asset condition audit','Scan and identify asset',1,true),
  ('Asset condition audit','Confirm current custodian and location',2,true),
  ('Asset condition audit','Assess physical condition',3,true),
  ('Asset condition audit','Record meter and warranty details',4,false),
  ('Asset condition audit','Set next audit date',5,true)
) as v(template_name,label,sort_order,is_required) on v.template_name=t.template_name
where not exists (select 1 from public.checklist_template_items i where i.template_id=t.id);

notify pgrst,'reload schema';
