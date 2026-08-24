-- Administrator-issued manual enrollment tokens.
-- The browser generates the secret and sends only its SHA-256 hash here. Each
-- token is short-lived, single-use, and locked to one ESP32 hardware UID.

alter table public.telemetry_enrollment_tokens
  add column if not exists expected_hardware_uid text,
  add column if not exists created_by_auth_user_id uuid,
  add column if not exists revoked_at timestamptz;

-- No active legacy tokens exist at migration time in production. Revoke any
-- unbound leftovers defensively so every usable token follows the UID contract.
update public.telemetry_enrollment_tokens
set revoked_at = coalesce(revoked_at, now())
where expected_hardware_uid is null
  and used_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.telemetry_enrollment_tokens'::regclass
      and conname = 'telemetry_enrollment_tokens_expected_uid_check'
  ) then
    alter table public.telemetry_enrollment_tokens
      add constraint telemetry_enrollment_tokens_expected_uid_check
      check (
        expected_hardware_uid is null
        or expected_hardware_uid ~ '^[0-9A-F]{12}$'
      );
  end if;
end
$$;

create index if not exists telemetry_enrollment_tokens_active_uid_idx
  on public.telemetry_enrollment_tokens (expected_hardware_uid, expires_at desc)
  where used_at is null and revoked_at is null;

create or replace function public.create_telemetry_enrollment_token(
  p_hardware_uid text,
  p_token_hash text,
  p_minutes integer default 10,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid, '')));
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if coalesce(public.current_app_role(), '') <> 'admin' then
    raise exception 'Only an Administrator may create a telemetry enrollment token'
      using errcode = '42501';
  end if;

  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Hardware UID must contain exactly 12 hexadecimal characters'
      using errcode = '22023';
  end if;
  if v_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Enrollment token hash must be a SHA-256 hexadecimal digest'
      using errcode = '22023';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Enrollment token duration must be between 1 and 60 minutes'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.telemetry_devices
    where hardware_uid = v_hardware_uid
  ) then
    raise exception 'This ESP32 hardware UID is already enrolled'
      using errcode = '23505';
  end if;

  -- Serialize token replacement for the same UID so concurrent Administrator
  -- requests cannot leave two unused tokens valid at once.
  perform pg_advisory_xact_lock(hashtextextended(v_hardware_uid, 0));

  -- A manual token replaces the automatic enrollment window, preventing the
  -- same device from being authorized by two concurrent administrator flows.
  update public.telemetry_enrollment_windows
  set status = case when expires_at <= now() then 'expired' else 'cancelled' end,
      closed_at = coalesce(closed_at, now())
  where status = 'open';

  -- Only the newest unused token for a UID remains valid.
  update public.telemetry_enrollment_tokens
  set revoked_at = now()
  where expected_hardware_uid = v_hardware_uid
    and used_at is null
    and revoked_at is null;

  insert into public.telemetry_enrollment_tokens (
    token_hash,
    label,
    expected_hardware_uid,
    expires_at,
    created_by_auth_user_id
  ) values (
    v_token_hash,
    nullif(trim(coalesce(p_label, '')), ''),
    v_hardware_uid,
    now() + make_interval(mins => p_minutes),
    auth.uid()
  )
  returning * into v_token;

  return jsonb_build_object(
    'token_id', v_token.id,
    'hardware_uid', v_token.expected_hardware_uid,
    'expires_at', v_token.expires_at,
    'seconds_remaining', greatest(
      floor(extract(epoch from (v_token.expires_at - now())))::integer,
      0
    )
  );
end;
$$;

