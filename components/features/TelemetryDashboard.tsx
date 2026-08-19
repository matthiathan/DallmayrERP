'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChart, DonutChart } from '@/components/ui/MiniCharts';
import { PageToolbar } from '@/components/ui/PageToolbar';
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
    day: '2-digit', month: 'short',
  });
}

function dateTime(value: string) {
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
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

function sixMonthTrend(rows: DailyTrend[]) {
  const buckets = new Map<string, number>();
  rows.forEach((row) => {
    const key = row.date.slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + row.units_sold);
  });
  return Array.from(buckets.entries()).map(([month, value]) => ({
    label: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }),
    value,
  }));
}

export function TelemetryDashboard() {
  const [period, setPeriod] = useState<TelemetryPeriod>('day');
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

  const recentColumns = useMemo<EnterpriseColumn<RecentSale>[]>(() => [
    { id: 'sales_date', header: 'Date', value: (row) => row.sales_date, render: (row) => shortDate(row.sales_date), sortable: true, defaultWidth: 110, mobilePriority: 2 },
    { id: 'machine_name', header: 'Machine', value: (row) => row.machine_name ?? row.serial_number ?? 'Unassigned', sortable: true, filterable: true, defaultWidth: 190, mobileTitle: true },
    { id: 'serial_number', header: 'S/N', value: (row) => row.serial_number ?? '', sortable: true, filterable: true, defaultWidth: 150, mobilePriority: 1 },
    { id: 'location', header: 'Location', value: (row) => row.location ?? '', sortable: true, filterable: true, defaultWidth: 220, mobilePriority: 3 },
    { id: 'product_name', header: 'Item', value: (row) => row.product_name ?? row.sku ?? row.selection_code, sortable: true, filterable: true, defaultWidth: 190, mobilePriority: 1 },
    { id: 'brand', header: 'Source/brand', value: (row) => row.brand ?? '', sortable: true, filterable: true, defaultWidth: 140, mobileHidden: true },
    { id: 'units_sold', header: 'Sold', value: (row) => row.units_sold, sortable: true, defaultWidth: 90, mobilePriority: 1 },
    { id: 'failed_vends', header: 'Failed', value: (row) => row.failed_vends, sortable: true, defaultWidth: 90, mobileHidden: true },
    { id: 'revenue_cents', header: 'Revenue', value: (row) => row.revenue_cents, render: (row) => money(row.revenue_cents), sortable: true, defaultWidth: 130, mobilePriority: 2 },
    { id: 'last_received_at', header: 'Last update', value: (row) => row.last_received_at, render: (row) => dateTime(row.last_received_at), sortable: true, defaultWidth: 170, mobileHidden: true },
  ], []);

  const dailyChart = useMemo(() => {
    const rows = dashboard?.daily_trend ?? [];
    if (period === 'six_months') return sixMonthTrend(rows);
    return rows.map((row) => ({ label: shortDate(row.date), value: row.units_sold }));
  }, [dashboard?.daily_trend, period]);

  const branchChart = (dashboard?.by_branch ?? []).map((row) => ({ label: row.branch.toUpperCase(), value: row.units_sold }));
  const itemChart = (dashboard?.top_items ?? []).map((row) => ({ label: row.product_name ?? row.sku ?? row.product_key, value: row.units_sold }));
  const machineChart = (dashboard?.top_machines ?? []).map((row) => ({ label: row.machine_name ?? row.serial_number ?? 'Unassigned', value: row.units_sold }));
  const summary = dashboard?.summary;

  return (
    <div className="grid spatial-stage spatial-dashboard">
      <PageToolbar
        title="Telemetry reporting"
        description="Review isolated production or POC telemetry over 1 day, 7 days, 30 days or 6 months. Counter snapshots are converted into daily deltas instead of storing every vend as a separate row."
        lastUpdated={lastUpdated}
        actions={<button className="button secondary" disabled={loading} onClick={() => loadDashboard()} type="button">Refresh</button>}
      >
        <label>
          <span>Period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value as TelemetryPeriod)}>
            {(Object.keys(periodLabels) as TelemetryPeriod[]).map((value) => <option key={value} value={value}>{periodLabels[value]}</option>)}
          </select>
        </label>
        <label>
          <span>Dataset</span>
          <select value={dataset} onChange={(event) => { setAutoSelectedPoc(true); setDataset(event.target.value as TelemetryDataset); }}>
            {(Object.keys(datasetLabels) as TelemetryDataset[]).map((value) => <option key={value} value={value}>{datasetLabels[value]}</option>)}
          </select>
        </label>
        <label>
          <span>Branch</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value as TelemetryBranch)}>
            {(Object.keys(branchLabels) as TelemetryBranch[]).map((value) => <option key={value} value={value}>{branchLabels[value]}</option>)}
          </select>
        </label>
      </PageToolbar>

      {error ? <div className="error">{error}</div> : null}
      {dataset === 'simulation' ? (
        <div className="success">POC simulation history is stored separately and never contributes to production telemetry totals.</div>
      ) : null}
      {loading && !dashboard ? <div className="neo-card spatial-card"><HamsterLoader label="Loading telemetry dashboard" /></div> : null}

      {dashboard ? (
        <>
          {dashboard.recent_sales.length === 0 ? (
            <div className="neo-card spatial-card">
              <strong>No {datasetLabels[dataset].toLowerCase()} history is recorded for this period yet.</strong>
              <p className="muted">
                {dataset === 'simulation'
                  ? 'The current POC counters will start building daily history as new cumulative snapshots arrive.'
                  : 'Production history begins when a machine interface starts providing real cumulative counter snapshots.'}
              </p>
            </div>
          ) : null}

          <div className="grid grid-3 spatial-kpi-grid">
            <KpiCard label="Items sold" value={summary?.units_sold ?? 0} helper={`${dashboard.date_from} to ${dashboard.date_to}`} />
            <KpiCard label="Revenue" value={money(summary?.revenue_cents ?? 0)} helper={periodLabels[period]} />
            <KpiCard label="Failed vends" value={summary?.failed_vends ?? 0} helper="Reported machine failures" />
            <KpiCard label="Selling machines" value={summary?.active_machines ?? 0} helper="Machines with data in period" />
            <KpiCard label="Online devices" value={summary?.online_devices ?? 0} helper="Seen within 30 minutes" />
            <KpiCard label="Offline devices" value={summary?.offline_devices ?? 0} helper="No recent device contact" />
            <KpiCard label="Registered devices" value={summary?.reporting_devices ?? 0} helper="Active telemetry devices" />
            <KpiCard label="Unassigned devices" value={summary?.unassigned_devices ?? 0} helper="Needs machine assignment" />
          </div>

          <div className="grid grid-2">
            <BarChart title={period === 'six_months' ? 'Monthly units sold' : 'Daily units sold'} data={dailyChart} />
            <BarChart title="Units sold by branch" data={branchChart} />
            <BarChart title="Top items" data={itemChart} />
            <BarChart title="Top machines" data={machineChart} />
            <DonutChart title="Device connectivity" data={[
              { label: 'Online', value: summary?.online_devices ?? 0 },
              { label: 'Offline', value: summary?.offline_devices ?? 0 },
            ]} />
            <DonutChart title="Vend outcomes" data={[
              { label: 'Successful', value: summary?.units_sold ?? 0 },
              { label: 'Failed', value: summary?.failed_vends ?? 0 },
            ]} />
          </div>

          <div className="neo-card spatial-card">
            <h2>Machine and item detail</h2>
            <p>One row represents the aggregated total for a machine, item and day—not an individual sale.</p>
            <EnterpriseDataTable
              rows={dashboard.recent_sales}
              columns={recentColumns}
              rowKey={(row) => row.id}
              searchPlaceholder="Search machine, serial number, location, item or brand"
              emptyMessage="No telemetry data was recorded for this period."
              defaultPageSize={50}
              pageSizeOptions={[25, 50, 100, 250]}
              tableId="telemetry-sales"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
