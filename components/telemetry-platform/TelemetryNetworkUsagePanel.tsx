'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';
import { collectSupabasePagesResult } from '@/lib/supabase/collect-pages';
import styles from './TelemetryNetworkUsagePanel.module.css';

type Transport = 'wifi' | 'cellular';

type DeviceNetworkState = {
  id: string;
  device_code: string;
  last_transport: Transport | null;
  last_transport_at: string | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
};

type TransportUsage = {
  device_id: string;
  transport: Transport;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  days_observed: number;
  last_reported_at: string | null;
};

type DeviceTransportUsage = Partial<Record<Transport, TransportUsage>>;

const PAGE_SIZE = 50;

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / (1024 ** index);
  return `${amount.toFixed(index === 0 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) return 'Not reported';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function transportLabel(value: Transport | null) {
  if (value === 'wifi') return 'Wi-Fi';
  if (value === 'cellular') return 'Cellular';
  return 'Not reported';
}

function measuredBytes(usage: TransportUsage | undefined) {
  if (!usage) return 0;
  if (Number(usage.modem_sample_count ?? 0) > 0) return Number(usage.measured_modem_bytes ?? 0);
  if (Number(usage.device_application_sample_count ?? 0) > 0) return Number(usage.device_application_bytes ?? 0);
  return Number(usage.application_bytes ?? 0);
}

function measurementLabel(usage: TransportUsage | undefined) {
  if (!usage) return 'No samples';
  if (Number(usage.modem_sample_count ?? 0) > 0) return 'Modem measured';
  if (Number(usage.device_application_sample_count ?? 0) > 0) return 'Device measured';
  return 'Server minimum';
}

export function TelemetryNetworkUsagePanel() {
  const [devices, setDevices] = useState<DeviceNetworkState[]>([]);
  const [usageByDevice, setUsageByDevice] = useState<Record<string, DeviceTransportUsage>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    const deviceRows = collectSupabasePagesResult<DeviceNetworkState>(async (from, to) => {
      const { data, error: pageError } = await client
        .from('telemetry_devices')
        .select('id,device_code,last_transport,last_transport_at,wifi_rssi,cellular_csq,cellular_operator')
        .order('device_code', { ascending: true })
        .range(from, to);
      return { data: (data ?? []) as DeviceNetworkState[], error: pageError };
    });

    const usageRows = collectSupabasePagesResult<TransportUsage>(async (from, to) => {
      const { data, error: pageError } = await client
        .rpc('get_telemetry_transport_usage', { p_days: 30 })
        .range(from, to);
      return { data: (data ?? []) as TransportUsage[], error: pageError };
    });

    const [deviceResult, usageResult] = await Promise.all([deviceRows, usageRows]);
    if (deviceResult.error || usageResult.error) {
      setError(deviceResult.error?.message ?? usageResult.error?.message ?? 'Network usage could not be loaded.');
      if (showLoader) setLoading(false);
      return;
    }

    const byDevice: Record<string, DeviceTransportUsage> = {};
    usageResult.data.forEach((row) => {
      if (row.transport !== 'wifi' && row.transport !== 'cellular') return;
      byDevice[row.device_id] = { ...byDevice[row.device_id], [row.transport]: row };
    });

    setDevices(deviceResult.data);
    setUsageByDevice(byDevice);
    setLastUpdated(new Date());
    if (showLoader) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const filteredDevices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return devices;
    return devices.filter((device) => [
      device.device_code,
      device.cellular_operator ?? '',
      transportLabel(device.last_transport),
    ].join(' ').toLowerCase().includes(term));
  }, [devices, search]);

  const fleet = useMemo(() => devices.reduce((totals, device) => {
    const usage = usageByDevice[device.id];
    totals.wifiBytes += measuredBytes(usage?.wifi);
    totals.cellularBytes += measuredBytes(usage?.cellular);
    if (device.last_transport === 'wifi') totals.currentWifi += 1;
    if (device.last_transport === 'cellular') totals.currentCellular += 1;
    return totals;
  }, { wifiBytes: 0, cellularBytes: 0, currentWifi: 0, currentCellular: 0 }), [devices, usageByDevice]);

  const pageCount = Math.max(1, Math.ceil(filteredDevices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleDevices = filteredDevices.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search]);

  return (
    <section className={styles.panel} aria-labelledby="network-usage-heading">
      <header className={styles.header}>
        <div>
          <span>Transport audit</span>
          <h2 id="network-usage-heading">Network usage by device</h2>
          <p>Actual successful transport and separate Wi-Fi/cellular traffic for the selected telemetry region.</p>
        </div>
        <div className={styles.headerActions}>
          <small>{lastUpdated ? `Updated ${formatDate(lastUpdated.toISOString())}` : 'Not refreshed yet'}</small>
          <button disabled={loading} onClick={() => void load(false)} type="button">Refresh usage</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.metrics}>
        <article><span>Wi-Fi · last 30 days</span><strong>{formatBytes(fleet.wifiBytes)}</strong><small>{fleet.currentWifi.toLocaleString('en-ZA')} currently reporting Wi-Fi</small></article>
        <article><span>Cellular · last 30 days</span><strong>{formatBytes(fleet.cellularBytes)}</strong><small>{fleet.currentCellular.toLocaleString('en-ZA')} currently reporting cellular</small></article>
        <article><span>Current transport</span><strong>{(fleet.currentWifi + fleet.currentCellular).toLocaleString('en-ZA')}</strong><small>Devices with a confirmed successful transport</small></article>
      </div>

      <div className={styles.toolbar}>
        <label>
          <span>Search network usage</span>
          <input aria-label="Search network usage" onChange={(event) => setSearch(event.target.value)} placeholder="Device ID, operator or transport" value={search} />
        </label>
        <span>{filteredDevices.length.toLocaleString('en-ZA')} devices</span>
      </div>

      {loading && devices.length === 0 ? <div className={styles.loading}>Loading per-network usage…</div> : (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>Device</th><th>Current transport</th><th>Signal</th><th>Wi-Fi · last 30 days</th><th>Cellular · last 30 days</th><th>Transport confirmed</th></tr></thead>
            <tbody>
              {visibleDevices.map((device) => {
                const deviceUsage = usageByDevice[device.id];
                return (
                  <tr key={device.id}>
                    <td><strong>{device.device_code}</strong><span>{device.cellular_operator ?? 'No cellular operator reported'}</span></td>
                    <td><strong>{transportLabel(device.last_transport)}</strong><span>{device.last_transport ? 'Successful upload transport' : 'Awaiting first report'}</span></td>
                    <td><SignalStrengthIndicator cellularCsq={device.cellular_csq} compact transport={device.last_transport} wifiRssi={device.wifi_rssi} /></td>
                    <td><strong>{formatBytes(measuredBytes(deviceUsage?.wifi))}</strong><span>{measurementLabel(deviceUsage?.wifi)}</span></td>
                    <td><strong>{formatBytes(measuredBytes(deviceUsage?.cellular))}</strong><span>{measurementLabel(deviceUsage?.cellular)}</span></td>
                    <td><strong>{formatDate(device.last_transport_at)}</strong><span>{device.last_transport ? `${transportLabel(device.last_transport)} receipt time` : 'No transport receipt yet'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className={styles.footer}>
        <span>Showing {filteredDevices.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(currentPage * PAGE_SIZE, filteredDevices.length)} of {filteredDevices.length.toLocaleString('en-ZA')}</span>
        <div><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><span>Page {currentPage} of {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div>
      </footer>
    </section>
  );
}
