create table if not exists public.telemetry_ai_insight_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_key text not null,
  period text not null check (period in ('day', 'week', 'month', 'six_months')),
  payload jsonb not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope_key, period)
);

alter table public.telemetry_ai_insight_cache enable row level security;

revoke all on public.telemetry_ai_insight_cache from anon;
grant select, insert, update, delete on public.telemetry_ai_insight_cache to authenticated;

drop policy if exists telemetry_ai_insight_cache_select_own on public.telemetry_ai_insight_cache;
create policy telemetry_ai_insight_cache_select_own
on public.telemetry_ai_insight_cache
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists telemetry_ai_insight_cache_insert_own on public.telemetry_ai_insight_cache;
create policy telemetry_ai_insight_cache_insert_own
on public.telemetry_ai_insight_cache
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists telemetry_ai_insight_cache_update_own on public.telemetry_ai_insight_cache;
create policy telemetry_ai_insight_cache_update_own
on public.telemetry_ai_insight_cache
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists telemetry_ai_insight_cache_delete_own on public.telemetry_ai_insight_cache;
create policy telemetry_ai_insight_cache_delete_own
on public.telemetry_ai_insight_cache
for delete
to authenticated
using (user_id = auth.uid());

comment on table public.telemetry_ai_insight_cache is
  'Per-user cached AI telemetry insight payloads. Raw API credentials and prompts are never stored here.';
