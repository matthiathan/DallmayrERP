'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import {
  InteractiveDonutChart,
  InteractiveHorizontalBars,
  InteractiveLineChart,
  type InteractiveChartDatum,
  type InteractiveDonutDatum,
} from '@/components/ui/InteractiveCharts';
import { SignalStrengthIndicator, signalStrengthForTransport } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineCommandCenter.module.css';

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

type SiteRecord = { id: string; site_name: string | null; address: string | null; latitude: number | null; longitude: number | null };
type CustomerRecord = { id: string; customer_name: string | null; customer_code: string | null };

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

type PrepaidBalanceSummary = {
  device_id: string;
  remaining_bytes: number | null;
  query_status: string;
  alert_level: string;
  checked_at: string | null;
  is_stale: boolean;
};

type ProductSummary = {
  key: string;
  label: string;
  selection: string;
  units: number;
  failed: number;
  revenueCents: number;
};

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

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(value: string | null) {
  if (!value) return 'Never';
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

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(numberValue(cents) / 100);
}

function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

function machineTitle(machine: MachineRecord | null) {
  return machine?.machine_name ?? machine?.model ?? machine?.serial_number ?? machine?.asset_tag ?? 'Machine';
}

function connection(device: DeviceRecord | null) {
  if (!device) return { label: 'No device', state: 'neutral' as const };
  const contact = device.last_heartbeat_at ?? device.last_seen_at;
  if (!contact) return { label: 'Never connected', state: 'neutral' as const };
  const age = Date.now() - new Date(contact).getTime();
  if (age <= 30 * 60 * 1000) return { label: 'Online', state: 'success' as const };
  if (age <= 24 * 60 * 60 * 1000) return { label: 'Delayed', state: 'warning' as const };
  return { label: 'Offline', state: 'danger' as const };
}

