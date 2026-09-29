'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineOperationsDashboard.module.css';

type ReportView = 'live' | 'daily' | 'monthly';
type TelemetryMode = 'live' | 'daily' | 'monthly';

type Machine = {
  id: string;
  machine_name: string | null;
  model: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  branch: string;
  customer_id: string | null;
  site_id: string | null;
  status: string;
};

type Customer = { customer_name: string | null };
type Site = { site_name: string | null; address: string | null };

type Device = {
  id: string;
  device_code: string;
  status: string;
  firmware_version: string | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  cellular_model: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  transport_preference: 'auto' | 'wifi' | 'cellular';
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_upload_at: string | null;
  hardware_uid: string | null;
};

type MachineState = {
  telemetry_mode: TelemetryMode | null;
  machine_status: string | null;
  active_fault_count: number | null;
  last_device_contact_at: string | null;
};

type Sale = {
  id: string;
  sales_date: string;
  selection_code: string;
  product_key: string;
  sku: string | null;
  product_name: string | null;
  units_sold: number;
  failed_vends: number;
  revenue_cents: number;
};

type Counter = {
  selection_code: string;
  sold_total: number;
  failed_total: number;
  revenue_cents_total: number;
  updated_at: string;
};

type Fault = {
  id: string;
  fault_code: string;
  canonical_fault_code: string | null;
  canonical_title: string | null;
  severity: string;
  detail: string | null;
  recommended_action: string | null;
  started_at: string;
  last_seen_at: string;
  cleared_at: string | null;
};

type Usage = {
  device_id: string;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  projected_monthly_application_bytes: number;
  projected_monthly_device_application_bytes: number | null;
  projected_monthly_modem_bytes: number | null;
};

type LocationState = {
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  source: string | null;
  fix_at: string | null;
  received_at: string | null;
  movement_detected: boolean | null;
};

type ProductSummary = {
  key: string;
  label: string;
  sku: string | null;
  units: number;
  failed: number;
  revenue: number;
};

const VIEW_LABELS: Record<ReportView, string> = {
  live: 'Live',
  daily: 'Daily',
  monthly: 'Monthly',
};

function localDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function startDateFor(view: ReportView) {
  const date = new Date();
  if (view === 'live') return localDateKey(date);
  date.setDate(date.getDate() - (view === 'daily' ? 29 : 364));
  return localDateKey(date);
}

function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(numberValue(cents) / 100);
}

