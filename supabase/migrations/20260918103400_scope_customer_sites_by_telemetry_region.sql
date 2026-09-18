-- Customer sites had no regional boundary. There were no production site rows at
-- migration time, so establish the region contract before Dubai/Europe site data exists.

alter table public.customer_sites add column if not exists telemetry_region text;
update public.customer_sites set telemetry_region='south_africa' where telemetry_region is null;
alter table public.customer_sites alter column telemetry_region set default 'south_africa';
alter table public.customer_sites alter column telemetry_region set not null;
alter table public.customer_sites drop constraint if exists customer_sites_telemetry_region_check;
alter table public.customer_sites add constraint customer_sites_telemetry_region_check check (telemetry_region in ('south_africa','dubai','europe'));
create index if not exists customer_sites_telemetry_region_idx on public.customer_sites(telemetry_region,branch);

create or replace function public.protect_customer_site_telemetry_region()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_region text;
  v_override boolean:=coalesce(current_setting('app.telemetry_region_override',true),'')='on';
  v_jwt_role text:=coalesce(auth.jwt()->>'role','');
begin
  if tg_op='INSERT' then
    if v_jwt_role in ('service_role','') then
      new.telemetry_region:=coalesce(new.telemetry_region,'south_africa');
    else
      new.telemetry_region:=public.assert_telemetry_region_selected();
    end if;
    return new;
  end if;

  if v_jwt_role in ('service_role','') then
    new.telemetry_region:=coalesce(new.telemetry_region,old.telemetry_region,'south_africa');
    return new;
  end if;

  v_region:=public.assert_telemetry_region_selected();
  if old.telemetry_region<>v_region and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'Site is outside your telemetry region.' using errcode='42501';
  end if;
  if new.telemetry_region is distinct from old.telemetry_region and not (v_override and public.can_manage_telemetry_regions()) then
    raise exception 'Use the region management control to move a site between regions.' using errcode='42501';
  end if;
  return new;
end $$;

revoke execute on function public.protect_customer_site_telemetry_region() from public,anon,authenticated;

drop trigger if exists protect_customer_site_telemetry_region on public.customer_sites;
create trigger protect_customer_site_telemetry_region
before insert or update on public.customer_sites
for each row execute function public.protect_customer_site_telemetry_region();

drop trigger if exists guard_customer_site_region_delete on public.customer_sites;
create trigger guard_customer_site_region_delete
before delete on public.customer_sites
for each row execute function public.guard_telemetry_region_delete();

drop policy if exists telemetry_region_scope_customer_sites on public.customer_sites;
create policy telemetry_region_scope_customer_sites
on public.customer_sites
as restrictive
for all
to authenticated
using (telemetry_region=public.current_telemetry_region())
with check (telemetry_region=public.current_telemetry_region());

create or replace function public.set_customer_site_telemetry_region(p_site_id uuid,p_region text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_region text:=lower(trim(coalesce(p_region,'')));
  v_machines integer:=0;
  v_devices integer:=0;
begin
  if not public.can_manage_telemetry_regions() then
    raise exception 'Only Administrator or Operations users may move sites between telemetry regions.' using errcode='42501';
  end if;
  if v_region not in ('south_africa','dubai','europe') then
    raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023';
  end if;

  perform set_config('app.telemetry_region_override','on',true);

  update public.customer_sites
  set telemetry_region=v_region,updated_at=now()
  where id=p_site_id;
  if not found then raise exception 'Site was not found.' using errcode='22023'; end if;

  update public.machines
  set telemetry_region=v_region,updated_at=now()
  where site_id=p_site_id and telemetry_region is distinct from v_region;
  get diagnostics v_machines=row_count;

  select count(*)::integer into v_devices
  from public.telemetry_devices d
  join public.machines m on m.id=d.machine_id
  where m.site_id=p_site_id and d.telemetry_region=v_region;

  return jsonb_build_object('site_id',p_site_id,'telemetry_region',v_region,'machines_moved',v_machines,'linked_devices_in_region',v_devices);
end $$;

revoke execute on function public.set_customer_site_telemetry_region(uuid,text) from public,anon;
grant execute on function public.set_customer_site_telemetry_region(uuid,text) to authenticated,service_role;
