-- Expand internal messaging into a fuller instant messaging workspace:
-- replies, reactions, saved messages, pins, edit/delete, per-user mute/archive
-- state, stricter attachment reads and read receipt summaries.

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null;

alter table public.message_thread_participants
  add column if not exists archived_at timestamptz,
  add column if not exists muted_until timestamptz;

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  reaction text not null check (reaction in ('thumbs_up','check','eyes','heart','urgent')),
  created_at timestamptz not null default now(),
  unique (message_id,user_id,reaction)
);

create table if not exists public.message_saved_items (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id,user_id)
);

create table if not exists public.message_pins (
  message_id uuid primary key references public.messages(id) on delete cascade,
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  pinned_by uuid not null references public.users(id) on delete restrict,
  pinned_at timestamptz not null default now()
);

create index if not exists messages_reply_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;
create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id, created_at);
create index if not exists message_saved_items_user_idx
  on public.message_saved_items (user_id, created_at desc);
create index if not exists message_pins_thread_idx
  on public.message_pins (thread_id, pinned_at desc);

alter table public.message_reactions enable row level security;
alter table public.message_saved_items enable row level security;
alter table public.message_pins enable row level security;

revoke all on table public.message_reactions from public, anon, authenticated;
revoke all on table public.message_saved_items from public, anon, authenticated;
revoke all on table public.message_pins from public, anon, authenticated;

grant select on table public.message_reactions to authenticated;
grant select on table public.message_saved_items to authenticated;
grant select on table public.message_pins to authenticated;

drop policy if exists message_reactions_select_participant on public.message_reactions;
create policy message_reactions_select_participant
on public.message_reactions
for select
to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_reactions.message_id
      and public.is_message_thread_participant(m.thread_id, public.current_app_user_id())
  )
);

drop policy if exists message_saved_items_select_owner on public.message_saved_items;
create policy message_saved_items_select_owner
on public.message_saved_items
for select
to authenticated
using (user_id = public.current_app_user_id());

drop policy if exists message_pins_select_participant on public.message_pins;
create policy message_pins_select_participant
on public.message_pins
for select
to authenticated
using (public.is_message_thread_participant(thread_id, public.current_app_user_id()));

drop policy if exists message_attachments_storage_read on storage.objects;
create policy message_attachments_storage_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dallmayrerp-message-attachments'
  and exists (
    select 1
    from public.message_attachments a
    join public.messages m on m.id = a.message_id
    where a.file_path = storage.objects.name
      and public.is_message_thread_participant(m.thread_id, public.current_app_user_id())
  )
);

drop function if exists public.list_message_threads();
create function public.list_message_threads(p_include_archived boolean default false)
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
  participant_names text,
  is_muted boolean,
  archived_at timestamptz,
  pinned_count integer,
  saved_count integer
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
    names.all_names as participant_names,
    self.is_muted or (self.muted_until is not null and self.muted_until > now()) as is_muted,
    self.archived_at,
    coalesce(pin_totals.total, 0) as pinned_count,
    coalesce(saved_totals.total, 0) as saved_count
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
  left join lateral (
    select count(*)::integer as total
    from public.message_pins p
    where p.thread_id = t.id
  ) pin_totals on true
  left join lateral (
    select count(*)::integer as total
    from public.message_saved_items s
    join public.messages m on m.id = s.message_id
    where s.user_id = v_actor
      and m.thread_id = t.id
  ) saved_totals on true
  where t.is_archived = false
    and (p_include_archived or self.archived_at is null)
  order by coalesce(t.last_message_at, t.updated_at, t.created_at) desc;
end;
$$;

