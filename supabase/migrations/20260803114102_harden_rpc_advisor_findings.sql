-- Follow-up production hardening from Supabase security advisors.

create or replace function public.search_finance_accounts(
  p_search text default null,
  p_branch text default 'all',
  p_credit_risk text default 'all',
  p_vat_filter text default 'all',
  p_debit_order text default 'all',
  p_offset integer default 0,
  p_limit integer default 50,
  p_column_filters jsonb default '{}'::jsonb
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
  with params as (
    select
      nullif(lower(trim(coalesce(p_column_filters ->> 'customer', ''))), '') as customer_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'code', ''))), '') as code_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'branch', ''))), '') as branch_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'status', ''))), '') as status_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'terms', ''))), '') as terms_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'limit', ''))), '') as limit_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'vat', ''))), '') as vat_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'debit', ''))), '') as debit_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'bill', ''))), '') as bill_filter,
      nullif(lower(trim(coalesce(p_column_filters ->> 'contact', ''))), '') as contact_filter
  ), source as (
    select c.*, public.customer_commercial_credit_limit(c.credit_limit) as parsed_credit_limit
    from public.customer_commercial_source c
  ), filtered as (
    select s.*
    from source s
    cross join params f
    where (lower(coalesce(p_branch, 'all')) = 'all' or s.branch = lower(p_branch))
      and (
        lower(coalesce(p_credit_risk, 'all')) = 'all'
        or (lower(p_credit_risk) = 'missing_limit' and coalesce(s.parsed_credit_limit, 0) = 0)
        or (lower(p_credit_risk) = 'high_limit' and coalesce(s.parsed_credit_limit, 0) >= 50000)
        or (lower(p_credit_risk) = 'long_terms' and coalesce(public.customer_commercial_credit_days(s.credit_days), 0) >= 60)
      )
      and (
        lower(coalesce(p_vat_filter, 'all')) = 'all'
        or (lower(p_vat_filter) = 'with_vat' and nullif(trim(coalesce(s.vat_trn, '')), '') is not null)
        or (lower(p_vat_filter) = 'missing_vat' and nullif(trim(coalesce(s.vat_trn, '')), '') is null)
      )
      and (
        lower(coalesce(p_debit_order, 'all')) = 'all'
        or (lower(p_debit_order) = 'yes' and public.customer_commercial_is_yes(s.debit_order))
        or (lower(p_debit_order) = 'no' and not public.customer_commercial_is_yes(s.debit_order))
      )
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or strpos(lower(coalesce(s.customer_name, '')), lower(trim(p_search))) > 0
        or strpos(lower(coalesce(s.customer_code, '')), lower(trim(p_search))) > 0
        or strpos(lower(coalesce(s.vat_trn, '')), lower(trim(p_search))) > 0
        or strpos(lower(coalesce(s.vat_treatment, '')), lower(trim(p_search))) > 0
        or strpos(lower(coalesce(s.bill_to, '')), lower(trim(p_search))) > 0
        or strpos(lower(coalesce(s.email, '')), lower(trim(p_search))) > 0
        or strpos(lower(coalesce(s.phone, '')), lower(trim(p_search))) > 0
      )
      and (f.customer_filter is null or strpos(lower(coalesce(s.customer_name, '')), f.customer_filter) > 0)
      and (f.code_filter is null or strpos(lower(coalesce(s.customer_code, '')), f.code_filter) > 0)
      and (f.branch_filter is null or strpos(lower(coalesce(s.branch, '')), f.branch_filter) > 0)
      and (f.status_filter is null or strpos(lower(coalesce(s.active_status, '')), f.status_filter) > 0)
      and (f.terms_filter is null or strpos(lower(coalesce(s.credit_days, '')), f.terms_filter) > 0)
      and (
        f.limit_filter is null
        or strpos(lower(coalesce(s.credit_limit, '')), f.limit_filter) > 0
        or strpos(lower(coalesce(s.parsed_credit_limit::text, '')), f.limit_filter) > 0
      )
      and (
        f.vat_filter is null
        or strpos(lower(coalesce(s.vat_trn, '')), f.vat_filter) > 0
        or strpos(lower(coalesce(s.vat_treatment, '')), f.vat_filter) > 0
      )
      and (f.debit_filter is null or strpos(lower(coalesce(s.debit_order, '')), f.debit_filter) > 0)
      and (f.bill_filter is null or strpos(lower(coalesce(s.bill_to, '')), f.bill_filter) > 0)
      and (
        f.contact_filter is null
        or strpos(lower(coalesce(s.email, '')), f.contact_filter) > 0
        or strpos(lower(coalesce(s.phone, '')), f.contact_filter) > 0
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
    counted.parsed_credit_limit as credit_limit_value,
    counted.vat_trn,
    counted.vat_treatment,
    counted.debit_order,
    counted.currency,
    counted.bill_to,
    counted.email,
    counted.phone,
    counted.total_count
  from counted
  order by coalesce(counted.parsed_credit_limit, 0) desc, counted.customer_name nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

grant execute on function public.search_finance_accounts(text, text, text, text, text, integer, integer, jsonb) to authenticated;

do $$
begin
  if to_regclass('public.inventory_planning_recommendations') is not null then
    alter view public.inventory_planning_recommendations set (security_invoker = true);
    revoke all on table public.inventory_planning_recommendations from anon, public;
    revoke select on table public.inventory_planning_recommendations from authenticated;
  end if;
end $$;

create or replace function public.get_inventory_planning_summary(p_branch text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch text := lower(coalesce(p_branch, 'all'));
  result jsonb;
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'warehouse_staff', 'finance']::text[]);

  select jsonb_build_object(
    'item_locations', count(*),
    'stockout_count', count(*) filter (where exception_type = 'stockout'),
    'below_reorder_count', count(*) filter (where exception_type = 'below_reorder'),
    'stockout_risk_count', count(*) filter (where exception_type = 'stockout_risk'),
    'excess_stock_count', count(*) filter (where exception_type = 'excess_stock'),
    'obsolete_stock_count', count(*) filter (where exception_type = 'obsolete_stock'),
    'no_recent_demand_count', count(*) filter (where exception_type = 'no_recent_demand'),
    'healthy_count', count(*) filter (where exception_type = 'healthy'),
    'recommended_order_units', coalesce(sum(recommended_order_quantity), 0),
    'recommended_order_value', coalesce(sum(recommended_order_value), 0),
    'stock_value', coalesce(sum(stock_value), 0),
    'abc_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('abc_class', abc_class, 'item_count', item_count) order by abc_class)
      from (
        select abc_class, count(*) item_count
        from public.inventory_planning_recommendations
        where (v_branch = 'all' or branch = v_branch)
        group by abc_class
      ) b
    ), '[]'::jsonb),
    'exception_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('exception_type', exception_type, 'item_count', item_count) order by item_count desc, exception_type)
      from (
        select exception_type, count(*) item_count
        from public.inventory_planning_recommendations
        where (v_branch = 'all' or branch = v_branch)
        group by exception_type
      ) e
    ), '[]'::jsonb)
  ) into result
  from public.inventory_planning_recommendations
  where (v_branch = 'all' or branch = v_branch);

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.search_inventory_recommendations(
  p_search text default null,
  p_branch text default 'all',
  p_exception text default 'all',
  p_abc_class text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  stock_item_id uuid,
  stock_name text,
  sku text,
  category text,
  supplier_name text,
  branch text,
  current_quantity integer,
  reorder_level integer,
  min_stock integer,
  max_stock integer,
  safety_stock_days integer,
  target_stock_days integer,
  lead_time_days integer,
  abc_class text,
  criticality text,
  stocking_policy text,
  avg_daily_demand numeric,
  days_on_hand numeric,
  target_stock integer,
  recommended_order_quantity integer,
  projected_stockout_date date,
  exception_type text,
  exception_reason text,
  unit_cost numeric,
  stock_value numeric,
  recommended_order_value numeric,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'warehouse_staff', 'finance']::text[]);

  return query
  with filtered as (
    select r.*
    from public.inventory_planning_recommendations r
    where (lower(coalesce(p_branch, 'all')) = 'all' or r.branch = lower(p_branch))
      and (lower(coalesce(p_exception, 'all')) = 'all' or r.exception_type = lower(p_exception))
      and (upper(coalesce(p_abc_class, 'all')) = 'ALL' or r.abc_class = upper(p_abc_class))
      and (
        nullif(trim(coalesce(p_search, '')), '') is null
        or r.stock_name ilike '%' || p_search || '%'
        or r.sku ilike '%' || p_search || '%'
        or r.category ilike '%' || p_search || '%'
        or r.supplier_name ilike '%' || p_search || '%'
        or r.exception_type ilike '%' || p_search || '%'
      )
  ), counted as (
    select filtered.*, count(*) over () as total_count
    from filtered
  )
  select
    counted.stock_item_id,
    counted.stock_name,
    counted.sku,
    counted.category,
    counted.supplier_name,
    counted.branch,
    counted.current_quantity,
    counted.reorder_level,
    counted.min_stock,
    counted.max_stock,
    counted.safety_stock_days,
    counted.target_stock_days,
    counted.lead_time_days,
    counted.abc_class,
    counted.criticality,
    counted.stocking_policy,
    counted.avg_daily_demand,
    counted.days_on_hand,
    counted.target_stock,
    counted.recommended_order_quantity,
    counted.projected_stockout_date,
    counted.exception_type,
    counted.exception_reason,
    counted.unit_cost,
    counted.stock_value,
    counted.recommended_order_value,
    counted.total_count
  from counted
  order by
    case counted.exception_type
      when 'stockout' then 1
      when 'stockout_risk' then 2
      when 'below_reorder' then 3
      when 'excess_stock' then 4
      when 'obsolete' then 5
      when 'obsolete_stock' then 5
      when 'no_recent_demand' then 6
      else 9
    end,
    counted.recommended_order_value desc,
    counted.stock_name
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

