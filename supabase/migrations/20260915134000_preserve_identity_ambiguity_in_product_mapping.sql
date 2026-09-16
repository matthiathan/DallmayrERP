-- If a telemetry device exists, its unified identity resolution is authoritative.
-- In particular, automatic_ambiguous / automatic_unmatched must not be bypassed
-- by a second database-model fallback in product mapping. The legacy exact model
-- fallback is retained only for machines that have no telemetry device to score.
create or replace function public.resolve_effective_telemetry_profile_key(
  p_device_id uuid,
  p_machine_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_device_id uuid := p_device_id;
  v_machine_id uuid := p_machine_id;
  v_resolution jsonb;
  v_profile_key text;
  v_machine_model text;
begin
  if v_device_id is null and v_machine_id is not null then
    select d.id
      into v_device_id
    from public.telemetry_devices d
    where d.machine_id = v_machine_id
    order by (d.status = 'active') desc, d.updated_at desc
    limit 1;
  end if;

  if v_device_id is not null then
    v_resolution := public.resolve_telemetry_device_profile(v_device_id);
    v_profile_key := nullif(btrim(v_resolution ->> 'effective_profile_key'), '');

    -- A present device has already considered manual overrides, verified
    -- fingerprint/interface evidence, reported model, and database model. A null
    -- result is therefore meaningful (ambiguous/unmatched), not permission to
    -- run a second competing resolver.
    return v_profile_key;
  end if;

  if v_machine_id is null then
    return null;
  end if;

  select coalesce(nullif(m.model, ''), nullif(m.machine_name, ''))
    into v_machine_model
  from public.machines m
  where m.id = v_machine_id;

  if btrim(coalesce(v_machine_model, '')) = '' then
    return null;
  end if;

  select mp.model_key
    into v_profile_key
  from public.machine_model_profiles mp
  where public.normalize_telemetry_identity_token(mp.model_key)
        = public.normalize_telemetry_identity_token(v_machine_model)
  order by mp.updated_at desc
  limit 1;

  return v_profile_key;
end;
$function$;

-- CREATE OR REPLACE intentionally preserves the established function ACL:
-- postgres/authenticated/service_role only, with no PUBLIC or anon execute.
