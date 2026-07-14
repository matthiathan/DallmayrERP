-- DallmayrERP operational and business reporting expansion
-- Additive schema for documents, scan events, task closures and delivery orders.

create table if not exists public.app_documents (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('marketing', 'warehouse', 'operations', 'technical', 'executive', 'admin')),
  branch text check (branch is null or branch in ('jhb', 'cpt', 'kzn', 'national')),
  title text not null,
  description text,
  file_bucket text not null default 'dallmayrerp-documents',
  file_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.task_closures (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in ('technician', 'road_technician', 'service_call', 'preventive_service')),
  branch text not null check (branch in ('jhb', 'cpt', 'kzn', 'national')),
  machine_barcode text not null,
  customer_name text,
  site_address text,
  outcome text not null check (outcome in ('completed', 'follow_up_required', 'parts_required', 'customer_unavailable')),
  notes text,
  photo_bucket text default 'dallmayrerp-task-photos',
  photo_path text,
  closed_by uuid references public.users(id) on delete set null,
  closed_at timestamptz not null default now()
);

create table if not exists public.stock_scan_events (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  scan_type text not null check (scan_type in ('stock_add', 'stock_adjustment', 'order_pick', 'machine_scan', 'task_close')),
  branch text not null check (branch in ('jhb', 'cpt', 'kzn', 'national')),
  quantity integer not null default 1 check (quantity > 0),
  stock_item_id uuid references public.stock_items(id) on delete set null,
  related_task_closure_id uuid references public.task_closures(id) on delete set null,
  scanned_by uuid references public.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.delivery_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  branch text not null check (branch in ('jhb', 'cpt', 'kzn', 'national')),
  customer_name text not null,
  delivery_address text,
  status text not null default 'draft' check (status in ('draft', 'picked', 'dispatched', 'delivered', 'cancelled')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.delivery_orders(id) on delete cascade,
  barcode text not null,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  stock_name text,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists app_documents_department_idx on public.app_documents(department, branch, created_at desc);
create index if not exists task_closures_branch_idx on public.task_closures(branch, closed_at desc);
create index if not exists stock_scan_events_branch_idx on public.stock_scan_events(branch, created_at desc);
create index if not exists delivery_orders_branch_idx on public.delivery_orders(branch, status, created_at desc);

alter table public.app_documents enable row level security;
alter table public.task_closures enable row level security;
alter table public.stock_scan_events enable row level security;
alter table public.delivery_orders enable row level security;
alter table public.delivery_order_lines enable row level security;

create policy app_documents_select_authenticated on public.app_documents
for select to authenticated
using (true);

create policy app_documents_insert_allowed_roles on public.app_documents
for insert to authenticated
with check (public.current_app_role() in ('admin', 'marketing', 'warehouse_staff', 'operations', 'executive'));

create policy app_documents_delete_admin on public.app_documents
for delete to authenticated
using (public.current_app_role() = 'admin');

create policy task_closures_select_ops_exec on public.task_closures
for select to authenticated
using (public.current_app_role() in ('admin', 'operations', 'executive', 'technician', 'road_technician'));

create policy task_closures_insert_tech_roles on public.task_closures
for insert to authenticated
with check (public.current_app_role() in ('admin', 'technician', 'road_technician'));

create policy stock_scan_events_select_ops on public.stock_scan_events
for select to authenticated
using (public.current_app_role() in ('admin', 'operations', 'executive', 'warehouse_staff'));

create policy stock_scan_events_insert_scan_roles on public.stock_scan_events
for insert to authenticated
with check (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'));

create policy delivery_orders_select_ops on public.delivery_orders
for select to authenticated
using (public.current_app_role() in ('admin', 'operations', 'executive', 'warehouse_staff'));

create policy delivery_orders_insert_ops on public.delivery_orders
for insert to authenticated
with check (public.current_app_role() in ('admin', 'operations'));

create policy delivery_orders_update_ops on public.delivery_orders
for update to authenticated
using (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'))
with check (public.current_app_role() in ('admin', 'operations', 'warehouse_staff'));

create policy delivery_order_lines_select_ops on public.delivery_order_lines
for select to authenticated
using (public.current_app_role() in ('admin', 'operations', 'executive', 'warehouse_staff'));

create policy delivery_order_lines_insert_ops on public.delivery_order_lines
for insert to authenticated
with check (public.current_app_role() in ('admin', 'operations'));

insert into storage.buckets (id, name, public)
values
  ('dallmayrerp-documents', 'dallmayrerp-documents', false),
  ('dallmayrerp-task-photos', 'dallmayrerp-task-photos', false)
on conflict (id) do nothing;

create policy storage_docs_read_authenticated on storage.objects
for select to authenticated
using (bucket_id in ('dallmayrerp-documents', 'dallmayrerp-task-photos'));

create policy storage_docs_upload_allowed_roles on storage.objects
for insert to authenticated
with check (
  bucket_id in ('dallmayrerp-documents', 'dallmayrerp-task-photos')
  and public.current_app_role() in ('admin', 'marketing', 'warehouse_staff', 'operations', 'technician', 'road_technician')
);

create policy storage_docs_delete_admin on storage.objects
for delete to authenticated
using (bucket_id in ('dallmayrerp-documents', 'dallmayrerp-task-photos') and public.current_app_role() = 'admin');
