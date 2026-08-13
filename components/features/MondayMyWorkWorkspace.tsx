'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { BoardCommandBar, BoardFilterChips, BoardFilterDrawer, BoardHeader, BoardViewTabs } from '@/components/boards/BoardWorkspace';
import { useAuth } from '@/components/auth/AuthProvider';
import { MondayMyWorkCard } from '@/components/features/MondayMyWorkCard';
import { isPast, normalizeMyWorkItems, type NormalizedMyWorkItem } from '@/components/features/mondayMyWorkNormalization';
import {
  addDays,
  getMyWorkAttentionItems,
  getMyWorkCalendar,
  getMyWorkDashboardCounts,
  groupMyWorkItems,
  localDateKey,
  priorityRank,
  startOfWeek,
  urgencyKey,
} from '@/components/features/mondayMyWorkSelectors';
import {
  preferenceDefaults,
  useMondayMyWorkPreferences,
  workSources,
  type Density,
  type GroupMode,
  type QueueScope,
  type WorkSource,
  type WorkspaceMode,
} from '@/components/features/useMondayMyWorkPreferences';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { AssignableUser, WorkItemRecord, WorkPriority, WorkType } from '@/types/professional-ops';

type ServiceQueue = {
  id: string;
  job_number: string;
  summary: string;
  customer_name_snapshot: string | null;
  branch: Branch;
  priority: string;
  status: string;
  due_at: string | null;
  assigned_to: string | null;
};

type DeliveryQueue = {
  id: string;
  order_number: string;
  customer_name: string;
  branch: Branch;
  status: string;
  created_at: string;
  assigned_to: string | null;
};

type PurchaseQueue = {
  id: string;
  po_number: string;
  supplier_name: string;
  branch: Branch;
  status: string;
  expected_date: string | null;
  approval_status: string;
};

type StockRelation = { stock_name: string | null };
type StockAlertQueue = {
  id: string;
  alert_type: string;
  status: string;
  current_quantity: number;
  threshold: number;
  stock_items?: StockRelation | StockRelation[] | null;
};

type AssetAuditQueue = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  branch: Branch;
  condition: string;
  criticality: string;
  next_audit_at: string | null;
};

const modes = [
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'dashboard', label: 'Dashboard' },
];

const scopeLabels: Record<QueueScope, string> = {
  my: 'My work',
  overdue: 'Overdue',
  approvals: 'Approvals',
  unassigned: 'Unassigned',
  all: 'All visible work',
};

const sourceLabels: Record<WorkSource, string> = {
  work: 'Work items',
  service: 'Service jobs',
  delivery: 'Deliveries',
  purchase: 'Purchasing',
  stock: 'Stock alerts',
  asset: 'Asset audits',
};

const sources = workSources;
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];
const workTypes: WorkType[] = ['request', 'task', 'approval', 'inspection', 'maintenance', 'incident'];
const priorities: WorkPriority[] = ['low', 'medium', 'high', 'critical'];
const technicianRoles = new Set(['technician', 'road_technician']);

