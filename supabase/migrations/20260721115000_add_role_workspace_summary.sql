create or replace function public.get_role_workspace_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_branch text;
  v_all_branches boolean;
  v_result jsonb;
begin
  if v_user_id is null or v_role is null then
    raise exception 'Authenticated ERP profile required';
  end if;

  select lower(coalesce(branch, 'national'))
    into v_branch
  from public.user_details
  where user_id = v_user_id
  limit 1;

  v_branch := coalesce(v_branch, 'national');
  v_all_branches := v_branch = 'national' or v_role in ('admin', 'executive');

  select jsonb_build_object(
    'user_id', v_user_id,
    'role', v_role,
    'branch', v_branch,

    'my_active_work', (
      select count(*) from public.work_items w
      where w.assigned_to = v_user_id
        and lower(coalesce(w.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
    ),
    'my_overdue_work', (
      select count(*) from public.work_items w
      where w.assigned_to = v_user_id
        and lower(coalesce(w.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and coalesce(w.due_at, w.sla_due_at) < now()
    ),
    'my_high_priority_work', (
      select count(*) from public.work_items w
      where w.assigned_to = v_user_id
        and lower(coalesce(w.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and lower(coalesce(w.priority, '')) in ('high', 'critical')
    ),
    'my_open_service_jobs', (
      select count(*) from public.service_jobs s
      where s.assigned_to = v_user_id
        and lower(coalesce(s.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
    ),
    'my_open_deliveries', (
      select count(*) from public.delivery_orders d
      where d.assigned_to = v_user_id
        and lower(coalesce(d.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
    ),

    'branch_open_work', (
      select count(*) from public.work_items w
      where lower(coalesce(w.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and (v_all_branches or lower(coalesce(w.branch, 'national')) = v_branch)
    ),
    'branch_overdue_work', (
      select count(*) from public.work_items w
      where lower(coalesce(w.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and coalesce(w.due_at, w.sla_due_at) < now()
        and (v_all_branches or lower(coalesce(w.branch, 'national')) = v_branch)
    ),
    'unassigned_work', (
      select count(*) from public.work_items w
      where w.assigned_to is null
        and lower(coalesce(w.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and (v_all_branches or lower(coalesce(w.branch, 'national')) = v_branch)
    ),
    'pending_work_approvals', (
      select count(*) from public.work_items w
      where lower(coalesce(w.approval_status, '')) = 'pending'
        and (v_all_branches or lower(coalesce(w.branch, 'national')) = v_branch)
    ),
    'pending_purchase_approvals', (
      select count(*) from public.purchase_orders p
      where lower(coalesce(p.approval_status, '')) = 'pending'
        and (v_all_branches or lower(coalesce(p.branch, 'national')) = v_branch)
    ),
    'pending_approvals', (
      (select count(*) from public.work_items w
       where lower(coalesce(w.approval_status, '')) = 'pending'
         and (v_all_branches or lower(coalesce(w.branch, 'national')) = v_branch))
      +
      (select count(*) from public.purchase_orders p
       where lower(coalesce(p.approval_status, '')) = 'pending'
         and (v_all_branches or lower(coalesce(p.branch, 'national')) = v_branch))
    ),
    'stock_alerts', (
      select count(*) from public.stock_alerts a
      where lower(coalesce(a.status, 'open')) in ('open', 'acknowledged')
    ),
    'open_purchase_orders', (
      select count(*) from public.purchase_orders p
      where lower(coalesce(p.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and (v_all_branches or lower(coalesce(p.branch, 'national')) = v_branch)
    ),
    'open_deliveries', (
      select count(*) from public.delivery_orders d
      where lower(coalesce(d.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and (v_all_branches or lower(coalesce(d.branch, 'national')) = v_branch)
    ),
    'open_service_jobs', (
      select count(*) from public.service_jobs s
      where lower(coalesce(s.status, 'open')) not in ('completed', 'closed', 'cancelled', 'received', 'resolved')
        and (v_all_branches or lower(coalesce(s.branch, 'national')) = v_branch)
    ),
    'business_users', (select count(*) from public.users),

    'customer_count', (
      select count(*) from public.customers c
      where v_all_branches or lower(coalesce(c.branch, 'national')) = v_branch
    ),
    'contract_records', (
      select count(*) from public.sales_contract_renewal_source c
      where v_all_branches or lower(coalesce(c.branch, 'national')) = v_branch
    ),
    'renewals_due_90', (
      select count(*) from public.sales_contract_renewal_source c
      where (v_all_branches or lower(coalesce(c.branch, 'national')) = v_branch)
        and c.days_to_expire is not null
        and c.days_to_expire <= 90
    ),
    'open_opportunities', (
      select count(*) from public.sales_opportunities o
      where lower(coalesce(o.status, 'open')) in ('open', 'follow_up', 'quoted')
        and (v_all_branches or lower(coalesce(o.branch, 'national')) = v_branch)
    ),
    'commercial_accounts', (
      select count(*) from public.customer_commercial_source c
      where v_all_branches or lower(coalesce(c.branch, 'national')) = v_branch
    ),
    'active_campaigns', (
      select count(*) from public.marketing_campaigns c
      where lower(coalesce(c.status, 'active')) not in ('completed', 'closed', 'cancelled')
        and (v_all_branches or lower(coalesce(c.branch, 'national')) = v_branch)
    ),
    'marketing_segments', (select count(*) from public.marketing_segments)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_role_workspace_summary() from public;
grant execute on function public.get_role_workspace_summary() to authenticated;
