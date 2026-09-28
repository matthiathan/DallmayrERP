-- Retire legacy browser access to the August telemetry interval RPCs.
-- Current device configuration uses the newer regional/atomic workflow on main.
-- Keep service_role execution for maintenance/backward compatibility only.

revoke execute on function public.set_telemetry_policy_intervals(text, integer, integer, integer) from authenticated;
revoke execute on function public.set_telemetry_policy_intervals(text, integer, integer, integer) from public, anon;
grant execute on function public.set_telemetry_policy_intervals(text, integer, integer, integer) to service_role;

revoke execute on function public.get_telemetry_policy_intervals() from authenticated;
revoke execute on function public.get_telemetry_policy_intervals() from public, anon;
grant execute on function public.get_telemetry_policy_intervals() to service_role;
