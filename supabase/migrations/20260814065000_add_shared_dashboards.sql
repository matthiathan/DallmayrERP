-- Administrator-published shared dashboards for DallmayrERP.
--
-- This migration creates a deliberately constrained dashboard model:
-- - dashboards are published to one role and optionally one branch audience;
-- - widgets reference a fixed allow-listed metric key only;
-- - metric values continue to come from get_role_workspace_summary();
-- - no arbitrary SQL, RPC names, expressions or drill-down URLs are stored here.

create table if not exists public.shared_dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 3 and 80),
  slug text not null unique check (
    char_length(slug) between 3 and 80
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  description text check (description is null or char_length(description) <= 280),
  target_role text not null check (target_role in (
    'admin', 'operations', 'sales', 'finance', 'marketing', 'executive',
    'warehouse_staff', 'technician', 'road_technician'
  )),
  branch_scope text check (branch_scope is null or branch_scope in ('jhb', 'cpt', 'kzn', 'national')),
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.shared_dashboards(id) on delete cascade,
  metric_key text not null check (metric_key in (
    'branch_open_work', 'branch_overdue_work', 'pending_approvals', 'business_users',
    'unassigned_work', 'open_service_jobs', 'stock_alerts', 'open_purchase_orders',
    'open_deliveries', 'my_active_work', 'my_overdue_work', 'my_open_service_jobs',
    'my_high_priority_work', 'my_open_deliveries', 'customer_count', 'contract_records',
    'open_opportunities', 'commercial_accounts', 'pending_purchase_approvals',
    'pending_work_approvals', 'active_campaigns', 'marketing_segments', 'renewals_due_90'
  )),
  position integer not null default 0 check (position between 0 and 49),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dashboard_id, metric_key)
);

create index if not exists shared_dashboards_audience_idx
  on public.shared_dashboards(target_role, is_published, branch_scope, name);
create index if not exists shared_dashboard_widgets_order_idx
  on public.shared_dashboard_widgets(dashboard_id, position, created_at);

