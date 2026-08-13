-- CONTRACT SNAPSHOT ONLY — DO NOT USE AS A PRODUCTION MIGRATION.
--
-- These definitions mirror the live DallmayrERP production RPC surface as inspected
-- read-only on 2026-08-13. They exist so client RPC usage has an auditable repository
-- contract while issue #139 reconstructs and stages the required authorization/state
-- hardening from current main.
--
-- The transaction is always rolled back, so running this file directly with psql
-- validates/parses the snapshot without persisting these known pre-hardening bodies.

begin;

create or replace function public.assign_service_job(job_id uuid, assignee_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  role_name text;
  previous_assignee uuid;
  assignee_role text;
  current_status text;
begin
  role_name := public.current_app_role();
  if role_name not in ('admin','operations') then
    raise exception 'You are not authorised to assign service jobs';
  end if;

  select ud.role into assignee_role
  from public.user_details ud
  where ud.user_id = assignee_id;

  if assignee_role not in ('technician','road_technician') then
    raise exception 'Selected user is not an assignable technician';
  end if;

  select assigned_to, status into previous_assignee, current_status
  from public.service_jobs
  where id = job_id
  for update;

  if current_status is null then
    raise exception 'Service job not found';
  end if;

  update public.service_jobs
  set assigned_to = assignee_id,
      status = case when current_status = 'new' then 'assigned' else current_status end,
      updated_at = now()
  where id = job_id;

  insert into public.audit_events(actor_user_id, actor_role, entity_type, entity_id, action, summary, before_payload, after_payload)
  values (
    public.current_app_user_id(), role_name, 'service_job', job_id::text,
    'service_job_assigned',
    'Service job technician assignment changed.',
    jsonb_build_object('assigned_to', previous_assignee),
    jsonb_build_object('assigned_to', assignee_id)
  );
end;
$function$;

create or replace function public.transition_delivery_order(order_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_status text;
  role_name text;
  assigned_user uuid;
begin
  role_name := public.current_app_role();
  select status, assigned_to into old_status, assigned_user
  from public.delivery_orders
  where id = order_id
  for update;

  if old_status is null then
    raise exception 'Delivery order not found';
  end if;

  if role_name in ('admin','operations') then
    null;
  elsif role_name = 'warehouse_staff' then
    if not (old_status = 'draft' and new_status = 'picked') then
      raise exception 'Warehouse staff may only move draft orders to picked';
    end if;
  elsif role_name = 'road_technician' then
    if assigned_user is distinct from public.current_app_user_id() then
      raise exception 'This delivery order is not assigned to you';
    end if;
    if not (
      (old_status = 'picked' and new_status = 'dispatched') or
      (old_status = 'dispatched' and new_status = 'delivered')
    ) then
      raise exception 'Road technicians may only dispatch or deliver assigned orders';
    end if;
  else
    raise exception 'You are not authorised to update delivery orders';
  end if;

  update public.delivery_orders
  set status = new_status,
      status_updated_at = now(),
      status_updated_by = public.current_app_user_id(),
      dispatched_at = case when new_status = 'dispatched' and dispatched_at is null then now() else dispatched_at end,
      delivered_at = case when new_status = 'delivered' and delivered_at is null then now() else delivered_at end,
      closed_at = case when new_status = 'closed' and closed_at is null then now() else closed_at end,
      updated_at = now()
  where id = order_id;

  insert into public.audit_events(actor_user_id, actor_role, entity_type, entity_id, action, summary, before_payload, after_payload)
  values (
    public.current_app_user_id(), role_name, 'delivery_order', order_id::text,
    'delivery_status_changed',
    format('Delivery order changed from %s to %s.', old_status, new_status),
    jsonb_build_object('status', old_status),
    jsonb_build_object('status', new_status)
  );
end;
$function$;

rollback;
