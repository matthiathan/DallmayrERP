create table if not exists public.machine_model_profile_identity_evidence (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.machine_model_profiles(id) on delete cascade,
  evidence_type text not null,
  evidence_value text not null,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_model_profile_identity_evidence_type_check
    check (evidence_type in ('fingerprint', 'interface', 'model_alias', 'revision')),
  constraint machine_model_profile_identity_evidence_value_not_blank
    check (btrim(evidence_value) <> '')
);

create unique index if not exists machine_model_profile_identity_evidence_profile_value_uidx
  on public.machine_model_profile_identity_evidence (
    profile_id,
    evidence_type,
    (lower(btrim(evidence_value)))
  );

create unique index if not exists machine_model_profile_identity_evidence_verified_fingerprint_uidx
  on public.machine_model_profile_identity_evidence ((lower(btrim(evidence_value))))
  where evidence_type = 'fingerprint' and verified = true;

create index if not exists machine_model_profile_identity_evidence_profile_idx
  on public.machine_model_profile_identity_evidence (profile_id, evidence_type, verified);

drop trigger if exists machine_model_profile_identity_evidence_set_updated_at
  on public.machine_model_profile_identity_evidence;
create trigger machine_model_profile_identity_evidence_set_updated_at
before update on public.machine_model_profile_identity_evidence
for each row execute function public.set_updated_at();

alter table public.machine_model_profile_identity_evidence enable row level security;

grant select, insert, update, delete on public.machine_model_profile_identity_evidence to authenticated;
grant select, insert, update, delete on public.machine_model_profile_identity_evidence to service_role;
revoke all on public.machine_model_profile_identity_evidence from anon;

drop policy if exists machine_model_profile_identity_evidence_internal_read
  on public.machine_model_profile_identity_evidence;
create policy machine_model_profile_identity_evidence_internal_read
  on public.machine_model_profile_identity_evidence for select to authenticated
  using (public.current_app_role() is not null);

drop policy if exists machine_model_profile_identity_evidence_internal_write
  on public.machine_model_profile_identity_evidence;
create policy machine_model_profile_identity_evidence_internal_write
  on public.machine_model_profile_identity_evidence for all to authenticated
  using (public.current_app_role() is not null)
  with check (public.current_app_role() is not null);

create or replace function public.normalize_telemetry_identity_token(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(coalesce(btrim(p_value), '')), '[^a-z0-9]+', '', 'g');
$$;

revoke all on function public.normalize_telemetry_identity_token(text) from public, anon;
grant execute on function public.normalize_telemetry_identity_token(text) to authenticated, service_role;

