-- Prevent expired or unavailable traceability records from being received or issued incorrectly.

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
  v_lot_stock_item_id uuid; v_lot_quantity integer; v_lot_expiry date; v_serial_count integer;
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
    select stock_item_id,quantity_items,expiry_date into v_lot_stock_item_id,v_lot_quantity,v_lot_expiry from public.stock_lots where id=p_lot_id and status='active' for update;
    if not found then raise exception 'Active lot not found'; end if;
    if v_lot_expiry is not null and v_lot_expiry<current_date then
      update public.stock_lots set status='expired',updated_at=now() where id=p_lot_id;
      raise exception 'The selected lot has expired';
    end if;
    if v_lot_stock_item_id<>p_stock_item_id then raise exception 'Selected lot belongs to a different stock item'; end if;
    select count(*) into v_serial_count from public.stock_serials where lot_id=p_lot_id and status in ('in_stock','reserved');
    if v_serial_count>=v_lot_quantity then raise exception 'All remaining item quantity in this lot is already represented by active serial records'; end if;
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
declare v_stock_item_id uuid; v_location_id uuid; v_items integer; v_boxes integer; v_mode text; v_status text; v_expiry date; v_part_id uuid;
begin
  select l.stock_item_id,l.location_id,l.quantity_items,l.quantity_boxes,s.tracking_mode,l.status,l.expiry_date
  into v_stock_item_id,v_location_id,v_items,v_boxes,v_mode,v_status,v_expiry
  from public.stock_lots l join public.stock_items s on s.id=l.stock_item_id where l.id=p_lot_id for update of l;
  if not found then raise exception 'Lot not found'; end if;
  if v_status<>'active' then raise exception 'Lot status % cannot be issued',v_status; end if;
  if v_expiry is not null and v_expiry<current_date then
    update public.stock_lots set status='expired',updated_at=now() where id=p_lot_id;
    raise exception 'Expired lots cannot be issued';
  end if;
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
declare v_stock_item_id uuid; v_location_id uuid; v_status text; v_lot_id uuid; v_part_id uuid; v_lot_status text; v_lot_expiry date;
begin
  select stock_item_id,location_id,status,lot_id into v_stock_item_id,v_location_id,v_status,v_lot_id from public.stock_serials where id=p_serial_id for update;
  if not found then raise exception 'Serial record not found'; end if;
  if v_status<>'in_stock' then raise exception 'Serial is not available'; end if;
  if v_lot_id is not null then
    select status,expiry_date into v_lot_status,v_lot_expiry from public.stock_lots where id=v_lot_id for update;
    if not found then raise exception 'Linked lot not found'; end if;
    if v_lot_status<>'active' then raise exception 'Linked lot status % cannot be issued',v_lot_status; end if;
    if v_lot_expiry is not null and v_lot_expiry<current_date then
      update public.stock_lots set status='expired',updated_at=now() where id=v_lot_id;
      raise exception 'The linked lot has expired';
    end if;
  end if;
  v_part_id:=public.consume_work_part(p_work_item_id,v_stock_item_id,1,'item',v_location_id,p_notes,null);
  if v_lot_id is not null then
    update public.stock_lots set quantity_items=quantity_items-1,status=case when quantity_items-1=0 and quantity_boxes=0 then 'depleted' else status end,updated_at=now() where id=v_lot_id and quantity_items>0;
    if not found then raise exception 'Linked lot does not have available item quantity'; end if;
  end if;
  update public.stock_serials set status='issued',work_item_id=p_work_item_id,customer_id=p_customer_id,machine_id=p_machine_id,issued_at=now(),notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),updated_at=now() where id=p_serial_id;
  return v_part_id;
end $$;

notify pgrst,'reload schema';
