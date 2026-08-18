create index if not exists telemetry_enrollment_tokens_used_by_device_idx
  on public.telemetry_enrollment_tokens (used_by_device_id)
  where used_by_device_id is not null;
