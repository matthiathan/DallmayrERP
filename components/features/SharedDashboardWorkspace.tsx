'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  ErpMetricCard,
  ErpMetricGrid,
  ErpPage,
  ErpPageHeader,
  ErpPanel,
  ErpStateBanner,
  ErpToolbar,
} from '@/components/ui/ErpLayout';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { canAccessPath, roleLabels } from '@/lib/auth/permissions';
import {
  sharedDashboardBranchLabel,
  sharedDashboardMetricForRole,
  type SharedDashboardRecord,
  type SharedDashboardSummary,
  type SharedDashboardWidgetRecord,
} from '@/lib/dashboards/shared-dashboard-catalog';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { BusinessRole } from '@/types/dallmayrerp';

function requestedDashboardSlug(pathname: string) {
  const prefix = '/workspace/dashboards/';
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length).split('/')[0];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function orderedWidgets(dashboard: SharedDashboardRecord | null, role: BusinessRole) {
  return [...(dashboard?.shared_dashboard_widgets ?? [])]
    .filter((widget): widget is SharedDashboardWidgetRecord => Boolean(sharedDashboardMetricForRole(role, widget.metric_key)))
    .sort((left, right) => left.position - right.position || left.created_at.localeCompare(right.created_at));
}

export function SharedDashboardWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const { businessUser, userDetails } = useAuth();
  const [dashboards, setDashboards] = useState<SharedDashboardRecord[]>([]);
  const [summary, setSummary] = useState<SharedDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const role = userDetails?.role as BusinessRole | undefined;
  const branch = userDetails?.branch;
  const requestedSlug = requestedDashboardSlug(pathname);

  const loadWorkspace = useCallback(async () => {
    if (!businessUser?.id || !role || !branch) return;

    setLoading(true);
    setError(null);

    try {
      const client = getSupabaseClient();
      const [dashboardResult, summaryResult] = await Promise.all([
        client
          .from('shared_dashboards')
          .select(`
            id, name, slug, description, target_role, branch_scope, is_published,
            published_at, created_by, updated_by, created_at, updated_at,
            shared_dashboard_widgets(id, dashboard_id, metric_key, position, created_at, updated_at)
          `)
          .eq('is_published', true)
          .eq('target_role', role)
          .order('name'),
        client.rpc('get_role_workspace_summary'),
      ]);

      if (dashboardResult.error) throw dashboardResult.error;
      if (summaryResult.error) throw summaryResult.error;
      if (!summaryResult.data || typeof summaryResult.data !== 'object' || Array.isArray(summaryResult.data)) {
        throw new Error('The shared dashboard metric summary returned an invalid response.');
      }

      const eligibleDashboards = ((dashboardResult.data ?? []) as SharedDashboardRecord[])
        .filter((dashboard) => dashboard.target_role === role)
        .filter((dashboard) => dashboard.is_published)
        .filter((dashboard) => dashboard.branch_scope === null || dashboard.branch_scope === branch)
        .map((dashboard) => ({
          ...dashboard,
          shared_dashboard_widgets: (dashboard.shared_dashboard_widgets ?? [])
            .filter((widget) => Boolean(sharedDashboardMetricForRole(role, widget.metric_key))),
        }));

      setDashboards(eligibleDashboards);
      setSummary(summaryResult.data as SharedDashboardSummary);
      setLastUpdated(new Date());
    } catch (loadError) {
      setDashboards([]);
      setSummary(null);
      setError(loadError instanceof Error ? loadError.message : 'Could not load shared dashboards.');
    } finally {
      setLoading(false);
    }
  }, [branch, businessUser?.id, role]);

  useEffect(() => {
    loadWorkspace().catch(() => undefined);
  }, [loadWorkspace]);

  const selectedDashboard = useMemo(() => {
    if (!dashboards.length) return null;
    if (!requestedSlug) return dashboards[0];
    return dashboards.find((dashboard) => dashboard.slug === requestedSlug) ?? null;
  }, [dashboards, requestedSlug]);

  const widgets = useMemo(
    () => role ? orderedWidgets(selectedDashboard, role) : [],
    [role, selectedDashboard],
  );

  if (!role || !branch) {
    return <HamsterLoader label="Loading dashboard permissions" />;
  }

  return (
    <ErpPage variant="dashboard">
      <ErpPageHeader
        actions={role === 'admin' ? <Link className="button secondary" href="/admin/users/shared-dashboards">Manage shared dashboards</Link> : undefined}
        description="Administrator-published metric views use your existing role and branch permissions. Dashboard publication never expands the data you are authorised to see."
        eyebrow="Shared dashboards"
        meta={<span>{roleLabels[role]} · {sharedDashboardBranchLabel(branch)}</span>}
        title="Shared dashboard workspace"
      />

      {error ? (
        <ErpStateBanner
          action={<button className="button secondary" onClick={() => loadWorkspace().catch(() => undefined)} type="button">Retry</button>}
          message={error}
          title="Shared dashboards could not be loaded"
          tone="danger"
        />
      ) : null}

      <ErpToolbar
        primary={(
          <label>
            Dashboard
            <select
              disabled={loading || dashboards.length === 0}
              value={selectedDashboard?.slug ?? ''}
              onChange={(event) => {
                const slug = event.target.value;
                if (slug) router.push(`/workspace/dashboards/${encodeURIComponent(slug)}`);
              }}
            >
              {dashboards.length === 0 ? <option value="">No dashboards published</option> : null}
              {dashboards.map((dashboard) => (
                <option key={dashboard.id} value={dashboard.slug}>
                  {dashboard.name} · {sharedDashboardBranchLabel(dashboard.branch_scope)}
                </option>
              ))}
            </select>
          </label>
        )}
        secondary={(
          <button className="button secondary" disabled={loading} onClick={() => loadWorkspace().catch(() => undefined)} type="button">
            {loading ? 'Refreshing…' : 'Refresh metrics'}
          </button>
        )}
      />

      {lastUpdated ? <small>Last updated {lastUpdated.toLocaleString('en-ZA')}</small> : null}

      {loading ? <HamsterLoader label="Loading shared dashboards" /> : null}

      {!loading && dashboards.length === 0 && !error ? (
        <ErpStateBanner
          message="No administrator-published dashboard currently matches your role and branch. Your normal role workspace remains available."
          title="No shared dashboard published"
          tone="neutral"
        />
      ) : null}

      {!loading && requestedSlug && !selectedDashboard && dashboards.length > 0 ? (
        <ErpStateBanner
          action={<button className="button secondary" onClick={() => router.push(`/workspace/dashboards/${encodeURIComponent(dashboards[0].slug)}`)} type="button">Open an available dashboard</button>}
          message="That dashboard is not published for your current role and branch, or it no longer exists."
          title="Dashboard unavailable"
          tone="warning"
        />
      ) : null}

      {!loading && selectedDashboard ? (
        <ErpPanel
          description={selectedDashboard.description ?? `Published for ${roleLabels[selectedDashboard.target_role]} · ${sharedDashboardBranchLabel(selectedDashboard.branch_scope)}.`}
          eyebrow={`${roleLabels[selectedDashboard.target_role]} · ${sharedDashboardBranchLabel(selectedDashboard.branch_scope)}`}
          title={selectedDashboard.name}
        >
          {widgets.length === 0 ? (
            <ErpStateBanner
              message="This dashboard contains no metric widgets that are permitted for your role. Ask an administrator to review the dashboard configuration."
              title="No permitted widgets"
              tone="warning"
            />
          ) : (
            <ErpMetricGrid columns="auto">
              {widgets.map((widget) => {
                const definition = sharedDashboardMetricForRole(role, widget.metric_key);
                if (!definition) return null;
                const canDrillDown = Boolean(definition.drilldown && canAccessPath(role, definition.drilldown));
                return (
                  <ErpMetricCard
                    action={canDrillDown && definition.drilldown ? <Link href={definition.drilldown}>Open details</Link> : undefined}
                    helper={definition.helper}
                    key={widget.id}
                    label={definition.label}
                    value={Number(summary?.[widget.metric_key] ?? 0).toLocaleString('en-ZA')}
                  />
                );
              })}
            </ErpMetricGrid>
          )}
        </ErpPanel>
      ) : null}
    </ErpPage>
  );
}
