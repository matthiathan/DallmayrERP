-- Fleet commissioning: optionally bind a UID-locked one-time enrollment token
-- to one exact machine. This avoids relying on passive MDB to expose a unique
-- VMC serial while preserving serial-auto fallback for tokens without a target.

alter table public.telemetry_enrollment_tokens
  add column if not exists expected_machine_id uuid
  references public.machines(id) on delete set null;

create index if not exists telemetry_enrollment_tokens_expected_machine_idx
  on public.telemetry_enrollment_tokens(expected_machine_id)
  where expected_machine_id is not null and used_at is null and revoked_at is null;

create or replace function public.create_telemetry_enrollment_tokens_bulk(
  p_rows jsonb,
  p_minutes integer default 1440,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_actor uuid := auth.uid();
  v_batch_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_item jsonb;
  v_hardware_uid text;
  v_token_hash text;
  v_row_label text;
  v_machine_key text;
  v_machine_key_norm text;
  v_machine_id uuid;
  v_machine_name text;
  v_machine_serial text;
  v_machine_asset text;
  v_machine_barcode text;
  v_machine_matches integer;
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_results jsonb := '[]'::jsonb;
  v_seen_uids text[] := array[]::text[];
  v_seen_machine_ids uuid[] := array[]::uuid[];
  v_count integer;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin','operations']);

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Bulk enrollment rows must be a JSON array.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then
    raise exception 'Bulk enrollment supports between 1 and 500 devices per batch.' using errcode = '22023';
  end if;

  if p_minutes is null or p_minutes < 10 or p_minutes > 10080 then
    raise exception 'Bulk enrollment token duration must be between 10 minutes and 7 days.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each bulk enrollment row must be a JSON object.' using errcode = '22023';
    end if;

    v_hardware_uid := upper(btrim(coalesce(v_item ->> 'hardware_uid', '')));
    v_token_hash := lower(btrim(coalesce(v_item ->> 'token_hash', '')));
    v_row_label := nullif(btrim(coalesce(v_item ->> 'label', '')), '');
    v_machine_key := nullif(btrim(coalesce(v_item ->> 'machine_key', '')), '');
    v_machine_id := null;
    v_machine_name := null;
    v_machine_serial := null;
    v_machine_asset := null;
    v_machine_barcode := null;
    v_machine_matches := 0;

    if v_hardware_uid !~ '^[0-9A-F]{12}$' then
      raise exception 'Hardware UID % must contain exactly 12 hexadecimal characters.', coalesce(nullif(v_hardware_uid, ''), '<blank>') using errcode = '22023';
    end if;
    if v_token_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Enrollment token hash for % must be a SHA-256 hexadecimal digest.', v_hardware_uid using errcode = '22023';
    end if;
    if v_hardware_uid = any(v_seen_uids) then
      raise exception 'Hardware UID % appears more than once in this batch.', v_hardware_uid using errcode = '23505';
    end if;
    v_seen_uids := array_append(v_seen_uids, v_hardware_uid);

    if exists (select 1 from public.telemetry_devices d where d.hardware_uid = v_hardware_uid) then
      raise exception 'Hardware UID % is already enrolled.', v_hardware_uid using errcode = '23505';
    end if;

    if v_machine_key is not null then
      v_machine_key_norm := lower(v_machine_key);

      with matches as (
        select distinct m.id, m.machine_name, m.serial_number, m.asset_tag, m.machine_barcode
        from public.machines m
        where m.telemetry_region = v_region
          and (
            m.id::text = v_machine_key_norm
            or lower(btrim(coalesce(m.serial_number, ''))) = v_machine_key_norm
            or lower(btrim(coalesce(m.asset_tag, ''))) = v_machine_key_norm
            or lower(btrim(coalesce(m.machine_barcode, ''))) = v_machine_key_norm
          )
      )
      select count(*)::integer into v_machine_matches from matches;

      if v_machine_matches = 0 then
        raise exception 'Machine key % does not exactly match a machine in the selected telemetry region.', v_machine_key using errcode = '22023';
      elsif v_machine_matches > 1 then
        raise exception 'Machine key % is ambiguous in the selected telemetry region.', v_machine_key using errcode = '23505';
      end if;

      select m.id, m.machine_name, m.serial_number, m.asset_tag, m.machine_barcode
      into v_machine_id, v_machine_name, v_machine_serial, v_machine_asset, v_machine_barcode
      from public.machines m
      where m.telemetry_region = v_region
        and (
          m.id::text = v_machine_key_norm
          or lower(btrim(coalesce(m.serial_number, ''))) = v_machine_key_norm
          or lower(btrim(coalesce(m.asset_tag, ''))) = v_machine_key_norm
          or lower(btrim(coalesce(m.machine_barcode, ''))) = v_machine_key_norm
        )
      limit 1
      for update;

      if v_machine_id = any(v_seen_machine_ids) then
        raise exception 'Machine % is targeted more than once in this batch.', v_machine_key using errcode = '23505';
      end if;
      v_seen_machine_ids := array_append(v_seen_machine_ids, v_machine_id);

      if exists (
        select 1 from public.telemetry_devices d
        where d.machine_id = v_machine_id and d.status = 'active'
      ) then
        raise exception 'Machine % already has an active telemetry controller.', v_machine_key using errcode = '23505';
      end if;

      if exists (
        select 1 from public.telemetry_enrollment_tokens t
        where t.expected_machine_id = v_machine_id
          and t.used_at is null
          and t.revoked_at is null
          and t.expires_at > now()
          and t.expected_hardware_uid is distinct from v_hardware_uid
      ) then
        raise exception 'Machine % already has an active commissioning token for another controller.', v_machine_key using errcode = '23505';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(v_hardware_uid, 0));

    update public.telemetry_enrollment_tokens
    set revoked_at = now()
    where expected_hardware_uid = v_hardware_uid
      and used_at is null
      and revoked_at is null;

    insert into public.telemetry_enrollment_tokens (
      token_hash,
      label,
      expected_hardware_uid,
      expected_machine_id,
      expires_at,
      created_by_auth_user_id,
      telemetry_region
    ) values (
      v_token_hash,
      coalesce(v_row_label, v_batch_label),
      v_hardware_uid,
      v_machine_id,
      now() + make_interval(mins => p_minutes),
      v_actor,
      v_region
    )
    returning * into v_token;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'token_id', v_token.id,
      'hardware_uid', v_token.expected_hardware_uid,
      'label', v_token.label,
      'telemetry_region', v_region,
      'expected_machine_id', v_machine_id,
      'machine_name', v_machine_name,
      'machine_serial', v_machine_serial,
      'machine_asset_tag', v_machine_asset,
      'machine_barcode', v_machine_barcode,
      'expires_at', v_token.expires_at,
      'seconds_remaining', greatest(floor(extract(epoch from (v_token.expires_at - now())))::integer, 0)
    ));
  end loop;

  return jsonb_build_object(
    'accepted', true,
    'telemetry_region', v_region,
    'count', v_count,
    'expires_in_minutes', p_minutes,
    'issued_at', now(),
    'tokens', v_results
  );
