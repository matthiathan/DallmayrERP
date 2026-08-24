revoke all on function public.delete_telemetry_device(uuid, text) from public;
revoke all on function public.delete_telemetry_device(uuid, text) from anon;
grant execute on function public.delete_telemetry_device(uuid, text) to authenticated;
grant execute on function public.delete_telemetry_device(uuid, text) to service_role;

notify pgrst, 'reload schema';