function faultTone(value: string) {
  const severity = value.toLowerCase();
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning' || severity === 'medium') return 'Warning';
  if (severity === 'connectivity') return 'Connectivity';
  return 'Fault';
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

function Metric({ label, value, helper, tone = 'blue', icon }: {
  label: string;
  value: string;
  helper: string;
  tone?: 'blue' | 'green' | 'amber' | 'red' | 'violet';
  icon: Parameters<typeof NavigationIcon>[0]['kind'];
}) {
  return (
    <article className={`${styles.metric} ${styles[`tone_${tone}`]}`}>
      <div><span>{label}</span><i><NavigationIcon kind={icon} /></i></div>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function MachineCommandCenter({ machineId }: { machineId: string }) {
  const [period, setPeriod] = useState<Period>('month');
  const [machine, setMachine] = useState<MachineRecord | null>(null);
  const [site, setSite] = useState<SiteRecord | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [counters, setCounters] = useState<CounterRecord[]>([]);
  const [faults, setFaults] = useState<FaultRecord[]>([]);
  const [usage, setUsage] = useState<DataUsageSummary | null>(null);
  const [prepaid, setPrepaid] = useState<PrepaidBalanceSummary | null>(null);
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
        client.from('machines')
          .select('id,branch,customer_id,site_id,asset_tag,serial_number,machine_barcode,machine_name,model,status,current_custodian,manufacturer,condition,criticality,installed_at,last_service_at,next_service_at')
          .eq('id', machineId).maybeSingle(),
        client.from('telemetry_devices')
          .select('id,device_code,status,profile_id,firmware_version,wifi_rssi,cellular_csq,cellular_operator,cellular_model,last_transport,transport_preference,last_seen_at,last_upload_at,last_counter_at,last_heartbeat_at,last_config_at,last_config_ack_at,last_fault_at,last_recovery_at,hardware_uid,reported_machine_serial,machine_link_status,machine_link_method,applied_config')
          .eq('machine_id', machineId).eq('status', 'active').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
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
      const faultsPromise = client.from('telemetry_fault_events')
        .select('id,fault_code,severity,source,detail,started_at,last_seen_at,cleared_at')
        .eq('machine_id', machineId).order('last_seen_at', { ascending: false }).limit(100);
      const countersPromise = nextDevice
        ? client.from('telemetry_counter_state').select('selection_code,sold_total,failed_total,revenue_cents_total,updated_at').eq('device_id', nextDevice.id).order('selection_code')
        : Promise.resolve({ data: [], error: null });
      const usagePromise = nextDevice
        ? client.rpc('get_telemetry_data_usage', { p_days: 30 }).eq('device_id', nextDevice.id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const prepaidPromise = nextDevice
        ? client.rpc('get_telemetry_prepaid_balances').eq('device_id', nextDevice.id).maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [siteResult, customerResult, faultsResult, nextSales, countersResult, usageResult, prepaidResult] = await Promise.all([
        sitePromise,
        customerPromise,
        faultsPromise,
        loadSales(machineId, periodStart(period)),
        countersPromise,
        usagePromise,
        prepaidPromise,
      ]);

      if (siteResult.error) throw siteResult.error;
      if (customerResult.error) throw customerResult.error;
      if (faultsResult.error) throw faultsResult.error;
      if (countersResult.error) throw countersResult.error;

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
      setUsage(usageResult.error || !usageResult.data ? null : usageResult.data as DataUsageSummary);
      setPrepaid(prepaidResult.error || !prepaidResult.data ? null : prepaidResult.data as PrepaidBalanceSummary);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machine telemetry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [machineId, period]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const productSummaries = useMemo<ProductSummary[]>(() => {
    const map = new Map<string, ProductSummary>();
    sales.forEach((sale) => {
      const key = sale.product_key || sale.selection_code;
      const current = map.get(key) ?? {
        key,
        label: sale.product_name ?? sale.sku ?? sale.selection_code,
        selection: sale.selection_code,
        units: 0,
        failed: 0,
        revenueCents: 0,
      };
      current.units += sale.units_sold;
      current.failed += sale.failed_vends;
      current.revenueCents += sale.revenue_cents;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));
  }, [sales]);

  const totals = useMemo(() => sales.reduce((sum, sale) => ({
    units: sum.units + sale.units_sold,
    failed: sum.failed + sale.failed_vends,
    revenue: sum.revenue + sale.revenue_cents,
  }), { units: 0, failed: 0, revenue: 0 }), [sales]);

  const lifetime = useMemo(() => counters.reduce((sum, counter) => ({
    units: sum.units + counter.sold_total,
    failed: sum.failed + counter.failed_total,
    revenue: sum.revenue + counter.revenue_cents_total,
  }), { units: 0, failed: 0, revenue: 0 }), [counters]);

  const trendData = useMemo<InteractiveChartDatum[]>(() => {
    const days = new Map<string, { units: number; failed: number }>();
    sales.forEach((sale) => {
      const current = days.get(sale.sales_date) ?? { units: 0, failed: 0 };
      current.units += sale.units_sold;
      current.failed += sale.failed_vends;
      days.set(sale.sales_date, current);
    });
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
      key: date,
      label: shortDate(date),
      value: value.units,
      secondaryLabel: 'Failed vends',
      secondaryValue: value.failed,
    }));
  }, [sales]);

  const productData = useMemo<InteractiveChartDatum[]>(() => productSummaries.slice(0, 8).map((product) => ({
    key: product.key,
    label: product.label,
    value: product.units,
    secondaryLabel: 'Failed vends',
    secondaryValue: product.failed,
    detail: `${product.selection} · ${money(product.revenueCents)}`,
  })), [productSummaries]);

  const activeFaults = faults.filter((fault) => !fault.cleared_at);
  const faultData = useMemo<InteractiveDonutDatum[]>(() => {
    const counts = activeFaults.reduce((map, fault) => {
      const key = faultTone(fault.severity);
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    return [...counts.entries()].map(([label, value]) => ({ key: label.toLowerCase(), label, value }));
  }, [activeFaults]);

  const recentSales = useMemo(() => [...sales]
    .sort((a, b) => new Date(b.last_received_at).getTime() - new Date(a.last_received_at).getTime())
    .slice(0, 12), [sales]);

  const status = connection(device);
  const lastContact = device?.last_heartbeat_at ?? device?.last_seen_at ?? null;
  const signal = signalStrengthForTransport(device?.last_transport, device?.wifi_rssi, device?.cellular_csq);
  const usedBytes = usage
    ? usage.modem_sample_count > 0
      ? numberValue(usage.measured_modem_bytes)
      : usage.device_application_sample_count > 0
        ? numberValue(usage.device_application_bytes)
        : numberValue(usage.application_bytes)
    : 0;
  const projectedBytes = usage
    ? usage.modem_sample_count > 0
      ? numberValue(usage.projected_monthly_modem_bytes)
      : usage.device_application_sample_count > 0
        ? numberValue(usage.projected_monthly_device_application_bytes)
        : numberValue(usage.projected_monthly_application_bytes)
    : 0;
  const successRate = totals.units + totals.failed > 0 ? (totals.units / (totals.units + totals.failed)) * 100 : 100;
  const mode = typeof device?.applied_config?.mode === 'string' ? device.applied_config.mode : 'Not reported';
  const productBySelection = new Map(productSummaries.map((item) => [item.selection, item.label]));

  if (loading && !machine) return <HamsterLoader label="Loading machine command center" />;

  if (error || !machine) {
    return <section className={styles.commandCenter}><div className="fleet-banner is-error" role="alert"><strong>Machine dashboard unavailable.</strong><span>{error ?? 'Machine not found.'}</span></div><Link className="fleet-button secondary" href="/machines">← Back to machines</Link></section>;
  }

  return (
    <section className={styles.commandCenter} data-machine-command-center="v1">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <Link href="/machines">← Machines</Link>
          <span className={styles.live}><i /> MACHINE COMMAND CENTER</span>
          <h1>{machineTitle(machine)}</h1>
          <p>{customer?.customer_name ?? 'No client'} · {site?.site_name ?? 'No site'} · {machine.serial_number ? `S/N ${machine.serial_number}` : 'No serial'}</p>
        </div>
        <div className={styles.heroControls}>
          <div className={`${styles.statusCard} ${styles[`is_${status.state}`]}`}><span>Telemetry</span><strong>{status.label}</strong><small>{device ? `${device.device_code} · ${timeAgo(lastContact)}` : 'No controller assigned'}</small></div>
          <label><span>Reporting period</span><select value={period} onChange={(event) => setPeriod(event.target.value as Period)}>{periods.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          <button disabled={refreshing} onClick={() => load(true)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Some telemetry could not be loaded.</strong><span>{error}</span></div> : null}

      <section className={styles.metricGrid} aria-label="Machine performance summary">
        <Metric helper={periods.find((item) => item.value === period)?.label ?? period} icon="sales" label="Items sold" value={totals.units.toLocaleString('en-ZA')} />
        <Metric helper="Recorded vend revenue" icon="finance" label="Revenue" tone="green" value={money(totals.revenue)} />
        <Metric helper={`${totals.failed.toLocaleString('en-ZA')} failed`} icon="chart" label="Vend success" tone={successRate >= 98 ? 'green' : successRate >= 95 ? 'amber' : 'red'} value={`${successRate.toFixed(1)}%`} />
        <Metric helper="Current device counter epoch" icon="sales" label="Lifetime cups" tone="violet" value={lifetime.units.toLocaleString('en-ZA')} />
        <Metric helper={activeFaults.length ? 'Needs attention' : 'Clear'} icon="bell" label="Active faults" tone={activeFaults.length ? 'red' : 'green'} value={activeFaults.length.toLocaleString('en-ZA')} />
        <Metric helper={usage ? `${formatBytes(projectedBytes)} projected / month` : 'Awaiting usage'} icon="telemetry" label="30-day data" tone="blue" value={formatBytes(usedBytes)} />
      </section>

      <section className={styles.primaryGrid}>
        <article className={styles.visualCard}>
          <header><div><span>Vend activity</span><h2>Quantity sold over time</h2></div><strong>{totals.units.toLocaleString('en-ZA')}</strong></header>
          {trendData.length ? <InteractiveLineChart ariaLabel="Machine vend quantity over time" data={trendData} valueLabel="items" /> : <div className={styles.empty}>No vend trend yet</div>}
        </article>
        <article className={styles.visualCard}>
          <header><div><span>Product mix</span><h2>What this machine vended</h2></div><strong>{productSummaries.length.toLocaleString('en-ZA')}</strong></header>
          {productData.length ? <InteractiveHorizontalBars ariaLabel="Top products vended by this machine" data={productData} valueLabel="items" /> : <div className={styles.empty}>No products reported</div>}
        </article>
      </section>

      <section className={styles.healthGrid}>
        <article className={styles.healthCard}>
          <header><span>Network & signal</span><strong>{device?.last_transport === 'cellular' ? 'Cellular' : device?.last_transport === 'wifi' ? 'Wi-Fi' : 'Unknown'}</strong></header>
          {device ? <SignalStrengthIndicator cellularCsq={device.cellular_csq} transport={device.last_transport} wifiRssi={device.wifi_rssi} /> : <span className={styles.muted}>No telemetry device</span>}
          <dl><div><dt>Operator</dt><dd>{device?.cellular_operator ?? '—'}</dd></div><div><dt>Mode</dt><dd>{mode}</dd></div><div><dt>Signal tier</dt><dd>{signal.label}</dd></div><div><dt>Firmware</dt><dd>{device?.firmware_version ?? '—'}</dd></div></dl>
        </article>

        <article className={styles.healthCard}>
          <header><span>Data consumption</span><strong>{formatBytes(usedBytes)}</strong></header>
          <div className={styles.dataGauge}><div><span>30 days</span><strong>{formatBytes(usedBytes)}</strong></div><i><b style={{ width: `${Math.min(100, projectedBytes > 0 ? (usedBytes / projectedBytes) * 100 : 0)}%` }} /></i><small>{formatBytes(projectedBytes)} projected monthly</small></div>
          <dl><div><dt>Requests</dt><dd>{numberValue(usage?.request_count).toLocaleString('en-ZA')}</dd></div><div><dt>Prepaid remaining</dt><dd>{prepaid?.remaining_bytes == null ? 'Awaiting balance' : formatBytes(prepaid.remaining_bytes)}</dd></div><div><dt>Balance status</dt><dd>{prepaid?.alert_level?.replace(/_/g, ' ') ?? 'Unknown'}</dd></div><div><dt>Last measure</dt><dd>{formatDate(usage?.last_reported_at ?? null)}</dd></div></dl>
        </article>

        <article className={styles.healthCard}>
          <header><span>Fault pressure</span><strong>{activeFaults.length.toLocaleString('en-ZA')}</strong></header>
          {faultData.length ? <InteractiveDonutChart ariaLabel="Active faults by severity" data={faultData} valueLabel="faults" /> : <div className={styles.clearState}><NavigationIcon kind="bell" /><strong>Clear</strong><span>No unresolved faults</span></div>}
        </article>
      </section>

      <section className={styles.tableCard}>
        <header><div><span>Recent activity</span><h2>Latest item counters</h2></div><strong>{recentSales.length.toLocaleString('en-ZA')}</strong></header>
        {recentSales.length ? <div className={styles.tableScroll}><table><thead><tr><th>Received</th><th>Product</th><th>Selection</th><th>Sold</th><th>Failed</th><th>Revenue</th></tr></thead><tbody>{recentSales.map((sale) => <tr key={sale.id}><td>{timeAgo(sale.last_received_at)}</td><td><strong>{sale.product_name ?? sale.sku ?? sale.selection_code}</strong></td><td>{sale.selection_code}</td><td>{sale.units_sold.toLocaleString('en-ZA')}</td><td>{sale.failed_vends.toLocaleString('en-ZA')}</td><td>{money(sale.revenue_cents)}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>No item counters in this period</div>}
      </section>

      <section className={styles.tableCard}>
        <header><div><span>Lifetime counters</span><h2>Successful cups by selection</h2></div><strong>{lifetime.units.toLocaleString('en-ZA')}</strong></header>
        {counters.length ? <div className={styles.tableScroll}><table><thead><tr><th>Selection</th><th>Product</th><th>Successful cups</th><th>Failed</th><th>Revenue</th><th>Updated</th></tr></thead><tbody>{counters.map((counter) => <tr key={counter.selection_code}><td><strong>{counter.selection_code}</strong></td><td>{productBySelection.get(counter.selection_code) ?? 'Not mapped yet'}</td><td>{counter.sold_total.toLocaleString('en-ZA')}</td><td>{counter.failed_total.toLocaleString('en-ZA')}</td><td>{money(counter.revenue_cents_total)}</td><td>{timeAgo(counter.updated_at)}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>No cumulative counters yet</div>}
      </section>

      <section className={styles.detailGrid}>
        <article className={styles.detailCard}><header><span>Machine identity</span><NavigationIcon kind="tool" /></header><dl><div><dt>Manufacturer</dt><dd>{machine.manufacturer ?? 'Not recorded'}</dd></div><div><dt>Model</dt><dd>{machine.model ?? 'Not recorded'}</dd></div><div><dt>Serial</dt><dd>{machine.serial_number ?? 'Not recorded'}</dd></div><div><dt>QR / asset</dt><dd>{machine.machine_barcode ?? machine.asset_tag ?? 'Not recorded'}</dd></div><div><dt>Condition</dt><dd>{machine.condition ?? 'Not recorded'}</dd></div><div><dt>Criticality</dt><dd>{machine.criticality ?? 'Not recorded'}</dd></div></dl></article>
        <article className={styles.detailCard}><header><span>Placement</span><NavigationIcon kind="pin" /></header><dl><div><dt>Client</dt><dd>{customer?.customer_name ?? 'Not assigned'}</dd></div><div><dt>Site</dt><dd>{site?.site_name ?? 'Not assigned'}</dd></div><div><dt>Address</dt><dd>{site?.address ?? machine.current_custodian ?? 'Not recorded'}</dd></div><div><dt>Branch</dt><dd>{machine.branch.toUpperCase()}</dd></div><div><dt>Last service</dt><dd>{formatDate(machine.last_service_at)}</dd></div><div><dt>Next service</dt><dd>{formatDate(machine.next_service_at)}</dd></div></dl></article>
        <article className={styles.detailCard}><header><span>Telemetry controller</span><NavigationIcon kind="telemetry" /></header><dl><div><dt>Device</dt><dd>{device?.device_code ?? 'Not assigned'}</dd></div><div><dt>Profile</dt><dd>{device?.profile_id ?? 'Not assigned'}</dd></div><div><dt>Hardware UID</dt><dd>{device?.hardware_uid ?? 'Not reported'}</dd></div><div><dt>Machine link</dt><dd>{device?.machine_link_status ?? 'Not reported'}</dd></div><div><dt>Link method</dt><dd>{device?.machine_link_method ?? 'Not reported'}</dd></div><div><dt>Last config ACK</dt><dd>{formatDate(device?.last_config_ack_at ?? null)}</dd></div></dl></article>
      </section>

      <section className={styles.tableCard}>
        <header><div><span>Fault history</span><h2>Machine errors</h2></div><strong>{activeFaults.length.toLocaleString('en-ZA')} active</strong></header>
        {faults.length ? <div className={styles.tableScroll}><table><thead><tr><th>Status</th><th>Severity</th><th>Code</th><th>Detail</th><th>Source</th><th>Last seen</th></tr></thead><tbody>{faults.slice(0, 50).map((fault) => <tr key={fault.id}><td><span className={fault.cleared_at ? styles.resolved : styles.active}>{fault.cleared_at ? 'Resolved' : 'Active'}</span></td><td>{fault.severity}</td><td><strong>{fault.fault_code}</strong></td><td>{fault.detail ?? '—'}</td><td>{fault.source}</td><td>{timeAgo(fault.last_seen_at)}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>No faults reported</div>}
      </section>

      <footer className={styles.footer}><span><i /> Auto-refresh every 30 seconds</span><span>Updated {lastUpdated ? formatDate(lastUpdated.toISOString()) : '—'}</span><div><Link href="/telemetry/test-center">Test Center</Link><Link href="/telemetry/devices">Manage device</Link><Link href="/map">Fleet map</Link></div></footer>
    </section>
  );
}
