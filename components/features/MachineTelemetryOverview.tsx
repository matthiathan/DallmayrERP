'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';

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

export function MachineTelemetryOverview({ initialMachineId, initialStatus = 'all', machinesOnly = false }: MachineTelemetryOverviewProps) {
  const { userDetails } = useAuth();
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
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingDevice, setSavingDevice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canControl = ['admin', 'operations'].includes(userDetails?.role ?? '');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    const [machineResult, overviewResult, reportResult] = await Promise.all([
      client.from('machines').select('id,branch,site_id,serial_number,machine_barcode,asset_tag,machine_name,model,status,current_custodian').order('machine_name').limit(5000),
      client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
      client.rpc('get_telemetry_reporting', { p_period: period, p_branch: 'all', p_dataset: 'production' }),
    ]);

    if (machineResult.error) {
      setError(`Machines could not be loaded: ${machineResult.error.message}`);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const machineRows = (machineResult.data ?? []) as MachineRecord[];
    const siteIds = Array.from(new Set(machineRows.map((row) => row.site_id).filter((value): value is string => Boolean(value))));
    const [siteResult, enrichedMachineResult] = await Promise.all([
      siteIds.length
        ? client.from('customer_sites').select('id,site_name,address').in('id', siteIds)
        : Promise.resolve({ data: [], error: null }),
      client.from('machines').select('id,manufacturer,machine_type,telemetry_protocol').limit(5000),
    ]);

    if (!enrichedMachineResult.error) {
      const enrichment = new Map(((enrichedMachineResult.data ?? []) as Array<Pick<MachineRecord, 'id' | 'manufacturer' | 'machine_type' | 'telemetry_protocol'>>).map((row) => [row.id, row]));
      machineRows.forEach((row) => Object.assign(row, enrichment.get(row.id) ?? {}));
    }

    setMachines(machineRows);
    setSites(Object.fromEntries(((siteResult.data ?? []) as SiteRecord[]).map((site) => [site.id, site])));

    if (!overviewResult.error) {
      const overview = (overviewResult.data ?? {}) as OverviewPayload;
      setDevices((overview.device_states ?? []).map((row) => normaliseDevice(row)));
      setFaults(overview.active_faults ?? []);
    } else {
      const fallback = await client.from('telemetry_devices').select('id,device_code,machine_id,status,firmware_version,wifi_rssi,last_seen_at,last_upload_at,last_sequence,updated_at').eq('status', 'active').limit(5000);
      if (!fallback.error) {
        setDevices(((fallback.data ?? []) as Array<Partial<DeviceState> & { id: string; status?: string; last_upload_at?: string | null }>).map((row) => normaliseDevice({
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
            <span className="fleet-eyebrow">Machine &amp; telemetry monitoring</span>
            <h1>{machinesOnly ? 'Machines' : initialStatus === 'fault' ? 'Active alerts' : 'Fleet overview'}</h1>
            <p>{machinesOnly ? 'Every machine and its connected telemetry controller.' : 'Machine health, sales counters, faults and connectivity in one focused workspace.'}</p>
          </div>
          <div className="fleet-heading-actions">
            <label>Reporting period<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <button className="fleet-button secondary" disabled={refreshing || loading} onClick={() => load(true)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh data'}</button>
            <Link className="fleet-button" href="/telemetry/devices"><NavigationIcon kind="settings" />Manage devices</Link>
          </div>
        </header>

        {error ? <div className="fleet-banner is-error" role="alert"><strong>Some information could not be loaded.</strong><span>{error}</span></div> : null}
        {message ? <div className="fleet-banner is-success" role="status"><strong>Configuration saved.</strong><span>{message}</span></div> : null}
        {loading ? <HamsterLoader label="Loading machine telemetry" /> : null}

        {!loading ? (
          <>
            <section aria-label="Fleet status summary" className="fleet-metric-grid">
              <MetricCard helper={`${machineRows.length - statusCounts.unlinked} with telemetry`} icon="tool" label="Total machines" tone="blue" value={machineRows.length} />
              <MetricCard helper={`${machineRows.length ? Math.round((statusCounts.online / machineRows.length) * 100) : 0}% of the fleet`} icon="telemetry" label="Online" tone="green" value={statusCounts.online} />
              <MetricCard helper={`${statusCounts.delayed} delayed · ${statusCounts.never} never seen`} icon="bell" label="Offline" tone="red" value={statusCounts.offline} />
              <MetricCard helper={`${machineRows.filter((row) => row.failedVends > 0).length} machines with failed vends`} icon="bell" label="Active errors" tone="amber" value={totalFaults} />
              <MetricCard helper={periods.find((item) => item.value === period)?.label ?? period} icon="chart" label="Items sold" tone="green" value={totalUnits} />
            </section>

            {!machinesOnly && initialStatus !== 'fault' ? (
              <section className="fleet-insight-grid">
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

            <section className="fleet-panel fleet-table-panel">
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
                      {filteredMachines.map((machine) => (
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
              <footer className="fleet-table-footer"><span>Updated {lastUpdated ? timeAgo(lastUpdated.toISOString()) : 'never'}</span><span>Online uses the independent device heartbeat, not the sales upload schedule.</span></footer>
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
