'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';

 type OperationsSummary = {
  branch_open_work: number;
  branch_overdue_work: number;
  unassigned_work: number;
  pending_approvals: number;
  stock_alerts: number;
  open_purchase_orders: number;
  open_deliveries: number;
  open_service_jobs: number;
};

type ScheduleItem = {
  item_id: string;
  item_type: 'monthly' | 'request';
  customer_name: string | null;
  customer_code: string | null;
  branch: string;
  status: string;
  assigned_to: string | null;
  assigned_name: string | null;
  route_number: string | null;
  route_order: number | null;
  address: string | null;
  summary: string | null;
};

const quickActions = [
  { href: '/operations/dispatch', title: 'Open dispatch overview', helper: 'See route gaps, service exceptions, delivery pressure and technician capacity together.' },
  { href: '/operations/service-planning', title: 'Plan today’s service routes', helper: 'Assign drivers, route numbers, stop order and reschedules.' },
  { href: '/operations/service-jobs', title: 'Open scheduled call log', helper: 'Create request-only service work and dispatch technicians.' },
  { href: '/operations/deliveries', title: 'Review delivery board', helper: 'Track picked, dispatched, delivered and closed orders.' },
  { href: '/work', title: 'Open Operations Action Centre', helper: 'Resolve unassigned work, approvals and exceptions.' },
  { href: '/operations/maintenance', title: 'Review maintenance due', helper: 'Generate and monitor preventive maintenance work.' },
  { href: '/operations/reports', title: 'Open Operations reports', helper: 'Review service, route and delivery performance.' },
];

function branchLabel(value: string) {
  if (value === 'jhb') return 'Johannesburg';
  if (value === 'cpt') return 'Cape Town';
  if (value === 'kzn') return 'KwaZulu-Natal';
  return 'National';
}

export function OperationsManagerDashboard() {
  const { userDetails } = useAuth();
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!userDetails) return;

    setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const branch = userDetails.branch === 'national' ? 'all' : userDetails.branch;
    const [summaryResult, scheduleResult] = await Promise.all([
      client.rpc('get_role_workspace_summary'),
      client.rpc('list_daily_service_schedule', {
        p_schedule_date: formatLocalDate(),
        p_branch: branch,
      }),
    ]);

    const firstError = summaryResult.error ?? scheduleResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    setSummary(summaryResult.data as OperationsSummary);
    setSchedule((scheduleResult.data ?? []) as ScheduleItem[]);
    setLastUpdated(new Date());
    setLoading(false);
  }, [userDetails]);

  useEffect(() => {
    loadDashboard().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Operations Manager details.');
      setLoading(false);
    });
  }, [loadDashboard]);

  const routeMetrics = useMemo(() => ({
    clientsDue: schedule.length,
    monthly: schedule.filter((item) => item.item_type === 'monthly').length,
    requests: schedule.filter((item) => item.item_type === 'request').length,
    unassigned: schedule.filter((item) => !item.assigned_to).length,
    missed: schedule.filter((item) => item.status === 'missed').length,
  }), [schedule]);

  const attentionItems = useMemo(() => schedule
    .filter((item) => !item.assigned_to || item.status === 'missed')
    .slice(0, 8), [schedule]);

  return (
    <div className="operations-manager-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading Operations Manager workspace" /> : null}

      {!loading ? (
        <>
          <section aria-label="Operations workload" className="grid grid-4 operations-manager-kpis" data-ui-priority="summary">
            <KpiCard label="Overdue work" value={summary?.branch_overdue_work ?? 0} helper="Work beyond its due or SLA date." />
            <KpiCard label="Unassigned work" value={summary?.unassigned_work ?? 0} helper="Open work still requiring an owner." />
            <KpiCard label="Open service jobs" value={summary?.open_service_jobs ?? 0} helper="Service jobs not completed or closed." />
            <KpiCard label="Routes unassigned" value={routeMetrics.unassigned} helper="Today’s clients still needing a driver." />
            <KpiCard label="Open branch work" value={summary?.branch_open_work ?? 0} helper="Active operational work in your branch scope." />
            <KpiCard label="Clients due today" value={routeMetrics.clientsDue} helper="Paid monthly and requested service work." />
            <KpiCard label="Open deliveries" value={summary?.open_deliveries ?? 0} helper="Delivery orders not delivered or closed." />
            <KpiCard label="Stock alerts" value={summary?.stock_alerts ?? 0} helper="Open inventory alerts requiring review." />
          </section>

          <PageToolbar
            actions={<button className="button secondary" disabled={loading} onClick={loadDashboard} type="button">Refresh Operations</button>}
            description={`Daily control for ${branchLabel(userDetails?.branch ?? 'national')}: workload, service routes, deliveries, maintenance and stock exceptions.`}
            lastUpdated={lastUpdated}
            title="Operations controls"
          />

          <section className="neo-card operations-manager-section" data-ui-priority="primary">
            <div className="minimal-panel-header">
              <div>
                <span className="minimal-kicker">Today’s service pressure</span>
                <h2>{new Date(`${formatLocalDate()}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
                <p>Paid monthly obligations and request-only service work due today.</p>
              </div>
              <Link className="button" href="/operations/dispatch">Open dispatch overview</Link>
            </div>

            <div className="operations-route-summary">
              <div><span>Paid monthly</span><strong>{routeMetrics.monthly}</strong></div>
              <div><span>On request</span><strong>{routeMetrics.requests}</strong></div>
              <div><span>Unassigned</span><strong>{routeMetrics.unassigned}</strong></div>
              <div><span>Missed</span><strong>{routeMetrics.missed}</strong></div>
            </div>

            {attentionItems.length === 0 ? (
              <div className="empty-state compact-empty-state">No unassigned or missed service items require attention today.</div>
            ) : (
              <div className="operations-attention-list">
                {attentionItems.map((item) => (
                  <article className="operations-attention-card" key={`${item.item_type}:${item.item_id}`}>
                    <div>
                      <strong>{item.customer_name ?? 'Customer not linked'}</strong>
                      <small>{item.customer_code || item.branch.toUpperCase()} · {item.address || 'No address captured'}</small>
                    </div>
                    <div>
                      <StatusBadge value={item.status} />
                      <span>{item.assigned_name || 'Driver unassigned'}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="neo-card operations-manager-section" data-ui-priority="secondary">
            <div className="minimal-panel-header">
              <div>
                <span className="minimal-kicker">Manager shortcuts</span>
                <h2>Operations controls</h2>
                <p>Pages assigned specifically to the Operations Manager role.</p>
              </div>
            </div>
            <div className="operations-manager-actions">
              {quickActions.map((action) => (
                <Link className="role-action-card" href={action.href} key={action.href}>
                  <div><h3>{action.title}</h3><p>{action.helper}</p></div>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
