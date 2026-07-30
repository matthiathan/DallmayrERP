'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BoardHeader } from '@/components/boards/BoardWorkspace';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { canAccessPath, roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessRole } from '@/types/dallmayrerp';

type MetricKey =
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

type WorkspaceSummary = Partial<Record<MetricKey, number>> & {
  user_id: string;
  role: BusinessRole;
  branch: string;
};

type MetricWidget = {
  id: string;
  type: 'metric';
  title: string;
  metric: MetricKey;
  href?: string;
};

type DashboardConfig = {
  columns?: number;
  widgets: MetricWidget[];
};

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

const metricKeys = new Set<MetricKey>([
  'my_active_work', 'my_overdue_work', 'my_high_priority_work', 'my_open_service_jobs',
  'my_open_deliveries', 'branch_open_work', 'branch_overdue_work', 'unassigned_work',
  'pending_work_approvals', 'pending_purchase_approvals', 'pending_approvals', 'stock_alerts',
  'open_purchase_orders', 'open_deliveries', 'open_service_jobs', 'business_users',
  'customer_count', 'contract_records', 'renewals_due_90', 'open_opportunities',
  'commercial_accounts', 'active_campaigns', 'marketing_segments',
]);

const metricHelp: Record<MetricKey, string> = {
  my_active_work: 'Open work assigned to or requested by you.',
  my_overdue_work: 'Your work beyond its due or SLA target.',
  my_high_priority_work: 'High or critical work assigned to you.',
  my_open_service_jobs: 'Open service jobs assigned to you.',
  my_open_deliveries: 'Open delivery work assigned to you.',
  branch_open_work: 'Active work within the current branch scope.',
  branch_overdue_work: 'Branch work beyond due or SLA targets.',
  unassigned_work: 'Open work still requiring an accountable owner.',
  pending_work_approvals: 'Work items waiting for approval.',
  pending_purchase_approvals: 'Purchase orders waiting for approval.',
  pending_approvals: 'All approval decisions currently waiting.',
  stock_alerts: 'Open inventory alerts requiring attention.',
  open_purchase_orders: 'Purchase orders not fully received or closed.',
  open_deliveries: 'Delivery orders not yet closed.',
  open_service_jobs: 'Service work not yet terminal.',
  business_users: 'Active ERP user records.',
  customer_count: 'Customers visible within the current scope.',
  contract_records: 'Contract records visible to the role.',
  renewals_due_90: 'Contract renewals due within ninety days.',
  open_opportunities: 'Open or follow-up sales opportunities.',
  commercial_accounts: 'Commercial accounts visible to Finance.',
  active_campaigns: 'Campaigns currently active.',
  marketing_segments: 'Configured customer segments.',
};

function parseDashboardConfig(value: unknown): DashboardConfig | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as { columns?: unknown; widgets?: unknown };
  if (!Array.isArray(source.widgets)) return null;

  const widgets = source.widgets.flatMap((widget): MetricWidget[] => {
    if (!widget || typeof widget !== 'object') return [];
    const candidate = widget as Record<string, unknown>;
    if (candidate.type !== 'metric' || typeof candidate.metric !== 'string' || !metricKeys.has(candidate.metric as MetricKey)) return [];
    const href = typeof candidate.href === 'string' && candidate.href.startsWith('/') && !candidate.href.startsWith('//') ? candidate.href : undefined;
    return [{
      id: typeof candidate.id === 'string' ? candidate.id : `${candidate.metric}`,
      type: 'metric',
      title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : candidate.metric.replace(/_/g, ' '),
      metric: candidate.metric as MetricKey,
      href,
    }];
  });

  if (widgets.length === 0) return null;
  const columns = typeof source.columns === 'number' ? Math.max(1, Math.min(4, Math.round(source.columns))) : 3;
  return { columns, widgets };
}

function dashboardParam() {
  if (typeof window === 'undefined') return null;
  return new URL(window.location.href).searchParams.get('dashboard');
}

