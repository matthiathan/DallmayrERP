do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old_guard text := $guard$  if coalesce(v_role, '') not in ('admin', 'executive') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;$guard$;
  v_new_guard text := $guard$  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
  end if;$guard$;
begin
  select pg_get_functiondef('public.get_telemetry_reporting(text,text,text)'::regprocedure::oid)
    into v_definition;
  if position(v_old_guard in v_definition) = 0 then
    raise exception 'Expected get_telemetry_reporting access guard was not found';
  end if;
  v_rewritten := replace(v_definition, v_old_guard, v_new_guard);
  execute v_rewritten;

  select pg_get_functiondef('public.get_telemetry_dashboard(text,text)'::regprocedure::oid)
    into v_definition;
  if position(v_old_guard in v_definition) = 0 then
    raise exception 'Expected get_telemetry_dashboard access guard was not found';
  end if;
  v_rewritten := replace(v_definition, v_old_guard, v_new_guard);
  execute v_rewritten;
end;
$migration$;

revoke all on function public.get_telemetry_reporting(text,text,text) from public, anon;
revoke all on function public.get_telemetry_dashboard(text,text) from public, anon;
grant execute on function public.get_telemetry_reporting(text,text,text) to authenticated, service_role;
grant execute on function public.get_telemetry_dashboard(text,text) to authenticated, service_role;
