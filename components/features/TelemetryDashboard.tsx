'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import {
  InteractiveDonutChart,
  InteractiveHorizontalBars,
  InteractiveLineChart,
  type InteractiveChartDatum,
} from '@/components/ui/InteractiveCharts';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';

type TelemetryPeriod = 'day' | 'week' | 'month' | 'six_months';
type TelemetryDataset = 'production' | 'simulation';
type TelemetryBranch = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';

type Summary = {
  units_sold: number;
  revenue_cents: number;
  failed_vends: number;
  active_machines: number;
  reporting_devices: number;
  online_devices: number;
  offline_devices: number;
  unassigned_devices: number;
};

type Availability = {
  production_rows: number;
  simulation_rows: number;
  active_simulation_devices: number;
};

type DailyTrend = {
  date: string;
  units_sold: number;
  revenue_cents: number;
  failed_vends: number;
};

type BranchTotal = {
  branch: string;
  units_sold: number;
  revenue_cents: number;
  failed_vends: number;
};

type TopItem = {
  product_key: string;
  sku: string | null;
  product_name: string | null;
  brand: string | null;
  units_sold: number;
  revenue_cents: number;
  failed_vends: number;
};

type TopMachine = {
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  location: string | null;
  branch: string;
  units_sold: number;
  revenue_cents: number;
  failed_vends: number;
};

type RecentSale = {
  id: string;
  sales_date: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  location: string | null;
  branch: string;
  selection_code: string;
  sku: string | null;
  product_name: string | null;
  brand: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
  last_received_at: string;
};

type DashboardData = {
  period: TelemetryPeriod;
  dataset: TelemetryDataset;
  date_from: string;
  date_to: string;
  availability: Availability;
  summary: Summary;
  daily_trend: DailyTrend[];
  by_branch: BranchTotal[];
  top_items: TopItem[];
  top_machines: TopMachine[];
  recent_sales: RecentSale[];
};

const periodLabels: Record<TelemetryPeriod, string> = {
  day: '1 day',
  week: '7 days',
  month: '30 days',
  six_months: '6 months',
};

const datasetLabels: Record<TelemetryDataset, string> = {
  production: 'Production telemetry',
  simulation: 'POC simulation',
};

const branchLabels: Record<TelemetryBranch, string> = {
  all: 'All branches',
  jhb: 'Johannesburg',
  cpt: 'Cape Town',
  kzn: 'KwaZulu-Natal',
  national: 'National',
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 2,
  }).format(numberValue(cents) / 100);
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA', {
    day: '2-digit',
    month: 'short',
  });
}

