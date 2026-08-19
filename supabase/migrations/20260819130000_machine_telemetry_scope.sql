alter table public.machines
  add column if not exists manufacturer text,
  add column if not exists machine_type text,
  add column if not exists telemetry_protocol text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'machines_telemetry_protocol_check'
      and conrelid = 'public.machines'::regclass
  ) then
    alter table public.machines
      add constraint machines_telemetry_protocol_check
      check (
        telemetry_protocol is null
        or lower(telemetry_protocol) in ('mdb', 'dex', 'pulse', 'marshall', 'other', 'unknown')
      );
  end if;
end $$;

update public.machines
set machine_type = coalesce(nullif(trim(model), ''), nullif(trim(machine_name), ''))
where nullif(trim(coalesce(machine_type, '')), '') is null;

create index if not exists machines_manufacturer_idx
  on public.machines (lower(manufacturer))
  where nullif(trim(manufacturer), '') is not null;

create index if not exists machines_type_idx
  on public.machines (lower(machine_type))
  where nullif(trim(machine_type), '') is not null;

create index if not exists machines_telemetry_protocol_idx
  on public.machines (lower(telemetry_protocol))
  where nullif(trim(telemetry_protocol), '') is not null;

comment on column public.machines.manufacturer is 'Machine brand or manufacturer displayed in the telemetry fleet register.';
comment on column public.machines.machine_type is 'Operational machine classification, such as tabletop coffee, floorstanding coffee, snack or cold drink.';
comment on column public.machines.telemetry_protocol is 'Primary machine communications protocol used by the assigned telemetry controller.';
