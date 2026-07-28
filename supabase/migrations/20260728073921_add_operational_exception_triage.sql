create or replace function public.list_exception_cases(p_branch text default null, p_search text default null)
returns table(
  id uuid,
  source_key text,
  source_type text,
  source_id uuid,
  exception_type text,
  title text,
  detail text,
  branch text,
  severity text,
  status text,
  assigned_to uuid,
  assigned_name text,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  escalated_by uuid,
  escalated_at timestamptz,
  resolution_notes text,
  source_href text,
  metadata jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  resolved_at timestamptz,
  comments_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_branch text;
  v_requested_branch text := nullif(lower(trim(coalesce(p_branch,''))), '');
  v_search text := nullif(lower(trim(coalesce(p_search,''))), '');
begin
  if v_actor is null or v_role not in ('admin','operations','executive','warehouse_staff','finance') then
    raise exception 'You are not permitted to view operational exceptions' using errcode = '42501';
  end if;

  select d.branch into v_branch from public.user_details d where d.user_id = v_actor;
  if v_branch is null then
    raise exception 'The authenticated user does not have a branch' using errcode = '42501';
  end if;

  if v_requested_branch = 'all' then v_requested_branch := null; end if;
  if v_requested_branch is not null
     and v_role not in ('admin','executive')
     and v_branch <> 'national'
     and v_requested_branch not in (v_branch,'national') then
    raise exception 'You may only view exceptions for your assigned branch' using errcode = '42501';
  end if;

  return query
  select
    c.id,c.source_key,c.source_type,c.source_id,c.exception_type,c.title,c.detail,c.branch,c.severity,c.status,
    c.assigned_to,nullif(trim(concat_ws(' ',d.first_name,d.last_name)),'') as assigned_name,
    c.acknowledged_by,c.acknowledged_at,c.snoozed_until,c.escalated_by,c.escalated_at,c.resolution_notes,
    c.source_href,c.metadata,c.first_seen_at,c.last_seen_at,c.resolved_at,count(cm.id) as comments_count
  from public.exception_cases c
  left join public.user_details d on d.user_id = c.assigned_to
  left join public.exception_comments cm on cm.exception_case_id = c.id
  where (v_role in ('admin','executive') or v_branch = 'national' or c.branch in (v_branch,'national'))
    and (v_requested_branch is null or c.branch = v_requested_branch)
    and (v_search is null or lower(concat_ws(' ',c.title,c.detail,c.source_type,c.exception_type,c.branch,c.severity,c.status)) like '%' || v_search || '%')
  group by c.id,d.first_name,d.last_name
  order by
    case c.status when 'escalated' then 0 when 'open' then 1 when 'acknowledged' then 2 when 'snoozed' then 3 else 4 end,
    case c.severity when 'critical' then 0 when 'high' then 1 when 'warning' then 2 else 3 end,
    c.last_seen_at desc
  limit 500;
end;
$$;

create or replace function public.list_exception_comments(p_exception_id uuid)
returns table(id uuid,body text,created_by uuid,created_name text,created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_branch text;
  v_case_branch text;
begin
  if v_actor is null or v_role not in ('admin','operations','executive','warehouse_staff','finance') then
    raise exception 'You are not permitted to view exception comments' using errcode = '42501';
  end if;

  select d.branch into v_branch from public.user_details d where d.user_id = v_actor;
  select c.branch into v_case_branch from public.exception_cases c where c.id = p_exception_id;
  if v_case_branch is null then raise exception 'Exception case not found'; end if;

  if v_role not in ('admin','executive')
     and v_branch <> 'national'
     and v_case_branch not in (v_branch,'national') then
    raise exception 'You may only view exceptions for your assigned branch' using errcode = '42501';
  end if;

  return query
  select
    cm.id,cm.body,cm.created_by,
    coalesce(nullif(trim(concat_ws(' ',d.first_name,d.last_name)),''),u.email),
    cm.created_at
  from public.exception_comments cm
  join public.users u on u.id = cm.created_by
  left join public.user_details d on d.user_id = cm.created_by
  where cm.exception_case_id = p_exception_id
  order by cm.created_at;
end;
$$;

create or replace function public.triage_exception_case(
  p_exception_id uuid,
  p_action text,
  p_assigned_to uuid default null,
  p_snoozed_until timestamptz default null,
  p_note text default null
)
returns table(id uuid,status text,assigned_to uuid,snoozed_until timestamptz,severity text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_branch text;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_case public.exception_cases%rowtype;
  v_target_branch text;
  v_target_role text;
  v_before jsonb;
begin
  if v_actor is null or v_role not in ('admin','operations','executive','warehouse_staff','finance') then
    raise exception 'You are not permitted to triage operational exceptions' using errcode = '42501';
  end if;

  select d.branch into v_branch from public.user_details d where d.user_id = v_actor;
  select c.* into v_case from public.exception_cases c where c.id = p_exception_id for update;
  if not found then raise exception 'Exception case not found'; end if;

  if v_role not in ('admin','executive')
     and v_branch <> 'national'
     and v_case.branch not in (v_branch,'national') then
    raise exception 'You may only triage exceptions for your assigned branch' using errcode = '42501';
  end if;

  v_before := to_jsonb(v_case);

  if v_action = 'acknowledge' then
    update public.exception_cases c
    set status='acknowledged',acknowledged_by=v_actor,acknowledged_at=now(),snoozed_until=null,updated_at=now()
    where c.id=p_exception_id;

  elsif v_action = 'assign' then
    if p_assigned_to is null then raise exception 'Select an assignee'; end if;

    select d.branch,d.role into v_target_branch,v_target_role
    from public.user_details d
    join public.users u on u.id=d.user_id
    where d.user_id=p_assigned_to and u.is_active=true;

    if v_target_branch is null or v_target_role not in ('admin','operations','executive','warehouse_staff','finance') then
      raise exception 'The selected assignee cannot own exception cases';
    end if;

    if v_case.branch <> 'national' and v_target_branch not in (v_case.branch,'national') then
      raise exception 'The selected assignee is not assigned to this exception branch';
    end if;

    update public.exception_cases c
    set assigned_to=p_assigned_to,
        status=case when c.status='open' then 'acknowledged' else c.status end,
        acknowledged_by=coalesce(c.acknowledged_by,v_actor),
        acknowledged_at=coalesce(c.acknowledged_at,now()),
        updated_at=now()
    where c.id=p_exception_id;

  elsif v_action = 'snooze' then
    if p_snoozed_until is null or p_snoozed_until <= now() then raise exception 'Choose a future snooze time'; end if;
    if p_snoozed_until > now() + interval '30 days' then raise exception 'Exception cases may be snoozed for at most 30 days'; end if;

    update public.exception_cases c
    set status='snoozed',snoozed_until=p_snoozed_until,
        acknowledged_by=coalesce(c.acknowledged_by,v_actor),
        acknowledged_at=coalesce(c.acknowledged_at,now()),updated_at=now()
    where c.id=p_exception_id;

  elsif v_action = 'escalate' then
    update public.exception_cases c
    set status='escalated',severity=case when c.severity='critical' then 'critical' else 'high' end,
        escalated_by=v_actor,escalated_at=now(),snoozed_until=null,updated_at=now()
    where c.id=p_exception_id;

  elsif v_action = 'resolve' then
    update public.exception_cases c
    set status='resolved',resolved_at=now(),resolution_notes=nullif(trim(coalesce(p_note,'')),''),
        snoozed_until=null,metadata=c.metadata || jsonb_build_object('auto_resolved',false),updated_at=now()
    where c.id=p_exception_id;

  elsif v_action = 'reopen' then
    update public.exception_cases c
    set status='open',resolved_at=null,resolution_notes=null,snoozed_until=null,
        metadata=c.metadata - 'auto_resolved',updated_at=now()
    where c.id=p_exception_id;

  elsif v_action = 'comment' then
    if nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'Enter a comment'; end if;
    update public.exception_cases c set updated_at=now() where c.id=p_exception_id;

  else
    raise exception 'Unsupported exception action';
  end if;

  if nullif(trim(coalesce(p_note,'')),'') is not null then
    insert into public.exception_comments(exception_case_id,body,created_by)
    values(p_exception_id,trim(p_note),v_actor);
  end if;

  insert into public.audit_events(
    actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,before_payload,after_payload,metadata
  )
  select
    v_actor,v_role,c.branch,'exception_case',c.id,format('exception_%s',v_action),
    format('%s: %s',initcap(v_action),c.title),v_before,to_jsonb(c),
    jsonb_build_object('source_type',c.source_type,'source_id',c.source_id)
  from public.exception_cases c
  where c.id=p_exception_id;

  return query
  select c.id,c.status,c.assigned_to,c.snoozed_until,c.severity
  from public.exception_cases c
  where c.id=p_exception_id;
end;
$$;

revoke all on function public.list_exception_cases(text,text) from public,anon;
revoke all on function public.list_exception_comments(uuid) from public,anon;
revoke all on function public.triage_exception_case(uuid,text,uuid,timestamptz,text) from public,anon;

grant execute on function public.list_exception_cases(text,text) to authenticated;
grant execute on function public.list_exception_comments(uuid) to authenticated;
grant execute on function public.triage_exception_case(uuid,text,uuid,timestamptz,text) to authenticated;

comment on function public.list_exception_cases(text,text)
  is 'Returns branch-authorized operational exception cases with assignment and comment summaries.';
comment on function public.list_exception_comments(uuid)
  is 'Returns the authorized discussion history for an operational exception case.';
comment on function public.triage_exception_case(uuid,text,uuid,timestamptz,text)
  is 'Acknowledges, assigns, snoozes, escalates, resolves, reopens or comments on an authorized exception case.';
