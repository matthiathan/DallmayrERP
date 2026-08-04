-- DESIGN DRAFT ONLY. Do not apply to production directly.
-- This function is intended to be incorporated into the eventual reviewed migration.

create or replace function public.create_group_message_thread(
  p_title text,
  p_member_user_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_user_id uuid := public.current_app_user_id();
  v_thread_id uuid;
  v_member_ids uuid[];
  v_invalid_count integer;
  v_current_is_active boolean;
begin
  select u.is_active
  into v_current_is_active
  from public.users u
  where u.id = v_current_user_id;

  if v_current_user_id is null or coalesce(v_current_is_active, false) is not true then
    raise exception 'An active authenticated ERP user is required';
  end if;

  if p_title is null or char_length(trim(p_title)) not between 1 and 120 then
    raise exception 'Group title must contain between 1 and 120 characters';
  end if;

  select coalesce(array_agg(distinct member_id order by member_id), '{}'::uuid[])
  into v_member_ids
  from unnest(coalesce(p_member_user_ids, '{}'::uuid[])) as member_id
  where member_id is not null
    and member_id <> v_current_user_id;

  if cardinality(v_member_ids) < 1 then
    raise exception 'At least one other active ERP user is required';
  end if;

  if cardinality(v_member_ids) > 49 then
    raise exception 'A group may contain at most 50 users including the owner';
  end if;

  select count(*)
  into v_invalid_count
  from unnest(v_member_ids) as requested_user_id
  left join public.users app_user
    on app_user.id = requested_user_id
   and app_user.is_active = true
  where app_user.id is null;

  if v_invalid_count > 0 then
    raise exception 'Every selected member must be an active ERP user';
  end if;

  insert into public.message_threads (
    thread_type,
    title,
    direct_key,
    created_by
  ) values (
    'group',
    trim(p_title),
    null,
    v_current_user_id
  )
  returning id into v_thread_id;

  insert into public.message_thread_members (
    thread_id,
    user_id,
    member_role
  )
  values (
    v_thread_id,
    v_current_user_id,
    'owner'
  );

  insert into public.message_thread_members (
    thread_id,
    user_id,
    member_role
  )
  select
    v_thread_id,
    member_id,
    'member'
  from unnest(v_member_ids) as member_id;

  insert into public.message_audit_events (
    thread_id,
    actor_user_id,
    event_type,
    metadata
  ) values (
    v_thread_id,
    v_current_user_id,
    'thread_created',
    pg_catalog.jsonb_build_object(
      'thread_type', 'group',
      'member_count', cardinality(v_member_ids) + 1
    )
  );

  return v_thread_id;
end;
$$;

revoke all on function public.create_group_message_thread(text, uuid[]) from public, anon, authenticated;
grant execute on function public.create_group_message_thread(text, uuid[]) to authenticated;
