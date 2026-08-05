'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErpPage, ErpPageHeader, ErpStateBanner } from '@/components/ui/ErpLayout';
import { getSupabaseClient } from '@/lib/supabase/client';

type DirectoryUser = { id: string; label: string; email: string };
type Thread = {
  id: string;
  thread_type: 'direct' | 'group';
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  members: Array<{ user_id: string; is_muted: boolean; archived_at: string | null }>;
};
type Message = { id: string; thread_id: string; sender_id: string; body: string; created_at: string };

const PAGE_SIZE = 50;

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

export function InternalMessagingWorkspace() {
  const { businessUser } = useAuth();
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const directoryById = useMemo(() => new Map(directory.map((user) => [user.id, user])), [directory]);
  const selectedThread = useMemo(() => threads.find((thread) => thread.id === selectedThreadId) ?? null, [selectedThreadId, threads]);

  const threadLabel = useCallback((thread: Thread) => {
    if (thread.title) return thread.title;
    const other = thread.members.find((member) => member.user_id !== businessUser?.id);
    return other ? directoryById.get(other.user_id)?.label ?? 'Direct conversation' : 'Conversation';
  }, [businessUser?.id, directoryById]);

  const loadDirectory = useCallback(async () => {
    const client = getSupabaseClient();
    const [{ data: users, error: usersError }, { data: details, error: detailsError }] = await Promise.all([
      client.from('users').select('id,email').eq('is_active', true).order('email'),
      client.from('user_details').select('user_id,first_name,last_name'),
    ]);
    if (usersError) throw usersError;
    if (detailsError) throw detailsError;
    const detailMap = new Map((details ?? []).map((row) => [String(row.user_id), row as Record<string, unknown>]));
    setDirectory((users ?? []).map((row) => ({
      id: String(row.id), email: String(row.email), label: displayName(detailMap.get(String(row.id)), String(row.email)),
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
    const { data: members, error: memberError } = ids.length
      ? await client.from('message_thread_members').select('thread_id,user_id,is_muted,archived_at').in('thread_id', ids).is('removed_at', null)
      : { data: [], error: null };
    if (memberError) throw memberError;

    const memberMap = new Map<string, Thread['members']>();
    (members ?? []).forEach((member) => {
      const key = String(member.thread_id);
      const list = memberMap.get(key) ?? [];
      list.push({ user_id: String(member.user_id), is_muted: Boolean(member.is_muted), archived_at: member.archived_at ? String(member.archived_at) : null });
      memberMap.set(key, list);
    });

    const rows = (threadRows ?? []).map((row) => ({ ...row, id: String(row.id), members: memberMap.get(String(row.id)) ?? [] })) as Thread[];
    setThreads(rows);
    setSelectedThreadId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    const { data, error: messageError } = await getSupabaseClient()
      .from('messages')
      .select('id,thread_id,sender_id,body,created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);
    if (messageError) {
      setError(messageError.message);
      setLoadingMessages(false);
      return;
    }
    setMessages(((data ?? []) as Message[]).reverse());
    setLoadingMessages(false);
    window.setTimeout(() => endRef.current?.scrollIntoView({ block: 'end' }), 0);
  }, []);

  useEffect(() => {
    if (!businessUser?.id) return;
    setLoading(true);
    Promise.all([loadDirectory(), loadThreads()])
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load messaging.'))
      .finally(() => setLoading(false));
  }, [businessUser?.id, loadDirectory, loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) { setMessages([]); return; }
    void loadMessages(selectedThreadId);
  }, [loadMessages, selectedThreadId]);

  useEffect(() => {
    if (!businessUser?.id) return;
    const client = getSupabaseClient();
    const channel = client.channel(`internal-messaging-${businessUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const changed = payload.new && typeof payload.new === 'object' && 'thread_id' in payload.new ? String(payload.new.thread_id) : null;
        void loadThreads();
        if (changed && changed === selectedThreadId) void loadMessages(changed);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_thread_members' }, () => void loadThreads())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [businessUser?.id, loadMessages, loadThreads, selectedThreadId]);

  async function createConversation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserIds.length) return;
    setError(null);
    const client = getSupabaseClient();
    const result = selectedUserIds.length === 1
      ? await client.rpc('create_direct_message_thread', { p_other_user_id: selectedUserIds[0] })
      : await client.rpc('create_group_message_thread', { p_title: groupTitle.trim(), p_member_user_ids: selectedUserIds });
    if (result.error) { setError(result.error.message); return; }
    setSelectedUserIds([]);
    setGroupTitle('');
    await loadThreads();
    setSelectedThreadId(String(result.data));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const copy = body.trim();
    if (!selectedThreadId || !copy || !businessUser?.id) return;
    setSending(true);
    setError(null);
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

  if (!businessUser) return <EmptyState title="Messages unavailable" message="Your ERP profile is still loading." />;

  return (
    <ErpPage className="internal-messaging-page" variant="operational">
      <ErpPageHeader eyebrow="Communications" title="Messages" description="Feature-flagged, text-only internal conversations." />
      {error ? <ErpStateBanner title="Messaging needs attention" message={error} tone="danger" /> : null}
      <section className="messages-v2-shell" aria-label="Internal messaging workspace">
        <aside className="messages-v2-sidebar">
          <form className="messages-v2-create" onSubmit={createConversation}>
            <strong>New conversation</strong>
            <select multiple value={selectedUserIds} onChange={(event) => setSelectedUserIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>
              {directory.filter((user) => user.id !== businessUser.id).map((user) => <option key={user.id} value={user.id}>{user.label} — {user.email}</option>)}
            </select>
            {selectedUserIds.length > 1 ? <input maxLength={120} required placeholder="Group name" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} /> : null}
            <button className="button" disabled={!selectedUserIds.length || (selectedUserIds.length > 1 && !groupTitle.trim())} type="submit">Create</button>
          </form>
          <nav className="messages-v2-thread-list" aria-label="Conversations">
            {loading ? <p>Loading conversations…</p> : null}
            {!loading && !threads.length ? <p>No conversations yet.</p> : null}
            {threads.map((thread) => (
              <button className={thread.id === selectedThreadId ? 'is-active' : ''} key={thread.id} onClick={() => setSelectedThreadId(thread.id)} type="button">
                <strong>{threadLabel(thread)}</strong>
                <small>{thread.thread_type === 'group' ? `${thread.members.length} participants` : 'Direct conversation'}</small>
              </button>
            ))}
          </nav>
        </aside>
        <section className="messages-v2-chat">
          {selectedThread ? <>
            <header><h2>{threadLabel(selectedThread)}</h2><p>Newest {PAGE_SIZE} messages load first.</p></header>
            <div className="messages-v2-log" role="log" aria-live="polite">
              {loadingMessages ? <p>Loading messages…</p> : null}
              {!loadingMessages && !messages.length ? <p>No messages yet.</p> : null}
              {messages.map((message) => {
                const mine = message.sender_id === businessUser.id;
                const sender = directoryById.get(message.sender_id)?.label ?? 'Colleague';
                return <article className={mine ? 'is-mine' : ''} key={message.id}>
                  {!mine ? <strong>{sender}</strong> : null}
                  <p>{message.body}</p><time>{formatTime(message.created_at)}</time>
                </article>;
              })}
              <div ref={endRef} />
            </div>
            <form className="messages-v2-composer" onSubmit={sendMessage}>
              <textarea maxLength={4000} placeholder="Write a message" rows={2} value={body} onChange={(event) => setBody(event.target.value)} />
              <button className="button" disabled={sending || !body.trim()} type="submit">{sending ? 'Sending…' : 'Send'}</button>
            </form>
          </> : <EmptyState title="Choose a conversation" message="Create or select a conversation to begin." />}
        </section>
      </section>
    </ErpPage>
  );
}