drop function if exists public.list_thread_messages(uuid);
create function public.list_thread_messages(p_thread_id uuid)
returns table(
  id uuid,
  thread_id uuid,
  sender_id uuid,
  sender_name text,
  body text,
  message_type text,
  reply_to_message_id uuid,
  reply_to_body text,
  reply_to_sender_name text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  read_by_count integer,
  read_by_names text,
  saved_by_me boolean,
  pinned_at timestamptz,
  pinned_by_name text,
  reactions jsonb,
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
    coalesce(nullif(trim(concat_ws(' ', sender_details.first_name, sender_details.last_name)), ''), sender.email) as sender_name,
    case when m.deleted_at is null then m.body else null end as body,
    m.message_type,
    m.reply_to_message_id,
    case when reply.id is not null and reply.deleted_at is null then reply.body else null end as reply_to_body,
    coalesce(nullif(trim(concat_ws(' ', reply_details.first_name, reply_details.last_name)), ''), reply_user.email) as reply_to_sender_name,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    coalesce(reads.total, 0) as read_by_count,
    reads.names as read_by_names,
    exists (
      select 1
      from public.message_saved_items saved
      where saved.message_id = m.id
        and saved.user_id = v_actor
    ) as saved_by_me,
    pin.pinned_at,
    coalesce(nullif(trim(concat_ws(' ', pin_details.first_name, pin_details.last_name)), ''), pin_user.email) as pinned_by_name,
    coalesce(reaction_totals.reactions, '[]'::jsonb) as reactions,
    coalesce(attachments.items, '[]'::jsonb) as attachments
  from public.messages m
  join public.users sender on sender.id = m.sender_id
  left join public.user_details sender_details on sender_details.user_id = m.sender_id
  left join public.messages reply on reply.id = m.reply_to_message_id
  left join public.users reply_user on reply_user.id = reply.sender_id
  left join public.user_details reply_details on reply_details.user_id = reply.sender_id
  left join public.message_pins pin on pin.message_id = m.id
  left join public.users pin_user on pin_user.id = pin.pinned_by
  left join public.user_details pin_details on pin_details.user_id = pin.pinned_by
  left join lateral (
    select
      count(*)::integer as total,
      string_agg(coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email), ', ' order by coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), u.email)) as names
    from public.message_thread_participants p
    join public.users u on u.id = p.user_id
    left join public.user_details d on d.user_id = p.user_id
    where p.thread_id = m.thread_id
      and p.user_id <> m.sender_id
      and p.last_read_at is not null
      and p.last_read_at >= m.created_at
  ) reads on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'reaction', grouped.reaction,
        'count', grouped.total,
        'reacted_by_me', grouped.reacted_by_me
      )
      order by grouped.reaction
    ) as reactions
    from (
      select
        r.reaction,
        count(*)::integer as total,
        bool_or(r.user_id = v_actor) as reacted_by_me
      from public.message_reactions r
      where r.message_id = m.id
      group by r.reaction
    ) grouped
  ) reaction_totals on true
  left join lateral (
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
    ) as items
    from public.message_attachments a
    where a.message_id = m.id
  ) attachments on true
  where m.thread_id = p_thread_id
  order by m.created_at asc
  limit 500;
end;
$$;

drop function if exists public.send_thread_message(uuid,text,text);
create function public.send_thread_message(
  p_thread_id uuid,
  p_body text default null,
  p_message_type text default 'text',
  p_reply_to_message_id uuid default null
)
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
  v_reply_thread uuid;
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

  if p_reply_to_message_id is not null then
    select m.thread_id into v_reply_thread from public.messages m where m.id = p_reply_to_message_id;
    if v_reply_thread is distinct from p_thread_id then
      raise exception 'Replies must target a message in this conversation';
    end if;
  end if;

  insert into public.messages(thread_id, sender_id, body, message_type, reply_to_message_id)
  values(p_thread_id, v_actor, v_body, v_type, p_reply_to_message_id)
  returning id into v_message_id;

  update public.message_threads
  set last_message_at = now(),
      updated_at = now()
  where id = p_thread_id;

  update public.message_thread_participants
  set last_read_at = now(),
      archived_at = null
  where thread_id = p_thread_id
    and user_id = v_actor;

  return v_message_id;
end;
$$;

