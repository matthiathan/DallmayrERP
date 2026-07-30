'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BoardHeader, BoardViewTabs } from '@/components/boards/BoardWorkspace';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole } from '@/types/dallmayrerp';

type AdminTab = 'dashboards' | 'automations' | 'runs';
type MetricKey =
  | 'my_active_work' | 'my_overdue_work' | 'my_high_priority_work'
  | 'my_open_service_jobs' | 'my_open_deliveries' | 'branch_open_work'
  | 'branch_overdue_work' | 'unassigned_work' | 'pending_work_approvals'
  | 'pending_purchase_approvals' | 'pending_approvals' | 'stock_alerts'
  | 'open_purchase_orders' | 'open_deliveries' | 'open_service_jobs'
  | 'business_users' | 'customer_count' | 'contract_records'
  | 'renewals_due_90' | 'open_opportunities' | 'commercial_accounts'
  | 'active_campaigns' | 'marketing_segments';

type DashboardRow = {
  id: string;
  workspace_key: string;
  name: string;
  description: string | null;
  role_scope: BusinessRole;
  branch_scope: string | null;
  is_default: boolean;
  active: boolean;
  config: unknown;
  created_at: string;
  updated_at: string;
};

type AutomationRule = {
  id: string;
  name: string;
  description: string | null;
  source_entity: AutomationSource;
  trigger_event: AutomationEvent;
  conditions: Record<string, unknown>;
  action_config: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  created_runs: number;
  failed_runs: number;
};

type AutomationRun = {
  id: string;
  rule_id: string;
  rule_name: string;
  source_entity: string;
  source_id: string;
  trigger_event: string;
  status: string;
  work_item_id: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

type AutomationSource = 'service_job' | 'delivery_order' | 'purchase_order' | 'stock_alert';
type AutomationEvent = 'created' | 'status_changed' | 'priority_changed' | 'assignment_changed' | 'threshold_breached';
type ConditionField = 'none' | 'branch' | 'status' | 'priority' | 'approval_status' | 'alert_type' | 'assigned';

const roles = Object.keys(roleLabels) as BusinessRole[];
const branches: Array<Branch | 'all'> = ['all', 'jhb', 'cpt', 'kzn', 'national'];
const tabs = [
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'automations', label: 'Automations' },
  { id: 'runs', label: 'Run history' },
];

const metricCatalog: Array<{ key: MetricKey; label: string; href: string }> = [
  { key: 'my_active_work', label: 'My active work', href: '/work?scope=my' },
  { key: 'my_overdue_work', label: 'My overdue work', href: '/work?scope=overdue' },
  { key: 'my_high_priority_work', label: 'My high-priority work', href: '/work?scope=my' },
  { key: 'my_open_service_jobs', label: 'My service jobs', href: '/work?scope=my' },
  { key: 'my_open_deliveries', label: 'My deliveries', href: '/work?scope=my' },
  { key: 'branch_open_work', label: 'Open branch work', href: '/work?scope=all' },
  { key: 'branch_overdue_work', label: 'Overdue branch work', href: '/work?scope=overdue' },
  { key: 'unassigned_work', label: 'Unassigned work', href: '/work?scope=unassigned' },
  { key: 'pending_work_approvals', label: 'Work approvals', href: '/work?scope=approvals' },
  { key: 'pending_purchase_approvals', label: 'Purchase approvals', href: '/warehouse/purchasing/approvals' },
  { key: 'pending_approvals', label: 'Pending approvals', href: '/work?scope=approvals' },
  { key: 'stock_alerts', label: 'Stock alerts', href: '/warehouse/planning' },
  { key: 'open_purchase_orders', label: 'Open purchase orders', href: '/warehouse/purchasing' },
  { key: 'open_deliveries', label: 'Open deliveries', href: '/operations/deliveries' },
  { key: 'open_service_jobs', label: 'Open service jobs', href: '/operations/service-jobs' },
  { key: 'business_users', label: 'Business users', href: '/admin/users' },
  { key: 'customer_count', label: 'Customers', href: '/customers' },
  { key: 'contract_records', label: 'Contracts', href: '/executive/contracts' },
  { key: 'renewals_due_90', label: 'Renewals due', href: '/marketing/contract-renewals' },
  { key: 'open_opportunities', label: 'Open opportunities', href: '/sales' },
  { key: 'commercial_accounts', label: 'Commercial accounts', href: '/finance' },
  { key: 'active_campaigns', label: 'Active campaigns', href: '/marketing/campaigns' },
  { key: 'marketing_segments', label: 'Marketing segments', href: '/marketing/segments' },
];

