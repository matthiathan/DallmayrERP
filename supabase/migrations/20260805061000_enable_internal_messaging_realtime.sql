-- Publish Phase 1 messaging tables through Supabase Realtime.
-- Postgres remains authoritative; clients use changes only as reconciliation signals.

do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'supabase_realtime publication does not exist';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_threads'
  ) then
    alter publication supabase_realtime add table public.message_threads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_thread_members'
  ) then
    alter publication supabase_realtime add table public.message_thread_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_read_positions'
  ) then
    alter publication supabase_realtime add table public.message_read_positions;
  end if;
end;
$$;
