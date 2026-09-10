'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { addLocalDays, formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryReports.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';
type Branch = 'all' | 'jhb' | 'cpt' | 'kzn' | 'national';
type ReportTab = 'sales' | 'products' | 'machines' | 'faults' | 'data' | 'readiness';

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

type DailyRow = { date: string; units_sold: number; revenue_cents: number; failed_vends: number };
type ProductRow = { product_key: string; sku: string | null; product_name: string | null; brand: string | null; units_sold: number; revenue_cents: number; failed_vends: number };
type MachineRow = { machine_id: string | null; machine_name: string | null; serial_number: string | null; location: string | null; branch: string; units_sold: number; revenue_cents: number; failed_vends: number };
type ReportingPayload = { date_from?: string; date_to?: string; summary?: Summary; daily_trend?: DailyRow[]; top_items?: ProductRow[]; top_machines?: MachineRow[] };

type LocationRow = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  last_transport: 'wifi' | 'cellular' | null;
  communication_status: string | null;
  communication_error: boolean;
  minutes_overdue: number | null;
  active_fault_count: number;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  location_stale: boolean;
  has_location: boolean;
  last_seen_at: string | null;
};

type FaultRow = {
  id: string;
  device_id: string;
  machine_id: string | null;
  fault_code: string;
  severity: string;
  detail: string | null;
  started_at: string;
  last_seen_at: string;
  cleared_at: string | null;
};

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
  last_reported_at: string | null;
};

type BalanceRow = { device_id: string; remaining_bytes: number | null; query_status: string; alert_level: string; checked_at: string | null; is_stale: boolean };

type ReportData = {
  report: ReportingPayload;
  locations: LocationRow[];
  faults: FaultRow[];
  usage: UsageRow[];
  balances: BalanceRow[];
};

const periods: Record<Period, { label: string; days: number }> = {
  day: { label: 'Today', days: 1 },
  week: { label: 'Last 7 days', days: 7 },
  month: { label: 'Last 30 days', days: 30 },
  six_months: { label: 'Last 6 months', days: 180 },
};
const branches: Record<Branch, string> = { all: 'All branches', jhb: 'Johannesburg', cpt: 'Cape Town', kzn: 'KwaZulu-Natal', national: 'National' };
const tabs: Array<{ id: ReportTab; label: string; helper: string }> = [
  { id: 'sales', label: 'Sales & cups', helper: 'Daily production totals' },
  { id: 'products', label: 'Products', helper: 'Top product performance' },
  { id: 'machines', label: 'Machines', helper: 'Top machine performance' },
  { id: 'faults', label: 'Faults', helper: 'Machine error history' },
  { id: 'data', label: 'Data & SIM', helper: 'Usage and prepaid state' },
  { id: 'readiness', label: 'Fleet readiness', helper: 'Current operational state' },
];

