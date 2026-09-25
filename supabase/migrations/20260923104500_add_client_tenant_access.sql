-- Add customer-scoped client accounts without weakening Dallmayr staff access.
-- Client accounts are read-only, are bound to one customer, and may only read
-- telemetry rows associated with that customer's machines.

alter table public.users
  add column if not exists account_scope text not null default 'dallmayr',
  add column if not exists customer_id uuid null;

alter table public.users
  drop constraint if exists users_account_scope_check;
alter table public.users
  add constraint users_account_scope_check
  check (account_scope in ('dallmayr','client'));

alter table public.users
  drop constraint if exists users_customer_id_fkey;
alter table public.users
  add constraint users_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete restrict;

alter table public.users
  drop constraint if exists users_client_customer_check;
alter table public.users
  add constraint users_client_customer_check
  check (
    (account_scope = 'dallmayr' and customer_id is null)
    or (account_scope = 'client' and customer_id is not null)
  );

create index if not exists users_customer_id_idx on public.users(customer_id) where customer_id is not null;

alter table public.user_details drop constraint if exists user_details_role_check;
alter table public.user_details
  add constraint user_details_role_check
  check (role in (
    'admin','operations','sales','finance','marketing','executive',
    'warehouse_staff','technician','road_technician','client_viewer'
  ));

create or replace function public.current_app_account_scope()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.account_scope
  from public.users u
  where u.auth_user_id = (select auth.uid())
    and u.is_active = true
  limit 1;
$$;

create or replace function public.current_app_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.customer_id
  from public.users u
  where u.auth_user_id = (select auth.uid())
    and u.is_active = true
    and u.account_scope = 'client'
  limit 1;
$$;

create or replace function public.is_dallmayr_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_app_user()
    and coalesce(public.current_app_account_scope(), '') = 'dallmayr';
$$;

create or replace function public.is_client_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_app_user()
    and coalesce(public.current_app_account_scope(), '') = 'client'
    and public.current_app_customer_id() is not null;
$$;

create or replace function public.telemetry_account_allows_machine(p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.is_dallmayr_app_user() then true
    when public.is_client_app_user() then exists (
      select 1
      from public.machines m
      where m.id = p_machine_id
        and m.customer_id = public.current_app_customer_id()
    )
    else false
  end;
$$;

create or replace function public.telemetry_account_allows_device(p_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.is_dallmayr_app_user() then true
    when public.is_client_app_user() then exists (
      select 1
      from public.telemetry_devices d
      join public.machines m on m.id = d.machine_id
      where d.id = p_device_id
        and m.customer_id = public.current_app_customer_id()
    )
    else false
  end;
$$;

create or replace function public.telemetry_account_allows_fault(p_fault_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.telemetry_fault_events f
    where f.id = p_fault_id
      and public.telemetry_account_allows_device(f.device_id)
  );
$$;

create or replace function public.telemetry_account_allows_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.telemetry_test_sessions s
    where s.id = p_session_id
      and public.telemetry_account_allows_device(s.device_id)
  );
$$;

-- Preserve regional isolation and add the customer boundary for client accounts.
create or replace function public.telemetry_region_allows_machine(p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.machines m
    where m.id = p_machine_id
      and m.telemetry_region = public.current_telemetry_region()
      and public.telemetry_account_allows_machine(m.id)
  );
$$;

create or replace function public.telemetry_region_allows_device(p_device_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.telemetry_devices d
    where d.id = p_device_id
      and d.telemetry_region = public.current_telemetry_region()
      and public.telemetry_account_allows_device(d.id)
  );
$$;

create or replace function public.telemetry_region_allows_fault(p_fault_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.telemetry_fault_events f
    where f.id = p_fault_id
      and public.telemetry_region_allows_device(f.device_id)
  );
$$;

create or replace function public.telemetry_region_allows_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.telemetry_test_sessions s
    where s.id = p_session_id
      and public.telemetry_region_allows_device(s.device_id)
  );
$$;

