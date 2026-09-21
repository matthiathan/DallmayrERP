-- Region administration is intentionally able to move a machine to another
-- telemetry region, but the source machine must first belong to the operator's
-- currently selected region. This prevents a Security Definer RPC call from
-- targeting an otherwise invisible machine by UUID.

create or replace function public.set_machine_telemetry_region(
  p_machine_id uuid,
  p_region text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source_region text := public.assert_telemetry_region_selected();
  v_region text := lower(trim(coalesce(p_region, '')));
  v_devices integer;
  v_machine_id uuid;
begin
  if not public.can_manage_telemetry_regions() then
    raise exception 'Only Administrator or Operations users may move machines between telemetry regions.' using errcode = '42501';
  end if;
  if v_region not in ('south_africa', 'dubai', 'europe') then
    raise exception 'Region must be South Africa, Dubai or Europe.' using errcode = '22023';
  end if;

  select m.id
    into v_machine_id
  from public.machines m
  where m.id = p_machine_id
    and m.telemetry_region = v_source_region
  for update;

  if v_machine_id is null then
    raise exception 'Machine was not found in the selected telemetry region.' using errcode = '22023';
  end if;

  perform set_config('app.telemetry_region_override', 'on', true);

  update public.machines
  set telemetry_region = v_region,
      updated_at = now()
  where id = p_machine_id
    and telemetry_region = v_source_region;

  if not found then
    raise exception 'Machine region changed before the move could be completed.' using errcode = '40001';
  end if;

  select count(*)::integer
    into v_devices
  from public.telemetry_devices
  where machine_id = p_machine_id
    and telemetry_region = v_region;

  return jsonb_build_object(
    'machine_id', p_machine_id,
    'source_telemetry_region', v_source_region,
    'telemetry_region', v_region,
    'linked_devices_moved', v_devices
  );
end;
$$;

revoke all on function public.set_machine_telemetry_region(uuid, text) from public, anon;
grant execute on function public.set_machine_telemetry_region(uuid, text) to authenticated, service_role;

comment on function public.set_machine_telemetry_region(uuid, text) is
  'Moves a machine and linked telemetry devices from the operator selected source region to an approved target region.';
