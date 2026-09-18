-- Automatically link a telemetry device only from strong exact identity evidence.
-- Physical-machine linking is region-bound. Decoder profile selection remains a
-- separate evidence-scored concern so a model/fingerprint never reassigns an asset.

create or replace function public.reconcile_telemetry_machine_identity(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_region text;
  v_serial text;
  v_asset text;
  v_serial_matches integer := 0;
  v_asset_matches integer := 0;
  v_serial_machine uuid;
  v_asset_machine uuid;
  v_target uuid;
  v_site uuid;
  v_method text;
  v_status text;
begin
  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found.' using errcode='22023';
  end if;

  v_region := v_device.telemetry_region;
  if v_region is null then
    raise exception 'Telemetry device region is not assigned.' using errcode='22023';
  end if;

  if v_device.machine_id is not null then
    if not exists (
      select 1 from public.machines m
      where m.id=v_device.machine_id and m.telemetry_region=v_region
    ) then
      raise exception 'Linked machine is outside the telemetry device region.' using errcode='42501';
    end if;
    update public.telemetry_devices
    set machine_link_status='linked', updated_at=now()
    where id=p_device_id;
    return jsonb_build_object(
      'status','linked','machine_id',v_device.machine_id,'reason','already_assigned','telemetry_region',v_region
    );
  end if;

  v_serial := lower(trim(coalesce(v_device.reported_machine_serial,'')));
  v_asset := lower(trim(coalesce(v_device.reported_machine_asset,'')));

  if v_serial <> '' then
    select count(*)::integer, min(m.id)
    into v_serial_matches, v_serial_machine
    from public.machines m
    where m.telemetry_region=v_region
      and nullif(trim(m.serial_number),'') is not null
      and lower(trim(m.serial_number))=v_serial;
  end if;

  if v_asset <> '' then
    select count(*)::integer, min(m.id)
    into v_asset_matches, v_asset_machine
    from public.machines m
    where m.telemetry_region=v_region
      and (
        (nullif(trim(m.asset_tag),'') is not null and lower(trim(m.asset_tag))=v_asset)
        or (nullif(trim(m.machine_barcode),'') is not null and lower(trim(m.machine_barcode))=v_asset)
      );
  end if;

  if v_asset_matches = 1 then
    if v_serial_matches > 0 and not exists (
      select 1 from public.machines m
      where m.id=v_asset_machine
        and m.telemetry_region=v_region
        and nullif(trim(m.serial_number),'') is not null
        and lower(trim(m.serial_number))=v_serial
    ) then
      v_status := 'ambiguous';
    else
      v_target := v_asset_machine;
      v_method := case
        when v_serial_matches > 0 then 'identity_auto_combined'
        else 'identity_auto_asset'
      end;
    end if;
  elsif v_asset_matches > 1 then
    v_status := 'ambiguous';
  elsif v_serial_matches = 1 then
    v_target := v_serial_machine;
    v_method := 'identity_auto_serial';
  elsif v_serial_matches > 1 then
    v_status := 'ambiguous';
  else
    v_status := case when v_serial='' and v_asset='' then 'unlinked' else 'no_match' end;
  end if;

  if v_target is not null then
    select m.site_id into v_site
    from public.machines m
    where m.id=v_target and m.telemetry_region=v_region;

    update public.telemetry_devices
    set machine_id=v_target,
        site_id=v_site,
        machine_link_status='linked',
        machine_link_method=v_method,
        machine_linked_at=now(),
        updated_at=now()
    where id=p_device_id and machine_id is null;

    update public.telemetry_machine_state
    set machine_id=v_target, site_id=v_site, updated_at=now()
    where device_id=p_device_id;

    return jsonb_build_object(
      'status','linked',
      'machine_id',v_target,
      'method',v_method,
      'serial_match_count',v_serial_matches,
      'asset_match_count',v_asset_matches,
      'telemetry_region',v_region
    );
  end if;

  update public.telemetry_devices
  set machine_link_status=v_status,
      machine_link_method=null,
      machine_linked_at=null,
      updated_at=now()
  where id=p_device_id and machine_id is null;

  return jsonb_build_object(
    'status',v_status,
    'serial_match_count',v_serial_matches,
    'asset_match_count',v_asset_matches,
    'telemetry_region',v_region
  );
end;
$$;

revoke execute on function public.reconcile_telemetry_machine_identity(uuid) from public,anon,authenticated;
grant execute on function public.reconcile_telemetry_machine_identity(uuid) to service_role;

-- Backward-compatible serial helper now uses the same region-safe reconciliation.
create or replace function public.try_auto_link_telemetry_device(p_device_id uuid, p_machine_serial text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(coalesce(p_machine_serial,'')),'') is not null then
    update public.telemetry_devices
    set reported_machine_serial=left(trim(p_machine_serial),160), updated_at=now()
    where id=p_device_id;
    if not found then
      raise exception 'Telemetry device not found.' using errcode='22023';
    end if;
  end if;
  return public.reconcile_telemetry_machine_identity(p_device_id);
end;
$$;

revoke execute on function public.try_auto_link_telemetry_device(uuid,text) from public,anon,authenticated;
grant execute on function public.try_auto_link_telemetry_device(uuid,text) to service_role;
