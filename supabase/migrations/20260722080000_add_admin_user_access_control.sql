alter table public.users
  add column if not exists is_active boolean not null default true,
  add column if not exists access_note text,
  add column if not exists access_updated_by uuid references public.users(id) on delete set null,
  add column if not exists access_updated_at timestamptz;

update public.users
set is_active = true
where is_active is null;

create index if not exists users_active_email_idx
  on public.users (is_active, lower(email));

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where lower(u.email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.role
  from public.users u
  join public.user_details d on d.user_id = u.id
  where lower(u.email) = lower(auth.jwt() ->> 'email')
    and u.is_active = true
  limit 1;
$$;

create or replace function public.admin_list_user_access()
returns table(
  user_id uuid,
  email text,
  is_active boolean,
  access_note text,
  role text,
  branch text,
  first_name text,
  last_name text,
  phone_number text,
  birthday date,
  emergency_contact_name text,
  profile_complete boolean,
  created_at timestamptz,
  updated_at timestamptz,
  access_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_app_role() <> 'admin' then
    raise exception 'Only an Administrator may manage users and access rights' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email,
    u.is_active,
    u.access_note,
    d.role,
    d.branch,
    d.first_name,
    d.last_name,
    d.phone_number,
    d.birthday,
    d.emergency_contact_name,
    (
      nullif(trim(coalesce(d.first_name, '')), '') is not null
      and nullif(trim(coalesce(d.last_name, '')), '') is not null
      and nullif(trim(coalesce(d.phone_number, '')), '') is not null
      and d.birthday is not null
      and nullif(trim(coalesce(d.emergency_contact_name, '')), '') is not null
      and nullif(trim(coalesce(d.emergency_contact_phone, '')), '') is not null
    ) as profile_complete,
    u.created_at,
    greatest(u.updated_at, coalesce(d.updated_at, u.updated_at)),
    u.access_updated_at
  from public.users u
  left join public.user_details d on d.user_id = u.id
  order by u.is_active desc, coalesce(d.first_name, ''), coalesce(d.last_name, ''), u.email;
end;
$$;

create or replace function public.admin_update_user_access(
  p_user_id uuid,
  p_role text,
  p_branch text,
  p_is_active boolean,
  p_access_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_target public.users%rowtype;
  v_old_role text;
  v_old_branch text;
  v_active_admins integer;
begin
  if v_actor is null or v_actor_role <> 'admin' then
    raise exception 'Only an Administrator may change users, roles or access rights' using errcode = '42501';
  end if;

  if p_role not in ('admin','operations','sales','finance','marketing','executive','warehouse_staff','technician','road_technician') then
    raise exception 'Invalid ERP role';
  end if;

  if p_branch not in ('jhb','cpt','kzn','national') then
    raise exception 'Invalid ERP branch';
  end if;

  select * into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null then
    raise exception 'User access record not found';
  end if;

  select d.role, d.branch
    into v_old_role, v_old_branch
  from public.user_details d
  where d.user_id = p_user_id;

  if p_user_id = v_actor and (p_role <> 'admin' or coalesce(p_is_active, false) = false) then
    raise exception 'You cannot remove your own Administrator rights or suspend your own access while signed in';
  end if;

  if v_old_role = 'admin' and v_target.is_active = true
     and (p_role <> 'admin' or coalesce(p_is_active, false) = false) then
    select count(*) into v_active_admins
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.is_active = true and d.role = 'admin';

    if v_active_admins <= 1 then
      raise exception 'The final active Administrator cannot be demoted or suspended';
    end if;
  end if;

  update public.users
  set is_active = coalesce(p_is_active, false),
      access_note = nullif(trim(coalesce(p_access_note, '')), ''),
      access_updated_by = v_actor,
      access_updated_at = now(),
      updated_at = now()
  where id = p_user_id;

  insert into public.user_details (user_id, role, branch, updated_at)
  values (p_user_id, p_role, p_branch, now())
  on conflict (user_id) do update
  set role = excluded.role,
      branch = excluded.branch,
      updated_at = now();

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id,
    action, summary, before_payload, after_payload, metadata
  ) values (
    v_actor, v_actor_role, p_branch, 'user_access', p_user_id,
    'user_access_updated',
    concat('Updated access for ', v_target.email),
    jsonb_build_object(
      'role', v_old_role,
      'branch', v_old_branch,
      'is_active', v_target.is_active,
      'access_note', v_target.access_note
    ),
    jsonb_build_object(
      'role', p_role,
      'branch', p_branch,
      'is_active', coalesce(p_is_active, false),
      'access_note', nullif(trim(coalesce(p_access_note, '')), '')
    ),
    jsonb_build_object('email', v_target.email)
  );
end;
$$;

create or replace function public.admin_create_user_access(
  p_email text,
  p_role text,
  p_branch text,
  p_is_active boolean default true,
  p_access_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user_id uuid;
begin
  if v_actor is null or v_actor_role <> 'admin' then
    raise exception 'Only an Administrator may add users and assign rights' using errcode = '42501';
  end if;

  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'Enter a valid email address';
  end if;

  insert into public.users (email, is_active, access_note, access_updated_by, access_updated_at, updated_at)
  values (v_email, coalesce(p_is_active, true), nullif(trim(coalesce(p_access_note, '')), ''), v_actor, now(), now())
  on conflict (email) do update
  set updated_at = now()
  returning id into v_user_id;

  perform public.admin_update_user_access(v_user_id, p_role, p_branch, coalesce(p_is_active, true), p_access_note);
  return v_user_id;
end;
$$;

create or replace function public.admin_delete_user_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_role text := public.current_app_role();
  v_target public.users%rowtype;
  v_target_role text;
  v_active_admins integer;
begin
  if v_actor is null or v_actor_role <> 'admin' then
    raise exception 'Only an Administrator may delete user access records' using errcode = '42501';
  end if;

  if p_user_id = v_actor then
    raise exception 'You cannot delete your own active Administrator access while signed in';
  end if;

  select * into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null then
    raise exception 'User access record not found';
  end if;

  select role into v_target_role
  from public.user_details
  where user_id = p_user_id;

  if v_target_role = 'admin' and v_target.is_active = true then
    select count(*) into v_active_admins
    from public.users u
    join public.user_details d on d.user_id = u.id
    where u.is_active = true and d.role = 'admin';

    if v_active_admins <= 1 then
      raise exception 'The final active Administrator cannot be deleted';
    end if;
  end if;

  begin
    delete from public.users where id = p_user_id;
  exception when foreign_key_violation then
    raise exception 'This user has operational history and cannot be permanently deleted. Suspend access instead.' using errcode = '23503';
  end;

  insert into public.audit_events (
    actor_user_id, actor_role, branch, entity_type, entity_id,
    action, summary, before_payload, metadata
  ) values (
    v_actor, v_actor_role, null, 'user_access', p_user_id,
    'user_access_deleted',
    concat('Deleted unused access record for ', v_target.email),
    jsonb_build_object(
      'email', v_target.email,
      'role', v_target_role,
      'is_active', v_target.is_active,
      'access_note', v_target.access_note
    ),
    jsonb_build_object('email', v_target.email)
  );
end;
$$;

revoke all on function public.admin_list_user_access() from public;
revoke all on function public.admin_update_user_access(uuid,text,text,boolean,text) from public;
revoke all on function public.admin_create_user_access(text,text,text,boolean,text) from public;
revoke all on function public.admin_delete_user_access(uuid) from public;

grant execute on function public.admin_list_user_access() to authenticated;
grant execute on function public.admin_update_user_access(uuid,text,text,boolean,text) to authenticated;
grant execute on function public.admin_create_user_access(text,text,text,boolean,text) to authenticated;
grant execute on function public.admin_delete_user_access(uuid) to authenticated;
