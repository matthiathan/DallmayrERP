-- Production telemetry region boundary: South Africa, Dubai and Europe.
-- Existing production records remain in South Africa. New user profiles may remain
-- unassigned until the user selects a region; machine/device records are never unscoped.

alter table public.user_details add column if not exists telemetry_region text;
alter table public.machines add column if not exists telemetry_region text;
alter table public.telemetry_devices add column if not exists telemetry_region text;
alter table public.telemetry_enrollment_tokens add column if not exists telemetry_region text;
alter table public.telemetry_enrollment_windows add column if not exists telemetry_region text;

update public.user_details set telemetry_region='south_africa' where telemetry_region is null;
update public.machines set telemetry_region='south_africa' where telemetry_region is null;
update public.telemetry_devices d set telemetry_region=coalesce(m.telemetry_region,'south_africa') from public.machines m where d.machine_id=m.id and d.telemetry_region is null;
update public.telemetry_devices set telemetry_region='south_africa' where telemetry_region is null;
update public.telemetry_enrollment_tokens set telemetry_region='south_africa' where telemetry_region is null;
update public.telemetry_enrollment_windows set telemetry_region='south_africa' where telemetry_region is null;

alter table public.machines alter column telemetry_region set default 'south_africa';
alter table public.machines alter column telemetry_region set not null;
alter table public.telemetry_devices alter column telemetry_region set default 'south_africa';
alter table public.telemetry_devices alter column telemetry_region set not null;
alter table public.telemetry_enrollment_tokens alter column telemetry_region set default 'south_africa';
alter table public.telemetry_enrollment_tokens alter column telemetry_region set not null;
alter table public.telemetry_enrollment_windows alter column telemetry_region set default 'south_africa';
alter table public.telemetry_enrollment_windows alter column telemetry_region set not null;

alter table public.user_details drop constraint if exists user_details_telemetry_region_check;
alter table public.user_details add constraint user_details_telemetry_region_check check (telemetry_region is null or telemetry_region in ('south_africa','dubai','europe'));
alter table public.machines drop constraint if exists machines_telemetry_region_check;
alter table public.machines add constraint machines_telemetry_region_check check (telemetry_region in ('south_africa','dubai','europe'));
alter table public.telemetry_devices drop constraint if exists telemetry_devices_telemetry_region_check;
alter table public.telemetry_devices add constraint telemetry_devices_telemetry_region_check check (telemetry_region in ('south_africa','dubai','europe'));
alter table public.telemetry_enrollment_tokens drop constraint if exists telemetry_enrollment_tokens_region_check;
alter table public.telemetry_enrollment_tokens add constraint telemetry_enrollment_tokens_region_check check (telemetry_region in ('south_africa','dubai','europe'));
alter table public.telemetry_enrollment_windows drop constraint if exists telemetry_enrollment_windows_region_check;
alter table public.telemetry_enrollment_windows add constraint telemetry_enrollment_windows_region_check check (telemetry_region in ('south_africa','dubai','europe'));

create index if not exists machines_telemetry_region_idx on public.machines(telemetry_region,branch);
create index if not exists telemetry_devices_region_idx on public.telemetry_devices(telemetry_region,status);
create index if not exists telemetry_enrollment_tokens_region_idx on public.telemetry_enrollment_tokens(telemetry_region,created_at desc);
create index if not exists telemetry_enrollment_windows_region_idx on public.telemetry_enrollment_windows(telemetry_region,created_at desc);

create or replace function public.current_telemetry_region() returns text language sql stable security definer set search_path=public,pg_temp as $$
 select d.telemetry_region from public.users u join public.user_details d on d.user_id=u.id where u.auth_user_id=(select auth.uid()) and u.is_active=true limit 1;
$$;
create or replace function public.can_manage_telemetry_regions() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(public.current_app_role(),'') in ('admin','operations');
$$;
create or replace function public.assert_telemetry_region_selected() returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_region text:=public.current_telemetry_region(); begin
 if not public.is_active_app_user() then raise exception 'Authenticated DallmayrERP access is required.' using errcode='42501'; end if;
 if v_region is null then raise exception 'Select a telemetry region before opening telemetry data.' using errcode='42501'; end if;
 return v_region;
