'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './ApprovalsWorkspace.module.css';

type AuditApprovalEvent = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  branch: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  summary: string | null;
  before_payload: Record<string, unknown> | null;
  after_payload: Record<string, unknown> | null;
  created_at: string;
};

type View = 'pending' | 'history' | 'policy';

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionLabel(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function decisionKind(action: string) {
  const value = action.toLowerCase();
  if (value.includes('reject')) return 'rejected';
  if (value.includes('approv')) return 'approved';
  if (value.includes('submit') || value.includes('request')) return 'submitted';
  return 'other';
}

export function ApprovalsWorkspace() {
  const [view, setView] = useState<View>('pending');
  const [events, setEvents] = useState<AuditApprovalEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('audit_events')
      .select('id,actor_user_id,actor_role,branch,entity_type,entity_id,action,summary,before_payload,after_payload,created_at')
      .or('action.ilike.%approv%,action.ilike.%reject%,action.ilike.%submit%')
      .order('created_at', { ascending: false })
      .limit(500);

    if (loadError) {
      setError(loadError.message);
      setEvents([]);
    } else {
      setEvents((data ?? []) as AuditApprovalEvent[]);
      setUpdated(new Date());
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = selectedId ? events.find((event) => event.id === selectedId) ?? null : null;
  const metrics = useMemo(() => ({
    pending: 0,
    approved: events.filter((event) => decisionKind(event.action) === 'approved').length,
    rejected: events.filter((event) => decisionKind(event.action) === 'rejected').length,
    submitted: events.filter((event) => decisionKind(event.action) === 'submitted').length,
  }), [events]);

  return (
    <section className={styles.workspace} data-approvals-workspace="v1">
      <header className={styles.header}>
        <div><span>Administration</span><h1>Approvals</h1><p>Approval evidence today, with the platform-wide risk approval engine clearly separated until its backend model exists.</p></div>
        <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading approval history" /> : <>
        <section className={styles.metrics}>
          <article><span>Pending</span><strong>{metrics.pending}</strong><small>No generic approval queue exists yet</small></article>
          <article><span>Approved · history</span><strong>{metrics.approved}</strong><small>Recorded audit decisions</small></article>
          <article><span>Rejected · history</span><strong>{metrics.rejected}</strong><small>Recorded audit decisions</small></article>
          <article><span>Submitted · history</span><strong>{metrics.submitted}</strong><small>Recorded approval submissions</small></article>
        </section>

        <nav className={styles.tabs} aria-label="Approval views">
          <button aria-selected={view === 'pending'} className={view === 'pending' ? styles.activeTab : ''} onClick={() => setView('pending')} type="button">Pending approvals</button>
          <button aria-selected={view === 'history'} className={view === 'history' ? styles.activeTab : ''} onClick={() => setView('history')} type="button">Decision history</button>
          <button aria-selected={view === 'policy'} className={view === 'policy' ? styles.activeTab : ''} onClick={() => setView('policy')} type="button">Approval policy</button>
        </nav>

        {view === 'pending' ? <section className={styles.emptyApproval}>
          <div><span>Approval queue</span><h2>Generic approval engine not yet persisted</h2><p>The approved design calls for risk level, requester, affected scope, approval path, expiry, revision history and request-changes handling. The production telemetry schema does not currently contain that generic approval model, so this screen intentionally shows no fabricated pending requests.</p></div>
          <aside>
            <strong>Required backend capability</strong>
            <ul><li>Approval request + revision records</li><li>Policy/version and required approver path</li><li>Approve, reject and request-changes decisions</li><li>Expiry/escalation and affected-scope evidence</li><li>Audit trail and rollback context for high-risk actions</li></ul>
          </aside>
        </section> : null}

        {view === 'history' ? <section className={styles.tableCard}>
          <header><div><strong>Approval-related audit history</strong><small>Existing audit events only · updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</small></div><span>{events.length} events</span></header>
          <div className={styles.tableScroll}><table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Entity</th><th>Branch</th><th>Outcome</th><th /></tr></thead><tbody>
            {events.map((event) => <tr key={event.id}>
              <td>{dateTime(event.created_at)}</td>
              <td><strong>{event.actor_role ?? 'System / unknown'}</strong><small>{event.actor_user_id ?? 'No actor ID'}</small></td>
              <td><strong>{actionLabel(event.action)}</strong><small>{event.summary ?? 'No summary'}</small></td>
              <td>{event.entity_type}<small>{event.entity_id ?? '—'}</small></td>
              <td>{event.branch?.toUpperCase() ?? '—'}</td>
              <td><span className={`${styles.outcome} ${styles[`outcome_${decisionKind(event.action)}`]}`}>{decisionKind(event.action)}</span></td>
              <td><button onClick={() => setSelectedId(event.id)} type="button">Evidence</button></td>
            </tr>)}
          </tbody></table></div>
          {!events.length ? <div className={styles.empty}>No approval-related audit events were found.</div> : null}
        </section> : null}

        {view === 'policy' ? <section className={styles.policyGrid}>
          <article><span>Low risk</span><strong>Single accountable approver</strong><p>Suitable for reversible, narrow-scope changes once a generic approval engine is implemented.</p></article>
          <article><span>Medium risk</span><strong>Explicit acknowledgement</strong><p>Decision context, affected scope and acknowledgement should be recorded before approval.</p></article>
          <article><span>High risk</span><strong>Multi-step approval</strong><p>Firmware, credential, fleet-wide or other high-impact changes should require stronger approval and rollback evidence.</p></article>
          <article><span>Critical</span><strong>Validated rollback plan</strong><p>Critical approval should remain blocked until rollback and recovery evidence passes validation.</p></article>
        </section> : null}

        {selected ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(null); }} role="presentation">
          <aside className={styles.drawer} aria-label="Approval evidence">
            <header><div><span>Decision evidence</span><h2>{actionLabel(selected.action)}</h2><p>{selected.summary ?? selected.entity_type}</p></div><button onClick={() => setSelectedId(null)} type="button">×</button></header>
            <dl>
              <div><dt>Timestamp</dt><dd>{dateTime(selected.created_at)}</dd></div>
              <div><dt>Actor role</dt><dd>{selected.actor_role ?? 'Not recorded'}</dd></div>
              <div><dt>Actor ID</dt><dd>{selected.actor_user_id ?? 'Not recorded'}</dd></div>
              <div><dt>Entity</dt><dd>{selected.entity_type}</dd></div>
              <div><dt>Entity ID</dt><dd>{selected.entity_id ?? 'Not recorded'}</dd></div>
              <div><dt>Branch</dt><dd>{selected.branch?.toUpperCase() ?? 'Not recorded'}</dd></div>
              <div><dt>Outcome</dt><dd>{decisionKind(selected.action)}</dd></div>
            </dl>
            <section className={styles.payloads}>
              <div><span>Before</span><pre>{selected.before_payload ? JSON.stringify(selected.before_payload, null, 2) : 'No before-payload recorded.'}</pre></div>
              <div><span>After</span><pre>{selected.after_payload ? JSON.stringify(selected.after_payload, null, 2) : 'No after-payload recorded.'}</pre></div>
            </section>
            <footer><Link href="/administration">Administration</Link><button onClick={() => setSelectedId(null)} type="button">Close</button></footer>
          </aside>
        </div> : null}
      </>}
    </section>
  );
}
