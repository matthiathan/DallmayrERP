'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { SignalStrengthIndicator, signalStrengthForTransport } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';

type Period = 'day' | 'week' | 'month' | 'six_months';

type MachineRecord = {
  id: string;
  branch: string;
  customer_id: string | null;
  site_id: string | null;
  asset_tag: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  machine_name: string | null;
  model: string | null;
  status: string;
  current_custodian: string | null;
  manufacturer: string | null;
  condition: string | null;
  criticality: string | null;
  installed_at: string | null;
  last_service_at: string | null;
  next_service_at: string | null;
};

type SiteRecord = {
  id: string;
  site_name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

type CustomerRecord = {
  id: string;
  customer_name: string | null;
  customer_code: string | null;
};

type DeviceRecord = {
  id: string;
  device_code: string;
  status: string;
  profile_id: string | null;
  firmware_version: string | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  cellular_model: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  transport_preference: 'auto' | 'wifi' | 'cellular';
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_counter_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
  last_fault_at: string | null;
  last_recovery_at: string | null;
  hardware_uid: string | null;
  reported_machine_serial: string | null;
  machine_link_status: string | null;
  machine_link_method: string | null;
  applied_config: Record<string, unknown> | null;
};

type SaleRecord = {
  id: string;
  sales_date: string;
  selection_code: string;
  product_key: string;
  sku: string | null;
  product_name: string | null;
  brand: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
  last_received_at: string;
};

type CounterRecord = {
  selection_code: string;
  sold_total: number;
  failed_total: number;
  revenue_cents_total: number;
  updated_at: string;
};

type FaultRecord = {
  id: string;
  fault_code: string;
  severity: string;
  source: string;
  detail: string | null;
  started_at: string;
  last_seen_at: string;
  cleared_at: string | null;
};

type DataUsageSummary = {
  device_id: string;
  request_count: number;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  last_reported_at: string | null;
  projected_monthly_application_bytes: number;
  projected_monthly_device_application_bytes: number | null;
  projected_monthly_modem_bytes: number | null;
};

type ProductSummary = {
  key: string;
  label: string;
  selection: string;
  units: number;
  failed: number;
  revenueCents: number;
};

type TrendPoint = { date: string; units: number };

const periods: Array<{ value: Period; label: string; days: number }> = [
  { value: 'day', label: 'Today', days: 0 },
  { value: 'week', label: '7 days', days: 6 },
  { value: 'month', label: '30 days', days: 29 },
  { value: 'six_months', label: '6 months', days: 182 },
];

const PAGE_SIZE = 1000;

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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

function formatBytes(value: number | null | undefined) {
  const bytes = numberValue(value);
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** unit);
  return `${amount.toFixed(unit === 0 ? 0 : amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatRand(cents: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(numberValue(cents) / 100);
}

function machineTitle(machine: MachineRecord | null) {
  if (!machine) return 'Machine';
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.asset_tag ?? 'Unnamed machine';
}

function dateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function periodStart(period: Period) {
  const config = periods.find((item) => item.value === period) ?? periods[2];
  const start = new Date();
  start.setDate(start.getDate() - config.days);
  return dateKey(start);
}

function connectionStatus(device: DeviceRecord | null) {
  const contact = device?.last_heartbeat_at ?? device?.last_seen_at ?? null;
  if (!contact) return { online: false, label: device ? 'Never connected' : 'No device' };
  const age = Date.now() - new Date(contact).getTime();
  if (age <= 30 * 60 * 1000) return { online: true, label: 'Online' };
  if (age <= 24 * 60 * 60 * 1000) return { online: false, label: 'Delayed' };
  return { online: false, label: 'Offline' };
}

async function loadSales(machineId: string, startDate: string) {
  const client = getSupabaseClient();
  const rows: SaleRecord[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('telemetry_daily_item_sales')
      .select('id,sales_date,selection_code,product_key,sku,product_name,brand,units_sold,failed_vends,revenue_cents,last_received_at')
      .eq('machine_id', machineId)
      .gte('sales_date', startDate)
      .order('sales_date', { ascending: true })
      .order('selection_code', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as SaleRecord[];
    rows.push(...page.map((row) => ({
      ...row,
      units_sold: numberValue(row.units_sold),
      failed_vends: numberValue(row.failed_vends),
      revenue_cents: numberValue(row.revenue_cents),
    })));
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function MachineTrend({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return <div className="fleet-empty-state"><strong>No vend trend yet</strong><p>Vend quantities will appear here when this machine reports counters.</p></div>;
  const max = Math.max(...points.map((point) => point.units), 1);
  const width = 720;
  const height = 210;
  const paddingX = 26;
  const paddingY = 24;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: paddingX + (index / Math.max(points.length - 1, 1)) * (width - paddingX * 2),
    y: height - paddingY - (point.units / max) * (height - paddingY * 2),
  }));
  const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');
  return (
    <div className="fleet-trend-chart">
      <svg aria-label="Machine vend quantity over time" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
        {[0, 1, 2, 3].map((line) => <line key={line} x1={paddingX} x2={width - paddingX} y1={paddingY + line * 48} y2={paddingY + line * 48} />)}
        <polyline className="fleet-trend-area" points={`${paddingX},${height - paddingY} ${polyline} ${width - paddingX},${height - paddingY}`} />
        <polyline className="fleet-trend-line" points={polyline} />
        {chartPoints.map((point) => <circle key={point.date} cx={point.x} cy={point.y} r="4" />)}
      </svg>
      <div className="fleet-trend-labels">
        {points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 5)) === 0).map((point) => <span key={point.date}>{new Date(`${point.date}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}</span>)}
      </div>
    </div>
  );
}

