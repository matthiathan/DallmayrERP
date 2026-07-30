-- Monday-style shared dashboards and controlled workflow automation.
-- Automation is deliberately limited to creating traceable follow-up work items.
-- Rules cannot approve, close, assign, deduct stock, or mutate source workflows.

create or replace function public.current_app_branch()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.branch
  from public.users u
  join public.user_details d on d.user_id = u.id
  where u.auth_user_id = (select auth.uid())
    and u.is_active = true
  limit 1;
$$;

create table if not exists public.shared_dashboards (
  id uuid primary key default gen_random_uuid(),
  workspace_key text not null default 'role_dashboard',
  name text not null,
  description text,
  role_scope text not null,
  branch_scope text,
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (workspace_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  check (char_length(trim(name)) between 1 and 120),
  check (role_scope in (
    'admin', 'operations', 'warehouse_staff', 'technician', 'road_technician',
    'sales', 'finance', 'marketing', 'executive'
  )),
  check (branch_scope is null or branch_scope in ('jhb', 'cpt', 'kzn', 'national')),
  check (jsonb_typeof(config) = 'object')
);

create unique index if not exists shared_dashboards_one_default_per_scope
  on public.shared_dashboards (workspace_key, role_scope, coalesce(branch_scope, '*'))
  where is_default and active;

create index if not exists shared_dashboards_scope_idx
  on public.shared_dashboards (workspace_key, role_scope, branch_scope, active);

create table if not exists public.workflow_automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  source_entity text not null,
  trigger_event text not null,
  conditions jsonb not null default '{}'::jsonb,
  action_config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(name)) between 1 and 140),
  check (source_entity in ('service_job', 'delivery_order', 'purchase_order', 'stock_alert')),
  check (trigger_event in ('created', 'status_changed', 'priority_changed', 'assignment_changed', 'threshold_breached')),
  check (jsonb_typeof(conditions) = 'object'),
  check (jsonb_typeof(action_config) = 'object')
);

create index if not exists workflow_automation_rules_active_idx
  on public.workflow_automation_rules (source_entity, trigger_event)
  where active;

create table if not exists public.workflow_automation_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.workflow_automation_rules(id) on delete cascade,
  source_entity text not null,
  source_id uuid not null,
  event_key text not null,
  trigger_event text not null,
  status text not null default 'processing',
  source_snapshot jsonb not null default '{}'::jsonb,
  work_item_id uuid references public.work_items(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status in ('processing', 'created', 'failed')),
  unique (rule_id, source_entity, source_id, event_key)
);

create index if not exists workflow_automation_runs_recent_idx
  on public.workflow_automation_runs (created_at desc);

alter table public.shared_dashboards enable row level security;
alter table public.workflow_automation_rules enable row level security;
alter table public.workflow_automation_runs enable row level security;

drop policy if exists shared_dashboards_visible on public.shared_dashboards;
create policy shared_dashboards_visible
on public.shared_dashboards
for select
to authenticated
using (
  public.current_app_user_id() is not null
  and (
    public.current_app_role() = 'admin'
    or (
      active
      and role_scope = public.current_app_role()
      and (
        branch_scope is null
        or branch_scope = public.current_app_branch()
        or branch_scope = 'national'
      )
    )
  )
);

drop policy if exists shared_dashboards_admin_manage on public.shared_dashboards;
create policy shared_dashboards_admin_manage
on public.shared_dashboards
for all
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists workflow_automation_rules_admin on public.workflow_automation_rules;
create policy workflow_automation_rules_admin
on public.workflow_automation_rules
for all
to authenticated
using (public.current_app_role() = 'admin')
with check (public.current_app_role() = 'admin');

drop policy if exists workflow_automation_runs_admin on public.workflow_automation_runs;
create policy workflow_automation_runs_admin
on public.workflow_automation_runs
for select
to authenticated
using (public.current_app_role() = 'admin');

