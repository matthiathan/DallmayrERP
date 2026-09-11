create table if not exists public.telemetry_device_config_history (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.telemetry_devices(id) on delete cascade,
  requested_by_auth_user_id uuid,
  requested_at timestamptz not null default now(),
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  status text not null default 'pending' check (status in ('pending','applied','mismatch','superseded')),
  requested_config jsonb not null default '{}'::jsonb,
  applied_config jsonb,
  differences jsonb not null default '{}'::jsonb,
  unreported_fields jsonb not null default '[]'::jsonb
);

create index if not exists telemetry_device_config_history_device_requested_idx
  on public.telemetry_device_config_history(device_id, requested_at desc);
create index if not exists telemetry_device_config_history_pending_idx
  on public.telemetry_device_config_history(device_id, status)
  where status = 'pending';

alter table public.telemetry_device_config_history enable row level security;
revoke all on table public.telemetry_device_config_history from public, anon;
grant select on table public.telemetry_device_config_history to authenticated;

drop policy if exists telemetry_device_config_history_read on public.telemetry_device_config_history;
create policy telemetry_device_config_history_read
on public.telemetry_device_config_history
for select
to authenticated
using (public.is_active_app_user());

create or replace function public.save_telemetry_device_configuration(
  p_device_id uuid,
  p_device_code text,
  p_machine_id uuid default null,
  p_status text default 'active',
  p_mode text default 'live',
  p_transport_preference text default 'auto',
  p_wifi_enabled boolean default true,
  p_cellular_enabled boolean default true,
  p_mdb_master_polarity text default 'auto',
  p_mdb_slave_polarity text default 'auto',
  p_mdb_pin_swap boolean default false,
  p_location_enabled boolean default true,
  p_location_override text default null,
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
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;
  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
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
    where m.id = p_machine_id;
    if not found then
      raise exception 'Assigned machine was not found.' using errcode = '22023';
    end if;
  end if;

  update public.telemetry_devices
  set machine_id = p_machine_id,
      site_id = v_site_id,
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
  where id = p_device_id;

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

revoke all on function public.save_telemetry_device_configuration(uuid,text,uuid,text,text,text,boolean,boolean,text,text,boolean,boolean,text,integer,integer,integer,integer,integer,integer) from public, anon;
grant execute on function public.save_telemetry_device_configuration(uuid,text,uuid,text,text,text,boolean,boolean,text,text,boolean,boolean,text,integer,integer,integer,integer,integer,integer) to authenticated;

create or replace function public.get_telemetry_device_config_history(
  p_device_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
  v_history jsonb;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  select * into v_device from public.telemetry_devices where id = p_device_id;
  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row_data order by requested_at desc), '[]'::jsonb)
  into v_history
  from (
    select h.requested_at,
      jsonb_build_object(
        'id', h.id,
        'requested_by_auth_user_id', h.requested_by_auth_user_id,
        'requested_at', h.requested_at,
        'delivered_at', h.delivered_at,
        'acknowledged_at', h.acknowledged_at,
        'status', h.status,
        'requested_config', h.requested_config,
        'applied_config', h.applied_config,
        'differences', h.differences,
        'unreported_fields', h.unreported_fields
      ) as row_data
    from public.telemetry_device_config_history h
    where h.device_id = p_device_id
    order by h.requested_at desc
    limit v_limit
  ) history_rows;

  return jsonb_build_object(
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'last_config_at', v_device.last_config_at,
    'last_config_ack_at', v_device.last_config_ack_at,
    'applied_config', coalesce(v_device.applied_config, '{}'::jsonb),
    'history', v_history
  );
end;
$$;

revoke all on function public.get_telemetry_device_config_history(uuid,integer) from public, anon;
grant execute on function public.get_telemetry_device_config_history(uuid,integer) to authenticated;

