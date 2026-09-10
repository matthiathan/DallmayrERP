'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { ComparisonLineChart, type ComparisonPoint } from './ComparisonLineChart';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelevendFleetDashboard.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';

type Summary = {
  units_sold?: number;
  revenue_cents?: number;
  failed_vends?: number;
  active_machines?: number;
  reporting_devices?: number;
  online_devices?: number;
  offline_devices?: number;
  unassigned_devices?: number;
};

type TrendRow = { date: string; units_sold: number; revenue_cents: number; failed_vends: number };
type ProductRow = { product_key: string; product_name: string | null; sku: string | null; brand: string | null; units_sold: number; failed_vends: number; revenue_cents: number };
type MachineRow = { machine_id: string | null; machine_name: string | null; serial_number: string | null; units_sold: number; failed_vends: number; revenue_cents: number };
type SaleRow = { id: string; product_name: string | null; sku: string | null; selection_code: string; machine_name: string | null; serial_number: string | null; branch: string; units_sold: number; last_received_at: string };

type ReportingPayload = {
  date_from?: string;
  date_to?: string;
  summary?: Summary;
  daily_trend?: TrendRow[];
  top_items?: ProductRow[];
  top_machines?: MachineRow[];
  recent_sales?: SaleRow[];
};

type DeviceState = {
  device_id: string;
  machine_id: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  telemetry_mode: 'live' | 'daily' | 'monthly';
  last_heartbeat_at: string | null;
  last_seen_at: string | null;
};

type DashboardPayload = { device_states?: DeviceState[]; active_faults?: Array<{ id: string; severity: string; fault_code: string }> };
type FaultHistoryRow = { id: string; fault_code: string; severity: string; started_at: string; cleared_at: string | null };

type UsageRow = {
  device_id: string;
  request_count: number;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  projected_monthly_application_bytes: number;
  projected_monthly_device_application_bytes: number | null;
  projected_monthly_modem_bytes: number | null;
};

type BalanceRow = { device_id: string; remaining_bytes: number | null; alert_level: string; is_stale: boolean };

type FleetLocationRow = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  active_fault_count: number;
  last_seen_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  location_stale: boolean;
  has_location: boolean;
  communication_status: string | null;
  communication_error: boolean;
  minutes_overdue: number | null;
};

type ViewData = {
  report: ReportingPayload;
  history: ReportingPayload;
  dashboard: DashboardPayload;
  faultHistory: FaultHistoryRow[];
  usage: UsageRow[];
  balances: BalanceRow[];
  locations: FleetLocationRow[];
  machineCount: number;
};

const periods: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'six_months', label: 'Last 6 months' },
];

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n(cents) / 100);
}

function bytes(value: number | null | undefined) {
  const amount = n(value);
  if (amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** unit);
  return `${scaled.toFixed(unit === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[unit]}`;
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' });
}

function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function usageValue(row: UsageRow) {
  if (n(row.modem_sample_count) > 0) return n(row.measured_modem_bytes);
  if (n(row.device_application_sample_count) > 0) return n(row.device_application_bytes);
  return n(row.application_bytes);
}

function projectedValue(row: UsageRow) {
  if (n(row.modem_sample_count) > 0) return n(row.projected_monthly_modem_bytes);
  if (n(row.device_application_sample_count) > 0) return n(row.projected_monthly_device_application_bytes);
  return n(row.projected_monthly_application_bytes);
}

function previousWindow(report: ReportingPayload, history: ReportingPayload) {
  if (!report.date_from || !report.date_to || !history.daily_trend?.length) return [] as TrendRow[];
  const from = new Date(`${report.date_from}T00:00:00`);
  const to = new Date(`${report.date_to}T00:00:00`);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  if (days > 190) return [];
  const previousEnd = new Date(from);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  const startKey = formatLocalDate(previousStart);
  const endKey = formatLocalDate(previousEnd);
  return history.daily_trend.filter((row) => row.date >= startKey && row.date <= endKey);
}

