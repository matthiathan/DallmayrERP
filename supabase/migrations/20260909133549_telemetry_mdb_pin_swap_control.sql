alter table public.telemetry_devices
  add column if not exists mdb_pin_swap boolean not null default false;
