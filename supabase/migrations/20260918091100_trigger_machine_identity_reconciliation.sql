-- Reconcile newly reported strong machine identity evidence automatically.
-- The trigger is intentionally limited to serial/asset changes. Model/fingerprint
-- evidence selects a decoder profile but must never reassign a physical machine.

create or replace function public.auto_reconcile_telemetry_machine_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changed boolean;
begin
  v_changed := case
    when tg_op='INSERT' then true
    else old.reported_machine_serial is distinct from new.reported_machine_serial
      or old.reported_machine_asset is distinct from new.reported_machine_asset
  end;

  if v_changed
     and new.machine_id is null
     and (
       nullif(trim(coalesce(new.reported_machine_serial,'')),'') is not null
       or nullif(trim(coalesce(new.reported_machine_asset,'')),'') is not null
     ) then
    perform public.reconcile_telemetry_machine_identity(new.id);
  end if;
  return new;
end;
$$;

revoke execute on function public.auto_reconcile_telemetry_machine_identity() from public,anon,authenticated;
grant execute on function public.auto_reconcile_telemetry_machine_identity() to service_role;

drop trigger if exists auto_reconcile_telemetry_machine_identity on public.telemetry_devices;
create trigger auto_reconcile_telemetry_machine_identity
after insert or update of reported_machine_serial, reported_machine_asset on public.telemetry_devices
for each row execute function public.auto_reconcile_telemetry_machine_identity();