function Metric({ label, value, helper, tone }: { label: string; value: string; helper: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'gold' }) {
  const toneClass = tone === 'blue' ? styles.metricBlue : tone === 'green' ? styles.metricGreen : tone === 'amber' ? styles.metricAmber : tone === 'gold' ? styles.metricGold : styles.metricRed;
  return <article className={`${styles.metric} ${toneClass}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

function Ring({ label, value, percent, tone, legend }: { label: string; value: number; percent: number; tone: 'red' | 'green' | 'amber'; legend: string[] }) {
  const ringClass = tone === 'green' ? styles.ringGreen : tone === 'amber' ? styles.ringAmber : styles.ringRed;
  return (
    <div className={styles.ringBlock}>
      <div className={`${styles.ring} ${ringClass}`} style={{ '--ring-value': `${Math.max(2, Math.min(100, percent))}%` } as CSSProperties}>
        <div className={styles.ringCenter}><span>{label}</span><strong>{value.toLocaleString('en-ZA')}</strong></div>
      </div>
      <div className={styles.ringLegend}>{legend.map((item) => <span key={item}><i />{item}</span>)}</div>
    </div>
  );
}

function Gauge({ title, value, percent, label }: { title: string; value: string; percent: number; label: string }) {
  return (
    <article className={`${styles.card} ${styles.gaugeCard}`}>
      <div className={styles.gaugeTitle}>{title}</div>
      <div className={styles.gauge}>
        <div className={styles.gaugeFill} style={{ '--gauge-value': `${Math.max(2, Math.min(100, percent))}%` } as CSSProperties} />
        <div className={styles.gaugeValue}><strong>{value}</strong><span>{label}</span></div>
      </div>
    </article>
  );
}

export function TelevendFleetDashboard() {
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const faultFrom = new Date();
    faultFrom.setDate(faultFrom.getDate() - 30);

    const [reportResult, historyResult, dashboardResult, faultResult, usageResult, balanceResult, locationResult, machineCountResult] = await Promise.all([
      client.rpc('get_telemetry_reporting', { p_period: period, p_branch: 'all', p_dataset: 'production' }),
      client.rpc('get_telemetry_reporting', { p_period: 'six_months', p_branch: 'all', p_dataset: 'production' }),
      client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
      client.from('telemetry_fault_events').select('id,fault_code,severity,started_at,cleared_at').gte('started_at', faultFrom.toISOString()).order('started_at', { ascending: false }).limit(5000),
      client.rpc('get_telemetry_data_usage', { p_days: 30 }),
      client.rpc('get_telemetry_prepaid_balances'),
      client.rpc('get_telemetry_location_map'),
      client.from('machines').select('id', { count: 'exact', head: true }),
    ]);

    const errors = [reportResult.error, historyResult.error, dashboardResult.error].filter(Boolean);
    if (errors.length) setError(errors[0]?.message ?? 'Could not load telemetry overview.');

    setData({
      report: (reportResult.data ?? {}) as ReportingPayload,
      history: (historyResult.data ?? {}) as ReportingPayload,
      dashboard: (dashboardResult.data ?? {}) as DashboardPayload,
      faultHistory: faultResult.error ? [] : ((faultResult.data ?? []) as FaultHistoryRow[]),
      usage: usageResult.error ? [] : ((usageResult.data ?? []) as UsageRow[]),
      balances: balanceResult.error ? [] : ((balanceResult.data ?? []) as BalanceRow[]),
      locations: locationResult.error ? [] : ((locationResult.data ?? []) as FleetLocationRow[]),
      machineCount: machineCountResult.error ? 0 : (machineCountResult.count ?? 0),
    });
    setUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [period]);

  useEffect(() => { load().catch((loadError) => { setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry overview.'); setLoading(false); setRefreshing(false); }); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const report = data?.report ?? {};
  const summary = report.summary ?? {};
  const currentTrend = useMemo<ComparisonPoint[]>(() => (report.daily_trend ?? []).map((row) => ({ key: row.date, label: shortDate(row.date), value: n(row.units_sold), detail: money(n(row.revenue_cents)) })), [report.daily_trend]);
  const previousTrendRows = useMemo(() => data ? previousWindow(data.report, data.history) : [], [data]);
  const previousTrend = useMemo<ComparisonPoint[]>(() => previousTrendRows.map((row) => ({ key: row.date, label: shortDate(row.date), value: n(row.units_sold), detail: money(n(row.revenue_cents)) })), [previousTrendRows]);

  const previousUnits = previousTrendRows.reduce((sum, row) => sum + n(row.units_sold), 0);
  const units = n(summary.units_sold);
  const revenue = n(summary.revenue_cents);
  const failed = n(summary.failed_vends);
  const attempts = units + failed;
  const success = attempts ? units / attempts * 100 : 100;
  const reportingDevices = n(summary.reporting_devices);
  const online = n(summary.online_devices);
  const offline = n(summary.offline_devices);
  const availability = reportingDevices ? online / reportingDevices * 100 : 0;
  const periodChange = previousUnits > 0 ? ((units - previousUnits) / previousUnits) * 100 : 0;

  const faults = data?.faultHistory ?? [];
  const resolved = faults.filter((fault) => fault.cleared_at).length;
  const active = faults.length - resolved;
  const critical = faults.filter((fault) => !fault.cleared_at && fault.severity.toLowerCase() === 'critical').length;
  const warning = faults.filter((fault) => !fault.cleared_at && ['warning', 'medium'].includes(fault.severity.toLowerCase())).length;
  const resolvedRate = faults.length ? resolved / faults.length * 100 : 100;
  const activeRate = faults.length ? active / faults.length * 100 : 0;

  const usage = data?.usage ?? [];
  const balances = data?.balances ?? [];
  const observed = usage.reduce((sum, row) => sum + usageValue(row), 0);
  const projected = usage.reduce((sum, row) => sum + projectedValue(row), 0);
  const balanceRows = balances.filter((row) => row.remaining_bytes !== null && row.remaining_bytes !== undefined);
  const remaining = balanceRows.reduce((sum, row) => sum + n(row.remaining_bytes), 0);
  const lowBalance = balances.filter((row) => ['low', 'critical', 'depleted'].includes(row.alert_level)).length;
  const modemCoverage = usage.length ? Math.round(usage.filter((row) => n(row.modem_sample_count) > 0).length / usage.length * 100) : 0;

  const devices = data?.dashboard.device_states ?? [];
  const wifi = devices.filter((device) => device.last_transport === 'wifi').length;
  const cellular = devices.filter((device) => device.last_transport === 'cellular').length;
  const avgWifi = devices.map((device) => device.wifi_rssi).filter((value): value is number => typeof value === 'number').reduce((sum, value, _, array) => sum + value / array.length, 0);
  const avgCell = devices.map((device) => device.cellular_csq).filter((value): value is number => typeof value === 'number').reduce((sum, value, _, array) => sum + value / array.length, 0);

  const locations = data?.locations ?? [];
  const machineCount = data?.machineCount ?? 0;
  const assignedDevices = locations.filter((row) => Boolean(row.machine_id)).length;
  const mappedDevices = locations.filter((row) => row.has_location && typeof row.latitude === 'number' && typeof row.longitude === 'number').length;
  const staleLocations = locations.filter((row) => row.has_location && row.location_stale).length;
  const communicationErrors = locations.filter((row) => row.communication_error).length;
  const unknownNetwork = Math.max(0, devices.length - wifi - cellular);
  const assignmentCoverage = machineCount ? Math.min(100, assignedDevices / machineCount * 100) : 0;
  const locationCoverage = reportingDevices ? Math.min(100, mappedDevices / reportingDevices * 100) : 0;
  const networkCoverage = devices.length ? Math.min(100, (wifi + cellular) / devices.length * 100) : 0;
  const communicationHealth = locations.length ? Math.max(0, 100 - communicationErrors / locations.length * 100) : 0;

  const topProducts = report.top_items ?? [];
  const recentSales = report.recent_sales ?? [];

  const exportFleetSnapshot = () => {
    if (!locations.length) return;
    const usageByDevice = new Map(usage.map((row) => [row.device_id, row]));
    const balanceByDevice = new Map(balances.map((row) => [row.device_id, row]));
    const headers = [
      'Device', 'Machine', 'Serial', 'Branch', 'Communication', 'Minutes overdue', 'Transport',
      'Latitude', 'Longitude', 'Location source', 'Location stale', 'Active faults',
      '30-day data bytes', 'Prepaid remaining bytes', 'Last seen',
    ];
    const body = locations.map((row) => {
      const usageRow = usageByDevice.get(row.device_id);
      const balance = balanceByDevice.get(row.device_id);
      return [
        row.device_code,
        row.machine_name ?? '',
        row.serial_number ?? '',
        row.branch,
        row.communication_status ?? (row.communication_error ? 'offline' : ''),
        row.minutes_overdue ?? '',
        row.last_transport ?? '',
        row.latitude ?? '',
        row.longitude ?? '',
        row.location_source ?? '',
        row.location_stale,
        row.active_fault_count,
        usageRow ? usageValue(usageRow) : '',
        balance?.remaining_bytes ?? '',
        row.last_seen_at ?? '',
      ];
    });
    const csv = [headers, ...body].map((line) => line.map(csvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dallmayr-fleet-snapshot-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={styles.dashboard} data-fleet-dashboard="televend-v3">
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}><i /><strong>Fleet dashboard</strong><span>{report.date_from ?? '—'} – {report.date_to ?? '—'}</span></div>
        <div className={styles.toolbarActions}>
          <label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <button disabled={!locations.length} onClick={exportFleetSnapshot} type="button">Export fleet CSV</button>
          <button disabled={refreshing} onClick={() => load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading && !data ? <HamsterLoader label="Loading fleet dashboard" /> : null}

      {data ? <>
        <section className={styles.metricsStrip} aria-label="Fleet headline metrics">
          <Metric helper={periods.find((item) => item.value === period)?.label ?? period} label="Items sold" tone="blue" value={units.toLocaleString('en-ZA')} />
          <Metric helper={`${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(1)}% vs previous`} label="Revenue" tone="gold" value={money(revenue)} />
          <Metric helper={`${online} online · ${offline} offline`} label="Fleet availability" tone="green" value={`${availability.toFixed(1)}%`} />
          <Metric helper={`${failed.toLocaleString('en-ZA')} failed vends`} label="Vend success" tone={success >= 98 ? 'green' : success >= 95 ? 'amber' : 'red'} value={`${success.toFixed(1)}%`} />
          <Metric helper={`${critical} critical · ${warning} warning`} label="Active alarms" tone={active ? 'red' : 'green'} value={active.toLocaleString('en-ZA')} />
          <Metric helper={`${reportingDevices} telemetry devices`} label="Machines reporting" tone="amber" value={n(summary.active_machines).toLocaleString('en-ZA')} />
        </section>

        <section className={styles.telemetryRow} aria-label="Fleet operational readiness">
          <article className={styles.telemetryCard}><header><span>Machine-device linking</span><strong>{assignedDevices.toLocaleString('en-ZA')} / {machineCount.toLocaleString('en-ZA')}</strong></header><div className={styles.meter}><i style={{ width: `${assignmentCoverage}%` }} /></div><small>{n(summary.unassigned_devices).toLocaleString('en-ZA')} active devices unassigned · <Link href="/telemetry/devices">Device management ›</Link></small></article>
          <article className={styles.telemetryCard}><header><span>Map coverage</span><strong>{locationCoverage.toFixed(0)}%</strong></header><div className={styles.meter}><i style={{ width: `${locationCoverage}%` }} /></div><small>{mappedDevices.toLocaleString('en-ZA')} devices located · {staleLocations.toLocaleString('en-ZA')} stale · <Link href="/map">Fleet map ›</Link></small></article>
          <article className={styles.telemetryCard}><header><span>Communication deadlines</span><strong>{communicationErrors.toLocaleString('en-ZA')} overdue</strong></header><div className={styles.meter}><i style={{ width: `${communicationHealth}%` }} /></div><small>Uses each device reporting schedule · <Link href="/machines">Investigate machines ›</Link></small></article>
          <article className={styles.telemetryCard}><header><span>Network visibility</span><strong>{networkCoverage.toFixed(0)}%</strong></header><div className={styles.meter}><i style={{ width: `${networkCoverage}%` }} /></div><small>{wifi} Wi-Fi · {cellular} cellular · {unknownNetwork} unknown</small></article>
        </section>

        <section className={styles.grid}>
          <article className={`${styles.card} ${styles.trendCard}`}>
            <header className={`${styles.cardHeader} ${styles.cardHeaderRed}`}><div><span>{periods.find((item) => item.value === period)?.label}</span><h2>Sales metrics</h2></div><strong>{units.toLocaleString('en-ZA')} vends</strong></header>
            <div className={styles.cardBody}>{currentTrend.length ? <ComparisonLineChart current={currentTrend} currentLabel="This period" previous={previousTrend} previousLabel="Previous period" valueLabel="vends" /> : <div className={styles.empty}>No sales counters for this period.</div>}</div>
            <footer className={styles.cardFooter}><span>Total revenue</span><strong>{money(revenue)} <em>{periodChange >= 0 ? '+' : ''}{periodChange.toFixed(1)}%</em></strong></footer>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Vends</span><h2>Top products</h2></div><Link href="/products">Full report ›</Link></header>
            <div className={styles.topProducts}>
              <div className={styles.productHeader}><span>#</span><span>Product</span><span>Vends</span><span>Failed</span></div>
              {topProducts.slice(0, 10).map((product, index) => {
                const failRate = n(product.units_sold) + n(product.failed_vends) ? n(product.failed_vends) / (n(product.units_sold) + n(product.failed_vends)) * 100 : 0;
                return <div className={styles.productRow} key={product.product_key}><b>{index + 1}</b><span className={styles.productName}>{product.product_name ?? product.sku ?? product.product_key}</span><span className={styles.productValue}>{n(product.units_sold).toLocaleString('en-ZA')}</span><span className={`${styles.productTrend} ${failRate > 2 ? styles.productTrendDown : ''}`}>{failRate.toFixed(1)}%</span></div>;
              })}
              {!topProducts.length ? <div className={styles.empty}>No product counters yet.</div> : null}
            </div>
            <footer className={styles.cardFooter}><span>Total products</span><strong>{topProducts.length.toLocaleString('en-ZA')}</strong></footer>
          </article>

          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Fault activity · 30 days</span><h2>Alarms</h2></div><Link href="/alerts">All alarms ›</Link></header>
            <div className={styles.alarmGrid}>
              <Ring label="Active" legend={[`${critical} critical`, `${warning} warning`, `${Math.max(0, active - critical - warning)} other`]} percent={activeRate} tone="red" value={active} />
              <Ring label="Resolved" legend={[`${resolved} cleared`, `${Math.max(0, faults.length - resolved)} open`, `${faults.length} raised`]} percent={resolvedRate} tone="green" value={resolved} />
            </div>
          </article>

          <div className={styles.gaugeStack}>
            <Gauge label={`${online} of ${Math.max(reportingDevices, 1)} devices`} percent={availability} title="Fleet availability" value={`${availability.toFixed(0)}%`} />
            <Gauge label={`${units.toLocaleString('en-ZA')} successful vends`} percent={success} title="Vend success performance" value={`${success.toFixed(0)}%`} />
          </div>
        </section>

        <section className={styles.telemetryRow} aria-label="Connectivity and data usage">
          <article className={styles.telemetryCard}><header><span>30-day data transfer</span><strong>{bytes(observed)}</strong></header><div className={styles.meter}><i style={{ width: `${Math.min(100, modemCoverage)}%` }} /></div><small>{modemCoverage}% modem-counter coverage</small></article>
          <article className={styles.telemetryCard}><header><span>Monthly projection</span><strong>{bytes(projected)}</strong></header><div className={styles.meter}><i style={{ width: `${Math.min(100, projected ? observed / projected * 100 : 0)}%` }} /></div><small>{usage.reduce((sum, row) => sum + n(row.request_count), 0).toLocaleString('en-ZA')} accepted uploads</small></article>
          <article className={styles.telemetryCard}><header><span>Prepaid remaining</span><strong>{balanceRows.length ? bytes(remaining) : 'Awaiting data'}</strong></header><div className={styles.meter}><i style={{ width: `${lowBalance ? 35 : balanceRows.length ? 100 : 0}%` }} /></div><small>{lowBalance ? `${lowBalance} SIMs need top-up` : 'No reported top-up risk'}</small></article>
          <article className={styles.telemetryCard}><header><span>Network mix</span><strong>{wifi} Wi-Fi · {cellular} cellular</strong></header><div className={styles.meter}><i style={{ width: `${devices.length ? wifi / devices.length * 100 : 0}%` }} /></div><small>{avgWifi ? `${avgWifi.toFixed(0)} dBm avg Wi-Fi` : 'Wi-Fi RSSI pending'} · {avgCell ? `${avgCell.toFixed(1)} CSQ cellular` : 'CSQ pending'}</small></article>
        </section>

        <section className={styles.grid}>
          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Recent counters</span><h2>Latest vend activity</h2></div><Link href="/telemetry">Analytics ›</Link></header>
            <div className={styles.activityList}>{recentSales.slice(0, 8).map((sale) => <div className={styles.activityRow} key={sale.id}><i /><div><strong>{sale.product_name ?? sale.sku ?? sale.selection_code}</strong><span>{sale.machine_name ?? sale.serial_number ?? sale.branch.toUpperCase()} · {timeAgo(sale.last_received_at)} ago</span></div><b>{n(sale.units_sold).toLocaleString('en-ZA')}</b></div>)}{!recentSales.length ? <div className={styles.empty}>No recent vend activity.</div> : null}</div>
          </article>
          <article className={styles.card}>
            <header className={styles.cardHeader}><div><span>Fleet leaders</span><h2>Top machines</h2></div><Link href="/machines">Machines ›</Link></header>
            <div className={styles.topProducts}><div className={styles.productHeader}><span>#</span><span>Machine</span><span>Vends</span><span>Failed</span></div>{(report.top_machines ?? []).slice(0, 8).map((machine, index) => <div className={styles.productRow} key={machine.machine_id ?? `${index}`}><b>{index + 1}</b><span className={styles.productName}>{machine.machine_name ?? machine.serial_number ?? 'Unassigned'}</span><span className={styles.productValue}>{n(machine.units_sold).toLocaleString('en-ZA')}</span><span className={`${styles.productTrend} ${n(machine.failed_vends) ? styles.productTrendDown : ''}`}>{n(machine.failed_vends).toLocaleString('en-ZA')}</span></div>)}</div>
            <footer className={styles.cardFooter}><span>Updated</span><strong>{updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</strong></footer>
          </article>
        </section>
      </> : null}
    </section>
  );
}
