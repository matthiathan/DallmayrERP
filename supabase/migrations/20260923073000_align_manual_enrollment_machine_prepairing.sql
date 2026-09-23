-- Align single-controller/manual commissioning with the bulk enrollment path.
-- Existing four-argument callers remain compatible through the defaulted
-- p_machine_key parameter, while operators can optionally pre-pair one exact
-- machine before the controller is installed.

drop function if exists public.create_telemetry_enrollment_token(text,text,integer,text);

create function public.create_telemetry_enrollment_token(
  p_hardware_uid text,
  p_token_hash text,
  p_minutes integer default 10,
  p_label text default null,
  p_machine_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_hardware_uid text := upper(trim(coalesce(p_hardware_uid, '')));
  v_token_hash text := lower(trim(coalesce(p_token_hash, '')));
  v_machine_key text := nullif(btrim(coalesce(p_machine_key, '')), '');
  v_machine_key_norm text;
  v_machine_matches integer := 0;
  v_machine public.machines%rowtype;
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  perform public.require_app_role(array['admin','operations']);

  if v_hardware_uid !~ '^[0-9A-F]{12}$' then
    raise exception 'Hardware UID must contain exactly 12 hexadecimal characters' using errcode='22023';
  end if;
  if v_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Enrollment token hash must be a SHA-256 hexadecimal digest' using errcode='22023';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Enrollment token duration must be between 1 and 60 minutes' using errcode='22023';
  end if;
  if exists(select 1 from public.telemetry_devices where hardware_uid=v_hardware_uid) then
    raise exception 'This ESP32 hardware UID is already enrolled' using errcode='23505';
  end if;

  if v_machine_key is not null then
    v_machine_key_norm := lower(v_machine_key);

    select count(distinct m.id)::integer into v_machine_matches
    from public.machines m
    where m.telemetry_region = v_region
      and (
        m.id::text = v_machine_key_norm
        or lower(btrim(coalesce(m.serial_number, ''))) = v_machine_key_norm
        or lower(btrim(coalesce(m.asset_tag, ''))) = v_machine_key_norm
        or lower(btrim(coalesce(m.machine_barcode, ''))) = v_machine_key_norm
      );

    if v_machine_matches = 0 then
      raise exception 'Machine key % does not exactly match a machine in the selected telemetry region.', v_machine_key using errcode='22023';
    elsif v_machine_matches > 1 then
      raise exception 'Machine key % is ambiguous in the selected telemetry region.', v_machine_key using errcode='23505';
    end if;

    select m.* into v_machine
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

    if exists (
      select 1 from public.telemetry_devices d
      where d.machine_id = v_machine.id and d.status = 'active'
    ) then
      raise exception 'Machine % already has an active telemetry controller.', v_machine_key using errcode='23505';
    end if;

    if exists (
      select 1 from public.telemetry_enrollment_tokens t
      where t.expected_machine_id = v_machine.id
        and t.used_at is null
        and t.revoked_at is null
        and t.expires_at > now()
        and t.expected_hardware_uid is distinct from v_hardware_uid
    ) then
      raise exception 'Machine % already has an active commissioning token for another controller.', v_machine_key using errcode='23505';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_hardware_uid, 0));

  update public.telemetry_enrollment_tokens
  set revoked_at = now()
  where expected_hardware_uid = v_hardware_uid
    and used_at is null
    and revoked_at is null;

  insert into public.telemetry_enrollment_tokens(
    token_hash,label,expected_hardware_uid,expected_machine_id,expires_at,
    created_by_auth_user_id,telemetry_region
  ) values (
    v_token_hash,
    nullif(trim(coalesce(p_label,'')),''),
    v_hardware_uid,
    v_machine.id,
    now()+make_interval(mins=>p_minutes),
    auth.uid(),
    v_region
  ) returning * into v_token;

  return jsonb_build_object(
    'token_id',v_token.id,
    'hardware_uid',v_token.expected_hardware_uid,
    'telemetry_region',v_region,
    'expected_machine_id',v_token.expected_machine_id,
    'machine_name',v_machine.machine_name,
    'machine_serial',v_machine.serial_number,
    'machine_asset_tag',v_machine.asset_tag,
    'machine_barcode',v_machine.machine_barcode,
    'expires_at',v_token.expires_at,
    'seconds_remaining',greatest(floor(extract(epoch from(v_token.expires_at-now())))::integer,0)
  );
end;
$$;

revoke all on function public.create_telemetry_enrollment_token(text,text,integer,text,text) from public, anon;
grant execute on function public.create_telemetry_enrollment_token(text,text,integer,text,text) to authenticated;
