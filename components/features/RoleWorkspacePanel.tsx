'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName } from '@/types/dallmayrerp';
import type { BusinessRole } from '@/types/dallmayrerp';

type WorkspaceMetricKey =
  | 'my_active_work'
  | 'my_overdue_work'
  | 'my_high_priority_work'
  | 'my_open_service_jobs'
  | 'my_open_deliveries'
  | 'branch_open_work'
  | 'branch_overdue_work'
  | 'unassigned_work'
  | 'pending_work_approvals'
  | 'pending_purchase_approvals'
  | 'pending_approvals'
  | 'stock_alerts'
  | 'open_purchase_orders'
  | 'open_deliveries'
  | 'open_service_jobs'
  | 'business_users'
  | 'customer_count'
  | 'contract_records'
  | 'renewals_due_90'
  | 'open_opportunities'
  | 'commercial_accounts'
  | 'active_campaigns'
  | 'marketing_segments';

type WorkspaceSummary = Record<WorkspaceMetricKey, number> & {
  user_id: string;
  role: BusinessRole;
  branch: string;
};

type WorkspaceAction = {
  href: string;
  label: string;
  helper: string;
  badge?: WorkspaceMetricKey;
};

type WorkspaceMetric = {
  key: WorkspaceMetricKey;
  label: string;
  helper: string;
};

type WorkspaceDefinition = {
  title: string;
  description: string;
  metrics: WorkspaceMetric[];
};

const roleActions: Record<BusinessRole, WorkspaceAction[]> = {
  admin: [
    { href: '/work', label: 'Open Action Centre', helper: 'Tasks, approvals and exceptions.', badge: 'pending_approvals' },
    { href: '/warehouse/stock', label: 'Manage stock', helper: 'Scan, receive, issue and transfer stock.', badge: 'stock_alerts' },
    { href: '/operations/maintenance', label: 'Generate maintenance', helper: 'Review due calendar and meter plans.', badge: 'branch_overdue_work' },
    { href: '/admin/users', label: 'Manage users', helper: 'Roles, branches and access.', badge: 'business_users' },
  ],
  operations: [
    { href: '/work', label: 'Review work queue', helper: 'Assign, approve and unblock work.', badge: 'branch_overdue_work' },
    { href: '/operations/service-jobs', label: 'Service dispatch', helper: 'Manage jobs, priorities and technicians.', badge: 'open_service_jobs' },
    { href: '/operations/deliveries', label: 'Delivery exceptions', helper: 'Track open delivery orders.', badge: 'open_deliveries' },
    { href: '/operations/maintenance', label: 'Preventive maintenance', helper: 'Generate due maintenance work.' },
  ],
  warehouse_staff: [
    { href: '/warehouse/stock', label: 'Scan stock', helper: 'Receive, issue, adjust, count or transfer.', badge: 'stock_alerts' },
    { href: '/warehouse/purchasing', label: 'Receive purchase orders', helper: 'Receive partially or fully into locations.', badge: 'open_purchase_orders' },
    { href: '/warehouse/locations', label: 'Manage locations', helper: 'Bins, shelves, stockrooms and dispatch areas.' },
    { href: '/warehouse/ledger', label: 'View ledger', helper: 'Read-only movement and balance history.' },
  ],
  technician: [
    { href: '/technician', label: 'My technician jobs', helper: 'Open machine work assigned by Operations.', badge: 'my_active_work' },
    { href: '/work/execution', label: 'Execute work', helper: 'Checklist, comments, evidence and parts used.', badge: 'my_active_work' },
    { href: '/operations/reliability', label: 'Record meter or downtime', helper: 'Capture usage and restoration evidence.' },
    { href: '/operations/assets', label: 'Find machine', helper: 'Search QR, serial, barcode or customer machine.' },
  ],
  road_technician: [
    { href: '/road-tech', label: 'Road tech routes', helper: 'Open assigned route and delivery work.', badge: 'my_open_deliveries' },
    { href: '/work/execution', label: 'Execute work', helper: 'Complete assigned tasks, comments and parts used.', badge: 'my_active_work' },
    { href: '/operations/reliability', label: 'Record reliability', helper: 'Capture meter readings and downtime.' },
    { href: '/operations/assets', label: 'Find machine', helper: 'Search QR, serial, barcode or machine.' },
  ],
  executive: [
    { href: '/executive/command-centre', label: 'Command centre', helper: 'Branch risk and operational performance.' },
    { href: '/executive/service', label: 'Service performance', helper: 'SLA, downtime and reliability.', badge: 'branch_overdue_work' },
    { href: '/executive/warehouse', label: 'Warehouse risk', helper: 'Stock alerts and inventory exposure.', badge: 'stock_alerts' },
    { href: '/operations/maintenance', label: 'Maintenance due', helper: 'Forward-looking maintenance load.' },
  ],
  sales: [
    { href: '/customers', label: 'Customer directory', helper: 'Search account, branch, phone or address.', badge: 'customer_count' },
    { href: '/sales', label: 'Sales workspace', helper: 'Sales pipeline and account work.', badge: 'open_opportunities' },
    { href: '/work', label: 'My requests', helper: 'Track your open requests and assigned work.', badge: 'my_active_work' },
  ],
  finance: [
    { href: '/finance', label: 'Finance workspace', helper: 'Commercial account review and reporting.', badge: 'commercial_accounts' },
    { href: '/warehouse/purchasing/approvals', label: 'Purchase approvals', helper: 'Review purchasing risk and approvals.', badge: 'pending_purchase_approvals' },
    { href: '/work', label: 'Approval queue', helper: 'Finance requests and decisions.', badge: 'pending_work_approvals' },
  ],
  marketing: [
    { href: '/marketing', label: 'Marketing dashboard', helper: 'Campaign and segment activity.', badge: 'active_campaigns' },
    { href: '/marketing/contract-renewals', label: 'Contract renewals', helper: 'Renewal pipeline and customer exposure.', badge: 'renewals_due_90' },
    { href: '/customers', label: 'Customer directory', helper: 'Find accounts and branches.', badge: 'customer_count' },
  ],
};

