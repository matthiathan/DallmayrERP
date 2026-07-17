create extension if not exists pgcrypto;

create table if not exists public.stock_planning_policies (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  branch text not null default 'all' check (branch in ('all','jhb','cpt','kzn','national')),
  abc_class text not null default 'C' check (abc_class in ('A','B','C')),
  criticality text not null default 'medium' check (criticality in ('low','medium','high','critical')),
  stocking_policy text not null default 'stocked' check (stocking_policy in ('stocked','non_stocked','obsolete')),
  lead_time_days integer not null default 14 check (lead_time_days >= 0),
  safety_stock_days integer not null default 7 check (safety_stock_days >= 0),
  target_stock_days integer not null default 30 check (target_stock_days >= 0),
  min_stock integer check (min_stock is null or min_stock >= 0),
  max_stock integer check (max_stock is null or max_stock >= 0),
  preferred_supplier_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stock_item_id, branch)
);

create or replace function public.touch_stock_planning_policy_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists stock_planning_policies_touch_updated_at on public.stock_planning_policies;
create trigger stock_planning_policies_touch_updated_at
before update on public.stock_planning_policies
for each row execute function public.touch_stock_planning_policy_updated_at();

insert into public.stock_planning_policies (
  stock_item_id,
  branch,
  abc_class,
  criticality,
  stocking_policy,
  min_stock,
  max_stock,
  preferred_supplier_name
)
select
  si.id,
  'all',
  case
    when coalesce(si.unit_cost, 0) >= 1000 or coalesce(si.reorder_level, 0) >= 100 then 'A'
    when coalesce(si.unit_cost, 0) >= 250 or coalesce(si.reorder_level, 0) >= 25 then 'B'
    else 'C'
  end,
  case
    when lower(coalesce(si.category, '')) like '%spare%' or lower(coalesce(si.category, '')) like '%part%' then 'high'
    when coalesce(si.reorder_level, 0) > 0 then 'medium'
    else 'low'
  end,
  case when coalesce(si.is_active, true) then 'stocked' else 'obsolete' end,
  nullif(coalesce(si.reorder_level, 0), 0),
  case when coalesce(si.reorder_level, 0) > 0 then si.reorder_level * 4 else null end,
  si.supplier_name
from public.stock_items si
where not exists (
  select 1
  from public.stock_planning_policies spp
  where spp.stock_item_id = si.id and spp.branch = 'all'
);

