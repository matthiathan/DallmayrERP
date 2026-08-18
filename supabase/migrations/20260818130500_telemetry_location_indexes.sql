create index if not exists telemetry_device_location_state_site_idx
  on public.telemetry_device_location_state(site_id)
  where site_id is not null;

create index if not exists telemetry_device_location_history_site_time_idx
  on public.telemetry_device_location_history(site_id, received_at desc)
  where site_id is not null;
