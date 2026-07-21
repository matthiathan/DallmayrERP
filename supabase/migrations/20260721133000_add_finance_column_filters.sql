drop function if exists public.search_finance_accounts(text, text, text, text, text, integer, integer);

create function public.search_finance_accounts(
  p_search text default null,
  p_branch text default 'all',
  p_credit_risk text default 'all',
  p_vat_filter text default 'all',
  p_debit_order text default 'all',
  p_offset integer default 0,
  p_limit integer default 50,
  p_column_filters jsonb default '{}'::jsonb
)
returns table(
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
),
source as (
  select c.*, customer_commercial_credit_limit(c.credit_limit) as parsed_credit_limit
  from public.customer_commercial_source c
),
filtered as (
  select s.*
  from source s
  cross join params f
  where (lower(coalesce(p_branch, 'all')) = 'all' or s.branch = lower(p_branch))
    and (
      lower(coalesce(p_credit_risk, 'all')) = 'all'
      or (lower(p_credit_risk) = 'missing_limit' and coalesce(s.parsed_credit_limit, 0) = 0)
      or (lower(p_credit_risk) = 'high_limit' and coalesce(s.parsed_credit_limit, 0) >= 50000)
      or (lower(p_credit_risk) = 'long_terms' and coalesce(customer_commercial_credit_days(s.credit_days), 0) >= 60)
    )
    and (
      lower(coalesce(p_vat_filter, 'all')) = 'all'
      or (lower(p_vat_filter) = 'with_vat' and nullif(trim(coalesce(s.vat_trn, '')), '') is not null)
      or (lower(p_vat_filter) = 'missing_vat' and nullif(trim(coalesce(s.vat_trn, '')), '') is null)
    )
    and (
      lower(coalesce(p_debit_order, 'all')) = 'all'
      or (lower(p_debit_order) = 'yes' and customer_commercial_is_yes(s.debit_order))
      or (lower(p_debit_order) = 'no' and not customer_commercial_is_yes(s.debit_order))
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
),
counted as (
  select f.*, count(*) over() as total_count
  from filtered f
)
select
  branch,
  customer_code,
  customer_name,
  active_status,
  credit_days,
  credit_limit,
  parsed_credit_limit as credit_limit_value,
  vat_trn,
  vat_treatment,
  debit_order,
  currency,
  bill_to,
  email,
  phone,
  total_count
from counted
order by coalesce(parsed_credit_limit, 0) desc, customer_name nulls last
limit greatest(1, least(coalesce(p_limit, 50), 500))
offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_finance_accounts(text, text, text, text, text, integer, integer, jsonb) from public;
grant execute on function public.search_finance_accounts(text, text, text, text, text, integer, integer, jsonb) to authenticated;