function bytes(value: number | null | undefined) {
  const amount = numberValue(value);
  if (amount <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), units.length - 1);
  const scaled = amount / (1024 ** index);
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function age(value: string | null | undefined) {
  if (!value) return 'Never';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

function locationSource(source: string | null | undefined) {
  if (!source) return 'Not reported';
  if (source === 'cellular_lbs') return 'Cellular LBS';
  if (source === 'gnss' || source === 'gps') return 'GNSS / GPS';
  return source.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Stat({ label, value, helper, tone = 'neutral' }: {
  label: string;
  value: string;
  helper: string;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  return (
    <article className={`${styles.stat} ${styles[tone]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function MachineOperationsDashboard({ machineId }: { machineId: string }) {
  const [view, setView] = useState<ReportView>('live');
  const [machine, setMachine] = useState<Machine | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [location, setLocation] = useState<LocationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [modeSaving, setModeSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError(null);

    try {
      const client = getSupabaseClient();
      const { data: machineData, error: machineError } = await client
        .from('machines')
        .select('id,machine_name,model,manufacturer,serial_number,machine_barcode,branch,customer_id,site_id,status')
        .eq('id', machineId)
        .maybeSingle();
      if (machineError) throw machineError;
      if (!machineData) throw new Error('Machine not found in the selected telemetry region.');

      const nextMachine = machineData as Machine;
      const { data: deviceData, error: deviceError } = await client
        .from('telemetry_devices')
        .select('id,device_code,status,firmware_version,wifi_rssi,cellular_csq,cellular_operator,cellular_model,last_transport,transport_preference,last_seen_at,last_heartbeat_at,last_upload_at,hardware_uid')
        .eq('machine_id', machineId)
        .neq('status', 'retired')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (deviceError) throw deviceError;

      const nextDevice = deviceData as Device | null;
      const startDate = startDateFor(view);
      const endDate = localDateKey(new Date());

      const [customerQuery, siteQuery, stateQuery, salesQuery, faultQuery] = await Promise.all([
        nextMachine.customer_id
          ? client.from('customers').select('customer_name').eq('id', nextMachine.customer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        nextMachine.site_id
          ? client.from('customer_sites').select('site_name,address').eq('id', nextMachine.site_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        client.from('telemetry_machine_state')
          .select('telemetry_mode,machine_status,active_fault_count,last_device_contact_at')
          .eq('machine_id', machineId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client.from('telemetry_daily_item_sales')
          .select('id,sales_date,selection_code,product_key,sku,product_name,units_sold,failed_vends,revenue_cents')
          .eq('machine_id', machineId)
          .gte('sales_date', startDate)
          .lte('sales_date', endDate)
          .order('sales_date', { ascending: false })
          .limit(view === 'monthly' ? 10000 : 5000),
        client.from('telemetry_fault_events')
          .select('id,fault_code,canonical_fault_code,canonical_title,severity,detail,recommended_action,started_at,last_seen_at,cleared_at')
          .eq('machine_id', machineId)
          .order('last_seen_at', { ascending: false })
          .limit(100),
      ]);

      if (customerQuery.error) throw customerQuery.error;
      if (siteQuery.error) throw siteQuery.error;
      if (stateQuery.error) throw stateQuery.error;
      if (salesQuery.error) throw salesQuery.error;
      if (faultQuery.error) throw faultQuery.error;

      let counterRows: Counter[] = [];
      let usageRow: Usage | null = null;
      let locationRow: LocationState | null = null;

      if (nextDevice) {
        const [counterQuery, usageQuery, locationQuery] = await Promise.all([
          client.from('telemetry_counter_state')
            .select('selection_code,sold_total,failed_total,revenue_cents_total,updated_at')
            .eq('device_id', nextDevice.id)
            .order('sold_total', { ascending: false }),
          client.rpc('get_telemetry_data_usage', { p_days: 30 }).eq('device_id', nextDevice.id).maybeSingle(),
          client.from('telemetry_device_location_state')
            .select('latitude,longitude,accuracy_m,source,fix_at,received_at,movement_detected')
            .eq('device_id', nextDevice.id)
            .maybeSingle(),
        ]);
        if (counterQuery.error) throw counterQuery.error;
        if (locationQuery.error) throw locationQuery.error;
        counterRows = (counterQuery.data ?? []) as Counter[];
        usageRow = usageQuery.error ? null : (usageQuery.data as Usage | null);
        locationRow = locationQuery.data as LocationState | null;
      }

      setMachine(nextMachine);
      setCustomer(customerQuery.data as Customer | null);
      setSite(siteQuery.data as Site | null);
      setDevice(nextDevice);
      setMachineState(stateQuery.data as MachineState | null);
      setSales(((salesQuery.data ?? []) as Sale[]).map((row) => ({
        ...row,
        units_sold: numberValue(row.units_sold),
        failed_vends: numberValue(row.failed_vends),
        revenue_cents: numberValue(row.revenue_cents),
      })));
      setCounters(counterRows.map((row) => ({
        ...row,
        sold_total: numberValue(row.sold_total),
        failed_total: numberValue(row.failed_total),
        revenue_cents_total: numberValue(row.revenue_cents_total),
      })));
      setFaults((faultQuery.data ?? []) as Fault[]);
      setUsage(usageRow);
      setLocation(locationRow);
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the machine dashboard.');
    } finally {
      setLoading(false);
    }
  }, [machineId, view]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refreshMs = view === 'live' ? 15_000 : 60_000;
    const timer = window.setInterval(() => void load(true), refreshMs);
    return () => window.clearInterval(timer);
  }, [load, view]);

  const productSummary = useMemo(() => {
    const rows = new Map<string, ProductSummary>();
    sales.forEach((sale) => {
      const key = sale.product_key || sale.sku || sale.selection_code;
      const current = rows.get(key) ?? {
        key,
        label: sale.product_name ?? sale.sku ?? sale.selection_code,
        sku: sale.sku,
        units: 0,
        failed: 0,
        revenue: 0,
      };
      current.units += sale.units_sold;
      current.failed += sale.failed_vends;
      current.revenue += sale.revenue_cents;
      rows.set(key, current);
    });
    return [...rows.values()].sort((a, b) => b.units - a.units);
  }, [sales]);

  const units = sales.reduce((sum, sale) => sum + sale.units_sold, 0);
  const failed = sales.reduce((sum, sale) => sum + sale.failed_vends, 0);
  const revenue = sales.reduce((sum, sale) => sum + sale.revenue_cents, 0);
  const attempts = units + failed;
  const successRate = attempts ? (units / attempts) * 100 : 100;
  const lifetimeCups = counters.reduce((sum, counter) => sum + counter.sold_total, 0);
  const openFaults = faults.filter((fault) => !fault.cleared_at);
  const usedBytes = actualUsage(usage);
  const projectedBytes = projectedUsage(usage);
  const contactAt = machineState?.last_device_contact_at ?? device?.last_heartbeat_at ?? device?.last_seen_at ?? null;
  const online = contactAt ? Date.now() - new Date(contactAt).getTime() <= 10 * 60_000 : false;

  async function saveReportingMode(mode: TelemetryMode) {
    if (!device || modeSaving || machineState?.telemetry_mode === mode) return;
    setModeSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { error: modeError } = await getSupabaseClient().rpc('set_telemetry_device_mode', {
        p_device_code: device.device_code,
        p_mode: mode,
      });
      if (modeError) throw modeError;
      setMessage(`Reporting cadence changed to ${VIEW_LABELS[mode]}.`);
      await load(true);
    } catch (modeError) {
      setError(modeError instanceof Error ? modeError.message : 'Reporting cadence could not be changed.');
    } finally {
      setModeSaving(false);
    }
  }

  if (loading && !machine) return <HamsterLoader label="Loading machine dashboard" />;

  return (
    <section className={styles.dashboard} data-machine-operations-dashboard="v4">
      <header className={styles.hero}>
        <div>
          <Link className={styles.back} href="/machines">‹ Machines</Link>
          <h1>{machine?.machine_name ?? machine?.model ?? machine?.serial_number ?? 'Machine'}</h1>
          <p>
            {customer?.customer_name ?? machine?.branch ?? 'Unassigned customer'}
            {site?.site_name ? ` · ${site.site_name}` : ''}
            {machine?.serial_number ? ` · ${machine.serial_number}` : ''}
          </p>
        </div>
        <div className={styles.heroActions}>
          <span className={`${styles.connection} ${online ? styles.online : styles.offline}`}>
            <i />{device ? (online ? 'Online' : 'Offline') : 'No device'}
          </span>
          <button type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      <div className={styles.controlBar}>
        <div className={styles.segment} aria-label="Reporting view">
          <span>View</span>
          {(['live', 'daily', 'monthly'] as ReportView[]).map((option) => (
            <button
              aria-pressed={view === option}
              className={view === option ? styles.active : ''}
              key={option}
              onClick={() => setView(option)}
              type="button"
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>
        <div className={styles.segment} aria-label="Device reporting cadence">
          <span>Device reporting</span>
          {(['live', 'daily', 'monthly'] as TelemetryMode[]).map((option) => (
            <button
              aria-pressed={machineState?.telemetry_mode === option}
              className={machineState?.telemetry_mode === option ? styles.active : ''}
              disabled={!device || modeSaving}
              key={option}
              onClick={() => void saveReportingMode(option)}
              type="button"
            >
              {VIEW_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}

      <section className={styles.stats}>
        <Stat label="Cups sold" value={units.toLocaleString('en-ZA')} helper={`${VIEW_LABELS[view]} view`} />
        <Stat label="Vend success" value={`${successRate.toFixed(1)}%`} helper={`${failed.toLocaleString('en-ZA')} failed`} tone={successRate >= 98 ? 'good' : successRate >= 95 ? 'warning' : 'danger'} />
        <Stat label="Revenue" value={money(revenue)} helper={`${attempts.toLocaleString('en-ZA')} attempts`} />
        <Stat label="Lifetime cups" value={lifetimeCups.toLocaleString('en-ZA')} helper={`${counters.length} selections`} tone="good" />
        <Stat label="Open faults" value={openFaults.length.toLocaleString('en-ZA')} helper={machineState?.machine_status ?? 'Machine state'} tone={openFaults.length ? 'danger' : 'good'} />
        <Stat label="30-day data" value={bytes(usedBytes)} helper={`${bytes(projectedBytes)} projected/month`} tone="warning" />
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <header><div><span>Products / SKU</span><h2>Vend counters</h2></div><strong>{productSummary.length} products</strong></header>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Product</th><th>SKU / selection</th><th>Cups</th><th>Failed</th><th>Revenue</th></tr></thead>
              <tbody>
                {productSummary.slice(0, 20).map((product) => (
                  <tr key={product.key}>
                    <td><strong>{product.label}</strong></td>
                    <td>{product.sku ?? product.key}</td>
                    <td>{product.units.toLocaleString('en-ZA')}</td>
                    <td>{product.failed.toLocaleString('en-ZA')}</td>
                    <td>{money(product.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!productSummary.length ? <p className={styles.empty}>No vend activity in this reporting window.</p> : null}
          </div>
        </article>

        <article className={styles.card}>
          <header><div><span>Connectivity</span><h2>Device & SIM</h2></div><Link href={device ? `/telemetry/devices?device=${encodeURIComponent(device.device_code)}` : '/telemetry/devices'}>Settings</Link></header>
          <dl className={styles.details}>
            <div><dt>Telemetry device</dt><dd>{device?.device_code ?? 'Not assigned'}</dd></div>
            <div><dt>Transport</dt><dd>{device?.last_transport === 'wifi' ? 'Wi-Fi' : device?.last_transport === 'cellular' ? 'Cellular' : 'Not reported'}</dd></div>
            <div><dt>Signal</dt><dd>{device ? <SignalStrengthIndicator cellularCsq={device.cellular_csq} transport={device.last_transport} wifiRssi={device.wifi_rssi} /> : '—'}</dd></div>
            <div><dt>SIM operator</dt><dd>{device?.cellular_operator ?? 'Not reported'}</dd></div>
            <div><dt>Modem</dt><dd>{device?.cellular_model ?? 'Not reported'}</dd></div>
            <div><dt>Last contact</dt><dd>{age(contactAt)}</dd></div>
            <div><dt>Last upload</dt><dd>{age(device?.last_upload_at)}</dd></div>
            <div><dt>Firmware</dt><dd>{device?.firmware_version ?? 'Not reported'}</dd></div>
            <div><dt>Data used</dt><dd>{bytes(usedBytes)}</dd></div>
            <div><dt>Monthly projection</dt><dd>{bytes(projectedBytes)}</dd></div>
          </dl>
          <div className={styles.linkRow}>
            {device ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(device.device_code)}`}>Open Test Center</Link> : null}
            <Link href="/telemetry/devices">Device management</Link>
          </div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.card}>
          <header><div><span>Location</span><h2>Latest device position</h2></div><Link href="/map">Fleet map</Link></header>
          <dl className={styles.details}>
            <div><dt>Source</dt><dd>{locationSource(location?.source)}</dd></div>
            <div><dt>Coordinates</dt><dd>{location?.latitude != null && location?.longitude != null ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Not received'}</dd></div>
            <div><dt>Accuracy</dt><dd>{location?.accuracy_m != null ? `±${Math.round(location.accuracy_m)} m` : location?.source === 'cellular_lbs' ? 'Network estimate' : 'Not reported'}</dd></div>
            <div><dt>Last fix</dt><dd>{formatDate(location?.fix_at ?? location?.received_at)}</dd></div>
            <div><dt>Movement</dt><dd>{location?.movement_detected ? 'Detected' : 'No movement reported'}</dd></div>
            <div><dt>Assigned site</dt><dd>{site?.address ?? site?.site_name ?? 'Not assigned'}</dd></div>
          </dl>
          {location?.source === 'cellular_lbs' ? <p className={styles.note}>Cellular LBS is approximate network-derived location, not street-level GPS precision.</p> : null}
        </article>

        <article className={styles.card}>
          <header><div><span>Errors & faults</span><h2>Current machine health</h2></div><strong>{openFaults.length} open</strong></header>
          <div className={styles.faultList}>
            {openFaults.slice(0, 8).map((fault) => (
              <article className={styles.fault} key={fault.id}>
                <div><strong>{fault.canonical_title ?? fault.canonical_fault_code ?? fault.fault_code}</strong><span className={styles.severity}>{fault.severity}</span></div>
                <p>{fault.detail ?? 'No additional machine detail.'}</p>
                {fault.recommended_action ? <small>{fault.recommended_action}</small> : null}
                <time>{age(fault.last_seen_at)}</time>
              </article>
            ))}
            {!openFaults.length ? <p className={styles.empty}>No unresolved machine faults.</p> : null}
          </div>
        </article>
      </section>

      <footer className={styles.footer}>
        <span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Not yet updated'}</span>
        <span>Machine {machine?.machine_barcode ?? machine?.serial_number ?? machineId}</span>
      </footer>
    </section>
  );
}
