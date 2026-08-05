-- Remove Phase 1 messaging tables from Supabase Realtime publication only.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_read_positions'
    ) then
      alter publication supabase_realtime drop table public.message_read_positions;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime drop table public.messages;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_thread_members'
    ) then
      alter publication supabase_realtime drop table public.message_thread_members;
    end if;

    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_threads'
    ) then
      alter publication supabase_realtime drop table public.message_threads;
    end if;
  end if;
end;
$$;
