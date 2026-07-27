-- Complete assigned technician service jobs as one database transaction.
-- The browser uploads optional proof first, then this RPC atomically records
-- the closure, scan evidence, audit event and service-job status transition.

alter table public.task_closures
  add column if not exists service_job_id uuid references public.service_jobs(id) on delete set null,
  add column if not exists machine_id uuid references public.machines(id) on delete set null;

create unique index if not exists task_closures_service_job_unique
  on public.task_closures (service_job_id)
  where service_job_id is not null;

create index if not exists task_closures_machine_id_idx
  on public.task_closures (machine_id, closed_at desc)
  where machine_id is not null;

create or replace function public.complete_assigned_service_job(
  p_service_job_id uuid,
  p_outcome text,
  p_notes text default null,
  p_photo_bucket text default null,
  p_photo_path text default null
)
returns table(task_closure_id uuid, job_number text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_job public.service_jobs%rowtype;
  v_closure_id uuid;
  v_machine_barcode text;
  v_customer_name text;
  v_site_address text;
begin
  if v_actor is null or v_actor_role not in ('technician', 'road_technician') then
    raise exception 'Only an authenticated technician may complete an assigned service job'
      using errcode = '42501';
  end if;

  if p_outcome not in ('completed', 'follow_up_required', 'parts_required', 'customer_unavailable') then
    raise exception 'Invalid task outcome';
  end if;

  select sj.*
    into v_job
  from public.service_jobs sj
  where sj.id = p_service_job_id
  for update;

  if not found then
    raise exception 'Service job not found';
  end if;

  if v_job.assigned_to is distinct from v_actor then
    raise exception 'This service job is not assigned to you'
      using errcode = '42501';
  end if;

  if v_job.status not in ('assigned', 'in_progress') then
    raise exception 'Only assigned or in-progress service jobs may be completed';
  end if;

  if v_job.machine_id is null then
    raise exception 'The service job must be linked to a machine before completion';
  end if;

  select
    coalesce(nullif(trim(m.machine_barcode), ''), nullif(trim(m.serial_number), ''), nullif(trim(m.asset_tag), '')),
    coalesce(nullif(trim(v_job.customer_name_snapshot), ''), nullif(trim(c.customer_name), '')),
    coalesce(nullif(trim(s.address), ''), nullif(trim(c.address), ''), nullif(trim(v_job.address_snapshot), ''))
  into v_machine_barcode, v_customer_name, v_site_address
  from public.machines m
  left join public.customers c on c.id = v_job.customer_id
  left join public.customer_sites s on s.id = v_job.site_id
  where m.id = v_job.machine_id;

  if v_machine_barcode is null then
    raise exception 'The linked machine needs a barcode, serial number or asset tag before completion';
  end if;

  -- Preserve the existing status transition rules. An assigned job is started
  -- immediately before it is completed within this same transaction.
  if v_job.status = 'assigned' then
    update public.service_jobs
    set status = 'in_progress',
        updated_at = now()
    where id = v_job.id;
  end if;

  insert into public.task_closures (
    task_type,
    branch,
    machine_barcode,
    machine_id,
    service_job_id,
    customer_name,
    site_address,
    outcome,
    notes,
    photo_bucket,
    photo_path,
    closed_by
  ) values (
    v_actor_role,
    v_job.branch,
    v_machine_barcode,
    v_job.machine_id,
    v_job.id,
    v_customer_name,
    v_site_address,
    p_outcome,
    nullif(trim(coalesce(p_notes, '')), ''),
    case when nullif(trim(coalesce(p_photo_path, '')), '') is null then null else coalesce(nullif(trim(p_photo_bucket), ''), 'dallmayrerp-task-photos') end,
    nullif(trim(coalesce(p_photo_path, '')), ''),
    v_actor
  )
  returning id into v_closure_id;

  insert into public.stock_scan_events (
    barcode,
    scan_type,
    branch,
    quantity,
    related_task_closure_id,
    scanned_by,
    notes
  ) values (
    v_machine_barcode,
    'task_close',
    v_job.branch,
    1,
    v_closure_id,
    v_actor,
    format('Service job %s completed with outcome %s', v_job.job_number, p_outcome)
  );

  update public.service_jobs
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = v_job.id;

  insert into public.audit_events (
    actor_user_id,
    actor_role,
    branch,
    entity_type,
    entity_id,
    action,
    summary,
    before_payload,
    after_payload,
    metadata
  ) values (
    v_actor,
    v_actor_role,
    v_job.branch,
    'service_job',
    v_job.id,
    'assigned_service_job_completed',
    format('%s completed with outcome %s.', v_job.job_number, p_outcome),
    jsonb_build_object('status', v_job.status),
    jsonb_build_object(
      'status', 'completed',
      'completed_at', now(),
      'task_closure_id', v_closure_id,
      'outcome', p_outcome
    ),
    jsonb_build_object(
      'machine_id', v_job.machine_id,
      'machine_barcode', v_machine_barcode,
      'photo_path', nullif(trim(coalesce(p_photo_path, '')), '')
    )
  );

  return query
  select v_closure_id, v_job.job_number, 'completed'::text;
end;
$$;

revoke all on function public.complete_assigned_service_job(uuid, text, text, text, text) from public;
grant execute on function public.complete_assigned_service_job(uuid, text, text, text, text) to authenticated;

comment on function public.complete_assigned_service_job(uuid, text, text, text, text)
  is 'Atomically completes a service job assigned to the authenticated technician and records closure, scan and audit evidence.';
