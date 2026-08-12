-- Roll back only the Phase 1 messaging hardening added by
-- 20260812083000_harden_internal_messaging_phase_1.sql.

drop trigger if exists broadcast_committed_internal_message on public.messages;
drop function if exists private.broadcast_committed_internal_message();

drop policy if exists internal_messaging_realtime_thread_write on realtime.messages;
drop policy if exists internal_messaging_realtime_thread_read on realtime.messages;

drop policy if exists message_members_update_own_preferences on public.message_thread_members;
revoke update on public.message_thread_members from authenticated;
