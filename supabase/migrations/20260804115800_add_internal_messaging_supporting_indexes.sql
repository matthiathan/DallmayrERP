-- Add covering indexes for Phase 1 messaging foreign keys flagged by Supabase advisors.

create index if not exists message_threads_created_by_idx
  on public.message_threads (created_by);

create index if not exists message_audit_events_thread_idx
  on public.message_audit_events (thread_id, created_at desc);

create index if not exists message_audit_events_actor_idx
  on public.message_audit_events (actor_user_id, created_at desc);

create index if not exists message_audit_events_target_idx
  on public.message_audit_events (target_user_id, created_at desc)
  where target_user_id is not null;

create index if not exists message_read_positions_message_idx
  on public.message_read_positions (thread_id, last_read_message_id)
  where last_read_message_id is not null;
