alter table public.telemetry_devices
  add column if not exists modem_imei text,
  add column if not exists sim_iccid text;

alter table public.telemetry_devices
  drop constraint if exists telemetry_devices_modem_imei_check,
  add constraint telemetry_devices_modem_imei_check
    check (modem_imei is null or modem_imei ~ '^\d{14,17}$'),
  drop constraint if exists telemetry_devices_sim_iccid_check,
  add constraint telemetry_devices_sim_iccid_check
    check (sim_iccid is null or sim_iccid ~ '^\d{18,22}$');

create unique index if not exists telemetry_devices_modem_imei_unique_idx
  on public.telemetry_devices(modem_imei)
  where modem_imei is not null;

create index if not exists telemetry_devices_sim_iccid_idx
  on public.telemetry_devices(sim_iccid)
  where sim_iccid is not null;
