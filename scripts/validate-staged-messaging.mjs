import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const REQUIRED_ENV = [
  'STAGED_SUPABASE_URL',
  'STAGED_SUPABASE_KEY',
  'STAGED_USER_A_EMAIL',
  'STAGED_USER_A_PASSWORD',
  'STAGED_USER_B_EMAIL',
  'STAGED_USER_B_PASSWORD',
  'STAGED_USER_C_EMAIL',
  'STAGED_USER_C_PASSWORD',
];

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) throw new Error(`Missing required staged messaging environment variable: ${name}`);
}

const url = process.env.STAGED_SUPABASE_URL;
const key = process.env.STAGED_SUPABASE_KEY;
const timeoutMs = Number(process.env.STAGED_MESSAGING_TIMEOUT_MS ?? 15000);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeClient() {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      timeout: timeoutMs,
    },
  });
}

async function waitFor(label, predicate, timeout = timeoutMs, interval = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function signIn(client, email, password, label) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label} sign-in failed: ${error.message}`);
  assert(data.user?.id, `${label} did not receive an authenticated user id`);
  await client.realtime.setAuth(data.session.access_token);
  return data.user;
}

async function appUser(client, email, label) {
  const { data, error } = await client
    .from('users')
    .select('id,email,is_active')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new Error(`${label} ERP user lookup failed: ${error.message}`);
  assert(data?.id, `${label} has no matching public.users row`);
  assert(data.is_active === true, `${label} ERP user is not active`);
  return { id: String(data.id), email: String(data.email) };
}

async function subscribePrivate(client, threadId, userId, label, handlers = {}) {
  const channel = client.channel(`thread:${threadId}`, {
    config: {
      private: true,
      presence: { key: userId },
      broadcast: { self: false },
    },
  });

  if (handlers.onTyping) channel.on('broadcast', { event: 'typing' }, handlers.onTyping);
  if (handlers.onCommitted) channel.on('broadcast', { event: 'message_committed' }, handlers.onCommitted);
  if (handlers.onPresence) channel.on('presence', { event: 'sync' }, handlers.onPresence(channel));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} private channel subscription timed out`)), timeoutMs);
    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`${label} private channel rejected: ${error?.message ?? status}`));
      }
    });
  });

  return channel;
}

async function expectPrivateSubscriptionRejected(client, threadId, userId) {
  const channel = client.channel(`thread:${threadId}`, {
    config: {
      private: true,
      presence: { key: userId },
      broadcast: { self: false },
    },
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          reject(new Error('Non-member unexpectedly subscribed to a private thread channel'));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer);
          resolve(status);
        }
      });
    });
  } finally {
    await client.removeChannel(channel);
  }
}

const clientA = makeClient();
const clientB = makeClient();
const clientC = makeClient();
const channels = [];

