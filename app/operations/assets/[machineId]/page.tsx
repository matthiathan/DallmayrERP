'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { AssetTicketCard } from '@/components/ui/AssetTicketCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AssignableUser, MachineLifecycleRecord, WorkPriority } from '@/types/professional-ops';

type CustomerRelation = { customer_name: string | null };
type SiteRelation = { site_name: string | null; address: string | null };
type MachineRow = MachineLifecycleRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  customer_sites?: SiteRelation | SiteRelation[] | null;
};
type AssetEvent = { id: string; event_type: string; actor_user_id: string | null; custodian: string | null; condition: string | null; notes: string | null; metadata: Record<string, unknown>; created_at: string };
type AssetAudit = { id: string; audited_by: string | null; result: string; condition: string; notes: string | null; next_audit_at: string | null; created_at: string };
type ServiceJob = { id: string; job_number: string; summary: string; priority: string; status: string; due_at: string | null; created_at: string };
type CommentRow = { id: string; body: string; created_by: string | null; created_at: string };

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default function AssetLifecycleWorkspacePage() {
  const { machineId } = useParams<{ machineId: string }>();
  const { businessUser, userDetails } = useAuth();
  const [machine, setMachine] = useState<MachineRow | null>(null);
  const [events, setEvents] = useState<AssetEvent[]>([]);
  const [audits, setAudits] = useState<AssetAudit[]>([]);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [criticality, setCriticality] = useState('medium');
  const [condition, setCondition] = useState('unknown');
  const [installedAt, setInstalledAt] = useState('');
  const [warrantyExpiresAt, setWarrantyExpiresAt] = useState('');
  const [nextAuditAt, setNextAuditAt] = useState('');
  const [custodyAction, setCustodyAction] = useState('assign');
  const [custodian, setCustodian] = useState('');
  const [custodyCondition, setCustodyCondition] = useState('good');
  const [custodyNotes, setCustodyNotes] = useState('');
  const [auditResult, setAuditResult] = useState('passed');
  const [auditCondition, setAuditCondition] = useState('good');
  const [auditNotes, setAuditNotes] = useState('');
  const [auditNextAt, setAuditNextAt] = useState('');
  const [workTitle, setWorkTitle] = useState('');
  const [workPriority, setWorkPriority] = useState<WorkPriority>('medium');
  const [workAssignedTo, setWorkAssignedTo] = useState('');
  const [workDueAt, setWorkDueAt] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAsset() {
    setError(null);
    const client = getSupabaseClient();
    const [machineResult, eventResult, auditResultData, jobResult, commentResult, userResult] = await Promise.all([
      client.from('machines').select('id, branch, customer_id, site_id, serial_number, machine_barcode, machine_name, model, status, condition, criticality, installed_at, warranty_expires_at, last_audit_at, next_audit_at, current_custodian, custody_status, created_at, updated_at, customers(customer_name), customer_sites(site_name, address)').eq('id', machineId).single(),
      client.from('asset_events').select('id, event_type, actor_user_id, custodian, condition, notes, metadata, created_at').eq('machine_id', machineId).order('created_at', { ascending: false }).limit(150),
      client.from('asset_audits').select('id, audited_by, result, condition, notes, next_audit_at, created_at').eq('machine_id', machineId).order('created_at', { ascending: false }).limit(100),
      client.from('service_jobs').select('id, job_number, summary, priority, status, due_at, created_at').eq('machine_id', machineId).order('created_at', { ascending: false }).limit(100),
      client.from('record_comments').select('id, body, created_by, created_at').eq('entity_type', 'machine').eq('entity_id', machineId).order('created_at'),
      client.rpc('list_assignable_users'),
    ]);
    const firstError = machineResult.error ?? eventResult.error ?? auditResultData.error ?? jobResult.error ?? commentResult.error ?? userResult.error;
    if (firstError) throw firstError;
    const row = machineResult.data as MachineRow;
    setMachine(row);
    setEvents((eventResult.data ?? []) as AssetEvent[]);
    setAudits((auditResultData.data ?? []) as AssetAudit[]);
    setJobs((jobResult.data ?? []) as ServiceJob[]);
    setComments((commentResult.data ?? []) as CommentRow[]);
    setUsers((userResult.data ?? []) as AssignableUser[]);
    setCriticality(row.criticality);
    setCondition(row.condition);
    setInstalledAt(row.installed_at ?? '');
    setWarrantyExpiresAt(row.warranty_expires_at ?? '');
    setNextAuditAt(row.next_audit_at ? row.next_audit_at.slice(0, 16) : '');
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadAsset().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load asset.'));
  }, [machineId]);

  const userMap = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);
  const customer = machine ? firstRelation(machine.customers) : null;
  const site = machine ? firstRelation(machine.customer_sites) : null;
  const canEditProfile = ['admin', 'operations'].includes(userDetails?.role ?? '');

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: updateError } = await getSupabaseClient().rpc('update_asset_profile', {
      p_machine_id: machineId,
      p_criticality: criticality,
      p_condition: condition,
      p_installed_at: installedAt || null,
      p_warranty_expires_at: warrantyExpiresAt || null,
      p_next_audit_at: nextAuditAt ? new Date(nextAuditAt).toISOString() : null,
    });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage('Asset lifecycle profile updated.');
    await loadAsset();
  }

  async function updateCustody(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: custodyError } = await getSupabaseClient().rpc('update_asset_custody', {
      p_machine_id: machineId,
      p_action: custodyAction,
      p_custodian: custodian.trim() || null,
      p_condition: custodyCondition,
      p_notes: custodyNotes.trim() || null,
    });
    setSaving(false);
    if (custodyError) {
      setError(custodyError.message);
      return;
    }
    setMessage('Custody event recorded.');
    setCustodian('');
    setCustodyNotes('');
    await loadAsset();
  }

  async function recordAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: auditError } = await getSupabaseClient().rpc('record_asset_audit', {
      p_machine_id: machineId,
      p_result: auditResult,
      p_condition: auditCondition,
      p_notes: auditNotes.trim() || null,
      p_next_audit_at: auditNextAt ? new Date(auditNextAt).toISOString() : null,
    });
    setSaving(false);
    if (auditError) {
      setError(auditError.message);
      return;
    }
    setMessage('Asset audit recorded.');
    setAuditNotes('');
    setAuditNextAt('');
    await loadAsset();
  }

  async function createMaintenanceWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!machine || !workTitle.trim()) return;
    setSaving(true);
    setError(null);
    const { data, error: workError } = await getSupabaseClient().rpc('create_work_item', {
      p_title: workTitle.trim(),
      p_description: `Asset maintenance for ${machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? machine.id}`,
      p_work_type: 'maintenance',
      p_department: 'operations',
      p_branch: machine.branch,
      p_priority: workPriority,
      p_assigned_to: workAssignedTo || null,
      p_customer_id: machine.customer_id,
      p_site_id: machine.site_id,
      p_machine_id: machine.id,
      p_stock_item_id: null,
      p_due_at: workDueAt ? new Date(workDueAt).toISOString() : null,
      p_sla_due_at: null,
      p_approval_required: false,
    });
    setSaving(false);
    if (workError) {
      setError(workError.message);
      return;
    }
    setMessage(`Maintenance work created: ${data}.`);
    setWorkTitle('');
    setWorkAssignedTo('');
    setWorkDueAt('');
    await loadAsset();
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !comment.trim()) return;
    setSaving(true);
    const { error: commentError } = await getSupabaseClient().from('record_comments').insert({ entity_type: 'machine', entity_id: machineId, body: comment.trim(), created_by: businessUser.id });
    setSaving(false);
    if (commentError) {
      setError(commentError.message);
      return;
    }
    setComment('');
    await loadAsset();
  }

  if (!machine && !error) return <AppShell><div className="neo-card"><h2>Loading asset...</h2></div></AppShell>;

  return (
    <AppShell>
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      {!machine ? <div className="neo-card"><h1>Asset not found</h1><Link className="button" href="/operations/assets">Back to assets</Link></div> : <div className="grid professional-ops-stage">
        <AssetTicketCard
          asset={{
            id: machine.id,
            machineName: machine.machine_name,
            model: machine.model,
            serialNumber: machine.serial_number,
            barcode: machine.machine_barcode,
            branch: machine.branch,
            status: machine.status,
            condition: machine.condition,
            criticality: machine.criticality,
            custodyStatus: machine.custody_status,
            customerName: customer?.customer_name,
            siteName: site?.site_name,
            siteAddress: site?.address,
            custodian: machine.current_custodian,
            nextAuditAt: machine.next_audit_at,
            warrantyExpiresAt: machine.warranty_expires_at,
          }}
          eyebrow="Asset profile"
          action={<><Link className="button secondary" href="/operations/assets">Back to register</Link><button className="button secondary" onClick={() => window.print()} type="button">Print asset sheet</button></>}
        />

        <PageToolbar actions={<button className="button secondary" onClick={loadAsset} type="button">Refresh</button>} description="Use the ticket for identity and status. The sections below manage lifecycle, custody, audits, maintenance work and history without repeating the same asset summary." lastUpdated={lastUpdated} title="Asset workspace" />

        {canEditProfile ? <section className="neo-card"><h2>Lifecycle profile</h2><form className="grid" onSubmit={saveProfile}><div className="form-grid"><label>Criticality<select value={criticality} onChange={(event) => setCriticality(event.target.value)}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label><label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option>good</option><option>fair</option><option>poor</option><option>critical</option><option>unknown</option></select></label><label>Installed date<input type="date" value={installedAt} onChange={(event) => setInstalledAt(event.target.value)} /></label><label>Warranty expiry<input type="date" value={warrantyExpiresAt} onChange={(event) => setWarrantyExpiresAt(event.target.value)} /></label><label>Next audit<input type="datetime-local" value={nextAuditAt} onChange={(event) => setNextAuditAt(event.target.value)} /></label></div><button className="button" disabled={saving} type="submit">Save lifecycle profile</button></form></section> : null}

        <div className="grid grid-2">
          <section className="neo-card"><h2>Custody and deployment</h2><form className="grid" onSubmit={updateCustody}><div className="form-grid"><label>Action<select value={custodyAction} onChange={(event) => setCustodyAction(event.target.value)}><option value="assign">Assign</option><option value="checkout">Check out</option><option value="checkin">Check in</option><option value="service">Move to service</option></select></label><label>Custodian / location<input value={custodian} onChange={(event) => setCustodian(event.target.value)} placeholder="Person, customer, vehicle or site" /></label><label>Condition<select value={custodyCondition} onChange={(event) => setCustodyCondition(event.target.value)}><option>good</option><option>fair</option><option>poor</option><option>critical</option><option>unknown</option></select></label></div><label>Notes<textarea value={custodyNotes} onChange={(event) => setCustodyNotes(event.target.value)} /></label><button className="button secondary" disabled={saving} type="submit">Record custody event</button></form></section>
          <section className="neo-card"><h2>Asset audit</h2><form className="grid" onSubmit={recordAudit}><div className="form-grid"><label>Result<select value={auditResult} onChange={(event) => setAuditResult(event.target.value)}><option>passed</option><option>attention</option><option>failed</option></select></label><label>Condition<select value={auditCondition} onChange={(event) => setAuditCondition(event.target.value)}><option>good</option><option>fair</option><option>poor</option><option>critical</option><option>unknown</option></select></label><label>Next audit<input type="datetime-local" value={auditNextAt} onChange={(event) => setAuditNextAt(event.target.value)} /></label></div><label>Audit notes<textarea value={auditNotes} onChange={(event) => setAuditNotes(event.target.value)} /></label><button className="button secondary" disabled={saving} type="submit">Record audit</button></form></section>
        </div>

        <section className="neo-card"><h2>Create maintenance work</h2><form className="grid" onSubmit={createMaintenanceWork}><div className="form-grid"><label>Task title<input required value={workTitle} onChange={(event) => setWorkTitle(event.target.value)} /></label><label>Priority<select value={workPriority} onChange={(event) => setWorkPriority(event.target.value as WorkPriority)}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label><label>Assign to<select value={workAssignedTo} onChange={(event) => setWorkAssignedTo(event.target.value)}><option value="">Unassigned</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.role} — {user.branch.toUpperCase()}</option>)}</select></label><label>Due date<input type="datetime-local" value={workDueAt} onChange={(event) => setWorkDueAt(event.target.value)} /></label></div><button className="button" disabled={saving || !workTitle.trim()} type="submit">Create linked maintenance task</button></form></section>

        <div className="grid grid-2"><section className="neo-card"><h2>Service history</h2><div className="record-timeline">{jobs.length === 0 ? <p>No service jobs linked.</p> : jobs.map((job) => <Link className="record-timeline-item" href={`/operations/service-jobs?job=${job.id}`} key={job.id}><div><div className="feature-list"><StatusBadge value={job.status} /><StatusBadge value={job.priority} /></div><strong>{job.job_number} — {job.summary}</strong><small>{new Date(job.created_at).toLocaleString()}{job.due_at ? ` • due ${new Date(job.due_at).toLocaleString()}` : ''}</small></div></Link>)}</div></section><section className="neo-card"><h2>Comments</h2><form className="grid" onSubmit={addComment}><label>Add note<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="button secondary" disabled={saving || !comment.trim()} type="submit">Post note</button></form><div className="record-comment-list">{comments.length === 0 ? <p>No comments yet.</p> : comments.map((item) => <article className="record-comment" key={item.id}><div className="page-toolbar-heading"><strong>{item.created_by ? userMap.get(item.created_by)?.display_name || 'Business user' : 'System'}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div><p>{item.body}</p></article>)}</div></section></div>

        <div className="grid grid-2"><section className="neo-card"><h2>Audit history</h2><div className="record-timeline">{audits.length === 0 ? <p>No audits recorded.</p> : audits.map((audit) => <article className="record-timeline-item" key={audit.id}><div><div className="feature-list"><StatusBadge value={audit.result} /><StatusBadge value={audit.condition} /></div><strong>{audit.notes ?? 'Asset audit'}</strong><small>{new Date(audit.created_at).toLocaleString()} • {audit.audited_by ? userMap.get(audit.audited_by)?.display_name || 'Business user' : 'System'}{audit.next_audit_at ? ` • next ${new Date(audit.next_audit_at).toLocaleString()}` : ''}</small></div></article>)}</div></section><section className="neo-card"><h2>Lifecycle timeline</h2><div className="record-timeline">{events.length === 0 ? <p>No lifecycle events recorded.</p> : events.map((event) => <article className="record-timeline-item" key={event.id}><div><div className="feature-list"><StatusBadge value={event.event_type} />{event.condition ? <StatusBadge value={event.condition} /> : null}</div><strong>{event.notes ?? event.event_type.replace(/_/g, ' ')}</strong><small>{new Date(event.created_at).toLocaleString()} • {event.actor_user_id ? userMap.get(event.actor_user_id)?.display_name || 'Business user' : 'System'}{event.custodian ? ` • ${event.custodian}` : ''}</small></div></article>)}</div></section></div>
      </div>}
    </AppShell>
  );
}
