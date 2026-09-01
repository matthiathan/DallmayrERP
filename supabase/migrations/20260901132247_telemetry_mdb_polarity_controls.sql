alter table public.telemetry_devices
  add column if not exists mdb_master_polarity text not null default 'auto',
  add column if not exists mdb_slave_polarity text not null default 'auto';

alter table public.telemetry_devices
  drop constraint if exists telemetry_devices_mdb_master_polarity_check,
  add constraint telemetry_devices_mdb_master_polarity_check
    check (mdb_master_polarity in ('auto','normal','inverted')),
  drop constraint if exists telemetry_devices_mdb_slave_polarity_check,
  add constraint telemetry_devices_mdb_slave_polarity_check
    check (mdb_slave_polarity in ('auto','normal','inverted'));