end;
$$;

revoke all on function public.create_telemetry_enrollment_tokens_bulk(jsonb,integer,text) from public, anon;
grant execute on function public.create_telemetry_enrollment_tokens_bulk(jsonb,integer,text) to authenticated;

create or replace function public.get_telemetry_enrollment_token_status(p_token_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_token public.telemetry_enrollment_tokens%rowtype;
  v_status text;
  v_machine public.machines%rowtype;
begin
  select * into v_token
  from public.telemetry_enrollment_tokens
  where id = p_token_id and telemetry_region = v_region;

  if not found then
    return jsonb_build_object('status','missing','token_id',p_token_id);
  end if;

  if v_token.expected_machine_id is not null then
    select * into v_machine from public.machines
    where id = v_token.expected_machine_id and telemetry_region = v_region;
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
    'telemetry_region', v_region,
    'device_id', v_token.used_by_device_id,
    'expected_machine_id', v_token.expected_machine_id,
    'machine_name', v_machine.machine_name,
    'machine_serial', v_machine.serial_number,
    'machine_asset_tag', v_machine.asset_tag,
    'machine_barcode', v_machine.machine_barcode,
    'expires_at', v_token.expires_at,
    'seconds_remaining', case when v_status='active' then greatest(floor(extract(epoch from(v_token.expires_at-now())))::integer,0) else 0 end
  );
end;
$$;

