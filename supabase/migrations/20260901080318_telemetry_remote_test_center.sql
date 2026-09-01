create table if not exists public.telemetry_test_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  requested_by uuid not null,
  status text not null default 'active'
    check (status in ('active','stopped','expired')),
  log_level text not null default 'detailed'
    check (log_level in ('normal','detailed','raw')),
  raw_mdb boolean not null default true,
  raw_dex boolean not null default true,
  modem_at boolean not null default false,
  http_trace boolean not null default true,
  cup_counters boolean not null default true,
  machine_identity boolean not null default true,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  acknowledged_at timestamptz,
  last_device_contact_at timestamptz,
  last_log_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > started_at),
  check (expires_at <= started_at + interval '60 minutes')
);

create unique index if not exists telemetry_test_sessions_one_active_device
  on public.telemetry_test_sessions(device_id)
  where status = 'active';

create index if not exists telemetry_test_sessions_device_started_idx
  on public.telemetry_test_sessions(device_id, started_at desc);

create table if not exists public.telemetry_test_commands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.telemetry_test_sessions(id) on delete cascade,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  command text not null
    check (command in ('STATUS','MACHINE IDENTITY','CUP COUNTERS','DATA USAGE','CELL PPP STATUS','WIRING','HELP')),
  status text not null default 'pending'
    check (status in ('pending','completed','failed')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  response_note text
);

create index if not exists telemetry_test_commands_pending_idx
  on public.telemetry_test_commands(device_id, created_at)
  where status = 'pending';

create table if not exists public.telemetry_debug_logs (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.telemetry_test_sessions(id) on delete cascade,
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  boot_id text not null default '',
  device_sequence bigint not null check (device_sequence >= 0),
  device_uptime_ms bigint check (device_uptime_ms is null or device_uptime_ms >= 0),
  category text,
  message text not null check (char_length(message) between 1 and 500),
  received_at timestamptz not null default now(),
  unique (session_id, boot_id, device_sequence)
);

create index if not exists telemetry_debug_logs_session_id_idx
  on public.telemetry_debug_logs(session_id, id);

create index if not exists telemetry_debug_logs_device_received_idx
  on public.telemetry_debug_logs(device_id, received_at desc);

alter table public.telemetry_test_sessions enable row level security;
alter table public.telemetry_test_commands enable row level security;
alter table public.telemetry_debug_logs enable row level security;

drop policy if exists telemetry_test_sessions_admin_select on public.telemetry_test_sessions;
create policy telemetry_test_sessions_admin_select
  on public.telemetry_test_sessions for select
  using (current_app_role() = 'admin');

drop policy if exists telemetry_test_sessions_admin_insert on public.telemetry_test_sessions;
create policy telemetry_test_sessions_admin_insert
  on public.telemetry_test_sessions for insert
  with check (current_app_role() = 'admin' and requested_by = auth.uid());

drop policy if exists telemetry_test_sessions_admin_update on public.telemetry_test_sessions;
create policy telemetry_test_sessions_admin_update
  on public.telemetry_test_sessions for update
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');

drop policy if exists telemetry_test_commands_admin_select on public.telemetry_test_commands;
create policy telemetry_test_commands_admin_select
  on public.telemetry_test_commands for select
  using (current_app_role() = 'admin');

drop policy if exists telemetry_test_commands_admin_insert on public.telemetry_test_commands;
create policy telemetry_test_commands_admin_insert
  on public.telemetry_test_commands for insert
  with check (current_app_role() = 'admin' and created_by = auth.uid());

drop policy if exists telemetry_debug_logs_admin_select on public.telemetry_debug_logs;
create policy telemetry_debug_logs_admin_select
  on public.telemetry_debug_logs for select
  using (current_app_role() = 'admin');

revoke all on public.telemetry_test_sessions from anon;
revoke all on public.telemetry_test_commands from anon;
revoke all on public.telemetry_debug_logs from anon;

grant select, insert, update on public.telemetry_test_sessions to authenticated;
grant select, insert on public.telemetry_test_commands to authenticated;
grant select on public.telemetry_debug_logs to authenticated;

create or replace function public.start_telemetry_test_session(
  p_device_id uuid,
  p_duration_minutes integer default 30,
  p_raw_mdb boolean default true,
  p_raw_dex boolean default true,
  p_http_trace boolean default true
)
returns public.telemetry_test_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.telemetry_test_sessions;
  v_duration integer;
begin
  if current_app_role() <> 'admin' then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.telemetry_devices
    where id = p_device_id and status = 'active'
  ) then
    raise exception 'Unknown or inactive telemetry device.' using errcode = '22023';
  end if;

  v_duration := greatest(5, least(coalesce(p_duration_minutes, 30), 60));

  update public.telemetry_test_sessions
  set status = case when expires_at <= now() then 'expired' else 'stopped' end,
      ended_at = now(),
      updated_at = now()
  where device_id = p_device_id
    and status = 'active';

  insert into public.telemetry_test_sessions (
    device_id, requested_by, status, log_level,
    raw_mdb, raw_dex, modem_at, http_trace,
    cup_counters, machine_identity, expires_at
  )
  values (
    p_device_id, auth.uid(), 'active', 'detailed',
    coalesce(p_raw_mdb, true), coalesce(p_raw_dex, true), false,
    coalesce(p_http_trace, true), true, true,
    now() + make_interval(mins => v_duration)
  )
  returning * into v_session;

  return v_session;
end;
$$;

create or replace function public.stop_telemetry_test_session(p_session_id uuid)
returns public.telemetry_test_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.telemetry_test_sessions;
begin
  if current_app_role() <> 'admin' then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  update public.telemetry_test_sessions
  set status = case when expires_at <= now() then 'expired' else 'stopped' end,
      ended_at = now(),
      updated_at = now()
  where id = p_session_id
    and status = 'active'
  returning * into v_session;

  if v_session.id is null then
    select * into v_session
    from public.telemetry_test_sessions
    where id = p_session_id;
  end if;

  return v_session;
end;
$$;

create or replace function public.queue_telemetry_test_command(
  p_session_id uuid,
  p_command text
)
returns public.telemetry_test_commands
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.telemetry_test_sessions;
  v_command text;
  v_row public.telemetry_test_commands;
begin
  if current_app_role() <> 'admin' then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  v_command := upper(trim(coalesce(p_command, '')));
  if v_command not in ('STATUS','MACHINE IDENTITY','CUP COUNTERS','DATA USAGE','CELL PPP STATUS','WIRING','HELP') then
    raise exception 'Command is not permitted in Remote Test Center.' using errcode = '22023';
  end if;

  select * into v_session
  from public.telemetry_test_sessions
  where id = p_session_id
    and status = 'active'
    and expires_at > now();

  if v_session.id is null then
    raise exception 'The Remote Test Center session is not active.' using errcode = '22023';
  end if;

  insert into public.telemetry_test_commands (
    session_id, device_id, command, status, created_by
  )
  values (
    v_session.id, v_session.device_id, v_command, 'pending', auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.start_telemetry_test_session(uuid, integer, boolean, boolean, boolean) from public, anon;
revoke all on function public.stop_telemetry_test_session(uuid) from public, anon;
revoke all on function public.queue_telemetry_test_command(uuid, text) from public, anon;

grant execute on function public.start_telemetry_test_session(uuid, integer, boolean, boolean, boolean) to authenticated;
grant execute on function public.stop_telemetry_test_session(uuid) to authenticated;
grant execute on function public.queue_telemetry_test_command(uuid, text) to authenticated;

alter publication supabase_realtime add table public.telemetry_debug_logs;
