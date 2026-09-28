-- Enforce the read-only client boundary on commissioning, prepaid-action,
-- and alarm-workflow mutation RPCs while preserving existing internal behavior.

alter function public.open_telemetry_enrollment_window(integer, integer, text, text) set schema private;
alter function private.open_telemetry_enrollment_window(integer, integer, text, text) rename to open_telemetry_enrollment_window_internal_v1;
revoke execute on function private.open_telemetry_enrollment_window_internal_v1(integer, integer, text, text) from public, anon, authenticated;
grant execute on function private.open_telemetry_enrollment_window_internal_v1(integer, integer, text, text) to service_role;

alter function public.close_telemetry_enrollment_window() set schema private;
alter function private.close_telemetry_enrollment_window() rename to close_telemetry_enrollment_window_internal_v1;
revoke execute on function private.close_telemetry_enrollment_window_internal_v1() from public, anon, authenticated;
grant execute on function private.close_telemetry_enrollment_window_internal_v1() to service_role;

alter function public.request_telemetry_prepaid_balance(text) set schema private;
alter function private.request_telemetry_prepaid_balance(text) rename to request_telemetry_prepaid_balance_internal_v1;
revoke execute on function private.request_telemetry_prepaid_balance_internal_v1(text) from public, anon, authenticated;
grant execute on function private.request_telemetry_prepaid_balance_internal_v1(text) to service_role;

alter function public.set_telemetry_alarm_workflow(uuid, text, text) set schema private;
alter function private.set_telemetry_alarm_workflow(uuid, text, text) rename to set_telemetry_alarm_workflow_internal_v1;
revoke execute on function private.set_telemetry_alarm_workflow_internal_v1(uuid, text, text) from public, anon, authenticated;
grant execute on function private.set_telemetry_alarm_workflow_internal_v1(uuid, text, text) to service_role;

create or replace function public.open_telemetry_enrollment_window(
  p_minutes integer default 10,
  p_max_devices integer default 1,
  p_label text default null,
  p_expected_hardware_uid text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.open_telemetry_enrollment_window_internal_v1(
    p_minutes, p_max_devices, p_label, p_expected_hardware_uid
  );
end;
$function$;
revoke execute on function public.open_telemetry_enrollment_window(integer, integer, text, text) from public, anon;
grant execute on function public.open_telemetry_enrollment_window(integer, integer, text, text) to authenticated, service_role;

create or replace function public.close_telemetry_enrollment_window()
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.close_telemetry_enrollment_window_internal_v1();
end;
$function$;
revoke execute on function public.close_telemetry_enrollment_window() from public, anon;
grant execute on function public.close_telemetry_enrollment_window() to authenticated, service_role;

create or replace function public.request_telemetry_prepaid_balance(p_device_code text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.request_telemetry_prepaid_balance_internal_v1(p_device_code);
end;
$function$;
revoke execute on function public.request_telemetry_prepaid_balance(text) from public, anon;
grant execute on function public.request_telemetry_prepaid_balance(text) to authenticated, service_role;

create or replace function public.set_telemetry_alarm_workflow(
  p_fault_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $function$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if not public.is_active_app_user() or not public.is_dallmayr_app_user() then
      raise exception 'An active internal Dallmayr account is required.' using errcode = '42501';
    end if;
  end if;
  return private.set_telemetry_alarm_workflow_internal_v1(p_fault_id, p_action, p_note);
end;
$function$;
revoke execute on function public.set_telemetry_alarm_workflow(uuid, text, text) from public, anon;
grant execute on function public.set_telemetry_alarm_workflow(uuid, text, text) to authenticated, service_role;