function ProductBars({ products }: { products: ProductSummary[] }) {
  const visible = products.slice(0, 8);
  if (visible.length === 0) return <div className="fleet-empty-state"><strong>No products reported</strong><p>Selections will appear after this machine records successful vends.</p></div>;
  const max = Math.max(...visible.map((product) => product.units), 1);
  return (
    <div className="fleet-product-bars">
      {visible.map((product) => (
        <div key={product.key}>
          <span title={`${product.label} · ${product.selection}`}>{product.label}</span>
          <i><b style={{ width: `${Math.max(3, (product.units / max) * 100)}%` }} /></i>
          <strong>{product.units.toLocaleString('en-ZA')}</strong>
        </div>
      ))}
    </div>
  );
}

export function MachineDashboard({ machineId }: { machineId: string }) {
  const [period, setPeriod] = useState<Period>('month');
  const [machine, setMachine] = useState<MachineRecord | null>(null);
  const [site, setSite] = useState<SiteRecord | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [counters, setCounters] = useState<CounterRecord[]>([]);
  const [faults, setFaults] = useState<FaultRecord[]>([]);
  const [usage, setUsage] = useState<DataUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    try {
      const [machineResult, deviceResult] = await Promise.all([
        client
          .from('machines')
          .select('id,branch,customer_id,site_id,asset_tag,serial_number,machine_barcode,machine_name,model,status,current_custodian,manufacturer,condition,criticality,installed_at,last_service_at,next_service_at')
          .eq('id', machineId)
          .maybeSingle(),
        client
          .from('telemetry_devices')
          .select('id,device_code,status,profile_id,firmware_version,wifi_rssi,cellular_csq,cellular_operator,cellular_model,last_transport,transport_preference,last_seen_at,last_upload_at,last_counter_at,last_heartbeat_at,last_config_at,last_config_ack_at,last_fault_at,last_recovery_at,hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,applied_config')
          .eq('machine_id', machineId)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (machineResult.error) throw machineResult.error;
      if (deviceResult.error) throw deviceResult.error;
      const nextMachine = machineResult.data as MachineRecord | null;
      if (!nextMachine) throw new Error('Machine not found or you do not have access to it.');
      const nextDevice = deviceResult.data as DeviceRecord | null;

      const sitePromise = nextMachine.site_id
        ? client.from('customer_sites').select('id,site_name,address,latitude,longitude').eq('id', nextMachine.site_id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const customerPromise = nextMachine.customer_id
        ? client.from('customers').select('id,customer_name,customer_code').eq('id', nextMachine.customer_id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const faultsPromise = client
        .from('telemetry_fault_events')
        .select('id,fault_code,severity,source,detail,started_at,last_seen_at,cleared_at')
        .eq('machine_id', machineId)
        .order('last_seen_at', { ascending: false })
        .limit(100);
      const salesPromise = loadSales(machineId, periodStart(period));
      const countersPromise = nextDevice
        ? client.from('telemetry_counter_state').select('selection_code,sold_total,failed_total,revenue_cents_total,updated_at').eq('device_id', nextDevice.id).order('selection_code')
        : Promise.resolve({ data: [], error: null });
      const usagePromise = nextDevice
        ? client.rpc('get_telemetry_data_usage', { p_days: 30 }).eq('device_id', nextDevice.id).maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [siteResult, customerResult, faultsResult, nextSales, countersResult, usageResult] = await Promise.all([
        sitePromise, customerPromise, faultsPromise, salesPromise, countersPromise, usagePromise,
      ]);
      if (siteResult.error) throw siteResult.error;
      if (customerResult.error) throw customerResult.error;
      if (faultsResult.error) throw faultsResult.error;
      if (countersResult.error) throw countersResult.error;
      if (usageResult.error) throw usageResult.error;

      setMachine(nextMachine);
      setDevice(nextDevice);
      setSite(siteResult.data as SiteRecord | null);
      setCustomer(customerResult.data as CustomerRecord | null);
      setSales(nextSales);
      setFaults((faultsResult.data ?? []) as FaultRecord[]);
      setCounters(((countersResult.data ?? []) as CounterRecord[]).map((row) => ({
        ...row,
        sold_total: numberValue(row.sold_total),
        failed_total: numberValue(row.failed_total),
        revenue_cents_total: numberValue(row.revenue_cents_total),
      })));
      setUsage(usageResult.data ? ({ ...(usageResult.data as DataUsageSummary) }) : null);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load this machine dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [machineId, period]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const productSummaries = useMemo(() => {
    const products = new Map<string, ProductSummary>();
    sales.forEach((sale) => {
      const key = sale.product_key || sale.selection_code;
      const current = products.get(key) ?? {
        key,
        label: sale.product_name ?? sale.sku ?? sale.selection_code,
        selection: sale.selection_code,
        units: 0,
        failed: 0,
        revenueCents: 0,
      };
      current.units += numberValue(sale.units_sold);
      current.failed += numberValue(sale.failed_vends);
      current.revenueCents += numberValue(sale.revenue_cents);
      if (!current.label || current.label === current.selection) current.label = sale.product_name ?? sale.sku ?? sale.selection_code;
      products.set(key, current);
    });
    return [...products.values()].sort((left, right) => right.units - left.units || left.label.localeCompare(right.label));
  }, [sales]);

  const trend = useMemo(() => {
    const byDate = new Map<string, number>();
    sales.forEach((sale) => byDate.set(sale.sales_date, (byDate.get(sale.sales_date) ?? 0) + numberValue(sale.units_sold)));
    return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, units]) => ({ date, units }));
  }, [sales]);

  const totals = useMemo(() => sales.reduce((summary, sale) => ({
    units: summary.units + numberValue(sale.units_sold),
    failed: summary.failed + numberValue(sale.failed_vends),
    revenueCents: summary.revenueCents + numberValue(sale.revenue_cents),
  }), { units: 0, failed: 0, revenueCents: 0 }), [sales]);

  const lifetime = useMemo(() => counters.reduce((summary, counter) => ({
    units: summary.units + numberValue(counter.sold_total),
    failed: summary.failed + numberValue(counter.failed_total),
    revenueCents: summary.revenueCents + numberValue(counter.revenue_cents_total),
  }), { units: 0, failed: 0, revenueCents: 0 }), [counters]);

  const activeFaults = faults.filter((fault) => !fault.cleared_at);
  const status = connectionStatus(device);
  const lastContact = device?.last_heartbeat_at ?? device?.last_seen_at ?? null;
  const signal = signalStrengthForTransport(device?.last_transport ?? null, device?.wifi_rssi ?? null, device?.cellular_csq ?? null);
  const usedBytes = usage
    ? numberValue(usage.modem_sample_count) > 0
      ? numberValue(usage.measured_modem_bytes)
      : Math.max(numberValue(usage.application_bytes), numberValue(usage.device_application_bytes))
    : 0;
  const projectedBytes = usage
    ? numberValue(usage.projected_monthly_modem_bytes ?? usage.projected_monthly_device_application_bytes ?? usage.projected_monthly_application_bytes)
    : 0;
  const mode = typeof device?.applied_config?.mode === 'string' ? device.applied_config.mode : 'Not reported';
  const productLabelBySelection = new Map(productSummaries.map((product) => [product.selection, product.label]));
  const recentSales = [...sales].sort((left, right) => new Date(right.last_received_at).getTime() - new Date(left.last_received_at).getTime()).slice(0, 20);

  if (loading) return <HamsterLoader label="Loading machine dashboard" />;

  if (error || !machine) {
    return (
      <section className="cx-dashboard">
        <div className="fleet-banner is-error" role="alert"><strong>Machine dashboard unavailable.</strong><span>{error ?? 'Machine not found.'}</span></div>
        <Link className="fleet-button secondary" href="/machines">← Back to machines</Link>
      </section>
    );
  }

  return (
    <section className="cx-dashboard">
      <div className="cx-dashboard-hero">
        <div className="cx-dashboard-hero-copy">
          <Link href="/machines">← Machines</Link>
          <span className="cx-dashboard-live"><i aria-hidden="true" />Machine dashboard</span>
          <h1>{machineTitle(machine)}</h1>
          <p>{customer?.customer_name ?? 'No client assigned'} · {site?.site_name ?? 'No site assigned'} · {machine.serial_number ? `S/N ${machine.serial_number}` : 'No serial number'}</p>
        </div>
        <div className="cx-dashboard-hero-status">
          <span>Telemetry status</span>
          <strong>{status.label}</strong>
          <small>{device ? `${device.device_code} · ${timeAgo(lastContact)}` : 'No telemetry device assigned'}</small>
        </div>
      </div>

      <div className="fleet-heading-actions">
        <label>Reporting period<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <button className="fleet-button secondary" disabled={refreshing} onClick={() => load(true)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh data'}</button>
      </div>

      <section aria-label="Machine performance summary" className="cx-dashboard-kpis">
        <article className="erp-metric-card"><div><span>Items sold</span><strong>{totals.units.toLocaleString('en-ZA')}</strong><p>{periods.find((item) => item.value === period)?.label}</p></div></article>
        <article className="erp-metric-card"><div><span>Lifetime cups</span><strong>{lifetime.units.toLocaleString('en-ZA')}</strong><p>Current device counter epoch</p></div></article>
        <article className="erp-metric-card"><div><span>Failed vends</span><strong>{totals.failed.toLocaleString('en-ZA')}</strong><p>{formatRand(totals.revenueCents)} recorded revenue</p></div></article>
        <article className="erp-metric-card"><div><span>Active faults</span><strong>{activeFaults.length.toLocaleString('en-ZA')}</strong><p>{activeFaults.length ? 'Needs attention' : 'No unresolved faults'}</p></div></article>
        <article className="erp-metric-card"><div><span>30-day data</span><strong>{formatBytes(usedBytes)}</strong><p>{usage ? 'Best available measured usage' : 'No usage reported'}</p></div></article>
        <article className="erp-metric-card"><div><span>Signal</span><strong>{signal.label}</strong><p>{signal.detail}</p></div></article>
      </section>

      <section className="fleet-insight-grid fleet-overview-insight-grid">
        <article className="fleet-panel fleet-trend-panel">
          <header><div><span>Vend activity</span><h2>Quantity sold over time</h2></div><strong>{totals.units.toLocaleString('en-ZA')} units</strong></header>
          <MachineTrend points={trend} />
        </article>
        <article className="fleet-panel fleet-products-panel">
          <header><div><span>Product performance</span><h2>What this machine vended</h2></div><strong>{productSummaries.length.toLocaleString('en-ZA')} selections</strong></header>
          <ProductBars products={productSummaries} />
        </article>
        <article className="fleet-panel fleet-health-panel">
          <header><div><span>Telemetry health</span><h2>Connection and data</h2></div></header>
          {device ? (
            <dl className="fleet-detail-grid">
              <div><dt>Network</dt><dd>{device.last_transport === 'cellular' ? 'Cellular' : device.last_transport === 'wifi' ? 'Wi-Fi' : 'Not reported'}</dd></div>
              <div><dt>Signal</dt><dd><SignalStrengthIndicator cellularCsq={device.cellular_csq} transport={device.last_transport} wifiRssi={device.wifi_rssi} /></dd></div>
              <div><dt>Operator</dt><dd>{device.cellular_operator ?? 'Not reported'}</dd></div>
              <div><dt>Reporting mode</dt><dd>{mode}</dd></div>
              <div><dt>Last heartbeat</dt><dd>{formatDateTime(device.last_heartbeat_at)}</dd></div>
              <div><dt>Last counter</dt><dd>{formatDateTime(device.last_counter_at)}</dd></div>
            </dl>
          ) : <div className="fleet-empty-state"><strong>No telemetry device</strong><p>Assign a telemetry controller to monitor this machine.</p></div>}
        </article>
      </section>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading"><div><span>Products and selections</span><h2>Vend totals for this machine</h2></div><span>{productSummaries.length.toLocaleString('en-ZA')} products / selections</span></header>
        {productSummaries.length === 0 ? <div className="fleet-empty-state"><strong>No vends recorded</strong><p>This machine has not reported item counters in the selected period.</p></div> : (
          <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Product</th><th>Machine selection</th><th>Units sold</th><th>Failed vends</th><th>Revenue</th></tr></thead><tbody>{productSummaries.map((product) => <tr key={product.key}><td><strong>{product.label}</strong></td><td>{product.selection}</td><td><strong>{product.units.toLocaleString('en-ZA')}</strong></td><td>{product.failed.toLocaleString('en-ZA')}</td><td>{formatRand(product.revenueCents)}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading"><div><span>Lifetime device counters</span><h2>Current cumulative cup counts</h2></div><span>{lifetime.units.toLocaleString('en-ZA')} successful cups</span></header>
        {counters.length === 0 ? <div className="fleet-empty-state"><strong>No cumulative counters yet</strong><p>The assigned telemetry device has not uploaded selection counters.</p></div> : (
          <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Selection</th><th>Product</th><th>Successful cups</th><th>Failed</th><th>Revenue</th><th>Updated</th></tr></thead><tbody>{counters.map((counter) => <tr key={counter.selection_code}><td><strong>{counter.selection_code}</strong></td><td>{productLabelBySelection.get(counter.selection_code) ?? 'Not mapped yet'}</td><td><strong>{counter.sold_total.toLocaleString('en-ZA')}</strong></td><td>{counter.failed_total.toLocaleString('en-ZA')}</td><td>{formatRand(counter.revenue_cents_total)}</td><td>{formatDateTime(counter.updated_at)}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="fleet-insight-grid fleet-overview-insight-grid">
        <article className="fleet-panel">
          <header><div><span>Machine information</span><h2>Identity and placement</h2></div></header>
          <dl className="fleet-detail-grid">
            <div><dt>Asset name</dt><dd>{machine.machine_name ?? machine.asset_tag ?? 'Not recorded'}</dd></div>
            <div><dt>Client</dt><dd>{customer?.customer_name ?? 'Not assigned'}</dd></div>
            <div><dt>Client code</dt><dd>{customer?.customer_code ?? 'Not recorded'}</dd></div>
            <div><dt>Serial number</dt><dd>{machine.serial_number ?? 'Not recorded'}</dd></div>
            <div><dt>QR code</dt><dd>{machine.machine_barcode ?? machine.asset_tag ?? 'Not recorded'}</dd></div>
            <div><dt>Manufacturer</dt><dd>{machine.manufacturer ?? 'Not recorded'}</dd></div>
            <div><dt>Model</dt><dd>{machine.model ?? 'Not recorded'}</dd></div>
            <div><dt>Status</dt><dd>{machine.status}</dd></div>
            <div><dt>Site</dt><dd>{site?.site_name ?? 'Not assigned'}</dd></div>
            <div><dt>Address</dt><dd>{site?.address ?? machine.current_custodian ?? 'Not recorded'}</dd></div>
            <div><dt>Branch</dt><dd>{machine.branch.toUpperCase()}</dd></div>
            <div><dt>Condition</dt><dd>{machine.condition ?? 'Not recorded'}</dd></div>
          </dl>
        </article>

        <article className="fleet-panel">
          <header><div><span>Telemetry device</span><h2>Controller information</h2></div></header>
          {device ? <dl className="fleet-detail-grid">
            <div><dt>Device ID</dt><dd>{device.device_code}</dd></div>
            <div><dt>Firmware</dt><dd>{device.firmware_version ?? 'Not reported'}</dd></div>
            <div><dt>Profile</dt><dd>{device.profile_id || 'Not assigned'}</dd></div>
            <div><dt>Hardware UID</dt><dd>{device.hardware_uid ?? 'Not reported'}</dd></div>
            <div><dt>Modem</dt><dd>{device.cellular_model ?? 'Not reported'}</dd></div>
            <div><dt>Transport preference</dt><dd>{device.transport_preference}</dd></div>
            <div><dt>Machine link</dt><dd>{device.machine_link_status ?? 'Not reported'}</dd></div>
            <div><dt>Link method</dt><dd>{device.machine_link_method ?? 'Not reported'}</dd></div>
            <div><dt>Reported machine S/N</dt><dd>{device.reported_machine_serial ?? 'Not detected'}</dd></div>
            <div><dt>Last configuration</dt><dd>{formatDateTime(device.last_config_at)}</dd></div>
            <div><dt>Config acknowledged</dt><dd>{formatDateTime(device.last_config_ack_at)}</dd></div>
            <div><dt>Last upload</dt><dd>{formatDateTime(device.last_upload_at)}</dd></div>
          </dl> : <div className="fleet-empty-state"><strong>No device assigned</strong><p>Telemetry information is unavailable until a controller is linked.</p></div>}
        </article>

        <article className="fleet-panel">
          <header><div><span>Data usage</span><h2>Last 30 days</h2></div></header>
          {usage ? <dl className="fleet-detail-grid">
            <div><dt>Used</dt><dd>{formatBytes(usedBytes)}</dd></div>
            <div><dt>Monthly projection</dt><dd>{formatBytes(projectedBytes)}</dd></div>
            <div><dt>Upload requests</dt><dd>{numberValue(usage.request_count).toLocaleString('en-ZA')}</dd></div>
            <div><dt>Application payload</dt><dd>{formatBytes(usage.application_bytes)}</dd></div>
            <div><dt>Device-reported transfer</dt><dd>{numberValue(usage.device_application_sample_count) > 0 ? formatBytes(usage.device_application_bytes) : 'Not reported'}</dd></div>
            <div><dt>Modem measured</dt><dd>{numberValue(usage.modem_sample_count) > 0 ? formatBytes(usage.measured_modem_bytes) : 'Not reported'}</dd></div>
            <div><dt>Last measured</dt><dd>{formatDateTime(usage.last_reported_at)}</dd></div>
          </dl> : <div className="fleet-empty-state"><strong>No data-usage sample</strong><p>Usage will appear after accepted telemetry uploads are recorded.</p></div>}
        </article>
      </section>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading"><div><span>Fault history</span><h2>Errors reported by this machine</h2></div><span>{activeFaults.length.toLocaleString('en-ZA')} active</span></header>
        {faults.length === 0 ? <div className="fleet-empty-state"><strong>No faults reported</strong><p>This machine has no telemetry fault history.</p></div> : (
          <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Status</th><th>Severity</th><th>Fault</th><th>Source</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>{faults.map((fault) => <tr key={fault.id}><td><span className={`fleet-status-pill ${fault.cleared_at ? 'is-neutral' : 'is-danger'}`}><i />{fault.cleared_at ? 'Cleared' : 'Active'}</span></td><td>{fault.severity}</td><td><strong>{fault.detail ?? fault.fault_code}</strong><span>{fault.fault_code}</span></td><td>{fault.source}</td><td>{formatDateTime(fault.started_at)}</td><td>{formatDateTime(fault.last_seen_at)}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="fleet-panel fleet-table-panel">
        <header className="fleet-table-heading"><div><span>Recent vend updates</span><h2>Latest sales-counter activity</h2></div><span>Updated {lastUpdated ? timeAgo(lastUpdated.toISOString()) : 'never'}</span></header>
        {recentSales.length === 0 ? <div className="fleet-empty-state"><strong>No recent vend updates</strong><p>Daily item-counter changes will appear here.</p></div> : (
          <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Received</th><th>Product</th><th>Selection</th><th>Units</th><th>Failed</th><th>Revenue</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id}><td>{formatDateTime(sale.last_received_at)}</td><td><strong>{sale.product_name ?? sale.sku ?? sale.selection_code}</strong></td><td>{sale.selection_code}</td><td><strong>{sale.units_sold.toLocaleString('en-ZA')}</strong></td><td>{sale.failed_vends.toLocaleString('en-ZA')}</td><td>{formatRand(sale.revenue_cents)}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </section>
  );
}
