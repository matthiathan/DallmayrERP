create or replace function public.safe_sales_int(p_value text)
returns integer
language sql
immutable
as $$
  select case
    when nullif(regexp_replace(coalesce(p_value, ''), '[^0-9\-]', '', 'g'), '') is null then null
    else nullif(regexp_replace(coalesce(p_value, ''), '[^0-9\-]', '', 'g'), '')::integer
  end;
$$;

create or replace view public.sales_contract_renewal_source as
select
  'jhb'::text as branch,
  nullif(trim("Contract Number"), '') as contract_number,
  nullif(trim("Customer Code"), '') as customer_code,
  nullif(trim("Customer Name"), '') as customer_name,
  nullif(trim("Start Date"), '') as start_date_text,
  nullif(trim("End Date"), '') as end_date_text,
  public.safe_sales_int("DAYS TO EXPIRE") as days_to_expire,
  nullif(trim("Agrement Type"), '') as agreement_type,
  nullif(trim("Salesman"), '') as salesman,
  public.safe_sales_int("Machine Count") as machine_count,
  nullif(trim("Contract Document"), '') as contract_document,
  nullif(trim("Doc#"), '') as document_number,
  nullif(trim("JOB#"), '') as job_number
from public.contract_agreement_jhb
union all
select
  'cpt'::text as branch,
  nullif(trim("Contract Number"), '') as contract_number,
  nullif(trim("Customer Code"), '') as customer_code,
  nullif(trim("Customer Name"), '') as customer_name,
  nullif(trim("Start Date"), '') as start_date_text,
  nullif(trim("End Date"), '') as end_date_text,
  public.safe_sales_int("DAYS TO EXPIRE") as days_to_expire,
  nullif(trim("Agrement Type"), '') as agreement_type,
  nullif(trim("Salesman"), '') as salesman,
  public.safe_sales_int("Machine Count") as machine_count,
  nullif(trim("Contract Document"), '') as contract_document,
  nullif(trim("Doc#"), '') as document_number,
  nullif(trim("JOB#"), '') as job_number
from public.contract_agreement_cpt
union all
select
  'kzn'::text as branch,
  nullif(trim("Contract Number"), '') as contract_number,
  nullif(trim("Customer Code"), '') as customer_code,
  nullif(trim("Customer Name"), '') as customer_name,
  nullif(trim("Start Date"), '') as start_date_text,
  nullif(trim("End Date"), '') as end_date_text,
  public.safe_sales_int("DAYS TO EXPIRE") as days_to_expire,
  nullif(trim("Agrement Type"), '') as agreement_type,
  nullif(trim("Salesman"), '') as salesman,
  public.safe_sales_int("Machine Count") as machine_count,
  nullif(trim("Contract Document"), '') as contract_document,
  nullif(trim("Doc#"), '') as document_number,
  nullif(trim("JOB#"), '') as job_number
from public.contract_agreement_kzn;

create table if not exists public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  branch text not null default 'jhb' check (branch in ('jhb', 'cpt', 'kzn', 'national')),
  customer_id uuid references public.customers(id) on delete set null,
  customer_code text,
  customer_name text not null,
  opportunity_type text not null default 'upgrade' check (opportunity_type in ('upgrade', 'new_machine', 'reactivation', 'renewal', 'other')),
  status text not null default 'open' check (status in ('open', 'follow_up', 'quoted', 'won', 'lost', 'cancelled')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  estimated_value numeric,
  next_action_date date,
  owner_name text,
  notes text,
  source text not null default 'manual',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sales_opportunities_branch on public.sales_opportunities(branch);
create index if not exists idx_sales_opportunities_status on public.sales_opportunities(status);
create index if not exists idx_sales_opportunities_type on public.sales_opportunities(opportunity_type);
create index if not exists idx_sales_opportunities_customer on public.sales_opportunities(customer_id);

create or replace function public.touch_sales_opportunity_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_sales_opportunities on public.sales_opportunities;
create trigger trg_touch_sales_opportunities
before update on public.sales_opportunities
for each row execute function public.touch_sales_opportunity_updated_at();

alter table public.sales_opportunities enable row level security;

drop policy if exists sales_opportunities_read on public.sales_opportunities;
create policy sales_opportunities_read on public.sales_opportunities
for select to authenticated using (true);

drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities
for insert to authenticated with check (true);

drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities
for update to authenticated using (true) with check (true);

drop policy if exists sales_opportunities_delete on public.sales_opportunities;
create policy sales_opportunities_delete on public.sales_opportunities
for delete to authenticated using (true);

grant select on public.sales_contract_renewal_source to authenticated;
grant select, insert, update, delete on public.sales_opportunities to authenticated;

create or replace function public.sales_renewal_window(p_days integer)
returns text
language sql
immutable
as $$
  select case
    when p_days is null then 'no_end'
    when p_days < 0 then 'overdue'
    when p_days <= 30 then '30'
    when p_days <= 60 then '60'
    when p_days <= 90 then '90'
    else 'later'
  end;
$$;

create or replace function public.get_sales_workspace_summary(
  p_branch text default 'all',
  p_salesman text default 'all'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
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
);
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
