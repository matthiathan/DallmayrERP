\set ON_ERROR_STOP on

do $$
begin
  if to_regclass('public.shared_dashboards') is not null then
    raise exception 'shared_dashboards still exists after rollback';
  end if;
  if to_regclass('public.shared_dashboard_widgets') is not null then
    raise exception 'shared_dashboard_widgets still exists after rollback';
  end if;
  if to_regprocedure('public.shared_dashboard_metric_allowed(text,text)') is not null then
    raise exception 'shared_dashboard_metric_allowed still exists after rollback';
  end if;
  if to_regprocedure('public.shared_dashboard_current_branch()') is not null then
    raise exception 'shared_dashboard_current_branch still exists after rollback';
  end if;
end $$;

select 'Shared dashboard rollback contract passed.' as result;
