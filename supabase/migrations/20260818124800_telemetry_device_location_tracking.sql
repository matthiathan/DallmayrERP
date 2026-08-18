alter table public.telemetry_devices
  add column if not exists location_enabled boolean not null default true,
  add column if not exists location_interval_minutes integer not null default 15,
  add column if not exists location_min_move_m integer not null default 50,
  add column if not exists last_location_at timestamptz,
  add column if not exists last_location_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'telemetry_devices_location_interval_check'
      and conrelid = 'public.telemetry_devices'::regclass
  ) then
    alter table public.telemetry_devices
      add constraint telemetry_devices_location_interval_check
      check (location_interval_minutes between 1 and 1440);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'telemetry_devices_location_move_check'
      and conrelid = 'public.telemetry_devices'::regclass
  ) then
    alter table public.telemetry_devices
      add constraint telemetry_devices_location_move_check
      check (location_min_move_m between 5 and 10000);
  end if;
end $$;

create table if not exists public.telemetry_device_location_state (
  device_id uuid primary key references public.telemetry_devices(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m real,
  altitude_m real,
  speed_mps real,
  satellites integer,
  hdop real,
  source text not null default 'gnss',
  fix_at timestamptz,
  received_at timestamptz not null default now(),
  movement_detected boolean not null default false,
  distance_from_previous_m real,
  updated_at timestamptz not null default now(),
  constraint telemetry_device_location_lat_check check (latitude between -90 and 90),
  constraint telemetry_device_location_lng_check check (longitude between -180 and 180),
  constraint telemetry_device_location_accuracy_check check (accuracy_m is null or accuracy_m >= 0),
  constraint telemetry_device_location_satellites_check check (satellites is null or satellites between 0 and 100),
  constraint telemetry_device_location_source_check check (source in ('gnss','site','manual','wifi','cellular','last_known'))
);

create table if not exists public.telemetry_device_location_history (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  machine_id uuid references public.machines(id) on delete set null,
  site_id uuid references public.customer_sites(id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m real,
  altitude_m real,
  speed_mps real,
  satellites integer,
  hdop real,
  source text not null,
  fix_at timestamptz,
  received_at timestamptz not null default now(),
  distance_from_previous_m real,
  reason text not null default 'movement',
  constraint telemetry_device_location_history_lat_check check (latitude between -90 and 90),
  constraint telemetry_device_location_history_lng_check check (longitude between -180 and 180)
);

alter table public.telemetry_device_location_state enable row level security;
alter table public.telemetry_device_location_history enable row level security;
revoke all on table public.telemetry_device_location_state from public, anon, authenticated;
revoke all on table public.telemetry_device_location_history from public, anon, authenticated;
grant select, insert, update, delete on table public.telemetry_device_location_state to service_role;
grant select, insert, update, delete on table public.telemetry_device_location_history to service_role;

create index if not exists telemetry_device_location_state_machine_idx
  on public.telemetry_device_location_state(machine_id);
create index if not exists telemetry_device_location_state_received_idx
  on public.telemetry_device_location_state(received_at desc);
create index if not exists telemetry_device_location_history_device_time_idx
  on public.telemetry_device_location_history(device_id, received_at desc);
create index if not exists telemetry_device_location_history_machine_time_idx
  on public.telemetry_device_location_history(machine_id, received_at desc)
  where machine_id is not null;

create or replace function public.telemetry_distance_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select 6371000.0 * 2.0 * asin(
    sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2.0), 2) +
      cos(radians(p_lat1)) * cos(radians(p_lat2)) *
      power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
    )
  );
$$;

