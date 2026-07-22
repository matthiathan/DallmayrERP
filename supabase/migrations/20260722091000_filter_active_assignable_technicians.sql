create or replace function public.list_assignable_technicians()
returns table(user_id uuid, display_name text, role text, branch text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_role text := public.current_app_role();
  v_actor_branch text;
begin
  if v_actor_role not in ('admin', 'operations', 'executive') then
    raise exception 'You are not authorised to view technician assignments';
  end if;

  select d.branch into v_actor_branch
  from public.user_details d
  where d.user_id = public.current_app_user_id();

  return query
  select
    d.user_id,
    trim(concat_ws(' ', d.first_name, d.last_name)) as display_name,
    d.role,
    d.branch
  from public.users u
  join public.user_details d on d.user_id = u.id
  where u.is_active = true
    and d.role in ('technician', 'road_technician')
    and (
      v_actor_role <> 'operations'
      or coalesce(v_actor_branch, 'national') = 'national'
      or d.branch = v_actor_branch
    )
  order by d.branch, d.first_name, d.last_name;
end;
$$;
