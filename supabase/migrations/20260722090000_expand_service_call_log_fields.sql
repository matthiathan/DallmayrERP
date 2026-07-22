create sequence if not exists public.service_job_incident_number_seq
  start with 10000
  increment by 1;

alter table public.service_jobs
  add column if not exists incident_number text,
  add column if not exists reported_at timestamptz not null default now(),
  add column if not exists call_logged_by uuid references public.users(id) on delete set null,
  add column if not exists customer_code_snapshot text,
  add column if not exists customer_name_snapshot text,
  add column if not exists contact_name text,
  add column if not exists telephone text,
  add column if not exists fax text,
  add column if not exists mobile text,
  add column if not exists contact_email text,
  add column if not exists address_snapshot text,
  add column if not exists service_type text not null default 'technical',
  add column if not exists service_code text,
  add column if not exists complaint_details text,
  add column if not exists site_location text,
  add column if not exists call_type text,
  add column if not exists call_reason text,
  add column if not exists category text,
  add column if not exists sub_category text,
  add column if not exists group_3 text,
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

alter table public.service_jobs
  alter column incident_number set default lpad(nextval('public.service_job_incident_number_seq')::text, 6, '0');

update public.service_jobs
set incident_number = lpad(nextval('public.service_job_incident_number_seq')::text, 6, '0')
where incident_number is null;

update public.service_jobs sj
set reported_at = coalesce(sj.reported_at, sj.created_at),
    call_logged_by = coalesce(sj.call_logged_by, sj.created_by),
    complaint_details = coalesce(nullif(sj.complaint_details, ''), sj.description, sj.summary, ''),
    customer_code_snapshot = coalesce(sj.customer_code_snapshot, c.customer_code),
    customer_name_snapshot = coalesce(sj.customer_name_snapshot, c.customer_name)
from public.customers c
where c.id = sj.customer_id
  and (
    sj.call_logged_by is null
    or sj.complaint_details is null
    or sj.reported_at is null
    or sj.customer_code_snapshot is null
    or sj.customer_name_snapshot is null
  );

update public.service_jobs sj
set reported_at = coalesce(sj.reported_at, sj.created_at),
    call_logged_by = coalesce(sj.call_logged_by, sj.created_by),
    complaint_details = coalesce(nullif(sj.complaint_details, ''), sj.description, sj.summary, '')
where sj.call_logged_by is null
   or sj.complaint_details is null
   or sj.reported_at is null;

alter table public.service_jobs
  alter column incident_number set not null,
  alter column complaint_details set not null;

create unique index if not exists service_jobs_incident_number_key
  on public.service_jobs (incident_number);

create index if not exists service_jobs_ticket_case_number_idx
  on public.service_jobs (ticket_case_number)
  where ticket_case_number is not null;

create index if not exists service_jobs_work_order_number_idx
  on public.service_jobs (work_order_number)
  where work_order_number is not null;

create index if not exists service_jobs_reported_at_idx
  on public.service_jobs (reported_at desc);

create index if not exists service_jobs_customer_code_snapshot_idx
  on public.service_jobs (customer_code_snapshot)
  where customer_code_snapshot is not null;

