-- Harden broad authenticated access from early workspace migrations.

create or replace function public.require_app_role(p_allowed text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_app_role(), '') <> all(p_allowed) then
    raise exception 'insufficient privileges' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.require_app_role(text[]) from public, anon;
grant execute on function public.require_app_role(text[]) to authenticated;

do $$
begin
  if to_regclass('public.sales_opportunities') is not null then
    revoke all on table public.sales_opportunities from anon, public;
    revoke delete on table public.sales_opportunities from authenticated;
    grant select, insert, update on table public.sales_opportunities to authenticated;

    drop policy if exists sales_opportunities_read on public.sales_opportunities;
    drop policy if exists sales_opportunities_insert on public.sales_opportunities;
    drop policy if exists sales_opportunities_update on public.sales_opportunities;
    drop policy if exists sales_opportunities_delete on public.sales_opportunities;
    drop policy if exists sales_opportunities_select_role_scoped on public.sales_opportunities;
    drop policy if exists sales_opportunities_insert_role_scoped on public.sales_opportunities;
    drop policy if exists sales_opportunities_update_role_scoped on public.sales_opportunities;

    create policy sales_opportunities_select_role_scoped
      on public.sales_opportunities
      for select
      to authenticated
      using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'marketing'));

    create policy sales_opportunities_insert_role_scoped
      on public.sales_opportunities
      for insert
      to authenticated
      with check (
        public.current_app_role() in ('admin', 'operations')
        or (
          public.current_app_role() in ('sales', 'marketing')
          and (created_by is null or created_by = public.current_app_user_id())
        )
      );

    create policy sales_opportunities_update_role_scoped
      on public.sales_opportunities
      for update
      to authenticated
      using (public.current_app_role() in ('admin', 'operations', 'sales', 'marketing'))
      with check (public.current_app_role() in ('admin', 'operations', 'sales', 'marketing'));
  end if;

  if to_regclass('public.sales_contract_renewal_source') is not null then
    revoke all on table public.sales_contract_renewal_source from anon, public;
    revoke select on table public.sales_contract_renewal_source from authenticated;
  end if;

  if to_regclass('public.customer_commercial_source') is not null then
    revoke all on table public.customer_commercial_source from anon, public;
    revoke select on table public.customer_commercial_source from authenticated;
  end if;

  if to_regclass('public.marketing_campaigns') is not null then
    revoke all on table public.marketing_campaigns from anon, public;
    grant select, insert, update on table public.marketing_campaigns to authenticated;

    drop policy if exists authenticated_select on public.marketing_campaigns;
    drop policy if exists authenticated_insert on public.marketing_campaigns;
    drop policy if exists authenticated_update on public.marketing_campaigns;
    drop policy if exists marketing_campaigns_select_role_scoped on public.marketing_campaigns;
    drop policy if exists marketing_campaigns_insert_role_scoped on public.marketing_campaigns;
    drop policy if exists marketing_campaigns_update_role_scoped on public.marketing_campaigns;

    create policy marketing_campaigns_select_role_scoped
      on public.marketing_campaigns
      for select
      to authenticated
      using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'marketing'));

    create policy marketing_campaigns_insert_role_scoped
      on public.marketing_campaigns
      for insert
      to authenticated
      with check (
        public.current_app_role() in ('admin', 'operations')
        or (
          public.current_app_role() = 'marketing'
          and (owner_id is null or owner_id = public.current_app_user_id())
        )
      );

    create policy marketing_campaigns_update_role_scoped
      on public.marketing_campaigns
      for update
      to authenticated
      using (public.current_app_role() in ('admin', 'operations', 'marketing'))
      with check (public.current_app_role() in ('admin', 'operations', 'marketing'));
  end if;

  if to_regclass('public.marketing_segments') is not null then
    revoke all on table public.marketing_segments from anon, public;
    grant select, insert, update on table public.marketing_segments to authenticated;

    drop policy if exists authenticated_select on public.marketing_segments;
    drop policy if exists authenticated_insert on public.marketing_segments;
    drop policy if exists authenticated_update on public.marketing_segments;
    drop policy if exists marketing_segments_select_role_scoped on public.marketing_segments;
    drop policy if exists marketing_segments_insert_role_scoped on public.marketing_segments;
    drop policy if exists marketing_segments_update_role_scoped on public.marketing_segments;

    create policy marketing_segments_select_role_scoped
      on public.marketing_segments
      for select
      to authenticated
      using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'marketing'));

    create policy marketing_segments_insert_role_scoped
      on public.marketing_segments
      for insert
      to authenticated
      with check (
        public.current_app_role() in ('admin', 'operations')
        or (
          public.current_app_role() = 'marketing'
          and (created_by is null or created_by = public.current_app_user_id())
        )
      );

    create policy marketing_segments_update_role_scoped
      on public.marketing_segments
      for update
      to authenticated
      using (public.current_app_role() in ('admin', 'operations', 'marketing'))
      with check (public.current_app_role() in ('admin', 'operations', 'marketing'));
  end if;

  if to_regclass('public.marketing_campaign_customers') is not null then
    revoke all on table public.marketing_campaign_customers from anon, public;
    grant select, insert, update on table public.marketing_campaign_customers to authenticated;

    drop policy if exists authenticated_select on public.marketing_campaign_customers;
    drop policy if exists authenticated_insert on public.marketing_campaign_customers;
    drop policy if exists authenticated_update on public.marketing_campaign_customers;
    drop policy if exists marketing_campaign_customers_select_role_scoped on public.marketing_campaign_customers;
    drop policy if exists marketing_campaign_customers_insert_role_scoped on public.marketing_campaign_customers;
    drop policy if exists marketing_campaign_customers_update_role_scoped on public.marketing_campaign_customers;

    create policy marketing_campaign_customers_select_role_scoped
      on public.marketing_campaign_customers
      for select
      to authenticated
      using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'marketing'));

    create policy marketing_campaign_customers_insert_role_scoped
      on public.marketing_campaign_customers
      for insert
      to authenticated
      with check (public.current_app_role() in ('admin', 'operations', 'marketing'));

    create policy marketing_campaign_customers_update_role_scoped
      on public.marketing_campaign_customers
      for update
      to authenticated
      using (public.current_app_role() in ('admin', 'operations', 'marketing'))
      with check (public.current_app_role() in ('admin', 'operations', 'marketing'));
  end if;

  if to_regclass('public.marketing_activities') is not null then
    revoke all on table public.marketing_activities from anon, public;
    grant select, insert, update on table public.marketing_activities to authenticated;

    drop policy if exists authenticated_select on public.marketing_activities;
    drop policy if exists authenticated_insert on public.marketing_activities;
    drop policy if exists authenticated_update on public.marketing_activities;
    drop policy if exists marketing_activities_select_role_scoped on public.marketing_activities;
    drop policy if exists marketing_activities_insert_role_scoped on public.marketing_activities;
    drop policy if exists marketing_activities_update_role_scoped on public.marketing_activities;

    create policy marketing_activities_select_role_scoped
      on public.marketing_activities
      for select
      to authenticated
      using (public.current_app_role() in ('admin', 'executive', 'operations', 'sales', 'marketing'));

    create policy marketing_activities_insert_role_scoped
      on public.marketing_activities
      for insert
      to authenticated
      with check (
        public.current_app_role() in ('admin', 'operations')
        or (
          public.current_app_role() = 'marketing'
          and (created_by is null or created_by = public.current_app_user_id())
        )
      );

    create policy marketing_activities_update_role_scoped
      on public.marketing_activities
      for update
      to authenticated
      using (public.current_app_role() in ('admin', 'operations', 'marketing'))
      with check (public.current_app_role() in ('admin', 'operations', 'marketing'));
  end if;