function dateTime(value: string) {
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normaliseDashboard(value: unknown): DashboardData {
  const source = (value ?? {}) as Partial<DashboardData>;
  const summary = (source.summary ?? {}) as Partial<Summary>;
  const availability = (source.availability ?? {}) as Partial<Availability>;
  return {
    period: source.period ?? 'day',
    dataset: source.dataset ?? 'production',
    date_from: source.date_from ?? formatLocalDate(),
    date_to: source.date_to ?? formatLocalDate(),
    availability: {
      production_rows: numberValue(availability.production_rows),
      simulation_rows: numberValue(availability.simulation_rows),
      active_simulation_devices: numberValue(availability.active_simulation_devices),
    },
    summary: {
      units_sold: numberValue(summary.units_sold),
      revenue_cents: numberValue(summary.revenue_cents),
      failed_vends: numberValue(summary.failed_vends),
      active_machines: numberValue(summary.active_machines),
      reporting_devices: numberValue(summary.reporting_devices),
      online_devices: numberValue(summary.online_devices),
      offline_devices: numberValue(summary.offline_devices),
      unassigned_devices: numberValue(summary.unassigned_devices),
    },
    daily_trend: (source.daily_trend ?? []).map((row) => ({
      ...row,
      units_sold: numberValue(row.units_sold),
      revenue_cents: numberValue(row.revenue_cents),
      failed_vends: numberValue(row.failed_vends),
    })),
    by_branch: (source.by_branch ?? []).map((row) => ({
      ...row,
      units_sold: numberValue(row.units_sold),
      revenue_cents: numberValue(row.revenue_cents),
      failed_vends: numberValue(row.failed_vends),
    })),
    top_items: (source.top_items ?? []).map((row) => ({
      ...row,
      units_sold: numberValue(row.units_sold),
      revenue_cents: numberValue(row.revenue_cents),
      failed_vends: numberValue(row.failed_vends),
    })),
    top_machines: (source.top_machines ?? []).map((row) => ({
      ...row,
      units_sold: numberValue(row.units_sold),
      revenue_cents: numberValue(row.revenue_cents),
      failed_vends: numberValue(row.failed_vends),
    })),
    recent_sales: (source.recent_sales ?? []).map((row) => ({
      ...row,
      units_sold: numberValue(row.units_sold),
      revenue_cents: numberValue(row.revenue_cents),
      failed_vends: numberValue(row.failed_vends),
    })),
  };
}

function sixMonthTrend(rows: DailyTrend[]): InteractiveChartDatum[] {
  const buckets = new Map<string, { units: number; failed: number; revenue: number }>();
  rows.forEach((row) => {
    const key = row.date.slice(0, 7);
    const current = buckets.get(key) ?? { units: 0, failed: 0, revenue: 0 };
    current.units += row.units_sold;
    current.failed += row.failed_vends;
    current.revenue += row.revenue_cents;
    buckets.set(key, current);
  });
  return Array.from(buckets.entries()).map(([month, values]) => ({
    key: month,
    label: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
    value: values.units,
    secondaryLabel: 'Failed vends',
    secondaryValue: values.failed,
    detail: `Revenue ${money(values.revenue)}`,
  }));
}

function AnalyticsMetric({ icon, label, value, helper, tone = 'blue' }: { icon: Parameters<typeof NavigationIcon>[0]['kind']; label: string; value: string; helper: string; tone?: string }) {
  return <article className="fleet-metric-card analytics-metric"><span className={`fleet-metric-icon is-${tone}`}><NavigationIcon kind={icon} /></span><div><span>{label}</span><strong>{value}</strong></div><small>{helper}</small></article>;
}

function EmptyChart({ title, message }: { title: string; message: string }) {
  return <div className="fleet-empty-state"><strong>{title}</strong><p>{message}</p></div>;
}

export function TelemetryDashboard() {
  const [period, setPeriod] = useState<TelemetryPeriod>('month');
  const [dataset, setDataset] = useState<TelemetryDataset>('production');
  const [branch, setBranch] = useState<TelemetryBranch>('all');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [autoSelectedPoc, setAutoSelectedPoc] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_reporting', {
      p_period: period,
      p_branch: branch,
      p_dataset: dataset,
    });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const next = normaliseDashboard(data);
    setDashboard(next);
    setLastUpdated(new Date());
    setLoading(false);

    if (
      dataset === 'production' &&
      !autoSelectedPoc &&
      next.availability.production_rows === 0 &&
      next.availability.active_simulation_devices > 0
    ) {
      setAutoSelectedPoc(true);
      setDataset('simulation');
    }
  }, [autoSelectedPoc, branch, dataset, period]);

  useEffect(() => {
    loadDashboard().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry reporting.');
      setLoading(false);
    });
  }, [loadDashboard]);

  const dailyChart = useMemo<InteractiveChartDatum[]>(() => {
    const rows = dashboard?.daily_trend ?? [];
    if (period === 'six_months') return sixMonthTrend(rows);
    return rows.map((row) => ({
      key: row.date,
      label: shortDate(row.date),
      value: row.units_sold,
      secondaryLabel: 'Failed vends',
      secondaryValue: row.failed_vends,
      detail: `Revenue ${money(row.revenue_cents)}`,
    }));
  }, [dashboard?.daily_trend, period]);

  const branchChart: InteractiveChartDatum[] = (dashboard?.by_branch ?? []).map((row) => ({
    key: row.branch,
    label: row.branch.toUpperCase(),
    value: row.units_sold,
    secondaryLabel: 'Failed vends',
    secondaryValue: row.failed_vends,
    detail: `Revenue ${money(row.revenue_cents)}`,
  }));
  const itemChart: InteractiveChartDatum[] = (dashboard?.top_items ?? []).slice(0, 8).map((row) => ({
    key: row.product_key,
    label: row.product_name ?? row.sku ?? row.product_key,
    value: row.units_sold,
    secondaryLabel: 'Failed vends',
    secondaryValue: row.failed_vends,
    detail: `${row.brand ?? 'Brand not recorded'} · Revenue ${money(row.revenue_cents)}`,
  }));
  const machineChart: InteractiveChartDatum[] = (dashboard?.top_machines ?? []).slice(0, 8).map((row, index) => ({
    key: row.machine_id ?? `${row.serial_number ?? row.machine_name ?? 'machine'}-${index}`,
    label: row.machine_name ?? row.serial_number ?? 'Unassigned',
    value: row.units_sold,
    secondaryLabel: 'Failed vends',
    secondaryValue: row.failed_vends,
    detail: `${row.location ?? 'Location not recorded'} · Revenue ${money(row.revenue_cents)}`,
  }));
  const summary = dashboard?.summary;

  function exportReport() {
    if (!dashboard) return;
    const header = ['Date', 'Machine', 'Serial', 'Location', 'Item', 'Units sold', 'Failed vends', 'Revenue'];
    const rows = dashboard.recent_sales.map((row) => [row.sales_date, row.machine_name ?? '', row.serial_number ?? '', row.location ?? '', row.product_name ?? row.sku ?? row.selection_code, row.units_sold, row.failed_vends, money(row.revenue_cents)]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dallmayr-telemetry-${dashboard.date_from}-${dashboard.date_to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="fleet-route-page telemetry-analytics-workspace">
      <header className="fleet-page-heading"><div><h1>Telemetry analytics</h1><p>Sales, reliability and connectivity trends across the fleet.</p></div><button className="fleet-button secondary" disabled={!dashboard} onClick={exportReport} type="button"><NavigationIcon kind="chart" />Export report</button></header>

      <div className="analytics-filter-bar"><label><span>Date range</span><select value={period} onChange={(event) => setPeriod(event.target.value as TelemetryPeriod)}>{(Object.keys(periodLabels) as TelemetryPeriod[]).map((value) => <option key={value} value={value}>{periodLabels[value]}</option>)}</select></label><label><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value as TelemetryBranch)}>{(Object.keys(branchLabels) as TelemetryBranch[]).map((value) => <option key={value} value={value}>{branchLabels[value]}</option>)}</select></label><label><span>Dataset</span><select value={dataset} onChange={(event) => { setAutoSelectedPoc(true); setDataset(event.target.value as TelemetryDataset); }}>{(Object.keys(datasetLabels) as TelemetryDataset[]).map((value) => <option key={value} value={value}>{datasetLabels[value]}</option>)}</select></label><button className="fleet-button secondary" disabled={loading} onClick={() => loadDashboard()} type="button">{loading ? 'Refreshing…' : 'Refresh data'}</button><span className="analytics-updated">Updated {lastUpdated ? dateTime(lastUpdated.toISOString()) : 'never'}</span></div>

      {error ? <div className="error">{error}</div> : null}
      {dataset === 'simulation' ? <div className="success">POC simulation history is stored separately and never contributes to production telemetry totals.</div> : null}
      {loading && !dashboard ? <div className="fleet-panel"><HamsterLoader label="Loading telemetry dashboard" /></div> : null}

      {dashboard ? (
        <>
          <section className="fleet-metric-grid analytics-metric-grid"><AnalyticsMetric helper={`${dashboard.date_from} to ${dashboard.date_to}`} icon="sales" label="Items sold" value={(summary?.units_sold ?? 0).toLocaleString('en-ZA')} /><AnalyticsMetric helper={`${summary?.online_devices ?? 0} devices online`} icon="telemetry" label="Fleet availability" tone="green" value={`${((summary?.online_devices ?? 0) / Math.max(summary?.reporting_devices ?? 0, 1) * 100).toFixed(1)}%`} /><AnalyticsMetric helper="Failed items as a share of sales" icon="bell" label="Failed vend rate" tone="red" value={`${((summary?.failed_vends ?? 0) / Math.max(summary?.units_sold ?? 0, 1) * 100).toFixed(1)}%`} /><AnalyticsMetric helper="Machines sending counters" icon="tool" label="Machines reporting" tone="amber" value={(summary?.active_machines ?? 0).toLocaleString('en-ZA')} /><AnalyticsMetric helper={`${summary?.unassigned_devices ?? 0} unassigned devices`} icon="clipboard" label="Reporting compliance" tone="blue" value={`${((summary?.reporting_devices ?? 0) / Math.max((summary?.reporting_devices ?? 0) + (summary?.unassigned_devices ?? 0), 1) * 100).toFixed(0)}%`} /></section>

          <section className="analytics-chart-grid">
            <article className="fleet-panel analytics-sales-trend"><header><div><span>Sales trend</span><h2>Items sold</h2></div><strong>{(summary?.units_sold ?? 0).toLocaleString('en-ZA')}</strong></header>{dailyChart.length ? <InteractiveLineChart ariaLabel="Interactive items sold over time" data={dailyChart} valueLabel="items sold" /> : <EmptyChart title="No trend data" message="Sales history will appear after telemetry counters are received." />}</article>
            <article className="fleet-panel analytics-branch-chart"><header><div><span>Branch performance</span><h2>Items sold by branch</h2></div></header>{branchChart.length ? <InteractiveHorizontalBars ariaLabel="Interactive items sold by branch" data={branchChart} valueLabel="items sold" /> : <EmptyChart title="No branch comparison data" message="Branch results will appear when telemetry has been processed." />}</article>
            <article className="fleet-panel analytics-top-items"><header><div><span>Product mix</span><h2>Top items</h2></div></header>{itemChart.length ? <InteractiveHorizontalBars ariaLabel="Interactive top items" data={itemChart} valueLabel="items sold" /> : <EmptyChart title="No product comparison data" message="Item results will appear when telemetry has been processed." />}</article>
            <article className="fleet-panel analytics-top-machines"><header><div><span>Machine performance</span><h2>Top machines</h2></div></header>{machineChart.length ? <InteractiveHorizontalBars ariaLabel="Interactive top machines" data={machineChart} valueLabel="items sold" /> : <EmptyChart title="No machine comparison data" message="Machine results will appear when telemetry has been processed." />}</article>
            <article className="fleet-panel analytics-connectivity"><header><div><span>Device health</span><h2>Connectivity distribution</h2></div></header><InteractiveDonutChart ariaLabel="Interactive device connectivity distribution" data={[{ key: 'online', label: 'Online', value: summary?.online_devices ?? 0, detail: 'Devices currently reporting within the online threshold.' }, { key: 'offline', label: 'Offline', value: summary?.offline_devices ?? 0, detail: 'Devices outside the online reporting threshold.' }]} valueLabel="devices" /></article>
          </section>

          <section className="fleet-panel analytics-machine-table"><header><div><span>Attention list</span><h2>Machines with failed vends</h2></div><span>{dashboard.top_machines.filter((row) => row.failed_vends > 0).length} machines</span></header><div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Status</th><th>Machine</th><th>Serial</th><th>Location</th><th>Branch</th><th>Items sold</th><th>Failed vends</th><th>Failure rate</th></tr></thead><tbody>{[...dashboard.top_machines].sort((left, right) => (right.failed_vends / Math.max(right.units_sold, 1)) - (left.failed_vends / Math.max(left.units_sold, 1))).slice(0, 25).map((row) => <tr key={row.machine_id ?? `${row.machine_name}-${row.serial_number}`}><td><span className={`fleet-status-pill ${row.failed_vends ? 'is-danger' : 'is-success'}`}><i />{row.failed_vends ? 'Attention' : 'Healthy'}</span></td><td><strong>{row.machine_name ?? 'Unnamed machine'}</strong></td><td>{row.serial_number ?? 'Not recorded'}</td><td>{row.location ?? 'Not recorded'}</td><td>{row.branch.toUpperCase()}</td><td>{row.units_sold.toLocaleString('en-ZA')}</td><td>{row.failed_vends.toLocaleString('en-ZA')}</td><td>{((row.failed_vends / Math.max(row.units_sold, 1)) * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></section>
        </>
      ) : null}
    </section>
  );
}
