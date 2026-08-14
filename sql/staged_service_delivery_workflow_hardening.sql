-- STAGED CONTRACT FOR ISSUE #139 — NOT A PRODUCTION MIGRATION.
--
-- This file reconstructs the service and delivery workflow RPC hardening from
-- current main. It is executed only against the disposable PostgreSQL service
-- in CI. Production must not receive this DDL until the staged contract has
-- passed CI and an explicit production migration/promotion step is approved.

create or replace function public.assign_service_job(job_id uuid, assignee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_job_branch text;
  v_old_status text;
  v_old_assignee uuid;
  v_assignee_branch text;
begin
  if v_actor is null or v_actor_role is null or v_actor_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may assign service jobs'
      using errcode = '42501';
  end if;

  select d.branch
    into v_actor_branch
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
     and v_actor_branch <> 'national'
     and v_job_branch <> v_actor_branch then
    raise exception 'Operations Managers may only assign service jobs in their branch'
      using errcode = '42501';
  end if;

  if v_old_status not in ('new', 'assigned', 'in_progress') then
    raise exception 'Completed, verified, closed or cancelled service jobs cannot be reassigned';
  end if;

  if assignee_id is null then
    if v_old_status = 'in_progress' then
      raise exception 'An in-progress service job cannot be unassigned';
    end if;

    if v_old_assignee is null and v_old_status = 'new' then
      return;
    end if;
  else
    select d.branch
      into v_assignee_branch
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.id = assignee_id
      and u.is_active = true
      and d.role in ('technician', 'road_technician');

    if not found then
      raise exception 'Select an active technician or road technician';
    end if;

    if v_job_branch <> 'national'
       and v_assignee_branch not in (v_job_branch, 'national') then
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
      updated_at = pg_catalog.now()
  where id = job_id;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    branch,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload
  ) values (
    v_actor,
    v_actor_role,
    v_job_branch,
    'service_job',
    job_id,
    'service_job_assigned',
    'Service job assignment updated.',
    pg_catalog.jsonb_build_object(
      'status', v_old_status,
      'assigned_to', v_old_assignee
    ),
    pg_catalog.jsonb_build_object(
      'status', case
        when assignee_id is null then 'new'
        when v_old_status = 'new' then 'assigned'
        else v_old_status
      end,
      'assigned_to', assignee_id
    )
  );
end;
$function$;

create or replace function public.transition_service_job(job_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_job_branch text;
  v_old_status text;
  v_assigned_user uuid;
  v_assignee_active boolean;
  v_assignee_role text;
  v_assignee_branch text;
  v_valid_transition boolean := false;
begin
  if v_actor is null or v_actor_role is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if new_status not in ('new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled') then
    raise exception 'Invalid service-job status';
  end if;

  select d.branch
    into v_actor_branch
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
       and v_actor_branch <> 'national'
       and v_job_branch <> v_actor_branch then
      raise exception 'Operations Managers may only update service jobs in their branch'
        using errcode = '42501';
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

  if new_status in ('assigned', 'in_progress', 'completed') then
    if v_assigned_user is null then
      raise exception 'Assign a technician before moving this service job to %', new_status;
    end if;

    select u.is_active, d.role, d.branch
      into v_assignee_active, v_assignee_role, v_assignee_branch
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.id = v_assigned_user;

    if not found
       or v_assignee_active is distinct from true
       or v_assignee_role not in ('technician', 'road_technician') then
      raise exception 'The assigned technician is not active and eligible for this workflow';
    end if;

    if v_job_branch <> 'national'
       and v_assignee_branch not in (v_job_branch, 'national') then
      raise exception 'The assigned technician belongs to a different branch';
    end if;
  end if;

  update public.service_jobs
  set status = new_status,
      completed_at = case
        when new_status = 'completed' then coalesce(completed_at, pg_catalog.now())
        else completed_at
      end,
      updated_at = pg_catalog.now()
  where id = job_id;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    branch,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload
  ) values (
    v_actor,
    v_actor_role,
    v_job_branch,
    'service_job',
    job_id,
    'service_job_status_changed',
    pg_catalog.format('Service job changed from %s to %s.', v_old_status, new_status),
    pg_catalog.jsonb_build_object(
      'status', v_old_status,
      'assigned_to', v_assigned_user
    ),
    pg_catalog.jsonb_build_object(
      'status', new_status,
      'assigned_to', v_assigned_user
    )
  );
end;
$function$;

