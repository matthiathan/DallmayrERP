-- DallmayrERP inventory traceability, replenishment and purchase approvals.

alter table public.stock_items
  add column if not exists tracking_mode text not null default 'none',
  add column if not exists shelf_life_days integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='stock_items_tracking_mode_check') then
    alter table public.stock_items add constraint stock_items_tracking_mode_check check (tracking_mode in ('none','lot','serial','lot_serial'));
  end if;
  if not exists (select 1 from pg_constraint where conname='stock_items_shelf_life_days_check') then
    alter table public.stock_items add constraint stock_items_shelf_life_days_check check (shelf_life_days is null or shelf_life_days > 0);
  end if;
end $$;

create table if not exists public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  lot_number text not null,
  manufacture_date date,
  expiry_date date,
  quantity_items integer not null default 0 check (quantity_items >= 0),
  quantity_boxes integer not null default 0 check (quantity_boxes >= 0),
  location_id uuid references public.stock_locations(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  status text not null default 'active' check (status in ('active','quarantined','expired','depleted','recalled')),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stock_item_id,lot_number)
);

create table if not exists public.stock_serials (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  serial_number text not null,
  lot_id uuid references public.stock_lots(id) on delete set null,
  location_id uuid references public.stock_locations(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  work_item_id uuid references public.work_items(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  machine_id uuid references public.machines(id) on delete set null,
  status text not null default 'in_stock' check (status in ('in_stock','reserved','issued','returned','damaged','retired')),
  received_at timestamptz not null default now(),
  issued_at timestamptz,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stock_item_id,serial_number)
);

create index if not exists stock_lots_expiry_idx on public.stock_lots(expiry_date) where status='active';
create index if not exists stock_serials_status_idx on public.stock_serials(stock_item_id,status);

alter table public.stock_lots enable row level security;
alter table public.stock_serials enable row level security;

drop policy if exists stock_lots_read on public.stock_lots;
create policy stock_lots_read on public.stock_lots for select to authenticated using (public.current_app_role() is not null);
drop policy if exists stock_lots_write on public.stock_lots;
create policy stock_lots_write on public.stock_lots for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));

drop policy if exists stock_serials_read on public.stock_serials;
create policy stock_serials_read on public.stock_serials for select to authenticated using (public.current_app_role() is not null);
drop policy if exists stock_serials_write on public.stock_serials;
create policy stock_serials_write on public.stock_serials for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','technician','road_technician')) with check (public.current_app_role() in ('admin','operations','warehouse_staff','technician','road_technician'));

