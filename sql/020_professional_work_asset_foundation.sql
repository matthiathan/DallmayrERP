-- DallmayrERP professional work management and asset lifecycle foundation.

alter table public.machines add column if not exists condition text not null default 'unknown' check (condition in ('good','fair','poor','critical','unknown'));
alter table public.machines add column if not exists criticality text not null default 'medium' check (criticality in ('low','medium','high','critical'));
alter table public.machines add column if not exists installed_at date;
alter table public.machines add column if not exists warranty_expires_at date;
alter table public.machines add column if not exists last_audit_at timestamptz;
alter table public.machines add column if not exists next_audit_at timestamptz;
alter table public.machines add column if not exists current_custodian text;
alter table public.machines add column if not exists custody_status text not null default 'available' check (custody_status in ('available','assigned','checked_out','in_service','retired'));

create table if not exists public.work_items (
  id uuid primary key default gen_random_uuid(),
  work_number text unique not null,
  title text not null,
  description text,
  work_type text not null default 'task' check (work_type in ('request','task','approval','inspection','maintenance','incident')),
  department text not null default 'operations',
  branch text not null default 'national' check (branch in ('jhb','cpt','kzn','national')),
  status text not null default 'new' check (status in ('new','triaged','assigned','in_progress','blocked','waiting_approval','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  requested_by uuid references public.users(id) on delete set null,
  assigned_to uuid references public.users(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  machine_id uuid references public.machines(id) on delete set null,
  stock_item_id uuid references public.stock_items(id) on delete set null,
  due_at timestamptz,
  sla_due_at timestamptz,
  approval_required boolean not null default false,
  approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_item_checklist (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  is_required boolean not null default false,
  is_completed boolean not null default false,
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  body text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.asset_events (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  event_type text not null check (event_type in ('created','assigned','checked_out','checked_in','audited','maintenance','status_changed','label_printed')),
  actor_user_id uuid references public.users(id) on delete set null,
  custodian text,
  condition text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.asset_audits (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  audited_by uuid references public.users(id) on delete set null,
  result text not null check (result in ('passed','attention','failed')),
  condition text not null check (condition in ('good','fair','poor','critical','unknown')),
  notes text,
  next_audit_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists work_items_status_due_idx on public.work_items(status,due_at);
create index if not exists work_items_assignee_idx on public.work_items(assigned_to,status);
create index if not exists work_items_branch_idx on public.work_items(branch,status);
create index if not exists work_item_checklist_work_idx on public.work_item_checklist(work_item_id,sort_order);
create index if not exists record_comments_entity_idx on public.record_comments(entity_type,entity_id,created_at);
create index if not exists asset_events_machine_idx on public.asset_events(machine_id,created_at desc);
create index if not exists asset_audits_machine_idx on public.asset_audits(machine_id,created_at desc);

drop trigger if exists set_work_items_updated_at on public.work_items;
create trigger set_work_items_updated_at before update on public.work_items for each row execute function public.set_updated_at();

alter table public.work_items enable row level security;
alter table public.work_item_checklist enable row level security;
alter table public.record_comments enable row level security;
alter table public.asset_events enable row level security;
alter table public.asset_audits enable row level security;

drop policy if exists work_items_read on public.work_items;
create policy work_items_read on public.work_items for select using (public.current_app_role() is not null);

drop policy if exists work_checklist_read on public.work_item_checklist;
create policy work_checklist_read on public.work_item_checklist for select using (public.current_app_role() is not null);
drop policy if exists work_checklist_insert on public.work_item_checklist;
create policy work_checklist_insert on public.work_item_checklist for insert with check (
  public.current_app_role() in ('admin','operations') or exists (
    select 1 from public.work_items w where w.id=work_item_id and (w.requested_by=public.current_app_user_id() or w.assigned_to=public.current_app_user_id())
  )
);
drop policy if exists work_checklist_update on public.work_item_checklist;
create policy work_checklist_update on public.work_item_checklist for update using (
  public.current_app_role() in ('admin','operations') or exists (
    select 1 from public.work_items w where w.id=work_item_id and (w.requested_by=public.current_app_user_id() or w.assigned_to=public.current_app_user_id())
  )
) with check (
  public.current_app_role() in ('admin','operations') or exists (
    select 1 from public.work_items w where w.id=work_item_id and (w.requested_by=public.current_app_user_id() or w.assigned_to=public.current_app_user_id())
  )
);

drop policy if exists record_comments_read on public.record_comments;
create policy record_comments_read on public.record_comments for select using (public.current_app_role() is not null);
drop policy if exists record_comments_insert on public.record_comments;
create policy record_comments_insert on public.record_comments for insert with check (created_by=public.current_app_user_id() and public.current_app_role() is not null);

drop policy if exists asset_events_read on public.asset_events;
create policy asset_events_read on public.asset_events for select using (public.current_app_role() is not null);
drop policy if exists asset_audits_read on public.asset_audits;
create policy asset_audits_read on public.asset_audits for select using (public.current_app_role() is not null);

notify pgrst,'reload schema';
