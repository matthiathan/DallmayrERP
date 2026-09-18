-- Region-scoped detail wrappers must not inherit PostgreSQL's default PUBLIC EXECUTE.
-- They remain available to signed-in app users and service-role backend flows.

revoke execute on function public.get_telemetry_machine_identity(uuid) from public,anon;
grant execute on function public.get_telemetry_machine_identity(uuid) to authenticated,service_role;

revoke execute on function public.get_telemetry_device_config_history(uuid,integer) from public,anon;
grant execute on function public.get_telemetry_device_config_history(uuid,integer) to authenticated,service_role;

revoke execute on function public.resolve_telemetry_device_profile(uuid) from public,anon;
grant execute on function public.resolve_telemetry_device_profile(uuid) to authenticated,service_role;

revoke execute on function public.resolve_effective_telemetry_profile_key(uuid,uuid) from public,anon;
grant execute on function public.resolve_effective_telemetry_profile_key(uuid,uuid) to authenticated,service_role;