const eventsBySource: Record<AutomationSource, AutomationEvent[]> = {
  service_job: ['created', 'status_changed', 'priority_changed', 'assignment_changed'],
  delivery_order: ['created', 'status_changed', 'assignment_changed'],
  purchase_order: ['created', 'status_changed'],
  stock_alert: ['created', 'status_changed', 'threshold_breached'],
};

const sourceLabels: Record<AutomationSource, string> = {
  service_job: 'Service job',
  delivery_order: 'Delivery order',
  purchase_order: 'Purchase order',
  stock_alert: 'Stock alert',
};

function dashboardMetrics(config: unknown): MetricKey[] {
  if (!config || typeof config !== 'object') return [];
  const widgets = (config as { widgets?: unknown }).widgets;
  if (!Array.isArray(widgets)) return [];
  return widgets.flatMap((widget): MetricKey[] => {
    if (!widget || typeof widget !== 'object') return [];
    const metric = (widget as { metric?: unknown }).metric;
    return typeof metric === 'string' && metricCatalog.some((item) => item.key === metric) ? [metric as MetricKey] : [];
  });
}

function firstCondition(conditions: Record<string, unknown>) {
  const entry = Object.entries(conditions)[0];
  if (!entry) return { field: 'none' as ConditionField, value: '' };
  return { field: entry[0] as ConditionField, value: String(entry[1]) };
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
}

