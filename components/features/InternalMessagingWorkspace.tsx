'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErpPage, ErpPageHeader, ErpStateBanner } from '@/components/ui/ErpLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole } from '@/types/dallmayrerp';

type DirectoryUser = {
  id: string;
  display_name: string;
  email: string;
  role: BusinessRole;
  branch: Branch;
};

type ThreadRow = {
  id: string;
  title: string;
  thread_type: 'direct' | 'group';
  participant_count: number;
  last_message_at: string | null;
  updated_at: string;
  created_at: string;
  last_message_body: string | null;
  last_message_sender_id: string | null;
  last_message_sender_name: string | null;
  last_message_created_at: string | null;
  unread_count: number;
  participant_names: string | null;
  is_muted: boolean;
  archived_at: string | null;
  pinned_count: number;
  saved_count: number;
};

type MessageAttachment = {
  id: string;
  file_path: string;
  file_name: string;
  content_type: string;
  file_size: number;
  created_at: string;
  signed_url?: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_name: string;
  body: string | null;
  message_type: 'text' | 'image' | 'document' | 'mixed' | 'system';
  reply_to_message_id: string | null;
  reply_to_body: string | null;
  reply_to_sender_name: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  read_by_count: number;
  read_by_names: string | null;
  saved_by_me: boolean;
  pinned_at: string | null;
  pinned_by_name: string | null;
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
};

type MessageReaction = {
  reaction: ReactionKey;
  count: number;
  reacted_by_me: boolean;
};

type ReactionKey = 'thumbs_up' | 'check' | 'eyes' | 'heart' | 'urgent';

type PresencePayload = {
  user_id?: string;
  display_name?: string;
  typing?: boolean;
  online_at?: string;
};

const ATTACHMENT_BUCKET = 'dallmayrerp-message-attachments';
const MAX_ATTACHMENTS = 4;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = [
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
  'text/csv',
];
const ACCEPT_ATTRIBUTE = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
  '.csv',
].join(',');
const reactionLabels: Record<ReactionKey, string> = {
  thumbs_up: 'Like',
  check: 'Done',
  eyes: 'Seen',
  heart: 'Appreciate',
  urgent: 'Urgent',
};
const reactionGlyphs: Record<ReactionKey, string> = {
  thumbs_up: '+1',
  check: 'OK',
  eyes: 'View',
  heart: 'Love',
  urgent: '!',
};
const reactionOptions = Object.keys(reactionLabels) as ReactionKey[];

function formatRelative(value: string | null) {
  if (!value) return 'No activity';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2);
  return letters.toUpperCase();
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment';
}

function uniqueFileToken() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      if (
        typeof record.id !== 'string'
        || typeof record.file_path !== 'string'
        || typeof record.file_name !== 'string'
        || typeof record.content_type !== 'string'
        || typeof record.file_size !== 'number'
        || typeof record.created_at !== 'string'
      ) {
        return null;
      }

      return {
        id: record.id,
        file_path: record.file_path,
        file_name: record.file_name,
        content_type: record.content_type,
        file_size: record.file_size,
        created_at: record.created_at,
      };
    })
    .filter((item): item is MessageAttachment => Boolean(item));
}

function parseReactions(value: unknown): MessageReaction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      if (
        typeof record.reaction !== 'string'
        || !reactionOptions.includes(record.reaction as ReactionKey)
        || typeof record.count !== 'number'
        || typeof record.reacted_by_me !== 'boolean'
      ) {
        return null;
      }

      return {
        reaction: record.reaction as ReactionKey,
        count: record.count,
        reacted_by_me: record.reacted_by_me,
      };
    })
    .filter((item): item is MessageReaction => Boolean(item));
}

function messagePreview(thread: ThreadRow) {
  if (thread.last_message_body) return thread.last_message_body;
  if (!thread.last_message_at) return 'No messages yet';
  return 'Attachment';
}