create or replace function public.resolve_telemetry_device_profile(p_device_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_machine public.machines%rowtype;
  v_candidates jsonb := '[]'::jsonb;
  v_top jsonb := null;
  v_second_score integer := 0;
  v_top_score integer := 0;
  v_gap integer := 0;
  v_detected_model_norm text := '';
  v_database_model_norm text := '';
  v_fingerprint_norm text := '';
  v_interface_norm text := '';
  v_revision_norm text := '';
  v_resolution text := 'automatic_unmatched';
  v_confidence text := 'unknown';
  v_effective_profile text := null;
  v_reason text := null;
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role <> 'service_role' and public.current_app_role() is null then
    raise exception 'A provisioned DallmayrERP user is required.' using errcode = '42501';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id;

  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
  end if;

  if v_device.machine_id is not null then
    select * into v_machine
    from public.machines
    where id = v_device.machine_id;
  end if;

  if coalesce(v_device.profile_assignment_method, 'automatic') = 'manual' then
    select jsonb_build_object(
      'id', mp.id,
      'model_key', mp.model_key,
      'display_name', mp.display_name,
      'button_count', mp.button_count,
      'score', 1000,
      'reason', 'Manual decoder profile override.',
      'fingerprint_match', false,
      'interface_match', false,
      'model_match_kind', 'manual'
    )
    into v_top
    from public.machine_model_profiles mp
    where lower(btrim(mp.model_key)) = lower(btrim(coalesce(v_device.profile_id, '')))
    limit 1;

    v_effective_profile := nullif(v_device.profile_id, '');
    v_resolution := 'manual';
    v_confidence := case when v_top is null then 'unknown' else 'high' end;

    return jsonb_build_object(
      'device_id', v_device.id,
      'profile_assignment_method', 'manual',
      'profile_resolution', v_resolution,
      'effective_profile_key', v_effective_profile,
      'recommended_profile', v_top,
      'confidence', v_confidence,
      'candidate_gap', null,
      'ambiguous', false
    );
  end if;

  v_detected_model_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_model);
  v_database_model_norm := public.normalize_telemetry_identity_token(coalesce(v_machine.model, v_machine.machine_name));
  v_fingerprint_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_profile_fingerprint);
  v_interface_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_interface);
  v_revision_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_revision);

  with evidence as (
    select
      mp.id as profile_id,
      coalesce(bool_or(
        e.verified
        and e.evidence_type = 'fingerprint'
        and v_fingerprint_norm <> ''
        and public.normalize_telemetry_identity_token(e.evidence_value) = v_fingerprint_norm
      ), false) as fingerprint_match,
      coalesce(bool_or(
        e.verified
        and e.evidence_type = 'model_alias'
        and v_detected_model_norm <> ''
        and public.normalize_telemetry_identity_token(e.evidence_value) = v_detected_model_norm
      ), false) as model_alias_match,
      coalesce(bool_or(e.verified and e.evidence_type = 'interface'), false) as has_interface_rule,
      coalesce(bool_or(
        e.verified
        and e.evidence_type = 'interface'
        and v_interface_norm <> ''
        and public.normalize_telemetry_identity_token(e.evidence_value) = v_interface_norm
      ), false) as interface_match,
      coalesce(bool_or(
        e.verified
        and e.evidence_type = 'revision'
        and v_revision_norm <> ''
        and public.normalize_telemetry_identity_token(e.evidence_value) = v_revision_norm
      ), false) as revision_match
    from public.machine_model_profiles mp
    left join public.machine_model_profile_identity_evidence e on e.profile_id = mp.id
    group by mp.id
  ), scored as (
    select
      mp.id,
      mp.model_key,
      mp.display_name,
      mp.button_count,
      ev.fingerprint_match,
      ev.model_alias_match,
      ev.has_interface_rule,
      ev.interface_match,
      ev.revision_match,
      case
        when v_detected_model_norm <> ''
          and public.normalize_telemetry_identity_token(mp.model_key) = v_detected_model_norm then 100
        when v_detected_model_norm <> ''
          and public.normalize_telemetry_identity_token(mp.display_name) = v_detected_model_norm then 100
        when ev.model_alias_match then 105
        when v_database_model_norm <> ''
          and public.normalize_telemetry_identity_token(mp.model_key) = v_database_model_norm then 95
        when v_database_model_norm <> ''
          and public.normalize_telemetry_identity_token(mp.display_name) = v_database_model_norm then 95
        when v_detected_model_norm <> ''
          and length(public.normalize_telemetry_identity_token(mp.model_key)) >= 5
          and (
            v_detected_model_norm like '%' || public.normalize_telemetry_identity_token(mp.model_key) || '%'
            or public.normalize_telemetry_identity_token(mp.model_key) like '%' || v_detected_model_norm || '%'
          ) then 80
        when v_database_model_norm <> ''
          and length(public.normalize_telemetry_identity_token(mp.model_key)) >= 5
          and (
            v_database_model_norm like '%' || public.normalize_telemetry_identity_token(mp.model_key) || '%'
            or public.normalize_telemetry_identity_token(mp.model_key) like '%' || v_database_model_norm || '%'
          ) then 70
        else 0
      end as model_score
    from public.machine_model_profiles mp
    join evidence ev on ev.profile_id = mp.id
  ), final_scores as (
    select
      s.*,
      case
        when v_interface_norm <> '' and s.has_interface_rule and not s.interface_match then 0
        else
          case
            when s.fingerprint_match then 150
            else s.model_score
          end
          + case when s.interface_match then 10 else 0 end
          + case when s.revision_match then 5 else 0 end
      end as score
    from scored s
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', fs.id,
      'model_key', fs.model_key,
      'display_name', fs.display_name,
      'button_count', fs.button_count,
      'score', fs.score,
      'fingerprint_match', fs.fingerprint_match,
      'interface_match', fs.interface_match,
      'interface_rule', fs.has_interface_rule,
      'revision_match', fs.revision_match,
      'model_match_kind', case
        when fs.fingerprint_match then 'fingerprint'
        when fs.model_alias_match then 'verified_alias'
        when fs.model_score = 100 then 'detected_exact'
        when fs.model_score = 95 then 'database_exact'
        when fs.model_score = 80 then 'detected_partial'
        when fs.model_score = 70 then 'database_partial'
        else 'none'
      end
    ) order by fs.score desc, fs.display_name
  ), '[]'::jsonb)
  into v_candidates
  from final_scores fs;

  v_top := v_candidates -> 0;
  v_top_score := coalesce((v_top ->> 'score')::integer, 0);
  v_second_score := coalesce((v_candidates -> 1 ->> 'score')::integer, 0);
  v_gap := greatest(0, v_top_score - v_second_score);

  if v_top_score < 80 then
    v_resolution := 'automatic_unmatched';
    v_top := null;
  elsif coalesce((v_top ->> 'fingerprint_match')::boolean, false) then
    v_resolution := 'automatic_match';
    v_confidence := 'high';
    v_reason := 'Verified machine fingerprint exactly matches the decoder profile.';
  elsif v_gap < 15 then
    v_resolution := 'automatic_ambiguous';
    v_confidence := 'low';
    v_top := null;
  else
    v_resolution := 'automatic_match';
    if v_top_score >= 100 then
      v_confidence := 'high';
    else
      v_confidence := 'medium';
    end if;

    v_reason := case coalesce(v_top ->> 'model_match_kind', '')
      when 'verified_alias' then 'Verified machine model alias matches the decoder profile.'
      when 'detected_exact' then 'Detected machine model exactly matches the decoder profile.'
      when 'database_exact' then 'Database machine model exactly matches the decoder profile.'
      when 'detected_partial' then 'Detected machine model closely matches the decoder profile.'
      else 'Machine identity evidence matches the decoder profile.'
    end;
  end if;

  if v_top is not null then
    v_top := v_top || jsonb_build_object('reason', v_reason);
    v_effective_profile := v_top ->> 'model_key';
  end if;

  return jsonb_build_object(
    'device_id', v_device.id,
    'profile_assignment_method', 'automatic',
    'profile_resolution', v_resolution,
    'effective_profile_key', v_effective_profile,
    'recommended_profile', v_top,
    'confidence', v_confidence,
    'candidate_gap', v_gap,
    'ambiguous', v_resolution = 'automatic_ambiguous'
  );
