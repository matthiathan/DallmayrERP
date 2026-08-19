'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { TelemetryLocationPreview } from '@/components/features/TelemetryLocationMap';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import { displayProfileName } from '@/types/dallmayrerp';

type TelemetryMode = 'live' | 'daily' | 'monthly';
type Period = 'day' | 'week' | 'month' | 'six_months';
type ConnectionStatus = 'online' | 'delayed' | 'offline' | 'never' | 'unlinked';
type DetailTab = 'overview' | 'sales' | 'errors' | 'telemetry' | 'configuration';

type MachineRecord = {
  id: string;
  branch: string;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  machine_name: string | null;
  model: string | null;
  status: string;
  current_custodian: string | null;
  manufacturer?: string | null;
  machine_type?: string | null;
  telemetry_protocol?: string | null;
};

type SiteRecord = {
  id: string;
  site_name: string | null;
  address: string | null;
};

type DeviceState = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  device_status: string;
  telemetry_mode: TelemetryMode;
  machine_status: string;
  active_fault_count: number;
  transport_preference: 'auto' | 'wifi' | 'cellular';
  last_transport: 'wifi' | 'cellular' | null;
  wifi_enabled: boolean;
  cellular_enabled: boolean;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_counter_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
};

type FaultRecord = {
  id: string;
  device_id: string;
  machine_id: string | null;
  fault_code: string;
  severity: string;
  detail: string | null;
  started_at: string;
  last_seen_at: string;
};

type SaleRecord = {
  id: string;
  sales_date: string;
  machine_id: string | null;
  selection_code: string;
  sku: string | null;
  product_name: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
  last_received_at: string;
};

type TrendRecord = {
  date: string;
  units_sold: number;
  failed_vends: number;
};

type ItemRecord = {
  product_key: string;
  sku: string | null;
  product_name: string | null;
  units_sold: number;
  failed_vends: number;
};

type OverviewPayload = {
  summary?: {
    online_devices?: number;
    offline_devices?: number;
    reporting_devices?: number;
    unassigned_devices?: number;
    active_faults?: number;
  };
  device_states?: DeviceState[];
  active_faults?: FaultRecord[];
};

type ReportingPayload = {
  summary?: {
    units_sold?: number;
    failed_vends?: number;
  };
  daily_trend?: TrendRecord[];
  top_items?: ItemRecord[];
  recent_sales?: SaleRecord[];
};

type MachineView = MachineRecord & {
  brand: string;
  type: string;
  protocol: string;
  location: string;
  siteName: string;
  device: DeviceState | null;
  connectionStatus: ConnectionStatus;
  lastContact: string | null;
  unitsSold: number;
  failedVends: number;
  faults: FaultRecord[];
};

type MachineTelemetryOverviewProps = {
  initialMachineId?: string;
  initialStatus?: 'all' | ConnectionStatus | 'fault';
  machinesOnly?: boolean;
};

type QueryError = { message: string };
type QueryPage = { data: unknown[] | null; error: QueryError | null };

const DATABASE_PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 100;
const SITE_BATCH_SIZE = 100;
const SITE_BATCH_CONCURRENCY = 4;
const MACHINE_COLUMNS = 'id,branch,site_id,serial_number,machine_barcode,asset_tag,machine_name,model,status,current_custodian';
const MACHINE_ENRICHMENT_COLUMNS = 'id,manufacturer,machine_type,telemetry_protocol';
const FALLBACK_DEVICE_COLUMNS = 'id,device_code,machine_id,status,firmware_version,wifi_rssi,last_seen_at,last_upload_at,last_sequence,updated_at';

const periods: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'six_months', label: '6 months' },
];

const detailTabs: Array<{ value: DetailTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'sales', label: 'Sales' },
  { value: 'errors', label: 'Errors' },
  { value: 'telemetry', label: 'Telemetry' },
  { value: 'configuration', label: 'Configuration' },
];

async function loadAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<QueryPage>,
  expectedCount: number | null = null,
) {
  const rows: T[] = [];

  for (let from = 0; expectedCount === null || from < expectedCount; from += DATABASE_PAGE_SIZE) {
    const result = await loadPage(from, from + DATABASE_PAGE_SIZE - 1);
    if (result.error) return { data: rows, error: result.error };

    const page = (result.data ?? []) as T[];
    rows.push(...page);

    if (page.length < DATABASE_PAGE_SIZE) break;
  }

  return { data: rows, error: null };
}

async function loadMachineRegister(client: ReturnType<typeof getSupabaseClient>) {
  const countResult = await client.from('machines').select('id', { count: 'exact', head: true });
  if (countResult.error) return { data: [] as MachineRecord[], count: 0, error: countResult.error };

  const result = await loadAllPages<MachineRecord>(
    (from, to) => client
      .from('machines')
      .select(MACHINE_COLUMNS)
      .order('machine_name', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to),
    countResult.count,
  );

  return { ...result, count: countResult.count ?? result.data.length };
}

async function loadMachineEnrichment(client: ReturnType<typeof getSupabaseClient>, machineCount: number) {
  return loadAllPages<Pick<MachineRecord, 'id' | 'manufacturer' | 'machine_type' | 'telemetry_protocol'>>(
    (from, to) => client
      .from('machines')
      .select(MACHINE_ENRICHMENT_COLUMNS)
      .order('id', { ascending: true })
      .range(from, to),
    machineCount,
  );
}

async function loadSites(client: ReturnType<typeof getSupabaseClient>, siteIds: string[]) {
  const rows: SiteRecord[] = [];
  const batches: string[][] = [];

  for (let from = 0; from < siteIds.length; from += SITE_BATCH_SIZE) {
    batches.push(siteIds.slice(from, from + SITE_BATCH_SIZE));
  }

  for (let from = 0; from < batches.length; from += SITE_BATCH_CONCURRENCY) {
    const results = await Promise.all(batches.slice(from, from + SITE_BATCH_CONCURRENCY).map((ids) => (
      client.from('customer_sites').select('id,site_name,address').in('id', ids)
    )));
    const failed = results.find((result) => result.error);
    if (failed?.error) return { data: rows, error: failed.error };
    results.forEach((result) => rows.push(...((result.data ?? []) as SiteRecord[])));
  }

  return { data: rows, error: null };
}

