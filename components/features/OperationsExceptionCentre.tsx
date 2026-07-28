'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AssignableUser } from '@/types/professional-ops';

type ExceptionStatus = 'open' | 'acknowledged' | 'snoozed' | 'escalated' | 'resolved';
type ExceptionSeverity = 'info' | 'warning' | 'high' | 'critical';
type QueueView = 'active' | 'mine' | 'unassigned' | 'escalated' | 'snoozed' | 'resolved';

type ExceptionCase = {
  id: string;
  source_key: string;
  source_type: string;
  source_id: string;
  exception_type: string;
  title: string;
  detail: string | null;
  branch: string;
  severity: ExceptionSeverity;
  status: ExceptionStatus;
  assigned_to: string | null;
  assigned_name: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  escalated_by: string | null;
  escalated_at: string | null;
  resolution_notes: string | null;
  source_href: string;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  comments_count: number | string;
};

type ExceptionComment = {
  id: string;
  body: string;
  created_by: string;
  created_name: string;
  created_at: string;
};

const supportedOwnerRoles = new Set(['admin', 'operations', 'executive', 'warehouse_staff', 'finance']);
const branchOptions = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const sourceLabels: Record<string, string> = {
  work_item: 'Work item',
  service_job: 'Service job',
  stock_alert: 'Stock alert',
  purchase_order: 'Purchase order',
  maintenance_plan: 'Maintenance',
  asset: 'Asset',
  delivery_order: 'Delivery',
};

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-ZA') : 'Not recorded';
}

function ageLabel(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return 'Seen within the last hour';
  if (hours < 24) return `Seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Seen ${days}d ago`;
}

