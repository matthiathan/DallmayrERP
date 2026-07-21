create or replace function public.create_work_item(
  p_title text,
  p_description text default null,
  p_work_type text default 'task',
  p_department text default 'operations',
  p_branch text default 'national',
  p_priority text default 'medium',
  p_assigned_to uuid default null,
  p_customer_id uuid default null,
  p_site_id uuid default null,
  p_machine_id uuid default null,
  p_stock_item_id uuid default null,
  p_due_at timestamptz default null,
  p_sla_due_at timestamptz default null,
  p_approval_required boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_id uuid;
  v_number text;
  v_status text;
begin
  if v_actor is null or v_role is null then
    raise exception 'Authentication required';
  end if;

  if v_role in ('technician', 'road_technician') then
    raise exception 'Technicians cannot create or request work items. Operations must assign their work.'
      using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_title, '')), '') is null then
    raise exception 'Title is required';
  end if;
  if p_work_type not in ('request', 'task', 'approval', 'inspection', 'maintenance', 'incident') then
    raise exception 'Invalid work type';
  end if;
  if p_branch not in ('jhb', 'cpt', 'kzn', 'national') then
    raise exception 'Invalid branch';
  end if;
  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid priority';
  end if;

  v_id := gen_random_uuid();
  v_number := concat('WK-', upper(p_branch), '-', to_char(clock_timestamp(), 'YYYYMMDDHH24MISS'), '-', upper(substr(v_id::text, 1, 4)));
  v_status := case when p_assigned_to is null then 'new' else 'assigned' end;

  insert into public.work_items(
    id, work_number, title, description, work_type, department, branch, status, priority,
    requested_by, assigned_to, customer_id, site_id, machine_id, stock_item_id, due_at,
    sla_due_at, approval_required, approval_status
  )
  values(
    v_id, v_number, trim(p_title), nullif(trim(coalesce(p_description, '')), ''), p_work_type,
    coalesce(nullif(trim(p_department), ''), 'operations'), p_branch, v_status, p_priority,
    v_actor, p_assigned_to, p_customer_id, p_site_id, p_machine_id, p_stock_item_id, p_due_at,
    p_sla_due_at, p_approval_required,
    case when p_approval_required then 'pending' else 'not_required' end
  );

  insert into public.audit_events(
    actor_user_id, actor_role, branch, entity_type, entity_id, action, summary, after_payload
  )
  values(
    v_actor, v_role, p_branch, 'work_item', v_id, 'work_item_created',
    concat(v_number, ' created: ', trim(p_title)),
    jsonb_build_object('status', v_status, 'priority', p_priority, 'work_type', p_work_type, 'assigned_to', p_assigned_to)
  );

  return v_id;
end;
$function$;