create or replace function public.search_inventory_transfer_suggestions(
  p_branch text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns table (
  stock_item_id uuid,
  stock_name text,
  sku text,
  category text,
  source_branch text,
  destination_branch text,
  source_quantity integer,
  destination_quantity integer,
  destination_recommended_order integer,
  transferable_quantity integer,
  reason text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_app_role(array['admin', 'executive', 'operations', 'warehouse_staff', 'finance']::text[]);

  return query
  with shortages as (
    select *
    from public.inventory_planning_recommendations
    where exception_type in ('stockout','stockout_risk','below_reorder')
      and recommended_order_quantity > 0
      and (lower(coalesce(p_branch, 'all')) = 'all' or branch = lower(p_branch))
  ), surplus as (
    select
      *,
      greatest(
        current_quantity - greatest(coalesce(max_stock, 0), reorder_level, min_stock, 0),
        case when exception_type in ('excess_stock','no_recent_demand','obsolete_stock') then current_quantity - greatest(reorder_level, min_stock, 0) else 0 end,
        0
      )::integer as surplus_quantity
    from public.inventory_planning_recommendations
    where exception_type in ('excess_stock','no_recent_demand','obsolete_stock','healthy')
  ), matches as (
    select
      shortages.stock_item_id,
      shortages.stock_name,
      shortages.sku,
      shortages.category,
      surplus.branch as source_branch,
      shortages.branch as destination_branch,
      surplus.current_quantity as source_quantity,
      shortages.current_quantity as destination_quantity,
      shortages.recommended_order_quantity as destination_recommended_order,
      least(surplus.surplus_quantity, shortages.recommended_order_quantity)::integer as transferable_quantity,
      'Move surplus before buying new stock.'::text as reason
    from shortages
    join surplus on surplus.stock_item_id = shortages.stock_item_id and surplus.branch <> shortages.branch
    where surplus.surplus_quantity > 0
  ), counted as (
    select matches.*, count(*) over () as total_count
    from matches
  )
  select
    counted.stock_item_id,
    counted.stock_name,
    counted.sku,
    counted.category,
    counted.source_branch,
    counted.destination_branch,
    counted.source_quantity,
    counted.destination_quantity,
    counted.destination_recommended_order,
    counted.transferable_quantity,
    counted.reason,
    counted.total_count
  from counted
  where counted.transferable_quantity > 0
  order by counted.transferable_quantity desc, counted.stock_name
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

grant execute on function public.get_inventory_planning_summary(text) to authenticated;
grant execute on function public.search_inventory_recommendations(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.search_inventory_transfer_suggestions(text, integer, integer) to authenticated;

do $$
declare
  routine record;
begin
  for routine in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %I.%I(%s) from anon, public', routine.nspname, routine.proname, routine.args);
    execute format('grant execute on function %I.%I(%s) to authenticated', routine.nspname, routine.proname, routine.args);
  end loop;
end $$;

do $$
declare
  routine record;
begin
  for routine in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
  loop
    execute format('alter function %I.%I(%s) set search_path = public', routine.nspname, routine.proname, routine.args);
  end loop;
end $$;

do $$
declare
  locked_table record;
begin
  for locked_table in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and c.relrowsecurity
      and n.nspname in ('public', 'dallmayrerp_uploads')
      and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
  loop
    execute format(
      'create policy direct_access_denied on %I.%I for all to anon, authenticated using (false) with check (false)',
      locked_table.nspname,
      locked_table.relname
    );
  end loop;
end $$;
