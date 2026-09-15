-- Preserve the proven V3 ingest implementation behind a stable wrapper so
-- selection observations can use the existing authenticated telemetry-ingest
-- Edge Function without entering production sale/counter ingestion.
do $block$
begin
  if to_regprocedure('public.ingest_telemetry_payload_v3_core(uuid,jsonb)') is null then
    alter function public.ingest_telemetry_payload_v3(uuid, jsonb)
      rename to ingest_telemetry_payload_v3_core;
  end if;
end;
$block$;

create or replace function public.ingest_telemetry_payload_v3(
  p_device_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if lower(coalesce(p_payload ->> 'type', '')) = 'selection_observation' then
    return public.ingest_telemetry_selection_observation_v1(p_device_id, p_payload);
  end if;

  return public.ingest_telemetry_payload_v3_core(p_device_id, p_payload);
end;
$function$;

revoke all on function public.ingest_telemetry_payload_v3(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3(uuid, jsonb) to service_role;

revoke all on function public.ingest_telemetry_payload_v3_core(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_telemetry_payload_v3_core(uuid, jsonb) to service_role;
