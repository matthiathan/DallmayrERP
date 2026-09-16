-- Correct insert/delete trigger behavior before the region boundary is enabled in production.

create or replace function public.protect_machine_telemetry_region()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text;
  v_override boolean := coalesce(current_setting('app.telemetry_region_override', true), '') = 'on';
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if tg_op = 'INSERT' then
    if v_service or auth.uid() is null then
      new.telemetry_region := coalesce(new.telemetry_region, 'south_africa');
    else
      new.telemetry_region := public.assert_telemetry_region_selected();
    end if;
    return new;
  end if;

  if v_service or auth.uid() is null then
    new.telemetry_region := coalesce(new.telemetry_region, old.telemetry_region, 'south_africa');
    return new;
  end if;

  v_region := public.assert_telemetry_region_selected();
  if old.telemetry_region <> v_region and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'Machine is outside your telemetry region.' using errcode = '42501';
  end if;
  if new.telemetry_region is distinct from old.telemetry_region
     and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'Use the region management control to move a machine between regions.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.protect_device_telemetry_region()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text;
  v_machine_region text;
  v_override boolean := coalesce(current_setting('app.telemetry_region_override', true), '') = 'on';
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if new.machine_id is not null then
    select m.telemetry_region into v_machine_region from public.machines m where m.id = new.machine_id;
    if v_machine_region is null then
      raise exception 'Assigned machine was not found.' using errcode = '22023';
    end if;
    new.telemetry_region := v_machine_region;
  end if;

  if tg_op = 'INSERT' then
    if v_service or auth.uid() is null then
      new.telemetry_region := coalesce(v_machine_region, new.telemetry_region, 'south_africa');
    else
      v_region := public.assert_telemetry_region_selected();
      new.telemetry_region := coalesce(v_machine_region, v_region);
      if new.telemetry_region <> v_region and not (v_override and public.can_manage_telemetry_regions()) then
        raise exception 'Device is outside your telemetry region.' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if v_service or auth.uid() is null then
    new.telemetry_region := coalesce(v_machine_region, new.telemetry_region, old.telemetry_region, 'south_africa');
    return new;
  end if;

  v_region := public.assert_telemetry_region_selected();
  if old.telemetry_region <> v_region and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'Device is outside your telemetry region.' using errcode = '42501';
  end if;
  if new.telemetry_region is distinct from old.telemetry_region
     and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'Use the region management control to move a device between regions.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_telemetry_region_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_region text;
  v_row_region text;
  v_override boolean := coalesce(current_setting('app.telemetry_region_override', true), '') = 'on';
  v_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if v_service or auth.uid() is null then return old; end if;
  v_region := public.assert_telemetry_region_selected();
  v_row_region := old.telemetry_region;
  if v_row_region <> v_region and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'The record is outside your telemetry region.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_machine_region_delete on public.machines;
create trigger guard_machine_region_delete
before delete on public.machines
for each row execute function public.guard_telemetry_region_delete();

drop trigger if exists guard_device_region_delete on public.telemetry_devices;
create trigger guard_device_region_delete
before delete on public.telemetry_devices
for each row execute function public.guard_telemetry_region_delete();
