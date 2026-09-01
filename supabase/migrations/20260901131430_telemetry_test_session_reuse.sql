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
    p_device_id, auth.uid(), 'active', 'detailed',
    coalesce(p_raw_mdb, true), coalesce(p_raw_dex, true), false,
    coalesce(p_http_trace, true), true, true,
    now() + make_interval(mins => v_duration)
  )
  returning * into v_session;

  return v_session;
end;
$$;