create or replace function public.revoke_telemetry_enrollment_token(
  p_token_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if coalesce(public.current_app_role(), '') <> 'admin' then
    raise exception 'Only an Administrator may revoke a telemetry enrollment token'
      using errcode = '42501';
  end if;

  update public.telemetry_enrollment_tokens
  set revoked_at = coalesce(revoked_at, now())
  where id = p_token_id
    and used_at is null
  returning * into v_token;

  return jsonb_build_object(
    'revoked', found,
    'token_id', p_token_id,
    'hardware_uid', v_token.expected_hardware_uid
  );
end;
$$;

create or replace function public.get_telemetry_enrollment_token_status(
  p_token_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_status text;
begin
  if coalesce(public.current_app_role(), '') <> 'admin' then
    raise exception 'Only an Administrator may view a telemetry enrollment token'
      using errcode = '42501';
  end if;

  select * into v_token
  from public.telemetry_enrollment_tokens
  where id = p_token_id;

  if not found then
    return jsonb_build_object('status', 'missing', 'token_id', p_token_id);
  end if;

  v_status := case
    when v_token.used_at is not null then 'used'
    when v_token.revoked_at is not null then 'revoked'
    when v_token.expires_at <= now() then 'expired'
    else 'active'
  end;

  return jsonb_build_object(
    'status', v_status,
    'token_id', v_token.id,
    'hardware_uid', v_token.expected_hardware_uid,
    'device_id', v_token.used_by_device_id,
    'expires_at', v_token.expires_at,
    'seconds_remaining', case
      when v_status = 'active' then greatest(
        floor(extract(epoch from (v_token.expires_at - now())))::integer,
        0
      )
      else 0
    end
  );
end;
$$;

-- Manual enrollment now requires an exact token-to-UID match.
create or replace function public.enroll_telemetry_device(
  p_token_hash text,
  p_hardware_uid text,
  p_machine_serial text,
  p_credential_hash text,
  p_firmware text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.telemetry_enrollment_tokens%rowtype;
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

  select * into v_token
  from public.telemetry_enrollment_tokens
  where token_hash = lower(trim(coalesce(p_token_hash, '')))
  for update;

  if not found
     or v_token.used_at is not null
     or v_token.revoked_at is not null
     or v_token.expires_at <= now()
     or v_token.expected_hardware_uid is distinct from v_hardware_uid then
    raise exception 'Invalid, expired, already-used, or UID-mismatched enrollment token'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.telemetry_devices
    where hardware_uid = v_hardware_uid
  ) then
    raise exception 'This ESP32 is already enrolled; recommission it with a new token if credentials were erased'
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
    v_device_code, v_machine_id, v_site_id, 'active', p_credential_hash,
    nullif(p_firmware, ''), v_live_policy_id, 'auto', true, true,
    v_hardware_uid, nullif(trim(p_machine_serial), ''), v_link_status,
    case when v_link_status = 'linked' then 'serial_auto' else null end,
    case when v_link_status = 'linked' then now() else null end
  )
  returning id into v_device_id;

  update public.telemetry_enrollment_tokens
  set used_at = now(),
      used_by_device_id = v_device_id
  where id = v_token.id;

  return jsonb_build_object(
    'accepted', true,
    'enrollment_method', 'one_time_token',
    'device_id', v_device_id,
    'device_code', v_device_code,
    'hardware_uid', v_hardware_uid,
    'machine_id', v_machine_id,
    'machine_link_status', v_link_status,
    'machine_match_count', v_matches,
    'telemetry_mode', 'live'
  );
end;
$$;

revoke all on function public.create_telemetry_enrollment_token(text, text, integer, text)
  from public, anon;
revoke all on function public.revoke_telemetry_enrollment_token(uuid)
  from public, anon;
revoke all on function public.get_telemetry_enrollment_token_status(uuid)
  from public, anon;
revoke all on function public.enroll_telemetry_device(text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.create_telemetry_enrollment_token(text, text, integer, text)
  to authenticated;
grant execute on function public.revoke_telemetry_enrollment_token(uuid)
  to authenticated;
grant execute on function public.get_telemetry_enrollment_token_status(uuid)
  to authenticated;
grant execute on function public.enroll_telemetry_device(text, text, text, text, text)
  to service_role;

comment on function public.create_telemetry_enrollment_token(text, text, integer, text)
  is 'Creates a short-lived UID-bound token from a browser-generated SHA-256 hash; Administrator only.';
comment on function public.revoke_telemetry_enrollment_token(uuid)
  is 'Revokes an unused telemetry enrollment token; Administrator only.';
comment on function public.get_telemetry_enrollment_token_status(uuid)
  is 'Returns non-secret status for one telemetry enrollment token; Administrator only.';