create or replace function public.list_shared_dashboards(
  p_workspace_key text default 'role_dashboard',
  p_include_all boolean default false
)
returns table (
  id uuid,
  workspace_key text,
  name text,
  description text,
  role_scope text,
  branch_scope text,
  is_default boolean,
  active boolean,
  config jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_branch text := public.current_app_branch();
begin
  if v_actor is null or v_role is null then
    raise exception 'Authentication required';
  end if;

  if p_include_all and v_role <> 'admin' then
    raise exception 'Only administrators can list all dashboards' using errcode = '42501';
  end if;

  return query
  select d.id, d.workspace_key, d.name, d.description, d.role_scope, d.branch_scope,
         d.is_default, d.active, d.config, d.created_at, d.updated_at
  from public.shared_dashboards d
  where d.workspace_key = p_workspace_key
    and (
      (p_include_all and v_role = 'admin')
      or (
        d.active
        and d.role_scope = v_role
        and (d.branch_scope is null or d.branch_scope = v_branch or d.branch_scope = 'national')
      )
    )
  order by d.is_default desc, d.branch_scope nulls last, d.name;
end;
$$;

create or replace function public.save_shared_dashboard(
  p_id uuid,
  p_workspace_key text,
  p_name text,
  p_description text,
  p_role_scope text,
  p_branch_scope text,
  p_is_default boolean,
  p_config jsonb,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_widget jsonb;
  v_metric text;
  v_action text;
begin
  if v_actor is null or public.current_app_role() <> 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if p_workspace_key is null or p_workspace_key !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'Invalid workspace key';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null or char_length(trim(p_name)) > 120 then
    raise exception 'Dashboard name is required and must be 120 characters or fewer';
  end if;
  if p_role_scope not in (
    'admin', 'operations', 'warehouse_staff', 'technician', 'road_technician',
    'sales', 'finance', 'marketing', 'executive'
  ) then
    raise exception 'Invalid dashboard role scope';
  end if;
  if p_branch_scope is not null and p_branch_scope not in ('jhb', 'cpt', 'kzn', 'national') then
    raise exception 'Invalid dashboard branch scope';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object'
     or jsonb_typeof(p_config -> 'widgets') <> 'array'
     or jsonb_array_length(p_config -> 'widgets') < 1
     or jsonb_array_length(p_config -> 'widgets') > 12
     or octet_length(p_config::text) > 32768 then
    raise exception 'Dashboard config must contain between 1 and 12 widgets';
  end if;

  for v_widget in select value from jsonb_array_elements(p_config -> 'widgets')
  loop
    if jsonb_typeof(v_widget) <> 'object' or v_widget ->> 'type' <> 'metric' then
      raise exception 'Phase 6 dashboards support metric widgets only';
    end if;
    v_metric := v_widget ->> 'metric';
    if v_metric not in (
      'my_active_work', 'my_overdue_work', 'my_high_priority_work',
      'my_open_service_jobs', 'my_open_deliveries', 'branch_open_work',
      'branch_overdue_work', 'unassigned_work', 'pending_work_approvals',
      'pending_purchase_approvals', 'pending_approvals', 'stock_alerts',
      'open_purchase_orders', 'open_deliveries', 'open_service_jobs',
      'business_users', 'customer_count', 'contract_records',
      'renewals_due_90', 'open_opportunities', 'commercial_accounts',
      'active_campaigns', 'marketing_segments'
    ) then
      raise exception 'Unsupported dashboard metric: %', coalesce(v_metric, '(missing)');
    end if;
    if coalesce(v_widget ->> 'href', '') <> ''
       and (
         left(v_widget ->> 'href', 1) <> '/'
         or left(v_widget ->> 'href', 2) = '//'
         or char_length(v_widget ->> 'href') > 240
       ) then
      raise exception 'Dashboard links must be internal application paths';
    end if;
  end loop;

  if p_is_default and p_active then
    update public.shared_dashboards
    set is_default = false, updated_by = v_actor, updated_at = now()
    where workspace_key = p_workspace_key
      and role_scope = p_role_scope
      and branch_scope is not distinct from p_branch_scope
      and id <> v_id
      and is_default;
  end if;

  if exists (select 1 from public.shared_dashboards where id = v_id) then
    update public.shared_dashboards
    set workspace_key = p_workspace_key,
        name = trim(p_name),
        description = nullif(trim(coalesce(p_description, '')), ''),
        role_scope = p_role_scope,
        branch_scope = p_branch_scope,
        config = p_config,
        is_default = p_is_default,
        active = p_active,
        updated_by = v_actor,
        updated_at = now()
    where id = v_id;
    v_action := 'shared_dashboard_updated';
  else
    insert into public.shared_dashboards (
      id, workspace_key, name, description, role_scope, branch_scope,
      config, is_default, active, created_by, updated_by
    )
    values (
      v_id, p_workspace_key, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
      p_role_scope, p_branch_scope, p_config, p_is_default, p_active, v_actor, v_actor
    );
    v_action := 'shared_dashboard_created';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id, action, summary, after_payload
  )
  values (
    v_actor, 'admin', coalesce(p_branch_scope, 'national'), 'shared_dashboard', v_id,
    v_action, concat(trim(p_name), ' dashboard saved.'),
    jsonb_build_object('role_scope', p_role_scope, 'branch_scope', p_branch_scope, 'active', p_active)
  );

  return v_id;
end;
$$;

create or replace function public.save_workflow_automation_rule(
  p_id uuid,
  p_name text,
  p_description text,
  p_source_entity text,
  p_trigger_event text,
  p_conditions jsonb,
  p_action_config jsonb,
  p_active boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_key text;
  v_due_hours integer;
  v_action text;
begin
  if v_actor is null or public.current_app_role() <> 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_name, '')), '') is null or char_length(trim(p_name)) > 140 then
    raise exception 'Automation name is required and must be 140 characters or fewer';
  end if;
  if p_source_entity not in ('service_job', 'delivery_order', 'purchase_order', 'stock_alert') then
    raise exception 'Invalid automation source';
  end if;
  if p_trigger_event not in ('created', 'status_changed', 'priority_changed', 'assignment_changed', 'threshold_breached') then
    raise exception 'Invalid automation trigger';
  end if;
  if jsonb_typeof(coalesce(p_conditions, '{}'::jsonb)) <> 'object' then
    raise exception 'Automation conditions must be an object';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_conditions, '{}'::jsonb))
  loop
    if v_key not in ('branch', 'status', 'priority', 'approval_status', 'alert_type', 'assigned') then
      raise exception 'Unsupported automation condition: %', v_key;
    end if;
  end loop;
  if jsonb_typeof(p_action_config) <> 'object'
     or nullif(trim(p_action_config ->> 'title'), '') is null
     or char_length(p_action_config ->> 'title') > 180 then
    raise exception 'Automation action requires a work title of 180 characters or fewer';
  end if;
  if coalesce(p_action_config ->> 'work_type', 'task') not in (
    'request', 'task', 'approval', 'inspection', 'maintenance', 'incident'
  ) then
    raise exception 'Invalid automation work type';
  end if;
  if coalesce(p_action_config ->> 'priority', 'medium') not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid automation priority';
  end if;
  begin
    v_due_hours := coalesce((p_action_config ->> 'due_in_hours')::integer, 24);
  exception when others then
    raise exception 'Automation due hours must be an integer';
  end;
  if v_due_hours < 0 or v_due_hours > 2160 then
    raise exception 'Automation due hours must be between 0 and 2160';
  end if;
  if char_length(coalesce(p_action_config ->> 'description', '')) > 2000 then
    raise exception 'Automation description must be 2000 characters or fewer';
  end if;

  if exists (select 1 from public.workflow_automation_rules where id = v_id) then
    update public.workflow_automation_rules
    set name = trim(p_name),
        description = nullif(trim(coalesce(p_description, '')), ''),
        source_entity = p_source_entity,
        trigger_event = p_trigger_event,
        conditions = coalesce(p_conditions, '{}'::jsonb),
        action_config = p_action_config,
        active = p_active,
        updated_by = v_actor,
        updated_at = now()
    where id = v_id;
    v_action := 'workflow_automation_updated';
  else
    insert into public.workflow_automation_rules (
      id, name, description, source_entity, trigger_event,
      conditions, action_config, active, created_by, updated_by
    )
    values (
      v_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
      p_source_entity, p_trigger_event, coalesce(p_conditions, '{}'::jsonb),
      p_action_config, p_active, v_actor, v_actor
    );
    v_action := 'workflow_automation_created';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, entity_type, entity_id, action, summary, after_payload
  )
  values (
    v_actor, 'admin', 'workflow_automation_rule', v_id, v_action,
    concat(trim(p_name), ' automation saved.'),
    jsonb_build_object('source_entity', p_source_entity, 'trigger_event', p_trigger_event, 'active', p_active)
  );

  return v_id;
