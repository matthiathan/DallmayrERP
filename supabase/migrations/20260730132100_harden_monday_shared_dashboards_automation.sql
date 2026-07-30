-- Hardening for Phase 6 shared dashboards and automation.

-- A national branch is a real branch scope, not a wildcard. Use NULL for all
-- permitted branches.
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
      and (branch_scope is null or branch_scope = public.current_app_branch())
    )
  )
);

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
        and (d.branch_scope is null or d.branch_scope = v_branch)
      )
    )
  order by d.is_default desc, d.branch_scope nulls first, d.name;
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
  if char_length(coalesce(p_description, '')) > 1000 then
    raise exception 'Dashboard description must be 1000 characters or fewer';
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
  if coalesce(jsonb_typeof(p_config), 'null') <> 'object'
     or coalesce(jsonb_typeof(p_config -> 'widgets'), 'null') <> 'array'
     or jsonb_array_length(p_config -> 'widgets') < 1
     or jsonb_array_length(p_config -> 'widgets') > 12
     or octet_length(p_config::text) > 32768 then
    raise exception 'Dashboard config must contain between 1 and 12 widgets';
  end if;

  for v_widget in select value from jsonb_array_elements(p_config -> 'widgets')
  loop
    if coalesce(jsonb_typeof(v_widget), 'null') <> 'object'
       or coalesce(v_widget ->> 'type', '') <> 'metric' then
      raise exception 'Phase 6 dashboards support metric widgets only';
    end if;
    v_metric := v_widget ->> 'metric';
    if v_metric is null or v_metric not in (
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
    if char_length(coalesce(v_widget ->> 'title', '')) > 120 then
      raise exception 'Dashboard widget titles must be 120 characters or fewer';
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
  if char_length(coalesce(p_description, '')) > 1000 then
    raise exception 'Automation description must be 1000 characters or fewer';
  end if;
  if not (
    (p_source_entity = 'service_job' and p_trigger_event in ('created', 'status_changed', 'priority_changed', 'assignment_changed'))
    or (p_source_entity = 'delivery_order' and p_trigger_event in ('created', 'status_changed', 'assignment_changed'))
    or (p_source_entity = 'purchase_order' and p_trigger_event in ('created', 'status_changed'))
    or (p_source_entity = 'stock_alert' and p_trigger_event in ('created', 'status_changed', 'threshold_breached'))
  ) then
    raise exception 'This trigger is not supported for the selected source';
  end if;
  if coalesce(jsonb_typeof(p_conditions), 'null') <> 'object' then
    raise exception 'Automation conditions must be an object';
  end if;
  for v_key in select jsonb_object_keys(p_conditions)
  loop
    if v_key not in ('branch', 'status', 'priority', 'approval_status', 'alert_type', 'assigned') then
      raise exception 'Unsupported automation condition: %', v_key;
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_action_config), 'null') <> 'object'
     or nullif(trim(p_action_config ->> 'title'), '') is null
     or char_length(p_action_config ->> 'title') > 180 then
    raise exception 'Automation action requires a work title of 180 characters or fewer';
  end if;
  if char_length(coalesce(p_action_config ->> 'description', '')) > 2000 then
    raise exception 'Automation description must be 2000 characters or fewer';
  end if;
  if char_length(coalesce(p_action_config ->> 'department', 'operations')) > 80 then
    raise exception 'Automation department must be 80 characters or fewer';
  end if;
  if coalesce(p_action_config ->> 'work_type', 'task') not in (
    'request', 'task', 'approval', 'inspection', 'maintenance', 'incident'
  ) then
    raise exception 'Invalid automation work type';
  end if;
  if coalesce(p_action_config ->> 'priority', 'medium') not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid automation priority';
  end if;
  if p_action_config ? 'approval_required'
     and jsonb_typeof(p_action_config -> 'approval_required') <> 'boolean' then
    raise exception 'Automation approval_required must be boolean';
  end if;
  begin
    v_due_hours := coalesce((p_action_config ->> 'due_in_hours')::integer, 24);
  exception when others then
    raise exception 'Automation due hours must be an integer';
  end;
  if v_due_hours < 0 or v_due_hours > 2160 then
    raise exception 'Automation due hours must be between 0 and 2160';
  end if;

  if exists (select 1 from public.workflow_automation_rules where id = v_id) then
    update public.workflow_automation_rules
    set name = trim(p_name),
        description = nullif(trim(coalesce(p_description, '')), ''),
        source_entity = p_source_entity,
        trigger_event = p_trigger_event,
        conditions = p_conditions,
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
      p_source_entity, p_trigger_event, p_conditions,
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

