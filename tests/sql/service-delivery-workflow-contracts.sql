\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema test_support;

create table public.users (
  id uuid primary key,
  is_active boolean not null
);

create table public.user_details (
  user_id uuid primary key references public.users(id),
  role text not null,
  branch text not null
);

create table public.service_jobs (
  id uuid primary key,
  branch text not null,
  status text not null,
  assigned_to uuid references public.users(id),
  completed_at timestamptz,
  closed_by uuid references public.users(id),
  closed_at timestamptz,
  closing_remarks text,
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.delivery_orders (
  id uuid primary key,
  branch text not null,
  status text not null,
  assigned_to uuid references public.users(id),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz,
  status_updated_at timestamptz not null default pg_catalog.now(),
  status_updated_by uuid references public.users(id),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_role text,
  branch text,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text,
  before_payload jsonb,
  after_payload jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select nullif(pg_catalog.current_setting('app.test_user_id', true), '')::uuid;
$function$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select d.role
  from public.users u
  join public.user_details d on d.user_id = u.id
  where u.id = public.current_app_user_id()
    and u.is_active = true
  limit 1;
$function$;

create or replace function test_support.assert_true(p_condition boolean, p_label text)
returns void
language plpgsql
as $function$
begin
  if p_condition is distinct from true then
    raise exception 'Assertion failed: %', p_label;
  end if;
end;
$function$;

create or replace function test_support.assert_raises(p_label text, p_sql text, p_message text default null)
returns void
language plpgsql
as $function$
declare
  v_actual text;
begin
  begin
    execute p_sql;
  exception when others then
    v_actual := sqlerrm;
    if p_message is not null and pg_catalog.strpos(v_actual, p_message) = 0 then
      raise exception 'Assertion failed: % expected error containing "%", got "%"', p_label, p_message, v_actual;
    end if;
    return;
  end;

  raise exception 'Assertion failed: % expected an error', p_label;
end;
$function$;

insert into public.users (id, is_active) values
  ('00000000-0000-0000-0000-000000000001', true),
  ('00000000-0000-0000-0000-000000000002', true),
  ('00000000-0000-0000-0000-000000000003', true),
  ('00000000-0000-0000-0000-000000000004', true),
  ('00000000-0000-0000-0000-000000000005', true),
  ('00000000-0000-0000-0000-000000000006', true),
  ('00000000-0000-0000-0000-000000000007', true),
  ('00000000-0000-0000-0000-000000000008', true),
  ('00000000-0000-0000-0000-000000000009', false),
  ('00000000-0000-0000-0000-000000000010', true),
  ('00000000-0000-0000-0000-000000000011', true),
  ('00000000-0000-0000-0000-000000000012', true);

insert into public.user_details (user_id, role, branch) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'national'),
  ('00000000-0000-0000-0000-000000000002', 'operations', 'jhb'),
  ('00000000-0000-0000-0000-000000000003', 'operations', 'cpt'),
  ('00000000-0000-0000-0000-000000000004', 'warehouse_staff', 'jhb'),
  ('00000000-0000-0000-0000-000000000005', 'warehouse_staff', 'cpt'),
  ('00000000-0000-0000-0000-000000000006', 'technician', 'jhb'),
  ('00000000-0000-0000-0000-000000000007', 'road_technician', 'jhb'),
  ('00000000-0000-0000-0000-000000000008', 'technician', 'cpt'),
  ('00000000-0000-0000-0000-000000000009', 'technician', 'jhb'),
  ('00000000-0000-0000-0000-000000000010', 'road_technician', 'cpt'),
  ('00000000-0000-0000-0000-000000000011', 'operations', 'national'),
  ('00000000-0000-0000-0000-000000000012', 'technician', 'national');

insert into public.service_jobs (id, branch, status, assigned_to) values
  ('00000000-0000-0000-0000-000000000101', 'jhb', 'new', null),
  ('00000000-0000-0000-0000-000000000102', 'jhb', 'assigned', '00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000103', 'jhb', 'in_progress', '00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000104', 'jhb', 'completed', '00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000105', 'jhb', 'verified', '00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000106', 'jhb', 'closed', '00000000-0000-0000-0000-000000000006'),
  ('00000000-0000-0000-0000-000000000107', 'cpt', 'new', null),
  ('00000000-0000-0000-0000-000000000108', 'jhb', 'assigned', '00000000-0000-0000-0000-000000000009'),
  ('00000000-0000-0000-0000-000000000109', 'national', 'new', null);

insert into public.delivery_orders (id, branch, status, assigned_to) values
  ('00000000-0000-0000-0000-000000000201', 'jhb', 'draft', null),
  ('00000000-0000-0000-0000-000000000202', 'cpt', 'draft', null),
  ('00000000-0000-0000-0000-000000000203', 'jhb', 'picked', '00000000-0000-0000-0000-000000000007'),
  ('00000000-0000-0000-0000-000000000204', 'jhb', 'dispatched', '00000000-0000-0000-0000-000000000007'),
  ('00000000-0000-0000-0000-000000000205', 'jhb', 'delivered', '00000000-0000-0000-0000-000000000007'),
  ('00000000-0000-0000-0000-000000000206', 'jhb', 'closed', '00000000-0000-0000-0000-000000000007'),
  ('00000000-0000-0000-0000-000000000207', 'jhb', 'picked', null),
  ('00000000-0000-0000-0000-000000000208', 'jhb', 'picked', '00000000-0000-0000-0000-000000000010'),
  ('00000000-0000-0000-0000-000000000209', 'cpt', 'draft', null);

\ir ../../sql/staged_service_delivery_workflow_hardening.sql

select test_support.assert_true(
  not pg_catalog.has_function_privilege('anon', 'public.assign_service_job(uuid,uuid)', 'EXECUTE'),
  'anonymous assignment execution is revoked'
);
select test_support.assert_true(
  pg_catalog.has_function_privilege('authenticated', 'public.assign_service_job(uuid,uuid)', 'EXECUTE'),
  'authenticated assignment execution is retained'
);
select test_support.assert_true(
  pg_catalog.has_function_privilege('service_role', 'public.assign_service_job(uuid,uuid)', 'EXECUTE'),
  'service-role assignment execution is retained'
);
select test_support.assert_true(
  not pg_catalog.has_function_privilege('anon', 'public.transition_service_job(uuid,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.close_service_job(uuid,text)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.transition_delivery_order(uuid,text)', 'EXECUTE'),
  'anonymous transition execution is revoked'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000002', false);
select test_support.assert_raises(
  'Operations cannot assign another branch',
  $q$select public.assign_service_job('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000008')$q$,
  'their branch'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000001', false);
select test_support.assert_raises(
  'inactive technicians cannot be assigned',
  $q$select public.assign_service_job('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000009')$q$,
  'active technician'
);
select test_support.assert_raises(
  'cross-branch technicians cannot be assigned',
  $q$select public.assign_service_job('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000008')$q$,
  'different branch'
);

select public.assign_service_job(
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000006'
);
select test_support.assert_true(
  (select status = 'assigned' and assigned_to = '00000000-0000-0000-0000-000000000006'::uuid
   from public.service_jobs where id = '00000000-0000-0000-0000-000000000101'),
  'valid assignment moves a new job to assigned'
);
select test_support.assert_true(
  exists (
    select 1
    from public.audit_events
    where entity_id = '00000000-0000-0000-0000-000000000101'
      and action = 'service_job_assigned'
      and branch = 'jhb'
      and before_payload ->> 'status' = 'new'
      and after_payload ->> 'status' = 'assigned'
      and after_payload ->> 'assigned_to' = '00000000-0000-0000-0000-000000000006'
  ),
  'assignment audit preserves before and after state'
);

select public.assign_service_job('00000000-0000-0000-0000-000000000101', null);
select test_support.assert_true(
  (select status = 'new' and assigned_to is null
   from public.service_jobs where id = '00000000-0000-0000-0000-000000000101'),
  'safe unassignment returns assigned work to the new queue'
);
select test_support.assert_raises(
  'in-progress work cannot be unassigned',
  $q$select public.assign_service_job('00000000-0000-0000-0000-000000000103', null)$q$,
  'cannot be unassigned'
);
select test_support.assert_raises(
  'terminal service work cannot be reassigned',
  $q$select public.assign_service_job('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000007')$q$,
  'cannot be reassigned'
);

select public.assign_service_job(
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000012'
);
select test_support.assert_true(
  (select assigned_to = '00000000-0000-0000-0000-000000000012'::uuid
   from public.service_jobs where id = '00000000-0000-0000-0000-000000000101'),
  'national technicians may be assigned to branch work'
);
select public.assign_service_job('00000000-0000-0000-0000-000000000101', null);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000011', false);
select public.assign_service_job(
  '00000000-0000-0000-0000-000000000107',
  '00000000-0000-0000-0000-000000000008'
);
select test_support.assert_true(
  (select status = 'assigned' from public.service_jobs where id = '00000000-0000-0000-0000-000000000107'),
  'national Operations can manage branch work'
);
update public.service_jobs
set status = 'new', assigned_to = null
where id = '00000000-0000-0000-0000-000000000107';

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000001', false);
select test_support.assert_raises(
  'assigned state requires an assignee',
  $q$select public.transition_service_job('00000000-0000-0000-0000-000000000101', 'assigned')$q$,
  'Assign a technician'
);
select test_support.assert_raises(
  'inactive assignee blocks progress',
  $q$select public.transition_service_job('00000000-0000-0000-0000-000000000108', 'in_progress')$q$,
  'not active and eligible'
);
select test_support.assert_raises(
  'verified jobs cannot bypass close RPC',
  $q$select public.transition_service_job('00000000-0000-0000-0000-000000000105', 'closed')$q$,
  'Invalid service-job transition'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000003', false);
select test_support.assert_raises(
  'Operations cannot transition another branch',
  $q$select public.transition_service_job('00000000-0000-0000-0000-000000000103', 'completed')$q$,
  'their branch'
);
select test_support.assert_raises(
  'Operations cannot close another branch',
  $q$select public.close_service_job('00000000-0000-0000-0000-000000000105', 'cross branch')$q$,
  'their branch'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000006', false);
select public.transition_service_job('00000000-0000-0000-0000-000000000102', 'in_progress');
select public.transition_service_job('00000000-0000-0000-0000-000000000102', 'completed');
select test_support.assert_true(
  (select status = 'completed' and completed_at is not null
   from public.service_jobs where id = '00000000-0000-0000-0000-000000000102'),
  'technician may start and complete assigned work'
);
select test_support.assert_raises(
  'technicians cannot verify work',
  $q$select public.transition_service_job('00000000-0000-0000-0000-000000000102', 'verified')$q$,
  'Invalid service-job transition'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000001', false);
select public.transition_service_job('00000000-0000-0000-0000-000000000102', 'verified');
select public.close_service_job('00000000-0000-0000-0000-000000000102', 'Validated closure');
select test_support.assert_true(
  (select status = 'closed'
          and closed_by = '00000000-0000-0000-0000-000000000001'::uuid
          and closed_at is not null
          and closing_remarks = 'Validated closure'
   from public.service_jobs where id = '00000000-0000-0000-0000-000000000102'),
  'verified work closes through the dedicated close RPC'
);
select test_support.assert_true(
  exists (
    select 1
    from public.audit_events
    where entity_id = '00000000-0000-0000-0000-000000000102'
      and action = 'service_job_closed'
      and before_payload ->> 'status' = 'verified'
      and after_payload ->> 'status' = 'closed'
      and after_payload ->> 'closed_by' = '00000000-0000-0000-0000-000000000001'
  ),
  'close audit preserves before and after state'
);

select public.assign_service_job(
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000007'
);
select test_support.assert_true(
  (select status = 'in_progress'
          and assigned_to = '00000000-0000-0000-0000-000000000007'::uuid
   from public.service_jobs where id = '00000000-0000-0000-0000-000000000103'),
  'in-progress work may be safely reassigned without rewinding status'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000002', false);
select test_support.assert_raises(
  'Operations cannot move another-branch delivery',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000202', 'picked')$q$,
  'their branch'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000011', false);
select public.transition_delivery_order('00000000-0000-0000-0000-000000000202', 'picked');
select test_support.assert_true(
  (select status = 'picked' from public.delivery_orders where id = '00000000-0000-0000-0000-000000000202'),
  'national Operations can move branch delivery work'
);
update public.delivery_orders
set status = 'draft', status_updated_by = null
where id = '00000000-0000-0000-0000-000000000202';

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000004', false);
select test_support.assert_raises(
  'Warehouse cannot move another branch',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000202', 'picked')$q$,
  'their branch'
);
select public.transition_delivery_order('00000000-0000-0000-0000-000000000201', 'picked');
select test_support.assert_true(
  (select status = 'picked' from public.delivery_orders where id = '00000000-0000-0000-0000-000000000201'),
  'Warehouse may pick a draft order in its branch'
);
select test_support.assert_raises(
  'Warehouse cannot dispatch',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000201', 'dispatched')$q$,
  'Invalid delivery-order transition'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000007', false);
select public.transition_delivery_order('00000000-0000-0000-0000-000000000203', 'dispatched');
select public.transition_delivery_order('00000000-0000-0000-0000-000000000203', 'delivered');
select test_support.assert_true(
  (select status = 'delivered' and dispatched_at is not null and delivered_at is not null
   from public.delivery_orders where id = '00000000-0000-0000-0000-000000000203'),
  'assigned road technician may dispatch and deliver'
);
select test_support.assert_raises(
  'road technician cannot update unassigned delivery',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000207', 'dispatched')$q$,
  'not assigned to you'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000010', false);
select test_support.assert_raises(
  'road technician cannot work a mismatched branch',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000208', 'dispatched')$q$,
  'their branch'
);

select pg_catalog.set_config('app.test_user_id', '00000000-0000-0000-0000-000000000001', false);
select test_support.assert_raises(
  'delivery stages cannot be skipped',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000209', 'delivered')$q$,
  'Invalid delivery-order transition'
);
select public.transition_delivery_order('00000000-0000-0000-0000-000000000205', 'closed');
select test_support.assert_true(
  (select status = 'closed' and closed_at is not null
   from public.delivery_orders where id = '00000000-0000-0000-0000-000000000205'),
  'delivered orders may close'
);
select test_support.assert_raises(
  'closed delivery orders are terminal',
  $q$select public.transition_delivery_order('00000000-0000-0000-0000-000000000206', 'delivered')$q$,
  'Invalid delivery-order transition'
);
select test_support.assert_true(
  exists (
    select 1
    from public.audit_events
    where entity_id = '00000000-0000-0000-0000-000000000205'
      and action = 'delivery_status_changed'
      and before_payload ->> 'status' = 'delivered'
      and after_payload ->> 'status' = 'closed'
  ),
  'delivery audit preserves before and after state'
);

select 'Service/delivery workflow database contract tests passed.' as result;
