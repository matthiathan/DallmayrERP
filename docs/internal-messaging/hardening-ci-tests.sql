\set ON_ERROR_STOP on

-- Assumes ci-fixtures.sql, the Phase 1 foundation and the hardening migration
-- have already been applied in disposable Postgres.

-- Create one private direct thread between active fixture users A and B.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select public.create_direct_message_thread('00000000-0000-0000-0000-000000000002') as direct_thread \gset
reset role;

-- Own mute/archive preference updates are permitted.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
update public.message_thread_members
set is_muted = true, archived_at = now()
where thread_id = :'direct_thread'::uuid
  and user_id = '00000000-0000-0000-0000-000000000001'::uuid;
select 1 / case when (
  select is_muted and archived_at is not null
  from public.message_thread_members
  where thread_id = :'direct_thread'::uuid
    and user_id = '00000000-0000-0000-0000-000000000001'::uuid
) then 1 else 0 end;
reset role;

-- Another member's preferences cannot be changed through RLS.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
update public.message_thread_members
set is_muted = true
where thread_id = :'direct_thread'::uuid
  and user_id = '00000000-0000-0000-0000-000000000002'::uuid;
reset role;
select 1 / case when (
  select is_muted = false
  from public.message_thread_members
  where thread_id = :'direct_thread'::uuid
    and user_id = '00000000-0000-0000-0000-000000000002'::uuid
) then 1 else 0 end;

-- Private Realtime Broadcast/Presence topic authorization allows a member.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select set_config('realtime.topic', 'thread:' || :'direct_thread', false);
insert into realtime.messages (extension, topic, event, payload)
values ('broadcast', 'thread:' || :'direct_thread', 'typing', '{"typing":true}'::jsonb);
select 1 / case when (
  select count(*) from realtime.messages
  where topic = 'thread:' || :'direct_thread'
    and extension = 'broadcast'
) >= 1 then 1 else 0 end;
reset role;

-- Sending a durable message advances the thread activity timestamp and emits a
-- minimal database signal. The signal payload must not contain the message body.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
insert into public.messages (thread_id, body, client_message_id)
values (
  :'direct_thread'::uuid,
  'confidential body must stay in Postgres',
  '30000000-0000-0000-0000-000000000001'::uuid
)
returning id as committed_message \gset
reset role;

select 1 / case when (
  select last_message_at is not null
  from public.message_threads
  where id = :'direct_thread'::uuid
) then 1 else 0 end;

select 1 / case when exists (
  select 1
  from realtime.messages
  where topic = 'thread:' || :'direct_thread'
    and event = 'message_committed'
    and payload ->> 'message_id' = :'committed_message'
    and not (payload ? 'body')
    and payload::text not like '%confidential body must stay in Postgres%'
) then 1 else 0 end;
