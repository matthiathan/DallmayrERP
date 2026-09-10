create or replace function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.is_active = true
  );
$$;

revoke all on function public.is_active_app_user() from public, anon;
grant execute on function public.is_active_app_user() to authenticated;

drop policy if exists telemetry_test_sessions_admin_select on public.telemetry_test_sessions;
drop policy if exists telemetry_test_sessions_admin_insert on public.telemetry_test_sessions;
drop policy if exists telemetry_test_sessions_admin_update on public.telemetry_test_sessions;
drop policy if exists telemetry_test_sessions_authenticated_select on public.telemetry_test_sessions;
drop policy if exists telemetry_test_sessions_authenticated_insert on public.telemetry_test_sessions;
drop policy if exists telemetry_test_sessions_authenticated_update on public.telemetry_test_sessions;

create policy telemetry_test_sessions_authenticated_select
  on public.telemetry_test_sessions for select
  to authenticated
  using (public.is_active_app_user());

create policy telemetry_test_sessions_authenticated_insert
  on public.telemetry_test_sessions for insert
  to authenticated
  with check (public.is_active_app_user() and requested_by = (select auth.uid()));

create policy telemetry_test_sessions_authenticated_update
  on public.telemetry_test_sessions for update
  to authenticated
  using (public.is_active_app_user())
  with check (public.is_active_app_user());

drop policy if exists telemetry_test_commands_admin_select on public.telemetry_test_commands;
drop policy if exists telemetry_test_commands_admin_insert on public.telemetry_test_commands;
drop policy if exists telemetry_test_commands_authenticated_select on public.telemetry_test_commands;
drop policy if exists telemetry_test_commands_authenticated_insert on public.telemetry_test_commands;

create policy telemetry_test_commands_authenticated_select
  on public.telemetry_test_commands for select
  to authenticated
  using (public.is_active_app_user());

create policy telemetry_test_commands_authenticated_insert
  on public.telemetry_test_commands for insert
  to authenticated
  with check (public.is_active_app_user() and created_by = (select auth.uid()));

drop policy if exists telemetry_debug_logs_admin_select on public.telemetry_debug_logs;
drop policy if exists telemetry_debug_logs_authenticated_select on public.telemetry_debug_logs;

create policy telemetry_debug_logs_authenticated_select
  on public.telemetry_debug_logs for select
  to authenticated
  using (public.is_active_app_user());

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
  v_requested_expiry timestamptz;
begin
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.telemetry_devices
    where id = p_device_id and status = 'active'
  ) then
    raise exception 'Unknown or inactive telemetry device.' using errcode = '22023';
  end if;

  v_duration := greatest(5, least(coalesce(p_duration_minutes, 30), 60));

  update public.telemetry_test_sessions
  set status = 'expired',
      ended_at = coalesce(ended_at, now()),
      updated_at = now()
  where device_id = p_device_id
    and status = 'active'
    and expires_at <= now();

  select *
    into v_session
  from public.telemetry_test_sessions
  where device_id = p_device_id
    and status = 'active'
    and expires_at > now()
  order by started_at desc
  limit 1
  for update;

  if v_session.id is not null then
    v_requested_expiry := least(
      v_session.started_at + interval '60 minutes',
      greatest(v_session.expires_at, now() + make_interval(mins => v_duration))
    );

    update public.telemetry_test_sessions
    set raw_mdb = coalesce(p_raw_mdb, raw_mdb),
        raw_dex = coalesce(p_raw_dex, raw_dex),
        http_trace = coalesce(p_http_trace, http_trace),
        expires_at = v_requested_expiry,
        updated_at = now()
    where id = v_session.id
    returning * into v_session;

    return v_session;
  end if;

  insert into public.telemetry_test_sessions (
    device_id, requested_by, status, log_level,
    raw_mdb, raw_dex, modem_at, http_trace,
    cup_counters, machine_identity, expires_at
  )
  values (
    p_device_id, (select auth.uid()), 'active', 'detailed',
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
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
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
  if not public.is_active_app_user() then
    raise exception 'Authenticated DallmayrERP access is required.' using errcode = '42501';
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
    v_session.id, v_session.device_id, v_command, 'pending', (select auth.uid())
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
