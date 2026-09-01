create index if not exists telemetry_test_commands_session_id_idx
  on public.telemetry_test_commands(session_id);

drop policy if exists telemetry_test_sessions_admin_insert on public.telemetry_test_sessions;
create policy telemetry_test_sessions_admin_insert
  on public.telemetry_test_sessions for insert
  with check (current_app_role() = 'admin' and requested_by = (select auth.uid()));

drop policy if exists telemetry_test_commands_admin_insert on public.telemetry_test_commands;
create policy telemetry_test_commands_admin_insert
  on public.telemetry_test_commands for insert
  with check (current_app_role() = 'admin' and created_by = (select auth.uid()));
