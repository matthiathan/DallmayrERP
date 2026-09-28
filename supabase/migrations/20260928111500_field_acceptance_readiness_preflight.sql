-- Field-acceptance setup preflight. Diagnostics and Learn Mode remain available,
-- but acceptance readiness requires a persisted trusted profile and real product mappings.

create or replace function public.get_telemetry_field_acceptance_readiness(p_device_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_device public.telemetry_devices%rowtype;
  v_machine public.machines%rowtype;
  v_profile public.machine_model_profiles%rowtype;
  v_suggested_profile public.machine_model_profiles%rowtype;
  v_mapped_products jsonb := '[]'::jsonb;
  v_has_porridge boolean := false;
  v_has_caramel boolean := false;
  v_other_count integer := 0;
  v_machine_linked boolean := false;
  v_profile_ready boolean := false;
  v_mapping_ready boolean := false;
  v_ready boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region
    and status = 'active';

  if not found then
    raise exception 'Active telemetry device not found in the selected telemetry region.' using errcode = '22023';
  end if;

  if v_device.machine_id is not null then
    select * into v_machine
    from public.machines
    where id = v_device.machine_id
      and telemetry_region = v_region;
    v_machine_linked := found and coalesce(v_device.machine_link_status, '') = 'linked';
  end if;

  -- Only the persisted device profile is trusted for acceptance readiness.
  -- Linked-machine model equality is advisory and must never satisfy this gate.
  if nullif(btrim(coalesce(v_device.profile_id, '')), '') is not null then
    select * into v_profile
    from public.machine_model_profiles
    where model_key = v_device.profile_id
    limit 1;
    v_profile_ready := found;
  end if;

  if v_machine.id is not null and nullif(btrim(coalesce(v_machine.model, '')), '') is not null then
    select * into v_suggested_profile
    from public.machine_model_profiles
    where lower(btrim(model_key)) = lower(btrim(v_machine.model))
       or lower(btrim(display_name)) = lower(btrim(v_machine.model))
    order by case when lower(btrim(model_key)) = lower(btrim(v_machine.model)) then 0 else 1 end, display_name
    limit 1;
  end if;

  if v_profile_ready then
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'button_number', m.button_number,
        'selection_code', m.selection_code,
        'product_id', p.id,
        'product_name', p.product_name
      ) order by m.button_number, m.selection_code), '[]'::jsonb),
      coalesce(bool_or(lower(btrim(p.product_name)) = 'instant porridge'), false),
      coalesce(bool_or(lower(btrim(p.product_name)) = 'caramel cappuccino'), false),
      count(*) filter (where lower(btrim(p.product_name)) not in ('instant porridge', 'caramel cappuccino'))::integer
    into v_mapped_products, v_has_porridge, v_has_caramel, v_other_count
    from public.machine_model_button_mappings m
    join public.products p on p.id = m.product_id and p.is_active = true
    where m.profile_id = v_profile.id;
  end if;

  v_mapping_ready := v_has_porridge and v_has_caramel and v_other_count >= 1;
  v_ready := v_machine_linked and v_profile_ready and v_mapping_ready;

  if not v_machine_linked then
    v_blockers := v_blockers || jsonb_build_array('Link the telemetry device to the correct machine before field acceptance.');
  end if;
  if not v_profile_ready then
    v_blockers := v_blockers || jsonb_build_array('Verify and persist the decoder profile before field acceptance. Use identity review/Learn Mode rather than a model-name guess.');
  end if;
  if v_profile_ready and not v_has_porridge then
    v_blockers := v_blockers || jsonb_build_array('Map Instant Porridge from a real observed selection in Learn Mode.');
  end if;
  if v_profile_ready and not v_has_caramel then
    v_blockers := v_blockers || jsonb_build_array('Map Caramel Cappuccino from a real observed selection in Learn Mode.');
  end if;
  if v_profile_ready and v_other_count < 1 then
    v_blockers := v_blockers || jsonb_build_array('Map at least one additional active product from a real observed selection in Learn Mode.');
  end if;

  return jsonb_build_object(
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'telemetry_region', v_region,
    'machine_linked', v_machine_linked,
    'machine_id', v_device.machine_id,
    'machine_model', nullif(v_machine.model, ''),
    'profile_ready', v_profile_ready,
    'trusted_profile_key', case when v_profile_ready then v_profile.model_key else null end,
    'trusted_profile_name', case when v_profile_ready then v_profile.display_name else null end,
    'suggested_profile_key', nullif(v_suggested_profile.model_key, ''),
    'suggested_profile_name', nullif(v_suggested_profile.display_name, ''),
    'has_instant_porridge', v_has_porridge,
    'has_caramel_cappuccino', v_has_caramel,
    'other_mapped_product_count', v_other_count,
    'mapped_products', v_mapped_products,
    'mapping_ready', v_mapping_ready,
    'ready_for_acceptance', v_ready,
    'blockers', v_blockers
  );
end;
$function$;

revoke execute on function public.get_telemetry_field_acceptance_readiness(uuid) from public, anon;
grant execute on function public.get_telemetry_field_acceptance_readiness(uuid) to authenticated, service_role;
