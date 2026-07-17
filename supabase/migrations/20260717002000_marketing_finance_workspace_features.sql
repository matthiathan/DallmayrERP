create or replace view public.customer_commercial_source as
select
  'jhb'::text as branch,
  "A/C Code" as customer_code,
  "Customer Name" as customer_name,
  "Service Days" as service_days,
  "MACHINE MAPPED" as machine_mapped,
  "Last CA#" as last_contract_number,
  "Last CA Type" as last_contract_type,
  "Ship To" as ship_to,
  "VAT TRN" as vat_trn,
  "Sales Man" as sales_man,
  "Active?" as active_status,
  "Email-1" as email,
  "VAT Treatment" as vat_treatment,
  "Short Name" as short_name,
  "Credit Days" as credit_days,
  "Credit Limit" as credit_limit,
  "Currency" as currency,
  "Telephone-1" as phone,
  "Category" as category,
  "Mobile No." as mobile_no,
  "Area" as area,
  "Airport?" as airport,
  "Discount Type" as discount_type,
  "Group 2" as group_2,
  "ACC_GRP3_DESC" as acc_group_3,
  "ACC_GRP5_DESC" as acc_group_5,
  "ACC_GRP6_DESC" as acc_group_6,
  "Bill To" as bill_to,
  "Debit Order" as debit_order
from public.customer_master_jhb
union all
select
  'cpt'::text,
  "A/C Code", "Customer Name", "Service Days", "MACHINE MAPPED", "Last CA#", "Last CA Type", "Ship To", "VAT TRN", "Sales Man", "Active?", "Email-1", "VAT Treatment", "Short Name", "Credit Days", "Credit Limit", "Currency", "Telephone-1", "Category", "Mobile No.", "Area", "Airport?", "Discount Type", "Group 2", "ACC_GRP3_DESC", "ACC_GRP5_DESC", "ACC_GRP6_DESC", "Bill To", "Debit Order"
from public.customer_master_cpt
union all
select
  'kzn'::text,
  "A/C Code", "Customer Name", "Service Days", "MACHINE MAPPED", "Last CA#", "Last CA Type", "Ship To", "VAT TRN", "Sales Man", "Active?", "Email-1", "VAT Treatment", "Short Name", "Credit Days", "Credit Limit", "Currency", "Telephone-1", "Category", "Mobile No.", "Area", "Airport?", "Discount Type", "Group 2", "ACC_GRP3_DESC", "ACC_GRP5_DESC", "ACC_GRP6_DESC", "Bill To", "Debit Order"
from public.customer_master_kzn;

create or replace function public.customer_commercial_credit_limit(p_value text)
returns numeric
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9\.-]', '', 'g'), '')::numeric;
$$;

create or replace function public.customer_commercial_credit_days(p_value text)
returns integer
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9-]', '', 'g'), '')::integer;
$$;

create or replace function public.customer_commercial_is_yes(p_value text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(p_value, ''))) in ('y','yes','true','1','active','mapped');
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
  select jsonb_build_object(
    'customer_count', count(*),
    'active_customers', count(*) filter (where lower(coalesce(active_status, '')) in ('y','yes','active','true','1')),
    'inactive_customers', count(*) filter (where lower(coalesce(active_status, '')) not in ('y','yes','active','true','1')),
    'with_machines', count(*) filter (where customer_commercial_is_yes(machine_mapped)),
    'without_machines', count(*) filter (where not customer_commercial_is_yes(machine_mapped)),
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
language sql
security definer
set search_path = public
as $$
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
  select f.*, count(*) over() as total_count
  from filtered f
)
select branch, customer_code, customer_name, category, area, sales_man, active_status, machine_mapped, service_days, last_contract_number, last_contract_type, email, phone, total_count
from counted
order by customer_name nulls last, customer_code nulls last
limit greatest(1, least(coalesce(p_limit, 50), 500))
offset greatest(0, coalesce(p_offset, 0));
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
  select jsonb_build_object(
    'account_count', count(*),
    'active_accounts', count(*) filter (where lower(coalesce(active_status, '')) in ('y','yes','active','true','1')),
    'with_credit_limit', count(*) filter (where customer_commercial_credit_limit(credit_limit) is not null and customer_commercial_credit_limit(credit_limit) > 0),
    'without_credit_limit', count(*) filter (where coalesce(customer_commercial_credit_limit(credit_limit), 0) = 0),
    'high_credit_accounts', count(*) filter (where coalesce(customer_commercial_credit_limit(credit_limit), 0) >= 50000),
    'credit_exposure', coalesce(sum(coalesce(customer_commercial_credit_limit(credit_limit), 0)), 0),
    'with_vat_trn', count(*) filter (where nullif(trim(coalesce(vat_trn, '')), '') is not null),
    'without_vat_trn', count(*) filter (where nullif(trim(coalesce(vat_trn, '')), '') is null),
    'debit_order_accounts', count(*) filter (where customer_commercial_is_yes(debit_order)),
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
language sql
security definer
set search_path = public
as $$
with filtered as (
  select c.*, customer_commercial_credit_limit(c.credit_limit) as credit_limit_value
  from public.customer_commercial_source c
  where (lower(coalesce(p_branch, 'all')) = 'all' or c.branch = lower(p_branch))
    and (lower(coalesce(p_credit_risk, 'all')) = 'all'
      or (lower(p_credit_risk) = 'missing_limit' and coalesce(customer_commercial_credit_limit(c.credit_limit), 0) = 0)
      or (lower(p_credit_risk) = 'high_limit' and coalesce(customer_commercial_credit_limit(c.credit_limit), 0) >= 50000)
      or (lower(p_credit_risk) = 'long_terms' and coalesce(customer_commercial_credit_days(c.credit_days), 0) >= 60))
    and (lower(coalesce(p_vat_filter, 'all')) = 'all'
      or (lower(p_vat_filter) = 'with_vat' and nullif(trim(coalesce(c.vat_trn, '')), '') is not null)
      or (lower(p_vat_filter) = 'missing_vat' and nullif(trim(coalesce(c.vat_trn, '')), '') is null))
    and (lower(coalesce(p_debit_order, 'all')) = 'all'
      or (lower(p_debit_order) = 'yes' and customer_commercial_is_yes(c.debit_order))
      or (lower(p_debit_order) = 'no' and not customer_commercial_is_yes(c.debit_order)))
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
  select f.*, count(*) over() as total_count
  from filtered f
)
select branch, customer_code, customer_name, active_status, credit_days, credit_limit, credit_limit_value, vat_trn, vat_treatment, debit_order, currency, bill_to, email, phone, total_count
from counted
order by coalesce(credit_limit_value, 0) desc, customer_name nulls last
limit greatest(1, least(coalesce(p_limit, 50), 500))
offset greatest(0, coalesce(p_offset, 0));
$$;

grant select on public.customer_commercial_source to authenticated;
grant execute on function public.get_marketing_segment_summary(text) to authenticated;
grant execute on function public.search_marketing_segments(text, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.get_finance_workspace_summary(text) to authenticated;
grant execute on function public.search_finance_accounts(text, text, text, text, text, integer, integer) to authenticated;
