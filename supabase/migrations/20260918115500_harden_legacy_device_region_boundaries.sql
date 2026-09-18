-- Preserve older telemetry-control RPCs for backwards compatibility, but make
-- their SECURITY DEFINER target resolution obey the operator's selected region.

create or replace function public.set_telemetry_device_control(
  p_device_code text,
  p_mode text default null,
  p_transport_preference text default null,
  p_wifi_enabled boolean default null,
  p_cellular_enabled boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text;
  v_device_id uuid;
  v_policy_id uuid;
  v_mode text := lower(trim(coalesce(p_mode, '')));
  v_transport text := lower(trim(coalesce(p_transport_preference, '')));
  v_effective_transport text;
  v_effective_wifi boolean;
  v_effective_cellular boolean;
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','operations') then
    raise exception 'Only admin or operations may control telemetry devices' using errcode = '42501';
  end if;
  v_region := public.assert_telemetry_region_selected();

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code)
    and telemetry_region = v_region;

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;

  if p_mode is not null then
    if v_mode in ('inherit','default','') then
      update public.telemetry_devices
      set telemetry_policy_id = null, updated_at = now()
      where id = v_device_id and telemetry_region = v_region;
    else
      if v_mode not in ('live','daily','monthly') then
        raise exception 'Mode must be live, daily, monthly, or inherit' using errcode = '22023';
      end if;
      select id into v_policy_id
      from public.telemetry_policies
      where policy_code = v_mode;
      if v_policy_id is null then
        raise exception 'Telemetry policy not found' using errcode = '22023';
      end if;
      update public.telemetry_devices
      set telemetry_policy_id = v_policy_id, updated_at = now()
      where id = v_device_id and telemetry_region = v_region;
    end if;
  end if;

  if p_transport_preference is not null then
    if v_transport not in ('auto','wifi','cellular') then
      raise exception 'Transport must be auto, wifi, or cellular' using errcode = '22023';
    end if;
    update public.telemetry_devices
    set transport_preference = v_transport, updated_at = now()
    where id = v_device_id and telemetry_region = v_region;
  end if;

  if p_wifi_enabled is not null or p_cellular_enabled is not null then
    update public.telemetry_devices
    set wifi_enabled = coalesce(p_wifi_enabled, wifi_enabled),
        cellular_enabled = coalesce(p_cellular_enabled, cellular_enabled),
        updated_at = now()
    where id = v_device_id and telemetry_region = v_region;
  end if;

  select transport_preference, wifi_enabled, cellular_enabled
    into v_effective_transport, v_effective_wifi, v_effective_cellular
  from public.telemetry_devices
  where id = v_device_id and telemetry_region = v_region;

  if not coalesce(v_effective_wifi, false) and not coalesce(v_effective_cellular, false) then
    raise exception 'At least one telemetry transport must be enabled' using errcode = '22023';
  end if;
  if v_effective_transport = 'wifi' and not coalesce(v_effective_wifi, false) then
    raise exception 'Wi-Fi must be enabled when transport preference is Wi-Fi' using errcode = '22023';
  end if;
  if v_effective_transport = 'cellular' and not coalesce(v_effective_cellular, false) then
    raise exception 'Cellular must be enabled when transport preference is cellular' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'device_code', d.device_code,
    'transport_preference', d.transport_preference,
    'wifi_enabled', d.wifi_enabled,
    'cellular_enabled', d.cellular_enabled,
    'policy', public.get_effective_telemetry_policy(d.id)
  )
  into v_result
  from public.telemetry_devices d
  where d.id = v_device_id and d.telemetry_region = v_region;

  return v_result;
end;
$$;

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
  v_region text;
  v_device_id uuid;
  v_result jsonb;
begin
  if coalesce(v_role, '') not in ('admin','operations') then
    raise exception 'Only admin or operations may control telemetry device location settings' using errcode = '42501';
  end if;
  v_region := public.assert_telemetry_region_selected();

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code)
    and telemetry_region = v_region;

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
  where id = v_device_id and telemetry_region = v_region;

  select jsonb_build_object(
    'device_code', device_code,
    'location_enabled', location_enabled,
    'location_interval_minutes', location_interval_minutes,
    'location_min_move_m', location_min_move_m
  ) into v_result
  from public.telemetry_devices
  where id = v_device_id and telemetry_region = v_region;

  return v_result;
end;
$$;

create or replace function public.set_telemetry_device_mode(
  p_device_code text,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text;
  v_policy_id uuid;
  v_device_id uuid;
  v_normalized_mode text := lower(trim(coalesce(p_mode, '')));
begin
  if v_role not in ('admin', 'operations') then
    raise exception 'Only admin or operations may change telemetry mode' using errcode = '42501';
  end if;
  v_region := public.assert_telemetry_region_selected();

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code)
    and telemetry_region = v_region;

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;

  if v_normalized_mode in ('inherit', 'default', '') then
    update public.telemetry_devices
      set telemetry_policy_id = null, updated_at = now()
    where id = v_device_id and telemetry_region = v_region;
  else
    if v_normalized_mode not in ('live', 'daily', 'monthly') then
      raise exception 'Mode must be live, daily, monthly, or inherit' using errcode = '22023';
    end if;

    select id into v_policy_id
    from public.telemetry_policies
    where policy_code = v_normalized_mode;

    if v_policy_id is null then
      raise exception 'Telemetry policy not found' using errcode = '22023';
    end if;

    update public.telemetry_devices
      set telemetry_policy_id = v_policy_id, updated_at = now()
    where id = v_device_id and telemetry_region = v_region;
  end if;

  return public.get_effective_telemetry_policy(v_device_id);
