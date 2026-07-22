create or replace function public.get_operations_manager_report_summary(
  p_date_from date,
  p_date_to date,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_profile_branch text;
  v_branch text;
  v_from date := least(coalesce(p_date_from, current_date), coalesce(p_date_to, current_date));
  v_to date := greatest(coalesce(p_date_from, current_date), coalesce(p_date_to, current_date));
begin
  if v_user_id is null or v_role not in ('admin', 'operations', 'executive') then
    raise exception 'Operations reporting is restricted to Operations, Executive and Administrator roles';
  end if;

  select lower(coalesce(branch, 'national'))
    into v_profile_branch
  from public.user_details
  where user_id = v_user_id
  limit 1;

  v_profile_branch := coalesce(v_profile_branch, 'national');
  v_branch := lower(nullif(trim(coalesce(p_branch, '')), ''));

  if v_branch = 'all' then
    v_branch := null;
  end if;

  if v_role = 'operations' and v_profile_branch <> 'national' then
    v_branch := v_profile_branch;
  end if;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'branch', coalesce(v_branch, 'all'),
    'service_jobs_total', (
      select count(*) from public.service_jobs s
      where coalesce(s.due_at::date, s.created_at::date) between v_from and v_to
        and (v_branch is null or lower(s.branch) = v_branch)
    ),
    'service_jobs_open', (
      select count(*) from public.service_jobs s
      where coalesce(s.due_at::date, s.created_at::date) between v_from and v_to
        and lower(coalesce(s.status, 'new')) not in ('completed', 'verified', 'closed', 'cancelled')
        and (v_branch is null or lower(s.branch) = v_branch)
    ),
    'service_jobs_completed', (
      select count(*) from public.service_jobs s
      where coalesce(s.due_at::date, s.completed_at::date, s.created_at::date) between v_from and v_to
        and lower(coalesce(s.status, 'new')) in ('completed', 'verified', 'closed')
        and (v_branch is null or lower(s.branch) = v_branch)
    ),
    'service_jobs_overdue', (
      select count(*) from public.service_jobs s
      where coalesce(s.due_at::date, s.created_at::date) between v_from and v_to
        and lower(coalesce(s.status, 'new')) not in ('completed', 'verified', 'closed', 'cancelled')
        and s.due_at < now()
        and (v_branch is null or lower(s.branch) = v_branch)
    ),
    'service_jobs_unassigned', (
      select count(*) from public.service_jobs s
      where coalesce(s.due_at::date, s.created_at::date) between v_from and v_to
        and lower(coalesce(s.status, 'new')) not in ('completed', 'verified', 'closed', 'cancelled')
        and s.assigned_to is null
        and (v_branch is null or lower(s.branch) = v_branch)
    ),
    'monthly_services_total', (
      select count(*) from public.monthly_service_obligations m
      where m.scheduled_date between v_from and v_to
        and lower(coalesce(m.status, 'due')) not in ('cancelled', 'waived')
        and (v_branch is null or lower(m.branch) = v_branch)
    ),
    'monthly_services_completed', (
      select count(*) from public.monthly_service_obligations m
      where m.scheduled_date between v_from and v_to
        and lower(coalesce(m.status, 'due')) = 'completed'
        and (v_branch is null or lower(m.branch) = v_branch)
    ),
    'monthly_services_missed', (
      select count(*) from public.monthly_service_obligations m
      where m.scheduled_date between v_from and v_to
        and m.scheduled_date < current_date
        and lower(coalesce(m.status, 'due')) not in ('completed', 'cancelled', 'waived')
        and (v_branch is null or lower(m.branch) = v_branch)
    ),
    'monthly_services_rescheduled', (
      select count(*) from public.monthly_service_obligations m
      where m.scheduled_date between v_from and v_to
        and (lower(coalesce(m.status, 'due')) = 'rescheduled' or m.scheduled_date <> m.original_scheduled_date)
        and (v_branch is null or lower(m.branch) = v_branch)
    ),
    'delivery_orders_total', (
      select count(*) from public.delivery_orders d
      where coalesce(d.delivered_at::date, d.created_at::date) between v_from and v_to
        and (v_branch is null or lower(d.branch) = v_branch)
    ),
    'delivery_orders_open', (
      select count(*) from public.delivery_orders d
      where coalesce(d.delivered_at::date, d.created_at::date) between v_from and v_to
        and lower(coalesce(d.status, 'draft')) not in ('delivered', 'closed', 'cancelled')
        and (v_branch is null or lower(d.branch) = v_branch)
    ),
    'delivery_orders_completed', (
      select count(*) from public.delivery_orders d
      where coalesce(d.delivered_at::date, d.closed_at::date, d.created_at::date) between v_from and v_to
        and lower(coalesce(d.status, 'draft')) in ('delivered', 'closed')
        and (v_branch is null or lower(d.branch) = v_branch)
    ),
    'planned_route_stops', (
      (select count(*) from public.monthly_service_obligations m
       where m.scheduled_date between v_from and v_to
         and nullif(trim(coalesce(m.route_number, '')), '') is not null
         and (v_branch is null or lower(m.branch) = v_branch))
      +
      (select count(*) from public.service_jobs s
       where coalesce(s.due_at::date, s.created_at::date) between v_from and v_to
         and nullif(trim(coalesce(s.route_number, '')), '') is not null
         and (v_branch is null or lower(s.branch) = v_branch))
    ),
    'customers_requiring_service', (
      select count(distinct customer_id)
      from (
        select s.customer_id
        from public.service_jobs s
        where coalesce(s.due_at::date, s.created_at::date) between v_from and v_to
          and s.customer_id is not null
          and (v_branch is null or lower(s.branch) = v_branch)
        union
        select m.customer_id
        from public.monthly_service_obligations m
        where m.scheduled_date between v_from and v_to
          and (v_branch is null or lower(m.branch) = v_branch)
      ) customers
    )
  );
end;
$$;

revoke all on function public.get_operations_manager_report_summary(date, date, text) from public;
grant execute on function public.get_operations_manager_report_summary(date, date, text) to authenticated;