export function MondayMyWorkWorkspace() {
  const { businessUser, userDetails } = useAuth();
  const [workItems, setWorkItems] = useState<WorkItemRecord[]>([]);
  const [serviceJobs, setServiceJobs] = useState<ServiceQueue[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryQueue[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseQueue[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlertQueue[]>([]);
  const [assetAudits, setAssetAudits] = useState<AssetAuditQueue[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const { preferences, scope, setPreferences, setScope } = useMondayMyWorkPreferences(businessUser?.id);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<WorkSource | 'all'>('all');
  const [calendarStart, setCalendarStart] = useState(() => startOfWeek());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const canCreateWork = Boolean(userDetails?.role && !technicianRoles.has(userDetails.role));

  useEffect(() => {
    if (userDetails?.branch) setBranch(userDetails.branch);
  }, [userDetails?.branch]);

  const loadCentre = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [workResult, serviceResult, deliveryResult, purchaseResult, alertResult, assetResult, userResult] = await Promise.all([
      client.from('work_items').select('*').order('created_at', { ascending: false }).limit(500),
      client.from('service_jobs').select('id, job_number, summary, customer_name_snapshot, branch, priority, status, due_at, assigned_to').order('created_at', { ascending: false }).limit(300),
      client.from('delivery_orders').select('id, order_number, customer_name, branch, status, created_at, assigned_to').order('created_at', { ascending: false }).limit(300),
      client.from('purchase_orders').select('id, po_number, supplier_name, branch, status, expected_date, approval_status').order('created_at', { ascending: false }).limit(250),
      client.from('stock_alerts').select('id, alert_type, status, current_quantity, threshold, stock_items(stock_name)').in('status', ['open', 'acknowledged']).order('updated_at', { ascending: false }).limit(250),
      client.from('machines').select('id, machine_name, serial_number, branch, condition, criticality, next_audit_at').not('next_audit_at', 'is', null).order('next_audit_at').limit(150),
      client.rpc('list_assignable_users'),
    ]);

    const firstError = workResult.error ?? serviceResult.error ?? deliveryResult.error ?? purchaseResult.error ?? alertResult.error ?? assetResult.error ?? userResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setWorkItems((workResult.data ?? []) as WorkItemRecord[]);
    setServiceJobs((serviceResult.data ?? []) as ServiceQueue[]);
    setDeliveries((deliveryResult.data ?? []) as DeliveryQueue[]);
    setPurchaseOrders((purchaseResult.data ?? []) as PurchaseQueue[]);
    setStockAlerts((alertResult.data ?? []) as StockAlertQueue[]);
    setAssetAudits((assetResult.data ?? []) as AssetAuditQueue[]);
    setUsers((userResult.data ?? []) as AssignableUser[]);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCentre().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load My Work.');
      setLoading(false);
    });
  }, [loadCentre]);

  async function createWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateWork || !title.trim()) return;

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
    setCreateOpen(false);
    await loadCentre();
  }

  const unifiedItems = useMemo<NormalizedMyWorkItem[]>(() => normalizeMyWorkItems({
    assetAudits,
    currentUserId: businessUser?.id ?? '',
    deliveries,
    purchaseOrders,
    serviceJobs,
    sourceLabels,
    stockAlerts,
    stockBranch: userDetails?.branch ?? 'national',
    workItems,
  }), [assetAudits, businessUser?.id, deliveries, purchaseOrders, serviceJobs, stockAlerts, userDetails?.branch, workItems]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return unifiedItems
      .filter((item) => !preferences.hiddenSources.includes(item.source))
      .filter((item) => sourceFilter === 'all' || item.source === sourceFilter)
      .filter((item) => priorityFilter === 'all' || item.priority === priorityFilter)
      .filter((item) => {
        if (scope === 'my') return item.isMine && item.isOpen;
        if (scope === 'overdue') return item.isOpen && isPast(item.dueAt);
        if (scope === 'approvals') return item.approvalPending;
        if (scope === 'unassigned') return item.isUnassigned;
        return true;
      })
      .filter((item) => !term || [item.title, item.subtitle, item.description, item.status, item.priority, item.branch, item.sourceLabel].join(' ').toLowerCase().includes(term))
      .sort((left, right) => {
        const priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
        if (priorityDifference !== 0) return priorityDifference;
        if (left.dueAt && right.dueAt) return new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime();
        if (left.dueAt) return -1;
        if (right.dueAt) return 1;
        return left.title.localeCompare(right.title);
      });
  }, [preferences.hiddenSources, priorityFilter, scope, search, sourceFilter, unifiedItems]);

  const groupedItems = useMemo(
    () => groupMyWorkItems(filteredItems, preferences.groupBy),
    [filteredItems, preferences.groupBy],
  );

  const dashboardCounts = useMemo(() => getMyWorkDashboardCounts(unifiedItems), [unifiedItems]);
  const { calendarDays, calendarItems } = getMyWorkCalendar(filteredItems, calendarStart);

  const roleName = userDetails?.role ? roleLabels[userDetails.role] : 'ERP user';
  const activeFilterCount = Number(Boolean(search.trim())) + Number(priorityFilter !== 'all') + Number(sourceFilter !== 'all');

  return (
    <div className={`monday-my-work is-${preferences.density}`}>
      <BoardHeader
        actions={(
          <>
            {canCreateWork ? <button className="button" onClick={() => setCreateOpen((value) => !value)} type="button">{createOpen ? 'Close creation' : '+ Add work'}</button> : null}
            <button className="button secondary" onClick={() => setCustomizeOpen(true)} type="button">Customize</button>
            <button className="button secondary" disabled={loading} onClick={loadCentre} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>
          </>
        )}
        description="Assigned work, approvals and operational signals in one role-scoped workspace."
        eyebrow={roleName}
        meta={<span>{filteredItems.length.toLocaleString()} visible</span>}
        title="My Work"
      />

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      {createOpen && canCreateWork ? (
        <section className="monday-my-work-create">
          <header>
            <div><span>Structured work intake</span><h2>Create work request or task</h2></div>
            <button aria-label="Close work creation" className="monday-board-icon-button" onClick={() => setCreateOpen(false)} type="button">×</button>
          </header>
          <form onSubmit={createWork}>
            <div className="monday-my-work-form-grid">
              <label>Title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>Type<select value={workType} onChange={(event) => setWorkType(event.target.value as WorkType)}>{workTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>Department<input value={department} onChange={(event) => setDepartment(event.target.value)} /></label>
              <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
              <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as WorkPriority)}>{priorities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label>Assign to<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Unassigned</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.role} · {user.branch.toUpperCase()}</option>)}</select></label>
              <label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
              <label>SLA target<input type="datetime-local" value={slaDueAt} onChange={(event) => setSlaDueAt(event.target.value)} /></label>
            </div>
            <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="monday-my-work-form-actions">
              <label className="checkbox-field"><input checked={approvalRequired} onChange={(event) => setApprovalRequired(event.target.checked)} type="checkbox" /> Approval required</label>
              <button className="button" disabled={saving || !title.trim()} type="submit">{saving ? 'Creating…' : 'Create work item'}</button>
            </div>
          </form>
        </section>
      ) : null}

      <BoardViewTabs
        activeId={preferences.mode}
        onChange={(mode) => setPreferences((current) => ({ ...current, mode: mode as WorkspaceMode }))}
        views={modes}
      />

      <BoardCommandBar>
        <label className="monday-my-work-search">
          <span className="sr-only">Search My Work</span>
          <input onChange={(event) => setSearch(event.target.value)} placeholder="Search work, customer, supplier, machine or number" type="search" value={search} />
        </label>
        <label>
          <span className="sr-only">Queue</span>
          <select onChange={(event) => setScope(event.target.value as QueueScope)} value={scope}>
            {(Object.keys(scopeLabels) as QueueScope[]).map((item) => <option key={item} value={item}>{scopeLabels[item]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Source</span>
          <select onChange={(event) => setSourceFilter(event.target.value as WorkSource | 'all')} value={sourceFilter}>
            <option value="all">All sources</option>
            {sources.filter((source) => !preferences.hiddenSources.includes(source)).map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Priority</span>
          <select onChange={(event) => setPriorityFilter(event.target.value)} value={priorityFilter}>
            <option value="all">All priorities</option>
            {priorities.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button className="button secondary" onClick={() => { setSearch(''); setPriorityFilter('all'); setSourceFilter('all'); }} type="button">Clear filters</button>
      </BoardCommandBar>

      {activeFilterCount > 0 ? (
        <BoardFilterChips>
          {search.trim() ? <button onClick={() => setSearch('')} type="button">Search: {search} ×</button> : null}
          {sourceFilter !== 'all' ? <button onClick={() => setSourceFilter('all')} type="button">Source: {sourceLabels[sourceFilter]} ×</button> : null}
          {priorityFilter !== 'all' ? <button onClick={() => setPriorityFilter('all')} type="button">Priority: {priorityFilter} ×</button> : null}
        </BoardFilterChips>
      ) : null}

      {loading && unifiedItems.length === 0 ? <HamsterLoader label="Loading My Work" /> : null}

      {!loading && filteredItems.length === 0 ? (
        <div className="monday-my-work-empty">
          <h2>No work matches this view</h2>
          <p>Change the queue, source or priority filters, or refresh the workspace.</p>
        </div>
      ) : null}

      {filteredItems.length > 0 && preferences.mode === 'list' ? (
        <div className="monday-my-work-list">
          {groupedItems.map(([group, items]) => (
            <section key={group}>
              <header><div><strong>{group}</strong><small>{preferences.groupBy}</small></div><span>{items.length}</span></header>
              <div>{items.map((item) => <MondayMyWorkCard density={preferences.density} item={item} key={item.id} />)}</div>
            </section>
          ))}
        </div>
      ) : null}

      {filteredItems.length > 0 && preferences.mode === 'board' ? (
        <div className="monday-my-work-board">
          {['Attention', 'Today', 'This week', 'Later', 'Unscheduled'].map((column) => {
            const items = filteredItems.filter((item) => urgencyKey(item) === column);
            return (
              <section key={column}>
                <header><strong>{column}</strong><span>{items.length}</span></header>
                <div>{items.length === 0 ? <p>No work in this column.</p> : items.map((item) => <MondayMyWorkCard density={preferences.density} item={item} key={item.id} />)}</div>
              </section>
            );
          })}
        </div>
      ) : null}

      {filteredItems.length > 0 && preferences.mode === 'calendar' ? (
        <div className="monday-my-work-calendar">
          <header>
            <div>
              <span>Seven-day view</span>
              <strong>{calendarStart.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })} – {addDays(calendarStart, 6).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>
            </div>
            <div>
              <button className="button secondary" onClick={() => setCalendarStart((current) => addDays(current, -7))} type="button">Previous</button>
              <button className="button secondary" onClick={() => setCalendarStart(startOfWeek())} type="button">Today</button>
              <button className="button secondary" onClick={() => setCalendarStart((current) => addDays(current, 7))} type="button">Next</button>
            </div>
          </header>
          <div className="monday-my-work-calendar-grid">
            {calendarDays.map((day) => {
              const key = localDateKey(day.toISOString());
              const items = calendarItems.filter((item) => localDateKey(item.dueAt) === key);
              return (
                <section key={key}>
                  <header><span>{day.toLocaleDateString('en-ZA', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></header>
                  <div>{items.length === 0 ? <p>No dated work.</p> : items.map((item) => <MondayMyWorkCard density="compact" item={item} key={item.id} />)}</div>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}

      {preferences.mode === 'dashboard' ? (
        <div className="monday-my-work-dashboard">
          <section className="monday-my-work-kpis">
            <button onClick={() => setScope('my')} type="button"><span>My active work</span><strong>{dashboardCounts.mine}</strong><small>Assigned or requested by you</small></button>
            <button onClick={() => setScope('overdue')} type="button"><span>Overdue</span><strong>{dashboardCounts.overdue}</strong><small>Open and beyond target</small></button>
            <button onClick={() => setScope('approvals')} type="button"><span>Approvals</span><strong>{dashboardCounts.approvals}</strong><small>Decisions waiting</small></button>
            <button onClick={() => setScope('unassigned')} type="button"><span>Unassigned</span><strong>{dashboardCounts.unassigned}</strong><small>Requires an owner</small></button>
            <button onClick={() => { setScope('all'); setPreferences((current) => ({ ...current, mode: 'calendar' })); }} type="button"><span>Next seven days</span><strong>{dashboardCounts.nextSeven}</strong><small>Dated work approaching</small></button>
          </section>
          <div className="monday-my-work-dashboard-grid">
            <section>
              <header><strong>Work by source</strong><span>{unifiedItems.length} visible through RLS</span></header>
              {sources.map((source) => {
                const count = unifiedItems.filter((item) => item.source === source).length;
                const width = unifiedItems.length ? Math.max(2, (count / unifiedItems.length) * 100) : 0;
                return <div className="monday-my-work-distribution" key={source}><span>{sourceLabels[source]}</span><div><i style={{ width: `${width}%` }} /></div><strong>{count}</strong></div>;
              })}
            </section>
            <section>
              <header><strong>Needs attention</strong><span>Top priority items</span></header>
              <div className="monday-my-work-attention">
                {getMyWorkAttentionItems(unifiedItems).map((item) => <MondayMyWorkCard density="compact" item={item} key={item.id} />)}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      <BoardFilterDrawer
        description="Choose how My Work is grouped and which operational sources are visible. Preferences are stored only for your ERP user in this browser."
        footer={(
          <button className="button secondary" onClick={() => setPreferences(preferenceDefaults)} type="button">Reset personal layout</button>
        )}
        onClose={() => setCustomizeOpen(false)}
        open={customizeOpen}
        title="Customize My Work"
      >
        <div className="monday-my-work-settings">
          <label>Default layout<select value={preferences.mode} onChange={(event) => setPreferences((current) => ({ ...current, mode: event.target.value as WorkspaceMode }))}>{modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label>
          <label>List grouping<select value={preferences.groupBy} onChange={(event) => setPreferences((current) => ({ ...current, groupBy: event.target.value as GroupMode }))}><option value="urgency">Urgency</option><option value="source">Source</option><option value="status">Status</option></select></label>
          <label>Density<select value={preferences.density} onChange={(event) => setPreferences((current) => ({ ...current, density: event.target.value as Density }))}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          <fieldset>
            <legend>Visible sources</legend>
            {sources.map((source) => {
              const visible = !preferences.hiddenSources.includes(source);
              return (
                <label key={source}>
                  <input
                    checked={visible}
                    onChange={(event) => setPreferences((current) => ({
                      ...current,
                      hiddenSources: event.target.checked
                        ? current.hiddenSources.filter((item) => item !== source)
                        : [...current.hiddenSources, source],
                    }))}
                    type="checkbox"
                  />
                  {sourceLabels[source]}
                </label>
              );
            })}
          </fieldset>
        </div>
      </BoardFilterDrawer>
    </div>
  );
}