end $$;

create or replace function public.get_sales_workspace_summary(
  p_branch text default 'all',
  p_salesman text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'sales', 'marketing']::text[]);

  with contracts as (
    select *
    from public.sales_contract_renewal_source
    where (p_branch = 'all' or branch = p_branch)
      and (p_salesman = 'all' or coalesce(salesman, 'Unassigned') = p_salesman)
  ), opportunities as (
    select *
    from public.sales_opportunities
    where (p_branch = 'all' or branch = p_branch)
  ), customers_filtered as (
    select *
    from public.customers
    where (p_branch = 'all' or branch = p_branch)
  ), branch_rows as (
    select branch, count(*) as customer_count
    from customers_filtered
    group by branch
  ), salesman_rows as (
    select coalesce(salesman, 'Unassigned') as salesman, count(*) as contract_count
    from contracts
    group by coalesce(salesman, 'Unassigned')
    order by count(*) desc, salesman
    limit 12
  )
  select jsonb_build_object(
    'customer_count', (select count(*) from customers_filtered),
    'active_customer_count', (select count(*) from customers_filtered where coalesce(status, 'active') = 'active'),
    'contract_count', (select count(*) from contracts),
    'renewals_overdue', (select count(*) from contracts where public.sales_renewal_window(days_to_expire) = 'overdue'),
    'renewals_30', (select count(*) from contracts where public.sales_renewal_window(days_to_expire) = '30'),
    'renewals_60', (select count(*) from contracts where public.sales_renewal_window(days_to_expire) = '60'),
    'renewals_90', (select count(*) from contracts where public.sales_renewal_window(days_to_expire) = '90'),
    'renewals_no_end', (select count(*) from contracts where public.sales_renewal_window(days_to_expire) = 'no_end'),
    'open_opportunities', (select count(*) from opportunities where status in ('open', 'follow_up', 'quoted')),
    'won_opportunities', (select count(*) from opportunities where status = 'won'),
    'lost_opportunities', (select count(*) from opportunities where status = 'lost'),
    'pipeline_value', coalesce((select sum(coalesce(estimated_value, 0)) from opportunities where status in ('open', 'follow_up', 'quoted')), 0),
    'branch_breakdown', coalesce((select jsonb_agg(jsonb_build_object('branch', branch, 'customer_count', customer_count) order by branch) from branch_rows), '[]'::jsonb),
    'salesman_breakdown', coalesce((select jsonb_agg(jsonb_build_object('salesman', salesman, 'contract_count', contract_count)) from salesman_rows), '[]'::jsonb)
  ) into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.search_contract_renewals(
  p_search text default null,
  p_branch text default 'all',
  p_salesman text default 'all',
  p_window text default 'all',
  p_offset integer default 0,
  p_limit integer default 100
)
returns table (
  branch text,
  contract_number text,
  customer_code text,
  customer_name text,
  agreement_type text,
  salesman text,
  machine_count integer,
  start_date_text text,
  end_date_text text,
  days_to_expire integer,
  renewal_window text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'sales', 'marketing']::text[]);

  return query
  with filtered as (
    select
      src.branch,
      src.contract_number,
      src.customer_code,
      src.customer_name,
      src.agreement_type,
      coalesce(src.salesman, 'Unassigned') as salesman,
      src.machine_count,
      src.start_date_text,
      src.end_date_text,
      src.days_to_expire,
      public.sales_renewal_window(src.days_to_expire) as renewal_window
    from public.sales_contract_renewal_source src
    where (p_branch = 'all' or src.branch = p_branch)
      and (p_salesman = 'all' or coalesce(src.salesman, 'Unassigned') = p_salesman)
      and (p_window = 'all' or public.sales_renewal_window(src.days_to_expire) = p_window)
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or src.customer_name ilike '%' || trim(p_search) || '%'
        or src.customer_code ilike '%' || trim(p_search) || '%'
        or src.contract_number ilike '%' || trim(p_search) || '%'
        or src.agreement_type ilike '%' || trim(p_search) || '%'
        or src.salesman ilike '%' || trim(p_search) || '%'
      )
  ), counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.branch,
    counted.contract_number,
    counted.customer_code,
    counted.customer_name,
    counted.agreement_type,
    counted.salesman,
    counted.machine_count,
    counted.start_date_text,
    counted.end_date_text,
    counted.days_to_expire,
    counted.renewal_window,
    counted.total_count
  from counted
  order by
    case counted.renewal_window when 'overdue' then 0 when '30' then 1 when '60' then 2 when '90' then 3 when 'no_end' then 5 else 4 end,
    counted.days_to_expire nulls last,
    counted.customer_name
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.search_sales_opportunities(
  p_search text default null,
  p_branch text default 'all',
  p_status text default 'all',
  p_type text default 'all',
  p_offset integer default 0,
  p_limit integer default 100
)
returns table (
  id uuid,
  branch text,
  customer_id uuid,
  customer_code text,
  customer_name text,
  opportunity_type text,
  status text,
  priority text,
  estimated_value numeric,
  next_action_date date,
  owner_name text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'sales', 'marketing']::text[]);

  return query
  with filtered as (
    select so.*
    from public.sales_opportunities so
    where (p_branch = 'all' or so.branch = p_branch)
      and (p_status = 'all' or so.status = p_status)
      and (p_type = 'all' or so.opportunity_type = p_type)
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or so.customer_name ilike '%' || trim(p_search) || '%'
        or so.customer_code ilike '%' || trim(p_search) || '%'
        or so.opportunity_type ilike '%' || trim(p_search) || '%'
        or so.owner_name ilike '%' || trim(p_search) || '%'
        or so.notes ilike '%' || trim(p_search) || '%'
      )
  ), counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.id,
    counted.branch,
    counted.customer_id,
    counted.customer_code,
    counted.customer_name,
    counted.opportunity_type,
    counted.status,
    counted.priority,
    counted.estimated_value,
    counted.next_action_date,
    counted.owner_name,
    counted.notes,
    counted.created_at,
    counted.updated_at,
    counted.total_count
  from counted
  order by
    case counted.priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
    counted.next_action_date nulls last,
    counted.updated_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.get_marketing_segment_summary(p_branch text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := lower(coalesce(p_branch, 'all'));
  result jsonb;
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'sales', 'marketing']::text[]);

  select jsonb_build_object(
    'customer_count', count(*),
    'active_customers', count(*) filter (where lower(coalesce(active_status, '')) in ('y','yes','active','true','1')),
    'inactive_customers', count(*) filter (where lower(coalesce(active_status, '')) not in ('y','yes','active','true','1')),
    'with_machines', count(*) filter (where public.customer_commercial_is_yes(machine_mapped)),
    'without_machines', count(*) filter (where not public.customer_commercial_is_yes(machine_mapped)),
    'with_email', count(*) filter (where nullif(trim(coalesce(email,'')), '') is not null),
    'with_contract_reference', count(*) filter (where nullif(trim(coalesce(last_contract_number,'')), '') is not null),
    'category_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('category', category_value, 'customer_count', customer_count) order by customer_count desc, category_value)
      from (
        select coalesce(nullif(trim(category), ''), 'Uncategorised') category_value, count(*) customer_count
        from public.customer_commercial_source
        where (v_branch = 'all' or branch = v_branch)
        group by 1
        order by count(*) desc
        limit 12
      ) c
    ), '[]'::jsonb),
    'area_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('area', area_value, 'customer_count', customer_count) order by customer_count desc, area_value)
      from (
        select coalesce(nullif(trim(area), ''), 'No area') area_value, count(*) customer_count
        from public.customer_commercial_source
        where (v_branch = 'all' or branch = v_branch)
        group by 1
        order by count(*) desc
        limit 12
      ) a
    ), '[]'::jsonb),
    'salesman_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('salesman', salesman_value, 'customer_count', customer_count) order by customer_count desc, salesman_value)
      from (
        select coalesce(nullif(trim(sales_man), ''), 'Unassigned') salesman_value, count(*) customer_count
        from public.customer_commercial_source
        where (v_branch = 'all' or branch = v_branch)
        group by 1
        order by count(*) desc
        limit 12
      ) s
    ), '[]'::jsonb)
  ) into result
  from public.customer_commercial_source
  where (v_branch = 'all' or branch = v_branch);

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.search_marketing_segments(
  p_search text default null,
  p_branch text default 'all',
  p_status text default 'all',
  p_machine_mapped text default 'all',
  p_category text default 'all',
  p_salesman text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  branch text,
  customer_code text,
  customer_name text,
  category text,
  area text,
  sales_man text,
  active_status text,
  machine_mapped text,
  service_days text,
  last_contract_number text,
  last_contract_type text,
  email text,
  phone text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'sales', 'marketing']::text[]);

  return query
  with filtered as (
    select *
    from public.customer_commercial_source c
    where (lower(coalesce(p_branch, 'all')) = 'all' or c.branch = lower(p_branch))
      and (lower(coalesce(p_status, 'all')) = 'all'
        or (lower(p_status) = 'active' and lower(coalesce(c.active_status, '')) in ('y','yes','active','true','1'))
        or (lower(p_status) = 'inactive' and lower(coalesce(c.active_status, '')) not in ('y','yes','active','true','1')))
      and (lower(coalesce(p_machine_mapped, 'all')) = 'all'
        or (lower(p_machine_mapped) = 'mapped' and public.customer_commercial_is_yes(c.machine_mapped))
        or (lower(p_machine_mapped) = 'unmapped' and not public.customer_commercial_is_yes(c.machine_mapped)))
      and (lower(coalesce(p_category, 'all')) = 'all' or lower(coalesce(c.category, '')) = lower(p_category))
      and (lower(coalesce(p_salesman, 'all')) = 'all' or lower(coalesce(c.sales_man, '')) = lower(p_salesman))
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or c.customer_name ilike '%' || p_search || '%'
        or c.customer_code ilike '%' || p_search || '%'
        or c.category ilike '%' || p_search || '%'
        or c.area ilike '%' || p_search || '%'
        or c.sales_man ilike '%' || p_search || '%'
        or c.email ilike '%' || p_search || '%'
        or c.phone ilike '%' || p_search || '%'
      )
  ), counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.branch,
    counted.customer_code,
    counted.customer_name,
    counted.category,
    counted.area,
    counted.sales_man,
    counted.active_status,
    counted.machine_mapped,
    counted.service_days,
    counted.last_contract_number,
    counted.last_contract_type,
    counted.email,
    counted.phone,
    counted.total_count
  from counted
  order by counted.customer_name nulls last, counted.customer_code nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.get_finance_workspace_summary(p_branch text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := lower(coalesce(p_branch, 'all'));
  result jsonb;
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'finance']::text[]);

  select jsonb_build_object(
    'account_count', count(*),
    'active_accounts', count(*) filter (where lower(coalesce(active_status, '')) in ('y','yes','active','true','1')),
    'with_credit_limit', count(*) filter (where public.customer_commercial_credit_limit(credit_limit) is not null and public.customer_commercial_credit_limit(credit_limit) > 0),
    'without_credit_limit', count(*) filter (where coalesce(public.customer_commercial_credit_limit(credit_limit), 0) = 0),
    'high_credit_accounts', count(*) filter (where coalesce(public.customer_commercial_credit_limit(credit_limit), 0) >= 50000),
    'credit_exposure', coalesce(sum(coalesce(public.customer_commercial_credit_limit(credit_limit), 0)), 0),
    'with_vat_trn', count(*) filter (where nullif(trim(coalesce(vat_trn, '')), '') is not null),
    'without_vat_trn', count(*) filter (where nullif(trim(coalesce(vat_trn, '')), '') is null),
    'debit_order_accounts', count(*) filter (where public.customer_commercial_is_yes(debit_order)),
    'vat_treatment_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('vat_treatment', vat_treatment_value, 'account_count', account_count) order by account_count desc, vat_treatment_value)
      from (
        select coalesce(nullif(trim(vat_treatment), ''), 'No VAT treatment') vat_treatment_value, count(*) account_count
        from public.customer_commercial_source
        where (v_branch = 'all' or branch = v_branch)
        group by 1
        order by count(*) desc
        limit 12
      ) v
    ), '[]'::jsonb),
    'credit_days_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('credit_days', credit_days_value, 'account_count', account_count) order by account_count desc, credit_days_value)
      from (
        select coalesce(nullif(trim(credit_days), ''), 'No terms') credit_days_value, count(*) account_count
        from public.customer_commercial_source
        where (v_branch = 'all' or branch = v_branch)
        group by 1
        order by count(*) desc
        limit 12
      ) d
    ), '[]'::jsonb)
  ) into result
  from public.customer_commercial_source
  where (v_branch = 'all' or branch = v_branch);

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.search_finance_accounts(
  p_search text default null,
  p_branch text default 'all',
  p_credit_risk text default 'all',
  p_vat_filter text default 'all',
  p_debit_order text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  branch text,
  customer_code text,
  customer_name text,
  active_status text,
  credit_days text,
  credit_limit text,
  credit_limit_value numeric,
  vat_trn text,
  vat_treatment text,
  debit_order text,
  currency text,
  bill_to text,
  email text,
  phone text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'finance']::text[]);

  return query
  with filtered as (
    select c.*, public.customer_commercial_credit_limit(c.credit_limit) as credit_limit_value
    from public.customer_commercial_source c
    where (lower(coalesce(p_branch, 'all')) = 'all' or c.branch = lower(p_branch))
      and (lower(coalesce(p_credit_risk, 'all')) = 'all'
        or (lower(p_credit_risk) = 'missing_limit' and coalesce(public.customer_commercial_credit_limit(c.credit_limit), 0) = 0)
        or (lower(p_credit_risk) = 'high_limit' and coalesce(public.customer_commercial_credit_limit(c.credit_limit), 0) >= 50000)
        or (lower(p_credit_risk) = 'long_terms' and coalesce(public.customer_commercial_credit_days(c.credit_days), 0) >= 60))
      and (lower(coalesce(p_vat_filter, 'all')) = 'all'
        or (lower(p_vat_filter) = 'with_vat' and nullif(trim(coalesce(c.vat_trn, '')), '') is not null)
        or (lower(p_vat_filter) = 'missing_vat' and nullif(trim(coalesce(c.vat_trn, '')), '') is null))
      and (lower(coalesce(p_debit_order, 'all')) = 'all'
        or (lower(p_debit_order) = 'yes' and public.customer_commercial_is_yes(c.debit_order))
        or (lower(p_debit_order) = 'no' and not public.customer_commercial_is_yes(c.debit_order)))
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or c.customer_name ilike '%' || p_search || '%'
        or c.customer_code ilike '%' || p_search || '%'
        or c.vat_trn ilike '%' || p_search || '%'
        or c.vat_treatment ilike '%' || p_search || '%'
        or c.bill_to ilike '%' || p_search || '%'
        or c.email ilike '%' || p_search || '%'
        or c.phone ilike '%' || p_search || '%'
      )
  ), counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.branch,
    counted.customer_code,
    counted.customer_name,
    counted.active_status,
    counted.credit_days,
    counted.credit_limit,
    counted.credit_limit_value,
    counted.vat_trn,
    counted.vat_treatment,
    counted.debit_order,
    counted.currency,
    counted.bill_to,
    counted.email,
    counted.phone,
    counted.total_count
  from counted
  order by coalesce(counted.credit_limit_value, 0) desc, counted.customer_name nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

grant execute on function public.get_sales_workspace_summary(text, text) to authenticated;
grant execute on function public.search_contract_renewals(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.search_sales_opportunities(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.get_marketing_segment_summary(text) to authenticated;
grant execute on function public.search_marketing_segments(text, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.get_finance_workspace_summary(text) to authenticated;
grant execute on function public.search_finance_accounts(text, text, text, text, text, integer, integer) to authenticated;
