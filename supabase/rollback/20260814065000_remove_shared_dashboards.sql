-- Rollback for 20260814065000_add_shared_dashboards.sql.
-- Drop the dashboard relations first so their RLS policies and triggers release
-- dependencies on the helper functions before those functions are removed.

begin;

drop table if exists public.shared_dashboard_widgets;
drop table if exists public.shared_dashboards;

drop function if exists public.audit_shared_dashboard_widget_change();
drop function if exists public.audit_shared_dashboard_change();
drop function if exists public.guard_shared_dashboard_widget();
drop function if exists public.guard_shared_dashboard();
drop function if exists public.shared_dashboard_current_branch();
drop function if exists public.shared_dashboard_metric_allowed(text, text);

commit;
