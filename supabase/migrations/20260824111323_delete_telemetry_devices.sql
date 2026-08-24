create or replace function public.delete_telemetry_device(
  p_device_id uuid,
  p_device_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.telemetry_devices%rowtype;
  v_sales_rows bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to delete a telemetry device' using errcode = '42501';
  end if;

  select *
  into v_device
  from public.telemetry_devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'Telemetry device not found' using errcode = 'P0002';
  end if;

  if trim(coalesce(p_device_code, '')) <> v_device.device_code then
    raise exception 'Enter the exact device ID to confirm deletion' using errcode = '22023';
  end if;

  select count(*)
  into v_sales_rows
  from public.telemetry_daily_item_sales
  where device_id = v_device.id;

  -- Daily sales intentionally use ON DELETE RESTRICT. Remove them explicitly;
  -- all other device-owned telemetry tables cascade from telemetry_devices.
  delete from public.telemetry_daily_item_sales
  where device_id = v_device.id;

  delete from public.telemetry_devices
  where id = v_device.id;

  return jsonb_build_object(
    'deleted', true,
    'device_id', v_device.id,
    'device_code', v_device.device_code,
    'sales_rows_deleted', v_sales_rows
  );
end;
$$;

revoke all on function public.delete_telemetry_device(uuid, text) from public;
grant execute on function public.delete_telemetry_device(uuid, text) to authenticated;

-- Make the new RPC signature immediately visible to the Data API.
notify pgrst, 'reload schema';
