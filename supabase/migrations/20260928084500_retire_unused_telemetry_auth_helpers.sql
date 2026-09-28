-- Retire browser execution from dormant telemetry authorization helpers.
-- These helpers are not referenced by current RLS policies or database functions.
-- Keep service_role execution for maintenance/backward compatibility.

revoke execute on function public.telemetry_account_allows_fault(uuid) from authenticated;
revoke execute on function public.telemetry_account_allows_fault(uuid) from public, anon;
grant execute on function public.telemetry_account_allows_fault(uuid) to service_role;

revoke execute on function public.telemetry_account_allows_session(uuid) from authenticated;
revoke execute on function public.telemetry_account_allows_session(uuid) from public, anon;
grant execute on function public.telemetry_account_allows_session(uuid) to service_role;

revoke execute on function public.telemetry_region_allows_session(uuid) from authenticated;
revoke execute on function public.telemetry_region_allows_session(uuid) from public, anon;
grant execute on function public.telemetry_region_allows_session(uuid) to service_role;
