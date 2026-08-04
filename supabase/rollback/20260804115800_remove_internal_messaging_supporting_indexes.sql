-- Remove only the Phase 1 messaging supporting indexes.

drop index if exists public.message_read_positions_message_idx;
drop index if exists public.message_audit_events_target_idx;
drop index if exists public.message_audit_events_actor_idx;
drop index if exists public.message_audit_events_thread_idx;
drop index if exists public.message_threads_created_by_idx;
