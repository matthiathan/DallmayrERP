-- These superseded SECURITY DEFINER RPCs are no longer called by the current
-- telemetry application. Keep them available to the service role for maintenance
-- compatibility, but remove authenticated/anonymous client execution so callers
-- cannot bypass the current regional, atomic device-configuration workflow.

revoke execute on function public.set_telemetry_device_control(text, text, text, boolean, boolean) from authenticated;
revoke execute on function public.set_telemetry_device_control(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.set_telemetry_device_control(text, text, text, boolean, boolean) to service_role;

revoke execute on function public.set_telemetry_device_location_control(text, boolean, integer, integer) from authenticated;
revoke execute on function public.set_telemetry_device_location_control(text, boolean, integer, integer) from public, anon;
grant execute on function public.set_telemetry_device_location_control(text, boolean, integer, integer) to service_role;

revoke execute on function public.set_telemetry_device_mode(text, text) from authenticated;
revoke execute on function public.set_telemetry_device_mode(text, text) from public, anon;
grant execute on function public.set_telemetry_device_mode(text, text) to service_role;

revoke execute on function public.set_telemetry_prepaid_balance_control(text, integer, integer, integer, integer) from authenticated;
revoke execute on function public.set_telemetry_prepaid_balance_control(text, integer, integer, integer, integer) from public, anon;
grant execute on function public.set_telemetry_prepaid_balance_control(text, integer, integer, integer, integer) to service_role;
