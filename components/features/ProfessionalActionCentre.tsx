'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { AssignableUser, WorkItemRecord, WorkPriority, WorkType } from '@/types/professional-ops';

type ServiceQueue = { id: string; job_number: string; summary: string; branch: Branch; priority: string; status: string; due_at: string | null };
type DeliveryQueue = { id: string; order_number: string; customer_name: string; branch: Branch; status: string; created_at: string };
type PurchaseQueue = { id: string; po_number: string; supplier_name: string; branch: Branch; status: string; expected_date: string | null };
type StockRelation = { stock_name: string | null };
type StockAlertQueue = { id: string; stock_item_id: string; alert_type: string; status: string; current_quantity: number; threshold: number; stock_items?: StockRelation | StockRelation[] | null };
type AssetAuditQueue = { id: string; machine_name: string | null; serial_number: string | null; branch: Branch; condition: string; criticality: string; next_audit_at: string | null };
type QueueView = 'my' | 'overdue' | 'approvals' | 'unassigned' | 'all';

const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];
const workTypes: WorkType[] = ['request', 'task', 'approval', 'inspection', 'maintenance', 'incident'];
const priorities: WorkPriority[] = ['low', 'medium', 'high', 'critical'];
const technicianRoles = new Set(['technician', 'road_technician']);

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isOpen(status: string) {
  return !['completed', 'closed', 'cancelled', 'received', 'resolved'].includes(status);
}

function isPast(value: string | null) {
  return Boolean(value && new Date(value).getTime() < Date.now());
}

