alter table public.telemetry_devices
  add column if not exists reported_machine_model text,
  add column if not exists reported_machine_revision text,
  add column if not exists reported_machine_asset text,
  add column if not exists reported_machine_identity_source text,
  add column if not exists reported_machine_profile_fingerprint text,
  add column if not exists reported_machine_interface text,
  add column if not exists reported_machine_identity_at timestamptz,
  add column if not exists profile_assignment_method text not null default 'automatic',
  add column if not exists profile_updated_at timestamptz;

alter table public.telemetry_devices
  drop constraint if exists telemetry_devices_profile_assignment_method_check;

alter table public.telemetry_devices
  add constraint telemetry_devices_profile_assignment_method_check
  check (profile_assignment_method in ('automatic', 'manual'));

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
  v_recommended record;
  v_detected_model_norm text := '';
  v_machine_model_norm text := '';
  v_machine_serial_norm text := '';
  v_reported_serial_norm text := '';
  v_machine_asset_norm text := '';
  v_reported_asset_norm text := '';
  v_score integer := 0;
  v_reason text := null;
  v_confidence text := 'unknown';
  v_conflicts jsonb := '[]'::jsonb;
  v_evidence jsonb := '[]'::jsonb;
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
    v_detected_model_norm := regexp_replace(lower(coalesce(v_device.reported_machine_model, '')), '[^a-z0-9]+', '', 'g');
    v_machine_model_norm := regexp_replace(lower(coalesce(v_machine.model, v_machine.machine_name, '')), '[^a-z0-9]+', '', 'g');
    v_machine_serial_norm := regexp_replace(lower(coalesce(v_machine.serial_number, '')), '[^a-z0-9]+', '', 'g');
    v_reported_serial_norm := regexp_replace(lower(coalesce(v_device.reported_machine_serial, '')), '[^a-z0-9]+', '', 'g');
    v_machine_asset_norm := regexp_replace(lower(coalesce(v_machine.asset_tag, v_machine.machine_barcode, '')), '[^a-z0-9]+', '', 'g');
    v_reported_asset_norm := regexp_replace(lower(coalesce(v_device.reported_machine_asset, '')), '[^a-z0-9]+', '', 'g');

    select mp.*,
      case
        when v_detected_model_norm <> '' and regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') = v_detected_model_norm then 100
        when v_detected_model_norm <> '' and regexp_replace(lower(mp.display_name), '[^a-z0-9]+', '', 'g') = v_detected_model_norm then 100
        when v_machine_model_norm <> '' and regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') = v_machine_model_norm then 95
        when v_machine_model_norm <> '' and regexp_replace(lower(mp.display_name), '[^a-z0-9]+', '', 'g') = v_machine_model_norm then 95
        when v_detected_model_norm <> '' and length(regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g')) >= 5
          and (v_detected_model_norm like '%' || regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') || '%'
            or regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') like '%' || v_detected_model_norm || '%') then 80
        when v_machine_model_norm <> '' and length(regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g')) >= 5
          and (v_machine_model_norm like '%' || regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') || '%'
            or regexp_replace(lower(mp.model_key), '[^a-z0-9]+', '', 'g') like '%' || v_machine_model_norm || '%') then 70
        else 0
      end as match_score
    into v_recommended
    from public.machine_model_profiles mp
    order by match_score desc, mp.display_name
    limit 1;

    if v_recommended.match_score is not null then
      v_score := v_recommended.match_score;
    end if;

    if v_score < 70 then
      v_recommended := null;
      v_score := 0;
    elsif v_score >= 100 then
      v_reason := 'Detected machine model exactly matches the profile.';
    elsif v_score >= 95 then
      v_reason := 'Database machine model exactly matches the profile.';
    elsif v_score >= 80 then
      v_reason := 'Detected machine model closely matches the profile name.';
    else
      v_reason := 'Database machine model closely matches the profile name.';
    end if;

    if v_reported_serial_norm <> '' then
      v_evidence := v_evidence || jsonb_build_array(jsonb_build_object('type','serial','value',v_device.reported_machine_serial));
      if v_machine_serial_norm <> '' and v_reported_serial_norm <> v_machine_serial_norm then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'type','serial','label','Serial mismatch','database_value',v_machine.serial_number,'detected_value',v_device.reported_machine_serial
        ));
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

    if v_device.machine_link_status in ('no_match','ambiguous') then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'type','link',
        'label',case when v_device.machine_link_status = 'ambiguous' then 'Machine identity is ambiguous' else 'No machine identity match' end,
        'database_value',v_machine.serial_number,
        'detected_value',v_device.reported_machine_serial
      ));
    end if;

    if v_reported_serial_norm <> '' and v_machine_serial_norm <> '' and v_reported_serial_norm = v_machine_serial_norm then
      v_confidence := 'high';
    elsif v_score >= 90 then
      v_confidence := 'high';
    elsif v_score >= 70 or coalesce(v_device.reported_machine_profile_fingerprint, '') <> '' then
      v_confidence := 'medium';
    elsif coalesce(v_device.reported_machine_interface, '') <> '' then
      v_confidence := 'low';
    end if;

    if coalesce(v_device.profile_assignment_method, 'automatic') = 'manual' then
      v_effective_profile := nullif(v_device.profile_id, '');
    elsif v_recommended is not null then
      v_effective_profile := v_recommended.model_key;
    end if;
    v_applied_profile := nullif(v_device.applied_config ->> 'profile_id', '');
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
    'recommended_profile', case when v_recommended is null then null else jsonb_build_object(
      'id', v_recommended.id,
      'model_key', v_recommended.model_key,
      'display_name', v_recommended.display_name,
      'button_count', v_recommended.button_count,
      'score', v_score,
      'reason', v_reason
    ) end,
    'effective_profile_key', v_effective_profile,
    'confidence', v_confidence,
    'conflicts', v_conflicts,
    'evidence', v_evidence,
    'profile_pending', coalesce(v_effective_profile, '') <> coalesce(v_applied_profile, '')
  );
