-- Restore the durable database contract already referenced by telemetry-ingest.
-- The Edge Function authenticates the device and invokes this RPC with service_role;
-- browsers and authenticated app users are deliberately denied direct execution.

alter table public.telemetry_devices
  add column if not exists last_config_ack_at timestamptz,
  add column if not exists applied_config jsonb not null default '{}'::jsonb;

comment on column public.telemetry_devices.last_config_ack_at is
  'Database receipt time of the most recent accepted device configuration acknowledgement.';
comment on column public.telemetry_devices.applied_config is
  'Configuration values the telemetry controller most recently confirmed it applied.';

create or replace function public.record_telemetry_config_ack(
  p_device_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_applied jsonb := coalesce(p_payload -> 'applied_config', '{}'::jsonb);
  v_firmware text := nullif(btrim(coalesce(p_payload ->> 'firmware', '')), '');
  v_updated integer := 0;
begin
  if p_device_id is null then
    raise exception 'Telemetry device is required' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Configuration acknowledgement payload must be a JSON object' using errcode = '22023';
  end if;

  if jsonb_typeof(v_applied) <> 'object' then
    raise exception 'applied_config must be a JSON object' using errcode = '22023';
  end if;

  update public.telemetry_devices
  set last_config_ack_at = now(),
      applied_config = v_applied,
      firmware_version = coalesce(v_firmware, firmware_version),
      last_seen_at = now(),
      last_upload_at = now(),
      updated_at = now()
  where id = p_device_id
    and status = 'active';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Active telemetry device not found' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'accepted', true,
    'config_ack', true,
    'last_config_ack_at', now(),
    'applied_config', v_applied
  );
end;
$$;

revoke all on function public.record_telemetry_config_ack(uuid, jsonb) from public;
revoke all on function public.record_telemetry_config_ack(uuid, jsonb) from anon;
revoke all on function public.record_telemetry_config_ack(uuid, jsonb) from authenticated;
grant execute on function public.record_telemetry_config_ack(uuid, jsonb) to service_role;
