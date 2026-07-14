-- DallmayrERP application support tables and RLS policies
-- Project: DallmayrERP
-- Ref: egbiiizxsqlarqpnzxxs

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  campaign_type text not null check (campaign_type in ('contract_renewal', 'new_product', 'machine_upgrade', 'service_follow_up', 'customer_reactivation', 'seasonal_campaign')),
  target_segment text,
  branch text check (branch is null or branch in ('jhb', 'cpt', 'kzn', 'national')),
  start_date date,
  end_date date,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  owner_id uuid references public.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_segments (
  id uuid primary key default gen_random_uuid(),
  segment_name text not null unique,
  description text,
  criteria_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_campaign_customers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  customer_code text,
  customer_name text not null,
  branch text check (branch is null or branch in ('jhb', 'cpt', 'kzn', 'national')),
  email text,
  phone_number text,
  status text not null default 'targeted' check (status in ('targeted', 'contacted', 'interested', 'not_interested', 'converted', 'removed')),
  last_contacted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_activities (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.marketing_campaigns(id) on delete cascade,
  customer_code text,
  activity_type text not null check (activity_type in ('call', 'email', 'meeting', 'note', 'campaign_update', 'follow_up')),
  activity_date timestamptz not null default now(),
  outcome text,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_segments enable row level security;
alter table public.marketing_campaign_customers enable row level security;
alter table public.marketing_activities enable row level security;

-- Authenticated app users can read raw source data for dashboards.
do $$
declare
  t text;
begin
  foreach t in array array[
    'contract_agreement_kzn', 'contract_agreement_cpt', 'contract_agreement_jhb',
    'customer_master_kzn', 'customer_master_cpt', 'customer_master_jhb',
    'service_call_log_kzn', 'preventive_service_log_cpt', 'service_call_log_jhb',
    'fixed_assets', 'stock_items', 'users',
    'marketing_campaigns', 'marketing_segments', 'marketing_campaign_customers', 'marketing_activities'
  ] loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'authenticated_select'
    ) then
      execute format('create policy authenticated_select on public.%I for select to authenticated using (true)', t);
    end if;
  end loop;
end $$;

-- Setup write policies for app-managed tables.
do $$
declare
  t text;
begin
  foreach t in array array['users', 'stock_items', 'marketing_campaigns', 'marketing_segments', 'marketing_campaign_customers', 'marketing_activities'] loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'authenticated_insert'
    ) then
      execute format('create policy authenticated_insert on public.%I for insert to authenticated with check (true)', t);
    end if;
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'authenticated_update'
    ) then
      execute format('create policy authenticated_update on public.%I for update to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;