create or replace function public.shared_dashboard_metric_allowed(p_role text, p_metric text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'admin' then p_metric = any(array[
      'branch_open_work', 'branch_overdue_work', 'pending_approvals', 'business_users'
    ]::text[])
    when 'operations' then p_metric = any(array[
      'branch_open_work', 'branch_overdue_work', 'unassigned_work', 'open_service_jobs'
    ]::text[])
    when 'warehouse_staff' then p_metric = any(array[
      'stock_alerts', 'open_purchase_orders', 'open_deliveries', 'my_active_work'
    ]::text[])
    when 'technician' then p_metric = any(array[
      'my_active_work', 'my_overdue_work', 'my_open_service_jobs', 'my_high_priority_work'
    ]::text[])
    when 'road_technician' then p_metric = any(array[
      'my_active_work', 'my_overdue_work', 'my_open_deliveries', 'my_open_service_jobs'
    ]::text[])
    when 'executive' then p_metric = any(array[
      'branch_open_work', 'branch_overdue_work', 'pending_approvals', 'stock_alerts'
    ]::text[])
    when 'sales' then p_metric = any(array[
      'customer_count', 'contract_records', 'open_opportunities', 'my_active_work'
    ]::text[])
    when 'finance' then p_metric = any(array[
      'commercial_accounts', 'pending_purchase_approvals', 'pending_work_approvals', 'my_active_work'
    ]::text[])
    when 'marketing' then p_metric = any(array[
      'active_campaigns', 'marketing_segments', 'renewals_due_90', 'customer_count'
    ]::text[])
    else false
  end;
$$;

create or replace function public.shared_dashboard_current_branch()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.branch
  from public.user_details d
  where d.user_id = public.current_app_user_id()
  limit 1;
$$;

create or replace function public.guard_shared_dashboard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  widget_count integer;
begin
  if tg_op = 'INSERT' then
    if new.is_published then
      raise exception 'Shared dashboards must be created as drafts';
    end if;
    new.published_at := null;
    new.updated_at := now();
    return new;
  end if;

  if new.target_role is distinct from old.target_role and exists (
    select 1
    from public.shared_dashboard_widgets w
    where w.dashboard_id = new.id
      and not public.shared_dashboard_metric_allowed(new.target_role, w.metric_key)
  ) then
    raise exception 'Remove widgets that are not permitted for the selected role before changing the dashboard role';
  end if;

  if new.is_published then
    select count(*) into widget_count
    from public.shared_dashboard_widgets w
    where w.dashboard_id = new.id;

    if widget_count = 0 then
      raise exception 'A shared dashboard must contain at least one widget before it can be published';
    end if;

    if exists (
      select 1
      from public.shared_dashboard_widgets w
      where w.dashboard_id = new.id
        and not public.shared_dashboard_metric_allowed(new.target_role, w.metric_key)
    ) then
      raise exception 'Shared dashboard contains a widget that is not permitted for its target role';
    end if;

    if not old.is_published then
      new.published_at := now();
    else
      new.published_at := coalesce(old.published_at, now());
    end if;
  else
    new.published_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_shared_dashboard_widget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dashboard_role text;
  dashboard_published boolean;
  widget_count integer;
begin
  if tg_op = 'DELETE' then
    select d.is_published into dashboard_published
    from public.shared_dashboards d
    where d.id = old.dashboard_id;

    if coalesce(dashboard_published, false) then
      select count(*) into widget_count
      from public.shared_dashboard_widgets w
      where w.dashboard_id = old.dashboard_id;

      if widget_count <= 1 then
        raise exception 'Unpublish the dashboard before removing its final widget';
      end if;
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' and new.dashboard_id is distinct from old.dashboard_id then
    raise exception 'Shared dashboard widgets cannot be moved between dashboards';
  end if;

  select d.target_role into dashboard_role
  from public.shared_dashboards d
  where d.id = new.dashboard_id;

  if dashboard_role is null then
    raise exception 'Shared dashboard not found';
  end if;

  if not public.shared_dashboard_metric_allowed(dashboard_role, new.metric_key) then
    raise exception 'Metric % is not permitted for role %', new.metric_key, dashboard_role;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.audit_shared_dashboard_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dashboard_id uuid;
  dashboard_branch text;
  before_state jsonb;
  after_state jsonb;
begin
  if tg_op = 'DELETE' then
    dashboard_id := old.id;
    dashboard_branch := old.branch_scope;
    before_state := to_jsonb(old);
    after_state := null;
  elsif tg_op = 'INSERT' then
    dashboard_id := new.id;
    dashboard_branch := new.branch_scope;
    before_state := null;
    after_state := to_jsonb(new);
  else
    dashboard_id := new.id;
    dashboard_branch := new.branch_scope;
    before_state := to_jsonb(old);
    after_state := to_jsonb(new);
  end if;

  insert into public.audit_events(
    actor_user_id, actor_role, branch, entity_type, entity_id,
    action, summary, before_payload, after_payload, metadata
  ) values (
    public.current_app_user_id(),
    public.current_app_role(),
    dashboard_branch,
    'shared_dashboard',
    dashboard_id,
    'shared_dashboard_' || lower(tg_op),
    'Shared dashboard ' || lower(tg_op) || ' recorded.',
    before_state,
    after_state,
    jsonb_build_object('source', 'shared_dashboard_admin')
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.audit_shared_dashboard_widget_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dashboard_id uuid;
  widget_id uuid;
  dashboard_branch text;
  before_state jsonb;
  after_state jsonb;
begin
  if tg_op = 'DELETE' then
    dashboard_id := old.dashboard_id;
    widget_id := old.id;
    before_state := to_jsonb(old);
    after_state := null;
  elsif tg_op = 'INSERT' then
    dashboard_id := new.dashboard_id;
    widget_id := new.id;
    before_state := null;
    after_state := to_jsonb(new);
  else
    dashboard_id := new.dashboard_id;
    widget_id := new.id;
    before_state := to_jsonb(old);
    after_state := to_jsonb(new);
  end if;

  select d.branch_scope into dashboard_branch
  from public.shared_dashboards d
  where d.id = dashboard_id;

  insert into public.audit_events(
    actor_user_id, actor_role, branch, entity_type, entity_id,
    action, summary, before_payload, after_payload, metadata
  ) values (
    public.current_app_user_id(),
    public.current_app_role(),
    dashboard_branch,
    'shared_dashboard',
    dashboard_id,
    'shared_dashboard_widget_' || lower(tg_op),
    'Shared dashboard widget ' || lower(tg_op) || ' recorded.',
    before_state,
    after_state,
    jsonb_build_object('source', 'shared_dashboard_admin', 'widget_id', widget_id)
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists shared_dashboards_guard on public.shared_dashboards;
create trigger shared_dashboards_guard
before insert or update on public.shared_dashboards
for each row execute function public.guard_shared_dashboard();

drop trigger if exists shared_dashboard_widgets_guard on public.shared_dashboard_widgets;
create trigger shared_dashboard_widgets_guard
before insert or update or delete on public.shared_dashboard_widgets
for each row execute function public.guard_shared_dashboard_widget();

drop trigger if exists shared_dashboards_audit on public.shared_dashboards;
create trigger shared_dashboards_audit
after insert or update or delete on public.shared_dashboards
for each row execute function public.audit_shared_dashboard_change();

drop trigger if exists shared_dashboard_widgets_audit on public.shared_dashboard_widgets;
create trigger shared_dashboard_widgets_audit
after insert or update or delete on public.shared_dashboard_widgets
for each row execute function public.audit_shared_dashboard_widget_change();

alter table public.shared_dashboards enable row level security;
alter table public.shared_dashboard_widgets enable row level security;

revoke all on table public.shared_dashboards from public, anon;
revoke all on table public.shared_dashboard_widgets from public, anon;
grant select, insert, update, delete on table public.shared_dashboards to authenticated;
grant select, insert, update, delete on table public.shared_dashboard_widgets to authenticated;
grant all on table public.shared_dashboards to service_role;
grant all on table public.shared_dashboard_widgets to service_role;

revoke all on function public.shared_dashboard_metric_allowed(text, text) from public, anon;
revoke all on function public.shared_dashboard_current_branch() from public, anon;
revoke all on function public.guard_shared_dashboard() from public, anon, authenticated;
revoke all on function public.guard_shared_dashboard_widget() from public, anon, authenticated;
revoke all on function public.audit_shared_dashboard_change() from public, anon, authenticated;
revoke all on function public.audit_shared_dashboard_widget_change() from public, anon, authenticated;
grant execute on function public.shared_dashboard_metric_allowed(text, text) to authenticated, service_role;
grant execute on function public.shared_dashboard_current_branch() to authenticated, service_role;

create policy shared_dashboards_select_visible
on public.shared_dashboards
for select
to authenticated
using (
  public.current_app_role() = 'admin'
  or (
    is_published = true
    and target_role = public.current_app_role()
    and (branch_scope is null or branch_scope = public.shared_dashboard_current_branch())
  )
);

create policy shared_dashboards_admin_insert
on public.shared_dashboards
for insert
to authenticated
with check (public.current_app_role() = 'admin');

create policy shared_dashboards_admin_update
on public.shared_dashboards
for update
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create policy shared_dashboards_admin_delete
on public.shared_dashboards
for delete
to authenticated
using (public.current_app_role() = 'admin');

create policy shared_dashboard_widgets_select_visible
on public.shared_dashboard_widgets
for select
to authenticated
using (
  public.current_app_role() = 'admin'
  or exists (
    select 1
    from public.shared_dashboards d
    where d.id = dashboard_id
      and d.is_published = true
      and d.target_role = public.current_app_role()
      and (d.branch_scope is null or d.branch_scope = public.shared_dashboard_current_branch())
  )
);

create policy shared_dashboard_widgets_admin_insert
on public.shared_dashboard_widgets
for insert
to authenticated
with check (public.current_app_role() = 'admin');

create policy shared_dashboard_widgets_admin_update
on public.shared_dashboard_widgets
for update
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

create policy shared_dashboard_widgets_admin_delete
on public.shared_dashboard_widgets
for delete
to authenticated
using (public.current_app_role() = 'admin');