end;
$$;

create or replace function public.set_telemetry_prepaid_balance_control(
  p_device_code text,
  p_warning_megabytes integer,
  p_critical_megabytes integer,
  p_check_interval_minutes integer default 360,
  p_stale_after_minutes integer default 720
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.current_app_role();
  v_region text;
  v_device_id uuid;
  v_warning_bytes bigint;
  v_critical_bytes bigint;
begin
  if coalesce(v_role, '') not in ('admin','operations') then
    raise exception 'Only admin or operations may configure prepaid balance monitoring' using errcode = '42501';
  end if;
  v_region := public.assert_telemetry_region_selected();
  if p_critical_megabytes < 0 or p_warning_megabytes <= p_critical_megabytes then
    raise exception 'Warning MB must be greater than critical MB, and both must be non-negative' using errcode = '22023';
  end if;
  if p_check_interval_minutes not between 15 and 1440 then
    raise exception 'Check interval must be between 15 and 1440 minutes' using errcode = '22023';
  end if;
  if p_stale_after_minutes not between p_check_interval_minutes and 10080 then
    raise exception 'Stale interval must be at least the check interval and no more than 10080 minutes' using errcode = '22023';
  end if;

  select id into v_device_id
  from public.telemetry_devices
  where device_code = trim(p_device_code)
    and telemetry_region = v_region;
  if not found then raise exception 'Telemetry device not found' using errcode = '22023'; end if;

  v_warning_bytes := p_warning_megabytes::bigint * 1048576;
  v_critical_bytes := p_critical_megabytes::bigint * 1048576;
  insert into public.telemetry_prepaid_balance_state (
    device_id, warning_threshold_bytes, critical_threshold_bytes,
    check_interval_minutes, stale_after_minutes, updated_at
  ) values (
    v_device_id, v_warning_bytes, v_critical_bytes,
    p_check_interval_minutes, p_stale_after_minutes, now()
  )
  on conflict (device_id) do update set
    warning_threshold_bytes = excluded.warning_threshold_bytes,
    critical_threshold_bytes = excluded.critical_threshold_bytes,
    check_interval_minutes = excluded.check_interval_minutes,
    stale_after_minutes = excluded.stale_after_minutes,
    updated_at = now();

  return jsonb_build_object(
    'accepted', true,
    'device_id', v_device_id,
    'warning_threshold_bytes', v_warning_bytes,
    'critical_threshold_bytes', v_critical_bytes,
    'check_interval_minutes', p_check_interval_minutes,
    'stale_after_minutes', p_stale_after_minutes
  );
end;
$$;

create or replace function public.set_telemetry_fleet_attention_workflow(
  p_source_key text,
  p_device_id uuid,
  p_attention_kind text,
  p_action text,
  p_snoozed_until timestamp with time zone default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_region text;
  v_source_key text := trim(coalesce(p_source_key, ''));
  v_kind text := lower(trim(coalesce(p_attention_kind, '')));
  v_action text := lower(trim(coalesce(p_action, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_row public.telemetry_fleet_attention_workflow%rowtype;
begin
  if v_actor is null or not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  v_region := public.assert_telemetry_region_selected();
  if p_device_id is null or not public.telemetry_region_allows_device(p_device_id) then
    raise exception 'Telemetry device was not found in the selected telemetry region.' using errcode = '22023';
  end if;
  if v_kind not in ('offline', 'config', 'sim_balance', 'network') then
    raise exception 'Unsupported fleet attention kind.' using errcode = '22023';
  end if;
  if v_action not in ('acknowledge', 'unacknowledge', 'take', 'release', 'snooze', 'resolve', 'reopen') then
    raise exception 'Unsupported fleet attention workflow action.' using errcode = '22023';
  end if;
  if char_length(v_source_key) < 40 or char_length(v_source_key) > 320
    or v_source_key not like p_device_id::text || ':' || v_kind || ':%' then
    raise exception 'Fleet attention source key does not match the device occurrence.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Fleet attention workflow note is too long.' using errcode = '22023';
  end if;
  if v_action = 'resolve' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'A resolution note of at least 3 characters is required.' using errcode = '22023';
  end if;
  if v_action = 'snooze' and (
    p_snoozed_until is null
    or p_snoozed_until <= now()
    or p_snoozed_until > now() + interval '30 days'
  ) then
    raise exception 'Snooze time must be in the next 30 days.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_source_key, 0));
  insert into public.telemetry_fleet_attention_workflow(source_key, device_id, attention_kind)
  values (v_source_key, p_device_id, v_kind)
  on conflict (source_key) do nothing;

  select * into v_row
  from public.telemetry_fleet_attention_workflow
  where source_key = v_source_key
  for update;

  if v_row.device_id <> p_device_id or v_row.attention_kind <> v_kind then
    raise exception 'Fleet attention occurrence does not match its saved workflow.' using errcode = '22023';
  end if;
  if v_row.workflow_status = 'resolved' and v_action <> 'reopen' then
    raise exception 'Reopen the resolved fleet attention item before changing it.' using errcode = '22023';
  end if;

  if v_action = 'acknowledge' then
    update public.telemetry_fleet_attention_workflow
      set workflow_status = 'acknowledged',
          acknowledged_at = coalesce(acknowledged_at, now()),
          acknowledged_by = coalesce(acknowledged_by, v_actor),
          snoozed_until = null,
          updated_at = now()
      where source_key = v_source_key;
  elsif v_action = 'unacknowledge' then
    update public.telemetry_fleet_attention_workflow
      set workflow_status = 'open',
          acknowledged_at = null,
          acknowledged_by = null,
          snoozed_until = null,
          updated_at = now()
      where source_key = v_source_key;
  elsif v_action = 'take' then
    update public.telemetry_fleet_attention_workflow
      set workflow_status = 'acknowledged',
          acknowledged_at = coalesce(acknowledged_at, now()),
          acknowledged_by = coalesce(acknowledged_by, v_actor),
          assigned_to = v_actor,
          snoozed_until = null,
          updated_at = now()
      where source_key = v_source_key;
  elsif v_action = 'release' then
    update public.telemetry_fleet_attention_workflow
      set assigned_to = null,
          updated_at = now()
      where source_key = v_source_key;
  elsif v_action = 'snooze' then
    update public.telemetry_fleet_attention_workflow
      set workflow_status = 'snoozed',
          acknowledged_at = coalesce(acknowledged_at, now()),
          acknowledged_by = coalesce(acknowledged_by, v_actor),
          assigned_to = coalesce(assigned_to, v_actor),
          snoozed_until = p_snoozed_until,
          updated_at = now()
      where source_key = v_source_key;
  elsif v_action = 'resolve' then
    update public.telemetry_fleet_attention_workflow
      set workflow_status = 'resolved',
          acknowledged_at = coalesce(acknowledged_at, now()),
          acknowledged_by = coalesce(acknowledged_by, v_actor),
          assigned_to = coalesce(assigned_to, v_actor),
          snoozed_until = null,
          resolved_at = now(),
          resolved_by = v_actor,
          resolution_note = v_note,
          updated_at = now()
      where source_key = v_source_key;
  elsif v_action = 'reopen' then
    update public.telemetry_fleet_attention_workflow
      set workflow_status = 'open',
          acknowledged_at = null,
          acknowledged_by = null,
          snoozed_until = null,
          resolved_at = null,
          resolved_by = null,
          resolution_note = null,
          updated_at = now()
      where source_key = v_source_key;
  end if;

  insert into public.telemetry_fleet_attention_workflow_history(source_key, action, actor_id, note)
  values (v_source_key, v_action, v_actor, v_note);

  select * into v_row from public.telemetry_fleet_attention_workflow where source_key = v_source_key;
  return jsonb_build_object(
    'source_key', v_row.source_key,
    'device_id', v_row.device_id,
    'attention_kind', v_row.attention_kind,
    'workflow_status', v_row.workflow_status,
    'acknowledged_at', v_row.acknowledged_at,
    'acknowledged_by', v_row.acknowledged_by,
    'assigned_to', v_row.assigned_to,
    'snoozed_until', v_row.snoozed_until,
    'resolved_at', v_row.resolved_at,
    'resolved_by', v_row.resolved_by,
    'resolution_note', v_row.resolution_note,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.set_telemetry_device_control(text,text,text,boolean,boolean) from public, anon;
grant execute on function public.set_telemetry_device_control(text,text,text,boolean,boolean) to authenticated, service_role;

revoke all on function public.set_telemetry_device_location_control(text,boolean,integer,integer) from public, anon;
grant execute on function public.set_telemetry_device_location_control(text,boolean,integer,integer) to authenticated, service_role;

revoke all on function public.set_telemetry_device_mode(text,text) from public, anon;
grant execute on function public.set_telemetry_device_mode(text,text) to authenticated, service_role;

revoke all on function public.set_telemetry_prepaid_balance_control(text,integer,integer,integer,integer) from public, anon;
grant execute on function public.set_telemetry_prepaid_balance_control(text,integer,integer,integer,integer) to authenticated, service_role;

revoke all on function public.set_telemetry_fleet_attention_workflow(text,uuid,text,text,timestamp with time zone,text) from public, anon;
grant execute on function public.set_telemetry_fleet_attention_workflow(text,uuid,text,text,timestamp with time zone,text) to authenticated, service_role;
