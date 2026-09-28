'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineOperationsSnapshot.module.css';

type Transport = 'wifi' | 'cellular';

type Device = {
  id: string;
  device_code: string;
  profile_id: string | null;
  telemetry_mode: 'live' | 'daily' | 'monthly' | null;
  last_transport: Transport | null;
  transport_preference: 'auto' | 'wifi' | 'cellular';
  wifi_rssi: number | null;
  cellular_csq: number | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_upload_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
};

type TransportUsage = {
  device_id: string;
  transport: string;
  application_bytes: number;
  device_application_bytes: number;
  device_application_sample_count: number;
  measured_modem_bytes: number;
  modem_sample_count: number;
  last_reported_at: string | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBytes(value: number) {
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / (1024 ** index);
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function dateTime(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function usageBytes(row: TransportUsage | undefined) {
  if (!row) return 0;
  if (numberValue(row.modem_sample_count) > 0) return numberValue(row.measured_modem_bytes);
  if (numberValue(row.device_application_sample_count) > 0) return numberValue(row.device_application_bytes);
  return numberValue(row.application_bytes);
}

function configStatus(device: Device | null) {
  if (!device) return { label: 'No device', tone: 'neutral' } as const;
  if (!device.last_config_at) return { label: 'Not sent', tone: 'neutral' } as const;
  if (!device.last_config_ack_at) return { label: 'Pending acknowledgement', tone: 'warning' } as const;
  const sent = new Date(device.last_config_at).getTime();
  const acknowledged = new Date(device.last_config_ack_at).getTime();
  if (acknowledged >= sent) return { label: 'Acknowledged', tone: 'success' } as const;
  return { label: 'Update pending', tone: 'warning' } as const;
}

function reportingMode(value: Device['telemetry_mode']) {
  if (value === 'live') return 'Live';
  if (value === 'daily') return 'Daily';
  if (value === 'monthly') return 'Monthly';
  return 'Not reported';
}

function transportLabel(value: Device['last_transport']) {
  if (value === 'wifi') return 'Wi-Fi';
  if (value === 'cellular') return 'Cellular';
  return 'Not reported';
}

export function MachineOperationsSnapshot({ machineId }: { machineId: string }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [usage, setUsage] = useState<TransportUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    try {
      const { data: deviceData, error: deviceError } = await client
        .from('telemetry_devices')
        .select('id,device_code,profile_id,telemetry_mode,last_transport,transport_preference,wifi_rssi,cellular_csq,last_seen_at,last_heartbeat_at,last_upload_at,last_config_at,last_config_ack_at')
        .eq('machine_id', machineId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (deviceError) throw deviceError;
      const nextDevice = (deviceData ?? null) as Device | null;
      setDevice(nextDevice);

      if (!nextDevice) {
        setUsage([]);
        return;
      }

      const { data: usageData, error: usageError } = await client
        .rpc('get_telemetry_transport_usage', { p_days: 30 })
        .eq('device_id', nextDevice.id);
      if (usageError) throw usageError;
      setUsage((usageData ?? []) as TransportUsage[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load operational telemetry state.');
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    void load();
    const timer = globalThis.setInterval(() => { void load(true); }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const wifi = useMemo(() => usage.find((row) => row.transport === 'wifi'), [usage]);
  const cellular = useMemo(() => usage.find((row) => row.transport === 'cellular'), [usage]);
  const wifiBytes = usageBytes(wifi);
  const cellularBytes = usageBytes(cellular);
  const totalBytes = wifiBytes + cellularBytes;
  const config = configStatus(device);
  const lastContact = device?.last_heartbeat_at ?? device?.last_seen_at ?? null;

  return (
    <section className={styles.panel} aria-label="Machine operational telemetry snapshot" data-machine-operations-snapshot="v1">
      <header className={styles.header}>
        <div>
          <span>Operational telemetry</span>
          <h2>Machine connection snapshot</h2>
          <p>Current device path, reporting policy, configuration state and 30-day network usage.</p>
        </div>
        <button disabled={loading} onClick={() => void load()} type="button">{loading ? 'Refreshing…' : 'Refresh snapshot'}</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.metrics}>
        <article>
          <span>Current transport</span>
          <strong>{transportLabel(device?.last_transport ?? null)}</strong>
          <small>{device ? `Preference: ${device.transport_preference}` : 'No telemetry device assigned'}</small>
        </article>
        <article>
          <span>Signal</span>
          <strong className={styles.signal}>{device ? <SignalStrengthIndicator cellularCsq={device.cellular_csq} transport={device.last_transport} wifiRssi={device.wifi_rssi} /> : '—'}</strong>
          <small>{device?.last_transport === 'wifi' && device.wifi_rssi != null ? `${device.wifi_rssi} dBm` : device?.last_transport === 'cellular' && device.cellular_csq != null ? `${device.cellular_csq} CSQ` : 'No current signal sample'}</small>
        </article>
        <article>
          <span>Reporting mode</span>
          <strong>{reportingMode(device?.telemetry_mode ?? null)}</strong>
          <small>Live / Daily / Monthly device policy</small>
        </article>
        <article>
          <span>Configuration</span>
          <strong className={styles[config.tone]}>{config.label}</strong>
          <small>{device?.last_config_ack_at ? `Ack ${dateTime(device.last_config_ack_at)}` : device?.last_config_at ? `Sent ${dateTime(device.last_config_at)}` : 'No configuration timestamp'}</small>
        </article>
        <article>
          <span>Decoder profile</span>
          <strong>{device?.profile_id ?? 'Not persisted'}</strong>
          <small>{device?.profile_id ? 'Trusted device profile' : 'Identity/profile review may still be required'}</small>
        </article>
        <article>
          <span>Last contact</span>
          <strong>{dateTime(lastContact)}</strong>
          <small>{device?.last_upload_at ? `Last upload ${dateTime(device.last_upload_at)}` : 'No upload timestamp'}</small>
        </article>
      </div>

      <div className={styles.usageGrid} aria-label="Per-network data usage">
        <article><span>Wi-Fi usage</span><strong>{formatBytes(wifiBytes)}</strong><small>Last 30 days · best available measured bytes</small></article>
        <article><span>Cellular usage</span><strong>{formatBytes(cellularBytes)}</strong><small>Last 30 days · best available measured bytes</small></article>
        <article><span>Total usage</span><strong>{formatBytes(totalBytes)}</strong><small>Wi-Fi + cellular for this telemetry device</small></article>
      </div>

      <footer className={styles.footer}>
        <div>
          <strong>{device?.device_code ?? 'No telemetry device assigned'}</strong>
          <span>{usage.length ? 'Usage split is based on accepted transport-labelled telemetry.' : 'No per-network usage samples are available yet.'}</span>
        </div>
        <nav aria-label="Machine telemetry actions">
          {device?.device_code ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(device.device_code)}`}>Test Center</Link> : null}
          <Link href="/telemetry/devices">Device Management</Link>
          <Link href="/products">Product Mappings</Link>
        </nav>
      </footer>
    </section>
  );
}
