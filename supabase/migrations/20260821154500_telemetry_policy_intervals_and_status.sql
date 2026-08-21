-- Make telemetry cadence the single source of truth for device health and interval management.

create or replace function public.get_telemetry_policy_intervals()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text := public.current_app_role();
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin', 'operations', 'executive') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'policy_code', p.policy_code,
    'name', p.name,
    'mode', p.mode,
    'counter_interval_minutes', p.counter_interval_minutes,
    'heartbeat_interval_minutes', p.heartbeat_interval_minutes,
    'config_refresh_minutes', p.config_refresh_minutes,
    'updated_at', p.updated_at
  ) order by case p.policy_code when 'live' then 1 when 'daily' then 2 when 'monthly' then 3 else 4 end, p.policy_code), '[]'::jsonb)
  into v_result
  from public.telemetry_policies p
  where p.policy_code in ('live', 'daily', 'monthly');

  return v_result;
end;
$function$;

create or replace function public.set_telemetry_policy_intervals(
  p_policy_code text,
  p_counter_interval_minutes integer,
  p_heartbeat_interval_minutes integer,
  p_config_refresh_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text := public.current_app_role();
  v_code text := lower(trim(coalesce(p_policy_code, '')));
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin', 'operations') then
    raise exception 'Only admin or operations may change telemetry intervals' using errcode = '42501';
  end if;

  if v_code not in ('live', 'daily', 'monthly') then
    raise exception 'Policy must be live, daily, or monthly' using errcode = '22023';
  end if;
  if coalesce(p_counter_interval_minutes, 0) < 1 then
    raise exception 'Counter interval must be at least 1 minute' using errcode = '22023';
  end if;
  if coalesce(p_heartbeat_interval_minutes, 0) < 1 then
    raise exception 'Heartbeat interval must be at least 1 minute' using errcode = '22023';
  end if;
  if coalesce(p_config_refresh_minutes, 0) < 1 or p_config_refresh_minutes > 1440 then
    raise exception 'Config refresh interval must be between 1 and 1440 minutes' using errcode = '22023';
  end if;

  update public.telemetry_policies
  set counter_interval_minutes = p_counter_interval_minutes,
      heartbeat_interval_minutes = p_heartbeat_interval_minutes,
      config_refresh_minutes = p_config_refresh_minutes,
      updated_at = now()
  where policy_code = v_code;

  if not found then
    raise exception 'Telemetry policy not found' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'policy_code', p.policy_code,
    'name', p.name,
    'mode', p.mode,
    'counter_interval_minutes', p.counter_interval_minutes,
    'heartbeat_interval_minutes', p.heartbeat_interval_minutes,
    'config_refresh_minutes', p.config_refresh_minutes,
    'updated_at', p.updated_at
  ) into v_result
  from public.telemetry_policies p
  where p.policy_code = v_code;

  return v_result;
end;
$function$;

create or replace function public.get_telemetry_device_policy_states()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_role text := public.current_app_role();
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin', 'operations', 'executive') then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'device_id', d.id,
    'device_code', d.device_code,
    'mode', ep.policy ->> 'mode',
    'policy_code', ep.policy ->> 'policy_code',
    'counter_interval_minutes', (ep.policy ->> 'counter_interval_minutes')::integer,
    'heartbeat_interval_minutes', (ep.policy ->> 'heartbeat_interval_minutes')::integer,
    'config_refresh_minutes', (ep.policy ->> 'config_refresh_minutes')::integer,
    'last_seen_at', d.last_seen_at,
    'online', case
      when d.last_seen_at is null then false
      else d.last_seen_at >= now() - make_interval(mins => 2 * greatest(1, (ep.policy ->> 'heartbeat_interval_minutes')::integer))
    end
  ) order by d.device_code), '[]'::jsonb)
  into v_result
  from public.telemetry_devices d
  left join lateral (select public.get_effective_telemetry_policy(d.id) as policy) ep on true
  where d.status = 'active';

  return v_result;
end;
$function$;

revoke all on function public.get_telemetry_policy_intervals() from public, anon;
revoke all on function public.set_telemetry_policy_intervals(text, integer, integer, integer) from public, anon;
revoke all on function public.get_telemetry_device_policy_states() from public, anon;
grant execute on function public.get_telemetry_policy_intervals() to authenticated, service_role;
grant execute on function public.set_telemetry_policy_intervals(text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.get_telemetry_device_policy_states() to authenticated, service_role;

-- Keep the existing dashboard RPC contract, but replace the legacy fixed 30-minute
-- health test with the effective heartbeat policy (two missed intervals = offline).
do $migration$
declare
  v_definition text;
  v_old_online text := $$'online_devices', (select count(*) from public.telemetry_devices where status = 'active' and last_seen_at >= now() - interval '30 minutes')$$;
  v_new_online text := $$'online_devices', (select count(*) from public.telemetry_devices d left join lateral (select public.get_effective_telemetry_policy(d.id) as policy) ep on true where d.status = 'active' and d.last_seen_at is not null and d.last_seen_at >= now() - make_interval(mins => 2 * greatest(1, (ep.policy ->> 'heartbeat_interval_minutes')::integer)))$$;
  v_old_offline text := $$'offline_devices', (select count(*) from public.telemetry_devices where status = 'active' and (last_seen_at is null or last_seen_at < now() - interval '30 minutes'))$$;
  v_new_offline text := $$'offline_devices', (select count(*) from public.telemetry_devices d left join lateral (select public.get_effective_telemetry_policy(d.id) as policy) ep on true where d.status = 'active' and (d.last_seen_at is null or d.last_seen_at < now() - make_interval(mins => 2 * greatest(1, (ep.policy ->> 'heartbeat_interval_minutes')::integer))))$$;
  v_old_mode text := $$'telemetry_mode', coalesce(ms.telemetry_mode, ep.policy ->> 'mode', 'live'),$$;
  v_new_mode text := $$'telemetry_mode', coalesce(ms.telemetry_mode, ep.policy ->> 'mode', 'live'),
        'counter_interval_minutes', (ep.policy ->> 'counter_interval_minutes')::integer,
        'heartbeat_interval_minutes', (ep.policy ->> 'heartbeat_interval_minutes')::integer,
        'config_refresh_minutes', (ep.policy ->> 'config_refresh_minutes')::integer,
        'online', case when d.last_seen_at is null then false else d.last_seen_at >= now() - make_interval(mins => 2 * greatest(1, (ep.policy ->> 'heartbeat_interval_minutes')::integer)) end,$$;
begin
  select pg_get_functiondef('public.get_telemetry_dashboard(text,text)'::regprocedure) into v_definition;

  if position(v_old_online in v_definition) = 0 or position(v_old_offline in v_definition) = 0 or position(v_old_mode in v_definition) = 0 then
    raise exception 'get_telemetry_dashboard definition does not match expected telemetry status contract';
  end if;

  v_definition := replace(v_definition, v_old_online, v_new_online);
  v_definition := replace(v_definition, v_old_offline, v_new_offline);
  v_definition := replace(v_definition, v_old_mode, v_new_mode);
  execute v_definition;
end;
$migration$;
