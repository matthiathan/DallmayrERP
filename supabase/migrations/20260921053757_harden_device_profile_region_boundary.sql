-- Decoder-profile assignment is an authenticated operator action on one
-- telemetry device. Because this RPC is SECURITY DEFINER, it must enforce the
-- selected telemetry region explicitly instead of relying on table RLS.

create or replace function public.set_telemetry_device_profile(
  p_device_id uuid,
  p_profile_key text default null::text,
  p_assignment_method text default 'manual'::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text := public.assert_telemetry_region_selected();
  v_profile_key text := nullif(btrim(coalesce(p_profile_key, '')), '');
  v_method text := lower(btrim(coalesce(p_assignment_method, 'manual')));
  v_device public.telemetry_devices%rowtype;
begin
  if not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode = '42501';
  end if;
  if v_method not in ('automatic','manual') then
    raise exception 'Profile assignment method must be automatic or manual.' using errcode = '22023';
  end if;

  select * into v_device
  from public.telemetry_devices
  where id = p_device_id
    and telemetry_region = v_region
  for update;

  if not found then
    raise exception 'Telemetry device not found in the selected telemetry region.' using errcode = '22023';
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
  where id = p_device_id
    and telemetry_region = v_region;

  if not found then
    raise exception 'Telemetry device region changed before profile assignment could be completed.' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'accepted', true,
    'device_id', p_device_id,
    'profile_id', v_profile_key,
    'profile_assignment_method', v_method,
    'updated_at', now()
  );
end;
$$;

revoke all on function public.set_telemetry_device_profile(uuid, text, text) from public, anon;
grant execute on function public.set_telemetry_device_profile(uuid, text, text) to authenticated, service_role;

comment on function public.set_telemetry_device_profile(uuid, text, text) is
  'Assigns or clears a decoder profile only for a telemetry device in the operator selected telemetry region.';