end;
$$;

revoke all on function public.resolve_telemetry_device_profile(uuid) from public, anon;
grant execute on function public.resolve_telemetry_device_profile(uuid) to authenticated, service_role;

create or replace function public.get_telemetry_machine_identity(p_machine_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_machine public.machines%rowtype;
  v_device public.telemetry_devices%rowtype;
  v_profiles jsonb := '[]'::jsonb;
  v_resolution jsonb := '{}'::jsonb;
  v_machine_model_norm text := '';
  v_detected_model_norm text := '';
  v_machine_serial_norm text := '';
  v_reported_serial_norm text := '';
  v_machine_asset_norm text := '';
  v_reported_asset_norm text := '';
  v_conflicts jsonb := '[]'::jsonb;
  v_evidence jsonb := '[]'::jsonb;
  v_confidence text := 'unknown';
  v_effective_profile text := null;
  v_applied_profile text := null;
begin
  if public.current_app_role() is null then
    raise exception 'A provisioned DallmayrERP user is required.' using errcode = '42501';
  end if;

  select * into v_machine
  from public.machines
  where id = p_machine_id;

  if not found then
    raise exception 'Machine not found.' using errcode = '22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where machine_id = p_machine_id
  order by (status = 'active') desc, updated_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', mp.id,
    'model_key', mp.model_key,
    'display_name', mp.display_name,
    'button_count', mp.button_count,
    'updated_at', mp.updated_at
  ) order by mp.display_name), '[]'::jsonb)
  into v_profiles
  from public.machine_model_profiles mp;

  if v_device.id is not null then
    v_resolution := public.resolve_telemetry_device_profile(v_device.id);
    v_effective_profile := v_resolution ->> 'effective_profile_key';
    v_confidence := coalesce(v_resolution ->> 'confidence', 'unknown');
    v_applied_profile := nullif(v_device.applied_config ->> 'profile_id', '');

    v_detected_model_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_model);
    v_machine_model_norm := public.normalize_telemetry_identity_token(coalesce(v_machine.model, v_machine.machine_name));
    v_machine_serial_norm := public.normalize_telemetry_identity_token(v_machine.serial_number);
    v_reported_serial_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_serial);
    v_machine_asset_norm := public.normalize_telemetry_identity_token(coalesce(v_machine.asset_tag, v_machine.machine_barcode));
    v_reported_asset_norm := public.normalize_telemetry_identity_token(v_device.reported_machine_asset);

    if v_reported_serial_norm <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','serial','value',v_device.reported_machine_serial));
      if v_machine_serial_norm <> '' and v_reported_serial_norm <> v_machine_serial_norm then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'type','serial','label','Serial mismatch','database_value',v_machine.serial_number,'detected_value',v_device.reported_machine_serial
        ));
      elsif v_machine_serial_norm <> '' then
        v_confidence := 'high';
      end if;
    end if;

    if coalesce(v_device.reported_machine_model, '') <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','model','value',v_device.reported_machine_model));
      if v_machine_model_norm <> '' and v_detected_model_norm <> ''
         and v_detected_model_norm <> v_machine_model_norm
         and v_detected_model_norm not like '%' || v_machine_model_norm || '%'
         and v_machine_model_norm not like '%' || v_detected_model_norm || '%' then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'type','model','label','Model mismatch','database_value',coalesce(v_machine.model, v_machine.machine_name),'detected_value',v_device.reported_machine_model
        ));
      end if;
    end if;

    if v_reported_asset_norm <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','asset','value',v_device.reported_machine_asset));
      if v_machine_asset_norm <> '' and v_reported_asset_norm <> v_machine_asset_norm then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'type','asset','label','Asset identifier mismatch','database_value',coalesce(v_machine.asset_tag, v_machine.machine_barcode),'detected_value',v_device.reported_machine_asset
        ));
      end if;
    end if;

    if coalesce(v_device.reported_machine_interface, '') <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','protocol','value',upper(v_device.reported_machine_interface)));
    end if;
    if coalesce(v_device.reported_machine_profile_fingerprint, '') <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','fingerprint','value',v_device.reported_machine_profile_fingerprint));
    end if;
    if coalesce(v_device.reported_machine_revision, '') <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','revision','value',v_device.reported_machine_revision));
    end if;

    if v_device.machine_link_status in ('no_match','ambiguous') then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'type','link',
        'label',case when v_device.machine_link_status = 'ambiguous' then 'Machine identity is ambiguous' else 'No machine identity match' end,
        'database_value',v_machine.serial_number,
        'detected_value',v_device.reported_machine_serial
      ));
    end if;

    if coalesce(v_resolution ->> 'profile_resolution', '') = 'automatic_ambiguous' then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'type','profile',
        'label','Decoder profile match is ambiguous',
        'database_value',coalesce(v_machine.model, v_machine.machine_name),
        'detected_value',v_device.reported_machine_model
      ));
    end if;
  end if;

  return jsonb_build_object(
    'machine', jsonb_build_object(
      'id', v_machine.id,
      'name', v_machine.machine_name,
      'model', v_machine.model,
      'manufacturer', v_machine.manufacturer,
      'serial_number', v_machine.serial_number,
      'asset_tag', v_machine.asset_tag,
      'barcode', v_machine.machine_barcode
    ),
    'device', case when v_device.id is null then null else jsonb_build_object(
      'id', v_device.id,
      'device_code', v_device.device_code,
      'reported_serial', v_device.reported_machine_serial,
      'reported_model', v_device.reported_machine_model,
      'reported_revision', v_device.reported_machine_revision,
      'reported_asset', v_device.reported_machine_asset,
      'identity_source', v_device.reported_machine_identity_source,
      'profile_fingerprint', v_device.reported_machine_profile_fingerprint,
      'protocol', v_device.reported_machine_interface,
      'identity_at', v_device.reported_machine_identity_at,
      'machine_link_status', v_device.machine_link_status,
      'machine_link_method', v_device.machine_link_method,
      'profile_id', v_device.profile_id,
      'profile_assignment_method', coalesce(v_device.profile_assignment_method, 'automatic'),
      'profile_updated_at', v_device.profile_updated_at,
      'last_config_ack_at', v_device.last_config_ack_at,
      'applied_profile_id', v_applied_profile
    ) end,
    'profile_options', v_profiles,
    'recommended_profile', case when v_device.id is null then null else v_resolution -> 'recommended_profile' end,
    'effective_profile_key', v_effective_profile,
    'profile_resolution', case when v_device.id is null then null else v_resolution ->> 'profile_resolution' end,
    'confidence', v_confidence,
    'conflicts', v_conflicts,
    'evidence', v_evidence,
    'profile_pending', coalesce(v_effective_profile, '') <> coalesce(v_applied_profile, '')
  );
end;
$$;

revoke all on function public.get_telemetry_machine_identity(uuid) from public, anon;
grant execute on function public.get_telemetry_machine_identity(uuid) to authenticated, service_role;