create or replace function public.record_telemetry_config_ack(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_applied jsonb := coalesce(p_payload -> 'applied_config', '{}'::jsonb);
  v_boot_id text := coalesce(p_payload ->> 'boot_id', '');
  v_sequence bigint := coalesce(nullif(p_payload ->> 'sequence', '')::bigint, 0);
  v_firmware text := nullif(p_payload ->> 'firmware', '');
  v_policy jsonb;
  v_request_id uuid;
  v_requested jsonb;
  v_differences jsonb := '{}'::jsonb;
  v_unreported jsonb := '[]'::jsonb;
  v_key text;
  v_expected jsonb;
  v_actual jsonb;
  v_sync_status text;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found' using errcode = '22023';
  end if;
  if v_device.status <> 'active' then
    raise exception 'Telemetry device is not active' using errcode = '42501';
  end if;
  if jsonb_typeof(v_applied) <> 'object' then
    raise exception 'applied_config must be a JSON object' using errcode = '22023';
  end if;

  v_policy := public.get_effective_telemetry_policy(v_device.id);

  update public.telemetry_devices
  set firmware_version = coalesce(v_firmware, firmware_version),
      last_seen_at = now(),
      last_upload_at = now(),
      last_config_ack_at = now(),
      applied_config = v_applied,
      last_boot_id = nullif(v_boot_id, ''),
      last_sequence = greatest(last_sequence, v_sequence),
      updated_at = now()
  where id = v_device.id;

  insert into public.telemetry_machine_state (
    device_id, machine_id, site_id, effective_policy_id, telemetry_mode,
    machine_status, active_fault_count, last_device_contact_at, updated_at
  ) values (
    v_device.id,
    v_device.machine_id,
    coalesce(v_device.site_id, nullif(v_policy ->> 'site_id', '')::uuid),
    nullif(v_policy ->> 'id', '')::uuid,
    coalesce(v_policy ->> 'mode', 'live'),
    'unknown', 0, now(), now()
  )
  on conflict (device_id) do update set
    machine_id = excluded.machine_id,
    site_id = excluded.site_id,
    effective_policy_id = excluded.effective_policy_id,
    telemetry_mode = excluded.telemetry_mode,
    last_device_contact_at = now(),
    updated_at = now();

  select h.id, h.requested_config
  into v_request_id, v_requested
  from public.telemetry_device_config_history h
  where h.device_id = v_device.id and h.status = 'pending'
  order by h.requested_at desc
  limit 1
  for update;

  if found then
    foreach v_key in array array[
      'mode','transport_preference','wifi_enabled','cellular_enabled',
      'location_enabled','location_interval_minutes','location_min_move_m'
    ] loop
      if v_requested ? v_key then
        if v_applied ? v_key then
          v_expected := v_requested -> v_key;
          v_actual := v_applied -> v_key;
          if v_expected <> v_actual then
            v_differences := v_differences || jsonb_build_object(
              v_key, jsonb_build_object('requested', v_expected, 'applied', v_actual)
            );
          end if;
        else
          v_unreported := v_unreported || jsonb_build_array(v_key);
        end if;
      end if;
    end loop;

    foreach v_key in array array['mdb_master_polarity','mdb_slave_polarity','mdb_pin_swap'] loop
      if v_requested ? v_key and not (v_applied ? v_key) then
        v_unreported := v_unreported || jsonb_build_array(v_key);
      elsif v_requested ? v_key and v_applied ? v_key then
        v_expected := v_requested -> v_key;
        v_actual := v_applied -> v_key;
        if v_expected <> v_actual then
          v_differences := v_differences || jsonb_build_object(
            v_key, jsonb_build_object('requested', v_expected, 'applied', v_actual)
          );
        end if;
      end if;
    end loop;

    v_sync_status := case when v_differences = '{}'::jsonb then 'applied' else 'mismatch' end;
    update public.telemetry_device_config_history
    set delivered_at = coalesce(delivered_at, now()),
        acknowledged_at = now(),
        status = v_sync_status,
        applied_config = v_applied,
        differences = v_differences,
        unreported_fields = v_unreported
    where id = v_request_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'config_ack', true,
    'last_config_ack_at', now(),
    'applied_config', v_applied,
    'config_request_id', v_request_id,
    'config_sync_status', v_sync_status
  );
end;
$$;

revoke all on function public.record_telemetry_config_ack(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_telemetry_config_ack(uuid,jsonb) to service_role;
