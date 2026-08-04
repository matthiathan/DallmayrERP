-- Internal ERP messaging with private image and document attachments.
-- Conversations are visible only to their participants; files live in a
-- private Supabase Storage bucket and are served through signed URLs.

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  thread_type text not null default 'direct' check (thread_type in ('direct','group')),
  title text check (title is null or char_length(trim(title)) between 1 and 120),
  created_by uuid not null references public.users(id) on delete restrict,
  is_archived boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_thread_participants (
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  participant_role text not null default 'member' check (participant_role in ('owner','member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  is_muted boolean not null default false,
  primary key (thread_id,user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete restrict,
  body text check (body is null or char_length(trim(body)) between 1 and 4000),
  message_type text not null default 'text' check (message_type in ('text','image','document','mixed','system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  bucket_id text not null default 'dallmayrerp-message-attachments',
  file_path text not null unique,
  file_name text not null check (char_length(trim(file_name)) between 1 and 255),
  content_type text not null,
  file_size integer not null check (file_size > 0 and file_size <= 26214400),
  uploaded_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists message_threads_last_message_idx
  on public.message_threads (coalesce(last_message_at, updated_at, created_at) desc);
create index if not exists message_thread_participants_user_idx
  on public.message_thread_participants (user_id, joined_at desc);
create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at desc);
create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id, created_at);

alter table public.message_threads enable row level security;
alter table public.message_thread_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

revoke all on table public.message_threads from public, anon, authenticated;
revoke all on table public.message_thread_participants from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;
revoke all on table public.message_attachments from public, anon, authenticated;

grant select on table public.message_threads to authenticated;
grant select on table public.message_thread_participants to authenticated;
grant select on table public.messages to authenticated;
grant select on table public.message_attachments to authenticated;

create or replace function public.is_message_thread_participant(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.message_thread_participants p
    join public.users u on u.id = p.user_id
    where p.thread_id = p_thread_id
      and p.user_id = p_user_id
      and u.is_active = true
  );
$$;

create or replace function public.can_manage_message_thread(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.message_threads t
    left join public.message_thread_participants p
      on p.thread_id = t.id
     and p.user_id = p_user_id
     and p.participant_role = 'owner'
    where t.id = p_thread_id
      and (t.created_by = p_user_id or p.user_id = p_user_id)
  );
$$;

drop policy if exists message_threads_select_participant on public.message_threads;
create policy message_threads_select_participant
on public.message_threads
for select
to authenticated
using (public.is_message_thread_participant(id, public.current_app_user_id()));

drop policy if exists message_thread_participants_select_thread on public.message_thread_participants;
create policy message_thread_participants_select_thread
on public.message_thread_participants
for select
to authenticated
using (public.is_message_thread_participant(thread_id, public.current_app_user_id()));

drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant
on public.messages
for select
to authenticated
using (public.is_message_thread_participant(thread_id, public.current_app_user_id()));

drop policy if exists message_attachments_select_participant on public.message_attachments;
create policy message_attachments_select_participant
on public.message_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_attachments.message_id
      and public.is_message_thread_participant(m.thread_id, public.current_app_user_id())
  )
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'dallmayrerp-message-attachments',
  'dallmayrerp-message-attachments',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
on conflict(id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists message_attachments_storage_read on storage.objects;
create policy message_attachments_storage_read
on storage.objects
for select
to authenticated
using (bucket_id = 'dallmayrerp-message-attachments' and public.current_app_role() is not null);

drop policy if exists message_attachments_storage_insert on storage.objects;
create policy message_attachments_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'dallmayrerp-message-attachments'
  and public.current_app_role() is not null
  and (storage.foldername(name))[1] = public.current_app_user_id()::text
);

drop policy if exists message_attachments_storage_delete on storage.objects;
create policy message_attachments_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'dallmayrerp-message-attachments'
  and (
    public.current_app_role() = 'admin'
    or (storage.foldername(name))[1] = public.current_app_user_id()::text
  )
);

create or replace function public.list_messaging_users()
returns table(
  id uuid,
  display_name text,
  email text,
  role text,
  branch text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email) as display_name,
    u.email,
    d.role::text,
    d.branch::text
  from public.users u
  join public.user_details d on d.user_id = u.id
  where u.is_active = true
  order by display_name, u.email;
end;
$$;

create or replace function public.list_message_threads()
returns table(
  id uuid,
  title text,
  thread_type text,
  participant_count integer,
  last_message_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz,
  last_message_body text,
  last_message_sender_id uuid,
  last_message_sender_name text,
  last_message_created_at timestamptz,
  unread_count integer,
  participant_names text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    coalesce(t.title, nullif(names.other_names, ''), 'Saved notes') as title,
    t.thread_type,
    names.participant_count,
    t.last_message_at,
    t.updated_at,
    t.created_at,
    lm.body as last_message_body,
    lm.sender_id as last_message_sender_id,
    lm.sender_name as last_message_sender_name,
    lm.created_at as last_message_created_at,
    unread.total as unread_count,
    names.all_names as participant_names
  from public.message_threads t
  join public.message_thread_participants self
    on self.thread_id = t.id
   and self.user_id = v_actor
  left join lateral (
    select
      count(*)::integer as participant_count,
      string_agg(coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email), ', ' order by coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email)) as all_names,
      string_agg(coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email), ', ' order by coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email)) filter (where p.user_id <> v_actor) as other_names
    from public.message_thread_participants p
    join public.users u on u.id = p.user_id
    left join public.user_details d on d.user_id = p.user_id
    where p.thread_id = t.id
  ) names on true
  left join lateral (
    select
      m.body,
      m.sender_id,
      coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email) as sender_name,
      m.created_at
    from public.messages m
    join public.users u on u.id = m.sender_id
    left join public.user_details d on d.user_id = m.sender_id
    where m.thread_id = t.id
      and m.deleted_at is null
    order by m.created_at desc
    limit 1
  ) lm on true
  left join lateral (
    select count(*)::integer as total
    from public.messages m
    where m.thread_id = t.id
      and m.sender_id <> v_actor
      and m.deleted_at is null
      and m.created_at > coalesce(self.last_read_at, 'epoch'::timestamptz)
  ) unread on true
  where t.is_archived = false
  order by coalesce(t.last_message_at, t.updated_at, t.created_at) desc;
