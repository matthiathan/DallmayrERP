-- Require technician closures to use the authenticated atomic completion RPC.
-- Supabase grants EXECUTE to anon by default when functions are created, so
-- remove that grant explicitly and retain only authenticated/service roles.

revoke execute on function public.complete_assigned_service_job(uuid, text, text, text, text, text) from anon;
grant execute on function public.complete_assigned_service_job(uuid, text, text, text, text, text) to authenticated, service_role;

-- Administrators may retain direct maintenance access. Technician and road
-- technician clients must use complete_assigned_service_job so a closure cannot
-- exist without its matching scan, audit event and service-job transition.
drop policy if exists task_closures_insert_tech_roles on public.task_closures;

create policy task_closures_insert_admin_only
  on public.task_closures
  for insert
  to authenticated
  with check (public.current_app_role() = 'admin');
