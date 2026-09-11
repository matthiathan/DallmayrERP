create or replace function public.mark_telemetry_config_history_delivered()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.last_config_at is distinct from old.last_config_at and new.last_config_at is not null then
    update public.telemetry_device_config_history
    set delivered_at = coalesce(delivered_at, new.last_config_at)
    where device_id = new.id
      and status = 'pending'
      and delivered_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.mark_telemetry_config_history_delivered() from public, anon, authenticated;

drop trigger if exists telemetry_config_history_delivery on public.telemetry_devices;
create trigger telemetry_config_history_delivery
after update of last_config_at on public.telemetry_devices
for each row
execute function public.mark_telemetry_config_history_delivered();