create or replace view public.inventory_planning_recommendations as
with balance_by_branch as (
  select
    sb.stock_item_id,
    coalesce(nullif(w.branch, ''), 'national') as branch,
    sum(coalesce(sb.item_quantity, 0))::integer as current_quantity
  from public.stock_balances sb
  join public.stock_locations sl on sl.id = sb.location_id
  join public.warehouses w on w.id = sl.warehouse_id
  group by sb.stock_item_id, coalesce(nullif(w.branch, ''), 'national')
), legacy_balances as (
  select
    si.id as stock_item_id,
    coalesce(nullif(w.branch, ''), 'national') as branch,
    coalesce(si.item_quantity, 0)::integer as current_quantity
  from public.stock_items si
  left join public.warehouses w on w.id = si.default_warehouse_id
  where not exists (
    select 1 from public.stock_balances sb where sb.stock_item_id = si.id
  )
), item_branches as (
  select * from balance_by_branch
  union all
  select * from legacy_balances
), consumption_90 as (
  select
    im.stock_item_id,
    coalesce(nullif(im.branch, ''), 'national') as branch,
    sum(abs(coalesce(im.quantity, 0)))::numeric as consumed_90_days
  from public.inventory_movements im
  where im.created_at >= now() - interval '90 days'
    and (
      lower(coalesce(im.movement_type, '')) like '%issue%'
      or lower(coalesce(im.movement_type, '')) like '%consume%'
      or lower(coalesce(im.movement_type, '')) like '%delivery%'
      or lower(coalesce(im.movement_type, '')) like '%dispatch%'
      or lower(coalesce(im.movement_type, '')) like '%used%'
      or lower(coalesce(im.movement_type, '')) like '%adjust_down%'
      or lower(coalesce(im.movement_type, '')) like '%sale%'
      or lower(coalesce(im.movement_type, '')) like '%out%'
    )
  group by im.stock_item_id, coalesce(nullif(im.branch, ''), 'national')
), base as (
  select
    si.id as stock_item_id,
    si.stock_name,
    si.sku,
    si.category,
    coalesce(p_branch.preferred_supplier_name, p_all.preferred_supplier_name, si.supplier_name) as supplier_name,
    ib.branch,
    ib.current_quantity,
    coalesce(si.reorder_level, 0)::integer as reorder_level,
    coalesce(si.preferred_reorder_quantity, 0)::integer as preferred_reorder_quantity,
    coalesce(si.unit_cost, 0)::numeric as unit_cost,
    coalesce(si.track_stock, true) as track_stock,
    coalesce(p_branch.abc_class, p_all.abc_class,
      case
        when coalesce(si.unit_cost, 0) >= 1000 or coalesce(si.reorder_level, 0) >= 100 then 'A'
        when coalesce(si.unit_cost, 0) >= 250 or coalesce(si.reorder_level, 0) >= 25 then 'B'
        else 'C'
      end
    ) as abc_class,
    coalesce(p_branch.criticality, p_all.criticality,
      case
        when lower(coalesce(si.category, '')) like '%spare%' or lower(coalesce(si.category, '')) like '%part%' then 'high'
        when coalesce(si.reorder_level, 0) > 0 then 'medium'
        else 'low'
      end
    ) as criticality,
    coalesce(p_branch.stocking_policy, p_all.stocking_policy, case when coalesce(si.is_active, true) then 'stocked' else 'obsolete' end) as stocking_policy,
    coalesce(p_branch.lead_time_days, p_all.lead_time_days, 14)::integer as lead_time_days,
    coalesce(p_branch.safety_stock_days, p_all.safety_stock_days, 7)::integer as safety_stock_days,
    coalesce(p_branch.target_stock_days, p_all.target_stock_days, 30)::integer as target_stock_days,
    coalesce(p_branch.min_stock, p_all.min_stock, nullif(coalesce(si.reorder_level, 0), 0), 0)::integer as min_stock,
    coalesce(p_branch.max_stock, p_all.max_stock) as max_stock,
    round(coalesce(c90.consumed_90_days, 0) / 90.0, 2) as avg_daily_demand
  from public.stock_items si
  join item_branches ib on ib.stock_item_id = si.id
  left join consumption_90 c90 on c90.stock_item_id = si.id and c90.branch = ib.branch
  left join public.stock_planning_policies p_branch on p_branch.stock_item_id = si.id and p_branch.branch = ib.branch
  left join public.stock_planning_policies p_all on p_all.stock_item_id = si.id and p_all.branch = 'all'
), calculated as (
  select
    b.*,
    case when b.avg_daily_demand > 0 then round(b.current_quantity::numeric / b.avg_daily_demand, 1) else null end as days_on_hand,
    greatest(
      coalesce(b.max_stock, 0),
      coalesce(b.preferred_reorder_quantity, 0),
      ceil(b.avg_daily_demand * greatest(b.target_stock_days, 0))::integer,
      coalesce(b.reorder_level, 0) * 2,
      coalesce(b.min_stock, 0)
    )::integer as target_stock
  from base b
), classified as (
  select
    c.*,
    case
      when not c.track_stock then 'not_tracked'
      when c.stocking_policy = 'obsolete' and c.current_quantity > 0 then 'obsolete_stock'
      when c.stocking_policy = 'non_stocked' and c.current_quantity > 0 and c.avg_daily_demand = 0 then 'non_stock_holding'
      when c.current_quantity <= 0 and c.stocking_policy <> 'obsolete' then 'stockout'
      when c.current_quantity <= c.min_stock and c.stocking_policy = 'stocked' then 'below_reorder'
      when c.avg_daily_demand > 0 and (c.current_quantity::numeric / nullif(c.avg_daily_demand, 0)) <= (c.lead_time_days + c.safety_stock_days) and c.stocking_policy = 'stocked' then 'stockout_risk'
      when c.max_stock is not null and c.current_quantity > c.max_stock then 'excess_stock'
      when c.avg_daily_demand = 0 and c.current_quantity > greatest(c.reorder_level, c.min_stock, 0) then 'no_recent_demand'
      else 'healthy'
    end as exception_type
  from calculated c
)
select
  stock_item_id,
  stock_name,
  sku,
  category,
  supplier_name,
  branch,
  current_quantity,
  reorder_level,
  min_stock,
  max_stock,
  safety_stock_days,
  target_stock_days,
  lead_time_days,
  abc_class,
  criticality,
  stocking_policy,
  avg_daily_demand,
  days_on_hand,
  target_stock,
  case
    when exception_type in ('stockout','below_reorder','stockout_risk') then greatest(target_stock - current_quantity, preferred_reorder_quantity, 0)
    else 0
  end::integer as recommended_order_quantity,
  case
    when avg_daily_demand > 0 then (current_date + ceil(current_quantity::numeric / avg_daily_demand)::integer)
    else null
  end as projected_stockout_date,
  exception_type,
  case exception_type
    when 'not_tracked' then 'Item is not tracked for stock quantity.'
    when 'obsolete_stock' then 'Obsolete item still has stock on hand.'
    when 'non_stock_holding' then 'Non-stocked item has stock and no recent demand.'
    when 'stockout' then 'On-hand quantity is zero or negative.'
    when 'below_reorder' then 'On-hand quantity is at or below the reorder trigger.'
    when 'stockout_risk' then 'Projected days on hand is inside lead-time plus safety-stock cover.'
    when 'excess_stock' then 'On-hand quantity is above the configured maximum stock level.'
    when 'no_recent_demand' then 'Stock exists but there has been no recent outbound demand.'
    else 'No immediate planning exception.'
  end as exception_reason,
  unit_cost,
  (current_quantity * unit_cost)::numeric as stock_value,
  (case when exception_type in ('stockout','below_reorder','stockout_risk') then greatest(target_stock - current_quantity, preferred_reorder_quantity, 0) else 0 end * unit_cost)::numeric as recommended_order_value
