-- Capture the complete operational maintenance-plan record while preserving recurrence automation.

alter table public.maintenance_plans
  add column if not exists incident_number text,
  add column if not exists branch text,
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists site_id uuid references public.customer_sites(id) on delete set null,
  add column if not exists reported_at timestamptz not null default now(),
  add column if not exists plan_logged_by uuid references public.users(id) on delete set null,
  add column if not exists customer_code_snapshot text,
  add column if not exists customer_name_snapshot text,
  add column if not exists contact_name text,
  add column if not exists telephone text,
  add column if not exists fax text,
  add column if not exists mobile text,
  add column if not exists contact_email text,
  add column if not exists address_snapshot text,
  add column if not exists service_type text not null default 'Preventive Maintenance',
  add column if not exists service_code text,
  add column if not exists complaint_details text,
  add column if not exists site_location text,
  add column if not exists call_type text,
  add column if not exists call_reason text,
  add column if not exists category text,
  add column if not exists sub_category text,
  add column if not exists group_3 text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists work_order_number text,
  add column if not exists assignment_notes text,
  add column if not exists closed_by uuid references public.users(id) on delete set null,
  add column if not exists closed_at timestamptz,
  add column if not exists closing_remarks text,
  add column if not exists parts_extra boolean not null default false,
  add column if not exists performance_report_required boolean not null default false,
  add column if not exists visits_chargeable boolean not null default false,
  add column if not exists quotation_required boolean not null default false,
  add column if not exists ticket_reference text,
  add column if not exists ticket_case_number text,
  add column if not exists reference_date_1 date,
  add column if not exists reference_date_2 date;

create unique index if not exists maintenance_plans_incident_number_key
  on public.maintenance_plans (incident_number)
  where incident_number is not null;

create index if not exists maintenance_plans_customer_idx
  on public.maintenance_plans (customer_id, is_active);

create index if not exists maintenance_plans_ticket_case_idx
  on public.maintenance_plans (ticket_case_number)
  where ticket_case_number is not null;

create index if not exists maintenance_plans_work_order_idx
  on public.maintenance_plans (work_order_number)
  where work_order_number is not null;

