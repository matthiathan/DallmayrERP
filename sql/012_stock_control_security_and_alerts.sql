-- DallmayrERP stock-control RLS, storage access, quantity guards and alerts.

alter table public.stock_balances enable row level security;
alter table public.stock_item_photos enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.stock_alerts enable row level security;

drop policy if exists stock_balances_read on public.stock_balances;
create policy stock_balances_read on public.stock_balances for select to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','finance','executive'));
drop policy if exists stock_balances_write on public.stock_balances;
create policy stock_balances_write on public.stock_balances for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));

drop policy if exists stock_item_photos_read on public.stock_item_photos;
create policy stock_item_photos_read on public.stock_item_photos for select to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','finance','executive','sales','technician','road_technician'));
drop policy if exists stock_item_photos_write on public.stock_item_photos;
create policy stock_item_photos_write on public.stock_item_photos for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));

drop policy if exists purchase_orders_read on public.purchase_orders;
create policy purchase_orders_read on public.purchase_orders for select to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','finance','executive'));
drop policy if exists purchase_orders_write on public.purchase_orders;
create policy purchase_orders_write on public.purchase_orders for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));

drop policy if exists purchase_order_lines_read on public.purchase_order_lines;
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','finance','executive'));
drop policy if exists purchase_order_lines_write on public.purchase_order_lines;
create policy purchase_order_lines_write on public.purchase_order_lines for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));

drop policy if exists stock_alerts_read on public.stock_alerts;
create policy stock_alerts_read on public.stock_alerts for select to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff','executive','finance'));
drop policy if exists stock_alerts_update on public.stock_alerts;
create policy stock_alerts_update on public.stock_alerts for update to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));

drop policy if exists stock_photos_storage_select on storage.objects;
create policy stock_photos_storage_select on storage.objects for select to authenticated using (bucket_id='dallmayrerp-stock-photos');
drop policy if exists stock_photos_storage_insert on storage.objects;
create policy stock_photos_storage_insert on storage.objects for insert to authenticated with check (bucket_id='dallmayrerp-stock-photos' and public.current_app_role() in ('admin','operations','warehouse_staff'));
drop policy if exists stock_photos_storage_update on storage.objects;
create policy stock_photos_storage_update on storage.objects for update to authenticated using (bucket_id='dallmayrerp-stock-photos' and public.current_app_role() in ('admin','operations','warehouse_staff')) with check (bucket_id='dallmayrerp-stock-photos' and public.current_app_role() in ('admin','operations','warehouse_staff'));
drop policy if exists stock_photos_storage_delete on storage.objects;
create policy stock_photos_storage_delete on storage.objects for delete to authenticated using (bucket_id='dallmayrerp-stock-photos' and public.current_app_role() in ('admin','operations','warehouse_staff'));

-- Replace legacy broad stock-item policies with role-controlled access.
drop policy if exists "Authenticated users can insert stock items" on public.stock_items;
drop policy if exists "Authenticated users can read stock items" on public.stock_items;
drop policy if exists "Authenticated users can update stock items" on public.stock_items;
drop policy if exists authenticated_insert on public.stock_items;
drop policy if exists authenticated_select on public.stock_items;
drop policy if exists authenticated_update on public.stock_items;
drop policy if exists stock_items_business_read on public.stock_items;
create policy stock_items_business_read on public.stock_items for select to authenticated using (public.current_app_role() in ('admin','operations','sales','finance','marketing','executive','warehouse_staff','technician','road_technician'));
drop policy if exists stock_items_controlled_insert on public.stock_items;
create policy stock_items_controlled_insert on public.stock_items for insert to authenticated with check (public.current_app_role() in ('admin','operations','warehouse_staff'));
drop policy if exists stock_items_controlled_update on public.stock_items;
create policy stock_items_controlled_update on public.stock_items for update to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));
drop policy if exists stock_items_admin_delete on public.stock_items;
create policy stock_items_admin_delete on public.stock_items for delete to authenticated using (public.current_app_role()='admin');

create or replace function public.guard_stock_quantity_updates()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_user in ('postgres','service_role') then return new; end if;
  if tg_op='INSERT' then
    if coalesce(new.item_quantity,0)<>0 or coalesce(new.box_quantity,0)<>0 then
      raise exception 'Initial stock quantities must be recorded through the stock transaction workflow';
    end if;
  elsif old.item_quantity is distinct from new.item_quantity or old.box_quantity is distinct from new.box_quantity then
    raise exception 'Stock quantities must be changed through the stock transaction workflow';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_stock_quantity_updates_trigger on public.stock_items;
create trigger guard_stock_quantity_updates_trigger before insert or update of item_quantity,box_quantity on public.stock_items for each row execute function public.guard_stock_quantity_updates();

create or replace function public.refresh_stock_alert()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_total integer; v_type text;
begin
  v_total:=new.item_quantity+new.box_quantity*coalesce(new.items_per_box,1);
  if new.track_stock and v_total<=new.reorder_level then
    v_type:=case when v_total=0 then 'out_of_stock' else 'low_stock' end;
    insert into public.stock_alerts(stock_item_id,alert_type,status,current_quantity,threshold,created_at,updated_at,resolved_at)
    values(new.id,v_type,'open',v_total,new.reorder_level,now(),now(),null)
    on conflict(stock_item_id) do update set alert_type=excluded.alert_type,status=case when public.stock_alerts.status='acknowledged' then 'acknowledged' else 'open' end,current_quantity=excluded.current_quantity,threshold=excluded.threshold,updated_at=now(),resolved_at=null;
  else
    update public.stock_alerts set status='resolved',current_quantity=v_total,threshold=new.reorder_level,resolved_at=now(),updated_at=now() where stock_item_id=new.id and status<>'resolved';
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_stock_alert_trigger on public.stock_items;
create trigger refresh_stock_alert_trigger after insert or update of item_quantity,box_quantity,reorder_level,items_per_box,track_stock on public.stock_items for each row execute function public.refresh_stock_alert();

insert into public.stock_alerts(stock_item_id,alert_type,status,current_quantity,threshold)
select id,case when item_quantity+box_quantity*coalesce(items_per_box,1)=0 then 'out_of_stock' else 'low_stock' end,'open',item_quantity+box_quantity*coalesce(items_per_box,1),reorder_level
from public.stock_items where track_stock and item_quantity+box_quantity*coalesce(items_per_box,1)<=reorder_level
on conflict(stock_item_id) do update set alert_type=excluded.alert_type,current_quantity=excluded.current_quantity,threshold=excluded.threshold,updated_at=now();

notify pgrst,'reload schema';