end;
$$;

create or replace function public.set_workflow_automation_rule_active(
  p_rule_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_name text;
begin
  if v_actor is null or public.current_app_role() <> 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  update public.workflow_automation_rules
  set active = p_active, updated_by = v_actor, updated_at = now()
  where id = p_rule_id
  returning name into v_name;

  if v_name is null then
    raise exception 'Automation rule not found';
  end if;

  insert into public.audit_events (
    actor_user_id, actor_role, entity_type, entity_id, action, summary, after_payload
  )
  values (
    v_actor, 'admin', 'workflow_automation_rule', p_rule_id,
    case when p_active then 'workflow_automation_enabled' else 'workflow_automation_disabled' end,
    concat(v_name, case when p_active then ' automation enabled.' else ' automation disabled.' end),
    jsonb_build_object('active', p_active)
  );
end;
$$;

create or replace function public.list_workflow_automation_rules()
returns table (
  id uuid,
  name text,
  description text,
  source_entity text,
  trigger_event text,
  conditions jsonb,
  action_config jsonb,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  last_run_at timestamptz,
  created_runs bigint,
  failed_runs bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  select r.id, r.name, r.description, r.source_entity, r.trigger_event,
         r.conditions, r.action_config, r.active, r.created_at, r.updated_at,
         max(run.created_at),
         count(*) filter (where run.status = 'created'),
         count(*) filter (where run.status = 'failed')
  from public.workflow_automation_rules r
  left join public.workflow_automation_runs run on run.rule_id = r.id
  group by r.id
  order by r.active desc, r.name;
end;
$$;

create or replace function public.list_workflow_automation_runs(p_limit integer default 50)
returns table (
  id uuid,
  rule_id uuid,
  rule_name text,
  source_entity text,
  source_id uuid,
  trigger_event text,
  status text,
  work_item_id uuid,
  error_message text,
  created_at timestamptz,
  completed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  select run.id, run.rule_id, rule.name, run.source_entity, run.source_id,
         run.trigger_event, run.status, run.work_item_id, run.error_message,
         run.created_at, run.completed_at
  from public.workflow_automation_runs run
  join public.workflow_automation_rules rule on rule.id = run.rule_id
  order by run.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

create or replace function public.automation_conditions_match(
  p_conditions jsonb,
  p_after jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_expected jsonb;
  v_actual text;
begin
  if p_conditions is null or p_conditions = '{}'::jsonb then
    return true;
  end if;

  for v_key, v_expected in select key, value from jsonb_each(p_conditions)
  loop
    if v_key = 'assigned' then
      v_actual := case when nullif(p_after ->> 'assigned_to', '') is null then 'false' else 'true' end;
    else
      v_actual := p_after ->> v_key;
    end if;

    if jsonb_typeof(v_expected) = 'array' then
      if not exists (
        select 1 from jsonb_array_elements_text(v_expected) value
        where value = coalesce(v_actual, '')
      ) then
        return false;
      end if;
    elsif v_expected #>> '{}' <> coalesce(v_actual, '') then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.render_automation_template(
  p_template text,
  p_after jsonb
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              coalesce(p_template, ''),
              '{{source_id}}', coalesce(p_after ->> 'id', '')
            ),
            '{{source_number}}', coalesce(
              p_after ->> 'job_number',
              p_after ->> 'order_number',
              p_after ->> 'po_number',
              p_after ->> 'alert_type',
              p_after ->> 'id',
              ''
            )
          ),
          '{{source_title}}', coalesce(
            p_after ->> 'summary',
            p_after ->> 'customer_name',
            p_after ->> 'supplier_name',
            p_after ->> 'alert_type',
            'Operational record'
          )
        ),
        '{{status}}', coalesce(p_after ->> 'status', p_after ->> 'approval_status', '')
      ),
      '{{priority}}', coalesce(p_after ->> 'priority', '')
    ),
    '{{branch}}', coalesce(p_after ->> 'branch', 'national')
  );