export function WorkspaceControlsAdmin() {
  const { userDetails } = useAuth();
  const [tab, setTab] = useState<AdminTab>('dashboards');
  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [dashboardName, setDashboardName] = useState('');
  const [dashboardDescription, setDashboardDescription] = useState('');
  const [dashboardRole, setDashboardRole] = useState<BusinessRole>('operations');
  const [dashboardBranch, setDashboardBranch] = useState<Branch | 'all'>('all');
  const [dashboardMetricsState, setDashboardMetricsState] = useState<MetricKey[]>(['branch_open_work', 'branch_overdue_work', 'unassigned_work']);
  const [dashboardDefault, setDashboardDefault] = useState(true);
  const [dashboardActive, setDashboardActive] = useState(true);

  const [ruleId, setRuleId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleDescription, setRuleDescription] = useState('');
  const [source, setSource] = useState<AutomationSource>('service_job');
  const [event, setEvent] = useState<AutomationEvent>('created');
  const [conditionField, setConditionField] = useState<ConditionField>('none');
  const [conditionValue, setConditionValue] = useState('');
  const [actionTitle, setActionTitle] = useState('Follow up {{source_number}}');
  const [actionDescription, setActionDescription] = useState('{{source_title}} changed to {{status}} in {{branch}}.');
  const [actionDepartment, setActionDepartment] = useState('operations');
  const [actionPriority, setActionPriority] = useState('high');
  const [actionWorkType, setActionWorkType] = useState('task');
  const [actionDueHours, setActionDueHours] = useState('24');
  const [actionApproval, setActionApproval] = useState(false);
  const [ruleActive, setRuleActive] = useState(false);

  const loadControls = useCallback(async () => {
    if (userDetails?.role !== 'admin') return;
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [dashboardResult, ruleResult, runResult] = await Promise.all([
      client.rpc('list_shared_dashboards', { p_workspace_key: 'role_dashboard', p_include_all: true }),
      client.rpc('list_workflow_automation_rules'),
      client.rpc('list_workflow_automation_runs', { p_limit: 80 }),
    ]);
    const firstError = dashboardResult.error ?? ruleResult.error ?? runResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    setDashboards((dashboardResult.data ?? []) as DashboardRow[]);
    setRules((ruleResult.data ?? []) as AutomationRule[]);
    setRuns((runResult.data ?? []) as AutomationRun[]);
    setLoading(false);
  }, [userDetails?.role]);

  useEffect(() => {
    loadControls().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load workspace controls.');
      setLoading(false);
    });
  }, [loadControls]);

  useEffect(() => {
    const allowedEvents = eventsBySource[source];
    if (!allowedEvents.includes(event)) setEvent(allowedEvents[0]);
  }, [event, source]);

  function resetDashboardForm() {
    setDashboardId(null);
    setDashboardName('');
    setDashboardDescription('');
    setDashboardRole('operations');
    setDashboardBranch('all');
    setDashboardMetricsState(['branch_open_work', 'branch_overdue_work', 'unassigned_work']);
    setDashboardDefault(true);
    setDashboardActive(true);
  }

  function editDashboard(dashboard: DashboardRow) {
    setDashboardId(dashboard.id);
    setDashboardName(dashboard.name);
    setDashboardDescription(dashboard.description ?? '');
    setDashboardRole(dashboard.role_scope);
    setDashboardBranch((dashboard.branch_scope as Branch | null) ?? 'all');
    setDashboardMetricsState(dashboardMetrics(dashboard.config));
    setDashboardDefault(dashboard.is_default);
    setDashboardActive(dashboard.active);
    setTab('dashboards');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveDashboard(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault();
    if (!dashboardName.trim() || dashboardMetricsState.length === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const config = {
      columns: 3,
      widgets: dashboardMetricsState.map((metric, index) => {
        const definition = metricCatalog.find((item) => item.key === metric)!;
        return { id: `metric-${index + 1}`, type: 'metric', title: definition.label, metric, href: definition.href };
      }),
    };
    const { error: saveError } = await getSupabaseClient().rpc('save_shared_dashboard', {
      p_id: dashboardId,
      p_workspace_key: 'role_dashboard',
      p_name: dashboardName.trim(),
      p_description: dashboardDescription.trim() || null,
      p_role_scope: dashboardRole,
      p_branch_scope: dashboardBranch === 'all' ? null : dashboardBranch,
      p_is_default: dashboardDefault,
      p_config: config,
      p_active: dashboardActive,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setMessage(`Dashboard ${dashboardId ? 'updated' : 'published'}.`);
    resetDashboardForm();
    await loadControls();
  }

  function resetRuleForm() {
    setRuleId(null);
    setRuleName('');
    setRuleDescription('');
    setSource('service_job');
    setEvent('created');
    setConditionField('none');
    setConditionValue('');
    setActionTitle('Follow up {{source_number}}');
    setActionDescription('{{source_title}} changed to {{status}} in {{branch}}.');
    setActionDepartment('operations');
    setActionPriority('high');
    setActionWorkType('task');
    setActionDueHours('24');
    setActionApproval(false);
    setRuleActive(false);
  }

  function editRule(rule: AutomationRule) {
    const condition = firstCondition(rule.conditions ?? {});
    setRuleId(rule.id);
    setRuleName(rule.name);
    setRuleDescription(rule.description ?? '');
    setSource(rule.source_entity);
    setEvent(rule.trigger_event);
    setConditionField(condition.field);
    setConditionValue(condition.value);
    setActionTitle(String(rule.action_config.title ?? 'Follow up {{source_number}}'));
    setActionDescription(String(rule.action_config.description ?? ''));
    setActionDepartment(String(rule.action_config.department ?? 'operations'));
    setActionPriority(String(rule.action_config.priority ?? 'medium'));
    setActionWorkType(String(rule.action_config.work_type ?? 'task'));
    setActionDueHours(String(rule.action_config.due_in_hours ?? 24));
    setActionApproval(Boolean(rule.action_config.approval_required));
    setRuleActive(rule.active);
    setTab('automations');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveRule(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault();
    if (!ruleName.trim() || !actionTitle.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const conditions: Record<string, unknown> = {};
    if (conditionField !== 'none' && conditionValue.trim()) {
      conditions[conditionField] = conditionField === 'assigned' ? conditionValue === 'true' : conditionValue.trim();
    }
    const actionConfig = {
      title: actionTitle.trim(),
      description: actionDescription.trim(),
      department: actionDepartment.trim() || 'operations',
      priority: actionPriority,
      work_type: actionWorkType,
      due_in_hours: Number(actionDueHours || 24),
      approval_required: actionApproval,
    };
    const { error: saveError } = await getSupabaseClient().rpc('save_workflow_automation_rule', {
      p_id: ruleId,
      p_name: ruleName.trim(),
      p_description: ruleDescription.trim() || null,
      p_source_entity: source,
      p_trigger_event: event,
      p_conditions: conditions,
      p_action_config: actionConfig,
      p_active: ruleActive,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setMessage(`Automation rule ${ruleId ? 'updated' : 'created'}.`);
    resetRuleForm();
    await loadControls();
  }

  async function toggleRule(rule: AutomationRule) {
    setError(null);
    const { error: toggleError } = await getSupabaseClient().rpc('set_workflow_automation_rule_active', {
      p_rule_id: rule.id,
      p_active: !rule.active,
    });
    if (toggleError) {
      setError(toggleError.message);
      return;
    }
    setMessage(`${rule.name} ${rule.active ? 'disabled' : 'enabled'}.`);
    await loadControls();
  }

  const runCounts = useMemo(() => ({
    created: runs.filter((run) => run.status === 'created').length,
    failed: runs.filter((run) => run.status === 'failed').length,
    processing: runs.filter((run) => run.status === 'processing').length,
  }), [runs]);

  if (userDetails?.role && userDetails.role !== 'admin') {
    return <div className="error" role="alert">Administrator access is required for Workspace Controls.</div>;
  }

  return (
    <div className="workspace-controls-admin">
      <BoardHeader
        actions={(
          <>
            <Link className="button secondary" href="/dashboards">Open shared dashboards</Link>
            <button className="button secondary" disabled={loading} onClick={loadControls} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>
          </>
        )}
        description="Publish role dashboards and configure safe, traceable follow-up automation."
        eyebrow="Administrator"
        meta={<span>{dashboards.length} dashboards · {rules.filter((rule) => rule.active).length} active rules</span>}
        title="Workspace Controls"
      />

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}
      {loading && dashboards.length === 0 && rules.length === 0 ? <HamsterLoader label="Loading workspace controls" /> : null}

      <BoardViewTabs activeId={tab} onChange={(nextTab) => setTab(nextTab as AdminTab)} views={tabs} />

      {tab === 'dashboards' ? (
        <div className="workspace-controls-grid">
          <form className="workspace-control-editor" onSubmit={saveDashboard}>
            <header><div><span>Published layout</span><h2>{dashboardId ? 'Edit dashboard' : 'Create dashboard'}</h2></div>{dashboardId ? <button className="button secondary" onClick={resetDashboardForm} type="button">New dashboard</button> : null}</header>
            <div className="workspace-control-form-grid">
              <label>Name<input required maxLength={120} value={dashboardName} onChange={(eventObject) => setDashboardName(eventObject.target.value)} /></label>
              <label>Role<select value={dashboardRole} onChange={(eventObject) => setDashboardRole(eventObject.target.value as BusinessRole)}>{roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
              <label>Branch scope<select value={dashboardBranch} onChange={(eventObject) => setDashboardBranch(eventObject.target.value as Branch | 'all')}>{branches.map((branchValue) => <option key={branchValue} value={branchValue}>{branchValue === 'all' ? 'All permitted branches' : branchValue.toUpperCase()}</option>)}</select></label>
              <label>Description<input maxLength={240} value={dashboardDescription} onChange={(eventObject) => setDashboardDescription(eventObject.target.value)} /></label>
            </div>
            <fieldset className="workspace-control-metrics">
              <legend>Metric widgets</legend>
              <p>Select up to twelve metrics. The published order follows this list.</p>
              <div>{metricCatalog.map((metric) => {
                const checked = dashboardMetricsState.includes(metric.key);
                return <label key={metric.key}><input checked={checked} disabled={!checked && dashboardMetricsState.length >= 12} onChange={(eventObject) => setDashboardMetricsState((current) => eventObject.target.checked ? [...current, metric.key] : current.filter((item) => item !== metric.key))} type="checkbox" />{metric.label}</label>;
              })}</div>
            </fieldset>
            <div className="workspace-control-flags">
              <label><input checked={dashboardDefault} onChange={(eventObject) => setDashboardDefault(eventObject.target.checked)} type="checkbox" /> Default for this role and branch scope</label>
              <label><input checked={dashboardActive} onChange={(eventObject) => setDashboardActive(eventObject.target.checked)} type="checkbox" /> Published and active</label>
            </div>
            <button className="button" disabled={saving || !dashboardName.trim() || dashboardMetricsState.length === 0} type="submit">{saving ? 'Saving…' : dashboardId ? 'Update dashboard' : 'Publish dashboard'}</button>
          </form>

          <section className="workspace-control-list">
            <header><div><span>Server layouts</span><h2>Published dashboards</h2></div><strong>{dashboards.length}</strong></header>
            {dashboards.length === 0 ? <p>No server dashboards have been created.</p> : dashboards.map((dashboard) => (
              <article key={dashboard.id}>
                <div><div><strong>{dashboard.name}</strong><small>{roleLabels[dashboard.role_scope]} · {dashboard.branch_scope?.toUpperCase() ?? 'All branches'}</small></div><StatusBadge value={dashboard.active ? 'active' : 'inactive'} /></div>
                <p>{dashboard.description || 'No description provided.'}</p>
                <div className="workspace-control-tags"><span>{dashboardMetrics(dashboard.config).length} metrics</span>{dashboard.is_default ? <span>Default</span> : null}<span>Updated {formatDate(dashboard.updated_at)}</span></div>
                <button className="button secondary" onClick={() => editDashboard(dashboard)} type="button">Edit layout</button>
              </article>
            ))}
          </section>
        </div>
      ) : null}

      {tab === 'automations' ? (
        <div className="workspace-controls-grid">
          <form className="workspace-control-editor" onSubmit={saveRule}>
            <header><div><span>Controlled follow-up</span><h2>{ruleId ? 'Edit automation' : 'Create automation'}</h2></div>{ruleId ? <button className="button secondary" onClick={resetRuleForm} type="button">New rule</button> : null}</header>
            <div className="workspace-control-form-grid">
              <label>Name<input required maxLength={140} value={ruleName} onChange={(eventObject) => setRuleName(eventObject.target.value)} /></label>
              <label>Source<select value={source} onChange={(eventObject) => setSource(eventObject.target.value as AutomationSource)}>{(Object.keys(sourceLabels) as AutomationSource[]).map((sourceValue) => <option key={sourceValue} value={sourceValue}>{sourceLabels[sourceValue]}</option>)}</select></label>
              <label>Trigger<select value={event} onChange={(eventObject) => setEvent(eventObject.target.value as AutomationEvent)}>{eventsBySource[source].map((eventValue) => <option key={eventValue} value={eventValue}>{eventValue.replace(/_/g, ' ')}</option>)}</select></label>
              <label>Description<input maxLength={240} value={ruleDescription} onChange={(eventObject) => setRuleDescription(eventObject.target.value)} /></label>
              <label>Condition field<select value={conditionField} onChange={(eventObject) => setConditionField(eventObject.target.value as ConditionField)}><option value="none">No additional condition</option><option value="branch">Branch</option><option value="status">Status</option><option value="priority">Priority</option><option value="approval_status">Approval status</option><option value="alert_type">Alert type</option><option value="assigned">Assigned</option></select></label>
              {conditionField === 'assigned' ? <label>Condition value<select value={conditionValue} onChange={(eventObject) => setConditionValue(eventObject.target.value)}><option value="">Choose</option><option value="true">Assigned</option><option value="false">Unassigned</option></select></label> : <label>Condition value<input disabled={conditionField === 'none'} placeholder="Exact value" value={conditionValue} onChange={(eventObject) => setConditionValue(eventObject.target.value)} /></label>}
            </div>
            <section className="workspace-automation-action">
              <h3>Create follow-up work item</h3>
              <p>Allowed placeholders: {'{{source_number}}'}, {'{{source_title}}'}, {'{{status}}'}, {'{{priority}}'}, {'{{branch}}'} and {'{{source_id}}'}.</p>
              <div className="workspace-control-form-grid">
                <label>Work title<input required maxLength={180} value={actionTitle} onChange={(eventObject) => setActionTitle(eventObject.target.value)} /></label>
                <label>Department<input maxLength={80} value={actionDepartment} onChange={(eventObject) => setActionDepartment(eventObject.target.value)} /></label>
                <label>Work type<select value={actionWorkType} onChange={(eventObject) => setActionWorkType(eventObject.target.value)}>{['request', 'task', 'approval', 'inspection', 'maintenance', 'incident'].map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Priority<select value={actionPriority} onChange={(eventObject) => setActionPriority(eventObject.target.value)}>{['low', 'medium', 'high', 'critical'].map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Due in hours<input min="0" max="2160" type="number" value={actionDueHours} onChange={(eventObject) => setActionDueHours(eventObject.target.value)} /></label>
              </div>
              <label>Description<textarea maxLength={2000} value={actionDescription} onChange={(eventObject) => setActionDescription(eventObject.target.value)} /></label>
            </section>
            <div className="workspace-control-flags">
              <label><input checked={actionApproval} onChange={(eventObject) => setActionApproval(eventObject.target.checked)} type="checkbox" /> Follow-up requires approval</label>
              <label><input checked={ruleActive} onChange={(eventObject) => setRuleActive(eventObject.target.checked)} type="checkbox" /> Enable after saving</label>
            </div>
            <p className="workspace-control-safety">This action creates a new unassigned work item only. It cannot alter the source record or bypass an existing approval or status workflow.</p>
            <button className="button" disabled={saving || !ruleName.trim() || !actionTitle.trim()} type="submit">{saving ? 'Saving…' : ruleId ? 'Update rule' : 'Create rule'}</button>
          </form>

          <section className="workspace-control-list">
            <header><div><span>Automation library</span><h2>Workflow rules</h2></div><strong>{rules.length}</strong></header>
            {rules.length === 0 ? <p>No automation rules have been configured.</p> : rules.map((rule) => (
              <article key={rule.id}>
                <div><div><strong>{rule.name}</strong><small>{sourceLabels[rule.source_entity]} · {rule.trigger_event.replace(/_/g, ' ')}</small></div><StatusBadge value={rule.active ? 'active' : 'disabled'} /></div>
                <p>{rule.description || `Creates ${String(rule.action_config.priority ?? 'medium')} follow-up work.`}</p>
                <div className="workspace-control-tags"><span>{Number(rule.created_runs).toLocaleString()} created</span><span>{Number(rule.failed_runs).toLocaleString()} failed</span><span>Last run {formatDate(rule.last_run_at)}</span></div>
                <div className="workspace-control-row-actions"><button className="button secondary" onClick={() => editRule(rule)} type="button">Edit</button><button className="button secondary" onClick={() => toggleRule(rule)} type="button">{rule.active ? 'Disable' : 'Enable'}</button></div>
              </article>
            ))}
          </section>
        </div>
      ) : null}

      {tab === 'runs' ? (
        <section className="workspace-run-history">
          <header><div><span>Audit trail</span><h2>Automation runs</h2></div><div><span>{runCounts.created} created</span><span>{runCounts.failed} failed</span><span>{runCounts.processing} processing</span></div></header>
          {runs.length === 0 ? <p>No automation events have run yet.</p> : (
            <div className="workspace-run-table-wrap"><table><thead><tr><th>Rule</th><th>Source</th><th>Event</th><th>Status</th><th>Work item</th><th>Time</th><th>Error</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{run.rule_name}</td><td>{run.source_entity.replace(/_/g, ' ')}</td><td>{run.trigger_event.replace(/_/g, ' ')}</td><td><StatusBadge value={run.status} /></td><td>{run.work_item_id ? <Link href={`/work/${run.work_item_id}`}>Open work</Link> : '—'}</td><td>{formatDate(run.created_at)}</td><td>{run.error_message || '—'}</td></tr>)}</tbody></table></div>
          )}
        </section>
      ) : null}
    </div>
  );
}