export function SharedDashboardWorkspace() {
  const { businessUser, userDetails } = useAuth();
  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!businessUser?.id || !userDetails?.role) return;
    setLoading(true);
    setError(null);

    const client = getSupabaseClient();
    const [dashboardsResult, summaryResult] = await Promise.all([
      client.rpc('list_shared_dashboards', { p_workspace_key: 'role_dashboard', p_include_all: false }),
      client.rpc('get_role_workspace_summary'),
    ]);

    const firstError = dashboardsResult.error ?? summaryResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const nextDashboards = ((dashboardsResult.data ?? []) as DashboardRow[])
      .filter((dashboard) => parseDashboardConfig(dashboard.config));
    const requested = dashboardParam();
    const selected = nextDashboards.find((dashboard) => dashboard.id === requested)
      ?? nextDashboards.find((dashboard) => dashboard.is_default)
      ?? nextDashboards[0]
      ?? null;

    setDashboards(nextDashboards);
    setSelectedId(selected?.id ?? null);
    setSummary((summaryResult.data ?? null) as WorkspaceSummary | null);
    setLastUpdated(new Date());
    setLoading(false);
  }, [businessUser?.id, userDetails?.role]);

  useEffect(() => {
    loadDashboard().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load shared dashboards.');
      setLoading(false);
    });
  }, [loadDashboard]);

  useEffect(() => {
    if (!selectedId || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('dashboard', selectedId);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selectedId]);

  const selectedDashboard = dashboards.find((dashboard) => dashboard.id === selectedId) ?? null;
  const config = useMemo(() => parseDashboardConfig(selectedDashboard?.config), [selectedDashboard?.config]);
  const roleName = userDetails?.role ? roleLabels[userDetails.role] : 'ERP user';
  const branchLabel = userDetails?.branch ? userDetails.branch.toUpperCase() : 'National';

  return (
    <div className="shared-dashboard-workspace">
      <BoardHeader
        actions={(
          <>
            {dashboards.length > 1 ? (
              <label className="shared-dashboard-selector">
                <span className="sr-only">Shared dashboard</span>
                <select value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
                  {dashboards.map((dashboard) => (
                    <option key={dashboard.id} value={dashboard.id}>
                      {dashboard.name}{dashboard.branch_scope ? ` · ${dashboard.branch_scope.toUpperCase()}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {userDetails?.role === 'admin' ? <Link className="button secondary" href="/admin/workspace-controls">Manage layouts</Link> : null}
            <button className="button secondary" disabled={loading} onClick={loadDashboard} type="button">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        )}
        description={selectedDashboard?.description ?? 'Role-scoped metrics published by an administrator.'}
        eyebrow={`${roleName} · ${branchLabel}`}
        meta={lastUpdated ? <span>Updated {lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span> : undefined}
        title={selectedDashboard?.name ?? 'Shared Dashboard'}
      />

      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading && dashboards.length === 0 ? <HamsterLoader label="Loading shared dashboard" /> : null}

      {!loading && dashboards.length === 0 ? (
        <section className="shared-dashboard-empty">
          <h2>No dashboard is published for this role</h2>
          <p>An administrator can publish a role or branch dashboard from Workspace Controls.</p>
          <Link className="button secondary" href="/workspace">Open Today</Link>
        </section>
      ) : null}

      {config && summary ? (
        <section
          aria-label={selectedDashboard?.name ?? 'Shared dashboard metrics'}
          className="shared-dashboard-grid"
          style={{ '--shared-dashboard-columns': config.columns ?? 3 } as React.CSSProperties}
        >
          {config.widgets.map((widget) => {
            const value = Number(summary[widget.metric] ?? 0);
            const allowedHref = widget.href && userDetails?.role && canAccessPath(userDetails.role, widget.href.split('?')[0])
              ? widget.href
              : null;
            const content = (
              <>
                <span>{widget.title}</span>
                <strong>{value.toLocaleString('en-ZA')}</strong>
                <small>{metricHelp[widget.metric]}</small>
                {allowedHref ? <em>Open related work →</em> : null}
              </>
            );

            return allowedHref ? (
              <Link className="shared-dashboard-widget" href={allowedHref} key={widget.id}>{content}</Link>
            ) : (
              <article className="shared-dashboard-widget" key={widget.id}>{content}</article>
            );
          })}
        </section>
      ) : null}

      {selectedDashboard ? (
        <footer className="shared-dashboard-footnote">
          <span>{selectedDashboard.is_default ? 'Default role dashboard' : 'Published dashboard'}</span>
          <span>{selectedDashboard.branch_scope ? `${selectedDashboard.branch_scope.toUpperCase()} branch` : 'All permitted branches'}</span>
          <span>Metrics remain constrained by authentication, role and RLS.</span>
        </footer>
      ) : null}
    </div>
  );
}