end;
$$;

revoke all on function public.get_telemetry_machine_identity(uuid) from public, anon;
grant execute on function public.get_telemetry_machine_identity(uuid) to authenticated, service_role;

create or replace function public.set_telemetry_device_profile(
  p_device_id uuid,
  p_profile_key text default null,
  p_assignment_method text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_key text := nullif(btrim(coalesce(p_profile_key, '')), '');
  v_method text := lower(btrim(coalesce(p_assignment_method, 'manual')));
  v_device public.telemetry_devices%rowtype;
begin
  if public.current_app_role() is null then
    raise exception 'A provisioned DallmayrERP user is required.' using errcode = '42501';
  end if;

  if v_method not in ('automatic','manual') then
    raise exception 'Profile assignment method must be automatic or manual.' using errcode = '22023';
  end if;

  select * into v_device from public.telemetry_devices where id = p_device_id for update;
  if not found then
    raise exception 'Telemetry device not found.' using errcode = '22023';
  end if;

  if v_method = 'manual' then
    if v_profile_key is null then
      raise exception 'A decoder profile is required for manual assignment.' using errcode = '22023';
    end if;
    select mp.model_key into v_profile_key
    from public.machine_model_profiles mp
    where lower(btrim(mp.model_key)) = lower(v_profile_key)
    limit 1;
    if v_profile_key is null then
      raise exception 'Decoder profile not found.' using errcode = '22023';
    end if;
  else
    v_profile_key := null;
  end if;

  update public.telemetry_devices
  set profile_id = v_profile_key,
      profile_assignment_method = v_method,
      profile_updated_at = now(),
      updated_at = now()
  where id = p_device_id;

  return jsonb_build_object(
    'accepted', true,
    'device_id', p_device_id,
    'profile_id', v_profile_key,
    'profile_assignment_method', v_method,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.set_telemetry_device_profile(uuid,text,text) from public, anon;
grant execute on function public.set_telemetry_device_profile(uuid,text,text) to authenticated, service_role;
