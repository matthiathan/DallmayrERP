-- Older cross-region move helpers remain available for compatibility, but an
-- Administrator/Operations caller may only move an object that is visible in the
-- caller's currently selected source telemetry region. The privileged override is
-- enabled only after the source record has been locked and verified.

create or replace function public.set_device_telemetry_region(
  p_device_id uuid,
  p_region text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := lower(trim(coalesce(p_region,'')));
  v_source_region text;
  v_machine_id uuid;
begin
  if not public.can_manage_telemetry_regions() then
    raise exception 'Only Administrator or Operations users may move devices between telemetry regions.' using errcode='42501';
  end if;
  v_source_region := public.assert_telemetry_region_selected();
  if v_region not in ('south_africa','dubai','europe') then
    raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023';
  end if;

  select machine_id into v_machine_id
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_source_region
  for update;
  if not found then
    raise exception 'Telemetry device was not found in the selected telemetry region.' using errcode='22023';
  end if;
  if v_machine_id is not null then
    raise exception 'Move the linked machine instead; linked devices inherit the machine region.' using errcode='22023';
  end if;

  perform set_config('app.telemetry_region_override','on',true);
  update public.telemetry_devices
  set telemetry_region = v_region,
      updated_at = now()
  where id = p_device_id
    and telemetry_region = v_source_region;

  return jsonb_build_object('device_id',p_device_id,'telemetry_region',v_region);
end;
$$;

create or replace function public.set_customer_site_telemetry_region(
  p_site_id uuid,
  p_region text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := lower(trim(coalesce(p_region,'')));
  v_source_region text;
  v_site_id uuid;
  v_machines integer := 0;
  v_devices integer := 0;
begin
  if not public.can_manage_telemetry_regions() then
    raise exception 'Only Administrator or Operations users may move sites between telemetry regions.' using errcode='42501';
  end if;
  v_source_region := public.assert_telemetry_region_selected();
  if v_region not in ('south_africa','dubai','europe') then
    raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023';
  end if;

  select id into v_site_id
  from public.customer_sites
  where id = p_site_id
    and telemetry_region = v_source_region
  for update;
  if not found then
    raise exception 'Site was not found in the selected telemetry region.' using errcode='22023';
  end if;

  perform set_config('app.telemetry_region_override','on',true);

  update public.customer_sites
  set telemetry_region = v_region,
      updated_at = now()
  where id = p_site_id
    and telemetry_region = v_source_region;

  update public.machines
  set telemetry_region = v_region,
      updated_at = now()
  where site_id = p_site_id
    and telemetry_region = v_source_region
    and telemetry_region is distinct from v_region;
  get diagnostics v_machines = row_count;

  select count(*)::integer into v_devices
  from public.telemetry_devices d
  join public.machines m on m.id = d.machine_id
  where m.site_id = p_site_id
    and m.telemetry_region = v_region
    and d.telemetry_region = v_region;

  return jsonb_build_object(
    'site_id',p_site_id,
    'telemetry_region',v_region,
    'machines_moved',v_machines,
    'linked_devices_in_region',v_devices
  );
end;
$$;

revoke all on function public.set_device_telemetry_region(uuid,text) from public, anon;
grant execute on function public.set_device_telemetry_region(uuid,text) to authenticated, service_role;

revoke all on function public.set_customer_site_telemetry_region(uuid,text) from public, anon;
grant execute on function public.set_customer_site_telemetry_region(uuid,text) to authenticated, service_role;