end $$;
create or replace function public.telemetry_region_allows_machine(p_machine_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_machine_id is not null and exists(select 1 from public.machines m where m.id=p_machine_id and m.telemetry_region=public.current_telemetry_region());
$$;
create or replace function public.telemetry_region_allows_device(p_device_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_device_id is not null and exists(select 1 from public.telemetry_devices d where d.id=p_device_id and d.telemetry_region=public.current_telemetry_region());
$$;
create or replace function public.telemetry_region_allows_fault(p_fault_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_fault_id is not null and exists(select 1 from public.telemetry_fault_events f join public.telemetry_devices d on d.id=f.device_id where f.id=p_fault_id and d.telemetry_region=public.current_telemetry_region());
$$;
create or replace function public.telemetry_region_allows_session(p_session_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_session_id is not null and exists(select 1 from public.telemetry_test_sessions s join public.telemetry_devices d on d.id=s.device_id where s.id=p_session_id and d.telemetry_region=public.current_telemetry_region());
$$;
create or replace function public.telemetry_region_allows_attention_source(p_source_key text) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select nullif(trim(coalesce(p_source_key,'')),'') is not null and exists(select 1 from public.telemetry_fleet_attention_workflow w join public.telemetry_devices d on d.id=w.device_id where w.source_key=p_source_key and d.telemetry_region=public.current_telemetry_region());
$$;
create or replace function public.telemetry_region_allows_enrollment_window(p_window_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select p_window_id is not null and exists(select 1 from public.telemetry_enrollment_windows w where w.id=p_window_id and w.telemetry_region=public.current_telemetry_region());
$$;

create or replace function public.protect_user_telemetry_region() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.current_app_user_id(); v_manager boolean:=public.can_manage_telemetry_regions(); begin
 if new.telemetry_region is not null and new.telemetry_region not in ('south_africa','dubai','europe') then raise exception 'Invalid telemetry region.' using errcode='22023'; end if;
 if old.telemetry_region is not distinct from new.telemetry_region then return new; end if;
 if v_manager then return new; end if;
 if old.user_id=v_actor and old.telemetry_region is null and new.telemetry_region is not null then return new; end if;
 raise exception 'Telemetry region is locked. Ask an Administrator or Operations user to change it.' using errcode='42501';
end $$;
create or replace function public.protect_machine_telemetry_region() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text; v_override boolean:=coalesce(current_setting('app.telemetry_region_override',true),'')='on'; v_jwt_role text:=coalesce(auth.jwt()->>'role',''); begin
 if tg_op='INSERT' then
  if v_jwt_role in ('service_role','') then new.telemetry_region:=coalesce(new.telemetry_region,'south_africa'); else new.telemetry_region:=public.assert_telemetry_region_selected(); end if;
  return new;
 end if;
 if v_jwt_role in ('service_role','') then new.telemetry_region:=coalesce(new.telemetry_region,old.telemetry_region,'south_africa'); return new; end if;
 v_region:=public.assert_telemetry_region_selected();
 if old.telemetry_region<>v_region and not (v_override and public.can_manage_telemetry_regions()) then raise exception 'Machine is outside your telemetry region.' using errcode='42501'; end if;
 if new.telemetry_region is distinct from old.telemetry_region and not (v_override and public.can_manage_telemetry_regions()) then raise exception 'Use the region management control to move a machine between regions.' using errcode='42501'; end if;
 return new;
end $$;
create or replace function public.protect_device_telemetry_region() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text; v_machine_region text; v_override boolean:=coalesce(current_setting('app.telemetry_region_override',true),'')='on'; v_jwt_role text:=coalesce(auth.jwt()->>'role',''); begin
 if new.machine_id is not null then select m.telemetry_region into v_machine_region from public.machines m where m.id=new.machine_id; if v_machine_region is null then raise exception 'Assigned machine was not found.' using errcode='22023'; end if; new.telemetry_region:=v_machine_region; end if;
 if tg_op='INSERT' then
  if v_jwt_role in ('service_role','') then new.telemetry_region:=coalesce(v_machine_region,new.telemetry_region,'south_africa'); else v_region:=public.assert_telemetry_region_selected(); new.telemetry_region:=coalesce(v_machine_region,v_region); if new.telemetry_region<>v_region and not (v_override and public.can_manage_telemetry_regions()) then raise exception 'Device is outside your telemetry region.' using errcode='42501'; end if; end if;
  return new;
 end if;
 if v_jwt_role in ('service_role','') then new.telemetry_region:=coalesce(v_machine_region,new.telemetry_region,old.telemetry_region,'south_africa'); return new; end if;
 v_region:=public.assert_telemetry_region_selected();
 if old.telemetry_region<>v_region and not (v_override and public.can_manage_telemetry_regions()) then raise exception 'Device is outside your telemetry region.' using errcode='42501'; end if;
 if new.telemetry_region is distinct from old.telemetry_region and not (v_override and public.can_manage_telemetry_regions()) then raise exception 'Use the region management control to move a device between regions.' using errcode='42501'; end if;
 return new;
end $$;
create or replace function public.guard_telemetry_region_delete() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text; v_override boolean:=coalesce(current_setting('app.telemetry_region_override',true),'')='on'; v_jwt_role text:=coalesce(auth.jwt()->>'role',''); begin
 if v_jwt_role in ('service_role','') then return old; end if;
 v_region:=public.assert_telemetry_region_selected();
 if old.telemetry_region<>v_region and not (v_override and public.can_manage_telemetry_regions()) then raise exception 'The record is outside your telemetry region.' using errcode='42501'; end if;
 return old;
end $$;
create or replace function public.sync_machine_region_to_devices() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.telemetry_region is distinct from old.telemetry_region then update public.telemetry_devices set telemetry_region=new.telemetry_region,updated_at=now() where machine_id=new.id and telemetry_region is distinct from new.telemetry_region; end if;
 return new;
end $$;

drop trigger if exists protect_user_telemetry_region on public.user_details;
create trigger protect_user_telemetry_region before update of telemetry_region on public.user_details for each row execute function public.protect_user_telemetry_region();
drop trigger if exists protect_machine_telemetry_region on public.machines;
create trigger protect_machine_telemetry_region before insert or update on public.machines for each row execute function public.protect_machine_telemetry_region();
drop trigger if exists protect_device_telemetry_region on public.telemetry_devices;
create trigger protect_device_telemetry_region before insert or update on public.telemetry_devices for each row execute function public.protect_device_telemetry_region();
drop trigger if exists guard_machine_region_delete on public.machines;
create trigger guard_machine_region_delete before delete on public.machines for each row execute function public.guard_telemetry_region_delete();
drop trigger if exists guard_device_region_delete on public.telemetry_devices;
create trigger guard_device_region_delete before delete on public.telemetry_devices for each row execute function public.guard_telemetry_region_delete();
drop trigger if exists sync_machine_region_to_devices on public.machines;
create trigger sync_machine_region_to_devices after update of telemetry_region on public.machines for each row execute function public.sync_machine_region_to_devices();

create or replace function public.set_my_telemetry_region(p_region text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user_id uuid:=public.current_app_user_id(); v_region text:=lower(trim(coalesce(p_region,''))); v_current text; begin
 if v_user_id is null or not public.is_active_app_user() then raise exception 'An active DallmayrERP account is required.' using errcode='42501'; end if;
 if v_region not in ('south_africa','dubai','europe') then raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023'; end if;
 select telemetry_region into v_current from public.user_details where user_id=v_user_id for update; if not found then raise exception 'User profile was not found.' using errcode='22023'; end if;
 if v_current is not null and v_current<>v_region and not public.can_manage_telemetry_regions() then raise exception 'Telemetry region is locked. Ask an Administrator or Operations user to change it.' using errcode='42501'; end if;
 update public.user_details set telemetry_region=v_region,updated_at=now() where user_id=v_user_id;
 return jsonb_build_object('user_id',v_user_id,'telemetry_region',v_region,'changed',v_current is distinct from v_region);
end $$;
create or replace function public.set_user_telemetry_region(p_user_id uuid,p_region text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text:=lower(trim(coalesce(p_region,''))); begin
 if not public.can_manage_telemetry_regions() then raise exception 'Only Administrator or Operations users may assign another user''s telemetry region.' using errcode='42501'; end if;
 if v_region not in ('south_africa','dubai','europe') then raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023'; end if;
 update public.user_details set telemetry_region=v_region,updated_at=now() where user_id=p_user_id; if not found then raise exception 'User profile was not found.' using errcode='22023'; end if;
 return jsonb_build_object('user_id',p_user_id,'telemetry_region',v_region);
end $$;
create or replace function public.set_machine_telemetry_region(p_machine_id uuid,p_region text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text:=lower(trim(coalesce(p_region,''))); v_devices integer; begin
 if not public.can_manage_telemetry_regions() then raise exception 'Only Administrator or Operations users may move machines between telemetry regions.' using errcode='42501'; end if;
 if v_region not in ('south_africa','dubai','europe') then raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023'; end if;
 perform set_config('app.telemetry_region_override','on',true); update public.machines set telemetry_region=v_region,updated_at=now() where id=p_machine_id; if not found then raise exception 'Machine was not found.' using errcode='22023'; end if;
 select count(*)::integer into v_devices from public.telemetry_devices where machine_id=p_machine_id and telemetry_region=v_region;
 return jsonb_build_object('machine_id',p_machine_id,'telemetry_region',v_region,'linked_devices_moved',v_devices);
end $$;
create or replace function public.set_device_telemetry_region(p_device_id uuid,p_region text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_region text:=lower(trim(coalesce(p_region,''))); v_machine_id uuid; begin
 if not public.can_manage_telemetry_regions() then raise exception 'Only Administrator or Operations users may move devices between telemetry regions.' using errcode='42501'; end if;
 if v_region not in ('south_africa','dubai','europe') then raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023'; end if;
 select machine_id into v_machine_id from public.telemetry_devices where id=p_device_id; if not found then raise exception 'Telemetry device was not found.' using errcode='22023'; end if;
 if v_machine_id is not null then raise exception 'Move the linked machine instead; linked devices inherit the machine region.' using errcode='22023'; end if;
 perform set_config('app.telemetry_region_override','on',true); update public.telemetry_devices set telemetry_region=v_region,updated_at=now() where id=p_device_id;
 return jsonb_build_object('device_id',p_device_id,'telemetry_region',v_region);
end $$;
create or replace function public.get_telemetry_region_assignments() returns table(user_id uuid,email text,first_name text,last_name text,role text,branch text,telemetry_region text,is_active boolean) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.can_manage_telemetry_regions() then raise exception 'Only Administrator or Operations users may manage telemetry region assignments.' using errcode='42501'; end if;
 return query select u.id,u.email,d.first_name,d.last_name,d.role,d.branch,d.telemetry_region,u.is_active from public.users u join public.user_details d on d.user_id=u.id order by u.is_active desc,lower(coalesce(d.first_name,'')),lower(coalesce(d.last_name,'')),lower(u.email);
end $$;
create or replace function public.get_telemetry_region_summary() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb; begin
 if not public.can_manage_telemetry_regions() then raise exception 'Only Administrator or Operations users may view cross-region telemetry totals.' using errcode='42501'; end if;
 select jsonb_build_object('regions',jsonb_build_array(
  jsonb_build_object('region','south_africa','machines',(select count(*) from public.machines where telemetry_region='south_africa'),'devices',(select count(*) from public.telemetry_devices where telemetry_region='south_africa'),'users',(select count(*) from public.user_details where telemetry_region='south_africa')),
  jsonb_build_object('region','dubai','machines',(select count(*) from public.machines where telemetry_region='dubai'),'devices',(select count(*) from public.telemetry_devices where telemetry_region='dubai'),'users',(select count(*) from public.user_details where telemetry_region='dubai')),
  jsonb_build_object('region','europe','machines',(select count(*) from public.machines where telemetry_region='europe'),'devices',(select count(*) from public.telemetry_devices where telemetry_region='europe'),'users',(select count(*) from public.user_details where telemetry_region='europe'))),'generated_at',now()) into v_result;
 return v_result;
end $$;

revoke all on function public.current_telemetry_region() from public,anon;
revoke all on function public.can_manage_telemetry_regions() from public,anon;
revoke all on function public.assert_telemetry_region_selected() from public,anon;
revoke all on function public.telemetry_region_allows_machine(uuid) from public,anon;
revoke all on function public.telemetry_region_allows_device(uuid) from public,anon;
revoke all on function public.telemetry_region_allows_fault(uuid) from public,anon;
revoke all on function public.telemetry_region_allows_session(uuid) from public,anon;
revoke all on function public.telemetry_region_allows_attention_source(text) from public,anon;
revoke all on function public.telemetry_region_allows_enrollment_window(uuid) from public,anon;
revoke all on function public.protect_user_telemetry_region() from public,anon,authenticated;
revoke all on function public.protect_machine_telemetry_region() from public,anon,authenticated;
revoke all on function public.protect_device_telemetry_region() from public,anon,authenticated;
revoke all on function public.guard_telemetry_region_delete() from public,anon,authenticated;
revoke all on function public.sync_machine_region_to_devices() from public,anon,authenticated;
revoke all on function public.set_my_telemetry_region(text) from public,anon;
revoke all on function public.set_user_telemetry_region(uuid,text) from public,anon;
revoke all on function public.set_machine_telemetry_region(uuid,text) from public,anon;
revoke all on function public.set_device_telemetry_region(uuid,text) from public,anon;
revoke all on function public.get_telemetry_region_assignments() from public,anon;
revoke all on function public.get_telemetry_region_summary() from public,anon;

grant execute on function public.current_telemetry_region() to authenticated;
grant execute on function public.telemetry_region_allows_machine(uuid) to authenticated;
grant execute on function public.telemetry_region_allows_device(uuid) to authenticated;
grant execute on function public.telemetry_region_allows_fault(uuid) to authenticated;
grant execute on function public.telemetry_region_allows_session(uuid) to authenticated;
grant execute on function public.telemetry_region_allows_attention_source(text) to authenticated;
grant execute on function public.telemetry_region_allows_enrollment_window(uuid) to authenticated;
grant execute on function public.set_my_telemetry_region(text) to authenticated;
grant execute on function public.set_user_telemetry_region(uuid,text) to authenticated;
grant execute on function public.set_machine_telemetry_region(uuid,text) to authenticated;
grant execute on function public.set_device_telemetry_region(uuid,text) to authenticated;
grant execute on function public.get_telemetry_region_assignments() to authenticated;
grant execute on function public.get_telemetry_region_summary() to authenticated;