create or replace function public.create_service_call_log(
  p_customer_id uuid,
  p_branch text,
  p_service_type text,
  p_complaint_details text,
  p_site_id uuid default null,
  p_machine_id uuid default null,
  p_assigned_to uuid default null,
  p_priority text default 'medium',
  p_reported_at timestamptz default now(),
  p_contact_name text default null,
  p_telephone text default null,
  p_fax text default null,
  p_mobile text default null,
  p_contact_email text default null,
  p_address_snapshot text default null,
  p_service_code text default null,
  p_site_location text default null,
  p_call_type text default null,
  p_call_reason text default null,
  p_category text default null,
  p_sub_category text default null,
  p_group_3 text default null,
  p_follow_up_at timestamptz default null,
  p_work_order_number text default null,
  p_assignment_notes text default null,
  p_parts_extra boolean default false,
  p_performance_report_required boolean default false,
  p_visits_chargeable boolean default false,
  p_quotation_required boolean default false,
  p_ticket_reference text default null,
  p_ticket_case_number text default null,
  p_reference_date_1 date default null,
  p_reference_date_2 date default null
)
returns table(id uuid, job_number text, incident_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
  v_incident_number text;
  v_job_number text;
  v_status text;
  v_customer_code text;
  v_customer_name text;
  v_job public.service_jobs%rowtype;
begin
  if v_actor is null or v_actor_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may create call logs' using errcode = '42501';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = v_actor;

  if p_branch not in ('jhb', 'cpt', 'kzn', 'national') then
    raise exception 'Invalid call-log division';
  end if;

  if v_actor_role = 'operations'
     and coalesce(v_actor_branch, 'national') <> 'national'
     and p_branch <> v_actor_branch then
    raise exception 'Operations Managers may only create call logs for their assigned branch';
  end if;

  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid service priority';
  end if;

  if nullif(trim(coalesce(p_service_type, '')), '') is null then
    raise exception 'Service type is required';
  end if;

  if nullif(trim(coalesce(p_complaint_details, '')), '') is null then
    raise exception 'Complaint details are required';
  end if;

  if nullif(trim(coalesce(p_category, '')), '') is null then
    raise exception 'Category is required';
  end if;

  select c.customer_code, c.customer_name
    into v_customer_code, v_customer_name
  from public.customers c
  where c.id = p_customer_id;

  if not found then
    raise exception 'Select a valid customer';
  end if;

  if p_site_id is not null then
    perform 1
    from public.customer_sites s
    where s.id = p_site_id and s.customer_id = p_customer_id;
    if not found then
      raise exception 'The selected site does not belong to the selected customer';
    end if;
  end if;

  if p_machine_id is not null then
    perform 1
    from public.machines m
    where m.id = p_machine_id and m.customer_id = p_customer_id;
    if not found then
      raise exception 'The selected machine does not belong to the selected customer';
    end if;
  end if;

  if p_assigned_to is not null then
    perform 1
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.id = p_assigned_to
      and u.is_active = true
      and d.role in ('technician', 'road_technician');
    if not found then
      raise exception 'Select an active technician or road technician';
    end if;
  end if;

  v_incident_number := lpad(nextval('public.service_job_incident_number_seq')::text, 6, '0');
  v_job_number := concat('SJ-', upper(p_branch), '-', v_incident_number);
  v_status := case when p_assigned_to is null then 'new' else 'assigned' end;

  insert into public.service_jobs (
    branch,
    job_number,
    incident_number,
    customer_id,
    customer_code_snapshot,
    customer_name_snapshot,
    site_id,
    machine_id,
    assigned_to,
    priority,
    status,
    summary,
    description,
    complaint_details,
    due_at,
    reported_at,
    call_logged_by,
    created_by,
    contact_name,
    telephone,
    fax,
    mobile,
    contact_email,
    address_snapshot,
    service_type,
    service_code,
    site_location,
    call_type,
    call_reason,
    category,
    sub_category,
    group_3,
    work_order_number,
    assignment_notes,
    parts_extra,
    performance_report_required,
    visits_chargeable,
    quotation_required,
    ticket_reference,
    ticket_case_number,
    reference_date_1,
    reference_date_2
  ) values (
    p_branch,
    v_job_number,
    v_incident_number,
    p_customer_id,
    v_customer_code,
    v_customer_name,
    p_site_id,
    p_machine_id,
    p_assigned_to,
    p_priority,
    v_status,
    left(trim(p_complaint_details), 160),
    trim(p_complaint_details),
    trim(p_complaint_details),
    p_follow_up_at,
    coalesce(p_reported_at, now()),
    v_actor,
    v_actor,
    nullif(trim(coalesce(p_contact_name, '')), ''),
    nullif(trim(coalesce(p_telephone, '')), ''),
    nullif(trim(coalesce(p_fax, '')), ''),
    nullif(trim(coalesce(p_mobile, '')), ''),
    nullif(trim(coalesce(p_contact_email, '')), ''),
    nullif(trim(coalesce(p_address_snapshot, '')), ''),
    trim(p_service_type),
    nullif(trim(coalesce(p_service_code, '')), ''),
    nullif(trim(coalesce(p_site_location, '')), ''),
    nullif(trim(coalesce(p_call_type, '')), ''),
    nullif(trim(coalesce(p_call_reason, '')), ''),
    trim(p_category),
    nullif(trim(coalesce(p_sub_category, '')), ''),
    nullif(trim(coalesce(p_group_3, '')), ''),
    nullif(trim(coalesce(p_work_order_number, '')), ''),
    nullif(trim(coalesce(p_assignment_notes, '')), ''),
    coalesce(p_parts_extra, false),
    coalesce(p_performance_report_required, false),
    coalesce(p_visits_chargeable, false),
    coalesce(p_quotation_required, false),
    nullif(trim(coalesce(p_ticket_reference, '')), ''),
    coalesce(nullif(trim(coalesce(p_ticket_case_number, '')), ''), v_incident_number),
    p_reference_date_1,
    p_reference_date_2
  )
  returning * into v_job;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    branch,
    entity_type,
    entity_id,
    action,
    summary,
    after_payload,
    metadata
  ) values (
    v_actor,
    v_actor_role,
    p_branch,
    'service_job',
    v_job.id,
    'service_call_log_created',
    concat(v_job.job_number, ' created for incident ', v_job.incident_number),
    to_jsonb(v_job),
    jsonb_build_object('customer_id', p_customer_id, 'site_id', p_site_id, 'machine_id', p_machine_id)
  );

  return query select v_job.id, v_job.job_number, v_job.incident_number;
