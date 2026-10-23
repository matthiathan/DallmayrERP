-- Secure factory-authorized zero-touch enrollment.
--
-- A field installer never needs to open an enrollment window or type a token.
-- Each device is given a one-time bootstrap secret during manufacturing/provisioning.
-- Only the SHA-256 hash is stored in Supabase. The plaintext bootstrap secret is
-- never stored in this table and must never be committed to this repository.

create table if not exists public.telemetry_factory_device_claims (
  id uuid primary key default gen_random_uuid(),
  hardware_uid text not null unique,
  bootstrap_token_hash text not null,
  telemetry_region text not null,
  status text not null default 'ready',
  claimed_device_id uuid null references public.telemetry_devices(id) on delete set null,
  claimed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telemetry_factory_device_claims_hardware_uid_check
    check (hardware_uid ~ '^[0-9A-F]{12}$'),
  constraint telemetry_factory_device_claims_token_hash_check
    check (bootstrap_token_hash ~ '^[0-9a-f]{64}$'),
  constraint telemetry_factory_device_claims_region_check
    check (telemetry_region in ('south_africa', 'dubai', 'europe')),
  constraint telemetry_factory_device_claims_status_check
    check (status in ('ready', 'claimed', 'revoked'))
);

alter table public.telemetry_factory_device_claims enable row level security;
revoke all on public.telemetry_factory_device_claims from public, anon, authenticated;
grant all on public.telemetry_factory_device_claims to service_role;

create index if not exists telemetry_factory_device_claims_status_idx
  on public.telemetry_factory_device_claims(status, telemetry_region);

create or replace function public.enroll_telemetry_device_factory(
  p_hardware_uid text,
  p_bootstrap_token_hash text,
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
  v_claim public.telemetry_factory_device_claims%rowtype;
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid, '')));
  v_serial text := lower(trim(coalesce(p_machine_serial, '')));
  v_device_code text;
  v_device_id uuid;
  v_live_policy_id uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_matches integer := 0;
  v_link_status text := 'unlinked';
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Invalid ESP32 hardware UID' using errcode = '22023';
  end if;
  if coalesce(p_bootstrap_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid factory bootstrap credential' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_credential_hash, '')), '') is null then
    raise exception 'Credential hash is required' using errcode = '22023';
  end if;

  select * into v_claim
  from public.telemetry_factory_device_claims
  where hardware_uid = v_hardware_uid
    and bootstrap_token_hash = lower(p_bootstrap_token_hash)
    and status = 'ready'
  for update;

  if not found then
    raise exception 'This device is not factory-authorized for zero-touch enrollment'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.telemetry_devices where hardware_uid = v_hardware_uid) then
    raise exception 'This ESP32 is already enrolled; recommission it if credentials were erased'
      using errcode = '23505';
  end if;

  v_device_code := 'DLM-ESP32-' || v_hardware_uid;

  -- Exact serial evidence may link one known asset. Location/profile evidence is
  -- deliberately not allowed to invent an exact machine assignment.
  if v_serial <> '' then
    select count(*)::integer into v_matches
    from public.machines
    where telemetry_region = v_claim.telemetry_region
      and nullif(trim(serial_number), '') is not null
      and lower(trim(serial_number)) = v_serial;

    if v_matches = 1 then
      select id, site_id into v_machine_id, v_site_id
      from public.machines
      where telemetry_region = v_claim.telemetry_region
        and nullif(trim(serial_number), '') is not null
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
    machine_link_method, machine_linked_at, telemetry_region
  ) values (
    v_device_code, v_machine_id, v_site_id, 'active', p_credential_hash,
    nullif(p_firmware, ''), v_live_policy_id, 'cellular', true, true,
    v_hardware_uid, nullif(trim(p_machine_serial), ''), v_link_status,
    case when v_link_status = 'linked' then 'serial_auto' else null end,
    case when v_link_status = 'linked' then now() else null end,
    v_claim.telemetry_region
  )
  returning id into v_device_id;

  update public.telemetry_factory_device_claims
  set status = 'claimed',
      claimed_device_id = v_device_id,
      claimed_at = now(),
      updated_at = now()
  where id = v_claim.id;

  return jsonb_build_object(
    'accepted', true,
    'enrollment_method', 'factory_zero_touch',
    'telemetry_region', v_claim.telemetry_region,
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

revoke all on function public.enroll_telemetry_device_factory(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.enroll_telemetry_device_factory(text, text, text, text, text)
  to service_role;