async function loadFallbackDevices(client: ReturnType<typeof getSupabaseClient>) {
  const countResult = await client.from('telemetry_devices').select('id', { count: 'exact', head: true }).eq('status', 'active');
  if (countResult.error) return { data: [], error: countResult.error };

  return loadAllPages<Partial<DeviceState> & { id: string; status?: string; last_upload_at?: string | null }>(
    (from, to) => client
      .from('telemetry_devices')
      .select(FALLBACK_DEVICE_COLUMNS)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to),
    countResult.count,
  );
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

function timeAgo(value: string | null) {
  if (!value) return 'Never connected';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function connectionStatus(device: DeviceState | null): ConnectionStatus {
  if (!device) return 'unlinked';
  const contact = device.last_heartbeat_at ?? device.last_seen_at;
  if (!contact) return 'never';
  const age = Date.now() - new Date(contact).getTime();
  if (age <= 30 * 60 * 1000) return 'online';
  if (age <= 24 * 60 * 60 * 1000) return 'delayed';
  return 'offline';
}

function statusLabel(status: ConnectionStatus) {
  if (status === 'unlinked') return 'No device';
  if (status === 'never') return 'Never connected';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusTone(status: ConnectionStatus) {
  if (status === 'online') return 'success';
  if (status === 'delayed') return 'warning';
  if (status === 'offline') return 'danger';
  return 'neutral';
}

function machineTitle(machine: MachineRecord) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.asset_tag ?? 'Unnamed machine';
}

function inferBrand(machine: MachineRecord) {
  if (machine.manufacturer?.trim()) return machine.manufacturer.trim();
  const haystack = `${machine.machine_name ?? ''} ${machine.model ?? ''}`.toLowerCase();
  const brands = ['Sielaff', 'Rheavendors', 'Franke', 'Schaerer', 'Jura', 'Wittenborg', 'Necta', 'Saeco', 'Bianchi'];
  return brands.find((brand) => haystack.includes(brand.toLowerCase())) ?? 'Not recorded';
}

function inferType(machine: MachineRecord) {
  if (machine.machine_type?.trim()) return machine.machine_type.trim();
  return machine.model ?? machine.machine_name ?? 'Not classified';
}

function normaliseDevice(value: Partial<DeviceState> & { id?: string }): DeviceState {
  return {
    device_id: value.device_id ?? value.id ?? '',
    device_code: value.device_code ?? 'Unknown device',
    machine_id: value.machine_id ?? null,
    device_status: value.device_status ?? 'active',
    telemetry_mode: value.telemetry_mode ?? 'live',
    machine_status: value.machine_status ?? 'unknown',
    active_fault_count: numberValue(value.active_fault_count),
    transport_preference: value.transport_preference ?? 'auto',
    last_transport: value.last_transport ?? null,
    wifi_enabled: value.wifi_enabled ?? true,
    cellular_enabled: value.cellular_enabled ?? true,
    wifi_rssi: value.wifi_rssi === null || value.wifi_rssi === undefined ? null : numberValue(value.wifi_rssi),
    cellular_csq: value.cellular_csq === null || value.cellular_csq === undefined ? null : numberValue(value.cellular_csq),
    cellular_operator: value.cellular_operator ?? null,
    firmware_version: value.firmware_version ?? null,
    last_seen_at: value.last_seen_at ?? null,
    last_counter_at: value.last_counter_at ?? null,
    last_heartbeat_at: value.last_heartbeat_at ?? null,
    last_config_at: value.last_config_at ?? null,
  };
}

function MetricCard({ icon, label, value, helper, tone = 'blue' }: { icon: Parameters<typeof NavigationIcon>[0]['kind']; label: string; value: number; helper: string; tone?: string }) {
  return (
    <article className="fleet-metric-card">
      <span className={`fleet-metric-icon is-${tone}`}><NavigationIcon kind={icon} /></span>
      <div><span>{label}</span><strong>{value.toLocaleString('en-ZA')}</strong></div>
      <small>{helper}</small>
    </article>
  );
}

function StatusPill({ value }: { value: ConnectionStatus }) {
  return <span className={`fleet-status-pill is-${statusTone(value)}`}><i aria-hidden="true" />{statusLabel(value)}</span>;
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <div className="fleet-empty-state"><NavigationIcon kind="telemetry" /><strong>{title}</strong><p>{message}</p></div>;
}

function TrendChart({ rows }: { rows: TrendRecord[] }) {
  const values = rows.map((row) => numberValue(row.units_sold));
  const max = Math.max(...values, 1);
  const width = 720;
  const height = 210;
  const paddingX = 26;
  const paddingY = 24;
  const points = rows.map((row, index) => {
    const x = paddingX + (index / Math.max(rows.length - 1, 1)) * (width - paddingX * 2);
    const y = height - paddingY - (numberValue(row.units_sold) / max) * (height - paddingY * 2);
    return { x, y, row };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ');

  if (rows.length === 0) return <EmptyState title="No sales trend yet" message="The chart will appear after counter snapshots are received." />;

  return (
    <div className="fleet-trend-chart">
      <svg aria-label="Units sold over time" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 1, 2, 3].map((line) => <line key={line} x1={paddingX} x2={width - paddingX} y1={paddingY + line * 48} y2={paddingY + line * 48} />)}
        <polyline className="fleet-trend-area" points={`${paddingX},${height - paddingY} ${polyline} ${width - paddingX},${height - paddingY}`} />
        <polyline className="fleet-trend-line" points={polyline} />
        {points.map((point) => <circle key={`${point.row.date}-${point.x}`} cx={point.x} cy={point.y} r="4" />)}
      </svg>
      <div className="fleet-trend-labels">
        {rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 5)) === 0).map((row) => <span key={row.date}>{formatShortDate(row.date)}</span>)}
      </div>
    </div>
  );
}

