'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErpPage, ErpPageHeader, ErpStateBanner } from '@/components/ui/ErpLayout';
import { getSupabaseClient } from '@/lib/supabase/client';

type DirectoryUser = { id: string; label: string; email: string };
type ThreadMember = { user_id: string; is_muted: boolean; archived_at: string | null };
type Thread = {
  id: string;
  thread_type: 'direct' | 'group';
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  members: ThreadMember[];
};
type Message = { id: string; thread_id: string; sender_id: string; body: string; created_at: string };
type ReadPosition = { thread_id: string; last_read_message_id: string | null; last_read_at: string | null };
type TypingPayload = { user_id: string; label: string; typing: boolean };
type MessageSignal = { thread_id?: string; message_id?: string; created_at?: string };
type MessageCursor = { created_at: string; id: string };
type NotificationPermissionState = NotificationPermission | 'unsupported';

const PAGE_SIZE = 50;
const DIRECTORY_LIMIT = 1000;
const TYPING_TIMEOUT_MS = 2500;
const NOTIFICATION_TITLE = 'New DallmayrERP message';

function displayName(details: Record<string, unknown> | undefined, email: string) {
  const first = typeof details?.first_name === 'string' ? details.first_name : '';
  const last = typeof details?.last_name === 'string' ? details.last_name : '';
  return `${first} ${last}`.trim() || email;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function mentionTokens(user: DirectoryUser | undefined) {
  if (!user) return new Set<string>();
  const names = user.label.split(/\s+/).filter(Boolean);
  const emailName = user.email.split('@')[0];
  return new Set([user.label, names[0], emailName].filter(Boolean).map((value) => `@${value}`.toLowerCase()));
}

function renderMessageBody(body: string, ownMentions: Set<string>) {
  const parts = body.split(/(@[\p{L}\p{N}._-]+)/gu);
  return parts.map((part, index) => ownMentions.has(part.toLowerCase())
    ? <mark key={`${part}-${index}`}>{part}</mark>
    : part);
}

function mergeMessages(older: Message[], current: Message[]) {
  const seen = new Set<string>();
  return [...older, ...current].filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

export function SecureInternalMessagingWorkspace() {
  const { businessUser } = useAuth();
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [readPositions, setReadPositions] = useState<ReadPosition[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [body, setBody] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [typingByThread, setTypingByThread] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('unsupported');
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement | null>(null);
  const threadChannelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const presenceByThreadRef = useRef<Map<string, Set<string>>>(new Map());
  const selectedThreadIdRef = useRef<string | null>(null);
  const threadsRef = useRef<Thread[]>([]);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const directoryById = useMemo(() => new Map(directory.map((user) => [user.id, user])), [directory]);
  const readPositionByThread = useMemo(() => new Map(readPositions.map((position) => [position.thread_id, position])), [readPositions]);
  const selectedThread = useMemo(() => threads.find((thread) => thread.id === selectedThreadId) ?? null, [selectedThreadId, threads]);
  const currentUser = businessUser ? directoryById.get(businessUser.id) : undefined;
  const ownMentions = useMemo(() => mentionTokens(currentUser), [currentUser]);
  const selectableDirectory = useMemo(() => directory.filter((user) => user.id !== businessUser?.id), [businessUser?.id, directory]);
  const selectedUsers = useMemo(() => selectedUserIds.map((id) => directoryById.get(id)).filter((user): user is DirectoryUser => Boolean(user)), [directoryById, selectedUserIds]);
  const threadIdsKey = useMemo(() => threads.map((thread) => thread.id).sort().join('|'), [threads]);

  const filteredDirectory = useMemo(() => {
    const query = participantSearch.trim().toLowerCase();
    const users = query
      ? selectableDirectory.filter((user) => user.label.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
      : selectableDirectory;
    return [...users].sort((left, right) => {
      const onlineDifference = Number(onlineUserIds.has(right.id)) - Number(onlineUserIds.has(left.id));
      return onlineDifference || left.label.localeCompare(right.label);
    });
  }, [onlineUserIds, participantSearch, selectableDirectory]);

  const filteredMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter((message) => {
      const sender = directoryById.get(message.sender_id)?.label ?? '';
      return message.body.toLowerCase().includes(query) || sender.toLowerCase().includes(query);
    });
  }, [directoryById, messageSearch, messages]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    setNotificationPermission(typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported');
  }, []);

  const ownMembership = useCallback((thread: Thread | null | undefined) => (
    thread?.members.find((member) => member.user_id === businessUser?.id) ?? null
  ), [businessUser?.id]);

  const threadLabel = useCallback((thread: Thread) => {
    if (thread.title) return thread.title;
    const other = thread.members.find((member) => member.user_id !== businessUser?.id);
    if (!other) return 'Conversation';
    const user = directoryById.get(other.user_id);
    return user?.label || user?.email || 'Direct conversation';
  }, [businessUser?.id, directoryById]);

  const senderLabel = useCallback((senderId: string) => {
    const user = directoryById.get(senderId);
    if (user) return user.label || user.email;
    if (selectedThread?.thread_type === 'direct' && senderId !== businessUser?.id) return threadLabel(selectedThread);
    return `Employee ${senderId.slice(0, 8)}`;
  }, [businessUser?.id, directoryById, selectedThread, threadLabel]);

  const threadPresence = useCallback((thread: Thread) => {
    const otherMembers = thread.members.filter((member) => member.user_id !== businessUser?.id);
    const online = otherMembers.filter((member) => onlineUserIds.has(member.user_id)).length;
    if (thread.thread_type === 'direct') return online ? 'Online' : 'Offline';
    return `${online} of ${otherMembers.length} online`;
  }, [businessUser?.id, onlineUserIds]);

  const isUnread = useCallback((thread: Thread) => {
    if (!thread.last_message_at) return false;
    const position = readPositionByThread.get(thread.id);
    if (!position?.last_read_at) return true;
    return new Date(thread.last_message_at).getTime() > new Date(position.last_read_at).getTime();
  }, [readPositionByThread]);

  const unreadCount = useMemo(() => threads.filter(isUnread).length, [isUnread, threads]);
  const typingLabels = selectedThreadId
    ? Object.values(typingByThread[selectedThreadId] ?? {}).filter((label) => label !== currentUser?.label)
    : [];

  const recomputeOnlineUsers = useCallback(() => {
    const next = new Set<string>();
    presenceByThreadRef.current.forEach((ids) => ids.forEach((id) => next.add(id)));
    setOnlineUserIds(next);
  }, []);

  const loadDirectory = useCallback(async () => {
    const client = getSupabaseClient();
    const { data, error: directoryError } = await client.rpc('list_internal_messaging_directory');
    if (directoryError) throw directoryError;

    const rows = (data ?? []) as Array<Record<string, unknown> & { user_id: string; email: string }>;
    setDirectory(rows.slice(0, DIRECTORY_LIMIT).map((row) => ({
      id: String(row.user_id),
      email: String(row.email),
      label: displayName(row, String(row.email)),
    })));
  }, []);

  const loadThreads = useCallback(async () => {
    const client = getSupabaseClient();
    const { data: threadRows, error: threadError } = await client
      .from('message_threads')
      .select('id,thread_type,title,created_at,updated_at,last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (threadError) throw threadError;

    const ids = (threadRows ?? []).map((row) => String(row.id));
    const [{ data: members, error: memberError }, { data: positions, error: positionError }] = await Promise.all([
      ids.length
        ? client.from('message_thread_members').select('thread_id,user_id,is_muted,archived_at').in('thread_id', ids).is('removed_at', null)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? client.from('message_read_positions').select('thread_id,last_read_message_id,last_read_at').in('thread_id', ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (memberError) throw memberError;
    if (positionError) throw positionError;

    const memberMap = new Map<string, ThreadMember[]>();
    (members ?? []).forEach((member) => {
      const key = String(member.thread_id);
      const list = memberMap.get(key) ?? [];
      list.push({
        user_id: String(member.user_id),
        is_muted: Boolean(member.is_muted),
        archived_at: member.archived_at ? String(member.archived_at) : null,
      });
      memberMap.set(key, list);
    });

    const rows = (threadRows ?? []).map((row) => ({
      ...row,
      id: String(row.id),
      members: memberMap.get(String(row.id)) ?? [],
    })) as Thread[];
    setThreads(rows);
    setReadPositions((positions ?? []).map((position) => ({
      thread_id: String(position.thread_id),
      last_read_message_id: position.last_read_message_id ? String(position.last_read_message_id) : null,
      last_read_at: position.last_read_at ? String(position.last_read_at) : null,
    })));
    setSelectedThreadId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
  }, []);

  const markThreadRead = useCallback(async (threadId: string, latestMessage: Message | undefined) => {
    if (!businessUser?.id) return;
    const now = new Date().toISOString();
    const { error: readError } = await getSupabaseClient().from('message_read_positions').upsert({
      thread_id: threadId,
      user_id: businessUser.id,
      last_read_message_id: latestMessage?.id ?? null,
      last_read_at: now,
      updated_at: now,
    }, { onConflict: 'thread_id,user_id' });
    if (readError) throw readError;
    setReadPositions((current) => [
      ...current.filter((position) => position.thread_id !== threadId),
      { thread_id: threadId, last_read_message_id: latestMessage?.id ?? null, last_read_at: now },
    ]);
  }, [businessUser?.id]);

  const loadMessages = useCallback(async (threadId: string, before?: MessageCursor) => {
    if (before) setLoadingOlder(true);
    else setLoadingMessages(true);

    let query = getSupabaseClient()
      .from('messages')
      .select('id,thread_id,sender_id,body,created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);

    if (before) {
      query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`);
    }

    const { data, error: messageError } = await query;
    if (messageError) {
      setError(messageError.message);
      setLoadingMessages(false);
      setLoadingOlder(false);
      return;
    }

    const newestFirst = (data ?? []) as Message[];
    const chronological = [...newestFirst].reverse();
    setHasOlderMessages(newestFirst.length === PAGE_SIZE);

    if (before) {
      setMessages((current) => mergeMessages(chronological, current));
    } else {
      setMessages(chronological);
      try {
        await markThreadRead(threadId, chronological.at(-1));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not update read position.');
      }
      window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 0);
    }

    setLoadingMessages(false);
    setLoadingOlder(false);
  }, [markThreadRead]);

  const maybeNotifyCommittedMessage = useCallback(async (threadId: string, messageId: string | undefined) => {
    if (!businessUser?.id || !messageId || typeof document === 'undefined' || document.visibilityState === 'visible') return;
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;

    const thread = threadsRef.current.find((candidate) => candidate.id === threadId);
    if (!thread || ownMembership(thread)?.is_muted) return;

    const { data, error: lookupError } = await getSupabaseClient()
      .from('messages')
      .select('sender_id')
      .eq('id', messageId)
      .eq('thread_id', threadId)
      .maybeSingle();
    if (lookupError || !data || String(data.sender_id) === businessUser.id) return;

    new Notification(NOTIFICATION_TITLE, {
      body: `New message in ${threadLabel(thread)}`,
      tag: `dallmayr-message-${threadId}`,
    });
  }, [businessUser?.id, ownMembership, threadLabel]);

  useEffect(() => {
    if (!businessUser?.id) return;
    setLoading(true);
    Promise.all([loadDirectory(), loadThreads()])
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load messaging.'))
      .finally(() => setLoading(false));
  }, [businessUser?.id, loadDirectory, loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      setHasOlderMessages(false);
      return;
    }
    setMessageSearch('');
    void loadMessages(selectedThreadId);
  }, [loadMessages, selectedThreadId]);

  useEffect(() => {
    if (!businessUser?.id) return;
    const client = getSupabaseClient();
    const channel = client
      .channel(`internal-messaging-membership:${businessUser.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'message_thread_members', filter: `user_id=eq.${businessUser.id}`,
      }, () => void loadThreads())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [businessUser?.id, loadThreads]);

  useEffect(() => {
    if (!businessUser?.id || !currentUser || !threadIdsKey) return;
    const currentUserId = businessUser.id;
    const currentUserLabel = currentUser.label;
    const client = getSupabaseClient();
    let cancelled = false;

    async function subscribeToPrivateThreads() {
      await client.realtime.setAuth();
      if (cancelled) return;

      const nextChannels = new Map<string, RealtimeChannel>();
      for (const thread of threadsRef.current) {
        if (cancelled) break;
        const channel = client.channel(`thread:${thread.id}`, {
          config: {
            private: true,
            presence: { key: currentUserId },
            broadcast: { self: false },
          },
        })
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState<{ user_id: string }>();
            const ids = Object.values(state).flat().map((presence) => String(presence.user_id)).filter(Boolean);
            presenceByThreadRef.current.set(thread.id, new Set(ids));
            recomputeOnlineUsers();
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const typing = payload as TypingPayload;
            if (!typing.user_id || typing.user_id === currentUserId) return;
            setTypingByThread((current) => {
              const threadState = { ...(current[thread.id] ?? {}) };
              if (typing.typing) threadState[typing.user_id] = typing.label;
              else delete threadState[typing.user_id];
              return { ...current, [thread.id]: threadState };
            });
            if (typing.typing) {
              window.setTimeout(() => setTypingByThread((current) => {
                const threadState = { ...(current[thread.id] ?? {}) };
                delete threadState[typing.user_id];
                return { ...current, [thread.id]: threadState };
              }), TYPING_TIMEOUT_MS + 750);
            }
          })
          .on('broadcast', { event: 'message_committed' }, ({ payload }) => {
            const signal = payload as MessageSignal;
            if (signal.thread_id && signal.thread_id !== thread.id) return;
            void loadThreads();
            if (selectedThreadIdRef.current === thread.id) void loadMessages(thread.id);
            void maybeNotifyCommittedMessage(thread.id, signal.message_id);
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await channel.track({
                user_id: currentUserId,
                label: currentUserLabel,
                online_at: new Date().toISOString(),
              });
              if (cancelled) return;
              void loadThreads();
              if (selectedThreadIdRef.current === thread.id) void loadMessages(thread.id);
            }
          });
        nextChannels.set(thread.id, channel);
      }
      threadChannelsRef.current = nextChannels;
    }

    void subscribeToPrivateThreads().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not connect secure messaging realtime.');
    });

    return () => {
      cancelled = true;
      const channels = [...threadChannelsRef.current.values()];
      threadChannelsRef.current.clear();
      presenceByThreadRef.current.clear();
      setOnlineUserIds(new Set());
      channels.forEach((channel) => { void client.removeChannel(channel); });
    };
  }, [businessUser?.id, currentUser, loadMessages, loadThreads, maybeNotifyCommittedMessage, recomputeOnlineUsers, threadIdsKey]);

  const broadcastTyping = useCallback((typing: boolean) => {
    if (!selectedThreadId || !businessUser?.id || !currentUser) return;
    const channel = threadChannelsRef.current.get(selectedThreadId);
    if (!channel) return;
    void channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: businessUser.id, label: currentUser.label, typing } satisfies TypingPayload,
    });
  }, [businessUser?.id, currentUser, selectedThreadId]);

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserIds.length || creating) return;
    setCreating(true);
    setError(null);
    const client = getSupabaseClient();
    const result = selectedUserIds.length === 1
      ? await client.rpc('create_direct_message_thread', { p_other_user_id: selectedUserIds[0] })
      : await client.rpc('create_group_message_thread', { p_title: groupTitle.trim(), p_member_user_ids: selectedUserIds });
    setCreating(false);
    if (result.error) { setError(result.error.message); return; }
    setSelectedUserIds([]);
    setParticipantSearch('');
    setGroupTitle('');
    await loadThreads();
    setSelectedThreadId(String(result.data));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const copy = body.trim();
    if (!selectedThreadId || !copy || !businessUser?.id || sending) return;
    setSending(true);
    setError(null);
    broadcastTyping(false);
    const clientMessageId = crypto.randomUUID();
    const { error: sendError } = await getSupabaseClient().from('messages').insert({
      thread_id: selectedThreadId,
      body: copy,
      client_message_id: clientMessageId,
    });
    setSending(false);
    if (sendError) { setError(sendError.message); return; }
    setBody('');
    await Promise.all([loadMessages(selectedThreadId), loadThreads()]);
  }

  async function loadOlderMessages() {
    if (!selectedThreadId || !hasOlderMessages || loadingOlder || !messages.length) return;
    const oldest = messages[0];
    await loadMessages(selectedThreadId, { created_at: oldest.created_at, id: oldest.id });
  }

  async function updateOwnPreference(kind: 'mute' | 'archive') {
    if (!selectedThread || !businessUser?.id || savingPreference) return;
    const membership = ownMembership(selectedThread);
    if (!membership) return;
    setSavingPreference(true);
    setError(null);
    const patch = kind === 'mute'
      ? { is_muted: !membership.is_muted }
      : { archived_at: membership.archived_at ? null : new Date().toISOString() };
    const { error: preferenceError } = await getSupabaseClient()
      .from('message_thread_members')
      .update(patch)
      .eq('thread_id', selectedThread.id)
      .eq('user_id', businessUser.id);
    setSavingPreference(false);
    if (preferenceError) { setError(preferenceError.message); return; }
    await loadThreads();
  }

  async function requestBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }

  function toggleParticipant(userId: string) {
    setSelectedUserIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }

  function handleBodyChange(value: string) {
    setBody(value);
    broadcastTyping(Boolean(value.trim()));
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => broadcastTyping(false), TYPING_TIMEOUT_MS);
  }

  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, []);

  if (!businessUser) return <EmptyState title="Messages unavailable" message="Your ERP profile is still loading." />;

  const selectedMembership = ownMembership(selectedThread);

  return (
    <ErpPage className="internal-messaging-page" variant="operational">
      <ErpPageHeader eyebrow="Communications" title="Messages" description="Secure internal direct and group conversations with private realtime presence." />
      {unreadCount > 0 ? <ErpStateBanner title={`${unreadCount} unread conversation${unreadCount === 1 ? '' : 's'}`} message="Unread conversations are highlighted in the conversation list." tone="info" /> : null}
      {error ? <ErpStateBanner title="Messaging needs attention" message={error} tone="danger" /> : null}
      <section className="messages-v2-shell" aria-label="Internal messaging workspace">
        <aside className="messages-v2-sidebar">
          <form className="messages-v2-create" onSubmit={createConversation}>
            <strong>New conversation</strong>
            <input aria-label="Search company directory" autoComplete="off" placeholder="Search by name or email" type="search" value={participantSearch} onChange={(event) => setParticipantSearch(event.target.value)} />
            {selectedUsers.length > 0 ? (
              <div aria-label="Selected participants" className="messages-v2-selected-people">
                {selectedUsers.map((user) => (
                  <button aria-label={`Remove ${user.label}`} className="button secondary" key={user.id} onClick={() => toggleParticipant(user.id)} type="button">{user.label} ×</button>
                ))}
              </div>
            ) : null}
            <div aria-label="All active employees" className="messages-v2-people-picker" role="listbox">
              {filteredDirectory.map((user) => {
                const selected = selectedUserIds.includes(user.id);
                return (
                  <button aria-selected={selected} className={selected ? 'is-selected' : ''} key={user.id} onClick={() => toggleParticipant(user.id)} role="option" type="button">
                    <span><strong>{user.label}</strong><small>{user.email}</small></span>
                    <span>{selected ? 'Selected' : onlineUserIds.has(user.id) ? 'Online' : 'Offline'}</span>
                  </button>
                );
              })}
              {!filteredDirectory.length ? <p>No active employees match “{participantSearch}”.</p> : null}
            </div>
            <small>{participantSearch ? `${filteredDirectory.length} matching` : `${selectableDirectory.length} active`} employees · {selectedUserIds.length} selected</small>
            {selectedUserIds.length > 1 ? <input aria-label="Group name" maxLength={120} required placeholder="Group name" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} /> : null}
            <button className="button" disabled={creating || !selectedUserIds.length || (selectedUserIds.length > 1 && !groupTitle.trim())} type="submit">{creating ? 'Creating…' : selectedUserIds.length > 1 ? 'Create group' : 'Start conversation'}</button>
          </form>
          <nav className="messages-v2-thread-list" aria-label="Conversations">
            {loading ? <p>Loading conversations…</p> : null}
            {!loading && !threads.length ? <p>No conversations yet. Select one or more active employees above to start.</p> : null}
            {threads.map((thread) => {
              const unread = isUnread(thread);
              const membership = ownMembership(thread);
              return (
                <button aria-label={`${threadLabel(thread)}${unread ? ', unread' : ''}${membership?.archived_at ? ', archived' : ''}`} className={`${thread.id === selectedThreadId ? 'is-active' : ''} ${unread ? 'is-unread' : ''}`} key={thread.id} onClick={() => setSelectedThreadId(thread.id)} type="button">
                  <strong>{threadLabel(thread)}{unread ? <span aria-label="Unread messages"> •</span> : null}</strong>
                  <small>{thread.thread_type === 'group' ? `${thread.members.length} participants` : 'Direct conversation'} · {threadPresence(thread)}{membership?.is_muted ? ' · Muted' : ''}{membership?.archived_at ? ' · Archived' : ''}{thread.last_message_at ? ` · ${formatTime(thread.last_message_at)}` : ''}</small>
                </button>
              );
            })}
          </nav>
        </aside>
        <section className="messages-v2-chat">
          {selectedThread ? <>
            <header>
              <div>
                <h2>{threadLabel(selectedThread)}</h2>
                <p>{selectedThread.thread_type === 'group' ? `${selectedThread.members.length} participants` : `Conversation with ${threadLabel(selectedThread)}`} · {threadPresence(selectedThread)}</p>
              </div>
              <div className="action-row">
                <button className="button secondary" disabled={savingPreference} onClick={() => void updateOwnPreference('mute')} type="button">{selectedMembership?.is_muted ? 'Unmute' : 'Mute'}</button>
                <button className="button secondary" disabled={savingPreference} onClick={() => void updateOwnPreference('archive')} type="button">{selectedMembership?.archived_at ? 'Restore' : 'Archive'}</button>
                {notificationPermission === 'default' ? <button className="button secondary" onClick={() => void requestBrowserNotifications()} type="button">Enable browser alerts</button> : null}
              </div>
              <input aria-label="Search loaded messages" placeholder="Search loaded messages" type="search" value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} />
            </header>
            <div className="messages-v2-log" role="log" aria-live="polite">
              {hasOlderMessages && !messageSearch ? <button className="button secondary" disabled={loadingOlder} onClick={() => void loadOlderMessages()} type="button">{loadingOlder ? 'Loading older…' : 'Load older messages'}</button> : null}
              {loadingMessages ? <p>Loading messages…</p> : null}
              {!loadingMessages && !messages.length ? <p>No messages yet. Send the first message below.</p> : null}
              {!loadingMessages && messages.length > 0 && !filteredMessages.length ? <p>No loaded messages match your search.</p> : null}
              {filteredMessages.map((message) => {
                const mine = message.sender_id === businessUser.id;
                return <article className={mine ? 'is-mine' : ''} key={message.id}>
                  {!mine ? <strong>{senderLabel(message.sender_id)}</strong> : null}
                  <p>{renderMessageBody(message.body, ownMentions)}</p><time>{formatTime(message.created_at)}</time>
                </article>;
              })}
              <div ref={endRef} />
            </div>
            <div aria-live="polite" className="messages-v2-typing">{typingLabels.length ? `${typingLabels.slice(0, 2).join(', ')} ${typingLabels.length === 1 ? 'is' : 'are'} typing…` : '\u00a0'}</div>
            <form className="messages-v2-composer" onSubmit={sendMessage}>
              <textarea aria-label="Message" maxLength={4000} placeholder="Write a message. Use @name to mention an employee." rows={2} value={body} onChange={(event) => handleBodyChange(event.target.value)} />
              <button className="button" disabled={sending || !body.trim()} type="submit">{sending ? 'Sending…' : 'Send'}</button>
            </form>
          </> : <EmptyState title="Choose a conversation" message="Create or select a conversation to begin." />}
        </section>
      </section>
    </ErpPage>
  );
}
