-- Persist automatic decoder profiles only when current device identity maps
-- uniquely to verified identity evidence. Weak/model-similarity resolver matches
-- remain advisory and are never written to telemetry_devices.profile_id here.

create or replace function private.apply_verified_telemetry_profile_identity_internal_v1(
  p_device_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_device public.telemetry_devices%rowtype;
  v_fingerprint_norm text := '';
  v_model_norm text := '';
  v_match_count integer := 0;
  v_profile_key text := null;
  v_previous_profile text := null;
  v_status text := 'unmatched';
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
  end if;

  if coalesce(v_device.profile_assignment_method, 'automatic') = 'manual' then
    return jsonb_build_object(
      'device_id', v_device.id,
      'status', 'manual_override',
      'profile_id', v_device.profile_id,
      'profile_assignment_method', 'manual',
      'match_count', null
    );
  end if;

  v_previous_profile := nullif(btrim(coalesce(v_device.profile_id, '')), '');
  v_fingerprint_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_profile_fingerprint);
  v_model_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_model);

  with matched_profiles as (
    select distinct e.profile_id
    from public.machine_model_profile_identity_evidence e
    where e.verified = true
      and (
        (
          e.evidence_type = 'fingerprint'
          and v_fingerprint_norm <> ''
          and public.normalize_telemetry_identity_token(e.evidence_value) = v_fingerprint_norm
        )
        or (
          e.evidence_type = 'model_alias'
          and v_model_norm <> ''
          and public.normalize_telemetry_identity_token(e.evidence_value) = v_model_norm
        )
      )
  )
  select count(*)::integer, min(mp.model_key)
  into v_match_count, v_profile_key
  from matched_profiles matched
  join public.machine_model_profiles mp on mp.id = matched.profile_id;

  if v_match_count = 1 then
    if v_previous_profile is distinct from v_profile_key then
      update public.telemetry_devices
      set profile_id = v_profile_key,
          profile_updated_at = now(),
          updated_at = now()
      where id = v_device.id
        and profile_assignment_method = 'automatic';
      v_status := 'applied';
    else
      v_status := 'already_applied';
    end if;
  else
    -- An automatic profile must never remain stale when identity evidence becomes
    -- unmatched or ambiguous. Manual assignments returned above are untouched.
    if v_match_count <> 1 and v_previous_profile is not null then
      update public.telemetry_devices
      set profile_id = null,
          profile_updated_at = now(),
          updated_at = now()
      where id = v_device.id
        and profile_assignment_method = 'automatic';
    end if;
    v_profile_key := null;
    v_status := case when v_match_count > 1 then 'ambiguous' else 'unmatched' end;
  end if;

  return jsonb_build_object(
    'device_id', v_device.id,
    'status', v_status,
    'profile_id', v_profile_key,
    'previous_profile_id', v_previous_profile,
    'profile_assignment_method', 'automatic',
    'match_count', v_match_count
  );
end;
$function$;

revoke all on function private.apply_verified_telemetry_profile_identity_internal_v1(uuid) from public;
revoke all on function private.apply_verified_telemetry_profile_identity_internal_v1(uuid) from anon;
revoke all on function private.apply_verified_telemetry_profile_identity_internal_v1(uuid) from authenticated;
grant execute on function private.apply_verified_telemetry_profile_identity_internal_v1(uuid) to service_role;

create or replace function private.auto_apply_verified_telemetry_profile_on_identity()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
begin
  if coalesce(new.profile_assignment_method, 'automatic') = 'automatic' then
    perform private.apply_verified_telemetry_profile_identity_internal_v1(new.id);
  end if;
  return new;
end;
$function$;

revoke all on function private.auto_apply_verified_telemetry_profile_on_identity() from public;
revoke all on function private.auto_apply_verified_telemetry_profile_on_identity() from anon;
revoke all on function private.auto_apply_verified_telemetry_profile_on_identity() from authenticated;
grant execute on function private.auto_apply_verified_telemetry_profile_on_identity() to service_role;

drop trigger if exists telemetry_devices_auto_apply_verified_profile_on_identity
  on public.telemetry_devices;
create trigger telemetry_devices_auto_apply_verified_profile_on_identity
after insert or update of
  reported_machine_profile_fingerprint,
  reported_machine_model,
  profile_assignment_method
on public.telemetry_devices
for each row
execute function private.auto_apply_verified_telemetry_profile_on_identity();

create or replace function private.reconcile_verified_profile_evidence_devices()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_device_id uuid;
  v_new_norm text := public.normalize_telemetry_identity_token(new.evidence_value);
  v_old_norm text := '';
begin
  for v_device_id in
    select d.id
    from public.telemetry_devices d
    where d.profile_assignment_method = 'automatic'
      and (
        (
          new.evidence_type = 'fingerprint'
          and v_new_norm <> ''
          and public.normalize_telemetry_identity_token(d.reported_machine_profile_fingerprint) = v_new_norm
        )
        or (
          new.evidence_type = 'model_alias'
          and v_new_norm <> ''
          and public.normalize_telemetry_identity_token(d.reported_machine_model) = v_new_norm
        )
      )
  loop
    perform private.apply_verified_telemetry_profile_identity_internal_v1(v_device_id);
  end loop;

  if tg_op = 'UPDATE' then
    v_old_norm := public.normalize_telemetry_identity_token(old.evidence_value);

    if old.evidence_type is distinct from new.evidence_type
       or v_old_norm is distinct from v_new_norm
       or old.profile_id is distinct from new.profile_id
       or old.verified is distinct from new.verified then
      for v_device_id in
        select d.id
        from public.telemetry_devices d
        where d.profile_assignment_method = 'automatic'
          and (
            (
              old.evidence_type = 'fingerprint'
              and v_old_norm <> ''
              and public.normalize_telemetry_identity_token(d.reported_machine_profile_fingerprint) = v_old_norm
            )
            or (
              old.evidence_type = 'model_alias'
              and v_old_norm <> ''
              and public.normalize_telemetry_identity_token(d.reported_machine_model) = v_old_norm
            )
          )
      loop
        perform private.apply_verified_telemetry_profile_identity_internal_v1(v_device_id);
      end loop;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function private.reconcile_verified_profile_evidence_devices() from public;
revoke all on function private.reconcile_verified_profile_evidence_devices() from anon;
revoke all on function private.reconcile_verified_profile_evidence_devices() from authenticated;
grant execute on function private.reconcile_verified_profile_evidence_devices() to service_role;

drop trigger if exists telemetry_profile_evidence_reconcile_devices
  on public.machine_model_profile_identity_evidence;
create trigger telemetry_profile_evidence_reconcile_devices
after insert or update of verified, evidence_type, evidence_value, profile_id
on public.machine_model_profile_identity_evidence
for each row
execute function private.reconcile_verified_profile_evidence_devices();

-- Reconcile existing automatic-mode devices once under the new verified-only rule.
do $block$
declare
  v_device_id uuid;
begin
  for v_device_id in
    select id
    from public.telemetry_devices
    where profile_assignment_method = 'automatic'
  loop
    perform private.apply_verified_telemetry_profile_identity_internal_v1(v_device_id);
  end loop;
end;
$block$;
