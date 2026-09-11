'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryConfigSyncPanel.module.css';

type SyncStatus = 'pending' | 'applied' | 'mismatch' | 'superseded';
type ConfigRecord = Record<string, unknown>;

type HistoryRow = {
  id: string;
  requested_by_auth_user_id: string | null;
  requested_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  status: SyncStatus;
  requested_config: ConfigRecord;
  applied_config: ConfigRecord | null;
  differences: Record<string, { requested?: unknown; applied?: unknown }>;
  unreported_fields: string[];
};

type SyncPayload = {
  device_id: string;
  device_code: string;
  last_config_at: string | null;
  last_config_ack_at: string | null;
  applied_config: ConfigRecord;
  history: HistoryRow[];
};

const fieldLabels: Record<string, string> = {
  mode: 'Reporting mode',
  transport_preference: 'Preferred network',
  wifi_enabled: 'Wi-Fi enabled',
  cellular_enabled: 'Cellular enabled',
  location_enabled: 'Location enabled',
  location_interval_minutes: 'Location interval',
  location_min_move_m: 'Movement threshold',
  mdb_master_polarity: 'MDB Master-TX polarity',
  mdb_slave_polarity: 'MDB Master-RX polarity',
  mdb_pin_swap: 'MDB GPIO4/GPIO5 pin order',
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString('en-ZA');
  return String(value).replaceAll('_', ' ');
}

function statusCopy(row: HistoryRow | null) {
  if (!row) return { label: 'No tracked change', helper: 'No configuration request has been recorded since sync history was enabled.', tone: 'neutral' as const };
  if (row.status === 'pending' && !row.delivered_at) return { label: 'Pending device fetch', helper: 'Saved in the control plane. Waiting for the controller to request its configuration.', tone: 'pending' as const };
  if (row.status === 'pending') return { label: 'Sent · waiting for ACK', helper: 'The controller fetched this configuration. Waiting for its applied-configuration acknowledgement.', tone: 'pending' as const };
  if (row.status === 'mismatch') return { label: 'Configuration mismatch', helper: 'The controller acknowledged the request but one or more reported values differ.', tone: 'mismatch' as const };
  if (row.status === 'superseded') return { label: 'Superseded', helper: 'A newer configuration request replaced this one before acknowledgement.', tone: 'neutral' as const };
  return { label: 'Applied', helper: 'The controller acknowledged the configuration and all comparable reported values match.', tone: 'applied' as const };
}

export function TelemetryConfigSyncPanel({ deviceId }: { deviceId: string }) {
  const [payload, setPayload] = useState<SyncPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error: requestError } = await getSupabaseClient().rpc('get_telemetry_device_config_history', {
      p_device_id: deviceId,
      p_limit: 12,
    });
    if (requestError) {
      setError(requestError.message);
      setLoading(false);
      return;
    }
    setPayload((data ?? null) as SyncPayload | null);
    setError(null);
    setLoading(false);
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(true); };
    const timer = globalThis.setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { globalThis.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  const latest = payload?.history?.[0] ?? null;
  const copy = statusCopy(latest);
  const applied = latest?.applied_config ?? payload?.applied_config ?? {};
  const appliedEntries = useMemo(() => [
    ['mode', applied.mode],
    ['transport_preference', applied.transport_preference],
    ['wifi_enabled', applied.wifi_enabled],
    ['cellular_enabled', applied.cellular_enabled],
    ['location_enabled', applied.location_enabled],
    ['location_interval_minutes', applied.location_interval_minutes],
    ['location_min_move_m', applied.location_min_move_m],
  ].filter(([, value]) => value !== undefined), [applied]);
  const differences = latest ? Object.entries(latest.differences ?? {}) : [];
  const unreported = latest?.unreported_fields ?? [];

  return <section className={styles.panel} data-config-sync={latest?.status ?? 'none'}>
    <header className={styles.header}>
      <div><span>Configuration sync</span><h3>Requested vs applied</h3></div>
      <span className={`${styles.status} ${styles[copy.tone]}`}><i />{copy.label}</span>
    </header>

    {loading && !payload ? <div className={styles.state}>Loading configuration sync history…</div> : null}
    {error ? <div className={`${styles.state} ${styles.error}`} role="alert"><strong>Sync history unavailable</strong><span>{error}</span><button onClick={() => void load()} type="button">Retry</button></div> : null}

    {payload && !error ? <>
      <p className={styles.helper}>{copy.helper}</p>
      <dl className={styles.timeline}>
        <div><dt>Requested</dt><dd>{formatDate(latest?.requested_at)}</dd></div>
        <div><dt>Device fetched</dt><dd>{formatDate(latest?.delivered_at ?? payload.last_config_at)}</dd></div>
        <div><dt>Device ACK</dt><dd>{formatDate(latest?.acknowledged_at ?? payload.last_config_ack_at)}</dd></div>
      </dl>

      {appliedEntries.length ? <div className={styles.applied}><span>Last device-reported applied values</span><div>{appliedEntries.map(([key, value]) => <span key={key}><b>{fieldLabels[key] ?? key}</b>{displayValue(value)}</span>)}</div></div> : <div className={styles.notice}>The controller has not reported an applied-configuration payload yet.</div>}

      {differences.length ? <div className={`${styles.notice} ${styles.mismatchNotice}`}><strong>Reported mismatches</strong>{differences.map(([key, values]) => <span key={key}>{fieldLabels[key] ?? key}: requested <b>{displayValue(values.requested)}</b>, applied <b>{displayValue(values.applied)}</b></span>)}</div> : null}

      {unreported.length ? <div className={styles.notice}><strong>Saved but not reported by the current ACK</strong><span>{unreported.map((key) => fieldLabels[key] ?? key).join(' · ')}</span><small>These settings remain in the website control plane and are sent by the configuration service. Their absence from the current ACK is not treated as a failure.</small></div> : null}

      <div className={styles.history}>
        <div className={styles.historyTitle}><span>Recent changes</span><b>{payload.history.length}</b></div>
        {payload.history.length ? payload.history.slice(0, 8).map((row) => {
          const rowCopy = statusCopy(row);
          const keys = Object.keys(row.requested_config ?? {}).filter((key) => ['mode','transport_preference','wifi_enabled','cellular_enabled','mdb_master_polarity','mdb_slave_polarity','mdb_pin_swap','location_interval_minutes','location_min_move_m'].includes(key));
          return <article key={row.id}><span className={`${styles.historyDot} ${styles[rowCopy.tone]}`} /><div><strong>{rowCopy.label}</strong><span>{formatDate(row.requested_at)}</span><small>{keys.slice(0, 5).map((key) => `${fieldLabels[key] ?? key}: ${displayValue(row.requested_config[key])}`).join(' · ')}</small></div></article>;
        }) : <div className={styles.empty}>No tracked configuration changes yet. Existing ACK data is still shown above when available.</div>}
      </div>
    </> : null}
  </section>;
}