create or replace function public.edit_thread_message(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_message public.messages%rowtype;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;
  if v_body is null then raise exception 'Message cannot be blank'; end if;

  select * into v_message from public.messages where id = p_message_id for update;
  if not found then raise exception 'Message not found'; end if;
  if v_message.sender_id <> v_actor then raise exception 'Only the sender can edit this message' using errcode = '42501'; end if;
  if v_message.deleted_at is not null then raise exception 'Deleted messages cannot be edited'; end if;
  if v_message.message_type = 'system' then raise exception 'System messages cannot be edited'; end if;

  update public.messages
  set body = v_body,
      edited_at = now()
  where id = p_message_id;

  update public.message_threads
  set updated_at = now()
  where id = v_message.thread_id;
end;
$$;

create or replace function public.delete_thread_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_message public.messages%rowtype;
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  select * into v_message from public.messages where id = p_message_id for update;
  if not found then raise exception 'Message not found'; end if;
  if not (v_message.sender_id = v_actor or v_role = 'admin') then
    raise exception 'Only the sender or an administrator can delete this message' using errcode = '42501';
  end if;
  if v_message.message_type = 'system' then raise exception 'System messages cannot be deleted'; end if;

  update public.messages
  set body = null,
      deleted_at = coalesce(deleted_at, now()),
      metadata = metadata || jsonb_build_object('deleted_by', v_actor)
  where id = p_message_id;

  delete from public.message_reactions where message_id = p_message_id;
  delete from public.message_saved_items where message_id = p_message_id;
  delete from public.message_pins where message_id = p_message_id;

  update public.message_threads
  set updated_at = now()
  where id = v_message.thread_id;
end;
$$;

create or replace function public.toggle_message_reaction(p_message_id uuid, p_reaction text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_thread_id uuid;
  v_reaction text := lower(trim(coalesce(p_reaction, '')));
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;
  if v_reaction not in ('thumbs_up','check','eyes','heart','urgent') then raise exception 'Unsupported reaction'; end if;

  select m.thread_id into v_thread_id from public.messages m where m.id = p_message_id and m.deleted_at is null;
  if v_thread_id is null then raise exception 'Message not found'; end if;
  if not public.is_message_thread_participant(v_thread_id, v_actor) then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;

  if exists (select 1 from public.message_reactions r where r.message_id = p_message_id and r.user_id = v_actor and r.reaction = v_reaction) then
    delete from public.message_reactions r
    where r.message_id = p_message_id
      and r.user_id = v_actor
      and r.reaction = v_reaction;
    return false;
  end if;

  insert into public.message_reactions(message_id, user_id, reaction)
  values(p_message_id, v_actor, v_reaction);
  return true;
end;
$$;

create or replace function public.toggle_message_saved(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_thread_id uuid;
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  select m.thread_id into v_thread_id from public.messages m where m.id = p_message_id and m.deleted_at is null;
  if v_thread_id is null then raise exception 'Message not found'; end if;
  if not public.is_message_thread_participant(v_thread_id, v_actor) then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;

  if exists (select 1 from public.message_saved_items s where s.message_id = p_message_id and s.user_id = v_actor) then
    delete from public.message_saved_items s where s.message_id = p_message_id and s.user_id = v_actor;
    return false;
  end if;

  insert into public.message_saved_items(message_id, user_id)
  values(p_message_id, v_actor);
  return true;
end;
$$;

create or replace function public.toggle_message_pin(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_role text := public.current_app_role();
  v_thread_id uuid;
begin
  if v_actor is null or v_role is null then
    raise exception 'An active ERP user is required' using errcode = '42501';
  end if;

  select m.thread_id into v_thread_id from public.messages m where m.id = p_message_id and m.deleted_at is null;
  if v_thread_id is null then raise exception 'Message not found'; end if;
  if not public.is_message_thread_participant(v_thread_id, v_actor) then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;

  if exists (select 1 from public.message_pins p where p.message_id = p_message_id) then
    delete from public.message_pins p where p.message_id = p_message_id;
    return false;
  end if;

  insert into public.message_pins(message_id, thread_id, pinned_by)
  values(p_message_id, v_thread_id, v_actor);
  return true;
end;
$$;

create or replace function public.set_message_thread_muted(p_thread_id uuid, p_muted boolean)
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
  set is_muted = coalesce(p_muted, false),
      muted_until = null
  where thread_id = p_thread_id
    and user_id = v_actor;

  if not found then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.set_message_thread_archived(p_thread_id uuid, p_archived boolean)
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
  set archived_at = case when coalesce(p_archived, false) then now() else null end
  where thread_id = p_thread_id
    and user_id = v_actor;

  if not found then
    raise exception 'You are not a participant in this conversation' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.list_message_threads(boolean) from public, anon;
revoke all on function public.list_thread_messages(uuid) from public, anon;
revoke all on function public.send_thread_message(uuid,text,text,uuid) from public, anon;
revoke all on function public.edit_thread_message(uuid,text) from public, anon;
revoke all on function public.delete_thread_message(uuid) from public, anon;
revoke all on function public.toggle_message_reaction(uuid,text) from public, anon;
revoke all on function public.toggle_message_saved(uuid) from public, anon;
revoke all on function public.toggle_message_pin(uuid) from public, anon;
revoke all on function public.set_message_thread_muted(uuid,boolean) from public, anon;
revoke all on function public.set_message_thread_archived(uuid,boolean) from public, anon;

grant execute on function public.list_message_threads(boolean) to authenticated;
grant execute on function public.list_thread_messages(uuid) to authenticated;
grant execute on function public.send_thread_message(uuid,text,text,uuid) to authenticated;
grant execute on function public.edit_thread_message(uuid,text) to authenticated;
grant execute on function public.delete_thread_message(uuid) to authenticated;
grant execute on function public.toggle_message_reaction(uuid,text) to authenticated;
grant execute on function public.toggle_message_saved(uuid) to authenticated;
grant execute on function public.toggle_message_pin(uuid) to authenticated;
grant execute on function public.set_message_thread_muted(uuid,boolean) to authenticated;
grant execute on function public.set_message_thread_archived(uuid,boolean) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.message_reactions;
  exception when duplicate_object or undefined_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.message_saved_items;
  exception when duplicate_object or undefined_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.message_pins;
  exception when duplicate_object or undefined_object then
    null;
  end;
end;
$$;

comment on table public.message_reactions
  is 'Per-user emoji-style reactions on internal ERP messages.';
comment on table public.message_saved_items
  is 'Per-user saved/starred internal ERP messages.';
comment on table public.message_pins
  is 'Pinned internal ERP messages highlighted for every participant in a conversation.';