export function ProfessionalActionCentre() {
  const { businessUser, userDetails } = useAuth();
  const [workItems, setWorkItems] = useState<WorkItemRecord[]>([]);
  const [serviceJobs, setServiceJobs] = useState<ServiceQueue[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryQueue[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseQueue[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlertQueue[]>([]);
  const [assetAudits, setAssetAudits] = useState<AssetAuditQueue[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [view, setView] = useState<QueueView>('my');
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workType, setWorkType] = useState<WorkType>('task');
  const [department, setDepartment] = useState('operations');
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'national');
  const [priority, setPriority] = useState<WorkPriority>('medium');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [slaDueAt, setSlaDueAt] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canCreateWork = Boolean(userDetails?.role && !technicianRoles.has(userDetails.role));

  async function loadCentre() {
    setError(null);
    const client = getSupabaseClient();
    const [workResult, serviceResult, deliveryResult, purchaseResult, alertResult, assetResult, userResult] = await Promise.all([
      client.from('work_items').select('*').order('created_at', { ascending: false }).limit(500),
      client.from('service_jobs').select('id, job_number, summary, branch, priority, status, due_at').order('created_at', { ascending: false }).limit(250),
      client.from('delivery_orders').select('id, order_number, customer_name, branch, status, created_at').order('created_at', { ascending: false }).limit(250),
      client.from('purchase_orders').select('id, po_number, supplier_name, branch, status, expected_date').order('created_at', { ascending: false }).limit(250),
      client.from('stock_alerts').select('id, stock_item_id, alert_type, status, current_quantity, threshold, stock_items(stock_name)').in('status', ['open', 'acknowledged']).order('updated_at', { ascending: false }).limit(250),
      client.from('machines').select('id, machine_name, serial_number, branch, condition, criticality, next_audit_at').not('next_audit_at', 'is', null).order('next_audit_at').limit(100),
      client.rpc('list_assignable_users'),
    ]);
    const firstError = workResult.error ?? serviceResult.error ?? deliveryResult.error ?? purchaseResult.error ?? alertResult.error ?? assetResult.error ?? userResult.error;
    if (firstError) throw firstError;
    setWorkItems((workResult.data ?? []) as WorkItemRecord[]);
    setServiceJobs((serviceResult.data ?? []) as ServiceQueue[]);
    setDeliveries((deliveryResult.data ?? []) as DeliveryQueue[]);
    setPurchaseOrders((purchaseResult.data ?? []) as PurchaseQueue[]);
    setStockAlerts((alertResult.data ?? []) as StockAlertQueue[]);
    setAssetAudits((assetResult.data ?? []) as AssetAuditQueue[]);
    setUsers((userResult.data ?? []) as AssignableUser[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadCentre().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load the Action Centre.'));
  }, []);

  async function createWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateWork) {
      setError('Technicians cannot create or request tasks. Operations must assign technician work.');
      return;
    }
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const { data, error: createError } = await getSupabaseClient().rpc('create_work_item', {
      p_title: title.trim(),
      p_description: description.trim() || null,
      p_work_type: workType,
      p_department: department.trim() || 'operations',
      p_branch: branch,
      p_priority: priority,
      p_assigned_to: assignedTo || null,
      p_customer_id: null,
      p_site_id: null,
      p_machine_id: null,
      p_stock_item_id: null,
      p_due_at: dueAt ? new Date(dueAt).toISOString() : null,
      p_sla_due_at: slaDueAt ? new Date(slaDueAt).toISOString() : null,
      p_approval_required: approvalRequired,
    });
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    setMessage(`Work item created: ${data}.`);
    setTitle('');
    setDescription('');
    setAssignedTo('');
    setDueAt('');
    setSlaDueAt('');
    setApprovalRequired(false);
    await loadCentre();
  }

  const userMap = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);
  const visibleWork = useMemo(() => {
    const term = search.trim().toLowerCase();
    return workItems.filter((item) => {
      const assignee = item.assigned_to ? userMap.get(item.assigned_to)?.display_name ?? '' : '';
      const text = [item.work_number, item.title, item.description, item.department, item.branch, item.status, item.priority, assignee].join(' ').toLowerCase();
      const viewMatch = view === 'all'
        || (view === 'my' && (item.assigned_to === businessUser?.id || item.requested_by === businessUser?.id))
        || (view === 'overdue' && isOpen(item.status) && isPast(item.due_at ?? item.sla_due_at))
        || (view === 'approvals' && item.approval_status === 'pending')
        || (view === 'unassigned' && !item.assigned_to && isOpen(item.status));
      return viewMatch && (!term || text.includes(term));
    });
  }, [businessUser?.id, search, userMap, view, workItems]);

  const overdueServices = serviceJobs.filter((job) => isOpen(job.status) && isPast(job.due_at));
  const openDeliveries = deliveries.filter((order) => isOpen(order.status));
  const openPurchasing = purchaseOrders.filter((order) => isOpen(order.status));
  const dueAudits = assetAudits.filter((asset) => asset.next_audit_at && new Date(asset.next_audit_at).getTime() <= Date.now() + 30 * 86400000);
  const pendingApprovals = workItems.filter((item) => item.approval_status === 'pending').length;
  const overdueWork = workItems.filter((item) => isOpen(item.status) && isPast(item.due_at ?? item.sla_due_at)).length;

  return (
    <div className="grid professional-ops-stage">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <div className="grid grid-3 spatial-kpi-grid">
        <div className="card"><div className="nav-heading">My active work</div><div className="kpi-value">{workItems.filter((item) => item.assigned_to === businessUser?.id && isOpen(item.status)).length}</div></div>
        <div className="card"><div className="nav-heading">Overdue work</div><div className="kpi-value">{overdueWork + overdueServices.length}</div></div>
        <div className="card"><div className="nav-heading">Pending approvals</div><div className="kpi-value">{pendingApprovals}</div></div>
        <div className="card"><div className="nav-heading">Stock alerts</div><div className="kpi-value">{stockAlerts.length}</div></div>
        <div className="card"><div className="nav-heading">Open deliveries</div><div className="kpi-value">{openDeliveries.length}</div></div>
        <div className="card"><div className="nav-heading">Audits due in 30 days</div><div className="kpi-value">{dueAudits.length}</div></div>
      </div>

      {canCreateWork ? (
        <section className="neo-card">
          <div className="badge">Structured work intake</div>
          <h2>Create work request or task</h2>
          <p>Capture operational requests consistently, assign ownership, set SLA dates and require approval where necessary.</p>
          <form className="grid" onSubmit={createWork}>
            <div className="form-grid">
              <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>Type<select value={workType} onChange={(event) => setWorkType(event.target.value as WorkType)}>{workTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Department<input value={department} onChange={(event) => setDepartment(event.target.value)} /></label>
              <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as WorkPriority)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Assign to<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Unassigned</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.role} — {user.branch.toUpperCase()}</option>)}</select></label>
              <label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
              <label>SLA target<input type="datetime-local" value={slaDueAt} onChange={(event) => setSlaDueAt(event.target.value)} /></label>
              <label className="checkbox-field"><input checked={approvalRequired} onChange={(event) => setApprovalRequired(event.target.checked)} type="checkbox" /> Approval required</label>
            </div>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <button className="button" disabled={saving || !title.trim()} type="submit">{saving ? 'Creating...' : 'Create work item'}</button>
          </form>
        </section>
      ) : (
        <section className="neo-card">
          <div className="badge">Assigned work only</div>
          <h2>Tasks are provided by Operations</h2>
          <p>Technicians cannot create or request tasks. Use the My work queue below to open, update and complete work assigned by an Operations manager.</p>
        </section>
      )}

      <PageToolbar actions={<button className="button secondary" onClick={() => loadCentre().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh centre</button>} description="One operational queue across tasks, approvals and exception-driven work." lastUpdated={lastUpdated} title="Action Centre">
        <label>Queue<select value={view} onChange={(event) => setView(event.target.value as QueueView)}><option value="my">My work</option><option value="overdue">Overdue</option><option value="approvals">Approvals</option><option value="unassigned">Unassigned</option><option value="all">All work</option></select></label>
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Number, title, department or assignee" /></label>
      </PageToolbar>

      <section className="professional-work-list">
        {visibleWork.length === 0 ? <div className="neo-card">No work items match this queue.</div> : visibleWork.map((item) => {
          const assignee = item.assigned_to ? userMap.get(item.assigned_to) : null;
          const overdue = isOpen(item.status) && isPast(item.due_at ?? item.sla_due_at);
          return <Link className="professional-work-card" href={`/work/${item.id}`} key={item.id}>
            <div className="page-toolbar-heading"><div><span className="nav-heading">{item.work_number}</span><h3>{item.title}</h3></div><StatusBadge value={item.status} /></div>
            <div className="feature-list"><StatusBadge value={item.priority} /><StatusBadge value={item.work_type} />{item.approval_required ? <StatusBadge value={item.approval_status} /> : null}{overdue ? <StatusBadge value="overdue" /> : null}</div>
            <p>{item.department} • {item.branch.toUpperCase()} • {assignee?.display_name || 'Unassigned'}</p>
            <small>{item.due_at ? `Due ${new Date(item.due_at).toLocaleString()}` : 'No due date'}{item.sla_due_at ? ` • SLA ${new Date(item.sla_due_at).toLocaleString()}` : ''}</small>
          </Link>;
        })}
      </section>

      <div className="grid grid-3">
        <section className="neo-card"><div className="page-toolbar-heading"><h2>Service exceptions</h2><Link href="/operations/service-jobs">Open board</Link></div>{overdueServices.slice(0, 8).map((job) => <Link className="queue-line" href={`/operations/service-jobs?job=${job.id}`} key={job.id}><span><strong>{job.job_number}</strong><small>{job.summary}</small></span><StatusBadge value={job.priority} /></Link>)}{overdueServices.length === 0 ? <p>No overdue service jobs.</p> : null}</section>
        <section className="neo-card"><div className="page-toolbar-heading"><h2>Stock and purchasing</h2><Link href="/warehouse/stock">Open stock</Link></div>{stockAlerts.slice(0, 5).map((alert) => <Link className="queue-line" href={`/warehouse/stock/${alert.stock_item_id}`} key={alert.id}><span><strong>{firstRelation(alert.stock_items)?.stock_name ?? 'Stock item'}</strong><small>{alert.current_quantity} available • threshold {alert.threshold}</small></span><StatusBadge value={alert.alert_type} /></Link>)}{openPurchasing.slice(0, 3).map((order) => <Link className="queue-line" href="/warehouse/purchasing" key={order.id}><span><strong>{order.po_number}</strong><small>{order.supplier_name}</small></span><StatusBadge value={order.status} /></Link>)}</section>
        <section className="neo-card"><div className="page-toolbar-heading"><h2>Asset and delivery control</h2><Link href="/operations/assets">Open assets</Link></div>{dueAudits.slice(0, 5).map((asset) => <Link className="queue-line" href={`/operations/assets/${asset.id}`} key={asset.id}><span><strong>{asset.machine_name ?? asset.serial_number ?? 'Machine'}</strong><small>Audit {asset.next_audit_at ? new Date(asset.next_audit_at).toLocaleDateString() : 'not scheduled'}</small></span><StatusBadge value={asset.condition} /></Link>)}{openDeliveries.slice(0, 3).map((order) => <Link className="queue-line" href={`/operations/deliveries?order=${order.id}`} key={order.id}><span><strong>{order.order_number}</strong><small>{order.customer_name}</small></span><StatusBadge value={order.status} /></Link>)}</section>
      </div>
    </div>
  );
}
