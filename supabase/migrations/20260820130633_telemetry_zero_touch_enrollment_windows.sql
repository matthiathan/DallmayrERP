-- DallmayrERP telemetry zero-touch enrollment windows.
-- An administrator opens a short, limited window. The Edge Function uses the
-- service role to atomically enroll the first eligible ESP32 that arrives.

create table if not exists public.telemetry_enrollment_windows (
  id uuid primary key default gen_random_uuid(),
  label text,
  status text not null default 'open'
    check (status in ('open', 'exhausted', 'cancelled', 'expired')),
  expected_hardware_uid text
    check (expected_hardware_uid is null or expected_hardware_uid ~ '^[0-9A-F]{12}$'),
  max_claims integer not null default 1
    check (max_claims between 1 and 100),
  claimed_count integer not null default 0
    check (claimed_count >= 0 and claimed_count <= max_claims),
  opened_by_auth_user_id uuid,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.telemetry_enrollment_window_claims (
  id uuid primary key default gen_random_uuid(),
  window_id uuid not null references public.telemetry_enrollment_windows(id) on delete restrict,
  device_id uuid references public.telemetry_devices(id) on delete set null,
  hardware_uid text not null check (hardware_uid ~ '^[0-9A-F]{12}$'),
  claimed_at timestamptz not null default now(),
  unique (window_id, hardware_uid)
);

create unique index if not exists telemetry_enrollment_one_open_window_idx
  on public.telemetry_enrollment_windows ((true))
  where status = 'open';

create index if not exists telemetry_enrollment_windows_expires_idx
  on public.telemetry_enrollment_windows (expires_at desc);

create index if not exists telemetry_enrollment_window_claims_device_idx
  on public.telemetry_enrollment_window_claims (device_id);

alter table public.telemetry_enrollment_windows enable row level security;
alter table public.telemetry_enrollment_window_claims enable row level security;

drop policy if exists telemetry_enrollment_windows_admin_read
  on public.telemetry_enrollment_windows;
create policy telemetry_enrollment_windows_admin_read
  on public.telemetry_enrollment_windows
  for select
  to authenticated
  using (public.current_app_role() = 'admin');

drop policy if exists telemetry_enrollment_window_claims_admin_read
  on public.telemetry_enrollment_window_claims;
create policy telemetry_enrollment_window_claims_admin_read
  on public.telemetry_enrollment_window_claims
  for select
  to authenticated
  using (public.current_app_role() = 'admin');

grant select on public.telemetry_enrollment_windows to authenticated;
grant select on public.telemetry_enrollment_window_claims to authenticated;
revoke all on public.telemetry_enrollment_windows from anon;
revoke all on public.telemetry_enrollment_window_claims from anon;

create or replace function public.open_telemetry_enrollment_window(
  p_minutes integer default 10,
  p_max_devices integer default 1,
  p_label text default null,
  p_expected_hardware_uid text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_window public.telemetry_enrollment_windows%rowtype;
  v_expected_uid text := nullif(upper(trim(coalesce(p_expected_hardware_uid, ''))), '');
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only an Administrator may open a telemetry enrollment window'
      using errcode = '42501';
  end if;

  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Enrollment window duration must be between 1 and 60 minutes'
      using errcode = '22023';
  end if;
  if p_max_devices is null or p_max_devices < 1 or p_max_devices > 100 then
    raise exception 'Enrollment window device count must be between 1 and 100'
      using errcode = '22023';
  end if;
  if v_expected_uid is not null and v_expected_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Expected hardware UID must contain exactly 12 hexadecimal characters'
      using errcode = '22023';
  end if;
  if v_expected_uid is not null and p_max_devices <> 1 then
    raise exception 'A hardware-locked window can enroll exactly one device'
      using errcode = '22023';
  end if;

  update public.telemetry_enrollment_windows
  set status = 'expired', closed_at = coalesce(closed_at, now())
  where status = 'open' and expires_at <= now();

  -- Opening a new window deliberately cancels any older unconsumed window.
  update public.telemetry_enrollment_windows
  set status = 'cancelled', closed_at = now()
  where status = 'open';

  insert into public.telemetry_enrollment_windows (
    label, status, expected_hardware_uid, max_claims, claimed_count,
    opened_by_auth_user_id, opened_at, expires_at
  ) values (
    nullif(trim(coalesce(p_label, '')), ''), 'open', v_expected_uid,
    p_max_devices, 0, auth.uid(), now(), now() + make_interval(mins => p_minutes)
  )
  returning * into v_window;

  return jsonb_build_object(
    'active', true,
    'window_id', v_window.id,
    'status', v_window.status,
    'label', v_window.label,
    'expected_hardware_uid', v_window.expected_hardware_uid,
    'max_devices', v_window.max_claims,
    'claimed_devices', v_window.claimed_count,
    'opened_at', v_window.opened_at,
    'expires_at', v_window.expires_at
  );
end;
$function$;

create or replace function public.close_telemetry_enrollment_window()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_window_id uuid;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only an Administrator may close a telemetry enrollment window'
      using errcode = '42501';
  end if;

  update public.telemetry_enrollment_windows
  set status = case when expires_at <= now() then 'expired' else 'cancelled' end,
      closed_at = coalesce(closed_at, now())
  where status = 'open'
  returning id into v_window_id;

  return jsonb_build_object(
    'active', false,
    'closed', v_window_id is not null,
    'window_id', v_window_id
  );
end;
$function$;

create or replace function public.get_telemetry_enrollment_window_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_window public.telemetry_enrollment_windows%rowtype;
  v_effective_status text;
  v_active boolean;
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only an Administrator may view telemetry enrollment windows'
      using errcode = '42501';
  end if;

  select * into v_window
  from public.telemetry_enrollment_windows
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('active', false, 'status', 'none');
  end if;

  v_active := v_window.status = 'open'
    and v_window.expires_at > now()
    and v_window.claimed_count < v_window.max_claims;
  v_effective_status := case
    when v_window.status = 'open' and v_window.expires_at <= now() then 'expired'
    else v_window.status
  end;

  return jsonb_build_object(
    'active', v_active,
    'window_id', v_window.id,
    'status', v_effective_status,
    'label', v_window.label,
    'expected_hardware_uid', v_window.expected_hardware_uid,
    'max_devices', v_window.max_claims,
    'claimed_devices', v_window.claimed_count,
    'opened_at', v_window.opened_at,
    'expires_at', v_window.expires_at,
    'seconds_remaining', case
      when v_active then greatest(floor(extract(epoch from (v_window.expires_at - now())))::integer, 0)
      else 0
    end
  );
end;
$function$;

create or replace function public.enroll_telemetry_device_zero_touch(
  p_hardware_uid text,
  p_machine_serial text,
  p_credential_hash text,
  p_firmware text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_window public.telemetry_enrollment_windows%rowtype;
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid, '')));
  v_device_code text;
  v_device_id uuid;
  v_live_policy_id uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_serial text := lower(trim(coalesce(p_machine_serial, '')));
  v_matches integer := 0;
  v_link_status text := 'unlinked';
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Invalid ESP32 hardware UID' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_credential_hash, '')), '') is null then
    raise exception 'Credential hash is required' using errcode = '22023';
  end if;

  update public.telemetry_enrollment_windows
  set status = 'expired', closed_at = coalesce(closed_at, now())
  where status = 'open' and expires_at <= now();

  select * into v_window
  from public.telemetry_enrollment_windows
  where status = 'open'
    and expires_at > now()
    and claimed_count < max_claims
    and (expected_hardware_uid is null or expected_hardware_uid = v_hardware_uid)
  order by opened_at desc
  limit 1
  for update skip locked;

  if not found then
    raise exception 'No active enrollment window is available for this device'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.telemetry_devices where hardware_uid = v_hardware_uid) then
    raise exception 'This ESP32 is already enrolled; an Administrator must recommission it if credentials were erased'
      using errcode = '23505';
  end if;

  v_device_code := 'DLM-ESP32-' || v_hardware_uid;

  if v_serial <> '' then
    select count(*)::integer into v_matches
    from public.machines
    where nullif(trim(serial_number), '') is not null
      and lower(trim(serial_number)) = v_serial;

    if v_matches = 1 then
      select id, site_id into v_machine_id, v_site_id
      from public.machines
      where nullif(trim(serial_number), '') is not null
        and lower(trim(serial_number)) = v_serial
      limit 1;
      v_link_status := 'linked';
    elsif v_matches = 0 then
      v_link_status := 'no_match';
    else
      v_link_status := 'ambiguous';
    end if;
  end if;

  select id into v_live_policy_id
  from public.telemetry_policies
  where policy_code = 'live'
  limit 1;

  insert into public.telemetry_devices (
    device_code, machine_id, site_id, status, credential_hash, firmware_version,
    telemetry_policy_id, transport_preference, wifi_enabled, cellular_enabled,
    hardware_uid, reported_machine_serial, machine_link_status,
    machine_link_method, machine_linked_at
  ) values (
    v_device_code, v_machine_id, v_site_id, 'active', p_credential_hash, nullif(p_firmware, ''),
    v_live_policy_id, 'auto', true, true,
    v_hardware_uid, nullif(trim(p_machine_serial), ''), v_link_status,
    case when v_link_status = 'linked' then 'serial_auto' else null end,
    case when v_link_status = 'linked' then now() else null end
  )
  returning id into v_device_id;

  insert into public.telemetry_enrollment_window_claims (
    window_id, device_id, hardware_uid
  ) values (
    v_window.id, v_device_id, v_hardware_uid
  );

  update public.telemetry_enrollment_windows
  set claimed_count = claimed_count + 1,
      status = case when claimed_count + 1 >= max_claims then 'exhausted' else status end,
      closed_at = case when claimed_count + 1 >= max_claims then now() else closed_at end
  where id = v_window.id;

  return jsonb_build_object(
    'accepted', true,
    'enrollment_method', 'automatic_window',
    'enrollment_window_id', v_window.id,
    'device_id', v_device_id,
    'device_code', v_device_code,
    'hardware_uid', v_hardware_uid,
    'machine_id', v_machine_id,
    'machine_link_status', v_link_status,
    'machine_match_count', v_matches,
    'telemetry_mode', 'live'
  );
end;
$function$;

revoke all on function public.open_telemetry_enrollment_window(integer, integer, text, text)
  from public, anon;
revoke all on function public.close_telemetry_enrollment_window()
  from public, anon;
revoke all on function public.get_telemetry_enrollment_window_status()
  from public, anon;
revoke all on function public.enroll_telemetry_device_zero_touch(text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.open_telemetry_enrollment_window(integer, integer, text, text)
  to authenticated;
grant execute on function public.close_telemetry_enrollment_window()
  to authenticated;
grant execute on function public.get_telemetry_enrollment_window_status()
  to authenticated;
grant execute on function public.enroll_telemetry_device_zero_touch(text, text, text, text)
  to service_role;

comment on table public.telemetry_enrollment_windows is
  'Short-lived administrator-controlled windows for zero-touch telemetry enrollment.';
comment on table public.telemetry_enrollment_window_claims is
  'Audit trail linking each automatic enrollment to the window that authorized it.';
