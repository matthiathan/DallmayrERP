-- Restore service/delivery RPCs that are used by the application but were not
-- represented in repository migrations, and enforce the same transition and
-- authentication boundaries at the database layer.

-- The UI and live database support a terminal `closed` delivery state, but the
-- foundational SQL did not record the related columns or check constraint.
alter table public.delivery_orders
  add column if not exists closed_at timestamptz,
  add column if not exists status_updated_at timestamptz not null default now(),
  add column if not exists status_updated_by uuid references public.users(id) on delete set null;

alter table public.delivery_orders
  drop constraint if exists delivery_orders_status_check;

alter table public.delivery_orders
  add constraint delivery_orders_status_check
  check (status in ('draft', 'picked', 'dispatched', 'delivered', 'closed', 'cancelled'));

create or replace function public.assign_service_job(job_id uuid, assignee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_job_branch text;
  v_old_status text;
  v_old_assignee uuid;
  v_assignee_branch text;
begin
  if v_actor is null or v_actor_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may assign service jobs' using errcode = '42501';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  select sj.branch, sj.status, sj.assigned_to
    into v_job_branch, v_old_status, v_old_assignee
  from public.service_jobs sj
  where sj.id = job_id
  for update;

  if not found then
    raise exception 'Service job not found';
  end if;

  if v_actor_role = 'operations'
     and coalesce(v_actor_branch, 'national') <> 'national'
     and v_job_branch <> v_actor_branch then
    raise exception 'Operations Managers may only assign service jobs in their branch' using errcode = '42501';
  end if;

  if v_old_status not in ('new', 'assigned', 'in_progress') then
    raise exception 'Completed, verified, closed or cancelled service jobs cannot be reassigned';
  end if;

  if assignee_id is null then
    if v_old_status = 'in_progress' then
      raise exception 'An in-progress service job cannot be unassigned';
    end if;
    if v_old_assignee is null then
      return;
    end if;
  else
    select d.branch into v_assignee_branch
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.id = assignee_id
      and u.is_active = true
      and d.role in ('technician', 'road_technician');

    if not found then
      raise exception 'Select an active technician or road technician';
    end if;

    if v_job_branch <> 'national'
       and coalesce(v_assignee_branch, 'national') <> 'national'
       and v_assignee_branch <> v_job_branch then
      raise exception 'The selected technician is assigned to a different branch';
    end if;

    if v_old_assignee is not distinct from assignee_id then
      return;
    end if;
  end if;

  update public.service_jobs
  set assigned_to = assignee_id,
      status = case
        when assignee_id is null then 'new'
        when v_old_status = 'new' then 'assigned'
        else v_old_status
      end,
      updated_at = now()
  where id = job_id;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id, action, summary,
    before_payload, after_payload
  ) values (
    v_actor, v_actor_role, v_job_branch, 'service_job', job_id, 'service_job_assigned',
    'Service job assignment updated.',
    jsonb_build_object('status', v_old_status, 'assigned_to', v_old_assignee),
    jsonb_build_object(
      'status', case
        when assignee_id is null then 'new'
        when v_old_status = 'new' then 'assigned'
        else v_old_status
      end,
      'assigned_to', assignee_id
    )
  );
end;
$$;

create or replace function public.transition_service_job(job_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_job_branch text;
  v_old_status text;
  v_assigned_user uuid;
  v_valid_transition boolean := false;
begin
  if v_actor is null or v_actor_role is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if new_status not in ('new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled') then
    raise exception 'Invalid service-job status';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  select sj.branch, sj.status, sj.assigned_to
    into v_job_branch, v_old_status, v_assigned_user
  from public.service_jobs sj
  where sj.id = job_id
  for update;

  if not found then
    raise exception 'Service job not found';
  end if;

  if v_old_status = new_status then
    return;
  end if;

  if v_actor_role in ('admin', 'operations') then
    if v_actor_role = 'operations'
       and coalesce(v_actor_branch, 'national') <> 'national'
       and v_job_branch <> v_actor_branch then
      raise exception 'Operations Managers may only update service jobs in their branch' using errcode = '42501';
    end if;

    v_valid_transition :=
      (v_old_status = 'new' and new_status in ('assigned', 'cancelled'))
      or (v_old_status = 'assigned' and new_status in ('in_progress', 'cancelled'))
      or (v_old_status = 'in_progress' and new_status in ('completed', 'cancelled'))
      or (v_old_status = 'completed' and new_status = 'verified');
  elsif v_actor_role in ('technician', 'road_technician') then
    if v_assigned_user is distinct from v_actor then
      raise exception 'This service job is not assigned to you' using errcode = '42501';
    end if;
    v_valid_transition :=
      (v_old_status = 'assigned' and new_status = 'in_progress')
      or (v_old_status = 'in_progress' and new_status = 'completed');
  else
    raise exception 'You are not authorised to update service jobs' using errcode = '42501';
  end if;

  if not v_valid_transition then
    raise exception 'Invalid service-job transition from % to %', v_old_status, new_status;
  end if;

  if new_status in ('assigned', 'in_progress') and v_assigned_user is null then
    raise exception 'Assign a technician before moving this service job to %', new_status;
  end if;

  update public.service_jobs
  set status = new_status,
      completed_at = case when new_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
      updated_at = now()
  where id = job_id;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id, action, summary,
    before_payload, after_payload
  ) values (
    v_actor, v_actor_role, v_job_branch, 'service_job', job_id, 'service_job_status_changed',
    format('Service job changed from %s to %s.', v_old_status, new_status),
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', new_status)
  );
