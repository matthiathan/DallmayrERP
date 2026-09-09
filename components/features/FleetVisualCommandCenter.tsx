'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import {
  InteractiveDonutChart,
  InteractiveHorizontalBars,
  InteractiveLineChart,
  type InteractiveChartDatum,
  type InteractiveDonutDatum,
} from '@/components/ui/InteractiveCharts';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './FleetVisualCommandCenter.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';
type DeviceState = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  telemetry_mode: 'live' | 'daily' | 'monthly';
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  machine_status: string;
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
};

type FaultRecord = {
  id: string;
  machine_id: string | null;
  fault_code: string;
  severity: string;
  detail: string | null;
  last_seen_at: string;
};

type TrendRecord = {
  date: string;
  units_sold: number;
  failed_vends: number;
};

type BranchRecord = {
  branch: string;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
};

type ItemRecord = {
  product_key: string;
  sku: string | null;
  product_name: string | null;
  brand: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
};

type MachineRecord = {
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  location: string | null;
  branch: string;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
};

type RecentSale = {
  id: string;
  sales_date: string;
  machine_name: string | null;
  serial_number: string | null;
  location: string | null;
  branch: string;
  selection_code: string;
  sku: string | null;
  product_name: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
  last_received_at: string;
};

type DashboardPayload = {
  device_states?: DeviceState[];
  active_faults?: FaultRecord[];
};

type ReportingPayload = {
  date_from?: string;
  date_to?: string;
  summary?: {
    units_sold?: number;
    revenue_cents?: number;
    failed_vends?: number;
    active_machines?: number;
    reporting_devices?: number;
    online_devices?: number;
    offline_devices?: number;
    unassigned_devices?: number;
  };
  daily_trend?: TrendRecord[];
  by_branch?: BranchRecord[];
  top_items?: ItemRecord[];
  top_machines?: MachineRecord[];
  recent_sales?: RecentSale[];
};

type CommandData = {
  dashboard: DashboardPayload;
  reporting: ReportingPayload;
};

const periods: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'six_months', label: '6 months' },
];

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n(cents) / 100);
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

function timeAgo(value: string | null) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function connectionState(device: DeviceState) {
  const last = device.last_heartbeat_at ?? device.last_seen_at;
  if (!last) return 'never';
  const age = Date.now() - new Date(last).getTime();
  if (age <= 30 * 60 * 1000) return 'online';
  if (age <= 24 * 60 * 60 * 1000) return 'delayed';
  return 'offline';
}

function severityTone(value: string) {
  const severity = value.toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'warning' || severity === 'medium') return 'warning';
  if (severity === 'connectivity') return 'connectivity';
  return 'fault';
}

