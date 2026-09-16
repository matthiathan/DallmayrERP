-- The platform diagnostic catalogue is maintained by trusted backend migrations/service-role only.
-- App users may read it, but must not write it directly.

revoke insert, update, delete, truncate, references, trigger
  on table public.telemetry_platform_fault_codes
  from authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.telemetry_platform_fault_codes
  from anon;

grant select on table public.telemetry_platform_fault_codes to authenticated;
grant all on table public.telemetry_platform_fault_codes to service_role;