revoke all on function public.get_telemetry_enrollment_token_status(uuid) from public, anon;
grant execute on function public.get_telemetry_enrollment_token_status(uuid) to authenticated;

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
  v_region text;
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid,'')));
  v_device_code text;
  v_device_id uuid;
  v_live_policy_id uuid;
  v_machine_id uuid;
  v_site_id uuid;
  v_serial text := lower(trim(coalesce(p_machine_serial,'')));
  v_matches integer := 0;
  v_link_status text := 'unlinked';
  v_link_method text := null;
  v_expected_machine public.machines%rowtype;
begin
  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Invalid ESP32 hardware UID' using errcode='22023';
  end if;
  if nullif(trim(coalesce(p_credential_hash,'')),'') is null then
    raise exception 'Credential hash is required' using errcode='22023';
  end if;

  select * into v_token
  from public.telemetry_enrollment_tokens
  where token_hash = lower(trim(coalesce(p_token_hash,'')))
  for update;

  if not found
     or v_token.used_at is not null
     or v_token.revoked_at is not null
     or v_token.expires_at <= now()
     or v_token.expected_hardware_uid is distinct from v_hardware_uid then
    raise exception 'Invalid, expired, already-used, or UID-mismatched enrollment token' using errcode='42501';
  end if;

  v_region := v_token.telemetry_region;

  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then
    raise exception 'This ESP32 is already enrolled; recommission it with a new token if credentials were erased' using errcode='23505';
  end if;

  v_device_code := 'DLM-ESP32-' || v_hardware_uid;

  if v_token.expected_machine_id is not null then
    select * into v_expected_machine
    from public.machines
    where id = v_token.expected_machine_id
      and telemetry_region = v_region
    for update;

    if not found then
      raise exception 'The machine preassigned to this enrollment token is no longer available in the token region.' using errcode='42501';
    end if;

    if exists (
      select 1 from public.telemetry_devices d
      where d.machine_id = v_expected_machine.id and d.status = 'active'
    ) then
      raise exception 'The machine preassigned to this enrollment token already has an active telemetry controller.' using errcode='23505';
    end if;

    v_machine_id := v_expected_machine.id;
    v_site_id := v_expected_machine.site_id;
    v_matches := 1;
    v_link_status := 'linked';
    v_link_method := 'token_preassigned';
  elsif v_serial <> '' then
    select count(*)::integer into v_matches
    from public.machines
    where telemetry_region = v_region
      and nullif(trim(serial_number),'') is not null
      and lower(trim(serial_number)) = v_serial;

    if v_matches = 1 then
      select id,site_id into v_machine_id,v_site_id
      from public.machines
      where telemetry_region = v_region
        and nullif(trim(serial_number),'') is not null
        and lower(trim(serial_number)) = v_serial
      limit 1;
      v_link_status := 'linked';
      v_link_method := 'serial_auto';
    elsif v_matches = 0 then
      v_link_status := 'no_match';
    else
      v_link_status := 'ambiguous';
    end if;
  end if;

  select id into v_live_policy_id
  from public.telemetry_policies
  where policy_code='live'
  limit 1;

  insert into public.telemetry_devices(
    device_code,machine_id,site_id,status,credential_hash,firmware_version,
    telemetry_policy_id,transport_preference,wifi_enabled,cellular_enabled,
    hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,
    machine_linked_at,telemetry_region
  ) values (
    v_device_code,v_machine_id,v_site_id,'active',p_credential_hash,nullif(p_firmware,''),
    v_live_policy_id,'auto',true,true,v_hardware_uid,nullif(trim(p_machine_serial),''),
    v_link_status,v_link_method,case when v_link_status='linked' then now() else null end,v_region
  ) returning id into v_device_id;

  update public.telemetry_enrollment_tokens
  set used_at=now(),used_by_device_id=v_device_id
  where id=v_token.id;

  return jsonb_build_object(
    'accepted',true,
    'enrollment_method','one_time_token',
    'telemetry_region',v_region,
    'device_id',v_device_id,
    'device_code',v_device_code,
    'hardware_uid',v_hardware_uid,
    'machine_id',v_machine_id,
    'machine_link_status',v_link_status,
    'machine_link_method',v_link_method,
    'machine_match_count',v_matches,
    'telemetry_mode','live'
  );
end;
$$;

revoke all on function public.enroll_telemetry_device(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.enroll_telemetry_device(text,text,text,text,text) to service_role;