create or replace function public.record_telemetry_device_location(
  p_device_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m real default null,
  p_altitude_m real default null,
  p_speed_mps real default null,
  p_satellites integer default null,
  p_hdop real default null,
  p_source text default 'gnss',
  p_fix_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_previous public.telemetry_device_location_state%rowtype;
  v_source text := lower(trim(coalesce(p_source, 'gnss')));
  v_distance double precision;
  v_moved boolean := false;
  v_reason text;
begin
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then
    raise exception 'Invalid latitude' using errcode = '22023';
  end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid longitude' using errcode = '22023';
  end if;
  if v_source not in ('gnss','site','manual','wifi','cellular','last_known') then
    raise exception 'Invalid location source' using errcode = '22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then raise exception 'Telemetry device not found' using errcode = '22023'; end if;
  if v_device.status <> 'active' then raise exception 'Telemetry device is not active' using errcode = '42501'; end if;
  if not v_device.location_enabled then
    return jsonb_build_object('accepted', true, 'location_ignored', true, 'reason', 'location_disabled');
  end if;

  select * into v_previous
  from public.telemetry_device_location_state
  where device_id = p_device_id;

  if found then
    v_distance := public.telemetry_distance_m(v_previous.latitude, v_previous.longitude, p_latitude, p_longitude);
    v_moved := v_distance >= v_device.location_min_move_m;
  else
    v_distance := null;
    v_moved := false;
  end if;

  insert into public.telemetry_device_location_state (
    device_id, machine_id, site_id, latitude, longitude, accuracy_m, altitude_m,
    speed_mps, satellites, hdop, source, fix_at, received_at,
    movement_detected, distance_from_previous_m, updated_at
  ) values (
    v_device.id, v_device.machine_id, v_device.site_id, p_latitude, p_longitude,
    p_accuracy_m, p_altitude_m, p_speed_mps, p_satellites, p_hdop,
    v_source, p_fix_at, now(), v_moved, v_distance, now()
  )
  on conflict (device_id) do update set
    machine_id = excluded.machine_id,
    site_id = excluded.site_id,
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_m = excluded.accuracy_m,
    altitude_m = excluded.altitude_m,
    speed_mps = excluded.speed_mps,
    satellites = excluded.satellites,
    hdop = excluded.hdop,
    source = excluded.source,
    fix_at = excluded.fix_at,
    received_at = now(),
    movement_detected = excluded.movement_detected,
    distance_from_previous_m = excluded.distance_from_previous_m,
    updated_at = now();

  update public.telemetry_devices
  set last_location_at = now(),
      last_location_source = v_source,
      updated_at = now()
  where id = v_device.id;

  if v_previous.device_id is null then
    v_reason := 'first_fix';
  elsif v_moved then
    v_reason := 'movement';
  else
    v_reason := null;
  end if;

  if v_reason is not null then
    insert into public.telemetry_device_location_history (
      device_id, machine_id, site_id, latitude, longitude, accuracy_m, altitude_m,
      speed_mps, satellites, hdop, source, fix_at, received_at,
      distance_from_previous_m, reason
    ) values (
      v_device.id, v_device.machine_id, v_device.site_id, p_latitude, p_longitude,
      p_accuracy_m, p_altitude_m, p_speed_mps, p_satellites, p_hdop,
      v_source, p_fix_at, now(), v_distance, v_reason
    );
  end if;

  return jsonb_build_object(
    'accepted', true,
    'location_recorded', true,
    'movement_detected', v_moved,
    'distance_from_previous_m', v_distance,
    'history_written', v_reason is not null,
    'source', v_source
  );
end;
$$;

revoke all on function public.record_telemetry_device_location(uuid,double precision,double precision,real,real,real,integer,real,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_telemetry_device_location(uuid,double precision,double precision,real,real,real,integer,real,text,timestamptz) to service_role;

create or replace function public.set_telemetry_device_location_control(
  p_device_code text,
  p_location_enabled boolean default null,
  p_location_interval_minutes integer default null,
  p_location_min_move_m integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_device_id uuid;
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','operations') then
    raise exception 'Only admin or operations may control telemetry device location settings' using errcode = '42501';
  end if;

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code);

  if not found then raise exception 'Telemetry device not found' using errcode = '22023'; end if;
  if p_location_interval_minutes is not null and p_location_interval_minutes not between 1 and 1440 then
    raise exception 'Location interval must be 1 to 1440 minutes' using errcode = '22023';
  end if;
  if p_location_min_move_m is not null and p_location_min_move_m not between 5 and 10000 then
    raise exception 'Movement threshold must be 5 to 10000 metres' using errcode = '22023';
  end if;

  update public.telemetry_devices
  set location_enabled = coalesce(p_location_enabled, location_enabled),
      location_interval_minutes = coalesce(p_location_interval_minutes, location_interval_minutes),
      location_min_move_m = coalesce(p_location_min_move_m, location_min_move_m),
      updated_at = now()
  where id = v_device_id;

  select jsonb_build_object(
    'device_code', device_code,
    'location_enabled', location_enabled,
    'location_interval_minutes', location_interval_minutes,
    'location_min_move_m', location_min_move_m
  ) into v_result
  from public.telemetry_devices
  where id = v_device_id;

  return v_result;
end;
$$;

revoke all on function public.set_telemetry_device_location_control(text,boolean,integer,integer) from public, anon;
grant execute on function public.set_telemetry_device_location_control(text,boolean,integer,integer) to authenticated;

create or replace function public.get_telemetry_location_map()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','executive','operations') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', d.id,
    'device_code', d.device_code,
    'machine_id', d.machine_id,
    'machine_name', m.machine_name,
    'serial_number', m.serial_number,
    'branch', coalesce(m.branch, s.branch, 'unassigned'),
    'machine_status', coalesce(ms.machine_status, 'unknown'),
    'active_fault_count', coalesce(ms.active_fault_count, 0),
    'last_seen_at', d.last_seen_at,
    'last_transport', d.last_transport,
    'location_enabled', d.location_enabled,
    'location_interval_minutes', d.location_interval_minutes,
    'location_min_move_m', d.location_min_move_m,
    'latitude', coalesce(ls.latitude, s.latitude::double precision),
    'longitude', coalesce(ls.longitude, s.longitude::double precision),
    'accuracy_m', ls.accuracy_m,
    'altitude_m', ls.altitude_m,
    'speed_mps', ls.speed_mps,
    'satellites', ls.satellites,
    'hdop', ls.hdop,
    'location_source', case
      when ls.device_id is not null then ls.source
      when s.latitude is not null and s.longitude is not null then 'site'
      else null
    end,
    'location_fix_at', ls.fix_at,
    'location_received_at', ls.received_at,
    'movement_detected', coalesce(ls.movement_detected, false),
    'distance_from_previous_m', ls.distance_from_previous_m,
    'location_stale', case
      when ls.device_id is null then false
      else ls.received_at < now() - make_interval(mins => greatest(d.location_interval_minutes * 3, 30))
    end,
    'has_location', (ls.device_id is not null or (s.latitude is not null and s.longitude is not null))
  ) order by d.device_code), '[]'::jsonb)
  into v_result
  from public.telemetry_devices d
  left join public.machines m on m.id = d.machine_id
  left join public.customer_sites s on s.id = coalesce(d.site_id, m.site_id)
  left join public.telemetry_machine_state ms on ms.device_id = d.id
  left join public.telemetry_device_location_state ls on ls.device_id = d.id
  where d.status = 'active';

  return v_result;
end;
$$;

revoke all on function public.get_telemetry_location_map() from public, anon;
grant execute on function public.get_telemetry_location_map() to authenticated;