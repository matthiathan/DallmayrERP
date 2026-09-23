-- Keep single-controller commissioning controls aligned with bulk issuance.
-- Token metadata and revocation are restricted to active Administrator/Operations
-- users in the currently selected telemetry region.

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
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  perform public.require_app_role(array['admin','operations']);

  select * into v_token
  from public.telemetry_enrollment_tokens
  where id = p_token_id and telemetry_region = v_region;

  if not found then
    return jsonb_build_object('status','missing','token_id',p_token_id);
  end if;

  if v_token.expected_machine_id is not null then
    select * into v_machine
    from public.machines
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

create or replace function public.revoke_telemetry_enrollment_token(p_token_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_token public.telemetry_enrollment_tokens%rowtype;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  perform public.require_app_role(array['admin','operations']);

  update public.telemetry_enrollment_tokens
  set revoked_at = coalesce(revoked_at, now())
  where id = p_token_id
    and telemetry_region = v_region
    and used_at is null
  returning * into v_token;

  return jsonb_build_object(
    'revoked', found,
    'token_id', p_token_id,
    'hardware_uid', v_token.expected_hardware_uid,
    'telemetry_region', v_region
  );
end;
$$;

revoke all on function public.get_telemetry_enrollment_token_status(uuid) from public, anon;
grant execute on function public.get_telemetry_enrollment_token_status(uuid) to authenticated;
revoke all on function public.revoke_telemetry_enrollment_token(uuid) from public, anon;
grant execute on function public.revoke_telemetry_enrollment_token(uuid) to authenticated;
