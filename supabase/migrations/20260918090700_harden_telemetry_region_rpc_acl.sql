-- Keep internal helper functions out of the public API and remove a legacy
-- anonymous grant from live telemetry status. Public management RPCs keep their
-- authenticated grants and enforce roles internally.

revoke execute on function public.get_telemetry_live_status() from public,anon;
grant execute on function public.get_telemetry_live_status() to authenticated,service_role;

revoke execute on function public.can_manage_telemetry_regions() from authenticated;
revoke execute on function public.assert_telemetry_region_selected() from authenticated;
