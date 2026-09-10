drop policy if exists telemetry_fault_events_read on public.telemetry_fault_events;

create policy telemetry_fault_events_read
on public.telemetry_fault_events
for select
to authenticated
using (public.is_active_app_user());