function ProductBars({ items }: { items: ItemRecord[] }) {
  const visible = items.slice(0, 6);
  const max = Math.max(...visible.map((item) => numberValue(item.units_sold)), 1);
  if (visible.length === 0) return <EmptyState title="No product counters yet" message="Item quantities will appear after telemetry data is processed." />;
  return (
    <div className="fleet-product-bars">
      {visible.map((item) => (
        <div key={item.product_key}>
          <span title={item.product_name ?? item.sku ?? item.product_key}>{item.product_name ?? item.sku ?? item.product_key}</span>
          <i><b style={{ width: `${Math.max(3, (numberValue(item.units_sold) / max) * 100)}%` }} /></i>
          <strong>{numberValue(item.units_sold).toLocaleString('en-ZA')}</strong>
        </div>
      ))}
    </div>
  );
}

function faultTone(severity: string) {
  const value = severity.toLowerCase();
  if (value === 'critical') return 'critical';
  if (value === 'warning' || value === 'medium') return 'warning';
  if (value === 'connectivity') return 'connectivity';
  return 'fault';
}

function OverviewOperationsGrid({
  machines,
  faults,
  sales,
  openMachine,
}: {
  machines: MachineView[];
  faults: FaultRecord[];
  sales: SaleRecord[];
  openMachine: (machine: MachineView, tab?: DetailTab) => void;
}) {
  const machineById = new Map(machines.map((machine) => [machine.id, machine]));
  const priorityFaults = [...faults].sort((left, right) => new Date(right.last_seen_at).getTime() - new Date(left.last_seen_at).getTime()).slice(0, 5);
  const recentActivity = [
    ...faults.map((fault) => ({
      id: `fault-${fault.id}`,
      occurredAt: fault.last_seen_at,
      title: machineById.get(fault.machine_id ?? '') ? machineTitle(machineById.get(fault.machine_id ?? '')!) : fault.fault_code,
      detail: fault.detail ?? `${fault.fault_code} detected`,
      tone: 'danger',
    })),
    ...sales.map((sale) => ({
      id: `sale-${sale.id}`,
      occurredAt: sale.last_received_at,
      title: machineById.get(sale.machine_id ?? '') ? machineTitle(machineById.get(sale.machine_id ?? '')!) : (sale.product_name ?? sale.selection_code),
      detail: `${sale.units_sold.toLocaleString('en-ZA')} ${sale.product_name ?? sale.sku ?? 'items'} received`,
      tone: 'success',
    })),
  ].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()).slice(0, 5);

  return (
    <section className="fleet-overview-lower-grid">
      <article className="fleet-panel fleet-priority-alerts">
        <header><div><span>Priority alerts</span><h2>Machines needing attention</h2></div><Link href="/alerts">View all</Link></header>
        {priorityFaults.length === 0 ? <EmptyState title="No active alerts" message="No unresolved machine faults require attention." /> : (
          <div className="fleet-compact-table-wrap"><table className="fleet-compact-table"><thead><tr><th>Severity</th><th>Machine</th><th>Site</th><th>Last contact</th><th>Action</th></tr></thead><tbody>
            {priorityFaults.map((fault) => {
              const machine = machineById.get(fault.machine_id ?? '');
              return <tr key={fault.id}><td><span className={`fleet-alert-severity is-${faultTone(fault.severity)}`}>{fault.severity}</span></td><td><strong>{machine ? machineTitle(machine) : fault.fault_code}</strong><span>{fault.detail ?? fault.fault_code}</span></td><td>{machine?.siteName ?? 'Unassigned'}</td><td>{timeAgo(fault.last_seen_at)}</td><td>{machine ? <button onClick={() => openMachine(machine, 'errors')} type="button">View details</button> : '—'}</td></tr>;
            })}
          </tbody></table></div>
        )}
      </article>

      <article className="fleet-panel fleet-overview-map-card">
        <header><div><span>Machines by location</span><h2>South Africa fleet</h2></div><Link href="/map">Open map</Link></header>
        <TelemetryLocationPreview />
      </article>

      <article className="fleet-panel fleet-recent-activity-card">
        <header><div><span>Recent telemetry activity</span><h2>Latest device events</h2></div><Link href="/telemetry">View analytics</Link></header>
        {recentActivity.length === 0 ? <EmptyState title="No recent activity" message="Device events and counters will appear here as they arrive." /> : <div className="fleet-recent-activity-list">{recentActivity.map((activity) => <div key={activity.id}><i className={`is-${activity.tone}`} /><div><strong>{activity.title}</strong><span>{activity.detail}</span></div><time>{timeAgo(activity.occurredAt)}</time></div>)}</div>}
      </article>
    </section>
  );
}

