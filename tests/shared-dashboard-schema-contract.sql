\set ON_ERROR_STOP on

set role authenticated;
select set_config('app.test_role', 'admin', false);
select set_config('app.test_user_id', '00000000-0000-0000-0000-000000000001', false);

insert into public.shared_dashboards(name, slug, description, target_role, branch_scope, created_by, updated_by)
values
  ('Operations overview', 'operations-overview', 'Shared operational pressure for every branch.', 'operations', null, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('JHB operations', 'jhb-operations', 'Johannesburg Operations audience.', 'operations', 'jhb', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('National operations', 'national-operations', 'National Operations audience.', 'operations', 'national', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('Sales coverage', 'sales-coverage', 'Shared sales account coverage.', 'sales', null, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('Operations draft', 'operations-draft', 'Unpublished Operations dashboard.', 'operations', null, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001');

insert into public.shared_dashboard_widgets(dashboard_id, metric_key, position)
select id, 'branch_open_work', 0 from public.shared_dashboards where slug = 'operations-overview'
union all
select id, 'branch_overdue_work', 1 from public.shared_dashboards where slug = 'operations-overview'
union all
select id, 'unassigned_work', 0 from public.shared_dashboards where slug = 'jhb-operations'
union all
select id, 'open_service_jobs', 0 from public.shared_dashboards where slug = 'national-operations'
union all
select id, 'customer_count', 0 from public.shared_dashboards where slug = 'sales-coverage'
union all
select id, 'branch_open_work', 0 from public.shared_dashboards where slug = 'operations-draft';

update public.shared_dashboards
set is_published = true, updated_by = '00000000-0000-0000-0000-000000000001'
where slug in ('operations-overview', 'jhb-operations', 'national-operations', 'sales-coverage');

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.shared_dashboard_widgets(dashboard_id, metric_key, position)
    select id, 'business_users', 9
    from public.shared_dashboards
    where slug = 'operations-draft';
  exception when others then
    if position('not permitted for role operations' in sqlerrm) > 0 then
      rejected := true;
    else
      raise;
    end if;
  end;

  if not rejected then
    raise exception 'Role-incompatible widget was accepted';
  end if;
end $$;

do $$
declare
  rejected boolean := false;
begin
  begin
    update public.shared_dashboards
    set target_role = 'sales'
    where slug = 'operations-draft';
  exception when others then
    if position('Remove widgets that are not permitted' in sqlerrm) > 0 then
      rejected := true;
    else
      raise;
    end if;
  end;

  if not rejected then
    raise exception 'Dashboard role changed while incompatible widgets remained';
  end if;
end $$;

do $$
declare
  rejected boolean := false;
begin
  begin
    delete from public.shared_dashboard_widgets
    where dashboard_id = (select id from public.shared_dashboards where slug = 'jhb-operations');
  exception when others then
    if position('Unpublish the dashboard before removing its final widget' in sqlerrm) > 0 then
      rejected := true;
    else
      raise;
    end if;
  end;

  if not rejected then
    raise exception 'Published dashboard lost its final widget';
  end if;
end $$;

select set_config('app.test_role', 'operations', false);
select set_config('app.test_user_id', '00000000-0000-0000-0000-000000000002', false);

do $$
declare
  dashboard_count integer;
  widget_count integer;
begin
  select count(*) into dashboard_count from public.shared_dashboards;
  if dashboard_count <> 2 then
    raise exception 'JHB Operations should see 2 published dashboards, saw %', dashboard_count;
  end if;

  if exists (select 1 from public.shared_dashboards where slug in ('national-operations', 'sales-coverage', 'operations-draft')) then
    raise exception 'JHB Operations saw an out-of-scope dashboard';
  end if;

  select count(*) into widget_count from public.shared_dashboard_widgets;
  if widget_count <> 3 then
    raise exception 'JHB Operations should see 3 visible widgets, saw %', widget_count;
  end if;
end $$;

select set_config('app.test_user_id', '00000000-0000-0000-0000-000000000003', false);

do $$
declare
  dashboard_count integer;
begin
  select count(*) into dashboard_count from public.shared_dashboards;
  if dashboard_count <> 1 then
    raise exception 'CPT Operations should see only the unscoped dashboard, saw %', dashboard_count;
  end if;
  if not exists (select 1 from public.shared_dashboards where slug = 'operations-overview') then
    raise exception 'CPT Operations could not see the unscoped dashboard';
  end if;
end $$;

select set_config('app.test_user_id', '00000000-0000-0000-0000-000000000004', false);

do $$
declare
  dashboard_count integer;
begin
  select count(*) into dashboard_count from public.shared_dashboards;
  if dashboard_count <> 2 then
    raise exception 'National Operations should see unscoped plus national-scoped dashboards, saw %', dashboard_count;
  end if;
  if exists (select 1 from public.shared_dashboards where slug = 'jhb-operations') then
    raise exception 'National Operations incorrectly saw a JHB-scoped dashboard';
  end if;
end $$;

select set_config('app.test_role', 'sales', false);
select set_config('app.test_user_id', '00000000-0000-0000-0000-000000000005', false);

do $$
declare
  dashboard_count integer;
  widget_count integer;
begin
  select count(*) into dashboard_count from public.shared_dashboards;
  if dashboard_count <> 1 then
    raise exception 'Sales should see exactly one published sales dashboard, saw %', dashboard_count;
  end if;
  if not exists (select 1 from public.shared_dashboards where slug = 'sales-coverage') then
    raise exception 'Sales could not see its shared dashboard';
  end if;
  select count(*) into widget_count from public.shared_dashboard_widgets;
  if widget_count <> 1 then
    raise exception 'Sales should see one shared-dashboard widget, saw %', widget_count;
  end if;
end $$;

do $$
declare
  rejected boolean := false;
begin
  begin
    insert into public.shared_dashboards(name, slug, target_role, created_by, updated_by)
    values (
      'Unauthorized dashboard', 'unauthorized-dashboard', 'sales',
      '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005'
    );
  exception when others then
    if position('row-level security' in lower(sqlerrm)) > 0 then
      rejected := true;
    else
      raise;
    end if;
  end;

  if not rejected then
    raise exception 'Non-admin user created a shared dashboard';
  end if;
end $$;

reset role;

do $$
declare
  audit_count integer;
begin
  if has_table_privilege('anon', 'public.shared_dashboards', 'select') then
    raise exception 'anon unexpectedly has SELECT on shared_dashboards';
  end if;
  if has_table_privilege('anon', 'public.shared_dashboard_widgets', 'select') then
    raise exception 'anon unexpectedly has SELECT on shared_dashboard_widgets';
  end if;

  select count(*) into audit_count
  from public.audit_events
  where entity_type = 'shared_dashboard';

  if audit_count < 10 then
    raise exception 'Shared dashboard management did not create the expected audit trail';
  end if;
end $$;

select 'Shared dashboard database contracts passed.' as result;
