-- DallmayrERP atomic stock transactions, purchase receiving and delivery picking.

create or replace function public.apply_stock_transaction(
  p_stock_item_id uuid,
  p_movement_type text,
  p_quantity integer,
  p_quantity_unit text default 'item',
  p_branch text default 'national',
  p_source_location_id uuid default null,
  p_destination_location_id uuid default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_notes text default null,
  p_barcode text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text:=public.current_app_role();
  v_actor uuid:=public.current_app_user_id();
  v_item_qty integer;
  v_box_qty integer;
  v_items_per_box integer;
  v_new_item_qty integer;
  v_new_box_qty integer;
  v_delta integer:=0;
  v_location_id uuid;
  v_location_item_qty integer;
  v_location_box_qty integer;
  v_new_location_item_qty integer;
  v_new_location_box_qty integer;
  v_scan_type text;
  v_movement_id uuid;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Role % may not transact stock',coalesce(v_role,'unknown'); end if;
  if p_branch not in ('jhb','cpt','kzn','national') then raise exception 'Invalid branch'; end if;
  if p_quantity_unit not in ('item','box') then raise exception 'Invalid quantity unit'; end if;
  if p_movement_type not in ('received','issued','adjustment_in','adjustment_out','returned','transferred','cycle_count','purchase_received','picked','dispatched') then raise exception 'Invalid movement type'; end if;
  if p_movement_type='cycle_count' then
    if p_quantity<0 then raise exception 'Cycle count cannot be negative'; end if;
  elsif p_quantity<=0 then raise exception 'Quantity must be greater than zero'; end if;

  select item_quantity,box_quantity,coalesce(items_per_box,1),
    coalesce(case when p_movement_type in ('received','returned','adjustment_in','purchase_received') then p_destination_location_id else p_source_location_id end,default_location_id)
  into v_item_qty,v_box_qty,v_items_per_box,v_location_id
  from public.stock_items where id=p_stock_item_id for update;
  if not found then raise exception 'Stock item not found'; end if;

  v_new_item_qty:=v_item_qty;
  v_new_box_qty:=v_box_qty;

  if p_movement_type='transferred' then
    if p_source_location_id is null or p_destination_location_id is null or p_source_location_id=p_destination_location_id then raise exception 'Transfer requires different source and destination locations'; end if;
    insert into public.stock_balances(stock_item_id,location_id) values(p_stock_item_id,p_source_location_id) on conflict(stock_item_id,location_id) do nothing;
    insert into public.stock_balances(stock_item_id,location_id) values(p_stock_item_id,p_destination_location_id) on conflict(stock_item_id,location_id) do nothing;
    select item_quantity,box_quantity into v_location_item_qty,v_location_box_qty from public.stock_balances where stock_item_id=p_stock_item_id and location_id=p_source_location_id for update;
    if p_quantity_unit='item' then
      if v_location_item_qty<p_quantity then raise exception 'Insufficient item quantity at source location'; end if;
      update public.stock_balances set item_quantity=item_quantity-p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=p_source_location_id;
      update public.stock_balances set item_quantity=item_quantity+p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=p_destination_location_id;
    else
      if v_location_box_qty<p_quantity then raise exception 'Insufficient box quantity at source location'; end if;
      update public.stock_balances set box_quantity=box_quantity-p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=p_source_location_id;
      update public.stock_balances set box_quantity=box_quantity+p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=p_destination_location_id;
    end if;
    v_delta:=p_quantity;
    v_scan_type:='stock_transfer';
  elsif p_movement_type='cycle_count' then
    if v_location_id is not null then
      insert into public.stock_balances(stock_item_id,location_id) values(p_stock_item_id,v_location_id) on conflict(stock_item_id,location_id) do nothing;
      select item_quantity,box_quantity into v_location_item_qty,v_location_box_qty from public.stock_balances where stock_item_id=p_stock_item_id and location_id=v_location_id for update;
      if p_quantity_unit='item' then
        v_delta:=p_quantity-v_location_item_qty;
        v_new_item_qty:=v_item_qty+v_delta;
        if v_new_item_qty<0 then raise exception 'Cycle count would make total items negative'; end if;
        update public.stock_balances set item_quantity=p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=v_location_id;
      else
        v_delta:=p_quantity-v_location_box_qty;
        v_new_box_qty:=v_box_qty+v_delta;
        if v_new_box_qty<0 then raise exception 'Cycle count would make total boxes negative'; end if;
        update public.stock_balances set box_quantity=p_quantity,updated_at=now() where stock_item_id=p_stock_item_id and location_id=v_location_id;
      end if;
    else
      if p_quantity_unit='item' then v_delta:=p_quantity-v_item_qty; v_new_item_qty:=p_quantity; else v_delta:=p_quantity-v_box_qty; v_new_box_qty:=p_quantity; end if;
    end if;
    v_scan_type:='cycle_count';
  else
    if p_movement_type in ('received','returned','adjustment_in','purchase_received') then v_delta:=p_quantity; else v_delta:=-p_quantity; end if;
    if p_quantity_unit='item' then v_new_item_qty:=v_item_qty+v_delta; else v_new_box_qty:=v_box_qty+v_delta; end if;
    if v_new_item_qty<0 or v_new_box_qty<0 then raise exception 'Insufficient on-hand quantity'; end if;
    if v_location_id is not null then
      insert into public.stock_balances(stock_item_id,location_id) values(p_stock_item_id,v_location_id) on conflict(stock_item_id,location_id) do nothing;
      select item_quantity,box_quantity into v_location_item_qty,v_location_box_qty from public.stock_balances where stock_item_id=p_stock_item_id and location_id=v_location_id for update;
      v_new_location_item_qty:=v_location_item_qty;
      v_new_location_box_qty:=v_location_box_qty;
      if p_quantity_unit='item' then v_new_location_item_qty:=v_location_item_qty+v_delta; else v_new_location_box_qty:=v_location_box_qty+v_delta; end if;
      if v_new_location_item_qty<0 or v_new_location_box_qty<0 then raise exception 'Insufficient quantity at selected location'; end if;
      update public.stock_balances set item_quantity=v_new_location_item_qty,box_quantity=v_new_location_box_qty,updated_at=now() where stock_item_id=p_stock_item_id and location_id=v_location_id;
    end if;
    v_scan_type:=case
      when p_movement_type in ('received','purchase_received','returned') then case when p_movement_type='purchase_received' then 'purchase_receive' else 'stock_add' end
      when p_movement_type in ('adjustment_in','adjustment_out') then 'stock_adjustment'
      when p_movement_type in ('picked','dispatched','issued') then 'stock_issue'
      else 'stock_adjustment' end;
  end if;

  if p_movement_type<>'transferred' then update public.stock_items set item_quantity=v_new_item_qty,box_quantity=v_new_box_qty,updated_at=now() where id=p_stock_item_id; end if;

  insert into public.inventory_movements(stock_item_id,branch,movement_type,quantity,quantity_unit,source_location_id,destination_location_id,reference_type,reference_id,notes,created_by,balance_after_items,balance_after_boxes)
  values(p_stock_item_id,p_branch,p_movement_type,case when p_movement_type='transferred' then p_quantity else v_delta end,p_quantity_unit,p_source_location_id,p_destination_location_id,p_reference_type,p_reference_id,p_notes,v_actor,v_new_item_qty,v_new_box_qty)
  returning id into v_movement_id;

  if nullif(trim(coalesce(p_barcode,'')),'') is not null then
    insert into public.stock_scan_events(barcode,scan_type,branch,quantity,stock_item_id,scanned_by,notes)
    values(trim(p_barcode),v_scan_type,p_branch,greatest(p_quantity,1),p_stock_item_id,v_actor,p_notes);
  end if;

  insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,after_payload,metadata)
  values(v_actor,v_role,p_branch,'stock_item',p_stock_item_id,'stock_transaction',concat(p_movement_type,' ',p_quantity,' ',p_quantity_unit),jsonb_build_object('movement_type',p_movement_type,'quantity',p_quantity,'unit',p_quantity_unit,'item_balance',v_new_item_qty,'box_balance',v_new_box_qty),jsonb_build_object('movement_id',v_movement_id,'source_location_id',p_source_location_id,'destination_location_id',p_destination_location_id));

  return jsonb_build_object('movement_id',v_movement_id,'item_quantity',v_new_item_qty,'box_quantity',v_new_box_qty,'delta',v_delta);
