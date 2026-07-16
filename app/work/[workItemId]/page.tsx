'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AssignableUser, WorkItemRecord, WorkStatus } from '@/types/professional-ops';

type ChecklistItem = { id: string; label: string; sort_order: number; is_required: boolean; is_completed: boolean; completed_by: string | null; completed_at: string | null };
type CommentRow = { id: string; body: string; created_by: string | null; created_at: string };
type AuditRow = { id: string; action: string; summary: string | null; actor_user_id: string | null; created_at: string; before_payload: Record<string, unknown> | null; after_payload: Record<string, unknown> | null };
type CustomerRelation = { customer_name: string | null };
type MachineRelation = { machine_name: string | null; serial_number: string | null };
type StockRelation = { stock_name: string | null };
type WorkRow = WorkItemRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
  stock_items?: StockRelation | StockRelation[] | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function nextStatuses(status: WorkStatus): WorkStatus[] {
  const map: Record<WorkStatus, WorkStatus[]> = {
    new: ['new', 'triaged', 'assigned', 'cancelled'],
    triaged: ['triaged', 'assigned', 'in_progress', 'cancelled'],
    assigned: ['assigned', 'in_progress', 'blocked', 'cancelled'],
    in_progress: ['in_progress', 'blocked', 'waiting_approval', 'completed', 'cancelled'],
    blocked: ['blocked', 'assigned', 'in_progress', 'cancelled'],
    waiting_approval: ['waiting_approval', 'in_progress', 'completed', 'blocked'],
    completed: ['completed'],
    cancelled: ['cancelled'],
  };
  return map[status];
}

