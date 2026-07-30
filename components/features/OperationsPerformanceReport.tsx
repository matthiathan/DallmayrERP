'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';

type ReportSummary = {
  date_from: string;
  date_to: string;
  branch: string;
  service_jobs_total: number;
  service_jobs_open: number;
  service_jobs_completed: number;
  service_jobs_overdue: number;
  service_jobs_unassigned: number;
  monthly_services_total: number;
  monthly_services_completed: number;
  monthly_services_missed: number;
  monthly_services_rescheduled: number;
  delivery_orders_total: number;
  delivery_orders_open: number;
  delivery_orders_completed: number;
  planned_route_stops: number;
  customers_requiring_service: number;
};

const branches = ['all', 'jhb', 'cpt', 'kzn', 'national'];

function firstDayOfMonth() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`;
}

function completionRate(completed: number, total: number) {
  if (total <= 0) return '0%';
  return `${Math.round((completed / total) * 100)}%`;
}

export function OperationsPerformanceReport() {
  const { userDetails } = useAuth();
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth());
  const [dateTo, setDateTo] = useState(formatLocalDate());
  const [branch, setBranch] = useState('all');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!userDetails) return;
    setBranch(userDetails.branch === 'national' ? 'all' : userDetails.branch);
  }, [userDetails]);

  const loadReport = useCallback(async () => {
    if (!userDetails) return;
    setLoading(true);
    setError(null);

    const { data, error: reportError } = await getSupabaseClient().rpc('get_operations_manager_report_summary', {
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_branch: branch,
    });

    if (reportError) {
      setError(reportError.message);
      setLoading(false);
      return;
    }

    setSummary(data as ReportSummary);
    setLastUpdated(new Date());
    setLoading(false);
  }, [branch, dateFrom, dateTo, userDetails]);

  useEffect(() => {
    loadReport().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load Operations performance.');
      setLoading(false);
    });
  }, [loadReport]);

  const indicators = useMemo(() => {
    if (!summary) return [];
    return [
      {
        label: 'Service job completion',
        value: completionRate(summary.service_jobs_completed, summary.service_jobs_total),
        tone: summary.service_jobs_overdue > 0 ? 'warning' : 'success',
        helper: `${summary.service_jobs_completed} completed of ${summary.service_jobs_total} in scope.`,
      },
      {
        label: 'Monthly service coverage',
        value: completionRate(summary.monthly_services_completed, summary.monthly_services_total),
        tone: summary.monthly_services_missed > 0 ? 'danger' : 'success',
        helper: `${summary.monthly_services_missed} missed paid monthly services.`,
      },
      {
        label: 'Delivery completion',
        value: completionRate(summary.delivery_orders_completed, summary.delivery_orders_total),
        tone: summary.delivery_orders_open > 0 ? 'warning' : 'success',
        helper: `${summary.delivery_orders_open} delivery orders remain open.`,
      },
    ];
  }, [summary]);

  return (
    <div className="operations-manager-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={loadReport} type="button">{loading ? 'Refreshing…' : 'Refresh report'}</button>}
        description="Review service, monthly coverage, route planning and delivery performance for the selected period."
        lastUpdated={lastUpdated}
        title="Operations Performance"
      >
        <label>From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label>Branch
          <select disabled={userDetails?.branch !== 'national'} value={branch} onChange={(event) => setBranch(event.target.value)}>
            {branches.map((item) => <option key={item} value={item}>{item === 'all' ? 'All branches' : item.toUpperCase()}</option>)}
          </select>
        </label>
      </PageToolbar>

      {loading ? <HamsterLoader label="Loading Operations performance report" /> : null}

      {!loading && summary ? (
        <>
          <section className="grid grid-4 operations-manager-kpis" aria-label="Operations report metrics">
            <KpiCard label="Customers requiring service" value={summary.customers_requiring_service} helper="Distinct customers with service work in the period." />
            <KpiCard label="Service jobs" value={summary.service_jobs_total} helper={`${summary.service_jobs_open} remain open.`} />
            <KpiCard label="Overdue service jobs" value={summary.service_jobs_overdue} helper="Open service work beyond its due time." />
            <KpiCard label="Unassigned service jobs" value={summary.service_jobs_unassigned} helper="Jobs requiring an owner." />
            <KpiCard label="Paid monthly services" value={summary.monthly_services_total} helper={`${summary.monthly_services_completed} completed.`} />
            <KpiCard label="Missed monthly services" value={summary.monthly_services_missed} helper="Paid obligations past their service date." />
            <KpiCard label="Planned route stops" value={summary.planned_route_stops} helper="Service items with route numbers assigned." />
            <KpiCard label="Open deliveries" value={summary.delivery_orders_open} helper={`${summary.delivery_orders_completed} delivered or closed.`} />
          </section>

          <section className="neo-card operations-manager-section">
            <div className="minimal-panel-header">
              <div>
                <span className="minimal-kicker">Performance indicators</span>
                <h2>{new Date(`${summary.date_from}T12:00:00`).toLocaleDateString('en-ZA')} – {new Date(`${summary.date_to}T12:00:00`).toLocaleDateString('en-ZA')}</h2>
                <p>Operational completion and exception indicators for {summary.branch === 'all' ? 'all permitted branches' : summary.branch.toUpperCase()}.</p>
              </div>
            </div>
            <div className="operations-indicator-grid">
              {indicators.map((indicator) => (
                <article className="operations-indicator-card" key={indicator.label}>
                  <div><span>{indicator.label}</span><strong>{indicator.value}</strong></div>
                  <StatusBadge value={indicator.tone} label={indicator.helper} />
                </article>
              ))}
            </div>
          </section>

          <section className="neo-card operations-manager-section">
            <div className="minimal-panel-header">
              <div>
                <span className="minimal-kicker">Exception summary</span>
                <h2>Items requiring Operations attention</h2>
                <p>Use these values to prioritise route planning and daily handover.</p>
              </div>
            </div>
            <div className="operations-exception-grid">
              <div><StatusBadge value={summary.service_jobs_overdue > 0 ? 'overdue' : 'active'} /><strong>{summary.service_jobs_overdue}</strong><span>Overdue service jobs</span></div>
              <div><StatusBadge value={summary.service_jobs_unassigned > 0 ? 'warning' : 'active'} /><strong>{summary.service_jobs_unassigned}</strong><span>Unassigned service jobs</span></div>
              <div><StatusBadge value={summary.monthly_services_missed > 0 ? 'missed' : 'active'} /><strong>{summary.monthly_services_missed}</strong><span>Missed paid services</span></div>
              <div><StatusBadge value={summary.monthly_services_rescheduled > 0 ? 'rescheduled' : 'active'} /><strong>{summary.monthly_services_rescheduled}</strong><span>Rescheduled monthly services</span></div>
              <div><StatusBadge value={summary.delivery_orders_open > 0 ? 'warning' : 'active'} /><strong>{summary.delivery_orders_open}</strong><span>Open delivery orders</span></div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
