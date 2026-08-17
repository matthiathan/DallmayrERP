-- Harden Phase 1 internal messaging without widening private-conversation access.
--
-- Adds:
--   * a minimal active-employee directory RPC for messaging discovery
--   * column-scoped mute/archive updates for a member's own active membership row
--   * topic-scoped Realtime Broadcast + Presence authorization
--   * reliable thread activity timestamps on committed messages
--   * a minimal post-commit message signal on private thread:<uuid> topics
--
-- Message bodies remain authoritative in public.messages and are never included in
-- Presence or the database broadcast payload. The directory deliberately exposes
-- only the fields needed to address another active employee; broader profile data
-- remains protected by the existing users/user_details RLS policies.

create or replace function public.list_internal_messaging_directory()
returns table(
  user_id uuid,
  email text,
  first_name text,
  last_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current_user_id uuid := public.current_app_user_id();
begin
  if v_current_user_id is null or not exists (
    select 1
    from public.users caller
    where caller.id = v_current_user_id
      and caller.is_active = true
  ) then
    raise exception 'An active authenticated ERP user is required'
      using errcode = '42501';
  end if;

  return query
  select
    app_user.id,
    app_user.email,
    details.first_name,
    details.last_name
  from public.users app_user
  left join public.user_details details on details.user_id = app_user.id
  where app_user.is_active = true
  order by
    pg_catalog.lower(pg_catalog.coalesce(details.first_name, '')),
    pg_catalog.lower(pg_catalog.coalesce(details.last_name, '')),
    pg_catalog.lower(app_user.email),
    app_user.id
  limit 1000;
end;
$$;

revoke all on function public.list_internal_messaging_directory() from public, anon, authenticated;
grant execute on function public.list_internal_messaging_directory() to authenticated;

-- The base migration intentionally granted SELECT only on memberships. Allow users
-- to change only their own personal mute/archive fields; do not grant UPDATE on role,
-- removal, join time, thread id or user id.
revoke update on public.message_thread_members from authenticated;
grant update (is_muted, archived_at) on public.message_thread_members to authenticated;

drop policy if exists message_members_update_own_preferences on public.message_thread_members;
create policy message_members_update_own_preferences
on public.message_thread_members
for update
to authenticated
using (
  user_id = public.current_app_user_id()
  and removed_at is null
  and private.is_active_message_member(thread_id, public.current_app_user_id())
)
with check (
  user_id = public.current_app_user_id()
  and removed_at is null
  and private.is_active_message_member(thread_id, public.current_app_user_id())
);

-- Realtime Authorization is evaluated against realtime.messages when a private
-- Broadcast/Presence channel is joined. A user may read/write only a thread topic
-- for which they are an active ERP member. Comparing the topic as text avoids
-- casting arbitrary client-supplied topic strings to uuid.
drop policy if exists internal_messaging_realtime_thread_read on realtime.messages;
create policy internal_messaging_realtime_thread_read
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.message_thread_members member
    where member.user_id = public.current_app_user_id()
      and member.removed_at is null
      and ('thread:' || member.thread_id::text) = (select realtime.topic())
      and private.is_active_message_member(member.thread_id, public.current_app_user_id())
  )
);

drop policy if exists internal_messaging_realtime_thread_write on realtime.messages;
create policy internal_messaging_realtime_thread_write
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.message_thread_members member
    where member.user_id = public.current_app_user_id()
      and member.removed_at is null
      and ('thread:' || member.thread_id::text) = (select realtime.topic())
      and private.is_active_message_member(member.thread_id, public.current_app_user_id())
  )
);

-- Advance the thread activity timestamp and emit a minimal private signal after a
-- durable message insert. realtime.send writes to realtime.messages inside the same
-- transaction; Realtime observes it from WAL only after commit. Clients use the
-- signal only to refetch the authoritative message row under public.messages RLS.
create or replace function private.handle_committed_internal_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.message_threads
  set
    last_message_at = case
      when last_message_at is null or new.created_at > last_message_at then new.created_at
      else last_message_at
    end,
    updated_at = pg_catalog.now()
  where id = new.thread_id;

  perform realtime.send(
    pg_catalog.jsonb_build_object(
      'thread_id', new.thread_id,
      'message_id', new.id,
      'created_at', new.created_at
    ),
    'message_committed',
    'thread:' || new.thread_id::text,
    true
  );

  return new;
end;
$$;

revoke all on function private.handle_committed_internal_message() from public, anon, authenticated;

drop trigger if exists handle_committed_internal_message on public.messages;
create trigger handle_committed_internal_message
after insert on public.messages
for each row
execute function private.handle_committed_internal_message();