function Kpi({
  label,
  value,
  meta,
  icon,
  tone = 'blue',
  hero = false,
}: {
  label: string;
  value: string;
  meta: string;
  icon: Parameters<typeof NavigationIcon>[0]['kind'];
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet';
  hero?: boolean;
}) {
  return (
    <article className={`${styles.kpi} ${styles[`tone_${tone}`]} ${hero ? styles.kpiHero : ''}`}>
      <div className={styles.kpiTop}><span>{label}</span><i><NavigationIcon kind={icon} /></i></div>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function SignalMeter({ label, value, detail, kind }: { label: string; value: number | null; detail: string; kind: 'wifi' | 'cellular' }) {
  const percent = value === null ? 0 : kind === 'wifi'
    ? Math.max(0, Math.min(100, ((value + 100) / 50) * 100))
    : Math.max(0, Math.min(100, (value / 31) * 100));
  return (
    <div className={styles.signalMeter}>
      <div><span>{label}</span><strong>{value === null ? 'No data' : kind === 'wifi' ? `${Math.round(value)} dBm` : `${value.toFixed(1)} CSQ`}</strong></div>
      <div className={styles.signalTrack}><i style={{ width: `${percent}%` }} /></div>
      <small>{detail}</small>
    </div>
  );
}

export function FleetVisualCommandCenter() {
  const { authUser } = useAuth();
  const firstName = typeof authUser?.user_metadata?.full_name === 'string'
    ? authUser.user_metadata.full_name.trim().split(/\s+/)[0]
    : authUser?.email?.split('@')[0] ?? 'there';
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<CommandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const [dashboardResult, reportingResult] = await Promise.all([
      client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
      client.rpc('get_telemetry_reporting', { p_period: period, p_branch: 'all', p_dataset: 'production' }),
    ]);

    if (dashboardResult.error || reportingResult.error) {
      setError(dashboardResult.error?.message ?? reportingResult.error?.message ?? 'Could not load fleet telemetry.');
    }

    setData({
      dashboard: (dashboardResult.data ?? {}) as DashboardPayload,
      reporting: (reportingResult.data ?? {}) as ReportingPayload,
    });
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [period]);

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load fleet telemetry.');
      setLoading(false);
      setRefreshing(false);
    });
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const reporting = data?.reporting;
  const summary = reporting?.summary ?? {};
  const devices = data?.dashboard.device_states ?? [];
  const faults = data?.dashboard.active_faults ?? [];
  const units = n(summary.units_sold);
  const failed = n(summary.failed_vends);
  const attempts = units + failed;
  const successRate = attempts ? (units / attempts) * 100 : 100;
  const reportingDevices = n(summary.reporting_devices) || devices.length;
  const online = n(summary.online_devices) || devices.filter((device) => connectionState(device) === 'online').length;
  const offline = n(summary.offline_devices) || devices.filter((device) => connectionState(device) === 'offline').length;
  const delayed = devices.filter((device) => connectionState(device) === 'delayed').length;
  const unassigned = n(summary.unassigned_devices) || devices.filter((device) => !device.machine_id).length;
  const availability = reportingDevices ? (online / reportingDevices) * 100 : 0;

  const trendData = useMemo<InteractiveChartDatum[]>(() => (reporting?.daily_trend ?? []).map((row) => ({
    key: row.date,
    label: shortDate(row.date),
    value: n(row.units_sold),
    secondaryLabel: 'Failed vends',
    secondaryValue: n(row.failed_vends),
  })), [reporting?.daily_trend]);

  const productData = useMemo<InteractiveChartDatum[]>(() => (reporting?.top_items ?? []).slice(0, 7).map((row) => ({
    key: row.product_key,
    label: row.product_name ?? row.sku ?? row.product_key,
    value: n(row.units_sold),
    secondaryLabel: 'Failed vends',
    secondaryValue: n(row.failed_vends),
    detail: `${row.brand ?? 'Brand not recorded'} · ${money(n(row.revenue_cents))}`,
  })), [reporting?.top_items]);

  const machineData = useMemo<InteractiveChartDatum[]>(() => (reporting?.top_machines ?? []).slice(0, 7).map((row, index) => ({
    key: row.machine_id ?? `${row.machine_name}-${index}`,
    label: row.machine_name ?? row.serial_number ?? 'Unnamed machine',
    value: n(row.units_sold),
    secondaryLabel: 'Failed vends',
    secondaryValue: n(row.failed_vends),
    detail: `${row.location ?? row.branch.toUpperCase()} · ${money(n(row.revenue_cents))}`,
  })), [reporting?.top_machines]);

  const branchData = useMemo<InteractiveChartDatum[]>(() => (reporting?.by_branch ?? []).map((row) => ({
    key: row.branch,
    label: row.branch.toUpperCase(),
    value: n(row.units_sold),
    secondaryLabel: 'Failed vends',
    secondaryValue: n(row.failed_vends),
    detail: money(n(row.revenue_cents)),
  })), [reporting?.by_branch]);

  const connectionData: InteractiveDonutDatum[] = [
    { key: 'online', label: 'Online', value: online, detail: 'Heartbeat received within 30 minutes' },
    { key: 'delayed', label: 'Delayed', value: delayed, detail: 'Last heartbeat is between 30 minutes and 24 hours old' },
    { key: 'offline', label: 'Offline', value: offline, detail: 'No heartbeat for more than 24 hours' },
    { key: 'unassigned', label: 'Unassigned', value: unassigned, detail: 'Telemetry device not linked to a machine' },
  ].filter((row) => row.value > 0);

  const transportCounts = devices.reduce((counts, device) => {
    const key = device.last_transport ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const transportData: InteractiveDonutDatum[] = [
    { key: 'wifi', label: 'Wi‑Fi', value: transportCounts.wifi ?? 0 },
    { key: 'cellular', label: 'Cellular', value: transportCounts.cellular ?? 0 },
    { key: 'unknown', label: 'Not reported', value: transportCounts.unknown ?? 0 },
  ].filter((row) => row.value > 0);

  const modeCounts = devices.reduce((counts, device) => {
    counts[device.telemetry_mode] = (counts[device.telemetry_mode] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const modeData: InteractiveDonutDatum[] = [
    { key: 'live', label: 'Live', value: modeCounts.live ?? 0 },
    { key: 'daily', label: 'Daily', value: modeCounts.daily ?? 0 },
    { key: 'monthly', label: 'Monthly', value: modeCounts.monthly ?? 0 },
  ].filter((row) => row.value > 0);

  const severityCounts = faults.reduce((counts, fault) => {
    const tone = severityTone(fault.severity);
    counts[tone] = (counts[tone] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const faultData: InteractiveChartDatum[] = [
    { key: 'critical', label: 'Critical', value: severityCounts.critical ?? 0 },
    { key: 'fault', label: 'Fault', value: severityCounts.fault ?? 0 },
    { key: 'warning', label: 'Warning', value: severityCounts.warning ?? 0 },
    { key: 'connectivity', label: 'Connectivity', value: severityCounts.connectivity ?? 0 },
  ].filter((row) => row.value > 0);

  const wifiValues = devices.map((device) => device.wifi_rssi).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const cellularValues = devices.map((device) => device.cellular_csq).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgWifi = wifiValues.length ? wifiValues.reduce((sum, value) => sum + value, 0) / wifiValues.length : null;
  const avgCell = cellularValues.length ? cellularValues.reduce((sum, value) => sum + value, 0) / cellularValues.length : null;

  const recentSales = reporting?.recent_sales ?? [];
  const periodLabel = periods.find((item) => item.value === period)?.label ?? period;

  return (
    <section className={styles.commandCenter}>
      <header className={styles.heroHeader}>
        <div>
          <div className={styles.eyebrow}><i />LIVE FLEET CONTROL</div>
          <h1>{firstName}, here is the fleet right now.</h1>
          <p>Sales, machine health, connectivity and telemetry in one operational view.</p>
        </div>
        <div className={styles.headerActions}>
          <label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button disabled={refreshing} onClick={() => load(true)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading && !data ? <HamsterLoader label="Loading fleet command center" /> : null}

      {data ? (
        <>
          <section aria-label="Fleet headline metrics" className={styles.kpiGrid}>
            <Kpi hero icon="sales" label="Items sold" meta={periodLabel} tone="blue" value={units.toLocaleString('en-ZA')} />
            <Kpi hero icon="finance" label="Revenue" meta={`${failed.toLocaleString('en-ZA')} failed vends`} tone="violet" value={money(n(summary.revenue_cents))} />
            <Kpi icon="telemetry" label="Fleet availability" meta={`${online} online · ${delayed} delayed`} tone="green" value={`${availability.toFixed(1)}%`} />
            <Kpi icon="chart" label="Vend success" meta={`${attempts.toLocaleString('en-ZA')} total attempts`} tone={successRate >= 98 ? 'green' : successRate >= 95 ? 'amber' : 'red'} value={`${successRate.toFixed(1)}%`} />
            <Kpi icon="bell" label="Active faults" meta={`${faults.length} unresolved`} tone={faults.length ? 'red' : 'green'} value={faults.length.toLocaleString('en-ZA')} />
            <Kpi icon="tool" label="Machines reporting" meta={`${reportingDevices} telemetry devices`} tone="amber" value={n(summary.active_machines).toLocaleString('en-ZA')} />
          </section>

          <section className={styles.mainVisualGrid}>
            <article className={`${styles.visualCard} ${styles.trendCard}`}>
              <header><div><span>Sales velocity</span><h2>Items sold over time</h2></div><strong>{units.toLocaleString('en-ZA')}</strong></header>
              {trendData.length ? <InteractiveLineChart ariaLabel="Items sold over time" data={trendData} valueLabel="items" /> : <div className={styles.empty}>No sales trend received yet.</div>}
            </article>
            <article className={`${styles.visualCard} ${styles.healthCard}`}>
              <header><div><span>Connection health</span><h2>Fleet status</h2></div><strong>{reportingDevices}</strong></header>
              {connectionData.length ? <InteractiveDonutChart ariaLabel="Fleet connection status" data={connectionData} valueLabel="devices" /> : <div className={styles.empty}>No device state received yet.</div>}
            </article>
          </section>

          <section className={styles.visualGridThree}>
            <article className={styles.visualCard}><header><div><span>Product mix</span><h2>Top products</h2></div><Link href="/products">Products</Link></header>{productData.length ? <InteractiveHorizontalBars ariaLabel="Top products by quantity" data={productData} valueLabel="items" /> : <div className={styles.empty}>No product counters yet.</div>}</article>
            <article className={styles.visualCard}><header><div><span>Machine performance</span><h2>Top machines</h2></div><Link href="/machines">Machines</Link></header>{machineData.length ? <InteractiveHorizontalBars ariaLabel="Top machines by quantity" data={machineData} valueLabel="items" /> : <div className={styles.empty}>No machine sales yet.</div>}</article>
            <article className={styles.visualCard}><header><div><span>Branch comparison</span><h2>Items by branch</h2></div><Link href="/map">Map</Link></header>{branchData.length ? <InteractiveHorizontalBars ariaLabel="Items sold by branch" data={branchData} valueLabel="items" /> : <div className={styles.empty}>No branch totals yet.</div>}</article>
          </section>

          <section className={styles.telemetryStrip}>
            <article className={styles.visualCard}><header><div><span>Network path</span><h2>Transport mix</h2></div></header>{transportData.length ? <InteractiveDonutChart ariaLabel="Wi-Fi and cellular transport mix" data={transportData} valueLabel="devices" /> : <div className={styles.empty}>No transport data yet.</div>}</article>
            <article className={styles.visualCard}><header><div><span>Reporting cadence</span><h2>Telemetry modes</h2></div></header>{modeData.length ? <InteractiveDonutChart ariaLabel="Telemetry reporting mode mix" data={modeData} valueLabel="devices" /> : <div className={styles.empty}>No reporting mode data yet.</div>}</article>
            <article className={`${styles.visualCard} ${styles.signalCard}`}>
              <header><div><span>Radio health</span><h2>Signal quality</h2></div><strong>{devices.length} devices</strong></header>
              <SignalMeter detail={`${wifiValues.length} devices reporting Wi‑Fi RSSI`} kind="wifi" label="Average Wi‑Fi" value={avgWifi} />
              <SignalMeter detail={`${cellularValues.length} devices reporting cellular CSQ`} kind="cellular" label="Average cellular" value={avgCell} />
              <div className={styles.operatorRow}><span>Cellular operators</span><strong>{Array.from(new Set(devices.map((device) => device.cellular_operator).filter(Boolean))).join(' · ') || 'Not reported'}</strong></div>
            </article>
          </section>

          <section className={styles.bottomGrid}>
            <article className={styles.visualCard}>
              <header><div><span>Fault pressure</span><h2>Active alerts by severity</h2></div><Link href="/alerts">Open alerts</Link></header>
              {faultData.length ? <InteractiveHorizontalBars ariaLabel="Active alerts by severity" data={faultData} valueLabel="alerts" /> : <div className={styles.zeroState}><NavigationIcon kind="bell" /><strong>Clear</strong><span>No active faults reported.</span></div>}
            </article>
            <article className={`${styles.visualCard} ${styles.activityCard}`}>
              <header><div><span>Latest counters</span><h2>Recent vend activity</h2></div><Link href="/telemetry">Analytics</Link></header>
              <div className={styles.activityList}>
                {recentSales.slice(0, 7).map((sale) => (
                  <div key={sale.id} className={styles.activityRow}>
                    <i />
                    <div><strong>{sale.product_name ?? sale.sku ?? sale.selection_code}</strong><span>{sale.machine_name ?? sale.serial_number ?? sale.location ?? sale.branch.toUpperCase()}</span></div>
                    <div><strong>{n(sale.units_sold).toLocaleString('en-ZA')}</strong><span>{timeAgo(sale.last_received_at)}</span></div>
                  </div>
                ))}
                {!recentSales.length ? <div className={styles.empty}>No recent vend counters yet.</div> : null}
              </div>
            </article>
          </section>

          <footer className={styles.commandFooter}>
            <span><i /> Auto-refresh every 30 seconds</span>
            <span>Last update {lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
            <div><Link href="/machines"><NavigationIcon kind="tool" />Fleet register</Link><Link href="/telemetry/devices"><NavigationIcon kind="settings" />Devices</Link><Link href="/telemetry/test-center"><NavigationIcon kind="telemetry" />Test Center</Link></div>
          </footer>
        </>
      ) : null}
    </section>
  );
}
