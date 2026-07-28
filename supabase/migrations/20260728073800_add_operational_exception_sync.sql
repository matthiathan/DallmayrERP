create or replace function public.sync_operational_exceptions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_branch text;
  v_sync_at timestamptz := clock_timestamp();
  v_count integer;
begin
  if v_actor is null or v_role not in ('admin','operations','executive','warehouse_staff','finance') then
    raise exception 'You are not permitted to synchronize operational exceptions' using errcode = '42501';
  end if;

  select d.branch into v_branch from public.user_details d where d.user_id = v_actor;
  if v_branch is null then
    raise exception 'The authenticated user does not have a branch' using errcode = '42501';
  end if;

  with detected(source_key,source_type,source_id,exception_type,title,detail,branch,severity,source_href,metadata) as (
    select format('work_item:%s:overdue', w.id), 'work_item', w.id, 'overdue_work',
      format('%s is overdue', w.work_number),
      format('%s · target %s', w.title, to_char(coalesce(w.sla_due_at,w.due_at), 'YYYY-MM-DD HH24:MI')),
      w.branch,
      case when w.priority = 'critical' or coalesce(w.sla_due_at,w.due_at) < v_sync_at - interval '7 days' then 'critical'
           when w.priority = 'high' or coalesce(w.sla_due_at,w.due_at) < v_sync_at - interval '2 days' then 'high' else 'warning' end,
      format('/work/%s', w.id),
      jsonb_build_object('work_number',w.work_number,'target_at',coalesce(w.sla_due_at,w.due_at))
    from public.work_items w
    where w.status not in ('completed','closed','cancelled') and coalesce(w.sla_due_at,w.due_at) < v_sync_at

    union all
    select format('work_item:%s:approval', w.id), 'work_item', w.id, 'pending_approval',
      format('%s needs approval', w.work_number), w.title, w.branch,
      case when w.priority in ('high','critical') or w.due_at < v_sync_at then 'high' else 'warning' end,
      format('/work/%s', w.id), jsonb_build_object('work_number',w.work_number,'due_at',w.due_at)
    from public.work_items w
    where w.status not in ('completed','closed','cancelled') and w.approval_status = 'pending'

    union all
    select format('work_item:%s:unassigned', w.id), 'work_item', w.id, 'unassigned_work',
      format('%s has no owner', w.work_number), w.title, w.branch,
      case when w.priority in ('high','critical') or coalesce(w.sla_due_at,w.due_at) < v_sync_at then 'high' else 'warning' end,
      format('/work/%s', w.id), jsonb_build_object('work_number',w.work_number,'target_at',coalesce(w.sla_due_at,w.due_at))
    from public.work_items w
    where w.status not in ('completed','closed','cancelled') and w.assigned_to is null

    union all
    select format('service_job:%s:overdue', j.id), 'service_job', j.id, 'overdue_service',
      format('%s is overdue', j.job_number), format('Incident %s · %s',j.incident_number,j.summary), j.branch,
      case when j.priority = 'critical' or j.due_at < v_sync_at - interval '3 days' then 'critical'
           when j.priority = 'high' or j.due_at < v_sync_at - interval '1 day' then 'high' else 'warning' end,
      format('/operations/service-jobs?job=%s',j.id), jsonb_build_object('job_number',j.job_number,'incident_number',j.incident_number,'due_at',j.due_at)
    from public.service_jobs j
    where j.status not in ('completed','verified','closed','cancelled') and j.due_at < v_sync_at

    union all
    select format('service_job:%s:unassigned',j.id), 'service_job', j.id, 'unassigned_service',
      format('%s needs a technician',j.job_number), format('Incident %s · %s',j.incident_number,j.summary), j.branch,
      case when j.priority in ('high','critical') then 'high' else 'warning' end,
      format('/operations/service-jobs?job=%s',j.id), jsonb_build_object('job_number',j.job_number,'incident_number',j.incident_number,'status',j.status)
    from public.service_jobs j
    where j.status not in ('completed','verified','closed','cancelled') and j.assigned_to is null

    union all
    select format('service_job:%s:urgent',j.id), 'service_job', j.id, 'urgent_service',
      format('%s is %s priority',j.job_number,j.priority), format('Incident %s · %s',j.incident_number,j.summary), j.branch,
      case when j.priority = 'critical' then 'critical' else 'high' end,
      format('/operations/service-jobs?job=%s',j.id), jsonb_build_object('job_number',j.job_number,'incident_number',j.incident_number)
    from public.service_jobs j
    where j.status not in ('completed','verified','closed','cancelled') and j.priority in ('high','critical')

    union all
    select format('service_job:%s:machine_missing',j.id), 'service_job', j.id, 'machine_not_linked',
      format('%s has no linked machine',j.job_number), format('Incident %s · %s',j.incident_number,j.summary), j.branch,
      case when j.priority in ('high','critical') then 'high' else 'warning' end,
      format('/operations/service-jobs?job=%s',j.id), jsonb_build_object('job_number',j.job_number,'incident_number',j.incident_number)
    from public.service_jobs j
    where j.status not in ('completed','verified','closed','cancelled') and j.machine_id is null

    union all
    select format('stock_alert:%s:%s',a.id,a.alert_type), 'stock_alert', a.id, a.alert_type,
      format('%s stock alert',coalesce(nullif(trim(s.stock_name),''),'Stock item')),
      format('%s available · threshold %s',a.current_quantity,a.threshold), 'national',
      case when a.current_quantity <= 0 then 'critical'
           when a.current_quantity <= greatest(1,floor(a.threshold / 2.0)) then 'high' else 'warning' end,
      format('/warehouse/stock/%s',a.stock_item_id),
      jsonb_build_object('stock_item_id',a.stock_item_id,'current_quantity',a.current_quantity,'threshold',a.threshold)
    from public.stock_alerts a join public.stock_items s on s.id = a.stock_item_id
    where a.status in ('open','acknowledged')

    union all
    select format('purchase_order:%s:approval',p.id), 'purchase_order', p.id, 'purchase_approval',
      format('%s needs purchase approval',p.po_number),
      format('%s · estimated R %s',p.supplier_name,to_char(coalesce(p.estimated_total,0),'FM999G999G999G990D00')), p.branch,
      case when p.submitted_at < v_sync_at - interval '2 days' then 'high' else 'warning' end,
      '/warehouse/purchasing/approvals', jsonb_build_object('po_number',p.po_number,'submitted_at',p.submitted_at,'estimated_total',p.estimated_total)
    from public.purchase_orders p where p.approval_status = 'pending'

    union all
    select format('purchase_order:%s:overdue',p.id), 'purchase_order', p.id, 'purchase_overdue',
      format('%s is past its expected date',p.po_number), format('%s · expected %s',p.supplier_name,p.expected_date), p.branch,
      'high', '/warehouse/purchasing', jsonb_build_object('po_number',p.po_number,'expected_date',p.expected_date,'status',p.status)
    from public.purchase_orders p
    where p.status not in ('received','closed','cancelled') and p.expected_date < current_date

    union all
    select format('maintenance_plan:%s:due',p.id), 'maintenance_plan', p.id, 'maintenance_due',
      format('%s is due',p.plan_number),
      format('%s · %s',coalesce(m.machine_name,m.serial_number,'Machine'),
        case when p.next_due_at is not null and p.next_due_at <= v_sync_at and p.next_due_meter is not null and m.meter_value >= p.next_due_meter then 'date and meter thresholds reached'
             when p.next_due_at is not null and p.next_due_at <= v_sync_at then format('due %s',to_char(p.next_due_at,'YYYY-MM-DD HH24:MI'))
             else format('%s %s reached',m.meter_value,m.meter_unit) end),
      coalesce(p.branch,m.branch),
      case when p.priority = 'critical' then 'critical' when p.priority = 'high' then 'high' else 'warning' end,
      '/operations/maintenance', jsonb_build_object('plan_number',p.plan_number,'next_due_at',p.next_due_at,'next_due_meter',p.next_due_meter)
    from public.maintenance_plans p join public.machines m on m.id = p.machine_id
    where p.is_active = true and ((p.next_due_at is not null and p.next_due_at <= v_sync_at) or (p.next_due_meter is not null and m.meter_value >= p.next_due_meter))

    union all
    select format('asset:%s:condition',m.id), 'asset', m.id, 'asset_condition',
      format('%s condition is %s',coalesce(m.machine_name,m.serial_number,'Machine'),m.condition),
      format('%s criticality asset',m.criticality), m.branch,
      case when m.condition = 'critical' or m.criticality = 'critical' then 'critical' else 'high' end,
      format('/operations/assets/%s',m.id), jsonb_build_object('condition',m.condition,'criticality',m.criticality)
    from public.machines m where m.status <> 'retired' and m.condition in ('poor','critical')

    union all
    select format('asset:%s:audit',m.id), 'asset', m.id, 'asset_audit_due',
      format('%s audit is due',coalesce(m.machine_name,m.serial_number,'Machine')),
      format('Next audit %s',to_char(m.next_audit_at,'YYYY-MM-DD HH24:MI')), m.branch,
      case when m.next_audit_at < v_sync_at or m.criticality = 'critical' then 'high' else 'warning' end,
      format('/operations/assets/%s',m.id), jsonb_build_object('next_audit_at',m.next_audit_at,'criticality',m.criticality)
    from public.machines m
    where m.status <> 'retired' and m.next_audit_at is not null and m.next_audit_at <= v_sync_at + interval '30 days'

    union all
    select format('asset:%s:lifecycle',m.id), 'asset', m.id, 'asset_lifecycle_due',
      format('%s lifecycle follow-up is due',coalesce(m.machine_name,m.serial_number,'Machine')),
      case when m.replacement_due_at is not null and m.replacement_due_at <= current_date + 60 then format('Replacement due %s',m.replacement_due_at)
           else format('Warranty expires %s',m.warranty_expires_at) end,
      m.branch,
      case when coalesce(m.replacement_due_at,m.warranty_expires_at) < current_date or m.criticality = 'critical' then 'high' else 'warning' end,
      format('/operations/assets/%s',m.id), jsonb_build_object('warranty_expires_at',m.warranty_expires_at,'replacement_due_at',m.replacement_due_at)
    from public.machines m
    where m.status <> 'retired' and ((m.warranty_expires_at is not null and m.warranty_expires_at <= current_date + 60) or (m.replacement_due_at is not null and m.replacement_due_at <= current_date + 60))

    union all
    select format('delivery_order:%s:stalled',d.id), 'delivery_order', d.id, 'delivery_stalled',
      format('%s is stalled in %s',d.order_number,d.status), d.customer_name, d.branch,
      case when d.status = 'dispatched' then 'high' else 'warning' end,
      format('/operations/deliveries?order=%s',d.id), jsonb_build_object('order_number',d.order_number,'status',d.status,'status_updated_at',d.status_updated_at)
    from public.delivery_orders d
    where (d.status = 'draft' and d.status_updated_at < v_sync_at - interval '3 days')
       or (d.status = 'picked' and d.status_updated_at < v_sync_at - interval '1 day')
       or (d.status = 'dispatched' and d.status_updated_at < v_sync_at - interval '1 day')
       or (d.status = 'delivered' and d.status_updated_at < v_sync_at - interval '2 days')
  )
  insert into public.exception_cases (
    source_key,source_type,source_id,exception_type,title,detail,branch,severity,source_href,metadata,
    first_seen_at,last_seen_at,created_at,updated_at
  )
  select source_key,source_type,source_id,exception_type,title,detail,branch,severity,source_href,metadata,
    v_sync_at,v_sync_at,v_sync_at,v_sync_at
  from detected
  on conflict (source_key) do update set
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    exception_type = excluded.exception_type,
    title = excluded.title,
    detail = excluded.detail,
    branch = excluded.branch,
    severity = excluded.severity,
    source_href = excluded.source_href,
    metadata = (public.exception_cases.metadata - 'auto_resolved') || excluded.metadata,
    status = case
      when public.exception_cases.status = 'resolved' and coalesce((public.exception_cases.metadata ->> 'auto_resolved')::boolean,false) then 'open'
      when public.exception_cases.status = 'snoozed' and public.exception_cases.snoozed_until <= v_sync_at then 'open'
      else public.exception_cases.status end,
    resolved_at = case when public.exception_cases.status = 'resolved' and coalesce((public.exception_cases.metadata ->> 'auto_resolved')::boolean,false) then null else public.exception_cases.resolved_at end,
    snoozed_until = case when public.exception_cases.status = 'snoozed' and public.exception_cases.snoozed_until <= v_sync_at then null else public.exception_cases.snoozed_until end,
    last_seen_at = v_sync_at,
    updated_at = v_sync_at;

  update public.exception_cases c set
    status = 'resolved',
    resolved_at = v_sync_at,
    resolution_notes = coalesce(c.resolution_notes,'Source condition cleared automatically.'),
    snoozed_until = null,
    metadata = c.metadata || jsonb_build_object('auto_resolved',true),
    updated_at = v_sync_at
  where c.source_type in ('work_item','service_job','stock_alert','purchase_order','maintenance_plan','asset','delivery_order')
    and c.last_seen_at < v_sync_at and c.status <> 'resolved';

  select count(*) into v_count from public.exception_cases c
  where c.status <> 'resolved' and (v_role in ('admin','executive') or v_branch = 'national' or c.branch in (v_branch,'national'));
  return v_count;
end;
$$;

revoke all on function public.sync_operational_exceptions() from public,anon;
grant execute on function public.sync_operational_exceptions() to authenticated;
comment on function public.sync_operational_exceptions() is 'Synchronizes current operational exception conditions into persistent exception cases.';
