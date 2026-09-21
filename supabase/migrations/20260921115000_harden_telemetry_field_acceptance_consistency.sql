-- Field-acceptance consistency fixes discovered against the live telemetry device.
-- Keep the authoritative machine assignment, derived link metadata and runtime
-- state aligned, and prevent old manual balance requests from appearing
-- perpetually pending in the operator UI.

create or replace function public.save_telemetry_device_configuration(
  p_device_id uuid,
  p_device_code text,
  p_machine_id uuid default null::uuid,
  p_status text default 'active'::text,
  p_mode text default 'live'::text,
  p_transport_preference text default 'auto'::text,
  p_wifi_enabled boolean default true,
  p_cellular_enabled boolean default true,
  p_mdb_master_polarity text default 'auto'::text,
  p_mdb_slave_polarity text default 'auto'::text,
  p_mdb_pin_swap boolean default false,
  p_location_enabled boolean default true,
  p_location_override text default null::text,
  p_location_interval_minutes integer default 15,
  p_location_min_move_m integer default 50,
  p_warning_megabytes integer default 100,
  p_critical_megabytes integer default 25,
  p_balance_check_interval_minutes integer default 360,
  p_balance_stale_after_minutes integer default 720
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_policy_id uuid;
  v_site_id uuid;
  v_status text := lower(trim(coalesce(p_status, 'active')));
  v_mode text := lower(trim(coalesce(p_mode, 'live')));
  v_transport text := lower(trim(coalesce(p_transport_preference, 'auto')));
  v_master_polarity text := lower(trim(coalesce(p_mdb_master_polarity, 'auto')));
  v_slave_polarity text := lower(trim(coalesce(p_mdb_slave_polarity, 'auto')));
  v_override text := nullif(trim(coalesce(p_location_override, '')), '');
  v_warning_bytes bigint;
  v_critical_bytes bigint;
  v_request_id uuid;
  v_requested jsonb;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region
  for update;
  if not found then
    raise exception 'Telemetry device not found in the selected region.' using errcode = '22023';
  end if;
  if trim(coalesce(p_device_code, '')) <> v_device.device_code then
    raise exception 'Telemetry device ID does not match.' using errcode = '22023';
  end if;

  if v_status not in ('active','disabled') then
    raise exception 'Device status must be active or disabled.' using errcode = '22023';
  end if;
  if v_mode not in ('live','daily','monthly') then
    raise exception 'Reporting mode must be live, daily or monthly.' using errcode = '22023';
  end if;
  if v_transport not in ('auto','wifi','cellular') then
    raise exception 'Transport must be auto, wifi or cellular.' using errcode = '22023';
  end if;
  if not coalesce(p_wifi_enabled, false) and not coalesce(p_cellular_enabled, false) then
    raise exception 'At least one telemetry transport must remain enabled.' using errcode = '22023';
  end if;
  if v_transport = 'wifi' and not coalesce(p_wifi_enabled, false) then
    raise exception 'Wi-Fi must be enabled when Wi-Fi is preferred.' using errcode = '22023';
  end if;
  if v_transport = 'cellular' and not coalesce(p_cellular_enabled, false) then
    raise exception 'Cellular must be enabled when cellular is preferred.' using errcode = '22023';
  end if;
  if v_master_polarity not in ('auto','normal','inverted') or v_slave_polarity not in ('auto','normal','inverted') then
    raise exception 'MDB polarity must be auto, normal or inverted.' using errcode = '22023';
  end if;
  if p_location_interval_minutes is null or p_location_interval_minutes not between 1 and 1440 then
    raise exception 'Location interval must be 1 to 1440 minutes.' using errcode = '22023';
  end if;
  if p_location_min_move_m is null or p_location_min_move_m not between 5 and 10000 then
    raise exception 'Movement threshold must be 5 to 10000 metres.' using errcode = '22023';
  end if;
  if p_critical_megabytes is null or p_warning_megabytes is null or p_critical_megabytes < 0 or p_warning_megabytes <= p_critical_megabytes then
    raise exception 'Warning MB must be greater than critical MB, and both must be non-negative.' using errcode = '22023';
  end if;
  if p_balance_check_interval_minutes is null or p_balance_check_interval_minutes not between 15 and 1440 then
    raise exception 'Balance check interval must be 15 to 1440 minutes.' using errcode = '22023';
  end if;
  if p_balance_stale_after_minutes is null or p_balance_stale_after_minutes not between p_balance_check_interval_minutes and 10080 then
    raise exception 'Balance stale interval must be at least the check interval and no more than 10080 minutes.' using errcode = '22023';
  end if;

  select id into v_policy_id
  from public.telemetry_policies
  where policy_code = v_mode
  limit 1;
  if v_policy_id is null then
    raise exception 'Telemetry reporting policy was not found.' using errcode = '22023';
  end if;

  if p_machine_id is not null then
    select m.site_id into v_site_id
    from public.machines m
    where m.id = p_machine_id
      and m.telemetry_region = v_region;
    if not found then
      raise exception 'Assigned machine was not found in the selected region.' using errcode = '22023';
    end if;
  end if;

  update public.telemetry_devices
  set machine_id = p_machine_id,
      site_id = v_site_id,
      machine_link_status = case when p_machine_id is null then 'unlinked' else 'linked' end,
      machine_link_method = case when p_machine_id is null then null else 'manual_assignment' end,
      machine_linked_at = case
        when p_machine_id is null then null
        when v_device.machine_id is distinct from p_machine_id or v_device.machine_linked_at is null then now()
        else v_device.machine_linked_at
      end,
      status = v_status,
      telemetry_policy_id = v_policy_id,
      transport_preference = v_transport,
      wifi_enabled = p_wifi_enabled,
      cellular_enabled = p_cellular_enabled,
      mdb_master_polarity = v_master_polarity,
      mdb_slave_polarity = v_slave_polarity,
      mdb_pin_swap = coalesce(p_mdb_pin_swap, false),
      location_enabled = coalesce(p_location_enabled, true),
      location_override = v_override,
      location_interval_minutes = p_location_interval_minutes,
      location_min_move_m = p_location_min_move_m,
      updated_at = now()
  where id = p_device_id
    and telemetry_region = v_region;

  insert into public.telemetry_machine_state (device_id, machine_id, site_id, telemetry_mode, updated_at)
  values (p_device_id, p_machine_id, v_site_id, v_mode, now())
  on conflict (device_id) do update set
    machine_id = excluded.machine_id,
    site_id = excluded.site_id,
    telemetry_mode = excluded.telemetry_mode,
    updated_at = now();

  v_warning_bytes := p_warning_megabytes::bigint * 1048576;
  v_critical_bytes := p_critical_megabytes::bigint * 1048576;
  insert into public.telemetry_prepaid_balance_state (
    device_id, warning_threshold_bytes, critical_threshold_bytes,
    check_interval_minutes, stale_after_minutes, updated_at
  ) values (
    p_device_id, v_warning_bytes, v_critical_bytes,
    p_balance_check_interval_minutes, p_balance_stale_after_minutes, now()
  )
  on conflict (device_id) do update set
    warning_threshold_bytes = excluded.warning_threshold_bytes,
    critical_threshold_bytes = excluded.critical_threshold_bytes,
    check_interval_minutes = excluded.check_interval_minutes,
    stale_after_minutes = excluded.stale_after_minutes,
    updated_at = now();

  v_requested := jsonb_build_object(
    'machine_id', p_machine_id,
    'device_status', v_status,
    'mode', v_mode,
    'transport_preference', v_transport,
    'wifi_enabled', p_wifi_enabled,
    'cellular_enabled', p_cellular_enabled,
    'mdb_master_polarity', v_master_polarity,
    'mdb_slave_polarity', v_slave_polarity,
    'mdb_pin_swap', coalesce(p_mdb_pin_swap, false),
    'location_enabled', coalesce(p_location_enabled, true),
    'location_override', v_override,
    'location_interval_minutes', p_location_interval_minutes,
    'location_min_move_m', p_location_min_move_m,
    'prepaid_warning_megabytes', p_warning_megabytes,
    'prepaid_critical_megabytes', p_critical_megabytes,
    'prepaid_check_interval_minutes', p_balance_check_interval_minutes,
    'prepaid_stale_after_minutes', p_balance_stale_after_minutes
  );

  update public.telemetry_device_config_history
  set status = 'superseded'
  where device_id = p_device_id and status = 'pending';

  insert into public.telemetry_device_config_history (
    device_id, requested_by_auth_user_id, requested_config
  ) values (
    p_device_id, auth.uid(), v_requested
  ) returning id into v_request_id;

  return jsonb_build_object(
    'accepted', true,
    'device_id', p_device_id,
    'device_code', v_device.device_code,
    'request_id', v_request_id,
    'status', 'pending',
    'requested_at', now(),
    'requested_config', v_requested
  );
end;
$$;

-- Repair existing assignment metadata without changing the assigned machine.
update public.telemetry_devices
set machine_link_status = 'linked',
    machine_link_method = coalesce(machine_link_method, 'manual_assignment'),
    machine_linked_at = coalesce(machine_linked_at, updated_at, now()),
    updated_at = now()
where machine_id is not null
  and (machine_link_status <> 'linked' or machine_link_method is null or machine_linked_at is null);

-- Keep the runtime machine state aligned with the authoritative device assignment.
update public.telemetry_machine_state s
set machine_id = d.machine_id,
    site_id = d.site_id,
    updated_at = now()
from public.telemetry_devices d
where s.device_id = d.id
  and (s.machine_id is distinct from d.machine_id or s.site_id is distinct from d.site_id);

insert into public.telemetry_machine_state (device_id, machine_id, site_id, updated_at)
select d.id, d.machine_id, d.site_id, now()
from public.telemetry_devices d
where not exists (
  select 1 from public.telemetry_machine_state s where s.device_id = d.id
)
on conflict (device_id) do nothing;

create or replace function public.get_telemetry_prepaid_balances()
returns table(
  device_id uuid,
  device_code text,
  carrier text,
  ussd_code text,
  remaining_bytes bigint,
  balance_text text,
  query_status text,
  last_error text,
  checked_at timestamp with time zone,
  received_at timestamp with time zone,
  request_pending boolean,
  requested_at timestamp with time zone,
  warning_threshold_bytes bigint,
  critical_threshold_bytes bigint,
  check_interval_minutes integer,
  stale_after_minutes integer,
  next_check_at timestamp with time zone,
  is_stale boolean,
  alert_level text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
begin
  return query
  select
    d.id,
    d.device_code,
    coalesce(s.carrier, 'Vodacom South Africa'::text),
    coalesce(s.ussd_code, '*111*502#'::text),
    s.remaining_bytes,
    s.balance_text,
    coalesce(s.query_status, 'unknown'::text),
    s.last_error,
    s.checked_at,
    s.received_at,
    coalesce(s.request_pending, false)
      and s.requested_at is not null
      and s.requested_at > now() - interval '30 minutes' as request_pending,
    s.requested_at,
    coalesce(s.warning_threshold_bytes, 104857600::bigint),
    coalesce(s.critical_threshold_bytes, 26214400::bigint),
    coalesce(s.check_interval_minutes, 360),
    coalesce(s.stale_after_minutes, 720),
    case
      when s.checked_at is null then now()
      else s.checked_at + make_interval(mins => coalesce(s.check_interval_minutes, 360))
    end,
    s.checked_at is null
      or s.checked_at + make_interval(mins => coalesce(s.stale_after_minutes, 720)) <= now(),
    case
      when s.checked_at is null then 'unknown'
      when s.checked_at + make_interval(mins => coalesce(s.stale_after_minutes, 720)) <= now() then 'stale'
      when s.query_status <> 'ok' then s.query_status
      when s.remaining_bytes = 0 then 'depleted'
      when s.remaining_bytes <= s.critical_threshold_bytes then 'critical'
      when s.remaining_bytes <= s.warning_threshold_bytes then 'low'
      else 'ok'
    end
  from public.telemetry_devices d
  left join public.telemetry_prepaid_balance_state s on s.device_id = d.id
  where d.telemetry_region = v_region
  order by d.device_code;
end;
$$;

revoke all on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) from public, anon;
revoke all on function public.get_telemetry_prepaid_balances() from public, anon;
grant execute on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) to authenticated, service_role;
grant execute on function public.get_telemetry_prepaid_balances() to authenticated, service_role;

comment on function public.save_telemetry_device_configuration(uuid, text, uuid, text, text, text, boolean, boolean, text, text, boolean, boolean, text, integer, integer, integer, integer, integer, integer) is
  'Atomically saves region-scoped telemetry configuration and keeps machine assignment metadata/runtime state consistent.';
comment on function public.get_telemetry_prepaid_balances() is
  'Returns region-scoped prepaid monitoring state; manual requests older than 30 minutes no longer appear actively pending to operators.';