end;
$$;

create or replace function public.close_service_job(
  job_id uuid,
  remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_old_status text;
begin
  if v_actor is null or v_actor_role not in ('admin', 'operations') then
    raise exception 'Only an Administrator or Operations Manager may close service jobs' using errcode = '42501';
  end if;

  select sj.status into v_old_status
  from public.service_jobs sj
  where sj.id = job_id
  for update;

  if v_old_status is null then
    raise exception 'Service job not found';
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
    actor_user_id,
    actor_role,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload
  ) values (
    v_actor,
    v_actor_role,
    'service_job',
    job_id,
    'service_job_closed',
    'Verified service job closed.',
    jsonb_build_object('status', v_old_status),
    jsonb_build_object(
      'status', 'closed',
      'closed_by', v_actor,
      'closed_at', now(),
      'closing_remarks', nullif(trim(coalesce(remarks, '')), '')
    )
  );
end;
$$;

create or replace function public.transition_service_job(job_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
  role_name text;
  assigned_user uuid;
  actor_id uuid := public.current_app_user_id();
begin
  role_name := public.current_app_role();
  select sj.status, sj.assigned_to into old_status, assigned_user
  from public.service_jobs sj
  where sj.id = job_id
  for update;

  if old_status is null then
    raise exception 'Service job not found';
  end if;

  if role_name in ('admin', 'operations') then
    null;
  elsif role_name in ('technician', 'road_technician') then
    if assigned_user is distinct from actor_id then
      raise exception 'This service job is not assigned to you';
    end if;
    if not (
      (old_status = 'assigned' and new_status = 'in_progress')
      or (old_status = 'in_progress' and new_status = 'completed')
    ) then
      raise exception 'Technicians may only start or complete assigned work';
    end if;
  else
    raise exception 'You are not authorised to update service jobs';
  end if;

  update public.service_jobs
  set status = new_status,
      completed_at = case when new_status = 'completed' and completed_at is null then now() else completed_at end,
      closed_by = case when new_status = 'closed' then actor_id else closed_by end,
      closed_at = case when new_status = 'closed' then coalesce(closed_at, now()) else closed_at end,
      updated_at = now()
  where id = job_id;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload
  ) values (
    actor_id,
    role_name,
    'service_job',
    job_id,
    'service_job_status_changed',
    format('Service job changed from %s to %s.', old_status, new_status),
    jsonb_build_object('status', old_status),
    jsonb_build_object('status', new_status)
  );
end;
$$;

revoke all on function public.create_service_call_log(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  text,
  text,
  date,
  date
) from public;

revoke all on function public.close_service_job(uuid, text) from public;

grant execute on function public.create_service_call_log(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  boolean,
  boolean,
  boolean,
  boolean,
  text,
  text,
  date,
  date
) to authenticated;

grant execute on function public.close_service_job(uuid, text) to authenticated;