create or replace function public.create_complete_maintenance_plan(p_payload jsonb)
returns table(id uuid, plan_number text, incident_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_actor_branch text;
  v_customer_id uuid;
  v_site_id uuid;
  v_machine_id uuid;
  v_assigned_to uuid;
  v_branch text;
  v_customer_code text;
  v_customer_name text;
  v_machine_name text;
  v_machine_branch text;
  v_trigger_type text;
  v_priority text;
  v_incident_number text;
  v_plan_number text;
  v_service_type text;
  v_complaint text;
  v_category text;
  v_reported_at timestamptz;
  v_follow_up_at timestamptz;
  v_interval_days integer;
  v_interval_meter numeric;
  v_next_due_meter numeric;
  v_estimated_minutes integer;
  v_checklist jsonb;
  v_plan public.maintenance_plans%rowtype;
begin
  if v_actor is null or v_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may create maintenance plans' using errcode = '42501';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  begin
    v_customer_id := nullif(p_payload->>'customer_id', '')::uuid;
    v_site_id := nullif(p_payload->>'site_id', '')::uuid;
    v_machine_id := nullif(p_payload->>'machine_id', '')::uuid;
    v_assigned_to := nullif(p_payload->>'assigned_to', '')::uuid;
    v_reported_at := coalesce(nullif(p_payload->>'reported_at', '')::timestamptz, now());
    v_follow_up_at := nullif(p_payload->>'follow_up_at', '')::timestamptz;
    v_interval_days := nullif(p_payload->>'interval_days', '')::integer;
    v_interval_meter := nullif(p_payload->>'interval_meter', '')::numeric;
    v_next_due_meter := nullif(p_payload->>'next_due_meter', '')::numeric;
    v_estimated_minutes := nullif(p_payload->>'estimated_minutes', '')::integer;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'One or more maintenance-plan identifiers, dates or numeric values are invalid';
  end;

  v_branch := lower(trim(coalesce(p_payload->>'branch', '')));
  v_trigger_type := lower(trim(coalesce(p_payload->>'trigger_type', 'calendar')));
  v_priority := lower(trim(coalesce(p_payload->>'priority', 'medium')));
  v_service_type := trim(coalesce(p_payload->>'service_type', ''));
  v_complaint := trim(coalesce(p_payload->>'complaint_details', ''));
  v_category := trim(coalesce(p_payload->>'category', ''));
  v_checklist := coalesce(p_payload->'checklist_template', '[]'::jsonb);

  if v_branch not in ('jhb', 'cpt', 'kzn', 'national') then
    raise exception 'Invalid maintenance division';
  end if;

  if v_role = 'operations'
     and coalesce(v_actor_branch, 'national') <> 'national'
     and v_branch <> v_actor_branch then
    raise exception 'Operations Managers may only create maintenance plans for their assigned branch';
  end if;

  if v_trigger_type not in ('calendar', 'meter', 'hybrid') then
    raise exception 'Invalid maintenance trigger';
  end if;

  if v_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid maintenance priority';
  end if;

  if v_customer_id is null then raise exception 'Select a customer'; end if;
  if v_machine_id is null then raise exception 'Select a machine'; end if;
  if v_service_type = '' then raise exception 'Service type is required'; end if;
  if v_complaint = '' then raise exception 'Complaint details are required'; end if;
  if v_category = '' then raise exception 'Category is required'; end if;

  if v_trigger_type in ('calendar', 'hybrid') then
    if coalesce(v_interval_days, 0) <= 0 then
      raise exception 'Calendar and hybrid plans require an interval in days';
    end if;
    if v_follow_up_at is null then
      raise exception 'Calendar and hybrid plans require a follow-up date';
    end if;
  else
    v_interval_days := null;
  end if;

  if v_trigger_type in ('meter', 'hybrid') then
    if coalesce(v_interval_meter, 0) <= 0 then
      raise exception 'Meter and hybrid plans require a meter interval';
    end if;
    if v_next_due_meter is null then
      raise exception 'Meter and hybrid plans require a first due meter';
    end if;
  else
    v_interval_meter := null;
    v_next_due_meter := null;
  end if;

  if v_estimated_minutes is not null and v_estimated_minutes <= 0 then
    raise exception 'Estimated minutes must be greater than zero';
  end if;

  if jsonb_typeof(v_checklist) <> 'array' then
    raise exception 'Maintenance checklist must be an array';
  end if;

  select c.customer_code, c.customer_name
    into v_customer_code, v_customer_name
  from public.customers c
  where c.id = v_customer_id;

  if not found then raise exception 'Select a valid customer'; end if;

  if v_site_id is not null then
    perform 1 from public.customer_sites s
    where s.id = v_site_id and s.customer_id = v_customer_id;
    if not found then raise exception 'The selected site does not belong to the selected customer'; end if;
  end if;

  select coalesce(m.machine_name, m.serial_number, m.machine_barcode, 'Machine'), m.branch
    into v_machine_name, v_machine_branch
  from public.machines m
  where m.id = v_machine_id and m.customer_id = v_customer_id and m.status <> 'retired';

  if not found then
    raise exception 'The selected active machine does not belong to the selected customer';
  end if;

  if v_machine_branch <> v_branch and v_branch <> 'national' then
    raise exception 'The selected machine does not belong to the selected division';
  end if;

  if v_assigned_to is not null then
    perform 1
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.id = v_assigned_to
      and u.is_active = true
      and d.role in ('technician', 'road_technician')
      and (v_branch = 'national' or d.branch in (v_branch, 'national'));
    if not found then raise exception 'Select an active technician for the maintenance division'; end if;
  end if;

  v_incident_number := lpad(nextval('public.service_job_incident_number_seq')::text, 6, '0');
  v_plan_number := concat('PM-', upper(v_branch), '-', v_incident_number);

  insert into public.maintenance_plans (
    plan_number, incident_number, machine_id, customer_id, site_id, branch,
    title, description, trigger_type, interval_days, interval_meter,
    next_due_at, next_due_meter, priority, estimated_minutes, assigned_to,
    checklist_template, is_active, created_by, reported_at, plan_logged_by,
    customer_code_snapshot, customer_name_snapshot, contact_name, telephone,
    fax, mobile, contact_email, address_snapshot, service_type, service_code,
    complaint_details, site_location, call_type, call_reason, category,
    sub_category, group_3, follow_up_at, work_order_number, assignment_notes,
    parts_extra, performance_report_required, visits_chargeable,
    quotation_required, ticket_reference, ticket_case_number,
    reference_date_1, reference_date_2
  ) values (
    v_plan_number, v_incident_number, v_machine_id, v_customer_id, v_site_id, v_branch,
    left(concat(v_service_type, ' - ', v_customer_name, ' - ', v_machine_name), 180),
    v_complaint, v_trigger_type, v_interval_days, v_interval_meter,
    case when v_trigger_type = 'meter' then null else v_follow_up_at end,
    v_next_due_meter, v_priority, v_estimated_minutes, v_assigned_to,
    v_checklist, true, v_actor, v_reported_at, v_actor,
    v_customer_code, v_customer_name,
    nullif(trim(coalesce(p_payload->>'contact_name', '')), ''),
    nullif(trim(coalesce(p_payload->>'telephone', '')), ''),
    nullif(trim(coalesce(p_payload->>'fax', '')), ''),
    nullif(trim(coalesce(p_payload->>'mobile', '')), ''),
    nullif(trim(coalesce(p_payload->>'contact_email', '')), ''),
    nullif(trim(coalesce(p_payload->>'address_snapshot', '')), ''),
    v_service_type,
    nullif(trim(coalesce(p_payload->>'service_code', '')), ''),
    v_complaint,
    nullif(trim(coalesce(p_payload->>'site_location', '')), ''),
    nullif(trim(coalesce(p_payload->>'call_type', '')), ''),
    nullif(trim(coalesce(p_payload->>'call_reason', '')), ''),
    v_category,
    nullif(trim(coalesce(p_payload->>'sub_category', '')), ''),
    nullif(trim(coalesce(p_payload->>'group_3', '')), ''),
    v_follow_up_at,
    nullif(trim(coalesce(p_payload->>'work_order_number', '')), ''),
    nullif(trim(coalesce(p_payload->>'assignment_notes', '')), ''),
    coalesce((p_payload->>'parts_extra')::boolean, false),
    coalesce((p_payload->>'performance_report_required')::boolean, false),
    coalesce((p_payload->>'visits_chargeable')::boolean, false),
    coalesce((p_payload->>'quotation_required')::boolean, false),
    nullif(trim(coalesce(p_payload->>'ticket_reference', '')), ''),
    coalesce(nullif(trim(coalesce(p_payload->>'ticket_case_number', '')), ''), v_incident_number),
    nullif(p_payload->>'reference_date_1', '')::date,
    nullif(p_payload->>'reference_date_2', '')::date
  ) returning * into v_plan;

  update public.machines m
  set next_service_at = (
        select min(mp.next_due_at)
        from public.maintenance_plans mp
        where mp.machine_id = v_machine_id
          and mp.is_active = true
          and mp.next_due_at is not null
      ),
      updated_at = now()
  where m.id = v_machine_id;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id,
    action, summary, after_payload, metadata
  ) values (
    v_actor, v_role, v_branch, 'maintenance_plan', v_plan.id,
    'maintenance_plan_created',
    concat(v_plan.plan_number, ' created for maintenance incident ', v_plan.incident_number),
    to_jsonb(v_plan),
    jsonb_build_object('customer_id', v_customer_id, 'site_id', v_site_id, 'machine_id', v_machine_id)
  );

  return query select v_plan.id, v_plan.plan_number, v_plan.incident_number;
end;
$$;

revoke all on function public.create_complete_maintenance_plan(jsonb) from public;
grant execute on function public.create_complete_maintenance_plan(jsonb) to authenticated;