function n(value: unknown) { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function money(cents: number) { return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n(cents) / 100); }
function bytes(value: number | null | undefined) {
  const amount = n(value); if (amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; const unit = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** unit); return `${scaled.toFixed(unit === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[unit]}`;
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
function csvCell(value: unknown) { const text = value === null || value === undefined ? '' : String(value); return `"${text.replaceAll('"', '""')}"`; }
function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
function dateTime(value: string | null) { return value ? new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'; }
function normalizedBranch(value: string | null | undefined) { return (value ?? 'unassigned').trim().toLowerCase(); }

function Metric({ label, value, helper, tone = 'blue' }: { label: string; value: string; helper: string; tone?: 'blue' | 'green' | 'amber' | 'red' }) {
  return <article className={`${styles.metric} ${styles[tone]}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

export function TelemetryReports() {
  const [period, setPeriod] = useState<Period>('month');
  const [branch, setBranch] = useState<Branch>('all');
  const [tab, setTab] = useState<ReportTab>('sales');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    const client = getSupabaseClient();
    const periodDays = periods[period].days;
    const faultStart = addLocalDays(new Date(), -(periodDays - 1));
    const faultStartBusinessDate = `${formatLocalDate(faultStart)}T00:00:00+02:00`;
    const [reportResult, locationResult, faultResult, usageResult, balanceResult] = await Promise.all([
      client.rpc('get_telemetry_reporting', { p_period: period, p_branch: branch, p_dataset: 'production' }),
      client.rpc('get_telemetry_location_map'),
      client.from('telemetry_fault_events').select('id,device_id,machine_id,fault_code,severity,detail,started_at,last_seen_at,cleared_at').gte('started_at', faultStartBusinessDate).order('started_at', { ascending: false }).limit(5000),
      client.rpc('get_telemetry_data_usage', { p_days: periodDays }),
      client.rpc('get_telemetry_prepaid_balances'),
    ]);
    const blockingError = reportResult.error ?? locationResult.error;
    if (blockingError) {
      setError(blockingError.message ?? 'Could not load telemetry reports.'); setLoading(false); setRefreshing(false); return;
    }
    const allLocations = (locationResult.data ?? []) as LocationRow[];
    const allowedDeviceIds = new Set(allLocations.filter((row) => branch === 'all' || normalizedBranch(row.branch) === branch).map((row) => row.device_id));
    const filteredLocations = branch === 'all' ? allLocations : allLocations.filter((row) => allowedDeviceIds.has(row.device_id));
    const rawFaults = faultResult.error ? [] : ((faultResult.data ?? []) as FaultRow[]);
    const filteredFaults = branch === 'all' ? rawFaults : rawFaults.filter((row) => allowedDeviceIds.has(row.device_id));
    const rawUsage = usageResult.error ? [] : ((usageResult.data ?? []) as UsageRow[]);
    const rawBalances = balanceResult.error ? [] : ((balanceResult.data ?? []) as BalanceRow[]);
    setData({
      report: (reportResult.data ?? {}) as ReportingPayload,
      locations: filteredLocations,
      faults: filteredFaults,
      usage: branch === 'all' ? rawUsage : rawUsage.filter((row) => allowedDeviceIds.has(row.device_id)),
      balances: branch === 'all' ? rawBalances : rawBalances.filter((row) => allowedDeviceIds.has(row.device_id)),
    });
    setUpdated(new Date()); setLoading(false); setRefreshing(false);
  }, [branch, period]);

  useEffect(() => { load().catch((loadError) => { setError(loadError instanceof Error ? loadError.message : 'Could not load telemetry reports.'); setLoading(false); setRefreshing(false); }); }, [load]);

  const summary = data?.report.summary ?? {};
  const units = n(summary.units_sold); const failed = n(summary.failed_vends); const attempts = units + failed;
  const success = attempts ? units / attempts * 100 : 100;
  const online = n(summary.online_devices); const reporting = n(summary.reporting_devices); const availability = reporting ? online / reporting * 100 : 0;
  const activeFaults = data?.faults.filter((row) => !row.cleared_at).length ?? 0;
  const usageTotal = data?.usage.reduce((sum, row) => sum + usageValue(row), 0) ?? 0;
  const lowSims = data?.balances.filter((row) => ['low', 'critical', 'depleted'].includes(row.alert_level)).length ?? 0;
  const locationsByDevice = useMemo(() => new Map((data?.locations ?? []).map((row) => [row.device_id, row])), [data?.locations]);
  const balancesByDevice = useMemo(() => new Map((data?.balances ?? []).map((row) => [row.device_id, row])), [data?.balances]);

  const exportCurrent = () => {
    if (!data) return;
    const from = data.report.date_from ?? formatLocalDate(); const to = data.report.date_to ?? formatLocalDate();
    const prefix = `dallmayr-${tab}-${branch}-${from}-${to}.csv`;
    if (tab === 'sales') downloadCsv(prefix, [['Date', 'Successful cups', 'Failed vends', 'Revenue ZAR'], ...(data.report.daily_trend ?? []).map((row) => [row.date, row.units_sold, row.failed_vends, (n(row.revenue_cents) / 100).toFixed(2)])]);
    if (tab === 'products') downloadCsv(prefix, [['Product', 'SKU', 'Brand', 'Successful cups', 'Failed vends', 'Revenue ZAR'], ...(data.report.top_items ?? []).map((row) => [row.product_name ?? row.product_key, row.sku ?? '', row.brand ?? '', row.units_sold, row.failed_vends, (n(row.revenue_cents) / 100).toFixed(2)])]);
    if (tab === 'machines') downloadCsv(prefix, [['Machine', 'Serial', 'Location', 'Branch', 'Successful cups', 'Failed vends', 'Revenue ZAR'], ...(data.report.top_machines ?? []).map((row) => [row.machine_name ?? '', row.serial_number ?? '', row.location ?? '', row.branch, row.units_sold, row.failed_vends, (n(row.revenue_cents) / 100).toFixed(2)])]);
    if (tab === 'faults') downloadCsv(prefix, [['Machine', 'Device', 'Fault code', 'Severity', 'Detail', 'Started', 'Last seen', 'Cleared'], ...data.faults.map((row) => { const location = locationsByDevice.get(row.device_id); return [location?.machine_name ?? '', location?.device_code ?? row.device_id, row.fault_code, row.severity, row.detail ?? '', row.started_at, row.last_seen_at, row.cleared_at ?? '']; })]);
    if (tab === 'data') downloadCsv(prefix, [['Machine', 'Device', 'Network', 'Observed bytes', 'Projected monthly bytes', 'Requests', 'SIM remaining bytes', 'SIM alert', 'Last usage'], ...data.usage.map((row) => { const location = locationsByDevice.get(row.device_id); const balance = balancesByDevice.get(row.device_id); return [location?.machine_name ?? '', location?.device_code ?? row.device_id, location?.last_transport ?? '', usageValue(row), projectedValue(row), row.request_count, balance?.remaining_bytes ?? '', balance?.alert_level ?? '', row.last_reported_at ?? '']; })]);
    if (tab === 'readiness') downloadCsv(prefix, [['Machine', 'Serial', 'Device', 'Branch', 'Communication', 'Minutes overdue', 'Network', 'Mapped', 'Location source', 'Location stale', 'Active faults', 'Last seen'], ...data.locations.map((row) => [row.machine_name ?? '', row.serial_number ?? '', row.device_code, row.branch, row.communication_status ?? '', row.minutes_overdue ?? '', row.last_transport ?? '', row.has_location, row.location_source ?? '', row.location_stale, row.active_fault_count, row.last_seen_at ?? ''])]);
  };

  const mapped = data?.locations.filter((row) => row.has_location).length ?? 0;
  const overdue = data?.locations.filter((row) => row.communication_error).length ?? 0;
  const unassigned = data?.locations.filter((row) => !row.machine_id).length ?? 0;
  const unknownNetwork = data?.locations.filter((row) => !row.last_transport).length ?? 0;

  return <section className={styles.reports} data-telemetry-reports="v1">
    <header className={styles.header}><div><span>Production telemetry</span><h1>Reports & exports</h1><p>Operational reporting from real machine, vend, fault, network and data-usage records.</p></div><div className={styles.headerActions}><Link href="/telemetry">Open analytics</Link><button disabled={!data} onClick={exportCurrent} type="button">Export current report</button></div></header>

    <section className={styles.controls} aria-label="Report filters">
      <label><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{(Object.keys(periods) as Period[]).map((value) => <option key={value} value={value}>{periods[value].label}</option>)}</select></label>
      <label><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{(Object.keys(branches) as Branch[]).map((value) => <option key={value} value={value}>{branches[value]}</option>)}</select></label>
      <button disabled={loading || refreshing} onClick={() => load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      <small>Updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'} · Production only</small>
    </section>

    {error ? <div className={styles.error} role="alert"><strong>Report data could not be loaded.</strong><span>{error}</span><button onClick={() => load()} type="button">Try again</button></div> : null}
    {loading && !data ? <div className={styles.loading}><HamsterLoader label="Loading telemetry reports" /></div> : null}

    {data ? <>
      <section className={styles.metrics} aria-label="Report summary">
        <Metric label="Successful cups" value={units.toLocaleString('en-ZA')} helper={`${periods[period].label} · ${branches[branch]}`} />
        <Metric label="Revenue" value={money(n(summary.revenue_cents))} helper="Production telemetry" tone="amber" />
        <Metric label="Vend success" value={`${success.toFixed(1)}%`} helper={`${failed.toLocaleString('en-ZA')} failed`} tone={success >= 98 ? 'green' : success >= 95 ? 'amber' : 'red'} />
        <Metric label="Current availability" value={`${availability.toFixed(1)}%`} helper={`${online} online of ${reporting}`} tone={availability >= 95 ? 'green' : 'amber'} />
        <Metric label="Active faults" value={activeFaults.toLocaleString('en-ZA')} helper={`${data.faults.length.toLocaleString('en-ZA')} raised in period`} tone={activeFaults ? 'red' : 'green'} />
        <Metric label="Observed data" value={bytes(usageTotal)} helper={`${lowSims} SIMs need attention`} tone={lowSims ? 'amber' : 'blue'} />
      </section>

      <nav className={styles.tabs} aria-label="Telemetry report types" role="tablist">{tabs.map((item) => <button aria-selected={tab === item.id} className={tab === item.id ? styles.activeTab : ''} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button"><strong>{item.label}</strong><span>{item.helper}</span></button>)}</nav>

      <article className={styles.card}>
        <header className={styles.cardHeader}><div><span>{data.report.date_from ?? '—'} – {data.report.date_to ?? '—'}</span><h2>{tabs.find((item) => item.id === tab)?.label}</h2></div><button onClick={exportCurrent} type="button">Download CSV</button></header>

        {tab === 'sales' ? <div className={styles.tableWrap}><table><thead><tr><th>Date</th><th>Successful cups</th><th>Failed vends</th><th>Vend success</th><th>Revenue</th></tr></thead><tbody>{(data.report.daily_trend ?? []).map((row) => { const rowAttempts = n(row.units_sold) + n(row.failed_vends); const rowSuccess = rowAttempts ? n(row.units_sold) / rowAttempts * 100 : 100; return <tr key={row.date}><td><strong>{row.date}</strong></td><td>{n(row.units_sold).toLocaleString('en-ZA')}</td><td>{n(row.failed_vends).toLocaleString('en-ZA')}</td><td>{rowSuccess.toFixed(1)}%</td><td>{money(n(row.revenue_cents))}</td></tr>; })}</tbody></table>{!(data.report.daily_trend ?? []).length ? <div className={styles.empty}>No production sales totals for this period.</div> : null}</div> : null}

        {tab === 'products' ? <div className={styles.tableWrap}><div className={styles.notice}>The existing reporting RPC returns the top 10 products for the selected period. CSV export contains this same ranked set.</div><table><thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Brand</th><th>Cups</th><th>Failed</th><th>Revenue</th></tr></thead><tbody>{(data.report.top_items ?? []).map((row, index) => <tr key={row.product_key}><td>{index + 1}</td><td><strong>{row.product_name ?? row.product_key}</strong></td><td>{row.sku ?? '—'}</td><td>{row.brand ?? '—'}</td><td>{n(row.units_sold).toLocaleString('en-ZA')}</td><td>{n(row.failed_vends).toLocaleString('en-ZA')}</td><td>{money(n(row.revenue_cents))}</td></tr>)}</tbody></table>{!(data.report.top_items ?? []).length ? <div className={styles.empty}>No product counters for this period.</div> : null}</div> : null}

        {tab === 'machines' ? <div className={styles.tableWrap}><div className={styles.notice}>This is the server-ranked top 10 machine performance view. Current fleet communication state is available under Fleet readiness.</div><table><thead><tr><th>#</th><th>Machine</th><th>Serial</th><th>Branch</th><th>Cups</th><th>Failed</th><th>Revenue</th></tr></thead><tbody>{(data.report.top_machines ?? []).map((row, index) => <tr key={row.machine_id ?? `${index}`}><td>{index + 1}</td><td><strong>{row.machine_name ?? 'Unassigned'}</strong></td><td>{row.serial_number ?? '—'}</td><td>{row.branch}</td><td>{n(row.units_sold).toLocaleString('en-ZA')}</td><td>{n(row.failed_vends).toLocaleString('en-ZA')}</td><td>{money(n(row.revenue_cents))}</td></tr>)}</tbody></table>{!(data.report.top_machines ?? []).length ? <div className={styles.empty}>No machine sales counters for this period.</div> : null}</div> : null}

        {tab === 'faults' ? <div className={styles.tableWrap}><table><thead><tr><th>Machine / device</th><th>Fault</th><th>Severity</th><th>Started</th><th>Last seen</th><th>Machine state</th></tr></thead><tbody>{data.faults.map((row) => { const location = locationsByDevice.get(row.device_id); return <tr key={row.id}><td><strong>{location?.machine_name ?? location?.device_code ?? row.device_id}</strong><span>{location?.serial_number ?? location?.branch ?? ''}</span></td><td><strong>{row.fault_code}</strong><span>{row.detail ?? 'No additional detail'}</span></td><td><b className={`${styles.severity} ${row.severity.toLowerCase() === 'critical' ? styles.severityCritical : ''}`}>{row.severity}</b></td><td>{dateTime(row.started_at)}</td><td>{dateTime(row.last_seen_at)}</td><td>{row.cleared_at ? `Cleared ${dateTime(row.cleared_at)}` : 'Still active'}</td></tr>; })}</tbody></table>{!data.faults.length ? <div className={styles.empty}>No machine faults were raised in this period.</div> : null}</div> : null}

        {tab === 'data' ? <div className={styles.tableWrap}><table><thead><tr><th>Machine / device</th><th>Network</th><th>Observed</th><th>30-day projection</th><th>Requests</th><th>SIM remaining</th><th>Balance state</th></tr></thead><tbody>{data.usage.map((row) => { const location = locationsByDevice.get(row.device_id); const balance = balancesByDevice.get(row.device_id); return <tr key={row.device_id}><td><strong>{location?.machine_name ?? location?.device_code ?? row.device_id}</strong><span>{location?.device_code ?? ''}</span></td><td>{location?.last_transport === 'wifi' ? 'Wi-Fi' : location?.last_transport === 'cellular' ? 'Cellular' : 'Unknown'}</td><td>{bytes(usageValue(row))}</td><td>{bytes(projectedValue(row))}</td><td>{n(row.request_count).toLocaleString('en-ZA')}</td><td>{balance?.remaining_bytes === null || balance?.remaining_bytes === undefined ? 'Awaiting data' : bytes(balance.remaining_bytes)}</td><td>{balance?.alert_level ?? 'Unknown'}</td></tr>; })}</tbody></table>{!data.usage.length ? <div className={styles.empty}>No data-usage counters are available for this period.</div> : null}</div> : null}

        {tab === 'readiness' ? <div className={styles.tableWrap}><div className={styles.readinessSummary}><span><strong>{overdue}</strong> overdue</span><span><strong>{unassigned}</strong> unassigned</span><span><strong>{mapped}</strong> located</span><span><strong>{unknownNetwork}</strong> network unknown</span></div><div className={styles.notice}>Current communication state uses each device reporting deadline. Historical uptime is not inferred from this snapshot.</div><table><thead><tr><th>Machine / device</th><th>Branch</th><th>Communication</th><th>Network</th><th>Location</th><th>Faults</th><th>Last contact</th></tr></thead><tbody>{data.locations.map((row) => <tr key={row.device_id}><td><strong>{row.machine_name ?? row.device_code}</strong><span>{row.serial_number ?? row.device_code}</span></td><td>{row.branch}</td><td><b className={row.communication_error ? styles.bad : styles.good}>{row.communication_status ?? (row.communication_error ? 'offline' : 'unknown')}</b>{row.communication_error ? <span>{n(row.minutes_overdue)} min overdue</span> : null}</td><td>{row.last_transport === 'wifi' ? 'Wi-Fi' : row.last_transport === 'cellular' ? 'Cellular' : 'Unknown'}</td><td>{row.has_location ? `${row.location_source ?? 'known'}${row.location_stale ? ' · stale' : ''}` : 'Not mapped'}</td><td>{n(row.active_fault_count)}</td><td>{dateTime(row.last_seen_at)}</td></tr>)}</tbody></table>{!data.locations.length ? <div className={styles.empty}>No active telemetry devices match this branch.</div> : null}</div> : null}
      </article>

      <footer className={styles.footer}><span>Exports contain only the real records returned by the selected production report.</span><div><Link href="/alerts">Alarm workflow</Link><Link href="/map">Fleet map</Link><Link href="/telemetry/devices">Device management</Link></div></footer>
    </> : null}
  </section>;
}