$$;

create or replace function public.execute_workflow_automation_rules(
  p_source_entity text,
  p_source_id uuid,
  p_event_key text,
  p_trigger_event text,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule record;
  v_run_id uuid;
  v_work_id uuid;
  v_work_number text;
  v_branch text;
  v_title text;
  v_description text;
  v_work_type text;
  v_department text;
  v_priority text;
  v_due_hours integer;
  v_approval_required boolean;
  v_requested_by uuid;
begin
  for v_rule in
    select *
    from public.workflow_automation_rules
    where active
      and source_entity = p_source_entity
      and trigger_event = p_trigger_event
    order by created_at, id
  loop
    if not public.automation_conditions_match(v_rule.conditions, p_after) then
      continue;
    end if;

    v_run_id := null;
    insert into public.workflow_automation_runs (
      rule_id, source_entity, source_id, event_key, trigger_event, status, source_snapshot
    )
    values (
      v_rule.id, p_source_entity, p_source_id, p_event_key, p_trigger_event, 'processing', p_after
    )
    on conflict (rule_id, source_entity, source_id, event_key) do nothing
    returning id into v_run_id;

    if v_run_id is null then
      continue;
    end if;

    begin
      v_branch := case
        when p_after ->> 'branch' in ('jhb', 'cpt', 'kzn', 'national') then p_after ->> 'branch'
        else 'national'
      end;
      v_title := trim(public.render_automation_template(v_rule.action_config ->> 'title', p_after));
      v_description := nullif(trim(public.render_automation_template(v_rule.action_config ->> 'description', p_after)), '');
      v_work_type := coalesce(v_rule.action_config ->> 'work_type', 'task');
      v_department := coalesce(nullif(trim(v_rule.action_config ->> 'department'), ''), 'operations');
      v_priority := coalesce(v_rule.action_config ->> 'priority', 'medium');
      v_due_hours := coalesce((v_rule.action_config ->> 'due_in_hours')::integer, 24);
      v_approval_required := coalesce((v_rule.action_config ->> 'approval_required')::boolean, false);
      v_requested_by := coalesce(public.current_app_user_id(), v_rule.created_by);
      v_work_id := gen_random_uuid();
      v_work_number := concat(
        'WK-', upper(v_branch), '-', to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'),
        '-', upper(substr(v_work_id::text, 1, 4))
      );

      insert into public.work_items (
        id, work_number, title, description, work_type, department, branch,
        status, priority, requested_by, assigned_to, customer_id, site_id,
        machine_id, stock_item_id, due_at, approval_required, approval_status
      )
      values (
        v_work_id, v_work_number, v_title, v_description, v_work_type, v_department,
        v_branch, 'new', v_priority, v_requested_by, null,
        case when nullif(p_after ->> 'customer_id', '') is null then null else (p_after ->> 'customer_id')::uuid end,
        case when nullif(p_after ->> 'site_id', '') is null then null else (p_after ->> 'site_id')::uuid end,
        case when nullif(p_after ->> 'machine_id', '') is null then null else (p_after ->> 'machine_id')::uuid end,
        case when nullif(p_after ->> 'stock_item_id', '') is null then null else (p_after ->> 'stock_item_id')::uuid end,
        now() + make_interval(hours => v_due_hours),
        v_approval_required,
        case when v_approval_required then 'pending' else 'not_required' end
      );

      insert into public.audit_events (
        actor_user_id, actor_role, branch, entity_type, entity_id, action, summary, metadata
      )
      values (
        v_requested_by, 'automation', v_branch, 'work_item', v_work_id,
        'automation_work_item_created',
        concat(v_work_number, ' created by automation: ', v_title),
        jsonb_build_object(
          'rule_id', v_rule.id, 'source_entity', p_source_entity,
          'source_id', p_source_id, 'trigger_event', p_trigger_event
        )
      );

      update public.workflow_automation_runs
      set status = 'created', work_item_id = v_work_id, completed_at = now()
      where id = v_run_id;
    exception when others then
      update public.workflow_automation_runs
      set status = 'failed', error_message = left(sqlerrm, 2000), completed_at = now()
      where id = v_run_id;
    end;
  end loop;
end;
$$;

create or replace function public.workflow_automation_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_entity text := tg_argv[0];
  v_before jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_after jsonb := to_jsonb(new);
  v_source_id uuid := (v_after ->> 'id')::uuid;
  v_current numeric;
  v_threshold numeric;
  v_previous numeric;
  v_previous_threshold numeric;
begin
  if tg_op = 'INSERT' then
    perform public.execute_workflow_automation_rules(
      v_source_entity, v_source_id, 'created', 'created', v_after
    );

    if v_source_entity = 'stock_alert' then
      v_current := coalesce((v_after ->> 'current_quantity')::numeric, 0);
      v_threshold := coalesce((v_after ->> 'threshold')::numeric, 0);
      if v_current <= v_threshold then
        perform public.execute_workflow_automation_rules(
          v_source_entity, v_source_id,
          concat('threshold:', v_current, ':', v_threshold, ':', coalesce(v_after ->> 'updated_at', clock_timestamp()::text)),
          'threshold_breached', v_after
        );
      end if;
    end if;
    return new;
  end if;

  if v_after ->> 'status' is distinct from v_before ->> 'status' then
    perform public.execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('status:', coalesce(v_before ->> 'status', ''), '->', coalesce(v_after ->> 'status', '')),
      'status_changed', v_after
    );
  end if;

  if v_source_entity = 'purchase_order'
     and v_after ->> 'approval_status' is distinct from v_before ->> 'approval_status' then
    perform public.execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('approval_status:', coalesce(v_before ->> 'approval_status', ''), '->', coalesce(v_after ->> 'approval_status', '')),
      'status_changed', v_after
    );
  end if;

  if v_source_entity = 'service_job'
     and v_after ->> 'priority' is distinct from v_before ->> 'priority' then
    perform public.execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('priority:', coalesce(v_before ->> 'priority', ''), '->', coalesce(v_after ->> 'priority', '')),
      'priority_changed', v_after
    );
  end if;

  if v_source_entity in ('service_job', 'delivery_order')
     and v_after ->> 'assigned_to' is distinct from v_before ->> 'assigned_to' then
    perform public.execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('assignment:', coalesce(v_before ->> 'assigned_to', ''), '->', coalesce(v_after ->> 'assigned_to', '')),
      'assignment_changed', v_after
    );
  end if;

  if v_source_entity = 'stock_alert' then
    v_current := coalesce((v_after ->> 'current_quantity')::numeric, 0);
    v_threshold := coalesce((v_after ->> 'threshold')::numeric, 0);
    v_previous := coalesce((v_before ->> 'current_quantity')::numeric, 0);
    v_previous_threshold := coalesce((v_before ->> 'threshold')::numeric, 0);

    if v_current <= v_threshold
       and (v_previous > v_previous_threshold or v_threshold is distinct from v_previous_threshold) then
      perform public.execute_workflow_automation_rules(
        v_source_entity, v_source_id,
        concat('threshold:', v_current, ':', v_threshold, ':', coalesce(v_after ->> 'updated_at', clock_timestamp()::text)),
        'threshold_breached', v_after
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists workflow_automation_service_jobs on public.service_jobs;
create trigger workflow_automation_service_jobs
after insert or update on public.service_jobs
for each row execute function public.workflow_automation_trigger('service_job');

drop trigger if exists workflow_automation_delivery_orders on public.delivery_orders;
create trigger workflow_automation_delivery_orders
after insert or update on public.delivery_orders
for each row execute function public.workflow_automation_trigger('delivery_order');

drop trigger if exists workflow_automation_purchase_orders on public.purchase_orders;
create trigger workflow_automation_purchase_orders
after insert or update on public.purchase_orders
for each row execute function public.workflow_automation_trigger('purchase_order');

drop trigger if exists workflow_automation_stock_alerts on public.stock_alerts;
create trigger workflow_automation_stock_alerts
after insert or update on public.stock_alerts
for each row execute function public.workflow_automation_trigger('stock_alert');

with dashboard_defaults(role_scope, name, description, metrics) as (
  values
    ('admin', 'Administrator overview', 'Access, approvals and national pressure.',
      array['branch_open_work','pending_approvals','stock_alerts','business_users','customer_count']),
    ('operations', 'Operations command board', 'Branch workload, dispatch and service exceptions.',
      array['branch_open_work','branch_overdue_work','unassigned_work','open_service_jobs','open_deliveries']),
    ('warehouse_staff', 'Warehouse pulse', 'Stock, receiving and warehouse work pressure.',
      array['stock_alerts','open_purchase_orders','open_deliveries','my_active_work']),
    ('technician', 'Technician day board', 'Assigned service work and evidence priorities.',
      array['my_active_work','my_overdue_work','my_open_service_jobs','my_high_priority_work']),
    ('road_technician', 'Road service day', 'Routes, deliveries and field service.',
      array['my_active_work','my_overdue_work','my_open_deliveries','my_open_service_jobs']),
    ('sales', 'Sales account focus', 'Pipeline, renewals and customer follow-up.',
      array['customer_count','open_opportunities','renewals_due_90','my_active_work']),
    ('finance', 'Finance control board', 'Approvals, accounts and service coverage.',
      array['commercial_accounts','pending_purchase_approvals','pending_work_approvals','my_active_work']),
    ('marketing', 'Marketing momentum', 'Campaign, segment and renewal coverage.',
      array['active_campaigns','marketing_segments','renewals_due_90','customer_count']),
    ('executive', 'Executive overview', 'National operating pressure and commercial exposure.',
      array['branch_open_work','pending_approvals','stock_alerts','open_service_jobs','renewals_due_90'])
)
insert into public.shared_dashboards (
  workspace_key, name, description, role_scope, config, is_default, active
)
select
  'role_dashboard',
  defaults.name,
  defaults.description,
  defaults.role_scope,
  jsonb_build_object(
    'columns', 3,
    'widgets', (
      select jsonb_agg(
        jsonb_build_object(
          'id', concat('metric-', metric.ordinality),
          'type', 'metric',
          'title', initcap(replace(metric.value, '_', ' ')),
          'metric', metric.value,
          'href', '/work'
        )
        order by metric.ordinality
      )
      from unnest(defaults.metrics) with ordinality as metric(value, ordinality)
    )
  ),
  true,
  true
from dashboard_defaults defaults
on conflict do nothing;

revoke all on function public.current_app_branch() from public;
revoke all on function public.list_shared_dashboards(text, boolean) from public;
revoke all on function public.save_shared_dashboard(uuid, text, text, text, text, text, boolean, jsonb, boolean) from public;
revoke all on function public.save_workflow_automation_rule(uuid, text, text, text, text, jsonb, jsonb, boolean) from public;
revoke all on function public.set_workflow_automation_rule_active(uuid, boolean) from public;
revoke all on function public.list_workflow_automation_rules() from public;
revoke all on function public.list_workflow_automation_runs(integer) from public;
revoke all on function public.automation_conditions_match(jsonb, jsonb) from public;
revoke all on function public.render_automation_template(text, jsonb) from public;
revoke all on function public.execute_workflow_automation_rules(text, uuid, text, text, jsonb) from public;
revoke all on function public.workflow_automation_trigger() from public;

grant execute on function public.current_app_branch() to authenticated;
grant execute on function public.list_shared_dashboards(text, boolean) to authenticated;
grant execute on function public.save_shared_dashboard(uuid, text, text, text, text, text, boolean, jsonb, boolean) to authenticated;
grant execute on function public.save_workflow_automation_rule(uuid, text, text, text, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.set_workflow_automation_rule_active(uuid, boolean) to authenticated;
grant execute on function public.list_workflow_automation_rules() to authenticated;
grant execute on function public.list_workflow_automation_runs(integer) to authenticated;

revoke all on public.shared_dashboards from anon;
revoke all on public.workflow_automation_rules from anon;
revoke all on public.workflow_automation_runs from anon;
grant select on public.shared_dashboards to authenticated;
grant select on public.workflow_automation_rules to authenticated;
grant select on public.workflow_automation_runs to authenticated;