end;
$$;

create or replace function public.list_thread_messages(p_thread_id uuid)
returns table(
  id uuid,
  thread_id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  message_type text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  attachments jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  if not public.is_message_thread_participant(p_thread_id, v_actor) then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.thread_id,
    m.sender_id,
    coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email) as sender_name,
    case when m.deleted_at is null then m.body else null end as body,
    m.message_type,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'file_path', a.file_path,
          'file_name', a.file_name,
          'content_type', a.content_type,
          'file_size', a.file_size,
          'created_at', a.created_at
        )
        order by a.created_at
      )
      from public.message_attachments a
      where a.message_id = m.id
    ), '[]'::jsonb) as attachments
  from public.messages m
  join public.users u on u.id = m.sender_id
  left join public.user_details d on d.user_id = m.sender_id
  where m.thread_id = p_thread_id
  order by m.created_at asc
  limit 500;
end;
$$;

create or replace function public.create_message_thread(p_participant_ids uuid[], p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_participants uuid[];
  v_participant_count integer;
  v_thread_id uuid;
  v_thread_type text;
  v_title text := nullif(trim(coalesce(p_title, '')), '');
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct u.id), array[]::uuid[])
    into v_participants
  from public.users u
  where u.is_active = true
    and u.id = any(coalesce(p_participant_ids, array[]::uuid[]) || array[v_actor]::uuid[]);

  v_participant_count := coalesce(array_length(v_participants, 1), 0);
  if v_participant_count < 2 then
    raise exception 'Select at least one active colleague';
  end if;
  if v_participant_count > 50 then
    raise exception 'A conversation can include at most 50 participants';
  end if;

  v_thread_type := case when v_participant_count = 2 and v_title is null then 'direct' else 'group' end;

  insert into public.message_threads(thread_type, title, created_by, last_message_at)
  values(v_thread_type, v_title, v_actor, now())
  returning id into v_thread_id;

  insert into public.message_thread_participants(thread_id, user_id, participant_role, last_read_at)
  select
    v_thread_id,
    participant_id,
    case when participant_id = v_actor then 'owner' else 'member' end,
    case when participant_id = v_actor then now() else null end
  from unnest(v_participants) as participant(participant_id);

  insert into public.messages(thread_id, sender_id, body, message_type, metadata)
  values(
    v_thread_id,
    v_actor,
    case when v_thread_type = 'direct' then 'Conversation started.' else 'Group conversation started.' end,
    'system',
    jsonb_build_object('participant_count', v_participant_count)
  );

  update public.message_threads
  set updated_at = now(),
      last_message_at = now()
  where id = v_thread_id;

  return v_thread_id;
end;
$$;

