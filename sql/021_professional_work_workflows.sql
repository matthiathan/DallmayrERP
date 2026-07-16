-- DallmayrERP professional work-management RPCs and audit controls.

create or replace function public.list_assignable_users()
returns table(user_id uuid,display_name text,role text,branch text)
language sql security definer set search_path=public stable as $$
  select d.user_id,trim(concat_ws(' ',d.first_name,d.last_name)),d.role,d.branch
  from public.user_details d
  where public.current_app_role() in ('admin','operations','finance','executive','marketing','sales','warehouse_staff','technician','road_technician')
  order by d.first_name,d.last_name;
$$;
grant execute on function public.list_assignable_users() to authenticated;

create or replace function public.create_work_item(
  p_title text,
  p_description text default null,
  p_work_type text default 'task',
  p_department text default 'operations',
  p_branch text default 'national',
  p_priority text default 'medium',
  p_assigned_to uuid default null,
  p_customer_id uuid default null,
  p_site_id uuid default null,
  p_machine_id uuid default null,
  p_stock_item_id uuid default null,
  p_due_at timestamptz default null,
  p_sla_due_at timestamptz default null,
  p_approval_required boolean default false
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_role text:=public.current_app_role();
  v_id uuid:=gen_random_uuid();
  v_number text;
  v_status text;
begin
  if v_actor is null or v_role is null then raise exception 'Authentication required'; end if;
  if nullif(trim(coalesce(p_title,'')),'') is null then raise exception 'Title is required'; end if;
  if p_work_type not in ('request','task','approval','inspection','maintenance','incident') then raise exception 'Invalid work type'; end if;
  if p_branch not in ('jhb','cpt','kzn','national') then raise exception 'Invalid branch'; end if;
  if p_priority not in ('low','medium','high','critical') then raise exception 'Invalid priority'; end if;
  v_number:=concat('WK-',upper(p_branch),'-',to_char(clock_timestamp(),'YYYYMMDDHH24MISS'),'-',upper(substr(v_id::text,1,4)));
  v_status:=case when p_assigned_to is null then 'new' else 'assigned' end;
  insert into public.work_items(id,work_number,title,description,work_type,department,branch,status,priority,requested_by,assigned_to,customer_id,site_id,machine_id,stock_item_id,due_at,sla_due_at,approval_required,approval_status)
  values(v_id,v_number,trim(p_title),nullif(trim(coalesce(p_description,'')),''),p_work_type,coalesce(nullif(trim(p_department),''),'operations'),p_branch,v_status,p_priority,v_actor,p_assigned_to,p_customer_id,p_site_id,p_machine_id,p_stock_item_id,p_due_at,p_sla_due_at,p_approval_required,case when p_approval_required then 'pending' else 'not_required' end);
  insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,after_payload)
  values(v_actor,v_role,p_branch,'work_item',v_id,'work_item_created',concat(v_number,' created: ',trim(p_title)),jsonb_build_object('status',v_status,'priority',p_priority,'work_type',p_work_type,'assigned_to',p_assigned_to));
  return v_id;
end; $$;
grant execute on function public.create_work_item(text,text,text,text,text,text,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean) to authenticated;

create or replace function public.assign_work_item(p_work_item_id uuid,p_assigned_to uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_role text:=public.current_app_role();
  v_actor uuid:=public.current_app_user_id();
  v_old uuid;
  v_status text;
begin
  if v_role not in ('admin','operations') then raise exception 'Not authorised to assign work'; end if;
  select assigned_to,status into v_old,v_status from public.work_items where id=p_work_item_id for update;
  if not found then raise exception 'Work item not found'; end if;
  update public.work_items set assigned_to=p_assigned_to,status=case when p_assigned_to is not null and v_status in ('new','triaged','blocked') then 'assigned' else v_status end where id=p_work_item_id;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,before_payload,after_payload)
  values(v_actor,v_role,'work_item',p_work_item_id,'work_item_assigned','Work item assignment changed',jsonb_build_object('assigned_to',v_old),jsonb_build_object('assigned_to',p_assigned_to));