end;
$$;

create or replace function public.close_service_job(job_id uuid, remarks text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_job_branch text;
  v_old_status text;
begin
  if v_actor is null or v_actor_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may close service jobs' using errcode = '42501';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  select sj.branch, sj.status into v_job_branch, v_old_status
  from public.service_jobs sj
  where sj.id = job_id
  for update;

  if not found then
    raise exception 'Service job not found';
  end if;

  if v_actor_role = 'operations'
     and coalesce(v_actor_branch, 'national') <> 'national'
     and v_job_branch <> v_actor_branch then
    raise exception 'Operations Managers may only close service jobs in their branch' using errcode = '42501';
  end if;

  if v_old_status <> 'verified' then
    raise exception 'Only verified service jobs may be closed';
  end if;

  update public.service_jobs
  set status = 'closed',
      closed_by = v_actor,
      closed_at = now(),
      closing_remarks = nullif(trim(coalesce(remarks, '')), ''),
      updated_at = now()
  where id = job_id;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id, action, summary,
    before_payload, after_payload
  ) values (
    v_actor, v_actor_role, v_job_branch, 'service_job', job_id, 'service_job_closed',
    'Verified service job closed.',
    jsonb_build_object('status', v_old_status),
    jsonb_build_object(
      'status', 'closed',
      'closed_by', v_actor,
      'closing_remarks', nullif(trim(coalesce(remarks, '')), '')
    )
  );
end;
$$;

create or replace function public.transition_delivery_order(order_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_order_branch text;
  v_old_status text;
  v_assigned_user uuid;
  v_valid_transition boolean := false;
begin
  if v_actor is null or v_actor_role is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if new_status not in ('draft', 'picked', 'dispatched', 'delivered', 'closed', 'cancelled') then
    raise exception 'Invalid delivery-order status';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  select d.branch, d.status, d.assigned_to
    into v_order_branch, v_old_status, v_assigned_user
  from public.delivery_orders d
  where d.id = order_id
  for update;

  if not found then
    raise exception 'Delivery order not found';
  end if;

  if v_old_status = new_status then
    return;
  end if;

  if v_actor_role in ('admin', 'operations') then
    if v_actor_role = 'operations'
       and coalesce(v_actor_branch, 'national') <> 'national'
       and v_order_branch <> v_actor_branch then
      raise exception 'Operations Managers may only update delivery orders in their branch' using errcode = '42501';
    end if;
    v_valid_transition :=
      (v_old_status = 'draft' and new_status in ('picked', 'cancelled'))
      or (v_old_status = 'picked' and new_status in ('dispatched', 'cancelled'))
      or (v_old_status = 'dispatched' and new_status in ('delivered', 'cancelled'))
      or (v_old_status = 'delivered' and new_status = 'closed');
  elsif v_actor_role = 'warehouse_staff' then
    if coalesce(v_actor_branch, 'national') <> 'national' and v_order_branch <> v_actor_branch then
      raise exception 'Warehouse staff may only update delivery orders in their branch' using errcode = '42501';
    end if;
    v_valid_transition := v_old_status = 'draft' and new_status = 'picked';
  elsif v_actor_role = 'road_technician' then
    if v_assigned_user is distinct from v_actor then
      raise exception 'This delivery order is not assigned to you' using errcode = '42501';
    end if;
    v_valid_transition :=
      (v_old_status = 'picked' and new_status = 'dispatched')
      or (v_old_status = 'dispatched' and new_status = 'delivered');
  else
    raise exception 'You are not authorised to update delivery orders' using errcode = '42501';
  end if;

  if not v_valid_transition then
    raise exception 'Invalid delivery-order transition from % to %', v_old_status, new_status;
  end if;

  update public.delivery_orders
  set status = new_status,
      dispatched_at = case when new_status = 'dispatched' then coalesce(dispatched_at, now()) else dispatched_at end,
      delivered_at = case when new_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      closed_at = case when new_status = 'closed' then coalesce(closed_at, now()) else closed_at end,
      status_updated_at = now(),
      status_updated_by = v_actor,
      updated_at = now()
  where id = order_id;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id, action, summary,
    before_payload, after_payload
  ) values (
    v_actor, v_actor_role, v_order_branch, 'delivery_order', order_id, 'delivery_status_changed',
    format('Delivery order changed from %s to %s.', v_old_status, new_status),
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', new_status)
  );
