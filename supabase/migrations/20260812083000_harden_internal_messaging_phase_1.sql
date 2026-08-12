-- Harden Phase 1 internal messaging without widening private-conversation access.
--
-- Adds:
--   * column-scoped mute/archive updates for a member's own active membership row
--   * topic-scoped Realtime Broadcast + Presence authorization
--   * a minimal post-commit message signal on private thread:<uuid> topics
--
-- Message bodies remain authoritative in public.messages and are never included in
-- Presence or the database broadcast payload.

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

-- Emit a minimal private signal from the database after a durable message insert.
-- realtime.send writes to realtime.messages inside the same transaction; Realtime
-- observes it from WAL only after commit. Clients use the signal only to refetch the
-- authoritative message row under public.messages RLS.
create or replace function private.broadcast_committed_internal_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

revoke all on function private.broadcast_committed_internal_message() from public, anon, authenticated;

drop trigger if exists broadcast_committed_internal_message on public.messages;
create trigger broadcast_committed_internal_message
after insert on public.messages
for each row
execute function private.broadcast_committed_internal_message();
