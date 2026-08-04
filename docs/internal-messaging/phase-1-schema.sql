-- DESIGN DRAFT ONLY. Do not apply to production directly.
-- Convert this file into a timestamped Supabase migration with the Supabase CLI
-- only after review and authenticated-role testing.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.message_threads (
  id uuid primary key default gen_random_uuid(),
  thread_type text not null check (thread_type in ('direct', 'group')),
  title text check (title is null or char_length(trim(title)) between 1 and 120),
  direct_key text unique,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  check (
    (thread_type = 'direct' and direct_key is not null and title is null)
    or (thread_type = 'group' and direct_key is null)
  )
);

create table public.message_thread_members (
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  is_muted boolean not null default false,
  archived_at timestamptz,
  primary key (thread_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid not null default public.current_app_user_id() references public.users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (sender_id, client_message_id),
  unique (thread_id, id)
);

create table public.message_read_positions (
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  last_read_message_id uuid,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id),
  foreign key (thread_id, last_read_message_id)
    references public.messages(thread_id, id)
    on delete set null (last_read_message_id)
);

create table public.message_audit_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  event_type text not null check (event_type in ('thread_created', 'member_added', 'member_removed')),
  target_user_id uuid references public.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index message_threads_activity_idx
  on public.message_threads (coalesce(last_message_at, updated_at, created_at) desc, id desc);
create index message_thread_members_user_idx
  on public.message_thread_members (user_id, removed_at, joined_at desc);
create index messages_thread_cursor_idx
  on public.messages (thread_id, created_at desc, id desc);
create index message_read_positions_user_idx
  on public.message_read_positions (user_id, updated_at desc);

create or replace function private.is_active_message_member(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.message_thread_members member
    join public.users app_user on app_user.id = member.user_id
    where member.thread_id = p_thread_id
      and member.user_id = p_user_id
      and member.removed_at is null
      and app_user.is_active = true
  );
$$;

revoke all on function private.is_active_message_member(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_active_message_member(uuid, uuid) to authenticated;

create or replace function public.create_direct_message_thread(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_user_id uuid := public.current_app_user_id();
  v_current_is_active boolean;
  v_direct_key text;
  v_thread_id uuid;
  v_other_is_active boolean;
begin
  if v_current_user_id is null then
    raise exception 'Authenticated ERP user is required';
  end if;

  select u.is_active
  into v_current_is_active
  from public.users u
  where u.id = v_current_user_id;

  if coalesce(v_current_is_active, false) is not true then
    raise exception 'The authenticated ERP user is not active';
  end if;

  if p_other_user_id is null or p_other_user_id = v_current_user_id then
    raise exception 'A different active ERP user is required';
  end if;

  select u.is_active
  into v_other_is_active
  from public.users u
  where u.id = p_other_user_id;

  if coalesce(v_other_is_active, false) is not true then
    raise exception 'The selected ERP user is not active';
  end if;

  v_direct_key := case
    when v_current_user_id::text < p_other_user_id::text
      then v_current_user_id::text || ':' || p_other_user_id::text
    else p_other_user_id::text || ':' || v_current_user_id::text
  end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_direct_key, 0));

  select thread.id
  into v_thread_id
  from public.message_threads thread
  where thread.direct_key = v_direct_key;

  if v_thread_id is null then
    insert into public.message_threads (thread_type, direct_key, created_by)
    values ('direct', v_direct_key, v_current_user_id)
    returning id into v_thread_id;

    insert into public.message_audit_events (
      thread_id,
      actor_user_id,
      event_type,
      metadata
    ) values (
      v_thread_id,
      v_current_user_id,
      'thread_created',
      pg_catalog.jsonb_build_object('thread_type', 'direct')
    );
  end if;

  insert into public.message_thread_members (
    thread_id,
    user_id,
    member_role,
    removed_at,
    archived_at
  ) values
    (v_thread_id, v_current_user_id, 'owner', null, null),
    (v_thread_id, p_other_user_id, 'member', null, null)
  on conflict (thread_id, user_id) do update
  set removed_at = null;

  return v_thread_id;
end;
$$;

revoke all on function public.create_direct_message_thread(uuid) from public, anon, authenticated;
grant execute on function public.create_direct_message_thread(uuid) to authenticated;

alter table public.message_threads enable row level security;
alter table public.message_thread_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_read_positions enable row level security;
alter table public.message_audit_events enable row level security;

revoke all on public.message_threads from public, anon, authenticated;
revoke all on public.message_thread_members from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;
revoke all on public.message_read_positions from public, anon, authenticated;
revoke all on public.message_audit_events from public, anon, authenticated;

grant select on public.message_threads to authenticated;
grant select on public.message_thread_members to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.message_read_positions to authenticated;
grant select on public.message_audit_events to authenticated;

create policy message_threads_select_member
on public.message_threads
for select
to authenticated
using (private.is_active_message_member(id, public.current_app_user_id()));

create policy message_members_select_member
on public.message_thread_members
for select
to authenticated
using (private.is_active_message_member(thread_id, public.current_app_user_id()));

create policy messages_select_member
on public.messages
for select
to authenticated
using (private.is_active_message_member(thread_id, public.current_app_user_id()));

create policy messages_insert_member
on public.messages
for insert
to authenticated
with check (
  sender_id = public.current_app_user_id()
  and private.is_active_message_member(thread_id, public.current_app_user_id())
);

create policy message_read_positions_select_owner
on public.message_read_positions
for select
to authenticated
using (
  user_id = public.current_app_user_id()
  and private.is_active_message_member(thread_id, public.current_app_user_id())
);

create policy message_read_positions_insert_owner
on public.message_read_positions
for insert
to authenticated
with check (
  user_id = public.current_app_user_id()
  and private.is_active_message_member(thread_id, public.current_app_user_id())
);

create policy message_read_positions_update_owner
on public.message_read_positions
for update
to authenticated
using (
  user_id = public.current_app_user_id()
  and private.is_active_message_member(thread_id, public.current_app_user_id())
)
with check (
  user_id = public.current_app_user_id()
  and private.is_active_message_member(thread_id, public.current_app_user_id())
);

create policy message_audit_select_member
on public.message_audit_events
for select
to authenticated
using (private.is_active_message_member(thread_id, public.current_app_user_id()));

-- Cursor query pattern: select newest page first, then render chronologically.
--
-- select * from (
--   select id, thread_id, sender_id, body, created_at
--   from public.messages
--   where thread_id = :thread_id
--     and (
--       :before_created_at is null
--       or (created_at, id) < (:before_created_at, :before_id)
--     )
--   order by created_at desc, id desc
--   limit least(greatest(:page_size, 1), 100)
-- ) page
-- order by created_at asc, id asc;

rollback;