function userSearchText(user: DirectoryUser) {
  return `${user.display_name} ${user.email} ${user.role} ${user.branch}`.toLowerCase();
}

function threadSearchText(thread: ThreadRow) {
  return `${thread.title} ${thread.participant_names ?? ''} ${thread.last_message_body ?? ''}`.toLowerCase();
}

function messageSearchText(message: MessageRow) {
  return [
    message.sender_name,
    message.body,
    message.reply_to_body,
    message.attachments.map((attachment) => attachment.file_name).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

function deliveryLabel(message: MessageRow, mine: boolean) {
  if (!mine || message.message_type === 'system') return '';
  if (message.read_by_count > 0) return `Read by ${message.read_by_names ?? `${message.read_by_count} colleague${message.read_by_count === 1 ? '' : 's'}`}`;
  return 'Sent';
}

export function InternalMessagingWorkspace() {
  const { businessUser, userDetails } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadSearch, setThreadSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [groupTitle, setGroupTitle] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [replyTarget, setReplyTarget] = useState<MessageRow | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [savingThread, setSavingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const presenceChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads],
  );

  const filteredThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => threadSearchText(thread).includes(query));
  }, [threadSearch, threads]);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    const currentUserId = businessUser?.id;
    return users
      .filter((user) => user.id !== currentUserId)
      .filter((user) => !query || userSearchText(user).includes(query))
      .slice(0, 40);
  }, [businessUser?.id, userSearch, users]);

  const selectedUsers = useMemo(
    () => users.filter((user) => selectedUserIds.has(user.id)),
    [selectedUserIds, users],
  );

  const visibleMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter((message) => messageSearchText(message).includes(query));
  }, [messageSearch, messages]);

  const pinnedMessages = useMemo(
    () => messages.filter((message) => message.pinned_at && !message.deleted_at),
    [messages],
  );

  const savedMessages = useMemo(
    () => messages.filter((message) => message.saved_by_me && !message.deleted_at),
    [messages],
  );

  const loadDirectory = useCallback(async () => {
    const { data, error: directoryError } = await getSupabaseClient().rpc('list_messaging_users');
    if (directoryError) throw directoryError;
    setUsers((data ?? []) as DirectoryUser[]);
  }, []);

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    const { data, error: threadError } = await getSupabaseClient().rpc('list_message_threads', { p_include_archived: showArchived });
    if (threadError) {
      setError(threadError.message);
      setLoadingThreads(false);
      return;
    }

    const rows = (data ?? []) as ThreadRow[];
    setThreads(rows);
    setSelectedThreadId((current) => {
      const urlThread = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('thread') : null;
      if (urlThread && rows.some((thread) => thread.id === urlThread)) return urlThread;
      if (current && rows.some((thread) => thread.id === current)) return current;
      return rows[0]?.id ?? null;
    });
    setLoadingThreads(false);
  }, [showArchived]);

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    const client = getSupabaseClient();
    const { data, error: messageError } = await client.rpc('list_thread_messages', { p_thread_id: threadId });
    if (messageError) {
      setError(messageError.message);
      setLoadingMessages(false);
      return;
    }

    const rows = await Promise.all(((data ?? []) as Array<Omit<MessageRow, 'attachments' | 'reactions'> & { attachments: unknown; reactions: unknown }>).map(async (message) => {
      const attachments = await Promise.all(parseAttachments(message.attachments).map(async (attachment) => {
        const { data: signedData } = await client.storage.from(ATTACHMENT_BUCKET).createSignedUrl(attachment.file_path, 3600);
        return { ...attachment, signed_url: signedData?.signedUrl };
      }));
      return { ...message, attachments, reactions: parseReactions(message.reactions) };
    }));

    setMessages(rows);
    setLoadingMessages(false);
    await client.rpc('mark_thread_read', { p_thread_id: threadId });
    window.setTimeout(() => messagesEndRef.current?.scrollIntoView({ block: 'end' }), 50);
  }, []);

  useEffect(() => {
    loadDirectory().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load colleagues.'));
    void loadThreads();
  }, [loadDirectory, loadThreads]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedThreadId);
  }, [loadMessages, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('thread', selectedThreadId);
    window.history.replaceState(null, '', url);
  }, [selectedThreadId]);

  useEffect(() => {
    setMessageSearch('');
    setReplyTarget(null);
    setEditingMessageId(null);
    setEditBody('');
  }, [selectedThreadId]);

  useEffect(() => {
    if (!businessUser?.id) return;
    const client = getSupabaseClient();
    const channel = client
      .channel(`dallmayr-internal-messages-${businessUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_thread_participants' }, () => {
        void loadThreads();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        void loadThreads();
        const changedThreadId = typeof payload.new === 'object' && payload.new && 'thread_id' in payload.new
          ? String(payload.new.thread_id)
          : null;
        if (changedThreadId && changedThreadId === selectedThreadId) void loadMessages(changedThreadId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_attachments' }, () => {
        if (selectedThreadId) void loadMessages(selectedThreadId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => {
        if (selectedThreadId) void loadMessages(selectedThreadId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_pins' }, () => {
        void loadThreads();
        if (selectedThreadId) void loadMessages(selectedThreadId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_saved_items' }, () => {
        void loadThreads();
        if (selectedThreadId) void loadMessages(selectedThreadId);
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [businessUser?.id, loadMessages, loadThreads, selectedThreadId]);

  useEffect(() => {
    if (!businessUser?.id || !selectedThreadId) {
      setOnlineUserIds(new Set());
      setTypingUsers([]);
      return;
    }

    const client = getSupabaseClient();
    const currentUserId = businessUser.id;
    const displayName = userDetails?.first_name || userDetails?.last_name
      ? [userDetails.first_name, userDetails.last_name].filter(Boolean).join(' ')
      : businessUser.email;
    const channel = client.channel(`presence-message-thread-${selectedThreadId}`);

    function syncPresence() {
      const state = channel.presenceState() as Record<string, PresencePayload[]>;
      const online = new Set<string>();
      const typingNames: string[] = [];

      Object.values(state).flat().forEach((presence) => {
        if (!presence.user_id) return;
        online.add(presence.user_id);
        if (presence.typing && presence.user_id !== currentUserId) {
          typingNames.push(presence.display_name ?? 'A colleague');
        }
      });

      setOnlineUserIds(online);
      setTypingUsers(Array.from(new Set(typingNames)).slice(0, 3));
    }

    channel
      .on('presence', { event: 'sync' }, () => syncPresence())
      .on('presence', { event: 'join' }, () => syncPresence())
      .on('presence', { event: 'leave' }, () => syncPresence())
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        await channel.track({
          user_id: currentUserId,
          display_name: displayName,
          typing: false,
          online_at: new Date().toISOString(),
        });
      });

    presenceChannelRef.current = channel;

    return () => {
      presenceChannelRef.current = null;
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      void channel.untrack();
      void client.removeChannel(channel);
      setOnlineUserIds(new Set());
      setTypingUsers([]);
    };
  }, [businessUser?.email, businessUser?.id, selectedThreadId, userDetails?.first_name, userDetails?.last_name]);

  function toggleUser(userId: string) {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function publishTyping(typing: boolean) {
    if (!businessUser?.id || !presenceChannelRef.current) return;
    void presenceChannelRef.current.track({
      user_id: businessUser.id,
      display_name: userDetails?.first_name || userDetails?.last_name
        ? [userDetails.first_name, userDetails.last_name].filter(Boolean).join(' ')
        : businessUser.email,
      typing,
      online_at: new Date().toISOString(),
    });
  }

  function updateComposeBody(value: string) {
    setComposeBody(value);
    publishTyping(Boolean(value.trim()));
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => publishTyping(false), 1800);
  }

  async function createThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserIds.size) {
      setError('Select at least one colleague.');
      return;
    }

    setSavingThread(true);
    setError(null);
    setSuccess(null);
    const { data, error: createError } = await getSupabaseClient().rpc('create_message_thread', {
      p_participant_ids: Array.from(selectedUserIds),
      p_title: groupTitle.trim() || null,
    });
    setSavingThread(false);

    if (createError) {
      setError(createError.message);
      return;
    }

    setSelectedThreadId(String(data));
    setSelectedUserIds(new Set());
    setGroupTitle('');
    setUserSearch('');
    setSuccess('Conversation created.');
    await loadThreads();
  }

  async function refreshSelectedThread() {
    await loadThreads();
    if (selectedThreadId) await loadMessages(selectedThreadId);
  }

  async function setThreadMuted() {
    if (!selectedThread) return;
    setError(null);
    const { error: muteError } = await getSupabaseClient().rpc('set_message_thread_muted', {
      p_thread_id: selectedThread.id,
      p_muted: !selectedThread.is_muted,
    });
    if (muteError) {
      setError(muteError.message);
      return;
    }
    setSuccess(selectedThread.is_muted ? 'Conversation unmuted.' : 'Conversation muted.');
    await loadThreads();
  }

  async function setThreadArchived() {
    if (!selectedThread) return;
    setError(null);
    const nextArchived = !selectedThread.archived_at;
    const { error: archiveError } = await getSupabaseClient().rpc('set_message_thread_archived', {
      p_thread_id: selectedThread.id,
      p_archived: nextArchived,
    });
    if (archiveError) {
      setError(archiveError.message);
      return;
    }
    setSuccess(nextArchived ? 'Conversation archived.' : 'Conversation restored.');
    if (nextArchived && !showArchived) setSelectedThreadId(null);
    await loadThreads();
  }

  async function toggleReaction(messageId: string, reaction: ReactionKey) {
    if (!selectedThreadId) return;
    setError(null);
    const { error: reactionError } = await getSupabaseClient().rpc('toggle_message_reaction', {
      p_message_id: messageId,
      p_reaction: reaction,
    });
    if (reactionError) {
      setError(reactionError.message);
      return;
    }
    await loadMessages(selectedThreadId);
  }

  async function toggleSaved(messageId: string) {
    if (!selectedThreadId) return;
    setError(null);
    const { error: savedError } = await getSupabaseClient().rpc('toggle_message_saved', { p_message_id: messageId });
    if (savedError) {
      setError(savedError.message);
      return;
    }
    await refreshSelectedThread();
  }

  async function togglePinned(messageId: string) {
    if (!selectedThreadId) return;
    setError(null);
    const { error: pinError } = await getSupabaseClient().rpc('toggle_message_pin', { p_message_id: messageId });
    if (pinError) {
      setError(pinError.message);
      return;
    }
    await refreshSelectedThread();
  }

  function beginEdit(message: MessageRow) {
    setEditingMessageId(message.id);
    setEditBody(message.body ?? '');
    setReplyTarget(null);
  }

  async function saveEditedMessage(messageId: string) {
    if (!selectedThreadId || !editBody.trim()) return;
    setError(null);
    const { error: editError } = await getSupabaseClient().rpc('edit_thread_message', {
      p_message_id: messageId,
      p_body: editBody.trim(),
    });
    if (editError) {
      setError(editError.message);
      return;
    }
    setEditingMessageId(null);
    setEditBody('');
    await loadMessages(selectedThreadId);
  }

  async function deleteMessage(messageId: string) {
    if (!selectedThreadId) return;
    setError(null);
    const { error: deleteError } = await getSupabaseClient().rpc('delete_thread_message', { p_message_id: messageId });
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await refreshSelectedThread();
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const next = [...selectedFiles, ...files].slice(0, MAX_ATTACHMENTS);
    const rejected = files.find((file) => !ACCEPTED_FILE_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE);
    if (rejected) {
      setError(`${rejected.name} is not an allowed file type or is larger than 25 MB.`);
      event.target.value = '';
      return;
    }

    setSelectedFiles(next);
    setError(files.length + selectedFiles.length > MAX_ATTACHMENTS ? `Only ${MAX_ATTACHMENTS} attachments can be sent at once.` : null);
    event.target.value = '';
  }

  function removeSelectedFile(name: string, lastModified: number) {
    setSelectedFiles((current) => current.filter((file) => file.name !== name || file.lastModified !== lastModified));
  }

  function inferMessageType(files: File[], body: string) {
    if (!files.length) return 'text';
    if (body.trim()) return 'mixed';
    return files.every((file) => file.type.startsWith('image/')) ? 'image' : 'document';
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !selectedThreadId) return;
    if (!composeBody.trim() && !selectedFiles.length) {
      setError('Enter a message or attach a file.');
      return;
    }

    setSending(true);
    setError(null);
    setSuccess(null);
    const client = getSupabaseClient();
    const uploadedPaths: string[] = [];

    try {
      for (const file of selectedFiles) {
        if (!ACCEPTED_FILE_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE) {
          throw new Error(`${file.name} is not an allowed file type or is larger than 25 MB.`);
        }

        const filePath = `${businessUser.id}/${selectedThreadId}/${uniqueFileToken()}-${safeFileName(file.name)}`;
        const { error: uploadError } = await client.storage.from(ATTACHMENT_BUCKET).upload(filePath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        uploadedPaths.push(filePath);
      }

      const messageType = inferMessageType(selectedFiles, composeBody);
      const { data: messageId, error: sendError } = await client.rpc('send_thread_message', {
        p_thread_id: selectedThreadId,
        p_body: composeBody.trim() || null,
        p_message_type: messageType,
        p_reply_to_message_id: replyTarget?.id ?? null,
      });
      if (sendError) throw sendError;

      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const { error: attachmentError } = await client.rpc('create_message_attachment', {
          p_message_id: String(messageId),
          p_file_path: uploadedPaths[index],
          p_file_name: file.name,
          p_content_type: file.type,
          p_file_size: file.size,
        });
        if (attachmentError) throw attachmentError;
      }

      setComposeBody('');
      setSelectedFiles([]);
      setReplyTarget(null);
      publishTyping(false);
      fileInputRef.current?.form?.reset();
      await Promise.all([loadThreads(), loadMessages(selectedThreadId)]);
    } catch (sendError) {
      if (uploadedPaths.length) await client.storage.from(ATTACHMENT_BUCKET).remove(uploadedPaths);
      setError(sendError instanceof Error ? sendError.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  const unreadTotal = threads.reduce((sum, thread) => sum + Number(thread.unread_count ?? 0), 0);

  if (!businessUser || !userDetails) {
    return <EmptyState title="Messages unavailable" message="Your ERP profile is still loading." />;
  }

  return (
    <ErpPage className="internal-messaging-page" variant="operational">
      <ErpPageHeader
        actions={(
          <div className="messages-page-actions">
            <button className={showArchived ? 'button' : 'button secondary'} onClick={() => setShowArchived((current) => !current)} type="button">
              {showArchived ? 'Showing archived' : 'Show archived'}
            </button>
            <button className="button secondary" disabled={loadingThreads} onClick={() => void loadThreads()} type="button">Refresh</button>
          </div>
        )}
        description="Company conversations, operational images and business documents stay inside DallmayrERP."
        eyebrow="Communications"
        meta={<StatusBadge label={`${unreadTotal} unread`} value={unreadTotal ? 'active' : 'completed'} />}
        title="Messages"
      />

      {error ? <ErpStateBanner title="Messaging needs attention" message={error} tone="danger" /> : null}
      {success ? <ErpStateBanner title="Done" message={success} tone="success" /> : null}

      <section className="messages-shell" aria-label="Internal messaging workspace">
        <aside className="messages-sidebar" aria-label="Conversations and colleagues">
          <form className="messages-new-thread" onSubmit={createThread}>
            <div className="messages-panel-heading">
              <span>New conversation</span>
              <strong>{selectedUsers.length ? `${selectedUsers.length} selected` : 'Select colleagues'}</strong>
            </div>
            <label>
              <span>Search colleagues</span>
              <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Name, role or branch" />
            </label>
            {selectedUsers.length > 1 ? (
              <label>
                <span>Group name</span>
                <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Optional" />
              </label>
            ) : null}
            <div className="messages-selected-users" aria-label="Selected colleagues">
              {selectedUsers.map((user) => (
                <button key={user.id} onClick={() => toggleUser(user.id)} type="button">
                  {user.display_name}
                </button>
              ))}
            </div>
            <div className="messages-user-list">
              {filteredUsers.map((user) => {
                const selected = selectedUserIds.has(user.id);
                return (
                  <button className={selected ? 'is-selected' : ''} key={user.id} onClick={() => toggleUser(user.id)} type="button">
                    <span className="messages-avatar" aria-hidden="true">{initials(user.display_name)}</span>
                    <span>
                      <strong>{user.display_name}</strong>
                      <small>{roleLabels[user.role]} - {user.branch.toUpperCase()}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <button className="button" disabled={savingThread || !selectedUserIds.size} type="submit">
              {savingThread ? 'Creating...' : 'Create conversation'}
            </button>
          </form>

          <div className="messages-thread-search">
            <label>
              <span>Search conversations</span>
              <input value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="Conversation or message" />
            </label>
          </div>

          <nav className="messages-thread-list" aria-label="Conversations">
            {loadingThreads ? <div className="messages-empty-list">Loading conversations...</div> : null}
            {!loadingThreads && filteredThreads.length === 0 ? <div className="messages-empty-list">No conversations yet.</div> : null}
            {filteredThreads.map((thread) => {
              const active = thread.id === selectedThreadId;
              return (
                <button className={active ? 'is-active' : ''} key={thread.id} onClick={() => setSelectedThreadId(thread.id)} type="button">
                  <span className="messages-avatar" aria-hidden="true">{initials(thread.title)}</span>
                  <span className="messages-thread-copy">
                    <strong>{thread.title}</strong>
                    <small>{messagePreview(thread)}</small>
                    <span className="messages-thread-badges">
                      {thread.is_muted ? <em>Muted</em> : null}
                      {thread.archived_at ? <em>Archived</em> : null}
                      {thread.pinned_count ? <em>{thread.pinned_count} pinned</em> : null}
                      {thread.saved_count ? <em>{thread.saved_count} saved</em> : null}
                    </span>
                  </span>
                  <span className="messages-thread-meta">
                    <time>{formatRelative(thread.last_message_created_at ?? thread.last_message_at ?? thread.created_at)}</time>
                    {thread.unread_count ? <em>{thread.unread_count > 99 ? '99+' : thread.unread_count}</em> : null}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="messages-chat" aria-label={selectedThread ? selectedThread.title : 'Conversation'}>
          {selectedThread ? (
            <>
              <header className="messages-chat-header">
                <div>
                  <span className="messages-avatar" aria-hidden="true">{initials(selectedThread.title)}</span>
                  <div>
                    <h2>{selectedThread.title}</h2>
                    <p>
                      {selectedThread.participant_count} participant{selectedThread.participant_count === 1 ? '' : 's'}
                      {' - '}
                      {Math.max(0, onlineUserIds.size - 1)} online
                      {' - '}
                      {selectedThread.participant_names}
                    </p>
                  </div>
                </div>
                <div className="messages-chat-actions">
                  <button className="button secondary" disabled={savingThread} onClick={() => void setThreadMuted()} type="button">
                    {selectedThread.is_muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button className="button secondary" disabled={savingThread} onClick={() => void setThreadArchived()} type="button">
                    {selectedThread.archived_at ? 'Restore' : 'Archive'}
                  </button>
                  <button className="button secondary" disabled={savingThread} onClick={() => void loadMessages(selectedThread.id)} type="button">Reload</button>
                </div>
              </header>

              <div className="messages-chat-tools">
                <label>
                  <span>Search this conversation</span>
                  <input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Search messages or files" />
                </label>
                {pinnedMessages.length ? (
                  <div className="messages-highlight-strip" aria-label="Pinned messages">
                    <strong>Pinned</strong>
                    {pinnedMessages.slice(0, 4).map((message) => (
                      <button key={message.id} onClick={() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ block: 'center' })} type="button">
                        {message.body ?? message.attachments[0]?.file_name ?? 'Pinned attachment'}
                      </button>
                    ))}
                  </div>
                ) : null}
                {savedMessages.length ? (
                  <div className="messages-highlight-strip" aria-label="Saved messages">
                    <strong>Saved</strong>
                    {savedMessages.slice(0, 4).map((message) => (
                      <button key={message.id} onClick={() => document.getElementById(`message-${message.id}`)?.scrollIntoView({ block: 'center' })} type="button">
                        {message.body ?? message.attachments[0]?.file_name ?? 'Saved attachment'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="messages-log" role="log" aria-live="polite">
                {loadingMessages ? <div className="messages-empty-list">Loading messages...</div> : null}
                {!loadingMessages && visibleMessages.length === 0 ? <div className="messages-empty-list">{messageSearch ? 'No messages match your search.' : 'No messages yet.'}</div> : null}
                {visibleMessages.map((message) => {
                  const mine = message.sender_id === businessUser.id;
                  const system = message.message_type === 'system';
                  const deleted = Boolean(message.deleted_at);
                  const readStatus = deliveryLabel(message, mine);
                  return (
                    <article className={`message-bubble ${mine ? 'is-mine' : ''} ${system ? 'is-system' : ''} ${deleted ? 'is-deleted' : ''}`} id={`message-${message.id}`} key={message.id}>
                      <header className="message-bubble-header">
                        {!mine && !system ? <span className="message-sender">{message.sender_name}</span> : <span />}
                        {!system && !deleted ? (
                          <div className="message-actions">
                            <button onClick={() => setReplyTarget(message)} type="button">Reply</button>
                            <button className={message.saved_by_me ? 'is-active' : ''} onClick={() => void toggleSaved(message.id)} type="button">{message.saved_by_me ? 'Saved' : 'Save'}</button>
                            <button className={message.pinned_at ? 'is-active' : ''} onClick={() => void togglePinned(message.id)} type="button">{message.pinned_at ? 'Unpin' : 'Pin'}</button>
                            {mine ? <button onClick={() => beginEdit(message)} type="button">Edit</button> : null}
                            {mine || userDetails.role === 'admin' ? <button onClick={() => void deleteMessage(message.id)} type="button">Delete</button> : null}
                          </div>
                        ) : null}
                      </header>

                      {message.reply_to_message_id ? (
                        <button className="message-reply-preview" onClick={() => document.getElementById(`message-${message.reply_to_message_id}`)?.scrollIntoView({ block: 'center' })} type="button">
                          <strong>{message.reply_to_sender_name ?? 'Reply'}</strong>
                          <span>{message.reply_to_body ?? 'Original message unavailable'}</span>
                        </button>
                      ) : null}

                      {deleted ? <p className="message-deleted-copy">This message was deleted.</p> : null}

                      {editingMessageId === message.id ? (
                        <form className="message-edit-form" onSubmit={(event) => { event.preventDefault(); void saveEditedMessage(message.id); }}>
                          <textarea aria-label="Edit message" value={editBody} onChange={(event) => setEditBody(event.target.value)} />
                          <span>
                            <button className="button secondary" onClick={() => { setEditingMessageId(null); setEditBody(''); }} type="button">Cancel</button>
                            <button className="button" disabled={!editBody.trim()} type="submit">Save</button>
                          </span>
                        </form>
                      ) : message.body && !deleted ? <p>{message.body}</p> : null}

                      {!deleted && message.attachments.length ? (
                        <div className="message-attachments">
                          {message.attachments.map((attachment) => {
                            const image = attachment.content_type.startsWith('image/');
                            return (
                              <a className={image ? 'message-attachment is-image' : 'message-attachment'} href={attachment.signed_url ?? '#'} key={attachment.id} rel="noreferrer" target="_blank">
                                {image && attachment.signed_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img alt={attachment.file_name} src={attachment.signed_url} />
                                ) : <span aria-hidden="true">DOC</span>}
                                <strong>{attachment.file_name}</strong>
                                <small>{formatBytes(attachment.file_size)}</small>
                              </a>
                            );
                          })}
                        </div>
                      ) : null}

                      {!system && !deleted ? (
                        <div className="message-reaction-bar" aria-label="Message reactions">
                          {reactionOptions.map((reaction) => {
                            const current = message.reactions.find((item) => item.reaction === reaction);
                            return (
                              <button
                                aria-label={reactionLabels[reaction]}
                                className={current?.reacted_by_me ? 'is-active' : ''}
                                key={reaction}
                                onClick={() => void toggleReaction(message.id, reaction)}
                                type="button"
                              >
                                <span>{reactionGlyphs[reaction]}</span>
                                {current?.count ? <em>{current.count}</em> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      <footer className="message-bubble-footer">
                        <time>{formatTime(message.created_at)}{message.edited_at && !deleted ? ' - edited' : ''}</time>
                        {message.pinned_at ? <span>Pinned</span> : null}
                        {readStatus ? <span>{readStatus}</span> : null}
                      </footer>
                    </article>
                  );
                })}
                {typingUsers.length ? (
                  <div className="messages-typing-indicator">{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</div>
                ) : null}
                <div ref={messagesEndRef} />
              </div>

              <form className="messages-composer" onSubmit={sendMessage}>
                {replyTarget ? (
                  <div className="messages-reply-target">
                    <div>
                      <strong>Replying to {replyTarget.sender_name}</strong>
                      <span>{replyTarget.body ?? replyTarget.attachments[0]?.file_name ?? 'Attachment'}</span>
                    </div>
                    <button aria-label="Cancel reply" onClick={() => setReplyTarget(null)} type="button">Cancel</button>
                  </div>
                ) : null}
                {selectedFiles.length ? (
                  <div className="messages-file-tray">
                    {selectedFiles.map((file) => (
                      <button key={`${file.name}-${file.lastModified}`} onClick={() => removeSelectedFile(file.name, file.lastModified)} type="button">
                        <strong>{file.name}</strong>
                        <small>{formatBytes(file.size)}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="messages-composer-row">
                  <label className="messages-attach-button">
                    <span aria-hidden="true">+</span>
                    <input accept={ACCEPT_ATTRIBUTE} hidden multiple onChange={handleFiles} ref={fileInputRef} type="file" />
                  </label>
                  <textarea
                    aria-label="Message"
                    onChange={(event) => updateComposeBody(event.target.value)}
                    placeholder="Message"
                    rows={1}
                    value={composeBody}
                  />
                  <button className="button" disabled={sending || (!composeBody.trim() && !selectedFiles.length)} type="submit">
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            <EmptyState
              title="Choose a conversation"
              message="Start with a colleague or select an existing conversation."
            />
          )}
        </section>
      </section>
    </ErpPage>
  );
}
