-- Rollback for 20260814065000_add_shared_dashboards.sql.

begin;

drop trigger if exists shared_dashboard_widgets_audit on public.shared_dashboard_widgets;
drop trigger if exists shared_dashboards_audit on public.shared_dashboards;
drop trigger if exists shared_dashboard_widgets_guard on public.shared_dashboard_widgets;
drop trigger if exists shared_dashboards_guard on public.shared_dashboards;

drop function if exists public.audit_shared_dashboard_widget_change();
drop function if exists public.audit_shared_dashboard_change();
drop function if exists public.guard_shared_dashboard_widget();
drop function if exists public.guard_shared_dashboard();
drop function if exists public.shared_dashboard_current_branch();
drop function if exists public.shared_dashboard_metric_allowed(text, text);

drop table if exists public.shared_dashboard_widgets;
drop table if exists public.shared_dashboards;

commit;
