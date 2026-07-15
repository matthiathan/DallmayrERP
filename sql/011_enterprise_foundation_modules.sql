-- Enterprise foundation modules for DallmayrERP.
-- Adds auditability, normalized master-data foundations, service jobs,
-- inventory movements, warehouses, suppliers and delivery routes.
-- Raw upload tables remain unchanged.

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  actor_role text,
  branch text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text,
  before_payload jsonb,
  after_payload jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  branch text not null default 'national',
  customer_code text unique,
  customer_name text not null,
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive', 'prospect', 'archived')),
  source_table text,
  source_key text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  branch text not null default 'national',
  site_name text not null,
  address text,
  contact_name text,
  contact_phone text,
  latitude numeric,
  longitude numeric,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null unique,
  contact_name text,
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  warehouse_name text not null,
  address text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch, warehouse_name)
);

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid references public.warehouses(id) on delete cascade,
  location_code text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(warehouse_id, location_code)
);

create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  branch text not null default 'national',
  customer_id uuid references public.customers(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  asset_tag text unique,
  serial_number text,
  machine_barcode text unique,
  machine_name text,
  model text,
  status text not null default 'active' check (status in ('active', 'inactive', 'repair', 'retired', 'unknown')),
  source_table text,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  branch text not null default 'national',
  customer_id uuid references public.customers(id) on delete set null,
  contract_number text unique,
  contract_type text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('draft', 'active', 'expired', 'cancelled', 'archived')),
  source_table text,
  source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  branch text not null default 'national',
  job_number text unique not null default ('SJ-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  customer_id uuid references public.customers(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  machine_id uuid references public.machines(id) on delete set null,
  assigned_to uuid references public.users(id) on delete set null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  status text not null default 'new' check (status in ('new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled')),
  summary text not null,
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  branch text not null,
  movement_type text not null check (movement_type in ('received', 'adjusted', 'reserved', 'picked', 'dispatched', 'returned', 'transferred')),
  quantity integer not null check (quantity <> 0),
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_routes (
  id uuid primary key default gen_random_uuid(),
  route_number text unique not null default ('RT-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  branch text not null,
  assigned_to uuid references public.users(id) on delete set null,
  route_date date not null default current_date,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.delivery_orders add column if not exists route_id uuid references public.delivery_routes(id) on delete set null;
alter table public.delivery_orders add column if not exists assigned_to uuid references public.users(id) on delete set null;
alter table public.delivery_orders add column if not exists dispatched_at timestamptz;
alter table public.delivery_orders add column if not exists delivered_at timestamptz;

create index if not exists audit_events_created_at_idx on public.audit_events(created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events(actor_user_id, created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events(entity_type, entity_id);
create index if not exists inventory_movements_stock_idx on public.inventory_movements(stock_item_id, created_at desc);
create index if not exists inventory_movements_branch_idx on public.inventory_movements(branch, created_at desc);
create index if not exists service_jobs_status_idx on public.service_jobs(status, priority, due_at);
create index if not exists service_jobs_branch_idx on public.service_jobs(branch, created_at desc);
create index if not exists machines_barcode_idx on public.machines(machine_barcode);
create index if not exists customers_branch_idx on public.customers(branch, customer_name);
create index if not exists delivery_orders_status_idx on public.delivery_orders(status, branch);

alter table public.audit_events enable row level security;
alter table public.customers enable row level security;
alter table public.customer_sites enable row level security;
alter table public.suppliers enable row level security;
alter table public.warehouses enable row level security;
alter table public.stock_locations enable row level security;
alter table public.machines enable row level security;
alter table public.contracts enable row level security;
alter table public.service_jobs enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.delivery_routes enable row level security;

create policy audit_events_select_admin_exec on public.audit_events for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations'));
create policy audit_events_insert_authenticated on public.audit_events for insert to authenticated with check (actor_user_id = public.current_app_user_id() or public.current_app_role() = 'admin');

create policy customers_select_business on public.customers for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'finance', 'marketing'));
create policy customers_modify_business on public.customers for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'sales')) with check (public.current_app_role() in ('admin', 'operations', 'sales'));

create policy customer_sites_select_business on public.customer_sites for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'finance', 'marketing', 'technician', 'road_technician'));
create policy customer_sites_modify_business on public.customer_sites for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'sales')) with check (public.current_app_role() in ('admin', 'operations', 'sales'));

create policy machines_select_business on public.machines for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'technician', 'road_technician', 'warehouse_staff'));
create policy machines_modify_business on public.machines for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'technician', 'road_technician')) with check (public.current_app_role() in ('admin', 'operations', 'technician', 'road_technician'));

create policy contracts_select_business on public.contracts for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'finance', 'marketing'));
create policy contracts_modify_business on public.contracts for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'sales', 'finance')) with check (public.current_app_role() in ('admin', 'operations', 'sales', 'finance'));

create policy service_jobs_select_business on public.service_jobs for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'technician', 'road_technician'));
create policy service_jobs_modify_business on public.service_jobs for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'technician', 'road_technician')) with check (public.current_app_role() in ('admin', 'operations', 'technician', 'road_technician'));

create policy inventory_movements_select_business on public.inventory_movements for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'warehouse_staff', 'finance'));
create policy inventory_movements_insert_business on public.inventory_movements for insert to authenticated with check (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'));

create policy delivery_routes_select_business on public.delivery_routes for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'road_technician'));
create policy delivery_routes_modify_business on public.delivery_routes for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'road_technician')) with check (public.current_app_role() in ('admin', 'operations', 'road_technician'));

create policy suppliers_select_business on public.suppliers for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'finance', 'warehouse_staff'));
create policy suppliers_modify_business on public.suppliers for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'warehouse_staff')) with check (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'));

create policy warehouses_select_business on public.warehouses for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'warehouse_staff'));
create policy warehouses_modify_business on public.warehouses for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'warehouse_staff')) with check (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'));

create policy stock_locations_select_business on public.stock_locations for select to authenticated using (public.current_app_role() in ('admin', 'executive', 'operations', 'warehouse_staff'));
create policy stock_locations_modify_business on public.stock_locations for all to authenticated using (public.current_app_role() in ('admin', 'operations', 'warehouse_staff')) with check (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'));

insert into public.warehouses(branch, warehouse_name)
values ('jhb', 'JHB Main Warehouse'), ('cpt', 'CPT Main Warehouse'), ('kzn', 'KZN Main Warehouse')
on conflict (branch, warehouse_name) do nothing;