function AlertsWorkspace({
  machines,
  faults,
  search,
  setSearch,
  branch,
  setBranch,
  branches,
  openMachine,
}: {
  machines: MachineView[];
  faults: FaultRecord[];
  search: string;
  setSearch: (value: string) => void;
  branch: string;
  setBranch: (value: string) => void;
  branches: string[];
  openMachine: (machine: MachineView, tab?: DetailTab) => void;
}) {
  const [severity, setSeverity] = useState('all');
  const machineById = new Map(machines.map((machine) => [machine.id, machine]));
  const rows = faults.filter((fault) => {
    const machine = machineById.get(fault.machine_id ?? '');
    if (branch !== 'all' && machine?.branch !== branch) return false;
    if (severity !== 'all' && faultTone(fault.severity) !== severity) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [fault.fault_code, fault.detail, fault.severity, machine ? machineTitle(machine) : '', machine?.siteName, machine?.location].join(' ').toLowerCase().includes(term);
  });
  const severityCounts = rows.reduce((counts, fault) => {
    const tone = faultTone(fault.severity);
    counts[tone] = (counts[tone] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const categories = Array.from(rows.reduce((counts, fault) => {
    const category = fault.fault_code.split(/[-_ ]/)[0] || 'Other';
    counts.set(category, (counts.get(category) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxSeverity = Math.max(...Object.values(severityCounts), 1);

  return (
    <>
      <section className="fleet-alert-chart-grid">
        <article className="fleet-panel fleet-alert-severity-panel"><header><div><span>Current workload</span><h2>Alerts by severity</h2></div></header><div className="fleet-alert-bars">{[
          ['Critical', severityCounts.critical ?? 0, 'critical'], ['Faults', severityCounts.fault ?? 0, 'fault'], ['Warnings', severityCounts.warning ?? 0, 'warning'], ['Connectivity', severityCounts.connectivity ?? 0, 'connectivity'],
        ].map(([label, count, tone]) => <div key={String(label)}><span>{label}</span><i><b className={`is-${tone}`} style={{ width: `${(Number(count) / maxSeverity) * 100}%` }} /></i><strong>{count}</strong></div>)}</div></article>
        <article className="fleet-panel fleet-alert-category-panel"><header><div><span>Fault families</span><h2>Alerts by category</h2></div><strong>{rows.length.toLocaleString('en-ZA')}</strong></header>{categories.length ? <div className="fleet-category-summary"><div className="fleet-category-ring"><span><strong>{rows.length}</strong>Total</span></div><dl>{categories.map(([label, count], index) => <div key={label}><dt><i className={`is-${index}`} />{label}</dt><dd>{count}</dd></div>)}</dl></div> : <EmptyState title="No alert categories" message="Fault categories appear when machines report active errors." />}</article>
      </section>

      <section className="fleet-panel fleet-alert-table-panel">
        <div className="fleet-filters fleet-alert-filters"><label className="fleet-search"><NavigationIcon kind="search" /><input aria-label="Search active alerts" placeholder="Search alerts, machines, sites or fault codes" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label><label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="fault">Fault</option><option value="warning">Warning</option><option value="connectivity">Connectivity</option></select></label><button className="fleet-button secondary" onClick={() => { setSearch(''); setBranch('all'); setSeverity('all'); }} type="button">Clear filters</button></div>
        <div className="fleet-table-scroll"><table className="fleet-machine-table fleet-alert-table"><thead><tr><th>Severity</th><th>Machine</th><th>Fault</th><th>Site</th><th>Started</th><th>Last seen</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((fault) => { const machine = machineById.get(fault.machine_id ?? ''); return <tr key={fault.id}><td><span className={`fleet-alert-severity is-${faultTone(fault.severity)}`}>{fault.severity}</span></td><td><strong>{machine ? machineTitle(machine) : 'Unassigned machine'}</strong><span>{machine?.device?.device_code ?? fault.device_id}</span></td><td><strong>{fault.detail ?? fault.fault_code}</strong><span>{fault.fault_code}</span></td><td><strong>{machine?.siteName ?? 'Unassigned'}</strong><span>{machine?.location ?? 'No location'}</span></td><td>{formatDateTime(fault.started_at)}</td><td><strong>{timeAgo(fault.last_seen_at)}</strong><span>{formatDateTime(fault.last_seen_at)}</span></td><td><span className="fleet-alert-status">Unacknowledged</span></td><td>{machine ? <button className="fleet-row-action" aria-label={`View ${machineTitle(machine)} alert`} onClick={() => openMachine(machine, 'errors')} type="button"><NavigationIcon kind="chevron-right" /></button> : '—'}</td></tr>; })}</tbody></table></div>
        <footer className="fleet-table-footer"><div className="fleet-table-footer-copy"><strong>{rows.length.toLocaleString('en-ZA')} active alerts</strong><span>Open a row to review machine context and fault history.</span></div></footer>
      </section>
    </>
  );
}

export function MachineTelemetryOverview({ initialMachineId, initialStatus = 'all', machinesOnly = false }: MachineTelemetryOverviewProps) {
  const { businessProfile, userDetails } = useAuth();
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [sites, setSites] = useState<Record<string, SiteRecord>>({});
  const [devices, setDevices] = useState<DeviceState[]>([]);
  const [faults, setFaults] = useState<FaultRecord[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [trend, setTrend] = useState<TrendRecord[]>([]);
  const [topItems, setTopItems] = useState<ItemRecord[]>([]);
  const [period, setPeriod] = useState<Period>('month');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [status, setStatus] = useState<'all' | ConnectionStatus | 'fault'>(initialStatus);
  const [mode, setMode] = useState<'all' | TelemetryMode>('all');
  const [tablePage, setTablePage] = useState(1);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingDevice, setSavingDevice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const machineRegisterLoaded = useRef(false);

  const canControl = ['admin', 'operations'].includes(userDetails?.role ?? '');
  const firstName = displayProfileName(businessProfile).split(/\s+/)[0] || 'there';

  const load = useCallback(async (quiet = false, refreshRegister = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    const shouldLoadRegister = refreshRegister || !machineRegisterLoaded.current;
    const [machineResult, overviewResult, reportResult] = await Promise.all([
      shouldLoadRegister ? loadMachineRegister(client) : Promise.resolve(null),
      client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
      client.rpc('get_telemetry_reporting', { p_period: period, p_branch: 'all', p_dataset: 'production' }),
    ]);

    if (machineResult?.error) {
      setError(`Machines could not be loaded: ${machineResult.error.message}`);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (machineResult) {
      const machineRows = machineResult.data as MachineRecord[];
      const siteIds = Array.from(new Set(machineRows.map((row) => row.site_id).filter((value): value is string => Boolean(value))));
      const [siteResult, enrichedMachineResult] = await Promise.all([
        loadSites(client, siteIds),
        loadMachineEnrichment(client, machineResult.count),
      ]);

      if (!enrichedMachineResult.error) {
        const enrichment = new Map(enrichedMachineResult.data.map((row) => [row.id, row]));
        machineRows.forEach((row) => Object.assign(row, enrichment.get(row.id) ?? {}));
      }

      setMachines(machineRows);
      setSites(Object.fromEntries(siteResult.data.map((site) => [site.id, site])));
      machineRegisterLoaded.current = true;
    }

    if (!overviewResult.error) {
      const overview = (overviewResult.data ?? {}) as OverviewPayload;
      setDevices((overview.device_states ?? []).map((row) => normaliseDevice(row)));
      setFaults(overview.active_faults ?? []);
    } else {
      const fallback = await loadFallbackDevices(client);
      if (!fallback.error) {
        setDevices(fallback.data.map((row) => normaliseDevice({
          ...row,
          device_status: row.status ?? 'active',
          last_counter_at: row.last_upload_at ?? null,
        })));
      }
    }

    if (!reportResult.error) {
      const report = (reportResult.data ?? {}) as ReportingPayload;
      setSales((report.recent_sales ?? []).map((row) => ({
        ...row,
        units_sold: numberValue(row.units_sold),
        failed_vends: numberValue(row.failed_vends),
        revenue_cents: numberValue(row.revenue_cents),
      })));
      setTrend((report.daily_trend ?? []).map((row) => ({ ...row, units_sold: numberValue(row.units_sold), failed_vends: numberValue(row.failed_vends) })));
      setTopItems((report.top_items ?? []).map((row) => ({ ...row, units_sold: numberValue(row.units_sold), failed_vends: numberValue(row.failed_vends) })));
    } else if (!overviewResult.error) {
      setError(`Sales reporting is temporarily unavailable: ${reportResult.error.message}`);
    }

    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, [period]);

  useEffect(() => {
    load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the machine telemetry workspace.');
      setLoading(false);
      setRefreshing(false);
    });
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const machineRows = useMemo<MachineView[]>(() => {
    const deviceByMachine = new Map(devices.filter((device) => device.machine_id).map((device) => [device.machine_id as string, device]));
    const salesByMachine = new Map<string, { units: number; failed: number }>();
    sales.forEach((sale) => {
      if (!sale.machine_id) return;
      const current = salesByMachine.get(sale.machine_id) ?? { units: 0, failed: 0 };
      current.units += numberValue(sale.units_sold);
      current.failed += numberValue(sale.failed_vends);
      salesByMachine.set(sale.machine_id, current);
    });
    const faultsByMachine = new Map<string, FaultRecord[]>();
    faults.forEach((fault) => {
      if (!fault.machine_id) return;
      faultsByMachine.set(fault.machine_id, [...(faultsByMachine.get(fault.machine_id) ?? []), fault]);
    });

    return machines.map((machine) => {
      const device = deviceByMachine.get(machine.id) ?? null;
      const site = machine.site_id ? sites[machine.site_id] : null;
      const machineSales = salesByMachine.get(machine.id) ?? { units: 0, failed: 0 };
      return {
        ...machine,
        brand: inferBrand(machine),
        type: inferType(machine),
        protocol: machine.telemetry_protocol ?? 'Not recorded',
        siteName: site?.site_name ?? 'Unassigned site',
        location: site?.address ?? machine.current_custodian ?? machine.branch.toUpperCase(),
        device,
        connectionStatus: connectionStatus(device),
        lastContact: device ? device.last_heartbeat_at ?? device.last_seen_at : null,
        unitsSold: machineSales.units,
        failedVends: machineSales.failed,
        faults: faultsByMachine.get(machine.id) ?? [],
      };
    });
  }, [devices, faults, machines, sales, sites]);

  useEffect(() => {
    if (initialMachineId && machineRows.some((machine) => machine.id === initialMachineId)) {
      setSelectedMachineId(initialMachineId);
    }
  }, [initialMachineId, machineRows]);

  const filteredMachines = useMemo(() => {
    const term = search.trim().toLowerCase();
    return machineRows.filter((machine) => {
      if (branch !== 'all' && machine.branch !== branch) return false;
      if (mode !== 'all' && machine.device?.telemetry_mode !== mode) return false;
      if (status === 'fault' && machine.faults.length === 0) return false;
      if (status !== 'all' && status !== 'fault' && machine.connectionStatus !== status) return false;
      if (!term) return true;
      return [
        machineTitle(machine), machine.type, machine.brand, machine.model, machine.serial_number,
        machine.machine_barcode, machine.asset_tag, machine.location, machine.siteName,
        machine.device?.device_code, machine.protocol,
      ].join(' ').toLowerCase().includes(term);
    });
  }, [branch, machineRows, mode, search, status]);

  const tablePageCount = Math.max(1, Math.ceil(filteredMachines.length / TABLE_PAGE_SIZE));
  const currentTablePage = Math.min(tablePage, tablePageCount);
  const visibleMachines = filteredMachines.slice((currentTablePage - 1) * TABLE_PAGE_SIZE, currentTablePage * TABLE_PAGE_SIZE);
  const tableFirstRow = filteredMachines.length === 0 ? 0 : (currentTablePage - 1) * TABLE_PAGE_SIZE + 1;
  const tableLastRow = Math.min(currentTablePage * TABLE_PAGE_SIZE, filteredMachines.length);

  useEffect(() => {
    setTablePage(1);
  }, [branch, mode, search, status]);

  useEffect(() => {
    setTablePage((current) => Math.min(current, tablePageCount));
  }, [tablePageCount]);

  const selectedMachine = selectedMachineId ? machineRows.find((row) => row.id === selectedMachineId) ?? null : null;
  const selectedSales = selectedMachine ? sales.filter((sale) => sale.machine_id === selectedMachine.id) : [];
  const statusCounts = useMemo(() => machineRows.reduce((counts, machine) => {
    counts[machine.connectionStatus] += 1;
    return counts;
  }, { online: 0, delayed: 0, offline: 0, never: 0, unlinked: 0 } as Record<ConnectionStatus, number>), [machineRows]);
  const totalUnits = machineRows.reduce((sum, machine) => sum + machine.unitsSold, 0);
  const totalFaults = machineRows.reduce((sum, machine) => sum + machine.faults.length, 0);
  const branches = Array.from(new Set(machineRows.map((machine) => machine.branch))).sort();

  async function changeMode(machine: MachineView, nextMode: TelemetryMode) {
    if (!machine.device || !canControl) return;
    setSavingDevice(machine.device.device_id);
    setError(null);
    setMessage(null);
    const { error: updateError } = await getSupabaseClient().rpc('set_telemetry_device_control', {
      p_device_code: machine.device.device_code,
      p_mode: nextMode,
      p_transport_preference: null,
      p_wifi_enabled: null,
      p_cellular_enabled: null,
    });
    setSavingDevice(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDevices((current) => current.map((device) => device.device_id === machine.device?.device_id ? { ...device, telemetry_mode: nextMode } : device));
    setMessage(`${machine.device.device_code} was changed to ${nextMode}. The device will confirm it on its next configuration sync.`);
  }

  function openMachine(machine: MachineView, tab: DetailTab = 'overview') {
    setSelectedMachineId(machine.id);
    setDetailTab(tab);
  }

  return (
    <section className={`fleet-workspace ${selectedMachine ? 'has-detail-panel' : ''}`}>
      <div className="fleet-main-column">
        <header className="fleet-page-heading">
          <div>
            <h1>{machinesOnly ? 'Machines' : initialStatus === 'fault' ? 'Active alerts' : `Good morning, ${firstName}`}</h1>
            <p>{machinesOnly ? 'Every machine and its connected telemetry controller.' : initialStatus === 'fault' ? 'Faults, missed heartbeats and telemetry exceptions requiring attention.' : "Here's what needs attention across the machine fleet."}</p>
          </div>
          <div className="fleet-heading-actions">
            <label>Reporting period<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <button className="fleet-button secondary" disabled={refreshing || loading} onClick={() => load(true, true)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh data'}</button>
            <Link className="fleet-button" href="/telemetry/devices"><NavigationIcon kind="settings" />Manage devices</Link>
          </div>
        </header>

        {error ? <div className="fleet-banner is-error" role="alert"><strong>Some information could not be loaded.</strong><span>{error}</span></div> : null}
        {message ? <div className="fleet-banner is-success" role="status"><strong>Configuration saved.</strong><span>{message}</span></div> : null}
        {loading ? <HamsterLoader label="Loading machine telemetry" /> : null}

        {!loading ? (
          <>
            {initialStatus === 'fault' ? (
              <section aria-label="Alert status summary" className="fleet-metric-grid fleet-alert-metric-grid">
                <MetricCard helper="Immediate attention required" icon="bell" label="Critical" tone="red" value={faults.filter((fault) => faultTone(fault.severity) === 'critical').length} />
                <MetricCard helper="Active machine faults" icon="bell" label="Faults" tone="red" value={faults.filter((fault) => faultTone(fault.severity) === 'fault').length} />
                <MetricCard helper="Degraded machine conditions" icon="bell" label="Warnings" tone="amber" value={faults.filter((fault) => faultTone(fault.severity) === 'warning').length} />
                <MetricCard helper="Offline and delayed devices" icon="telemetry" label="Connectivity" tone="blue" value={statusCounts.offline + statusCounts.delayed} />
              </section>
            ) : (
              <section aria-label="Fleet status summary" className="fleet-metric-grid">
                <MetricCard helper={`${machineRows.length - statusCounts.unlinked} with telemetry`} icon="tool" label="Total machines" tone="blue" value={machineRows.length} />
                <MetricCard helper={`${machineRows.length ? Math.round((statusCounts.online / machineRows.length) * 100) : 0}% of the fleet`} icon="telemetry" label={machinesOnly ? 'Connected devices' : 'Online'} tone="green" value={statusCounts.online} />
                <MetricCard helper={machinesOnly ? 'Machines awaiting a device' : `${statusCounts.delayed} delayed · ${statusCounts.never} never seen`} icon={machinesOnly ? 'settings' : 'telemetry'} label={machinesOnly ? 'Unlinked machines' : 'Offline'} tone={machinesOnly ? 'amber' : 'grey'} value={machinesOnly ? statusCounts.unlinked : statusCounts.offline} />
                <MetricCard helper={`${machineRows.filter((row) => row.failedVends > 0).length} machines with failed vends`} icon="bell" label={machinesOnly ? 'Online' : 'Active faults'} tone={machinesOnly ? 'green' : 'red'} value={machinesOnly ? statusCounts.online : totalFaults} />
                <MetricCard helper={periods.find((item) => item.value === period)?.label ?? period} icon={machinesOnly ? 'bell' : 'sales'} label={machinesOnly ? 'Faults' : 'Items sold'} tone={machinesOnly ? 'red' : 'blue'} value={machinesOnly ? totalFaults : totalUnits} />
              </section>
            )}

            {!machinesOnly && initialStatus !== 'fault' ? (
              <section className="fleet-insight-grid fleet-overview-insight-grid">
                <article className="fleet-panel fleet-trend-panel">
                  <header><div><span>Sales activity</span><h2>Quantity sold over time</h2></div><strong>{totalUnits.toLocaleString('en-ZA')} units</strong></header>
                  <TrendChart rows={trend} />
                </article>
                <article className="fleet-panel fleet-health-panel">
                  <header><div><span>Connection health</span><h2>Fleet availability</h2></div></header>
                  <div className="fleet-health-content">
                    <div className="fleet-health-ring" style={{ background: `conic-gradient(#20a35a 0 ${(statusCounts.online / Math.max(machineRows.length, 1)) * 100}%, #f2a900 0 ${((statusCounts.online + statusCounts.delayed) / Math.max(machineRows.length, 1)) * 100}%, #d71920 0 ${((statusCounts.online + statusCounts.delayed + statusCounts.offline) / Math.max(machineRows.length, 1)) * 100}%, #98a2b3 0)` }}><span><strong>{machineRows.length}</strong>Total</span></div>
                    <dl>
                      <div><dt><i className="is-green" />Online</dt><dd>{statusCounts.online}</dd></div>
                      <div><dt><i className="is-amber" />Delayed</dt><dd>{statusCounts.delayed}</dd></div>
                      <div><dt><i className="is-red" />Offline</dt><dd>{statusCounts.offline}</dd></div>
                      <div><dt><i className="is-grey" />Unlinked / never</dt><dd>{statusCounts.unlinked + statusCounts.never}</dd></div>
                    </dl>
                  </div>
                </article>
                <article className="fleet-panel fleet-products-panel">
                  <header><div><span>Product performance</span><h2>Top items by quantity</h2></div><Link href="/telemetry">Full analytics</Link></header>
                  <ProductBars items={topItems} />
                </article>
              </section>
            ) : null}

            {!machinesOnly && initialStatus !== 'fault' ? <OverviewOperationsGrid faults={faults} machines={machineRows} openMachine={openMachine} sales={sales} /> : null}

            {initialStatus === 'fault' ? <AlertsWorkspace branch={branch} branches={branches} faults={faults} machines={machineRows} openMachine={openMachine} search={search} setBranch={setBranch} setSearch={setSearch} /> : null}

            <section className={`fleet-panel fleet-table-panel ${machinesOnly ? '' : 'fleet-table-hidden'}`}>
              <header className="fleet-table-heading">
                <div><span>Fleet register</span><h2>Machines and connected devices</h2></div>
                <span>{filteredMachines.length.toLocaleString('en-ZA')} of {machineRows.length.toLocaleString('en-ZA')} machines</span>
              </header>
              <div className="fleet-filters">
                <label className="fleet-search"><NavigationIcon kind="search" /><input aria-label="Search machines" placeholder="Search machine, serial, QR, location or device" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <label><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
                <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="online">Online</option><option value="delayed">Delayed</option><option value="offline">Offline</option><option value="never">Never connected</option><option value="unlinked">No device</option><option value="fault">Active errors</option></select></label>
                <label><span>Update mode</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="all">All modes</option><option value="live">Live</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select></label>
              </div>

              {filteredMachines.length === 0 ? <EmptyState title="No machines match these filters" message="Clear a filter or search for another machine, serial number, QR number or device ID." /> : (
                <div className="fleet-table-scroll">
                  <table className="fleet-machine-table">
                    <thead><tr><th>Status</th><th>Machine</th><th>Identifiers</th><th>Location</th><th>Telemetry device</th><th>Update mode</th><th>Items sold</th><th>Errors</th><th>Last contact</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {visibleMachines.map((machine) => (
                        <tr className={selectedMachineId === machine.id ? 'is-selected' : undefined} key={machine.id}>
                          <td><StatusPill value={machine.connectionStatus} /></td>
                          <td><button className="fleet-machine-link" onClick={() => openMachine(machine)} type="button"><strong>{machineTitle(machine)}</strong><span>{machine.type} · {machine.brand} · {machine.status}</span></button></td>
                          <td><strong>{machine.serial_number ?? 'No serial'}</strong><span>QR {machine.machine_barcode ?? machine.asset_tag ?? 'not recorded'}</span></td>
                          <td><strong>{machine.siteName}</strong><span>{machine.location}</span></td>
                          <td>{machine.device ? <><strong>{machine.device.device_code}</strong><span>{machine.protocol} · machine {machine.device.machine_status} · {machine.device.last_transport ?? 'No network yet'}</span></> : <><strong>Not connected</strong><span>Assign a telemetry device</span></>}</td>
                          <td>{machine.device && canControl ? <select aria-label={`Update mode for ${machineTitle(machine)}`} disabled={savingDevice === machine.device.device_id} onChange={(event) => changeMode(machine, event.target.value as TelemetryMode)} value={machine.device.telemetry_mode}><option value="live">Live</option><option value="daily">Daily</option><option value="monthly">Monthly</option></select> : <span className="fleet-mode-label">{machine.device?.telemetry_mode ?? '—'}</span>}</td>
                          <td><strong className="fleet-number">{machine.unitsSold.toLocaleString('en-ZA')}</strong><span>{machine.failedVends} failed</span></td>
                          <td><button className={`fleet-error-count ${machine.faults.length ? 'has-errors' : ''}`} onClick={() => openMachine(machine, 'errors')} type="button">{machine.faults.length}</button></td>
                          <td><strong>{timeAgo(machine.lastContact)}</strong><span>{formatDateTime(machine.lastContact)}</span></td>
                          <td><button aria-label={`View ${machineTitle(machine)}`} className="fleet-row-action" onClick={() => openMachine(machine)} type="button"><NavigationIcon kind="chevron-right" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <footer className="fleet-table-footer">
                <div className="fleet-table-footer-copy"><strong>Showing {tableFirstRow.toLocaleString('en-ZA')}–{tableLastRow.toLocaleString('en-ZA')} of {filteredMachines.length.toLocaleString('en-ZA')}</strong><span>Updated {lastUpdated ? timeAgo(lastUpdated.toISOString()) : 'never'} · Online uses the independent device heartbeat.</span></div>
                <div aria-label="Machine table pagination" className="fleet-table-pagination"><button disabled={currentTablePage === 1} onClick={() => setTablePage((current) => Math.max(1, current - 1))} type="button">Previous</button><span>Page {currentTablePage} of {tablePageCount}</span><button disabled={currentTablePage === tablePageCount} onClick={() => setTablePage((current) => Math.min(tablePageCount, current + 1))} type="button">Next</button></div>
              </footer>
            </section>
          </>
        ) : null}
      </div>

      {selectedMachine ? (
        <aside aria-label={`${machineTitle(selectedMachine)} details`} className="fleet-detail-panel">
          <header className="fleet-detail-header">
            <div><span>{selectedMachine.serial_number ?? selectedMachine.asset_tag ?? 'Machine record'}</span><h2>{machineTitle(selectedMachine)}</h2><StatusPill value={selectedMachine.connectionStatus} /></div>
            <button aria-label="Close machine details" onClick={() => setSelectedMachineId(null)} type="button">×</button>
          </header>
          <nav aria-label="Machine detail sections" className="fleet-detail-tabs">{detailTabs.map((tab) => <button aria-current={detailTab === tab.value ? 'page' : undefined} key={tab.value} onClick={() => setDetailTab(tab.value)} type="button">{tab.label}{tab.value === 'errors' && selectedMachine.faults.length ? <span>{selectedMachine.faults.length}</span> : null}</button>)}</nav>

          <div className="fleet-detail-body">
            {detailTab === 'overview' ? (
              <>
                {selectedMachine.faults[0] ? <div className="fleet-critical-callout"><NavigationIcon kind="bell" /><div><strong>{selectedMachine.faults[0].severity} fault</strong><span>{selectedMachine.faults[0].detail ?? selectedMachine.faults[0].fault_code}</span><small>Since {formatDateTime(selectedMachine.faults[0].started_at)}</small></div></div> : null}
                <DetailSection title="Machine identity"><DetailList rows={[
                  ['Machine type', selectedMachine.type], ['Brand', selectedMachine.brand], ['Model', selectedMachine.model ?? 'Not recorded'], ['Machine record status', selectedMachine.status], ['Serial number', selectedMachine.serial_number ?? 'Not recorded'], ['QR number', selectedMachine.machine_barcode ?? selectedMachine.asset_tag ?? 'Not recorded'], ['Protocol', selectedMachine.protocol],
                ]} /></DetailSection>
                <DetailSection title="Location"><DetailList rows={[["Site", selectedMachine.siteName], ['Address', selectedMachine.location], ['Branch', selectedMachine.branch.toUpperCase()]]} /></DetailSection>
                <DetailSection title="Current performance"><div className="fleet-detail-stats"><div><strong>{selectedMachine.unitsSold.toLocaleString('en-ZA')}</strong><span>items sold</span></div><div><strong>{selectedMachine.failedVends.toLocaleString('en-ZA')}</strong><span>failed vends</span></div><div><strong>{selectedMachine.faults.length}</strong><span>active errors</span></div></div></DetailSection>
              </>
            ) : null}

            {detailTab === 'sales' ? (
              <DetailSection title={`Item quantities · ${periods.find((item) => item.value === period)?.label ?? period}`}>
                {selectedSales.length === 0 ? <EmptyState title="No sales received" message="No item counters were received for this machine in the selected period." /> : <div className="fleet-detail-list">{selectedSales.sort((a, b) => b.units_sold - a.units_sold).map((sale) => <div key={sale.id}><div><strong>{sale.product_name ?? sale.sku ?? sale.selection_code}</strong><span>Selection {sale.selection_code} · {sale.failed_vends} failed</span></div><strong>{sale.units_sold.toLocaleString('en-ZA')}</strong></div>)}</div>}
              </DetailSection>
            ) : null}

            {detailTab === 'errors' ? (
              <DetailSection title="Active machine errors">
                {selectedMachine.faults.length === 0 ? <EmptyState title="No active errors" message="This machine has not reported an unresolved fault." /> : <div className="fleet-fault-list">{selectedMachine.faults.map((fault) => <article key={fault.id}><header><strong>{fault.fault_code}</strong><span className={`is-${fault.severity}`}>{fault.severity}</span></header><p>{fault.detail ?? 'No additional detail was reported.'}</p><dl><div><dt>First detected</dt><dd>{formatDateTime(fault.started_at)}</dd></div><div><dt>Last detected</dt><dd>{formatDateTime(fault.last_seen_at)}</dd></div></dl></article>)}</div>}
              </DetailSection>
            ) : null}

            {detailTab === 'telemetry' ? (
              <DetailSection title="Telemetry device health">
                {selectedMachine.device ? <DetailList rows={[
                  ['Device ID', selectedMachine.device.device_code], ['Device registration', selectedMachine.device.device_status], ['Device connection', statusLabel(selectedMachine.connectionStatus)], ['Machine communication', selectedMachine.device.machine_status], ['Last heartbeat', formatDateTime(selectedMachine.device.last_heartbeat_at)], ['Last counter upload', formatDateTime(selectedMachine.device.last_counter_at)], ['Network', selectedMachine.device.last_transport ?? 'Not reported'], ['Wi-Fi signal', selectedMachine.device.wifi_rssi === null ? 'Not reported' : `${selectedMachine.device.wifi_rssi} dBm`], ['Cellular signal', selectedMachine.device.cellular_csq === null ? 'Not reported' : `CSQ ${selectedMachine.device.cellular_csq}`], ['Operator', selectedMachine.device.cellular_operator ?? 'Not reported'], ['Firmware', selectedMachine.device.firmware_version ?? 'Not reported'],
                ]} /> : <EmptyState title="No telemetry device assigned" message="Assign a device before connection health and counters can be monitored." />}
              </DetailSection>
            ) : null}

            {detailTab === 'configuration' ? (
              <DetailSection title="Remote configuration">
                {selectedMachine.device ? <div className="fleet-config-panel"><label>Device update mode<select disabled={!canControl || savingDevice === selectedMachine.device.device_id} value={selectedMachine.device.telemetry_mode} onChange={(event) => changeMode(selectedMachine, event.target.value as TelemetryMode)}><option value="live">Live telemetry</option><option value="daily">Daily summary</option><option value="monthly">Monthly summary</option></select></label><div className="fleet-config-status"><span>Requested mode</span><strong>{selectedMachine.device.telemetry_mode}</strong><small>Last device configuration sync: {formatDateTime(selectedMachine.device.last_config_at)}</small></div><p>Heartbeats and critical errors continue independently of the detailed sales reporting schedule.</p>{!canControl ? <small>Your role has read-only access to device configuration.</small> : null}</div> : <EmptyState title="Configuration unavailable" message="This machine does not have an assigned telemetry device." />}
              </DetailSection>
            ) : null}
          </div>
        </aside>
      ) : null}
    </section>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="fleet-detail-section"><h3>{title}</h3>{children}</section>;
}

function DetailList({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="fleet-detail-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
