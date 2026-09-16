-- A telemetry-platform diagnostic must never be attached to a manufacturer profile fault rule.

create or replace function public.enforce_telemetry_platform_fault_separation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.normalization_status = 'telemetry_diagnostic' then
    new.profile_key := null;
    new.fault_rule_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists telemetry_fault_events_platform_separation on public.telemetry_fault_events;
create trigger telemetry_fault_events_platform_separation
before insert or update of normalization_status, profile_key, fault_rule_id
on public.telemetry_fault_events
for each row execute function public.enforce_telemetry_platform_fault_separation_v1();

update public.telemetry_fault_events
set profile_key = null,
    fault_rule_id = null
where normalization_status = 'telemetry_diagnostic'
  and (profile_key is not null or fault_rule_id is not null);

comment on function public.enforce_telemetry_platform_fault_separation_v1() is
  'Ensures platform/interface diagnostics cannot be associated with manufacturer machine-profile fault rules.';
