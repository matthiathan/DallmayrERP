-- Roll back Phase 1 internal messaging objects only.

revoke execute on function public.create_group_message_thread(text, uuid[]) from authenticated;
revoke execute on function public.create_direct_message_thread(uuid) from authenticated;
revoke execute on function private.is_active_message_member(uuid, uuid) from authenticated;

drop function if exists public.create_group_message_thread(text, uuid[]);
drop function if exists public.create_direct_message_thread(uuid);

drop table if exists public.message_read_positions;
drop table if exists public.message_audit_events;
drop table if exists public.messages;
drop table if exists public.message_thread_members;
drop table if exists public.message_threads;

drop function if exists private.is_active_message_member(uuid, uuid);