from classified;

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
language sql
security definer
set search_path = public
as $$
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
  select f.*, count(*) over() as total_count
  from filtered f
)
select
  stock_item_id,
  stock_name,
  sku,
  category,
  supplier_name,
  branch,
  current_quantity,
  reorder_level,
  min_stock,
  max_stock,
  safety_stock_days,
  target_stock_days,
  lead_time_days,
  abc_class,
  criticality,
  stocking_policy,
  avg_daily_demand,
  days_on_hand,
  target_stock,
  recommended_order_quantity,
  projected_stockout_date,
  exception_type,
  exception_reason,
  unit_cost,
  stock_value,
  recommended_order_value,
  total_count
from counted
order by
  case exception_type
    when 'stockout' then 1
    when 'stockout_risk' then 2
    when 'below_reorder' then 3
    when 'excess_stock' then 4
    when 'obsolete_stock' then 5
    when 'no_recent_demand' then 6
    else 9
  end,
  recommended_order_value desc,
  stock_name
limit greatest(1, least(coalesce(p_limit, 50), 500))
offset greatest(0, coalesce(p_offset, 0));
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
language sql
security definer
set search_path = public
as $$
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
    s.stock_item_id,
    s.stock_name,
    s.sku,
    s.category,
    x.branch as source_branch,
    s.branch as destination_branch,
    x.current_quantity as source_quantity,
    s.current_quantity as destination_quantity,
    s.recommended_order_quantity as destination_recommended_order,
    least(x.surplus_quantity, s.recommended_order_quantity)::integer as transferable_quantity,
    'Move surplus before buying new stock.'::text as reason
  from shortages s
  join surplus x on x.stock_item_id = s.stock_item_id and x.branch <> s.branch
  where x.surplus_quantity > 0
), counted as (
  select m.*, count(*) over() as total_count
  from matches m
)
select *
from counted
where transferable_quantity > 0
order by transferable_quantity desc, stock_name
limit greatest(1, least(coalesce(p_limit, 50), 500))
offset greatest(0, coalesce(p_offset, 0));
$$;

do $$
begin
  alter table public.stock_planning_policies enable row level security;
exception when others then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_planning_policies' and policyname = 'stock_planning_policies_select') then
    create policy stock_planning_policies_select on public.stock_planning_policies for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_planning_policies' and policyname = 'stock_planning_policies_manage') then
    create policy stock_planning_policies_manage on public.stock_planning_policies for all to authenticated using (public.current_app_role() in ('admin','operations','warehouse_staff')) with check (public.current_app_role() in ('admin','operations','warehouse_staff'));
  end if;
exception when undefined_function then
  null;
end $$;

grant select on public.stock_planning_policies to authenticated;
grant select on public.inventory_planning_recommendations to authenticated;
grant execute on function public.get_inventory_planning_summary(text) to authenticated;
grant execute on function public.search_inventory_recommendations(text, text, text, text, integer, integer) to authenticated;
grant execute on function public.search_inventory_transfer_suggestions(text, integer, integer) to authenticated;