export default function WorkItemWorkspacePage() {
  const { workItemId } = useParams<{ workItemId: string }>();
  const { businessUser, userDetails } = useAuth();
  const [work, setWork] = useState<WorkRow | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [newChecklistLabel, setNewChecklistLabel] = useState('');
  const [newChecklistRequired, setNewChecklistRequired] = useState(false);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadWorkspace() {
    setError(null);
    const client = getSupabaseClient();
    const [workResult, checklistResult, commentResult, userResult] = await Promise.all([
      client.from('work_items').select('*, customers(customer_name), machines(machine_name, serial_number), stock_items(stock_name)').eq('id', workItemId).single(),
      client.from('work_item_checklist').select('id, label, sort_order, is_required, is_completed, completed_by, completed_at').eq('work_item_id', workItemId).order('sort_order').order('created_at'),
      client.from('record_comments').select('id, body, created_by, created_at').eq('entity_type', 'work_item').eq('entity_id', workItemId).order('created_at'),
      client.rpc('list_assignable_users'),
    ]);
    const firstError = workResult.error ?? checklistResult.error ?? commentResult.error ?? userResult.error;
    if (firstError) throw firstError;
    setWork(workResult.data as WorkRow);
    setChecklist((checklistResult.data ?? []) as ChecklistItem[]);
    setComments((commentResult.data ?? []) as CommentRow[]);
    setUsers((userResult.data ?? []) as AssignableUser[]);
    const auditResult = await client.from('audit_events').select('id, action, summary, actor_user_id, created_at, before_payload, after_payload').eq('entity_type', 'work_item').eq('entity_id', workItemId).order('created_at', { ascending: false }).limit(100);
    setAudit(auditResult.error ? [] : (auditResult.data ?? []) as AuditRow[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadWorkspace().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load work item.'));
  }, [workItemId]);

  const userMap = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);
  const requiredCount = checklist.filter((item) => item.is_required).length;
  const completedRequired = checklist.filter((item) => item.is_required && item.is_completed).length;
  const completedCount = checklist.filter((item) => item.is_completed).length;
  const canAssign = ['admin', 'operations'].includes(userDetails?.role ?? '');
  const canReview = ['admin', 'operations', 'finance', 'executive'].includes(userDetails?.role ?? '');

  async function changeStatus(status: WorkStatus) {
    if (!work || status === work.status) return;
    setSaving(true);
    setError(null);
    const { error: statusError } = await getSupabaseClient().rpc('transition_work_item', { p_work_item_id: work.id, p_new_status: status });
    setSaving(false);
    if (statusError) {
      setError(statusError.message);
      return;
    }
    setMessage(`${work.work_number} moved to ${status.replace(/_/g, ' ')}.`);
    await loadWorkspace();
  }

  async function assignWork(assignedTo: string) {
    if (!work) return;
    setSaving(true);
    setError(null);
    const { error: assignError } = await getSupabaseClient().rpc('assign_work_item', { p_work_item_id: work.id, p_assigned_to: assignedTo || null });
    setSaving(false);
    if (assignError) {
      setError(assignError.message);
      return;
    }
    setMessage('Assignment updated.');
    await loadWorkspace();
  }

  async function reviewWork(accept: boolean) {
    if (!work) return;
    setSaving(true);
    setError(null);
    const { error: reviewError } = await getSupabaseClient().rpc('review_work_item', { p_work_item_id: work.id, p_accept: accept });
    setSaving(false);
    if (reviewError) {
      setError(reviewError.message);
      return;
    }
    setMessage(accept ? 'Work item approved.' : 'Work item rejected and blocked.');
    await loadWorkspace();
  }

  async function addChecklist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newChecklistLabel.trim()) return;
    setSaving(true);
    const { error: checklistError } = await getSupabaseClient().from('work_item_checklist').insert({
      work_item_id: workItemId,
      label: newChecklistLabel.trim(),
      sort_order: checklist.length,
      is_required: newChecklistRequired,
    });
    setSaving(false);
    if (checklistError) {
      setError(checklistError.message);
      return;
    }
    setNewChecklistLabel('');
    setNewChecklistRequired(false);
    await loadWorkspace();
  }

  async function toggleChecklist(item: ChecklistItem) {
    setSaving(true);
    const nextCompleted = !item.is_completed;
    const { error: updateError } = await getSupabaseClient().from('work_item_checklist').update({
      is_completed: nextCompleted,
      completed_by: nextCompleted ? businessUser?.id ?? null : null,
      completed_at: nextCompleted ? new Date().toISOString() : null,
    }).eq('id', item.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await loadWorkspace();
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !comment.trim()) return;
    setSaving(true);
    const { error: commentError } = await getSupabaseClient().from('record_comments').insert({ entity_type: 'work_item', entity_id: workItemId, body: comment.trim(), created_by: businessUser.id });
    setSaving(false);
    if (commentError) {
      setError(commentError.message);
      return;
    }
    setComment('');
    await loadWorkspace();
  }

  if (!work && !error) return <AppShell><div className="neo-card"><h2>Loading work item...</h2></div></AppShell>;

  return (
    <AppShell>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {!work ? <div className="neo-card"><h1>Work item not found</h1><Link className="button" href="/work">Back to Action Centre</Link></div> : <div className="grid professional-ops-stage">
        <div className="page-header hero-panel spatial-card">
          <div><div className="badge">{work.work_number}</div><h1>{work.title}</h1><p>{work.description ?? 'No description recorded.'}</p><div className="feature-list"><StatusBadge value={work.status} /><StatusBadge value={work.priority} /><StatusBadge value={work.work_type} />{work.approval_required ? <StatusBadge value={work.approval_status} /> : null}</div></div>
        </div>

        <PageToolbar actions={<><Link className="button secondary" href="/work">Back to Action Centre</Link><button className="button secondary" onClick={loadWorkspace} type="button">Refresh</button></>} description="Controlled ownership, workflow, checklist, approval and collaboration." lastUpdated={lastUpdated} title="Work controls">
          <label>Status<select disabled={saving} value={work.status} onChange={(event) => changeStatus(event.target.value as WorkStatus)}>{nextStatuses(work.status).map((status) => <option key={status}>{status}</option>)}</select></label>
          {canAssign ? <label>Assignee<select disabled={saving} value={work.assigned_to ?? ''} onChange={(event) => assignWork(event.target.value)}><option value="">Unassigned</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.role} — {user.branch.toUpperCase()}</option>)}</select></label> : null}
          {canReview && work.approval_status === 'pending' ? <div className="action-row"><button className="button" disabled={saving} onClick={() => reviewWork(true)} type="button">Approve</button><button className="button secondary" disabled={saving} onClick={() => reviewWork(false)} type="button">Reject</button></div> : null}
        </PageToolbar>

        <div className="grid grid-3 spatial-kpi-grid">
          <div className="card"><div className="nav-heading">Assignee</div><strong>{work.assigned_to ? userMap.get(work.assigned_to)?.display_name || 'Assigned user' : 'Unassigned'}</strong></div>
          <div className="card"><div className="nav-heading">Requested by</div><strong>{work.requested_by ? userMap.get(work.requested_by)?.display_name || 'Business user' : 'Unknown'}</strong></div>
          <div className="card"><div className="nav-heading">Checklist progress</div><div className="kpi-value">{completedCount}/{checklist.length}</div></div>
          <div className="card"><div className="nav-heading">Required steps</div><div className="kpi-value">{completedRequired}/{requiredCount}</div></div>
          <div className="card"><div className="nav-heading">Due</div><strong>{work.due_at ? new Date(work.due_at).toLocaleString() : 'Not set'}</strong></div>
          <div className="card"><div className="nav-heading">SLA target</div><strong>{work.sla_due_at ? new Date(work.sla_due_at).toLocaleString() : 'Not set'}</strong></div>
        </div>

        <section className="neo-card"><h2>Linked records</h2><div className="feature-list">{work.customer_id ? <Link className="feature-pill" href={`/customers/${work.customer_id}`}>Customer: {firstRelation(work.customers)?.customer_name ?? 'Open customer'}</Link> : null}{work.machine_id ? <Link className="feature-pill" href={`/operations/assets/${work.machine_id}`}>Machine: {firstRelation(work.machines)?.machine_name ?? firstRelation(work.machines)?.serial_number ?? 'Open machine'}</Link> : null}{work.stock_item_id ? <Link className="feature-pill" href={`/warehouse/stock/${work.stock_item_id}`}>Stock: {firstRelation(work.stock_items)?.stock_name ?? 'Open stock item'}</Link> : null}{!work.customer_id && !work.machine_id && !work.stock_item_id ? <span className="feature-pill">No records linked</span> : null}</div></section>

        <div className="grid grid-2">
          <section className="neo-card">
            <div className="page-toolbar-heading"><div><h2>Checklist</h2><p>Required steps are enforced before approval or completion.</p></div><StatusBadge value={completedRequired === requiredCount ? 'completed' : 'in_progress'} label={`${completedCount}/${checklist.length} complete`} /></div>
            <form className="form-grid" onSubmit={addChecklist}><label>New step<input value={newChecklistLabel} onChange={(event) => setNewChecklistLabel(event.target.value)} /></label><label className="checkbox-field"><input checked={newChecklistRequired} onChange={(event) => setNewChecklistRequired(event.target.checked)} type="checkbox" /> Required</label><div style={{ alignSelf: 'end' }}><button className="button secondary" disabled={saving || !newChecklistLabel.trim()} type="submit">Add step</button></div></form>
            <div className="professional-checklist">{checklist.length === 0 ? <p>No checklist steps yet.</p> : checklist.map((item) => <label className={`professional-checklist-item ${item.is_completed ? 'is-complete' : ''}`} key={item.id}><input checked={item.is_completed} disabled={saving} onChange={() => toggleChecklist(item)} type="checkbox" /><span><strong>{item.label}</strong><small>{item.is_required ? 'Required' : 'Optional'}{item.completed_at ? ` • completed ${new Date(item.completed_at).toLocaleString()}` : ''}</small></span></label>)}</div>
          </section>

          <section className="neo-card">
            <h2>Discussion</h2><form className="grid" onSubmit={addComment}><label>Add comment<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="button secondary" disabled={saving || !comment.trim()} type="submit">Post comment</button></form>
            <div className="record-comment-list">{comments.length === 0 ? <p>No comments yet.</p> : comments.map((item) => <article className="record-comment" key={item.id}><div className="page-toolbar-heading"><strong>{item.created_by ? userMap.get(item.created_by)?.display_name || 'Business user' : 'System'}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div><p>{item.body}</p></article>)}</div>
          </section>
        </div>

        <section className="neo-card"><h2>Audit timeline</h2><div className="record-timeline">{audit.length === 0 ? <p>Audit timeline is available to operations and administrators.</p> : audit.map((event) => <article className="record-timeline-item" key={event.id}><div><StatusBadge value={event.action} /><strong>{event.summary ?? event.action.replace(/_/g, ' ')}</strong><small>{new Date(event.created_at).toLocaleString()} • {event.actor_user_id ? userMap.get(event.actor_user_id)?.display_name || 'Business user' : 'System'}</small></div></article>)}</div></section>
      </div>}
    </AppShell>
  );
}