create or replace function public.close_service_job(job_id uuid, remarks text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_job_branch text;
  v_old_status text;
  v_old_assignee uuid;
  v_old_closed_at timestamptz;
  v_old_remarks text;
  v_closed_at timestamptz := pg_catalog.now();
  v_remarks text := nullif(pg_catalog.btrim(coalesce(remarks, '')), '');
begin
  if v_actor is null or v_actor_role is null or v_actor_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may close service jobs'
      using errcode = '42501';
  end if;

  select d.branch
    into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  select sj.branch, sj.status, sj.assigned_to, sj.closed_at, sj.closing_remarks
    into v_job_branch, v_old_status, v_old_assignee, v_old_closed_at, v_old_remarks
  from public.service_jobs sj
  where sj.id = job_id
  for update;

  if not found then
    raise exception 'Service job not found';
  end if;

  if v_actor_role = 'operations'
     and v_actor_branch <> 'national'
     and v_job_branch <> v_actor_branch then
    raise exception 'Operations Managers may only close service jobs in their branch'
      using errcode = '42501';
  end if;

  if v_old_status <> 'verified' then
    raise exception 'Only verified service jobs may be closed';
  end if;

  update public.service_jobs
  set status = 'closed',
      closed_by = v_actor,
      closed_at = v_closed_at,
      closing_remarks = v_remarks,
      updated_at = v_closed_at
  where id = job_id;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    branch,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload
  ) values (
    v_actor,
    v_actor_role,
    v_job_branch,
    'service_job',
    job_id,
    'service_job_closed',
    'Verified service job closed.',
    pg_catalog.jsonb_build_object(
      'status', v_old_status,
      'assigned_to', v_old_assignee,
      'closed_at', v_old_closed_at,
      'closing_remarks', v_old_remarks
    ),
    pg_catalog.jsonb_build_object(
      'status', 'closed',
      'assigned_to', v_old_assignee,
      'closed_by', v_actor,
      'closed_at', v_closed_at,
      'closing_remarks', v_remarks
    )
  );
end;
$function$;

create or replace function public.transition_delivery_order(order_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_order_branch text;
  v_old_status text;
  v_assigned_user uuid;
  v_valid_transition boolean := false;
  v_transitioned_at timestamptz := pg_catalog.now();
begin
  if v_actor is null or v_actor_role is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if new_status not in ('draft', 'picked', 'dispatched', 'delivered', 'closed', 'cancelled') then
    raise exception 'Invalid delivery-order status';
  end if;

  select d.branch
    into v_actor_branch
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
       and v_actor_branch <> 'national'
       and v_order_branch <> v_actor_branch then
      raise exception 'Operations Managers may only update delivery orders in their branch'
        using errcode = '42501';
    end if;

    v_valid_transition :=
      (v_old_status = 'draft' and new_status in ('picked', 'cancelled'))
      or (v_old_status = 'picked' and new_status in ('dispatched', 'cancelled'))
      or (v_old_status = 'dispatched' and new_status in ('delivered', 'cancelled'))
      or (v_old_status = 'delivered' and new_status = 'closed');
  elsif v_actor_role = 'warehouse_staff' then
    if v_actor_branch <> 'national'
       and v_order_branch <> v_actor_branch then
      raise exception 'Warehouse staff may only update delivery orders in their branch'
        using errcode = '42501';
    end if;

    v_valid_transition := v_old_status = 'draft' and new_status = 'picked';
  elsif v_actor_role = 'road_technician' then
    if v_assigned_user is distinct from v_actor then
      raise exception 'This delivery order is not assigned to you' using errcode = '42501';
    end if;

    if v_order_branch <> 'national'
       and v_actor_branch not in (v_order_branch, 'national') then
      raise exception 'Road technicians may only update assigned delivery orders in their branch'
        using errcode = '42501';
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
      status_updated_at = v_transitioned_at,
      status_updated_by = v_actor,
      dispatched_at = case
        when new_status = 'dispatched' then coalesce(dispatched_at, v_transitioned_at)
        else dispatched_at
      end,
      delivered_at = case
        when new_status = 'delivered' then coalesce(delivered_at, v_transitioned_at)
        else delivered_at
      end,
      closed_at = case
        when new_status = 'closed' then coalesce(closed_at, v_transitioned_at)
        else closed_at
      end,
      updated_at = v_transitioned_at
  where id = order_id;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    branch,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload
  ) values (
    v_actor,
    v_actor_role,
    v_order_branch,
    'delivery_order',
    order_id,
    'delivery_status_changed',
    pg_catalog.format('Delivery order changed from %s to %s.', v_old_status, new_status),
    pg_catalog.jsonb_build_object(
      'status', v_old_status,
      'assigned_to', v_assigned_user
    ),
    pg_catalog.jsonb_build_object(
      'status', new_status,
      'assigned_to', v_assigned_user
    )
  );
end;
$function$;

revoke all on function public.assign_service_job(uuid, uuid) from PUBLIC;
revoke all on function public.transition_service_job(uuid, text) from PUBLIC;
revoke all on function public.close_service_job(uuid, text) from PUBLIC;
revoke all on function public.transition_delivery_order(uuid, text) from PUBLIC;

revoke execute on function public.assign_service_job(uuid, uuid) from anon;
revoke execute on function public.transition_service_job(uuid, text) from anon;
revoke execute on function public.close_service_job(uuid, text) from anon;
revoke execute on function public.transition_delivery_order(uuid, text) from anon;

grant execute on function public.assign_service_job(uuid, uuid) to authenticated, service_role;
grant execute on function public.transition_service_job(uuid, text) to authenticated, service_role;
grant execute on function public.close_service_job(uuid, text) to authenticated, service_role;
grant execute on function public.transition_delivery_order(uuid, text) to authenticated, service_role;