const roleDefinitions: Record<BusinessRole, WorkspaceDefinition> = {
  admin: {
    title: 'Administrative command workspace',
    description: 'National system activity, approvals, users and operational exceptions.',
    metrics: [
      { key: 'branch_open_work', label: 'Open work', helper: 'All active work items nationally.' },
      { key: 'branch_overdue_work', label: 'Overdue work', helper: 'Open work beyond its due or SLA date.' },
      { key: 'pending_approvals', label: 'Pending approvals', helper: 'Work and purchase approvals awaiting action.' },
      { key: 'business_users', label: 'Business users', helper: 'ERP user records currently configured.' },
    ],
  },
  operations: {
    title: 'Operations management workspace',
    description: 'Branch workload, overdue items, unassigned work and service dispatch.',
    metrics: [
      { key: 'branch_open_work', label: 'Open branch work', helper: 'Active work in your assigned branch scope.' },
      { key: 'branch_overdue_work', label: 'Overdue branch work', helper: 'Branch work beyond its due or SLA date.' },
      { key: 'unassigned_work', label: 'Unassigned work', helper: 'Open work still requiring an owner.' },
      { key: 'open_service_jobs', label: 'Open service jobs', helper: 'Service jobs still requiring completion.' },
    ],
  },
  warehouse_staff: {
    title: 'Warehouse execution workspace',
    description: 'Inventory alerts, purchasing, deliveries and work assigned to you.',
    metrics: [
      { key: 'stock_alerts', label: 'Stock alerts', helper: 'Open or acknowledged inventory alerts.' },
      { key: 'open_purchase_orders', label: 'Open purchase orders', helper: 'Orders not yet received or closed.' },
      { key: 'open_deliveries', label: 'Open deliveries', helper: 'Delivery orders not yet closed.' },
      { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.' },
    ],
  },
  technician: {
    title: 'Technician assigned-work workspace',
    description: 'Only work assigned to you by Operations is shown here.',
    metrics: [
      { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.' },
      { key: 'my_overdue_work', label: 'My overdue work', helper: 'Your assigned work beyond its due or SLA date.' },
      { key: 'my_open_service_jobs', label: 'My service jobs', helper: 'Open service jobs assigned directly to you.' },
      { key: 'my_high_priority_work', label: 'High-priority work', helper: 'Your active high or critical priority work.' },
    ],
  },
  road_technician: {
    title: 'Road technician field workspace',
    description: 'Your assigned tasks, service jobs and delivery work for field execution.',
    metrics: [
      { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.' },
      { key: 'my_overdue_work', label: 'My overdue work', helper: 'Your assigned work beyond its due or SLA date.' },
      { key: 'my_open_deliveries', label: 'My deliveries', helper: 'Open delivery orders assigned directly to you.' },
      { key: 'my_open_service_jobs', label: 'My service jobs', helper: 'Open service jobs assigned directly to you.' },
    ],
  },
  executive: {
    title: 'Executive oversight workspace',
    description: 'National operational pressure, approvals and inventory risk.',
    metrics: [
      { key: 'branch_open_work', label: 'Open work', helper: 'All active operational work nationally.' },
      { key: 'branch_overdue_work', label: 'Overdue work', helper: 'Open work beyond its due or SLA date.' },
      { key: 'pending_approvals', label: 'Pending approvals', helper: 'Work and purchase approvals awaiting action.' },
      { key: 'stock_alerts', label: 'Stock alerts', helper: 'Open or acknowledged inventory alerts.' },
    ],
  },
  sales: {
    title: 'Sales account workspace',
    description: 'Customer coverage, contract records, pipeline and your open work.',
    metrics: [
      { key: 'customer_count', label: 'Customers', helper: 'Customer records in your branch scope.' },
      { key: 'contract_records', label: 'Contract records', helper: 'Imported contract-renewal records in scope.' },
      { key: 'open_opportunities', label: 'Open opportunities', helper: 'Open, follow-up or quoted opportunities.' },
      { key: 'my_active_work', label: 'My open work', helper: 'Open requests or tasks assigned to you.' },
    ],
  },
  finance: {
    title: 'Finance control workspace',
    description: 'Commercial account coverage, approval queues and your assigned work.',
    metrics: [
      { key: 'commercial_accounts', label: 'Commercial accounts', helper: 'Commercial customer records in your branch scope.' },
      { key: 'pending_purchase_approvals', label: 'Purchase approvals', helper: 'Purchase orders awaiting approval.' },
      { key: 'pending_work_approvals', label: 'Work approvals', helper: 'Work items awaiting approval.' },
      { key: 'my_active_work', label: 'My active work', helper: 'Open work assigned directly to you.' },
    ],
  },
  marketing: {
    title: 'Marketing planning workspace',
    description: 'Campaigns, audience segments, renewals and customer coverage.',
    metrics: [
      { key: 'active_campaigns', label: 'Active campaigns', helper: 'Campaigns not completed, closed or cancelled.' },
      { key: 'marketing_segments', label: 'Segments', helper: 'Saved marketing audience segments.' },
      { key: 'renewals_due_90', label: 'Renewals due', helper: 'Contract records expired or due within 90 days.' },
      { key: 'customer_count', label: 'Customers', helper: 'Customer records in your branch scope.' },
    ],
  },
};

function formatBranch(branch: string) {
  if (branch === 'jhb') return 'Johannesburg';
  if (branch === 'cpt') return 'Cape Town';
  if (branch === 'kzn') return 'KwaZulu-Natal';
  return 'National';
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';
}

function metricValue(summary: WorkspaceSummary | null, key: WorkspaceMetricKey) {
  if (!summary) return '—';
  return Number(summary[key] ?? 0).toLocaleString('en-ZA');
}

export function RoleWorkspacePanel() {
  const { businessProfile, businessUser, userDetails } = useAuth();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const role = userDetails?.role;

  const loadSummary = useCallback(async () => {
    if (!businessUser?.id || !role) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: summaryError } = await getSupabaseClient().rpc('get_role_workspace_summary');
      if (summaryError) throw summaryError;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('The Start Page summary returned an invalid response.');
      }

      setSummary(data as WorkspaceSummary);
      setLastUpdated(new Date());
    } catch (loadError) {
      setSummary(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load the Start Page details.');
    } finally {
      setLoading(false);
    }
  }, [businessUser?.id, role]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const actions = useMemo(() => (role ? roleActions[role] : []), [role]);
  const definition = role ? roleDefinitions[role] : null;
  const userName = displayProfileName(businessProfile);
  const displayedBranch = formatBranch(summary?.branch ?? userDetails?.branch ?? 'national');

  if (!role || !definition || !businessUser || !userDetails) {
    return <EmptyState title="Workspace unavailable" message="Your role and profile details are still loading. Refresh the page if this does not update." />;
  }

  return (
    <div className="role-workspace-stage corrected-start-page">
      <section className="workspace-profile-panel" aria-label="Signed-in user workspace details">
        <div aria-hidden="true" className="workspace-profile-avatar">{initialsFor(userName)}</div>
        <div className="workspace-profile-copy">
          <span className="minimal-kicker">Signed-in workspace</span>
          <h2>Welcome, {userName}</h2>
          <p>{definition.description}</p>
          <div className="workspace-context-row">
            <span><strong>Role</strong>{roleLabels[role]}</span>
            <span><strong>Branch</strong>{displayedBranch}</span>
            <span><strong>Email</strong>{businessUser.email}</span>
          </div>
        </div>
        <div className="workspace-refresh-block">
          <button className="button secondary" disabled={loading} onClick={loadSummary} type="button">
            {loading ? 'Refreshing…' : 'Refresh details'}
          </button>
          <small>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : 'Live Supabase data'}</small>
        </div>
      </section>

      {error ? (
        <div className="error workspace-summary-error" role="alert">
          <strong>Start Page details could not be loaded.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? <HamsterLoader label="Loading your Start Page details" /> : null}

      {!loading ? (
        <section aria-label={`${roleLabels[role]} workspace metrics`}>
          <div className="workspace-section-heading">
            <div>
              <span className="minimal-kicker">Live role details</span>
              <h2>{definition.title}</h2>
            </div>
          </div>
          <div className="minimal-metric-grid role-metric-grid">
            {definition.metrics.map((metric) => (
              <article className="minimal-metric role-metric-card" key={metric.key}>
                <span>{metric.label}</span>
                <strong>{metricValue(summary, metric.key)}</strong>
                <small>{metric.helper}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="minimal-panel role-shortcuts-panel">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">Daily shortcuts</span>
            <h2>{roleLabels[role]} Start Page</h2>
            <p>Open the screens and work queues assigned to your role.</p>
          </div>
        </div>
        <div className="role-action-grid">
          {actions.map((action) => (
            <Link className="role-action-card" href={action.href} key={action.href}>
              <div>
                <h3>{action.label}</h3>
                <p>{action.helper}</p>
              </div>
              {action.badge && summary ? (
                <StatusBadge
                  value={summary[action.badge] > 0 ? 'warning' : 'active'}
                  label={Number(summary[action.badge] ?? 0).toLocaleString('en-ZA')}
                />
              ) : null}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
