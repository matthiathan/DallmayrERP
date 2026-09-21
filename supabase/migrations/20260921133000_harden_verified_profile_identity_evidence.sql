-- Verified decoder-profile identity evidence changes automatic profile selection
-- for the whole fleet. Keep direct reads available to provisioned application
-- users, but force every write through an audited administrator RPC that derives
-- the evidence value from a real telemetry-device observation in the selected
-- region.

alter table public.machine_model_profile_identity_evidence
  add column if not exists source_device_id uuid references public.telemetry_devices(id) on delete set null,
  add column if not exists source_telemetry_region text,
  add column if not exists verified_by_auth_user_id uuid,
  add column if not exists verified_at timestamptz;

create index if not exists machine_model_profile_identity_evidence_source_device_idx
  on public.machine_model_profile_identity_evidence (source_device_id, verified_at desc);

create unique index if not exists machine_model_profile_identity_evidence_verified_model_alias_uidx
  on public.machine_model_profile_identity_evidence (
    public.normalize_telemetry_identity_token(evidence_value)
  )
  where evidence_type = 'model_alias' and verified = true;

-- Direct authenticated writes are too broad for globally trusted identity rules.
revoke insert, update, delete, truncate, references, trigger
  on table public.machine_model_profile_identity_evidence
  from authenticated;
grant select on table public.machine_model_profile_identity_evidence to authenticated;

-- Keep a read-only RLS path so the exposed table does not become an unrestricted
-- global write surface. The promotion RPC below owns all writes.
drop policy if exists machine_model_profile_identity_evidence_internal_write
  on public.machine_model_profile_identity_evidence;
drop policy if exists machine_model_profile_identity_evidence_internal_read
  on public.machine_model_profile_identity_evidence;
create policy machine_model_profile_identity_evidence_internal_read
  on public.machine_model_profile_identity_evidence
  for select
  to authenticated
  using (public.current_app_role() is not null);

create or replace function public.get_telemetry_profile_identity_candidate(
  p_device_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
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
    'source_device_id', e.source_device_id,
    'source_telemetry_region', e.source_telemetry_region,
    'verified_at', e.verified_at
  ) order by e.verified desc, e.updated_at desc), '[]'::jsonb)
  into v_verified_matches
  from public.machine_model_profile_identity_evidence e
  join public.machine_model_profiles mp on mp.id = e.profile_id
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
$$;

revoke all on function public.get_telemetry_profile_identity_candidate(uuid) from public, anon;
grant execute on function public.get_telemetry_profile_identity_candidate(uuid) to authenticated;

create or replace function public.verify_telemetry_profile_identity_evidence(
  p_device_id uuid,
  p_profile_key text,
  p_evidence_type text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_profile public.machine_model_profiles%rowtype;
  v_type text := lower(btrim(coalesce(p_evidence_type, '')));
  v_value text;
  v_value_norm text;
  v_existing_id uuid;
  v_conflict record;
  v_actor uuid := auth.uid();
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  perform public.require_app_role(array['admin']);

  if v_type not in ('fingerprint', 'model_alias') then
    raise exception 'Only a reported fingerprint or reported machine model alias can be verified.' using errcode = '22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region
  for update;

  if not found then
    raise exception 'Telemetry device not found in the selected telemetry region.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.machine_model_profiles
  where lower(btrim(model_key)) = lower(btrim(coalesce(p_profile_key, '')))
  limit 1;

  if not found then
    raise exception 'Decoder profile not found.' using errcode = '22023';
  end if;

  v_value := case v_type
    when 'fingerprint' then nullif(btrim(coalesce(v_device.reported_machine_profile_fingerprint, '')), '')
    when 'model_alias' then nullif(btrim(coalesce(v_device.reported_machine_model, '')), '')
  end;

  if v_value is null then
    raise exception 'The selected device has not reported this identity evidence yet.' using errcode = '22023';
  end if;

  v_value_norm := public.normalize_telemetry_identity_token(v_value);
  if v_value_norm = '' then
    raise exception 'Reported identity evidence is blank after normalization.' using errcode = '22023';
  end if;

  select e.id, mp.model_key, mp.display_name
  into v_conflict
  from public.machine_model_profile_identity_evidence e
  join public.machine_model_profiles mp on mp.id = e.profile_id
  where e.verified = true
    and e.evidence_type = v_type
    and public.normalize_telemetry_identity_token(e.evidence_value) = v_value_norm
    and e.profile_id <> v_profile.id
  limit 1;

  if found then
    raise exception 'This verified identity evidence already belongs to decoder profile %.', v_conflict.model_key
      using errcode = '23505';
  end if;

  select e.id into v_existing_id
  from public.machine_model_profile_identity_evidence e
  where e.profile_id = v_profile.id
    and e.evidence_type = v_type
    and public.normalize_telemetry_identity_token(e.evidence_value) = v_value_norm
  limit 1
  for update;

  if v_existing_id is null then
    insert into public.machine_model_profile_identity_evidence (
      profile_id,
      evidence_type,
      evidence_value,
      verified,
      notes,
      source_device_id,
      source_telemetry_region,
      verified_by_auth_user_id,
      verified_at
    ) values (
      v_profile.id,
      v_type,
      v_value,
      true,
      v_notes,
      v_device.id,
      v_region,
      v_actor,
      now()
    )
    returning id into v_existing_id;
  else
    update public.machine_model_profile_identity_evidence
    set evidence_value = v_value,
        verified = true,
        notes = coalesce(v_notes, notes),
        source_device_id = v_device.id,
        source_telemetry_region = v_region,
        verified_by_auth_user_id = v_actor,
        verified_at = now(),
        updated_at = now()
    where id = v_existing_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'evidence_id', v_existing_id,
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'telemetry_region', v_region,
    'profile_id', v_profile.id,
    'profile_key', v_profile.model_key,
    'profile_name', v_profile.display_name,
    'evidence_type', v_type,
    'evidence_value', v_value,
    'verified_by_auth_user_id', v_actor,
    'verified_at', now()
  );
end;
$$;

revoke all on function public.verify_telemetry_profile_identity_evidence(uuid,text,text,text) from public, anon;
grant execute on function public.verify_telemetry_profile_identity_evidence(uuid,text,text,text) to authenticated;
