create table public.exception_cases (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  source_type text not null check (source_type in ('work_item','service_job','stock_alert','purchase_order','maintenance_plan','asset','delivery_order')),
  source_id uuid not null,
  exception_type text not null,
  title text not null,
  detail text,
  branch text not null check (branch in ('jhb','cpt','kzn','national')),
  severity text not null default 'warning' check (severity in ('info','warning','high','critical')),
  status text not null default 'open' check (status in ('open','acknowledged','snoozed','escalated','resolved')),
  assigned_to uuid references public.users(id) on delete set null,
  acknowledged_by uuid references public.users(id) on delete set null,
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  escalated_by uuid references public.users(id) on delete set null,
  escalated_at timestamptz,
  resolution_notes text,
  source_href text not null,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exception_comments (
  id uuid primary key default gen_random_uuid(),
  exception_case_id uuid not null references public.exception_cases(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index exception_cases_active_branch_severity_idx
  on public.exception_cases (branch, severity, last_seen_at desc)
  where status <> 'resolved';

create index exception_cases_assigned_active_idx
  on public.exception_cases (assigned_to, last_seen_at desc)
  where assigned_to is not null and status <> 'resolved';

create index exception_cases_snoozed_until_idx
  on public.exception_cases (snoozed_until)
  where status = 'snoozed';

create index exception_comments_case_created_idx
  on public.exception_comments (exception_case_id, created_at);

alter table public.exception_cases enable row level security;
alter table public.exception_comments enable row level security;

revoke all on table public.exception_cases from public, anon, authenticated;
revoke all on table public.exception_comments from public, anon, authenticated;

comment on table public.exception_cases
  is 'Persistent operational exception cases synchronized from ERP source records and managed through controlled triage RPCs.';

comment on table public.exception_comments
  is 'Discussion history for operational exception cases.';
