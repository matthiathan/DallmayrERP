create table if not exists public.telemetry_ai_generation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_key text not null,
  analysis_scope text not null check (analysis_scope in ('fleet', 'machine')),
  machine_id uuid,
  period text not null check (period in ('day', 'week', 'month', 'six_months')),
  model text not null,
  event_type text not null check (event_type in ('success', 'failure', 'cache_hit')),
  error_code text,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  cache_write_ok boolean,
  complete_machine_sales boolean,
  created_at timestamptz not null default now()
);

create index if not exists telemetry_ai_generation_log_created_at_idx
  on public.telemetry_ai_generation_log (created_at desc);

create index if not exists telemetry_ai_generation_log_user_id_created_at_idx
  on public.telemetry_ai_generation_log (user_id, created_at desc);

alter table public.telemetry_ai_generation_log enable row level security;

revoke all on public.telemetry_ai_generation_log from anon;
revoke update, delete on public.telemetry_ai_generation_log from authenticated;
grant select, insert on public.telemetry_ai_generation_log to authenticated;

drop policy if exists telemetry_ai_generation_log_insert_own on public.telemetry_ai_generation_log;
create policy telemetry_ai_generation_log_insert_own
on public.telemetry_ai_generation_log
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists telemetry_ai_generation_log_select_admin on public.telemetry_ai_generation_log;
create policy telemetry_ai_generation_log_select_admin
on public.telemetry_ai_generation_log
for select
to authenticated
using (public.current_app_role() = 'admin');

comment on table public.telemetry_ai_generation_log is
  'Operational AI request metadata for administrators. Stores no prompts, telemetry evidence, AI payloads, or API credentials.';
