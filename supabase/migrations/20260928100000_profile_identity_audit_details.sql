-- Extend the existing region-scoped decoder identity candidate payload with
-- audit attribution already stored on verified evidence. This does not broaden
-- mutation access or change the verified-only automatic profile rule.

create or replace function public.get_telemetry_profile_identity_candidate(p_device_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_machine public.machines%rowtype;
  v_resolution jsonb := '{}'::jsonb;
  v_profiles jsonb := '[]'::jsonb;
  v_verified_matches jsonb := '[]'::jsonb;
  v_fingerprint_norm text := '';
  v_model_norm text := '';
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region;

  if not found then
    raise exception 'Telemetry device not found in the selected telemetry region.' using errcode = '22023';
  end if;

  if v_device.machine_id is not null then
    select * into v_machine
    from public.machines
    where id = v_device.machine_id
      and telemetry_region = v_region;
  end if;

  v_resolution := public.resolve_telemetry_device_profile(v_device.id);
  v_fingerprint_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_profile_fingerprint);
  v_model_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_model);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mp.id,
    'model_key', mp.model_key,
    'display_name', mp.display_name,
    'button_count', mp.button_count
  ) order by mp.display_name), '[]'::jsonb)
  into v_profiles
  from public.machine_model_profiles mp;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'evidence_type', e.evidence_type,
    'evidence_value', e.evidence_value,
    'verified', e.verified,
    'profile_key', mp.model_key,
    'profile_name', mp.display_name,
    'notes', e.notes,
    'source_device_id', e.source_device_id,
    'source_device_code', source_device.device_code,
    'source_telemetry_region', e.source_telemetry_region,
    'verified_by_name', nullif(btrim(concat_ws(' ', verifier_details.first_name, verifier_details.last_name)), ''),
    'verified_at', e.verified_at
  ) order by e.verified desc, e.updated_at desc), '[]'::jsonb)
  into v_verified_matches
  from public.machine_model_profile_identity_evidence e
  join public.machine_model_profiles mp on mp.id = e.profile_id
  left join public.telemetry_devices source_device on source_device.id = e.source_device_id
  left join public.users verifier_user on verifier_user.auth_user_id = e.verified_by_auth_user_id
  left join public.user_details verifier_details on verifier_details.user_id = verifier_user.id
  where (
      e.evidence_type = 'fingerprint'
      and v_fingerprint_norm <> ''
      and public.normalize_telemetry_identity_token(e.evidence_value) = v_fingerprint_norm
    )
    or (
      e.evidence_type = 'model_alias'
      and v_model_norm <> ''
      and public.normalize_telemetry_identity_token(e.evidence_value) = v_model_norm
    );

  return jsonb_build_object(
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'telemetry_region', v_region,
    'machine_id', v_device.machine_id,
    'machine_name', coalesce(v_machine.machine_name, v_machine.model),
    'machine_model', v_machine.model,
    'can_verify', public.current_app_role() = 'admin',
    'observations', jsonb_build_object(
      'fingerprint', nullif(v_device.reported_machine_profile_fingerprint, ''),
      'model', nullif(v_device.reported_machine_model, ''),
      'interface', nullif(v_device.reported_machine_interface, ''),
      'revision', nullif(v_device.reported_machine_revision, ''),
      'identity_source', nullif(v_device.reported_machine_identity_source, ''),
      'identity_at', v_device.reported_machine_identity_at
    ),
    'resolution', v_resolution,
    'profiles', v_profiles,
    'verified_matches', v_verified_matches
  );
end;
$function$;
