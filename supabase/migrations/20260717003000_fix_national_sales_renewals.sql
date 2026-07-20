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
language sql
security definer
set search_path = public
as $$
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
  where (lower(coalesce(p_branch, 'all')) in ('all', 'national') or src.branch = lower(p_branch))
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
)
select *, count(*) over () as total_count
from filtered
order by
  case renewal_window when 'overdue' then 0 when '30' then 1 when '60' then 2 when '90' then 3 when 'no_end' then 5 else 4 end,
  days_to_expire nulls last,
  customer_name
limit least(greatest(coalesce(p_limit, 100), 1), 500)
offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_sales_workspace_summary(p_branch text default 'all', p_salesman text default 'all')
returns jsonb
language sql
security definer
set search_path = public
as $$
with contracts as (
  select *
  from public.sales_contract_renewal_source
  where (lower(coalesce(p_branch, 'all')) in ('all', 'national') or branch = lower(p_branch))
    and (p_salesman = 'all' or coalesce(salesman, 'Unassigned') = p_salesman)
), opportunities as (
  select *
  from public.sales_opportunities
  where (lower(coalesce(p_branch, 'all')) in ('all', 'national') or branch = lower(p_branch))
), customers_filtered as (
  select *
  from public.customers
  where (lower(coalesce(p_branch, 'all')) in ('all', 'national') or branch = lower(p_branch))
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
);
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
language sql
security definer
set search_path = public
as $$
with filtered as (
  select so.*
  from public.sales_opportunities so
  where (lower(coalesce(p_branch, 'all')) in ('all', 'national') or so.branch = lower(p_branch))
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
)
select
  id,
  branch,
  customer_id,
  customer_code,
  customer_name,
  opportunity_type,
  status,
  priority,
  estimated_value,
  next_action_date,
  owner_name,
  notes,
  created_at,
  updated_at,
  count(*) over () as total_count
from filtered
order by
  case priority when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
  next_action_date nulls last,
  updated_at desc
limit least(greatest(coalesce(p_limit, 100), 1), 500)
offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.get_sales_workspace_summary(text, text) to authenticated;
grant execute on function public.search_contract_renewals(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.search_sales_opportunities(text, text, text, text, integer, integer) to authenticated;
