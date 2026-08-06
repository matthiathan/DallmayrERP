'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { BarChart, DonutChart } from '@/components/ui/MiniCharts';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { getSupabaseClient } from '@/lib/supabase/client';

type TelemetryPeriod = 'today' | 'week' | 'month' | 'six_months';
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
  serial_number: string;
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
  serial_number: string;
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
  date_from: string;
  date_to: string;
  summary: Summary;
  daily_trend: DailyTrend[];
  by_branch: BranchTotal[];
  top_items: TopItem[];
  top_machines: TopMachine[];
  recent_sales: RecentSale[];
};

const periodLabels: Record<TelemetryPeriod, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Current month',
  six_months: 'Last 6 months',
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
  return {
    period: source.period ?? 'today',
    date_from: source.date_from ?? new Date().toISOString().slice(0, 10),
    date_to: source.date_to ?? new Date().toISOString().slice(0, 10),
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

export function TelemetryDashboard() {
  const [period, setPeriod] = useState<TelemetryPeriod>('today');
  const [branch, setBranch] = useState<TelemetryBranch>('all');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient().rpc('get_telemetry_dashboard', {
      p_period: period,
      p_branch: branch,
    });

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    setDashboard(normaliseDashboard(data));
    setLastUpdated(new Date());
    setLoading(false);
  }, [branch, period]);

  useEffect(() => {
    loadDashboard().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry reporting.');
      setLoading(false);
    });
  }, [loadDashboard]);

  const recentColumns = useMemo<EnterpriseColumn<RecentSale>[]>(() => [
    { id: 'sales_date', header: 'Date', value: (row) => row.sales_date, render: (row) => shortDate(row.sales_date), sortable: true, defaultWidth: 110, mobilePriority: 2 },
    { id: 'machine_name', header: 'Machine', value: (row) => row.machine_name ?? row.serial_number, sortable: true, filterable: true, defaultWidth: 190, mobileTitle: true },
    { id: 'serial_number', header: 'S/N', value: (row) => row.serial_number, sortable: true, filterable: true, defaultWidth: 150, mobilePriority: 1 },
    { id: 'location', header: 'Location', value: (row) => row.location ?? '', sortable: true, filterable: true, defaultWidth: 220, mobilePriority: 3 },
    { id: 'product_name', header: 'Item', value: (row) => row.product_name ?? row.sku ?? row.selection_code, sortable: true, filterable: true, defaultWidth: 190, mobilePriority: 1 },
    { id: 'brand', header: 'Brand', value: (row) => row.brand ?? '', sortable: true, filterable: true, defaultWidth: 130, mobileHidden: true },
    { id: 'units_sold', header: 'Sold', value: (row) => row.units_sold, sortable: true, defaultWidth: 90, mobilePriority: 1 },
    { id: 'failed_vends', header: 'Failed', value: (row) => row.failed_vends, sortable: true, defaultWidth: 90, mobileHidden: true },
    { id: 'revenue_cents', header: 'Revenue', value: (row) => row.revenue_cents, render: (row) => money(row.revenue_cents), sortable: true, defaultWidth: 130, mobilePriority: 2 },
    { id: 'last_received_at', header: 'Last update', value: (row) => row.last_received_at, render: (row) => dateTime(row.last_received_at), sortable: true, defaultWidth: 170, mobileHidden: true },
  ], []);

  const dailyChart = (dashboard?.daily_trend ?? []).slice(-14).map((row) => ({
    label: shortDate(row.date),
    value: row.units_sold,
  }));
  const branchChart = (dashboard?.by_branch ?? []).map((row) => ({
    label: row.branch.toUpperCase(),
    value: row.units_sold,
  }));
  const itemChart = (dashboard?.top_items ?? []).map((row) => ({
    label: row.product_name ?? row.sku ?? row.product_key,
    value: row.units_sold,
  }));
  const machineChart = (dashboard?.top_machines ?? []).map((row) => ({
    label: row.machine_name ?? row.serial_number,
    value: row.units_sold,
  }));
  const summary = dashboard?.summary;

  return (
    <div className="grid spatial-stage spatial-dashboard">
      <PageToolbar
        title="Telemetry reporting"
        description="Daily, weekly, monthly and six-month machine sales from aggregated counter snapshots."
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
          <span>Branch</span>
          <select value={branch} onChange={(event) => setBranch(event.target.value as TelemetryBranch)}>
            {(Object.keys(branchLabels) as TelemetryBranch[]).map((value) => <option key={value} value={value}>{branchLabels[value]}</option>)}
          </select>
        </label>
      </PageToolbar>

      {error ? <div className="error">{error}</div> : null}
      {loading && !dashboard ? <div className="neo-card spatial-card"><HamsterLoader label="Loading telemetry dashboard" /></div> : null}

      {dashboard ? (
        <>
          <div className="grid grid-3 spatial-kpi-grid">
            <KpiCard label="Items sold" value={summary?.units_sold ?? 0} helper={`${dashboard.date_from} to ${dashboard.date_to}`} />
            <KpiCard label="Revenue" value={money(summary?.revenue_cents ?? 0)} helper={periodLabels[period]} />
            <KpiCard label="Failed vends" value={summary?.failed_vends ?? 0} helper="Reported machine failures" />
            <KpiCard label="Selling machines" value={summary?.active_machines ?? 0} helper="Machines with sales in period" />
            <KpiCard label="Online devices" value={summary?.online_devices ?? 0} helper="Seen within 30 minutes" />
            <KpiCard label="Offline devices" value={summary?.offline_devices ?? 0} helper="No recent heartbeat" />
            <KpiCard label="Registered devices" value={summary?.reporting_devices ?? 0} helper="Active telemetry devices" />
            <KpiCard label="Unassigned devices" value={summary?.unassigned_devices ?? 0} helper="Needs machine assignment" />
          </div>

          <div className="grid grid-2">
            <BarChart title="Recent daily units sold" data={dailyChart} />
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
              emptyMessage="No telemetry sales were recorded for this period."
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