try {
  console.log('1/10 Signing in staged ERP users A, B and C...');
  await Promise.all([
    signIn(clientA, process.env.STAGED_USER_A_EMAIL, process.env.STAGED_USER_A_PASSWORD, 'User A'),
    signIn(clientB, process.env.STAGED_USER_B_EMAIL, process.env.STAGED_USER_B_PASSWORD, 'User B'),
    signIn(clientC, process.env.STAGED_USER_C_EMAIL, process.env.STAGED_USER_C_PASSWORD, 'User C'),
  ]);

  const [userA, userB, userC] = await Promise.all([
    appUser(clientA, process.env.STAGED_USER_A_EMAIL, 'User A'),
    appUser(clientB, process.env.STAGED_USER_B_EMAIL, 'User B'),
    appUser(clientC, process.env.STAGED_USER_C_EMAIL, 'User C'),
  ]);

  console.log('2/10 Verifying direct-thread idempotency...');
  const directA = await clientA.rpc('create_direct_message_thread', { p_other_user_id: userB.id });
  if (directA.error) throw new Error(`User A direct-thread creation failed: ${directA.error.message}`);
  const directAgain = await clientA.rpc('create_direct_message_thread', { p_other_user_id: userB.id });
  if (directAgain.error) throw new Error(`User A repeated direct-thread creation failed: ${directAgain.error.message}`);
  const directReverse = await clientB.rpc('create_direct_message_thread', { p_other_user_id: userA.id });
  if (directReverse.error) throw new Error(`User B reverse direct-thread creation failed: ${directReverse.error.message}`);
  const threadId = String(directA.data);
  assert(threadId && threadId === String(directAgain.data) && threadId === String(directReverse.data), 'Direct-thread RPC is not idempotent for the same user pair');

  console.log('3/10 Verifying non-member database and private-Realtime isolation...');
  const outsiderRead = await clientC.from('message_threads').select('id').eq('id', threadId);
  if (outsiderRead.error) throw new Error(`Non-member isolation query failed unexpectedly: ${outsiderRead.error.message}`);
  assert((outsiderRead.data ?? []).length === 0, 'Non-member can read another direct thread');
  await expectPrivateSubscriptionRejected(clientC, threadId, userC.id);

  console.log('4/10 Verifying private Presence and typing Broadcast...');
  let typingSeen = false;
  let committedSignal = null;
  const presenceA = new Set();
  const presenceB = new Set();

  const channelA = await subscribePrivate(clientA, threadId, userA.id, 'User A', {
    onPresence: (channel) => () => {
      presenceA.clear();
      for (const state of Object.values(channel.presenceState())) {
        for (const item of state) if (item?.user_id) presenceA.add(String(item.user_id));
      }
    },
  });
  channels.push([clientA, channelA]);

  const channelB = await subscribePrivate(clientB, threadId, userB.id, 'User B', {
    onTyping: ({ payload }) => {
      if (payload?.user_id === userA.id && payload?.typing === true) typingSeen = true;
    },
    onCommitted: ({ payload }) => {
      committedSignal = payload;
    },
    onPresence: (channel) => () => {
      presenceB.clear();
      for (const state of Object.values(channel.presenceState())) {
        for (const item of state) if (item?.user_id) presenceB.add(String(item.user_id));
      }
    },
  });
  channels.push([clientB, channelB]);

  await channelA.track({ user_id: userA.id, label: 'Stage User A', online_at: new Date().toISOString() });
  await channelB.track({ user_id: userB.id, label: 'Stage User B', online_at: new Date().toISOString() });
  await waitFor('both users in private Presence', () => presenceA.has(userA.id) && presenceA.has(userB.id) && presenceB.has(userA.id) && presenceB.has(userB.id));

  await channelA.send({
    type: 'broadcast',
    event: 'typing',
    payload: { user_id: userA.id, label: 'Stage User A', typing: true },
  });
  await waitFor('private typing Broadcast', () => typingSeen);

  console.log('5/10 Verifying committed-message signal and authoritative Postgres fetch...');
  const marker = `stage-message-${randomUUID()}`;
  const sent = await clientA
    .from('messages')
    .insert({ thread_id: threadId, body: marker, client_message_id: randomUUID() })
    .select('id,thread_id,sender_id,body,created_at')
    .single();
  if (sent.error) throw new Error(`User A send failed: ${sent.error.message}`);
  await waitFor('message_committed Broadcast', () => committedSignal?.message_id === sent.data.id);
  assert(!Object.prototype.hasOwnProperty.call(committedSignal ?? {}, 'body'), 'Committed-message Broadcast leaked message body');

  const fetchedByB = await clientB.from('messages').select('id,body,sender_id').eq('id', sent.data.id).eq('thread_id', threadId).single();
  if (fetchedByB.error) throw new Error(`User B authoritative message refetch failed: ${fetchedByB.error.message}`);
  assert(fetchedByB.data.body === marker, 'User B did not recover the committed message body from Postgres');
  assert(String(fetchedByB.data.sender_id) === userA.id, 'Committed sender identity does not match User A');

  console.log('6/10 Verifying reconnect recovery from Postgres...');
  await clientB.removeChannel(channelB);
  const channelIndex = channels.findIndex(([, channel]) => channel === channelB);
  if (channelIndex >= 0) channels.splice(channelIndex, 1);
  const reconnectMarker = `stage-reconnect-${randomUUID()}`;
  const reconnectSend = await clientA.from('messages').insert({
    thread_id: threadId,
    body: reconnectMarker,
    client_message_id: randomUUID(),
  });
  if (reconnectSend.error) throw new Error(`Reconnect test send failed: ${reconnectSend.error.message}`);

  const channelB2 = await subscribePrivate(clientB, threadId, userB.id, 'User B reconnect');
  channels.push([clientB, channelB2]);
  const recovered = await clientB.from('messages').select('id,body,created_at').eq('thread_id', threadId).eq('body', reconnectMarker).maybeSingle();
  if (recovered.error) throw new Error(`Reconnect reconciliation query failed: ${recovered.error.message}`);
  assert(recovered.data?.body === reconnectMarker, 'Disconnected User B did not recover the committed message after reconnect');

  console.log('7/10 Verifying read-position ownership...');
  const latest = await clientB.from('messages').select('id,created_at').eq('thread_id', threadId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).single();
  if (latest.error) throw new Error(`Latest message lookup failed: ${latest.error.message}`);
  const now = new Date().toISOString();
  const ownRead = await clientB.from('message_read_positions').upsert({
    thread_id: threadId,
    user_id: userB.id,
    last_read_message_id: latest.data.id,
    last_read_at: now,
    updated_at: now,
  }, { onConflict: 'thread_id,user_id' });
  if (ownRead.error) throw new Error(`User B own read-position update failed: ${ownRead.error.message}`);

  const foreignRead = await clientA
    .from('message_read_positions')
    .update({ last_read_at: new Date(Date.now() + 1000).toISOString() })
    .eq('thread_id', threadId)
    .eq('user_id', userB.id)
    .select('thread_id');
  assert(Boolean(foreignRead.error) || (foreignRead.data ?? []).length === 0, 'User A can update User B read position');

  console.log('8/10 Verifying own mute/archive preferences and restoration...');
  const mute = await clientB
    .from('message_thread_members')
    .update({ is_muted: true })
    .eq('thread_id', threadId)
    .eq('user_id', userB.id)
    .select('is_muted,archived_at')
    .single();
  if (mute.error) throw new Error(`User B mute failed: ${mute.error.message}`);
  assert(mute.data.is_muted === true, 'User B mute preference did not persist');

  const archivedAt = new Date().toISOString();
  const archive = await clientB
    .from('message_thread_members')
    .update({ archived_at: archivedAt })
    .eq('thread_id', threadId)
    .eq('user_id', userB.id)
    .select('is_muted,archived_at')
    .single();
  if (archive.error) throw new Error(`User B archive failed: ${archive.error.message}`);
  assert(Boolean(archive.data.archived_at), 'User B archive preference did not persist');

  const restore = await clientB
    .from('message_thread_members')
    .update({ is_muted: false, archived_at: null })
    .eq('thread_id', threadId)
    .eq('user_id', userB.id);
  if (restore.error) throw new Error(`User B preference restoration failed: ${restore.error.message}`);

  console.log('9/10 Verifying group creation and member visibility...');
  const groupTitle = `Stage Group ${randomUUID().slice(0, 8)}`;
  const group = await clientA.rpc('create_group_message_thread', {
    p_title: groupTitle,
    p_member_user_ids: [userB.id, userC.id, userB.id],
  });
  if (group.error) throw new Error(`Group creation failed: ${group.error.message}`);
  const groupMembers = await clientA
    .from('message_thread_members')
    .select('user_id,member_role')
    .eq('thread_id', String(group.data))
    .is('removed_at', null);
  if (groupMembers.error) throw new Error(`Group membership lookup failed: ${groupMembers.error.message}`);
  const groupIds = new Set((groupMembers.data ?? []).map((row) => String(row.user_id)));
  assert(groupIds.size === 3 && groupIds.has(userA.id) && groupIds.has(userB.id) && groupIds.has(userC.id), 'Group membership did not contain exactly A, B and C');

  console.log('10/10 Staged authenticated messaging contracts passed.');
  console.log(`Validated direct thread ${threadId} and group ${String(group.data)} without exposing message bodies through Realtime.`);
} finally {
  for (const [client, channel] of channels.splice(0)) {
    try { await client.removeChannel(channel); } catch { /* best-effort cleanup */ }
  }
  await Promise.allSettled([clientA.auth.signOut(), clientB.auth.signOut(), clientC.auth.signOut()]);
}
