'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import { ComparisonLineChart, type ComparisonPoint } from './ComparisonLineChart';
import styles from './MachineDetail.module.css';

type Period = 'day' | 'week' | 'month' | 'six_months';
type Tab = 'overview' | 'vends' | 'events' | 'device';

type Machine = {
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

type Site = { id: string; site_name: string | null; address: string | null; latitude: number | null; longitude: number | null };
type Customer = { id: string; customer_name: string | null; customer_code: string | null };

type Device = {
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
  telemetry_mode: 'live' | 'daily' | 'monthly' | null;
  last_seen_at: string | null;
  last_upload_at: string | null;
  last_counter_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
  hardware_uid: string | null;
  reported_machine_serial: string | null;
  machine_link_status: string | null;
  machine_link_method: string | null;
};

type Sale = {
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

type Counter = { selection_code: string; sold_total: number; failed_total: number; revenue_cents_total: number; updated_at: string };
type ProductMapping = { selection_code: string | null; product_name: string | null };
type Fault = { id: string; fault_code: string; severity: string; source: string; detail: string | null; started_at: string; last_seen_at: string; cleared_at: string | null };

type Usage = {
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

type Prepaid = { device_id: string; remaining_bytes: number | null; query_status: string; alert_level: string; checked_at: string | null; is_stale: boolean };

const periods: Record<Period, string> = { day: 'Today', week: '7 days', month: '30 days', six_months: '6 months' };

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(numberValue(cents) / 100);
}

function bytes(value: number | null | undefined) {
  const amount = numberValue(value);
  if (amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** index);
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function reportWindow(period: Period) {
  const today = new Date();
  const days = period === 'day' ? 1 : period === 'week' ? 7 : period === 'month' ? 30 : 183;
  const currentEnd = dateKey(today);
  const start = new Date(today);
  start.setDate(start.getDate() - days + 1);
  const previousEndDate = new Date(start);
  previousEndDate.setDate(previousEndDate.getDate() - 1);
  const previousStartDate = new Date(previousEndDate);
  previousStartDate.setDate(previousStartDate.getDate() - days + 1);
  return {
    currentStart: dateKey(start),
    currentEnd,
    previousStart: dateKey(previousStartDate),
    previousEnd: dateKey(previousEndDate),
  };
}

function machineTitle(machine: Machine | null) {
  return machine?.machine_name ?? machine?.model ?? machine?.serial_number ?? machine?.asset_tag ?? 'Machine';
}

function dateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never';
}

function age(value: string | null) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function connectionState(device: Device | null) {
  if (!device) return { key: 'offline', label: 'No telemetry device' };
  const heartbeat = device.last_heartbeat_at ?? device.last_seen_at;
  if (!heartbeat) return { key: 'offline', label: 'Never connected' };
  const elapsed = Date.now() - new Date(heartbeat).getTime();
  if (elapsed <= 30 * 60 * 1000) return { key: 'online', label: 'Online' };
  if (elapsed <= 24 * 60 * 60 * 1000) return { key: 'delayed', label: 'Delayed' };
  return { key: 'offline', label: 'Offline' };
}

function actualUsage(usage: Usage | null) {
  if (!usage) return 0;
  if (numberValue(usage.modem_sample_count) > 0) return numberValue(usage.measured_modem_bytes);
  if (numberValue(usage.device_application_sample_count) > 0) return numberValue(usage.device_application_bytes);
  return numberValue(usage.application_bytes);
}

function projectedUsage(usage: Usage | null) {
  if (!usage) return 0;
  if (numberValue(usage.modem_sample_count) > 0) return numberValue(usage.projected_monthly_modem_bytes);
  if (numberValue(usage.device_application_sample_count) > 0) return numberValue(usage.projected_monthly_device_application_bytes);
  return numberValue(usage.projected_monthly_application_bytes);
}

function selectionKey(value: string) {
  return value.trim().toLowerCase();
}

function Metric({ label, value, helper, tone = '' }: { label: string; value: string; helper: string; tone?: '' | 'green' | 'red' | 'amber' | 'gold' }) {
  return <article className={`${styles.metric} ${tone ? styles[tone] : ''}`}><span>{label}</span><strong>{value}</strong><small>{helper}</small></article>;
}

export function MachineDetail({ machineId }: { machineId: string }) {
  const [period, setPeriod] = useState<Period>('month');
  const [tab, setTab] = useState<Tab>('overview');
  const [machine, setMachine] = useState<Machine | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [mappedProducts, setMappedProducts] = useState<ProductMapping[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [prepaid, setPrepaid] = useState<Prepaid | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const { data: machineData, error: machineError } = await client
        .from('machines')
        .select('id,branch,customer_id,site_id,asset_tag,serial_number,machine_barcode,machine_name,model,status,current_custodian,manufacturer,condition,criticality,installed_at,last_service_at,next_service_at')
        .eq('id', machineId)
        .maybeSingle();
      if (machineError) throw machineError;
      if (!machineData) throw new Error('Machine not found.');

      const nextMachine = machineData as Machine;
      const { data: deviceData, error: deviceError } = await client
        .from('telemetry_devices')
        .select('id,device_code,status,profile_id,firmware_version,wifi_rssi,cellular_csq,cellular_operator,cellular_model,last_transport,transport_preference,telemetry_mode,last_seen_at,last_upload_at,last_counter_at,last_heartbeat_at,last_config_at,last_config_ack_at,hardware_uid,reported_machine_serial,machine_link_status,machine_link_method')
        .eq('machine_id', machineId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deviceError) throw deviceError;

      const nextDevice = deviceData as Device | null;
      const range = reportWindow(period);
      const modelKey = nextMachine.model ?? nextMachine.machine_name ?? '';

      const [siteQuery, customerQuery, faultQuery, salesQuery, mappingQuery] = await Promise.all([
        nextMachine.site_id
          ? client.from('customer_sites').select('id,site_name,address,latitude,longitude').eq('id', nextMachine.site_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        nextMachine.customer_id
          ? client.from('customers').select('id,customer_name,customer_code').eq('id', nextMachine.customer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        client.from('telemetry_fault_events').select('id,fault_code,severity,source,detail,started_at,last_seen_at,cleared_at').eq('machine_id', machineId).order('last_seen_at', { ascending: false }).limit(250),
        client.from('telemetry_daily_item_sales').select('id,sales_date,selection_code,product_key,sku,product_name,brand,units_sold,failed_vends,revenue_cents,last_received_at').eq('machine_id', machineId).gte('sales_date', range.previousStart).lte('sales_date', range.currentEnd).order('sales_date', { ascending: true }).limit(5000),
        modelKey ? client.rpc('get_machine_model_button_map', { p_model_key: modelKey }) : Promise.resolve({ data: [], error: null }),
      ]);

      if (siteQuery.error) throw siteQuery.error;
      if (customerQuery.error) throw customerQuery.error;
      if (faultQuery.error) throw faultQuery.error;
      if (salesQuery.error) throw salesQuery.error;

      let counterRows: Counter[] = [];
      let usageRow: Usage | null = null;
      let prepaidRow: Prepaid | null = null;
      if (nextDevice) {
        const [counterQuery, usageQuery, prepaidQuery] = await Promise.all([
          client.from('telemetry_counter_state').select('selection_code,sold_total,failed_total,revenue_cents_total,updated_at').eq('device_id', nextDevice.id).order('selection_code'),
          client.rpc('get_telemetry_data_usage', { p_days: 30 }).eq('device_id', nextDevice.id).maybeSingle(),
          client.rpc('get_telemetry_prepaid_balances').eq('device_id', nextDevice.id).maybeSingle(),
        ]);
        if (counterQuery.error) throw counterQuery.error;
        counterRows = (counterQuery.data ?? []) as Counter[];
        usageRow = usageQuery.error ? null : (usageQuery.data as Usage | null);
        prepaidRow = prepaidQuery.error ? null : (prepaidQuery.data as Prepaid | null);
      }

      setMachine(nextMachine);
      setDevice(nextDevice);
      setSite(siteQuery.data as Site | null);
      setCustomer(customerQuery.data as Customer | null);
      setFaults((faultQuery.data ?? []) as Fault[]);
      setSales(((salesQuery.data ?? []) as Sale[]).map((row) => ({ ...row, units_sold: numberValue(row.units_sold), failed_vends: numberValue(row.failed_vends), revenue_cents: numberValue(row.revenue_cents) })));
      setCounters(counterRows.map((row) => ({ ...row, sold_total: numberValue(row.sold_total), failed_total: numberValue(row.failed_total), revenue_cents_total: numberValue(row.revenue_cents_total) })));
      setMappedProducts(mappingQuery.error ? [] : ((mappingQuery.data ?? []) as ProductMapping[]));
      setUsage(usageRow);
      setPrepaid(prepaidRow);
      setUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load machine telemetry.');
    } finally {
      setLoading(false);
    }
  }, [machineId, period]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = globalThis.setInterval(() => { void load(); }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const range = reportWindow(period);
  const current = sales.filter((row) => row.sales_date >= range.currentStart && row.sales_date <= range.currentEnd);
  const previous = sales.filter((row) => row.sales_date >= range.previousStart && row.sales_date <= range.previousEnd);
  const units = current.reduce((sum, row) => sum + row.units_sold, 0);
  const failed = current.reduce((sum, row) => sum + row.failed_vends, 0);
  const revenue = current.reduce((sum, row) => sum + row.revenue_cents, 0);
  const attempts = units + failed;
  const success = attempts ? (units / attempts) * 100 : 100;
  const lifeUnits = counters.reduce((sum, row) => sum + row.sold_total, 0);
  const openFaults = faults.filter((fault) => !fault.cleared_at);
  const state = connectionState(device);

  const aggregateProducts = useCallback((rows: Sale[]) => {
    const map = new Map<string, { key: string; label: string; units: number; failed: number; revenue: number }>();
    rows.forEach((row) => {
      const key = row.product_key || row.selection_code;
      const item = map.get(key) ?? { key, label: row.product_name ?? row.sku ?? row.selection_code, units: 0, failed: 0, revenue: 0 };
      item.units += row.units_sold;
      item.failed += row.failed_vends;
      item.revenue += row.revenue_cents;
      map.set(key, item);
    });
    return Array.from(map.values()).sort((a, b) => b.units - a.units);
  }, []);
  const products = aggregateProducts(current);

  const productBySelection = useMemo(() => {
    const map = new Map<string, string>();
    mappedProducts.forEach((mapping) => {
      if (mapping.selection_code && mapping.product_name) map.set(selectionKey(mapping.selection_code), mapping.product_name);
    });
    sales.forEach((row) => {
      const key = selectionKey(row.selection_code);
      if (!map.has(key)) map.set(key, row.product_name ?? row.sku ?? row.product_key ?? row.selection_code);
    });
    return map;
  }, [mappedProducts, sales]);

  const lifetimeCounters = useMemo(() => counters
    .map((counter) => ({ ...counter, label: productBySelection.get(selectionKey(counter.selection_code)) ?? counter.selection_code }))
    .sort((a, b) => b.sold_total - a.sold_total), [counters, productBySelection]);

  const trendFor = useCallback((rows: Sale[]): ComparisonPoint[] => {
    const map = new Map<string, { units: number; revenue: number }>();
    rows.forEach((row) => {
      const item = map.get(row.sales_date) ?? { units: 0, revenue: 0 };
      item.units += row.units_sold;
      item.revenue += row.revenue_cents;
      map.set(row.sales_date, item);
    });
    return Array.from(map.entries()).map(([key, value]) => ({ key, label: new Date(`${key}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: '2-digit' }), value: value.units, detail: money(value.revenue) }));
  }, []);

  const trend = useMemo(() => trendFor(current), [current, trendFor]);
  const previousTrend = useMemo(() => trendFor(previous), [previous, trendFor]);
  const usedBytes = actualUsage(usage);
  const projectedBytes = projectedUsage(usage);
  const prepaidPct = prepaid?.remaining_bytes && projectedBytes ? Math.min(100, (numberValue(prepaid.remaining_bytes) / projectedBytes) * 100) : 0;

  return (
    <section className={styles.page} data-machine-detail="televend-v3">
      <header className={styles.hero}>
        <div>
          <Link className={styles.back} href="/machines">‹ Machines</Link>
          <h1>{machineTitle(machine)}</h1>
          <p>{site?.site_name ?? customer?.customer_name ?? machine?.current_custodian ?? machine?.branch?.toUpperCase() ?? 'Location not assigned'} · {machine?.serial_number ?? 'No serial'}</p>
        </div>
        <div className={styles.heroRight}>
          <span className={`${styles.status} ${styles[state.key] ?? ''}`}><i />{state.label}</span>
          <select aria-label="Reporting period" className={styles.period} value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
            {(Object.keys(periods) as Period[]).map((value) => <option key={value} value={value}>{periods[value]}</option>)}
          </select>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading && !machine ? <HamsterLoader label="Loading machine dashboard" /> : null}

      {machine ? <>
        <nav className={styles.tabs} aria-label="Machine dashboard sections">
          {(['overview', 'vends', 'events', 'device'] as Tab[]).map((value) => (
            <button aria-current={tab === value ? 'page' : undefined} className={`${styles.tab} ${tab === value ? styles.tabActive : ''}`} key={value} onClick={() => setTab(value)} type="button">
              {value === 'overview' ? 'Overview' : value === 'vends' ? 'Vends & products' : value === 'events' ? 'Events' : 'Device'}
            </button>
          ))}
        </nav>

        {tab === 'overview' ? <>
          <section className={styles.metrics}>
            <Metric helper={periods[period]} label="Items sold" value={units.toLocaleString('en-ZA')} />
            <Metric helper={`${failed} failed vends`} label="Revenue" tone="gold" value={money(revenue)} />
            <Metric helper={`${attempts} attempts`} label="Vend success" tone={success >= 98 ? 'green' : success >= 95 ? 'amber' : 'red'} value={`${success.toFixed(1)}%`} />
            <Metric helper={`Across ${counters.length} selections`} label="Lifetime cups" tone="green" value={lifeUnits.toLocaleString('en-ZA')} />
            <Metric helper="Unresolved" label="Active faults" tone={openFaults.length ? 'red' : 'green'} value={openFaults.length.toLocaleString('en-ZA')} />
            <Metric helper="Last 30 days" label="Data used" tone="amber" value={bytes(usedBytes)} />
          </section>

          <section className={styles.grid}>
            <article className={`${styles.card} ${styles.chartCard}`}>
              <header className={`${styles.cardHeader} ${styles.redHeader}`}><div><span>{periods[period]}</span><h2>Vend activity</h2></div><strong>{units} vends</strong></header>
              <div className={styles.body}>{trend.length ? <ComparisonLineChart current={trend} currentLabel="This period" previous={previousTrend} previousLabel="Previous period" valueLabel="vends" /> : <div className={styles.empty}>No vend counters for this period.</div>}</div>
            </article>
            <article className={styles.card}>
              <header className={styles.cardHeader}><div><span>Product mix</span><h2>Top selections</h2></div></header>
              <div className={styles.rankList}>
                <div className={styles.rankHead}><span>#</span><span>Product</span><span>Vends</span><span>Failed</span></div>
                {products.slice(0, 10).map((product, index) => <div className={styles.rankRow} key={product.key}><b>{index + 1}</b><span className={styles.rankName}>{product.label}</span><span className={styles.rankValue}>{product.units}</span><span className={styles.rankFail}>{product.failed}</span></div>)}
                {!products.length ? <div className={styles.empty}>No product activity in this period.</div> : null}
              </div>
            </article>
          </section>

          <section className={styles.gridThree}>
            <article className={styles.card}><header className={styles.cardHeader}><div><span>Machine</span><h2>Asset details</h2></div></header><dl className={styles.detailList}>
              <div><dt>Model</dt><dd>{machine.model ?? 'Not recorded'}</dd></div><div><dt>Manufacturer</dt><dd>{machine.manufacturer ?? 'Not recorded'}</dd></div><div><dt>QR code</dt><dd>{machine.machine_barcode ?? machine.asset_tag ?? 'Not recorded'}</dd></div><div><dt>Condition</dt><dd>{machine.condition ?? machine.status}</dd></div><div><dt>Client</dt><dd>{customer?.customer_name ?? 'Not assigned'}</dd></div><div><dt>Location</dt><dd>{site?.address ?? machine.current_custodian ?? 'Not recorded'}</dd></div>
            </dl></article>
            <article className={styles.card}><header className={styles.cardHeader}><div><span>Connectivity</span><h2>Telemetry health</h2></div></header><dl className={styles.detailList}>
              <div><dt>Transport</dt><dd>{device?.last_transport === 'wifi' ? 'Wi-Fi' : device?.last_transport === 'cellular' ? 'Cellular' : 'Not reported'}</dd></div><div><dt>Signal</dt><dd className={styles.signalRow}>{device ? <SignalStrengthIndicator cellularCsq={device.cellular_csq} transport={device.last_transport} wifiRssi={device.wifi_rssi} /> : null}</dd></div><div><dt>Last contact</dt><dd>{age(device?.last_heartbeat_at ?? device?.last_seen_at ?? null)}</dd></div><div><dt>Firmware</dt><dd>{device?.firmware_version ?? 'Not reported'}</dd></div><div><dt>Operator</dt><dd>{device?.cellular_operator ?? 'Not reported'}</dd></div>
            </dl></article>
            <article className={styles.card}><header className={styles.cardHeader}><div><span>SIM & data</span><h2>Connectivity usage</h2></div></header><dl className={styles.detailList}>
              <div><dt>30-day transfer</dt><dd>{bytes(usedBytes)}</dd></div><div><dt>Monthly projection</dt><dd>{bytes(projectedBytes)}</dd></div><div><dt>Prepaid remaining</dt><dd>{prepaid?.remaining_bytes != null ? bytes(prepaid.remaining_bytes) : 'Awaiting balance'}</dd></div><div><dt>Balance status</dt><dd>{prepaid?.alert_level ?? prepaid?.query_status ?? 'Not reported'}</dd></div>
            </dl><div className={styles.body}><div className={styles.meter}><i style={{ width: `${prepaidPct}%` }} /></div></div></article>
          </section>
        </> : null}

        {tab === 'vends' ? <>
          <section className={styles.card}><header className={`${styles.cardHeader} ${styles.redHeader}`}><div><span>{periods[period]}</span><h2>Vend counters</h2></div><strong>{current.length} counter rows</strong></header><div className={styles.tableScroll}>
            <table className={styles.table}><thead><tr><th>Date</th><th>Selection</th><th>Product</th><th>Units</th><th>Failed</th><th>Revenue</th></tr></thead><tbody>{current.slice().reverse().map((row) => <tr key={row.id}><td>{row.sales_date}</td><td>{row.selection_code}</td><td><strong>{row.product_name ?? row.sku ?? row.product_key}</strong></td><td>{row.units_sold}</td><td>{row.failed_vends}</td><td>{money(row.revenue_cents)}</td></tr>)}</tbody></table>
            <div className={styles.mobileVends}>{current.slice().reverse().map((row) => <div className={styles.vendRow} key={row.id}><strong>{row.product_name ?? row.sku ?? row.selection_code}</strong><b>{row.units_sold}</b><span>{row.sales_date} · {row.failed_vends} failed · {money(row.revenue_cents)}</span></div>)}</div>
          </div></section>

          <section className={styles.card} data-lifetime-cup-counters="true"><header className={styles.cardHeader}><div><span>Cumulative telemetry counters</span><h2>Lifetime cups by selection</h2></div><strong>{lifeUnits.toLocaleString('en-ZA')} cups</strong></header>
            {lifetimeCounters.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Selection</th><th>Product</th><th>Cups</th><th>Failed</th><th>Revenue</th><th>Updated</th></tr></thead><tbody>{lifetimeCounters.map((row) => <tr key={row.selection_code}><td>{row.selection_code}</td><td><strong>{row.label}</strong></td><td>{row.sold_total.toLocaleString('en-ZA')}</td><td>{row.failed_total.toLocaleString('en-ZA')}</td><td>{money(row.revenue_cents_total)}{row.sold_total > 0 && row.revenue_cents_total === 0 ? ' · zero-price/free' : ''}</td><td>{dateTime(row.updated_at)}</td></tr>)}</tbody></table><div className={styles.mobileVends}>{lifetimeCounters.map((row) => <div className={styles.vendRow} key={row.selection_code}><strong>{row.label}</strong><b>{row.sold_total.toLocaleString('en-ZA')}</b><span>{row.selection_code} · {row.failed_total} failed · {money(row.revenue_cents_total)}{row.sold_total > 0 && row.revenue_cents_total === 0 ? ' · zero-price/free' : ''}</span></div>)}</div></div> : <div className={styles.empty}>No lifetime cup counters have been received from this telemetry device yet.</div>}
            <footer className={styles.footer}><span>Counter state is cumulative and independent of the selected analytics period.</span><strong>{counters.length} selections</strong></footer>
          </section>
        </> : null}

        {tab === 'events' ? <section className={styles.card}><header className={`${styles.cardHeader} ${styles.redHeader}`}><div><span>Machine events</span><h2>Fault & recovery history</h2></div><strong>{faults.length}</strong></header><div className={styles.faultList}>{faults.map((fault) => <div className={styles.faultRow} key={fault.id}><strong>{fault.fault_code}</strong><b>{fault.cleared_at ? 'Resolved' : fault.severity}</b><span>{fault.detail ?? fault.source} · {dateTime(fault.last_seen_at)}</span></div>)}{!faults.length ? <div className={styles.empty}>No fault events recorded.</div> : null}</div></section> : null}

        {tab === 'device' ? <section className={styles.gridThree}>
          <article className={styles.card}><header className={`${styles.cardHeader} ${styles.redHeader}`}><div><span>Telemetry unit</span><h2>{device?.device_code ?? 'No device assigned'}</h2></div></header><dl className={styles.detailList}><div><dt>Hardware UID</dt><dd>{device?.hardware_uid ?? 'Not reported'}</dd></div><div><dt>Profile</dt><dd>{device?.profile_id ?? 'Auto-detect'}</dd></div><div><dt>Reporting mode</dt><dd>{device?.telemetry_mode ? device.telemetry_mode[0].toUpperCase() + device.telemetry_mode.slice(1) : 'Not reported'}</dd></div><div><dt>Link status</dt><dd>{device?.machine_link_status ?? 'Not reported'}</dd></div><div><dt>Link method</dt><dd>{device?.machine_link_method ?? 'Not reported'}</dd></div><div><dt>Reported serial</dt><dd>{device?.reported_machine_serial ?? 'Not reported'}</dd></div></dl></article>
          <article className={styles.card}><header className={styles.cardHeader}><div><span>Transport</span><h2>Connection state</h2></div></header><dl className={styles.detailList}><div><dt>Preference</dt><dd>{device?.transport_preference ?? 'Auto'}</dd></div><div><dt>Current path</dt><dd>{device?.last_transport ?? 'Not reported'}</dd></div><div><dt>Wi-Fi RSSI</dt><dd>{device?.wifi_rssi != null ? `${device.wifi_rssi} dBm` : '—'}</dd></div><div><dt>Cellular CSQ</dt><dd>{device?.cellular_csq != null ? `${device.cellular_csq} CSQ` : '—'}</dd></div><div><dt>Modem</dt><dd>{device?.cellular_model ?? 'Not reported'}</dd></div></dl></article>
          <article className={styles.card}><header className={styles.cardHeader}><div><span>Synchronization</span><h2>Device timestamps</h2></div></header><dl className={styles.detailList}><div><dt>Last heartbeat</dt><dd>{dateTime(device?.last_heartbeat_at ?? null)}</dd></div><div><dt>Last upload</dt><dd>{dateTime(device?.last_upload_at ?? null)}</dd></div><div><dt>Last counter</dt><dd>{dateTime(device?.last_counter_at ?? null)}</dd></div><div><dt>Config sent</dt><dd>{dateTime(device?.last_config_at ?? null)}</dd></div><div><dt>Config ack</dt><dd>{dateTime(device?.last_config_ack_at ?? null)}</dd></div></dl></article>
        </section> : null}

        <footer className={styles.footer}><span>Auto-refresh every 30 seconds</span><span>Updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span></footer>
      </> : null}
    </section>
  );
}
