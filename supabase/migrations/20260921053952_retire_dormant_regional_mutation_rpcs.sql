-- These SECURITY DEFINER mutation entry points are no longer called by the
-- current telemetry application. Remove authenticated/anonymous execution so
-- operators cannot bypass the current region-aware workflows by calling stale
-- RPCs directly. Preserve service-role execution for maintenance compatibility.

revoke execute on function public.set_customer_site_telemetry_region(uuid, text) from authenticated;
revoke execute on function public.set_customer_site_telemetry_region(uuid, text) from public, anon;
grant execute on function public.set_customer_site_telemetry_region(uuid, text) to service_role;

revoke execute on function public.set_device_telemetry_region(uuid, text) from authenticated;
revoke execute on function public.set_device_telemetry_region(uuid, text) from public, anon;
grant execute on function public.set_device_telemetry_region(uuid, text) to service_role;

revoke execute on function public.set_telemetry_fleet_attention_workflow(text, uuid, text, text, timestamp with time zone, text) from authenticated;
revoke execute on function public.set_telemetry_fleet_attention_workflow(text, uuid, text, text, timestamp with time zone, text) from public, anon;
grant execute on function public.set_telemetry_fleet_attention_workflow(text, uuid, text, text, timestamp with time zone, text) to service_role;
