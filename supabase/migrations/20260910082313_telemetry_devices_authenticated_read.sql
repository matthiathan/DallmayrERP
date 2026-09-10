drop policy if exists telemetry_devices_read_admin_exec on public.telemetry_devices;
drop policy if exists telemetry_devices_authenticated_read on public.telemetry_devices;

create policy telemetry_devices_authenticated_read
  on public.telemetry_devices
  for select
  to authenticated
  using (public.is_active_app_user());