end;
$$;

-- Security-definer RPCs must never be executable through the anonymous role.
revoke all on function public.assign_service_job(uuid, uuid) from public;
revoke all on function public.transition_service_job(uuid, text) from public;
revoke all on function public.close_service_job(uuid, text) from public;
revoke all on function public.transition_delivery_order(uuid, text) from public;
revoke execute on function public.assign_service_job(uuid, uuid) from anon;
revoke execute on function public.transition_service_job(uuid, text) from anon;
revoke execute on function public.close_service_job(uuid, text) from anon;
revoke execute on function public.transition_delivery_order(uuid, text) from anon;
grant execute on function public.assign_service_job(uuid, uuid) to authenticated, service_role;
grant execute on function public.transition_service_job(uuid, text) to authenticated, service_role;
grant execute on function public.close_service_job(uuid, text) to authenticated, service_role;
grant execute on function public.transition_delivery_order(uuid, text) to authenticated, service_role;

-- This existing client mutation already performs role checks; align its search
-- path and execution ACL with the hardened RPC contract.
alter function public.create_work_item(
  text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean
) set search_path = public, pg_temp;
revoke all on function public.create_work_item(
  text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean
) from public;
revoke execute on function public.create_work_item(
  text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean
) from anon;
grant execute on function public.create_work_item(
  text, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean
) to authenticated, service_role;

-- The browser application never invokes RPCs before a Supabase Auth session is
-- established. Remove anonymous execution from every RPC currently referenced
-- by the client so later function replacements cannot silently reopen it.
do $$
declare
  v_function record;
  v_client_rpcs constant text[] := array[
    'admin_create_user_access', 'admin_delete_user_access', 'admin_list_user_access',
    'admin_update_user_access', 'apply_checklist_template', 'apply_stock_transaction',
    'assign_daily_service_item', 'assign_service_job', 'assign_work_item',
    'claim_current_app_user', 'close_service_job', 'complete_assigned_service_job',
    'consume_work_part', 'create_complete_maintenance_plan',
    'create_delivery_order_from_scans', 'create_replenishment_purchase_order',
    'create_service_call_log', 'create_work_item', 'generate_due_maintenance_work',
    'get_customer_form_defaults', 'get_finance_workspace_summary',
    'get_inventory_planning_summary', 'get_marketing_segment_summary',
    'get_master_data_quality_summary', 'get_operations_manager_report_summary',
    'get_role_workspace_summary', 'get_sales_workspace_summary', 'issue_stock_lot',
    'issue_stock_serial', 'list_assignable_technicians', 'list_assignable_users',
    'list_customer_service_plans', 'list_daily_service_schedule',
    'list_exception_cases', 'list_exception_comments', 'list_finance_service_coverage',
    'log_work_time', 'receive_purchase_order_line', 'receive_stock_lot',
    'receive_stock_serial', 'record_asset_audit', 'record_asset_downtime',
    'record_asset_meter_reading', 'record_customer_service_payment',
    'reschedule_daily_service_item', 'resolve_stock_barcode', 'review_purchase_order',
    'review_work_item', 'save_customer_service_plan', 'save_work_completion',
    'search_contract_renewals', 'search_finance_accounts',
    'search_inventory_recommendations', 'search_inventory_transfer_suggestions',
    'search_machine_assets', 'search_marketing_segments',
    'search_reliability_machines', 'search_sales_opportunities',
    'submit_purchase_order_for_approval', 'sync_operational_exceptions',
    'transition_delivery_order', 'transition_purchase_order',
    'transition_service_job', 'transition_work_item', 'triage_exception_case',
    'update_asset_custody', 'update_asset_professional_profile', 'update_asset_profile'
  ];
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_client_rpcs)
  loop
    execute format('revoke all on function %s from public', v_function.signature);
    execute format('revoke execute on function %s from anon', v_function.signature);
    execute format('grant execute on function %s to authenticated, service_role', v_function.signature);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