-- Any RPC that uses role-based mutation authorization is Dallmayr-only.
create or replace function public.require_app_role(p_allowed text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_dallmayr_app_user()
     or coalesce(public.current_app_role(), '') <> all(p_allowed) then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;
end;
$$;

-- Clients cannot change the region assigned by Dallmayr staff.
create or replace function public.set_my_telemetry_region(p_region text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.current_app_user_id();
  v_region text := lower(trim(coalesce(p_region,'')));
  v_current text;
begin
  if v_user_id is null or not public.is_active_app_user() then
    raise exception 'An active DallmayrERP account is required.' using errcode='42501';
  end if;
  if public.current_app_account_scope() = 'client' then
    raise exception 'Client telemetry region is managed by Dallmayr.' using errcode='42501';
  end if;
  if v_region not in ('south_africa','dubai','europe') then
    raise exception 'Region must be South Africa, Dubai or Europe.' using errcode='22023';
  end if;
  select telemetry_region into v_current from public.user_details where user_id=v_user_id for update;
  if not found then raise exception 'User profile was not found.' using errcode='22023'; end if;
  if v_current is not null and v_current<>v_region and not public.can_manage_telemetry_regions() then
    raise exception 'Telemetry region is locked. Ask an Administrator or Operations user to change it.' using errcode='42501';
  end if;
  update public.user_details set telemetry_region=v_region,updated_at=now() where user_id=v_user_id;
  return jsonb_build_object('user_id',v_user_id,'telemetry_region',v_region,'changed',v_current is distinct from v_region);
end;
$$;

-- Administrator APIs for creating and managing customer-bound client accounts.
create or replace function public.admin_list_client_customer_targets()
returns table(customer_id uuid, customer_code text, customer_name text, branch text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_dallmayr_app_user() or public.current_app_role() <> 'admin' then
    raise exception 'Only a Dallmayr Administrator may manage client accounts' using errcode='42501';
  end if;
  return query
  select c.id, c.customer_code, c.customer_name, c.branch
  from public.customers c
  where lower(coalesce(c.status,'active')) = 'active'
  order by c.customer_name, c.customer_code;
end;
$$;

create or replace function public.admin_create_user_access_v2(
  p_email text,
  p_account_scope text,
  p_customer_id uuid default null,
  p_telemetry_region text default null,
  p_role text default 'operations',
  p_branch text default 'jhb',
  p_is_active boolean default true,
  p_access_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_email text := lower(trim(coalesce(p_email,'')));
  v_scope text := lower(trim(coalesce(p_account_scope,'dallmayr')));
  v_region text := nullif(lower(trim(coalesce(p_telemetry_region,''))), '');
  v_role text := lower(trim(coalesce(p_role,'operations')));
  v_branch text := lower(trim(coalesce(p_branch,'jhb')));
  v_user_id uuid;
begin
  if not public.is_dallmayr_app_user() or public.current_app_role() <> 'admin' then
    raise exception 'Only a Dallmayr Administrator may add users' using errcode='42501';
  end if;
  if v_email = '' or position('@' in v_email) <= 1 then raise exception 'Enter a valid email address'; end if;
  if v_scope not in ('dallmayr','client') then raise exception 'Invalid account scope'; end if;

  if v_scope = 'client' then
    if p_customer_id is null or not exists(select 1 from public.customers c where c.id=p_customer_id and lower(coalesce(c.status,'active'))='active') then
      raise exception 'Select an active client company';
    end if;
    if v_region not in ('south_africa','dubai','europe') then
      raise exception 'Select the client telemetry region';
    end if;
    v_role := 'client_viewer';
    v_branch := 'national';
  else
    if v_role not in ('admin','operations','sales','finance','marketing','executive','warehouse_staff','technician','road_technician') then raise exception 'Invalid ERP role'; end if;
    if v_branch not in ('jhb','cpt','kzn','national') then raise exception 'Invalid ERP branch'; end if;
  end if;

  insert into public.users(email,is_active,access_note,access_updated_by,access_updated_at,updated_at,account_scope,customer_id)
  values(v_email,coalesce(p_is_active,true),nullif(trim(coalesce(p_access_note,'')),''),v_actor,now(),now(),v_scope,case when v_scope='client' then p_customer_id else null end)
  on conflict(email) do update set
    is_active=excluded.is_active,
    access_note=excluded.access_note,
    access_updated_by=v_actor,
    access_updated_at=now(),
    updated_at=now(),
    account_scope=excluded.account_scope,
    customer_id=excluded.customer_id
  returning id into v_user_id;

  insert into public.user_details(user_id,role,branch,telemetry_region,updated_at)
  values(v_user_id,v_role,v_branch,v_region,now())
  on conflict(user_id) do update set
    role=excluded.role,
    branch=excluded.branch,
    telemetry_region=case when v_scope='client' then excluded.telemetry_region else coalesce(public.user_details.telemetry_region,excluded.telemetry_region) end,
    updated_at=now();

  return v_user_id;
end;
$$;

create or replace function public.admin_update_user_access_v2(
  p_user_id uuid,
  p_account_scope text,
  p_customer_id uuid default null,
  p_telemetry_region text default null,
  p_role text default 'operations',
  p_branch text default 'jhb',
  p_is_active boolean default true,
  p_access_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_target public.users%rowtype;
  v_scope text := lower(trim(coalesce(p_account_scope,'dallmayr')));
  v_region text := nullif(lower(trim(coalesce(p_telemetry_region,''))), '');
  v_role text := lower(trim(coalesce(p_role,'operations')));
  v_branch text := lower(trim(coalesce(p_branch,'jhb')));
  v_active_admins integer;
  v_old_role text;
begin
  if not public.is_dallmayr_app_user() or public.current_app_role() <> 'admin' then
    raise exception 'Only a Dallmayr Administrator may change user access' using errcode='42501';
  end if;
  select * into v_target from public.users where id=p_user_id for update;
  if not found then raise exception 'User access record not found'; end if;
  select role into v_old_role from public.user_details where user_id=p_user_id;
  if v_scope not in ('dallmayr','client') then raise exception 'Invalid account scope'; end if;

  if v_scope='client' then
    if p_user_id=v_actor then raise exception 'You cannot convert your own Administrator account to a client account'; end if;
    if p_customer_id is null or not exists(select 1 from public.customers c where c.id=p_customer_id and lower(coalesce(c.status,'active'))='active') then raise exception 'Select an active client company'; end if;
    if v_region not in ('south_africa','dubai','europe') then raise exception 'Select the client telemetry region'; end if;
    v_role:='client_viewer'; v_branch:='national';
  else
    if v_role not in ('admin','operations','sales','finance','marketing','executive','warehouse_staff','technician','road_technician') then raise exception 'Invalid ERP role'; end if;
    if v_branch not in ('jhb','cpt','kzn','national') then raise exception 'Invalid ERP branch'; end if;
  end if;

  if p_user_id=v_actor and (v_role<>'admin' or coalesce(p_is_active,false)=false) then
    raise exception 'You cannot remove your own Administrator rights or suspend your own access while signed in';
  end if;
  if v_old_role='admin' and v_target.is_active=true and (v_role<>'admin' or coalesce(p_is_active,false)=false) then
    select count(*) into v_active_admins from public.users u join public.user_details d on d.user_id=u.id where u.is_active=true and d.role='admin';
    if v_active_admins<=1 then raise exception 'The final active Administrator cannot be demoted or suspended'; end if;
  end if;

  update public.users set
    is_active=coalesce(p_is_active,false),
    access_note=nullif(trim(coalesce(p_access_note,'')),''),
    access_updated_by=v_actor,
    access_updated_at=now(),
    updated_at=now(),
    account_scope=v_scope,
    customer_id=case when v_scope='client' then p_customer_id else null end
  where id=p_user_id;

  insert into public.user_details(user_id,role,branch,telemetry_region,updated_at)
  values(p_user_id,v_role,v_branch,v_region,now())
  on conflict(user_id) do update set
    role=excluded.role,
    branch=excluded.branch,
    telemetry_region=case when v_scope='client' then excluded.telemetry_region else coalesce(excluded.telemetry_region,public.user_details.telemetry_region) end,
    updated_at=now();
end;
$$;

create or replace function public.admin_list_user_access_v2()
returns table(
  user_id uuid,email text,is_active boolean,access_note text,account_scope text,customer_id uuid,customer_name text,
  role text,branch text,telemetry_region text,first_name text,last_name text,phone_number text,birthday date,
  emergency_contact_name text,profile_complete boolean,created_at timestamptz,updated_at timestamptz,access_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_dallmayr_app_user() or public.current_app_role()<>'admin' then
    raise exception 'Only a Dallmayr Administrator may manage users and access rights' using errcode='42501';
  end if;
  return query
  select u.id,u.email,u.is_active,u.access_note,u.account_scope,u.customer_id,c.customer_name,d.role,d.branch,d.telemetry_region,
    d.first_name,d.last_name,d.phone_number,d.birthday,d.emergency_contact_name,
    (nullif(trim(coalesce(d.first_name,'')),'') is not null and nullif(trim(coalesce(d.last_name,'')),'') is not null
      and nullif(trim(coalesce(d.phone_number,'')),'') is not null and d.birthday is not null
      and nullif(trim(coalesce(d.emergency_contact_name,'')),'') is not null and nullif(trim(coalesce(d.emergency_contact_phone,'')),'') is not null),
    u.created_at,greatest(u.updated_at,coalesce(d.updated_at,u.updated_at)),u.access_updated_at
  from public.users u
  left join public.user_details d on d.user_id=u.id
  left join public.customers c on c.id=u.customer_id
  order by u.is_active desc,u.account_scope,c.customer_name,u.email;
end;
$$;

-- Restrictive tenant SELECT policies make direct PostgREST reads fail closed.
drop policy if exists tenant_customer_select on public.customers;
create policy tenant_customer_select on public.customers as restrictive for select to authenticated
using (public.is_dallmayr_app_user() or id=public.current_app_customer_id());

drop policy if exists tenant_customer_site_select on public.customer_sites;
create policy tenant_customer_site_select on public.customer_sites as restrictive for select to authenticated
using (public.is_dallmayr_app_user() or customer_id=public.current_app_customer_id());

drop policy if exists tenant_machine_select on public.machines;
create policy tenant_machine_select on public.machines as restrictive for select to authenticated
using (public.telemetry_account_allows_machine(id));

drop policy if exists tenant_device_select on public.telemetry_devices;
create policy tenant_device_select on public.telemetry_devices as restrictive for select to authenticated
using (public.telemetry_account_allows_device(id));

-- Tables that resolve directly through device_id.
do $$
declare t text;
begin
  foreach t in array array[
    'telemetry_counter_state','telemetry_daily_item_sales','telemetry_daily_simulation_sales','telemetry_data_usage_daily','telemetry_data_usage_state',
    'telemetry_debug_logs','telemetry_device_config_history','telemetry_device_location_history','telemetry_device_location_state','telemetry_diagnostics',
    'telemetry_enrollment_window_claims','telemetry_fault_events','telemetry_fault_rule_candidates','telemetry_field_acceptance_records',
    'telemetry_fleet_attention_workflow','telemetry_machine_state','telemetry_prepaid_balance_history','telemetry_prepaid_balance_state',
    'telemetry_selection_observations','telemetry_simulation_counter_state','telemetry_test_commands','telemetry_test_sessions','telemetry_vend_evidence'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists tenant_device_select on public.%I',t);
    execute format('create policy tenant_device_select on public.%I as restrictive for select to authenticated using (public.telemetry_account_allows_device(device_id))',t);
  end loop;
end $$;

-- Client sessions are read-only even where an older permissive regional ALL policy exists.
do $$
declare t text;
begin
  foreach t in array array[
    'customers','customer_sites','machines','telemetry_devices','telemetry_counter_state','telemetry_daily_item_sales','telemetry_daily_simulation_sales',
    'telemetry_data_usage_daily','telemetry_data_usage_state','telemetry_debug_logs','telemetry_device_config_history','telemetry_device_location_history',
    'telemetry_device_location_state','telemetry_diagnostics','telemetry_enrollment_window_claims','telemetry_fault_events','telemetry_fault_rule_candidates',
    'telemetry_field_acceptance_records','telemetry_fleet_attention_workflow','telemetry_machine_state','telemetry_prepaid_balance_history',
    'telemetry_prepaid_balance_state','telemetry_selection_observations','telemetry_simulation_counter_state','telemetry_test_commands','telemetry_test_sessions','telemetry_vend_evidence'
  ] loop
    execute format('drop policy if exists tenant_dallmayr_insert_guard on public.%I',t);
    execute format('create policy tenant_dallmayr_insert_guard on public.%I as restrictive for insert to authenticated with check (public.is_dallmayr_app_user())',t);
    execute format('drop policy if exists tenant_dallmayr_update_guard on public.%I',t);
    execute format('create policy tenant_dallmayr_update_guard on public.%I as restrictive for update to authenticated using (public.is_dallmayr_app_user()) with check (public.is_dallmayr_app_user())',t);
    execute format('drop policy if exists tenant_dallmayr_delete_guard on public.%I',t);
    execute format('create policy tenant_dallmayr_delete_guard on public.%I as restrictive for delete to authenticated using (public.is_dallmayr_app_user())',t);
  end loop;
end $$;

-- Patch telemetry read RPCs that bypass RLS because they run SECURITY DEFINER.
-- Exact replacements are asserted so schema drift fails the migration instead of leaking data.
do $$
declare
  r regprocedure;
  v_def text;
  v_before text;
  sig text;
begin
  foreach sig in array array[
    'public.get_telemetry_dashboard(text,text)',
    'public.get_telemetry_live_status()',
    'public.get_telemetry_machine_fleet(text,text,text,integer,integer)',
    'public.get_telemetry_reporting(text,text,text)',
    'public.get_telemetry_activity(text,text,text,text,text,text,text,integer,integer)',
    'public.get_telemetry_location_map()',
    'public.get_telemetry_data_usage(integer)',
    'public.get_telemetry_prepaid_balances()'
  ] loop
    r := to_regprocedure(sig);
    if r is null then raise exception 'Required telemetry RPC missing: %',sig; end if;
    select pg_get_functiondef(r) into v_def;
    v_before := v_def;
    v_def := regexp_replace(v_def,'d\\.telemetry_region\\s*=\\s*v_region','d.telemetry_region=v_region and public.telemetry_account_allows_device(d.id)','g');
    v_def := regexp_replace(v_def,'m\\.telemetry_region\\s*=\\s*v_region','m.telemetry_region=v_region and public.telemetry_account_allows_machine(m.id)','g');
    if v_def = v_before then raise exception 'Tenant filter injection point missing in %',sig; end if;
    if sig in ('public.get_telemetry_live_status()','public.get_telemetry_activity(text,text,text,text,text,text,text,integer,integer)') then
      v_def := replace(v_def,
        'if coalesce(v_role,'''') not in (''admin'',''executive'',''operations'') then',
        'if public.current_app_account_scope() <> ''client'' and coalesce(v_role,'''') not in (''admin'',''executive'',''operations'') then');
    end if;
    execute v_def;
  end loop;

  r := to_regprocedure('public.get_telemetry_transport_usage(integer)');
  if r is null then raise exception 'Required telemetry RPC missing: get_telemetry_transport_usage'; end if;
  select pg_get_functiondef(r) into v_def;
  v_before := v_def;
  v_def := regexp_replace(v_def,'where telemetry_region\\s*=\\s*v_region','where telemetry_region=v_region and public.telemetry_account_allows_device(id)','g');
  if v_def=v_before then raise exception 'Tenant filter injection point missing in get_telemetry_transport_usage'; end if;
  execute v_def;
end $$;

revoke all on function public.current_app_account_scope() from public, anon;
grant execute on function public.current_app_account_scope() to authenticated, service_role;
revoke all on function public.current_app_customer_id() from public, anon;
grant execute on function public.current_app_customer_id() to authenticated, service_role;
revoke all on function public.is_dallmayr_app_user() from public, anon;
grant execute on function public.is_dallmayr_app_user() to authenticated, service_role;
revoke all on function public.is_client_app_user() from public, anon;
grant execute on function public.is_client_app_user() to authenticated, service_role;
revoke all on function public.telemetry_account_allows_machine(uuid) from public, anon;
grant execute on function public.telemetry_account_allows_machine(uuid) to authenticated, service_role;
revoke all on function public.telemetry_account_allows_device(uuid) from public, anon;
grant execute on function public.telemetry_account_allows_device(uuid) to authenticated, service_role;
revoke all on function public.admin_list_client_customer_targets() from public, anon;
grant execute on function public.admin_list_client_customer_targets() to authenticated;
revoke all on function public.admin_create_user_access_v2(text,text,uuid,text,text,text,boolean,text) from public, anon;
grant execute on function public.admin_create_user_access_v2(text,text,uuid,text,text,text,boolean,text) to authenticated;
revoke all on function public.admin_update_user_access_v2(uuid,text,uuid,text,text,text,boolean,text) from public, anon;
grant execute on function public.admin_update_user_access_v2(uuid,text,uuid,text,text,text,boolean,text) to authenticated;
revoke all on function public.admin_list_user_access_v2() from public, anon;
grant execute on function public.admin_list_user_access_v2() to authenticated;
