\set ON_ERROR_STOP on

-- Direct-thread idempotency for active members.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select public.create_direct_message_thread('00000000-0000-0000-0000-000000000002') as direct_thread_a \gset
select public.create_direct_message_thread('00000000-0000-0000-0000-000000000002') as direct_thread_a_again \gset
reset role;

select 1 / case when :'direct_thread_a' = :'direct_thread_a_again' then 1 else 0 end;
select 1 / case when (
  select count(*) from public.message_threads where id = :'direct_thread_a'::uuid and thread_type = 'direct'
) = 1 then 1 else 0 end;
select 1 / case when (
  select count(*) from public.message_thread_members where thread_id = :'direct_thread_a'::uuid and removed_at is null
) = 2 then 1 else 0 end;

-- Reverse-direction creation resolves to the same direct thread.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', false);
select public.create_direct_message_thread('00000000-0000-0000-0000-000000000001') as direct_thread_b \gset
reset role;
select 1 / case when :'direct_thread_a' = :'direct_thread_b' then 1 else 0 end;

-- Group creation trims title, deduplicates members and assigns the owner.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
select public.create_group_message_thread(
  '  Operations  ',
  array[
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid
  ]
) as group_thread \gset
reset role;

select 1 / case when (
  select title from public.message_threads where id = :'group_thread'::uuid
) = 'Operations' then 1 else 0 end;
select 1 / case when (
  select count(*) from public.message_thread_members where thread_id = :'group_thread'::uuid
) = 3 then 1 else 0 end;
select 1 / case when (
  select count(*) from public.message_thread_members
  where thread_id = :'group_thread'::uuid
    and user_id = '00000000-0000-0000-0000-000000000001'::uuid
    and member_role = 'owner'
) = 1 then 1 else 0 end;

-- Member sends a durable message and can read it.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
insert into public.messages (thread_id, body, client_message_id)
values (:'direct_thread_a'::uuid, 'hello', '20000000-0000-0000-0000-000000000001')
returning id as direct_message \gset
select 1 / case when (
  select count(*) from public.messages where id = :'direct_message'::uuid
) = 1 then 1 else 0 end;
reset role;

-- A non-member sees no rows in the private direct thread.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', false);
select 1 / case when (
  select count(*) from public.message_threads where id = :'direct_thread_a'::uuid
) = 0 then 1 else 0 end;
select 1 / case when (
  select count(*) from public.messages where thread_id = :'direct_thread_a'::uuid
) = 0 then 1 else 0 end;
reset role;

-- Own read position succeeds and is thread-scoped.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
insert into public.message_read_positions (thread_id, user_id, last_read_message_id, last_read_at)
values (
  :'direct_thread_a'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  :'direct_message'::uuid,
  now()
);
select 1 / case when (
  select count(*) from public.message_read_positions
  where thread_id = :'direct_thread_a'::uuid
    and user_id = '00000000-0000-0000-0000-000000000001'::uuid
) = 1 then 1 else 0 end;
reset role;

-- Deleting the referenced message nulls only the message reference.
delete from public.messages where id = :'direct_message'::uuid;
select 1 / case when (
  select thread_id = :'direct_thread_a'::uuid and last_read_message_id is null
  from public.message_read_positions
  where thread_id = :'direct_thread_a'::uuid
    and user_id = '00000000-0000-0000-0000-000000000001'::uuid
) then 1 else 0 end;
