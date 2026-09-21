-- Alarm workflow tables already carry restrictive telemetry-region RLS, but
-- this SECURITY DEFINER mutation path must enforce the same boundary itself.

create or replace function public.set_telemetry_alarm_workflow(
  p_fault_id uuid,
  p_action text,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_actor uuid := auth.uid();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_row public.telemetry_alarm_workflow%rowtype;
begin
  if v_actor is null or not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  if p_fault_id is null
     or not public.telemetry_region_allows_fault(p_fault_id) then
    raise exception 'Alarm was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  -- Keep the selected-region assertion explicit in this Security Definer path.
  if v_region is null then
    raise exception 'Select a telemetry region before opening telemetry data.' using errcode = '42501';
  end if;

  if v_action not in ('acknowledge','unacknowledge','take','release','resolve','reopen') then
    raise exception 'Unsupported alarm workflow action.' using errcode = '22023';
  end if;
  if v_action = 'resolve' and (v_note is null or length(v_note) < 3) then
    raise exception 'A resolution note of at least 3 characters is required.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Alarm workflow note is too long.' using errcode = '22023';
  end if;

  insert into public.telemetry_alarm_workflow(fault_id)
  values (p_fault_id)
  on conflict (fault_id) do nothing;

  if v_action = 'acknowledge' then
    update public.telemetry_alarm_workflow set
      workflow_status = case when workflow_status = 'resolved' then 'resolved' else 'acknowledged' end,
      acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, v_actor),
      updated_at = now()
    where fault_id = p_fault_id;
  elsif v_action = 'unacknowledge' then
    update public.telemetry_alarm_workflow set
      workflow_status = case when workflow_status = 'resolved' then 'resolved' else 'open' end,
      acknowledged_at = null,
      acknowledged_by = null,
      updated_at = now()
    where fault_id = p_fault_id;
  elsif v_action = 'take' then
    update public.telemetry_alarm_workflow set
      workflow_status = case when workflow_status = 'resolved' then 'resolved' else 'acknowledged' end,
      acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, v_actor),
      assigned_to = v_actor,
      updated_at = now()
    where fault_id = p_fault_id;
  elsif v_action = 'release' then
    update public.telemetry_alarm_workflow
    set assigned_to = null,
        updated_at = now()
    where fault_id = p_fault_id;
  elsif v_action = 'resolve' then
    update public.telemetry_alarm_workflow set
      workflow_status = 'resolved',
      acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, v_actor),
      assigned_to = coalesce(assigned_to, v_actor),
      resolved_at = now(),
      resolved_by = v_actor,
      resolution_note = v_note,
      updated_at = now()
    where fault_id = p_fault_id;
  elsif v_action = 'reopen' then
    update public.telemetry_alarm_workflow set
      workflow_status = 'open',
      acknowledged_at = null,
      acknowledged_by = null,
      resolved_at = null,
      resolved_by = null,
      resolution_note = null,
      updated_at = now()
    where fault_id = p_fault_id;
  end if;

  insert into public.telemetry_alarm_workflow_history(fault_id, action, actor_id, note)
  values (p_fault_id, v_action, v_actor, v_note);

  select * into v_row
  from public.telemetry_alarm_workflow
  where fault_id = p_fault_id;

  return jsonb_build_object(
    'fault_id', v_row.fault_id,
    'workflow_status', v_row.workflow_status,
    'acknowledged_at', v_row.acknowledged_at,
    'acknowledged_by', v_row.acknowledged_by,
    'assigned_to', v_row.assigned_to,
    'resolved_at', v_row.resolved_at,
    'resolved_by', v_row.resolved_by,
    'resolution_note', v_row.resolution_note,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.set_telemetry_alarm_workflow(uuid, text, text) from public, anon;
grant execute on function public.set_telemetry_alarm_workflow(uuid, text, text) to authenticated, service_role;

comment on function public.set_telemetry_alarm_workflow(uuid, text, text) is
  'Updates operator alarm workflow only for a fault in the operator selected telemetry region.';