create or replace function public.receive_stock_lot(
  p_stock_item_id uuid,
  p_lot_number text,
  p_quantity integer,
  p_quantity_unit text default 'item',
  p_location_id uuid default null,
  p_manufacture_date date default null,
  p_expiry_date date default null,
  p_purchase_order_id uuid default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_mode text; v_shelf integer; v_expiry date; v_id uuid; v_branch text:='national';
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  if nullif(trim(coalesce(p_lot_number,'')),'') is null then raise exception 'Lot number is required'; end if;
  select tracking_mode,shelf_life_days into v_mode,v_shelf from public.stock_items where id=p_stock_item_id;
  if not found then raise exception 'Stock item not found'; end if;
  if v_mode not in ('lot','lot_serial') then raise exception 'This stock item is not configured for lot tracking'; end if;
  if p_location_id is not null then select w.branch into v_branch from public.stock_locations l join public.warehouses w on w.id=l.warehouse_id where l.id=p_location_id; end if;
  v_branch:=coalesce(v_branch,'national');
  v_expiry:=coalesce(p_expiry_date,case when v_shelf is not null then coalesce(p_manufacture_date,current_date)+v_shelf else null end);
  perform public.apply_stock_transaction(p_stock_item_id,'received',p_quantity,p_quantity_unit,v_branch,null,p_location_id,'lot_transaction',null,p_notes,null);
  insert into public.stock_lots(stock_item_id,lot_number,manufacture_date,expiry_date,quantity_items,quantity_boxes,location_id,purchase_order_id,status,notes,created_by)
  values(p_stock_item_id,trim(p_lot_number),p_manufacture_date,v_expiry,case when p_quantity_unit='item' then p_quantity else 0 end,case when p_quantity_unit='box' then p_quantity else 0 end,p_location_id,p_purchase_order_id,case when v_expiry is not null and v_expiry<current_date then 'expired' else 'active' end,nullif(trim(coalesce(p_notes,'')),''),v_actor)
  on conflict(stock_item_id,lot_number) do update set quantity_items=public.stock_lots.quantity_items+excluded.quantity_items,quantity_boxes=public.stock_lots.quantity_boxes+excluded.quantity_boxes,manufacture_date=coalesce(excluded.manufacture_date,public.stock_lots.manufacture_date),expiry_date=coalesce(excluded.expiry_date,public.stock_lots.expiry_date),location_id=coalesce(excluded.location_id,public.stock_lots.location_id),purchase_order_id=coalesce(excluded.purchase_order_id,public.stock_lots.purchase_order_id),status=excluded.status,notes=coalesce(excluded.notes,public.stock_lots.notes),updated_at=now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.receive_stock_serial(
  p_stock_item_id uuid,
  p_serial_number text,
  p_lot_id uuid default null,
  p_location_id uuid default null,
  p_purchase_order_id uuid default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_mode text; v_id uuid; v_branch text:='national';
  v_lot_stock_item_id uuid; v_lot_quantity integer; v_serial_count integer;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  if nullif(trim(coalesce(p_serial_number,'')),'') is null then raise exception 'Serial number is required'; end if;
  select tracking_mode into v_mode from public.stock_items where id=p_stock_item_id;
  if not found then raise exception 'Stock item not found'; end if;
  if v_mode not in ('serial','lot_serial') then raise exception 'This stock item is not configured for serial tracking'; end if;
  if v_mode='lot_serial' and p_lot_id is null then raise exception 'A lot is required for combined lot and serial tracking'; end if;
  if p_location_id is not null then select w.branch into v_branch from public.stock_locations l join public.warehouses w on w.id=l.warehouse_id where l.id=p_location_id; end if;
  v_branch:=coalesce(v_branch,'national');
  if p_lot_id is not null then
    select stock_item_id,quantity_items into v_lot_stock_item_id,v_lot_quantity from public.stock_lots where id=p_lot_id and status='active' for update;
    if not found then raise exception 'Active lot not found'; end if;
    if v_lot_stock_item_id<>p_stock_item_id then raise exception 'Selected lot belongs to a different stock item'; end if;
    select count(*) into v_serial_count from public.stock_serials where lot_id=p_lot_id and status in ('in_stock','reserved','issued');
    if v_serial_count>=v_lot_quantity then raise exception 'All item quantity in this lot is already represented by serial records'; end if;
  else
    perform public.apply_stock_transaction(p_stock_item_id,'received',1,'item',v_branch,null,p_location_id,'serial_transaction',null,p_notes,null);
  end if;
  insert into public.stock_serials(stock_item_id,serial_number,lot_id,location_id,purchase_order_id,status,notes,created_by)
  values(p_stock_item_id,trim(p_serial_number),p_lot_id,p_location_id,p_purchase_order_id,'in_stock',nullif(trim(coalesce(p_notes,'')),''),v_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.issue_stock_lot(
  p_lot_id uuid,
  p_work_item_id uuid,
  p_quantity integer,
  p_quantity_unit text default 'item',
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_stock_item_id uuid; v_location_id uuid; v_items integer; v_boxes integer; v_mode text; v_part_id uuid;
begin
  select l.stock_item_id,l.location_id,l.quantity_items,l.quantity_boxes,s.tracking_mode
  into v_stock_item_id,v_location_id,v_items,v_boxes,v_mode
  from public.stock_lots l join public.stock_items s on s.id=l.stock_item_id where l.id=p_lot_id for update of l;
  if not found then raise exception 'Lot not found'; end if;
  if v_mode='lot_serial' then raise exception 'Issue serialized units individually for combined lot and serial tracking'; end if;
  if p_quantity_unit='item' and v_items<p_quantity then raise exception 'Insufficient quantity in lot'; end if;
  if p_quantity_unit='box' and v_boxes<p_quantity then raise exception 'Insufficient quantity in lot'; end if;
  v_part_id:=public.consume_work_part(p_work_item_id,v_stock_item_id,p_quantity,p_quantity_unit,v_location_id,p_notes,null);
  update public.stock_lots set
    quantity_items=case when p_quantity_unit='item' then quantity_items-p_quantity else quantity_items end,
    quantity_boxes=case when p_quantity_unit='box' then quantity_boxes-p_quantity else quantity_boxes end,
    status=case when (case when p_quantity_unit='item' then quantity_items-p_quantity else quantity_items end)=0 and (case when p_quantity_unit='box' then quantity_boxes-p_quantity else quantity_boxes end)=0 then 'depleted' else status end,
    updated_at=now()
  where id=p_lot_id;
  return v_part_id;
end $$;

create or replace function public.issue_stock_serial(
  p_serial_id uuid,
  p_work_item_id uuid,
  p_customer_id uuid default null,
  p_machine_id uuid default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_stock_item_id uuid; v_location_id uuid; v_status text; v_lot_id uuid; v_part_id uuid;
begin
  select stock_item_id,location_id,status,lot_id into v_stock_item_id,v_location_id,v_status,v_lot_id from public.stock_serials where id=p_serial_id for update;
  if not found then raise exception 'Serial record not found'; end if;
  if v_status<>'in_stock' then raise exception 'Serial is not available'; end if;
  v_part_id:=public.consume_work_part(p_work_item_id,v_stock_item_id,1,'item',v_location_id,p_notes,null);
  if v_lot_id is not null then
    update public.stock_lots set quantity_items=quantity_items-1,status=case when quantity_items-1=0 and quantity_boxes=0 then 'depleted' else status end,updated_at=now() where id=v_lot_id and quantity_items>0;
    if not found then raise exception 'Linked lot does not have available item quantity'; end if;
  end if;
  update public.stock_serials set status='issued',work_item_id=p_work_item_id,customer_id=p_customer_id,machine_id=p_machine_id,issued_at=now(),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now() where id=p_serial_id;
  return v_part_id;
end $$;

grant execute on function public.receive_stock_lot(uuid,text,integer,text,uuid,date,date,uuid,text) to authenticated;
grant execute on function public.receive_stock_serial(uuid,text,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.issue_stock_lot(uuid,uuid,integer,text,text) to authenticated;
grant execute on function public.issue_stock_serial(uuid,uuid,uuid,uuid,text) to authenticated;

alter table public.purchase_orders
  add column if not exists approval_required boolean not null default false,
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references public.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists estimated_total numeric(14,2);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='purchase_orders_approval_status_check') then
    alter table public.purchase_orders add constraint purchase_orders_approval_status_check check (approval_status in ('not_required','draft','pending','approved','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname='purchase_orders_estimated_total_check') then
    alter table public.purchase_orders add constraint purchase_orders_estimated_total_check check (estimated_total is null or estimated_total >= 0);
  end if;
end $$;

create or replace function public.submit_purchase_order_for_approval(p_purchase_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_total numeric;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  select coalesce(sum(quantity_ordered*coalesce(unit_cost,0)),0) into v_total from public.purchase_order_lines where purchase_order_id=p_purchase_order_id;
  update public.purchase_orders set approval_required=true,approval_status='pending',submitted_at=now(),estimated_total=v_total,updated_at=now() where id=p_purchase_order_id and status='draft';
  if not found then raise exception 'Only draft purchase orders can be submitted'; end if;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,after_payload)
  values(v_actor,v_role,'purchase_order',p_purchase_order_id,'purchase_order_submitted','Purchase order submitted for approval',jsonb_build_object('estimated_total',v_total));
end $$;

create or replace function public.review_purchase_order(p_purchase_order_id uuid,p_approve boolean,p_notes text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id();
begin
  if v_role not in ('admin','operations','finance','executive') then raise exception 'Not authorised to review purchase orders'; end if;
  update public.purchase_orders set approval_status=case when p_approve then 'approved' else 'rejected' end,approved_by=v_actor,approved_at=now(),notes=case when nullif(trim(coalesce(p_notes,'')),'') is null then notes else concat_ws(' • ',notes,trim(p_notes)) end,updated_at=now()
  where id=p_purchase_order_id and approval_status='pending';
  if not found then raise exception 'Purchase order is not awaiting approval'; end if;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,after_payload)
  values(v_actor,v_role,'purchase_order',p_purchase_order_id,case when p_approve then 'purchase_order_approved' else 'purchase_order_rejected' end,case when p_approve then 'Purchase order approved' else 'Purchase order rejected' end,jsonb_build_object('notes',p_notes));
end $$;

create or replace function public.transition_purchase_order(p_purchase_order_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_old_status text; v_approval_required boolean; v_approval_status text;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  select status,approval_required,approval_status into v_old_status,v_approval_required,v_approval_status from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if p_new_status='ordered' and v_approval_required and v_approval_status<>'approved' then raise exception 'Purchase order approval is required before ordering'; end if;
  if not ((v_old_status='draft' and p_new_status in ('ordered','cancelled')) or (v_old_status='ordered' and p_new_status in ('part_received','received','cancelled')) or (v_old_status='part_received' and p_new_status in ('received','cancelled')) or v_old_status=p_new_status) then raise exception 'Invalid purchase order transition from % to %',v_old_status,p_new_status; end if;
  update public.purchase_orders set status=p_new_status,ordered_at=case when p_new_status='ordered' and ordered_at is null then now() else ordered_at end,received_at=case when p_new_status='received' and received_at is null then now() else received_at end,updated_at=now() where id=p_purchase_order_id;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,before_payload,after_payload)
  values(public.current_app_user_id(),v_role,'purchase_order',p_purchase_order_id,'purchase_order_status_changed','Purchase order status changed',jsonb_build_object('status',v_old_status),jsonb_build_object('status',p_new_status));
end $$;

grant execute on function public.submit_purchase_order_for_approval(uuid) to authenticated;
grant execute on function public.review_purchase_order(uuid,boolean,text) to authenticated;

create or replace view public.stock_replenishment_suggestions with (security_invoker=true) as
select
  s.id as stock_item_id,s.stock_name,s.sku,s.item_barcode,s.supplier_name,s.default_supplier_id,s.default_warehouse_id,s.default_location_id,
  s.reorder_level,s.preferred_reorder_quantity,
  s.item_quantity+s.box_quantity*coalesce(s.items_per_box,1) as available_units,
  greatest(s.preferred_reorder_quantity,greatest(s.reorder_level*2-(s.item_quantity+s.box_quantity*coalesce(s.items_per_box,1)),1)) as suggested_quantity,
  s.unit_cost,
  greatest(s.preferred_reorder_quantity,greatest(s.reorder_level*2-(s.item_quantity+s.box_quantity*coalesce(s.items_per_box,1)),1))*coalesce(s.unit_cost,0) as estimated_cost
from public.stock_items s
where s.is_active and s.track_stock and s.item_quantity+s.box_quantity*coalesce(s.items_per_box,1)<=s.reorder_level;

grant select on public.stock_replenishment_suggestions to authenticated;

create or replace function public.create_replenishment_purchase_order(p_stock_item_id uuid,p_branch text default 'national')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_item record; v_po_id uuid; v_po_number text; v_quantity integer;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  if p_branch not in ('jhb','cpt','kzn','national') then raise exception 'Invalid branch'; end if;
  select s.*,s.item_quantity+s.box_quantity*coalesce(s.items_per_box,1) as available_units into v_item from public.stock_items s where s.id=p_stock_item_id and s.is_active and s.track_stock;
  if not found then raise exception 'Stock item not found'; end if;
  v_quantity:=greatest(v_item.preferred_reorder_quantity,greatest(v_item.reorder_level*2-v_item.available_units,1));
  v_po_id:=gen_random_uuid();
  v_po_number:=concat('PO-',upper(p_branch),'-',to_char(clock_timestamp(),'YYYYMMDDHH24MISS'),'-',upper(substr(v_po_id::text,1,4)));
  insert into public.purchase_orders(id,po_number,supplier_id,supplier_name,branch,warehouse_id,status,approval_required,approval_status,estimated_total,notes,created_by)
  values(v_po_id,v_po_number,v_item.default_supplier_id,coalesce(nullif(trim(v_item.supplier_name),''),'Supplier not assigned'),p_branch,v_item.default_warehouse_id,'draft',true,'draft',v_quantity*coalesce(v_item.unit_cost,0),'Generated from replenishment suggestion',v_actor);
  insert into public.purchase_order_lines(purchase_order_id,stock_item_id,quantity_ordered,quantity_unit,unit_cost,notes)
  values(v_po_id,p_stock_item_id,v_quantity,'item',v_item.unit_cost,'Replenishment proposal');
  insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,after_payload)
  values(v_actor,v_role,p_branch,'purchase_order',v_po_id,'replenishment_purchase_order_created',concat(v_po_number,' created from low-stock suggestion'),jsonb_build_object('stock_item_id',p_stock_item_id,'quantity',v_quantity));
  return v_po_id;
end $$;

grant execute on function public.create_replenishment_purchase_order(uuid,text) to authenticated;

notify pgrst,'reload schema';
