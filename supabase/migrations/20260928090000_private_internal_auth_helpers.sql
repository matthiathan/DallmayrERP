-- Remove direct browser execution from internal authorization helpers.
-- These helpers are not referenced by RLS policies and all current database callers
-- execute as SECURITY DEFINER, so browser roles do not need direct RPC access.
-- Keep service_role execution for maintenance/backward compatibility.

revoke execute on function public.current_app_account_scope() from authenticated;
revoke execute on function public.current_app_account_scope() from public, anon;
grant execute on function public.current_app_account_scope() to service_role;

revoke execute on function public.require_app_role(text[]) from authenticated;
revoke execute on function public.require_app_role(text[]) from public, anon;
grant execute on function public.require_app_role(text[]) to service_role;

revoke execute on function public.telemetry_region_allows_machine(uuid) from authenticated;
revoke execute on function public.telemetry_region_allows_machine(uuid) from public, anon;
grant execute on function public.telemetry_region_allows_machine(uuid) to service_role;