export function OperationsExceptionCentre() {
  const { businessUser, userDetails } = useAuth();
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [comments, setComments] = useState<ExceptionComment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<QueueView>('active');
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [assignee, setAssignee] = useState('');
  const [comment, setComment] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [customSnooze, setCustomSnooze] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const canViewAllBranches = Boolean(
    userDetails && (userDetails.branch === 'national' || ['admin', 'executive'].includes(userDetails.role)),
  );

  const selected = useMemo(
    () => cases.find((item) => item.id === selectedId) ?? null,
    [cases, selectedId],
  );

  const loadCases = useCallback(async (synchronize = false) => {
    if (!userDetails) return;
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    if (synchronize) {
      const { error: syncError } = await client.rpc('sync_operational_exceptions');
      if (syncError) {
        setError(syncError.message);
        setLoading(false);
        return;
      }
    }

    const requestedBranch = canViewAllBranches ? 'all' : userDetails.branch;
    const [caseResult, userResult] = await Promise.all([
      client.rpc('list_exception_cases', { p_branch: requestedBranch, p_search: null }),
      client.rpc('list_assignable_users'),
    ]);

    const firstError = caseResult.error ?? userResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const nextCases = (caseResult.data ?? []) as ExceptionCase[];
    setCases(nextCases);
    setUsers(((userResult.data ?? []) as AssignableUser[]).filter((user) => supportedOwnerRoles.has(user.role)));
    setSelectedId((current) => current && nextCases.some((item) => item.id === current) ? current : nextCases[0]?.id ?? null);
    setLastUpdated(new Date());
    setLoading(false);
  }, [canViewAllBranches, userDetails]);

  const loadComments = useCallback(async (exceptionId: string) => {
    const { data, error: commentError } = await getSupabaseClient().rpc('list_exception_comments', {
      p_exception_id: exceptionId,
    });
    if (commentError) {
      setError(commentError.message);
      return;
    }
    setComments((data ?? []) as ExceptionComment[]);
  }, []);

  useEffect(() => {
    if (!userDetails) return;
    if (!canViewAllBranches) setBranchFilter(userDetails.branch);
    loadCases(true).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load operational exceptions.');
      setLoading(false);
    });
  }, [canViewAllBranches, loadCases, userDetails]);

  useEffect(() => {
    if (!selectedId) {
      setComments([]);
      return;
    }
    loadComments(selectedId).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load exception comments.');
    });
  }, [loadComments, selectedId]);

  useEffect(() => {
    setAssignee(selected?.assigned_to ?? '');
    setResolutionNote(selected?.resolution_notes ?? '');
    setComment('');
    setCustomSnooze('');
  }, [selected]);

  const metrics = useMemo(() => ({
    active: cases.filter((item) => !['resolved', 'snoozed'].includes(item.status)).length,
    critical: cases.filter((item) => item.status !== 'resolved' && ['critical', 'high'].includes(item.severity)).length,
    unassigned: cases.filter((item) => item.status !== 'resolved' && !item.assigned_to).length,
    escalated: cases.filter((item) => item.status === 'escalated').length,
    snoozed: cases.filter((item) => item.status === 'snoozed').length,
    resolved: cases.filter((item) => item.status === 'resolved').length,
  }), [cases]);

  const sourceTypes = useMemo(
    () => Array.from(new Set(cases.map((item) => item.source_type))).sort(),
    [cases],
  );

  const visibleCases = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cases.filter((item) => {
      const queueMatch = view === 'active'
        ? !['resolved', 'snoozed'].includes(item.status)
        : view === 'mine'
          ? item.status !== 'resolved' && item.assigned_to === businessUser?.id
          : view === 'unassigned'
            ? item.status !== 'resolved' && !item.assigned_to
            : item.status === view;
      const searchText = [item.title, item.detail, item.exception_type, item.source_type, item.branch, item.assigned_name]
        .join(' ')
        .toLowerCase();
      return queueMatch
        && (!term || searchText.includes(term))
        && (branchFilter === 'all' || item.branch === branchFilter)
        && (severityFilter === 'all' || item.severity === severityFilter)
        && (sourceFilter === 'all' || item.source_type === sourceFilter);
    });
  }, [branchFilter, businessUser?.id, cases, search, severityFilter, sourceFilter, view]);

  const ownerOptions = useMemo(() => users.filter((user) => {
    if (!selected || selected.branch === 'national') return true;
    return user.branch === selected.branch || user.branch === 'national';
  }), [selected, users]);

  async function runAction(
    action: string,
    options: { assignedTo?: string | null; snoozedUntil?: string | null; note?: string | null } = {},
  ) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: actionError } = await getSupabaseClient().rpc('triage_exception_case', {
      p_exception_id: selected.id,
      p_action: action,
      p_assigned_to: options.assignedTo ?? null,
      p_snoozed_until: options.snoozedUntil ?? null,
      p_note: options.note ?? null,
    });
    setSaving(false);
    if (actionError) {
      setError(actionError.message);
      return;
    }
    setMessage(`${selected.title}: ${action.replace(/_/g, ' ')} recorded.`);
    setComment('');
    await loadCases(false);
    await loadComments(selected.id);
  }

  function snoozeFor(hours: number) {
    const until = new Date(Date.now() + hours * 3_600_000).toISOString();
    return runAction('snooze', { snoozedUntil: until, note: comment.trim() || null });
  }

  return (
    <div className="exception-centre-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <PageToolbar
        actions={(
          <button className="button secondary" disabled={loading || saving} onClick={() => loadCases(true)} type="button">
            {loading ? 'Synchronizing…' : 'Synchronize exceptions'}
          </button>
        )}
        description="Persistent triage across overdue work, service, stock, purchasing, maintenance, assets and stalled deliveries. Source records remain authoritative."
        lastUpdated={lastUpdated}
        title="Operations Exception Centre"
      >
        <label>Search
          <input onChange={(event) => setSearch(event.target.value)} placeholder="Case, source, branch or owner" type="search" value={search} />
        </label>
        <label>Branch
          <select disabled={!canViewAllBranches} onChange={(event) => setBranchFilter(event.target.value)} value={branchFilter}>
            {(canViewAllBranches ? branchOptions : [userDetails?.branch ?? 'national']).map((branch) => (
              <option key={branch} value={branch}>{branch === 'all' ? 'All branches' : branch.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <label>Severity
          <select onChange={(event) => setSeverityFilter(event.target.value)} value={severityFilter}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label>Source
          <select onChange={(event) => setSourceFilter(event.target.value)} value={sourceFilter}>
            <option value="all">All sources</option>
            {sourceTypes.map((source) => <option key={source} value={source}>{sourceLabels[source] ?? source}</option>)}
          </select>
        </label>
      </PageToolbar>

      <section aria-label="Exception summary" className="grid grid-6 exception-centre-kpis">
        <button className="exception-kpi-button" onClick={() => setView('active')} type="button"><KpiCard label="Active" value={metrics.active} helper="Open, acknowledged and escalated." /></button>
        <button className="exception-kpi-button" onClick={() => setSeverityFilter('high')} type="button"><KpiCard label="High / critical" value={metrics.critical} helper="Cases requiring rapid attention." /></button>
        <button className="exception-kpi-button" onClick={() => setView('unassigned')} type="button"><KpiCard label="Unassigned" value={metrics.unassigned} helper="Cases without accountable owners." /></button>
        <button className="exception-kpi-button" onClick={() => setView('escalated')} type="button"><KpiCard label="Escalated" value={metrics.escalated} helper="Management attention requested." /></button>
        <button className="exception-kpi-button" onClick={() => setView('snoozed')} type="button"><KpiCard label="Snoozed" value={metrics.snoozed} helper="Deferred until a future time." /></button>
        <button className="exception-kpi-button" onClick={() => setView('resolved')} type="button"><KpiCard label="Resolved" value={metrics.resolved} helper="Closed manually or by source recovery." /></button>
      </section>

      <nav aria-label="Exception queues" className="exception-queue-tabs">
        {(['active', 'mine', 'unassigned', 'escalated', 'snoozed', 'resolved'] as QueueView[]).map((item) => (
          <button aria-pressed={view === item} className={view === item ? 'is-active' : ''} key={item} onClick={() => setView(item)} type="button">
            {item.replace(/_/g, ' ')}
          </button>
        ))}
      </nav>

      <div className="exception-centre-layout">
        <section aria-label="Exception cases" className="exception-case-list">
          <div className="exception-list-heading">
            <div><span className="minimal-kicker">{view.replace(/_/g, ' ')}</span><h2>{visibleCases.length} case{visibleCases.length === 1 ? '' : 's'}</h2></div>
            {loading ? <span>Refreshing…</span> : null}
          </div>
          {visibleCases.length === 0 ? <div className="empty-state">No exception cases match this queue.</div> : null}
          {visibleCases.map((item) => (
            <button
              aria-current={selectedId === item.id ? 'true' : undefined}
              className={`exception-case-card ${selectedId === item.id ? 'is-selected' : ''}`}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <div className="exception-case-card-top">
                <span>{sourceLabels[item.source_type] ?? item.source_type}</span>
                <div><StatusBadge value={item.severity} /><StatusBadge value={item.status} /></div>
              </div>
              <strong>{item.title}</strong>
              <p>{item.detail || 'No additional source detail.'}</p>
              <div className="exception-case-card-meta">
                <span>{item.branch.toUpperCase()}</span>
                <span>{item.assigned_name || 'Unassigned'}</span>
                <span>{ageLabel(item.last_seen_at)}</span>
                <span>{Number(item.comments_count) || 0} comments</span>
              </div>
            </button>
          ))}
        </section>

        <aside className="exception-case-detail">
          {!selected ? <div className="neo-card empty-state">Select an exception case to begin triage.</div> : (
            <div className="neo-card exception-detail-card">
              <div className="exception-detail-heading">
                <div>
                  <span className="minimal-kicker">{sourceLabels[selected.source_type] ?? selected.source_type} · {selected.exception_type.replace(/_/g, ' ')}</span>
                  <h2>{selected.title}</h2>
                  <p>{selected.detail || 'No additional source detail.'}</p>
                </div>
                <div className="exception-detail-badges"><StatusBadge value={selected.severity} /><StatusBadge value={selected.status} /></div>
              </div>

              <dl className="exception-detail-grid">
                <div><dt>Branch</dt><dd>{selected.branch.toUpperCase()}</dd></div>
                <div><dt>Owner</dt><dd>{selected.assigned_name || 'Unassigned'}</dd></div>
                <div><dt>First seen</dt><dd>{formatDateTime(selected.first_seen_at)}</dd></div>
                <div><dt>Last seen</dt><dd>{formatDateTime(selected.last_seen_at)}</dd></div>
                <div><dt>Acknowledged</dt><dd>{formatDateTime(selected.acknowledged_at)}</dd></div>
                <div><dt>Snoozed until</dt><dd>{formatDateTime(selected.snoozed_until)}</dd></div>
              </dl>

              <div className="exception-source-action">
                <div><strong>Authoritative source</strong><p>Resolve the underlying condition in its operating module.</p></div>
                <Link className="button" href={selected.source_href}>Open source record</Link>
              </div>

              <section className="exception-action-section">
                <h3>Ownership and status</h3>
                <div className="exception-owner-row">
                  <label>Assign owner
                    <select disabled={saving || selected.status === 'resolved'} onChange={(event) => setAssignee(event.target.value)} value={assignee}>
                      <option value="">Select owner</option>
                      {ownerOptions.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.role} · {user.branch.toUpperCase()}</option>)}
                    </select>
                  </label>
                  <button className="button secondary" disabled={saving || !assignee || selected.status === 'resolved'} onClick={() => runAction('assign', { assignedTo: assignee, note: comment.trim() || null })} type="button">Assign</button>
                </div>
                <div className="action-row exception-primary-actions">
                  {selected.status === 'open' ? <button className="button secondary" disabled={saving} onClick={() => runAction('acknowledge', { note: comment.trim() || null })} type="button">Acknowledge</button> : null}
                  {selected.status !== 'resolved' ? <button className="button secondary" disabled={saving || selected.status === 'escalated'} onClick={() => runAction('escalate', { note: comment.trim() || null })} type="button">Escalate</button> : null}
                  {selected.status === 'resolved' ? <button className="button" disabled={saving} onClick={() => runAction('reopen', { note: comment.trim() || null })} type="button">Reopen case</button> : null}
                </div>
              </section>

              {selected.status !== 'resolved' ? (
                <section className="exception-action-section">
                  <h3>Snooze</h3>
                  <div className="action-row">
                    <button className="button secondary" disabled={saving} onClick={() => snoozeFor(4)} type="button">4 hours</button>
                    <button className="button secondary" disabled={saving} onClick={() => snoozeFor(24)} type="button">Tomorrow</button>
                    <button className="button secondary" disabled={saving} onClick={() => snoozeFor(72)} type="button">3 days</button>
                  </div>
                  <div className="exception-custom-snooze">
                    <label>Custom time<input min={new Date().toISOString().slice(0, 16)} onChange={(event) => setCustomSnooze(event.target.value)} type="datetime-local" value={customSnooze} /></label>
                    <button className="button secondary" disabled={saving || !customSnooze} onClick={() => runAction('snooze', { snoozedUntil: new Date(customSnooze).toISOString(), note: comment.trim() || null })} type="button">Snooze until time</button>
                  </div>
                </section>
              ) : null}

              <section className="exception-action-section">
                <h3>Case discussion</h3>
                <label>Comment
                  <textarea onChange={(event) => setComment(event.target.value)} placeholder="Record context, decisions or the next action." value={comment} />
                </label>
                <button className="button secondary" disabled={saving || !comment.trim()} onClick={() => runAction('comment', { note: comment.trim() })} type="button">Add comment</button>
                <div className="exception-comments">
                  {comments.length === 0 ? <p>No comments recorded.</p> : comments.map((item) => (
                    <article key={item.id}><div><strong>{item.created_name}</strong><time>{formatDateTime(item.created_at)}</time></div><p>{item.body}</p></article>
                  ))}
                </div>
              </section>

              {selected.status !== 'resolved' ? (
                <section className="exception-action-section exception-resolve-section">
                  <h3>Resolve case</h3>
                  <label>Resolution note
                    <textarea onChange={(event) => setResolutionNote(event.target.value)} placeholder="Explain what was resolved or why this case can close." value={resolutionNote} />
                  </label>
                  <button className="button" disabled={saving || !resolutionNote.trim()} onClick={() => runAction('resolve', { note: resolutionNote.trim() })} type="button">Resolve exception</button>
                </section>
              ) : selected.resolution_notes ? <div className="success"><strong>Resolution:</strong> {selected.resolution_notes}</div> : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