end;
$$;

create or replace function public.transition_purchase_order(p_purchase_order_id uuid,p_new_status text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_role text:=public.current_app_role(); v_old_status text;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  select status into v_old_status from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not ((v_old_status='draft' and p_new_status in ('ordered','cancelled')) or (v_old_status='ordered' and p_new_status in ('part_received','received','cancelled')) or (v_old_status='part_received' and p_new_status in ('received','cancelled')) or v_old_status=p_new_status) then raise exception 'Invalid purchase order transition from % to %',v_old_status,p_new_status; end if;
  update public.purchase_orders set status=p_new_status,ordered_at=case when p_new_status='ordered' and ordered_at is null then now() else ordered_at end,received_at=case when p_new_status='received' and received_at is null then now() else received_at end,updated_at=now() where id=p_purchase_order_id;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,before_payload,after_payload) values(public.current_app_user_id(),v_role,'purchase_order',p_purchase_order_id,'purchase_order_status_changed','Purchase order status changed',jsonb_build_object('status',v_old_status),jsonb_build_object('status',p_new_status));
end;
$$;

create or replace function public.receive_purchase_order_line(p_line_id uuid,p_quantity integer,p_destination_location_id uuid default null,p_barcode text default null,p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text:=public.current_app_role(); v_po_id uuid; v_stock_item_id uuid; v_unit text; v_ordered integer; v_received integer; v_branch text; v_remaining integer; v_result jsonb; v_all_received boolean;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised'; end if;
  if p_quantity<=0 then raise exception 'Quantity must be greater than zero'; end if;
  select l.purchase_order_id,l.stock_item_id,l.quantity_unit,l.quantity_ordered,l.quantity_received,o.branch into v_po_id,v_stock_item_id,v_unit,v_ordered,v_received,v_branch from public.purchase_order_lines l join public.purchase_orders o on o.id=l.purchase_order_id where l.id=p_line_id for update of l,o;
  if not found then raise exception 'Purchase order line not found'; end if;
  v_remaining:=v_ordered-v_received;
  if p_quantity>v_remaining then raise exception 'Quantity exceeds remaining order quantity of %',v_remaining; end if;
  v_result:=public.apply_stock_transaction(v_stock_item_id,'purchase_received',p_quantity,v_unit,v_branch,null,p_destination_location_id,'purchase_order',v_po_id,p_notes,p_barcode);
  update public.purchase_order_lines set quantity_received=quantity_received+p_quantity,updated_at=now() where id=p_line_id;
  select bool_and(quantity_received>=quantity_ordered) into v_all_received from public.purchase_order_lines where purchase_order_id=v_po_id;
  update public.purchase_orders set status=case when v_all_received then 'received' else 'part_received' end,received_at=case when v_all_received then now() else received_at end,updated_at=now() where id=v_po_id;
  return v_result||jsonb_build_object('purchase_order_id',v_po_id,'line_id',p_line_id,'remaining',v_remaining-p_quantity);
end;
$$;

create or replace function public.create_delivery_order_from_scans(p_customer_name text,p_delivery_address text,p_branch text,p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role text:=public.current_app_role(); v_actor uuid:=public.current_app_user_id(); v_order_id uuid; v_order_number text; v_line jsonb; v_stock_item_id uuid; v_barcode text; v_stock_name text; v_quantity integer; v_unit text; v_source_location_id uuid;
begin
  if v_role not in ('admin','operations','warehouse_staff') then raise exception 'Not authorised to create picked delivery orders'; end if;
  if p_branch not in ('jhb','cpt','kzn','national') then raise exception 'Invalid branch'; end if;
  if nullif(trim(coalesce(p_customer_name,'')),'') is null then raise exception 'Customer is required'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'At least one scanned line is required'; end if;

  v_order_number:=concat('DO-',upper(p_branch),'-',floor(extract(epoch from clock_timestamp())*1000)::bigint);
  insert into public.delivery_orders(order_number,branch,customer_name,delivery_address,status,created_by,status_updated_at,status_updated_by)
  values(v_order_number,p_branch,trim(p_customer_name),nullif(trim(coalesce(p_delivery_address,'')),''),'picked',v_actor,now(),v_actor)
  returning id into v_order_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_stock_item_id:=nullif(v_line->>'stock_item_id','')::uuid;
    v_barcode:=trim(coalesce(v_line->>'barcode',''));
    v_stock_name:=nullif(trim(coalesce(v_line->>'stock_name','')),'');
    v_quantity:=coalesce((v_line->>'quantity')::integer,0);
    v_unit:=coalesce(nullif(v_line->>'quantity_unit',''),'item');
    v_source_location_id:=nullif(v_line->>'source_location_id','')::uuid;
    if v_stock_item_id is null then raise exception 'All delivery lines must match a stock item'; end if;
    if v_quantity<=0 then raise exception 'Delivery line quantity must be greater than zero'; end if;
    if v_unit not in ('item','box') then raise exception 'Invalid delivery line unit'; end if;
    insert into public.delivery_order_lines(order_id,barcode,stock_item_id,stock_name,quantity,quantity_unit,source_location_id)
    values(v_order_id,v_barcode,v_stock_item_id,v_stock_name,v_quantity,v_unit,v_source_location_id);
    perform public.apply_stock_transaction(v_stock_item_id,'picked',v_quantity,v_unit,p_branch,v_source_location_id,null,'delivery_order',v_order_id,concat('Picked for ',v_order_number),v_barcode);
  end loop;

  insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,after_payload)
  values(v_actor,v_role,p_branch,'delivery_order',v_order_id,'delivery_order_created',concat(v_order_number,' created and stock picked'),jsonb_build_object('order_number',v_order_number,'line_count',jsonb_array_length(p_lines),'status','picked'));
  return v_order_id;
end;
$$;

notify pgrst,'reload schema';