end; $$;
grant execute on function public.assign_work_item(uuid,uuid) to authenticated;

create or replace function public.transition_work_item(p_work_item_id uuid,p_new_status text)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_role text:=public.current_app_role();
  v_old text;
  v_assigned uuid;
  v_requested uuid;
  v_approval_required boolean;
  v_approval_status text;
  v_incomplete integer;
begin
  select status,assigned_to,requested_by,approval_required,approval_status into v_old,v_assigned,v_requested,v_approval_required,v_approval_status from public.work_items where id=p_work_item_id for update;
  if not found then raise exception 'Work item not found'; end if;
  if not (v_role in ('admin','operations') or v_actor=v_assigned or v_actor=v_requested) then raise exception 'Not authorised'; end if;
  if p_new_status='assigned' and v_assigned is null then raise exception 'Assign an owner before moving work to assigned'; end if;
  if not ((v_old='new' and p_new_status in ('triaged','assigned','cancelled')) or
          (v_old='triaged' and p_new_status in ('assigned','in_progress','cancelled')) or
          (v_old='assigned' and p_new_status in ('in_progress','blocked','cancelled')) or
          (v_old='in_progress' and p_new_status in ('blocked','waiting_approval','completed','cancelled')) or
          (v_old='blocked' and p_new_status in ('assigned','in_progress','cancelled')) or
          (v_old='waiting_approval' and p_new_status in ('in_progress','completed','blocked')) or
          v_old=p_new_status) then raise exception 'Invalid transition from % to %',v_old,p_new_status; end if;
  if p_new_status in ('waiting_approval','completed') then
    select count(*) into v_incomplete from public.work_item_checklist where work_item_id=p_work_item_id and is_required and not is_completed;
    if v_incomplete>0 then raise exception '% required checklist item(s) are incomplete',v_incomplete; end if;
  end if;
  if p_new_status='completed' and v_approval_required and v_approval_status<>'approved' then raise exception 'Approval is required before completion'; end if;
  update public.work_items set status=p_new_status,completed_at=case when p_new_status='completed' then now() else completed_at end where id=p_work_item_id;
  insert into public.audit_events(actor_user_id,actor_role,entity_type,entity_id,action,summary,before_payload,after_payload)
  values(v_actor,v_role,'work_item',p_work_item_id,'work_item_status_changed','Work item status changed',jsonb_build_object('status',v_old),jsonb_build_object('status',p_new_status));
end; $$;
grant execute on function public.transition_work_item(uuid,text) to authenticated;

create or replace function public.review_work_item(p_work_item_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=public.current_app_user_id();
  v_role text:=public.current_app_role();
  v_status text;
begin
  if v_role not in ('admin','operations','finance','executive') then raise exception 'Not authorised'; end if;
  select status into v_status from public.work_items where id=p_work_item_id for update;
  if not found then raise exception 'Work item not found'; end if;
  update public.work_items
  set approval_status=case when p_accept then 'approved' else 'rejected' end,
      approved_by=v_actor,
      approved_at=now(),
      status=case when p_accept and v_status='waiting_approval' then 'completed' when not p_accept then 'blocked' else v_status end,
      completed_at=case when p_accept and v_status='waiting_approval' then now() else completed_at end
  where id=p_work_item_id;
end; $$;
grant execute on function public.review_work_item(uuid,boolean) to authenticated;

create or replace function public.log_work_item_review_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.approval_status is distinct from old.approval_status then
    insert into public.audit_events(actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,before_payload,after_payload)
    values(public.current_app_user_id(),public.current_app_role(),new.branch,'work_item',new.id,'work_item_reviewed',concat('Review result: ',new.approval_status),jsonb_build_object('approval_status',old.approval_status),jsonb_build_object('approval_status',new.approval_status));
  end if;
  return new;
end; $$;
drop trigger if exists log_work_item_review_change_trigger on public.work_items;
create trigger log_work_item_review_change_trigger after update of approval_status on public.work_items for each row execute function public.log_work_item_review_change();

notify pgrst,'reload schema';