-- The safe wrapper guarantees automation dispatch cannot abort the transaction
-- that created or changed the source record.
create or replace function public.safe_execute_workflow_automation_rules(
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
begin
  perform public.execute_workflow_automation_rules(
    p_source_entity, p_source_id, p_event_key, p_trigger_event, p_after
  );
exception when others then
  begin
    insert into public.audit_events (
      actor_user_id, actor_role, branch, entity_type, entity_id, action, summary, metadata
    )
    values (
      public.current_app_user_id(), 'automation',
      case when p_after ->> 'branch' in ('jhb', 'cpt', 'kzn', 'national') then p_after ->> 'branch' else 'national' end,
      p_source_entity, p_source_id, 'automation_dispatch_failed',
      left(sqlerrm, 1000),
      jsonb_build_object('event_key', p_event_key, 'trigger_event', p_trigger_event)
    );
  exception when others then
    null;
  end;
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
    perform public.safe_execute_workflow_automation_rules(
      v_source_entity, v_source_id, 'created', 'created', v_after
    );

    if v_source_entity = 'stock_alert' then
      v_current := coalesce((v_after ->> 'current_quantity')::numeric, 0);
      v_threshold := coalesce((v_after ->> 'threshold')::numeric, 0);
      if v_current <= v_threshold then
        perform public.safe_execute_workflow_automation_rules(
          v_source_entity, v_source_id,
          concat('threshold:', v_current, ':', v_threshold, ':', coalesce(v_after ->> 'updated_at', clock_timestamp()::text)),
          'threshold_breached', v_after
        );
      end if;
    end if;
    return new;
  end if;

  if v_after ->> 'status' is distinct from v_before ->> 'status' then
    perform public.safe_execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('status:', coalesce(v_before ->> 'status', ''), '->', coalesce(v_after ->> 'status', '')),
      'status_changed', v_after
    );
  end if;

  if v_source_entity = 'purchase_order'
     and v_after ->> 'approval_status' is distinct from v_before ->> 'approval_status' then
    perform public.safe_execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('approval_status:', coalesce(v_before ->> 'approval_status', ''), '->', coalesce(v_after ->> 'approval_status', '')),
      'status_changed', v_after
    );
  end if;

  if v_source_entity = 'service_job'
     and v_after ->> 'priority' is distinct from v_before ->> 'priority' then
    perform public.safe_execute_workflow_automation_rules(
      v_source_entity, v_source_id,
      concat('priority:', coalesce(v_before ->> 'priority', ''), '->', coalesce(v_after ->> 'priority', '')),
      'priority_changed', v_after
    );
  end if;

  if v_source_entity in ('service_job', 'delivery_order')
     and v_after ->> 'assigned_to' is distinct from v_before ->> 'assigned_to' then
    perform public.safe_execute_workflow_automation_rules(
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
      perform public.safe_execute_workflow_automation_rules(
        v_source_entity, v_source_id,
        concat('threshold:', v_current, ':', v_threshold, ':', coalesce(v_after ->> 'updated_at', clock_timestamp()::text)),
        'threshold_breached', v_after
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.safe_execute_workflow_automation_rules(text, uuid, text, text, jsonb) from public;
