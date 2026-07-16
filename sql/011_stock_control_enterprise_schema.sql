-- DallmayrERP enterprise stock-control schema.
-- Applied to Supabase project egbiiizxsqlarqpnzxxs.

alter table public.stock_items add column if not exists sku text;
alter table public.stock_items add column if not exists description text;
alter table public.stock_items add column if not exists unit_cost numeric(14,2);
alter table public.stock_items add column if not exists sales_price numeric(14,2);
alter table public.stock_items add column if not exists preferred_reorder_quantity integer not null default 0;
alter table public.stock_items add column if not exists default_supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.stock_items add column if not exists default_warehouse_id uuid references public.warehouses(id) on delete set null;
alter table public.stock_items add column if not exists default_location_id uuid references public.stock_locations(id) on delete set null;
alter table public.stock_items add column if not exists track_stock boolean not null default true;
create unique index if not exists stock_items_sku_unique_idx on public.stock_items(sku) where sku is not null;

alter table public.inventory_movements add column if not exists quantity_unit text not null default 'item';
alter table public.inventory_movements add column if not exists source_location_id uuid references public.stock_locations(id) on delete set null;
alter table public.inventory_movements add column if not exists destination_location_id uuid references public.stock_locations(id) on delete set null;
alter table public.inventory_movements add column if not exists balance_after_items integer;
alter table public.inventory_movements add column if not exists balance_after_boxes integer;
alter table public.inventory_movements drop constraint if exists inventory_movements_quantity_unit_check;
alter table public.inventory_movements add constraint inventory_movements_quantity_unit_check check (quantity_unit in ('item','box'));
alter table public.inventory_movements drop constraint if exists inventory_movements_movement_type_check;
alter table public.inventory_movements add constraint inventory_movements_movement_type_check check (movement_type in ('received','adjusted','reserved','picked','dispatched','returned','transferred','issued','adjustment_in','adjustment_out','transfer_in','transfer_out','cycle_count','purchase_received'));
alter table public.inventory_movements drop constraint if exists inventory_movements_quantity_check;
alter table public.inventory_movements add constraint inventory_movements_quantity_check check (quantity <> 0 or movement_type='cycle_count');

alter table public.stock_scan_events drop constraint if exists stock_scan_events_scan_type_check;
alter table public.stock_scan_events add constraint stock_scan_events_scan_type_check check (scan_type in ('stock_add','stock_adjustment','order_pick','machine_scan','task_close','stock_issue','stock_transfer','cycle_count','purchase_receive'));

create table if not exists public.stock_balances (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  item_quantity integer not null default 0 check (item_quantity >= 0),
  box_quantity integer not null default 0 check (box_quantity >= 0),
  updated_at timestamptz not null default now(),
  unique(stock_item_id,location_id)
);

create table if not exists public.stock_item_photos (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  file_bucket text not null default 'dallmayrerp-stock-photos',
  file_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  is_primary boolean not null default false,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_name text not null,
  branch text not null check (branch in ('jhb','cpt','kzn','national')),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','ordered','part_received','received','cancelled')),
  order_date date not null default current_date,
  expected_date date,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity_ordered integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  quantity_unit text not null default 'item' check (quantity_unit in ('item','box')),
  unit_cost numeric(14,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(purchase_order_id,stock_item_id,quantity_unit)
);

alter table public.delivery_order_lines add column if not exists quantity_unit text not null default 'item';
alter table public.delivery_order_lines add column if not exists source_location_id uuid references public.stock_locations(id) on delete set null;
alter table public.delivery_order_lines drop constraint if exists delivery_order_lines_quantity_unit_check;
alter table public.delivery_order_lines add constraint delivery_order_lines_quantity_unit_check check (quantity_unit in ('item','box'));

create table if not exists public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null unique references public.stock_items(id) on delete cascade,
  alert_type text not null check (alert_type in ('low_stock','out_of_stock')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  current_quantity integer not null default 0,
  threshold integer not null default 0,
  acknowledged_by uuid references public.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_balances_item_idx on public.stock_balances(stock_item_id);
create index if not exists stock_balances_location_idx on public.stock_balances(location_id);
create index if not exists stock_item_photos_item_idx on public.stock_item_photos(stock_item_id,created_at desc);
create index if not exists purchase_orders_status_idx on public.purchase_orders(status,expected_date);
create index if not exists purchase_order_lines_po_idx on public.purchase_order_lines(purchase_order_id);

alter table public.stock_balances enable row level security;
alter table public.stock_item_photos enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.stock_alerts enable row level security;

insert into public.warehouses(branch,warehouse_name,address,status) values
('jhb','Johannesburg Main Warehouse',null,'active'),
('cpt','Cape Town Main Warehouse',null,'active'),
('kzn','KwaZulu-Natal Main Warehouse',null,'active'),
('national','National Warehouse',null,'active')
on conflict(branch,warehouse_name) do nothing;

insert into public.stock_locations(warehouse_id,location_code,description,status)
select id,'MAIN','Main receiving and storage location','active' from public.warehouses where status='active'
on conflict(warehouse_id,location_code) do nothing;

insert into storage.buckets(id,name,public) values('dallmayrerp-stock-photos','dallmayrerp-stock-photos',false)
on conflict(id) do nothing;

notify pgrst,'reload schema';