create or replace function public.send_thread_message(p_thread_id uuid, p_body text default null, p_message_type text default 'text')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_type text := lower(trim(coalesce(p_message_type, 'text')));
  v_message_id uuid;
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  if v_type not in ('text','image','document','mixed') then
    raise exception 'Unsupported message type';
  end if;

  if v_type = 'text' and v_body is null then
    raise exception 'Enter a message or attach a file';
  end if;

  if not public.is_message_thread_participant(p_thread_id, v_actor) then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;

  if exists (select 1 from public.message_threads t where t.id = p_thread_id and t.is_archived = true) then
    raise exception 'This conversation is archived';
  end if;

  insert into public.messages(thread_id, sender_id, body, message_type)
  values(p_thread_id, v_actor, v_body, v_type)
  returning id into v_message_id;

  update public.message_threads
  set last_message_at = now(),
      updated_at = now()
  where id = p_thread_id;

  update public.message_thread_participants
  set last_read_at = now()
  where thread_id = p_thread_id
    and user_id = v_actor;

  return v_message_id;
end;
$$;

create or replace function public.create_message_attachment(
  p_message_id uuid,
  p_file_path text,
  p_file_name text,
  p_content_type text,
  p_file_size integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_thread_id uuid;
  v_sender_id uuid;
  v_path text := trim(coalesce(p_file_path, ''));
  v_name text := trim(coalesce(p_file_name, ''));
  v_type text := lower(trim(coalesce(p_content_type, '')));
  v_attachment_id uuid;
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  select m.thread_id, m.sender_id
    into v_thread_id, v_sender_id
  from public.messages m
  where m.id = p_message_id;

  if v_thread_id is null then
    raise exception 'Message not found';
  end if;
  if v_sender_id <> v_actor then
    raise exception 'Only the message sender can attach files to this message' using errcode = '42501';
  end if;
  if not public.is_message_thread_participant(v_thread_id, v_actor) then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;
  if v_path = '' or v_path like '/%' or v_path like '%..%' or split_part(v_path, '/', 1) <> v_actor::text then
    raise exception 'Attachment path is not valid';
  end if;
  if v_name = '' or char_length(v_name) > 255 then
    raise exception 'Attachment file name is not valid';
  end if;
  if p_file_size <= 0 or p_file_size > 26214400 then
    raise exception 'Attachments must be 25 MB or smaller';
  end if;
  if v_type not in (
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ) then
    raise exception 'This file type is not allowed';
  end if;

  insert into public.message_attachments(message_id, file_path, file_name, content_type, file_size, uploaded_by)
  values(p_message_id, v_path, v_name, v_type, p_file_size, v_actor)
  returning id into v_attachment_id;

  update public.messages
  set message_type = case
    when nullif(trim(coalesce(body, '')), '') is not null then 'mixed'
    when v_type like 'image/%' then 'image'
    else 'document'
  end
  where id = p_message_id;

  update public.message_threads
  set updated_at = now(),
      last_message_at = coalesce(last_message_at, now())
  where id = v_thread_id;

  return v_attachment_id;
end;
$$;

create or replace function public.mark_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  update public.message_thread_participants
  set last_read_at = now()
  where thread_id = p_thread_id
    and user_id = v_actor;

  if not found then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.is_message_thread_participant(uuid,uuid) from public, anon;
revoke all on function public.can_manage_message_thread(uuid,uuid) from public, anon;
revoke all on function public.list_messaging_users() from public, anon;
revoke all on function public.list_message_threads() from public, anon;
revoke all on function public.list_thread_messages(uuid) from public, anon;
revoke all on function public.create_message_thread(uuid[],text) from public, anon;
revoke all on function public.send_thread_message(uuid,text,text) from public, anon;
revoke all on function public.create_message_attachment(uuid,text,text,text,integer) from public, anon;
revoke all on function public.mark_thread_read(uuid) from public, anon;

grant execute on function public.is_message_thread_participant(uuid,uuid) to authenticated;
grant execute on function public.can_manage_message_thread(uuid,uuid) to authenticated;
grant execute on function public.list_messaging_users() to authenticated;
grant execute on function public.list_message_threads() to authenticated;
grant execute on function public.list_thread_messages(uuid) to authenticated;
grant execute on function public.create_message_thread(uuid[],text) to authenticated;
grant execute on function public.send_thread_message(uuid,text,text) to authenticated;
grant execute on function public.create_message_attachment(uuid,text,text,text,integer) to authenticated;
grant execute on function public.mark_thread_read(uuid) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.message_threads;
  exception when duplicate_object or undefined_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.message_thread_participants;
  exception when duplicate_object or undefined_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object or undefined_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.message_attachments;
  exception when duplicate_object or undefined_object then
    null;
  end;
end;
$$;

comment on table public.message_threads
  is 'Internal company messaging conversations for separating ERP communication from social channels.';
comment on table public.messages
  is 'Messages sent by active ERP users inside authorized conversations.';
comment on table public.message_attachments
  is 'Private image and document attachments linked to internal ERP messages.';
