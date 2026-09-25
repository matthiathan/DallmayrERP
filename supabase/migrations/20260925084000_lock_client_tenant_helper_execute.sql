-- Close the anonymous SECURITY DEFINER execute surface introduced by the
-- customer-tenant helper functions. Authenticated execution is retained because
-- these helpers participate in RLS and authenticated telemetry authorization.

revoke all on function public.telemetry_account_allows_fault(uuid) from public, anon;
grant execute on function public.telemetry_account_allows_fault(uuid) to authenticated, service_role;

revoke all on function public.telemetry_account_allows_session(uuid) from public, anon;
grant execute on function public.telemetry_account_allows_session(uuid) to authenticated, service_role;
