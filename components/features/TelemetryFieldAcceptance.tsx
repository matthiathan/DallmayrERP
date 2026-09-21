'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryFieldAcceptance.module.css';

type DeviceEvidence = {
  id: string;
  device_code: string;
  status: string;
  last_seen_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  cellular_operator: string | null;
  firmware_version: string | null;
  reported_machine_interface: string | null;
  reported_machine_model: string | null;
  profile_id: string | null;
  profile_assignment_method: 'automatic' | 'manual' | null;
  applied_config: Record<string, unknown> | null;
};

type SessionEvidence = {
  id: string;
  status: 'active' | 'stopped' | 'expired';
  started_at: string;
  expires_at: string;
  acknowledged_at: string | null;
  last_device_contact_at: string | null;
  last_log_at: string | null;
};

type LogEvidence = {
  id: number;
  category: string | null;
  message: string;
  received_at: string;
};

type AcceptanceCheck = {
  label: string;
  passed: boolean;
  detail: string;
};

const SESSION_COLUMNS = 'id,status,started_at,expires_at,acknowledged_at,last_device_contact_at,last_log_at';
const LOG_LIMIT = 500;
const RECENT_DEVICE_MS = 5 * 60 * 1000;
const STREAMING_MS = 30 * 1000;

function ageMs(value: string | null, now: number) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : Number.POSITIVE_INFINITY;
}

function ageLabel(value: string | null, now: number) {
  const age = ageMs(value, now);
  if (!Number.isFinite(age)) return 'never';
  if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  return `${Math.floor(age / 3_600_000)}h ago`;
}

function appliedProfile(device: DeviceEvidence | null) {
  const applied = device?.applied_config?.profile_id;
  if (typeof applied === 'string' && applied.trim()) return applied.trim();
  return device?.profile_id?.trim() || null;
}

function evidenceText(logs: LogEvidence[]) {
  return logs.map((log) => `${log.category ?? ''} ${log.message}`).join('\n');
}

export function TelemetryFieldAcceptance() {
  const client = useMemo(() => getSupabaseClient(), []);
  const [deviceCode, setDeviceCode] = useState('');
  const [device, setDevice] = useState<DeviceEvidence | null>(null);
  const [session, setSession] = useState<SessionEvidence | null>(null);
  const [logs, setLogs] = useState<LogEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const loadEvidence = useCallback(async (requestedDeviceCode: string) => {
    const requested = requestedDeviceCode.trim();
    if (!requested) {
      setDevice(null);
      setSession(null);
      setLogs([]);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: deviceRows, error: deviceError } = await client.rpc('search_telemetry_test_devices', {
      p_search: requested,
      p_limit: 25,
    });

    if (deviceError) {
      setError(deviceError.message);
      setLoading(false);
      return;
    }

    const candidates = (deviceRows ?? []) as DeviceEvidence[];
    const selected = candidates.find((item) => item.device_code.toLocaleLowerCase('en-ZA') === requested.toLocaleLowerCase('en-ZA')) ?? null;
    setDevice(selected);

    if (!selected) {
      setSession(null);
      setLogs([]);
      setLoading(false);
      return;
    }

    const { data: latestSession, error: sessionError } = await client
      .from('telemetry_test_sessions')
      .select(SESSION_COLUMNS)
      .eq('device_id', selected.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessionError) {
      setError(sessionError.message);
      setSession(null);
      setLogs([]);
      setLoading(false);
      return;
    }

    const normalizedSession = (latestSession ?? null) as SessionEvidence | null;
    setSession(normalizedSession);

    if (!normalizedSession) {
      setLogs([]);
      setLoading(false);
      return;
    }

    const { data: logRows, error: logError } = await client.rpc('get_telemetry_test_logs', {
      p_session_id: normalizedSession.id,
      p_after_id: 0,
      p_limit: LOG_LIMIT,
    });

    if (logError) {
      setError(logError.message);
      setLogs([]);
      setLoading(false);
      return;
    }

    setLogs((logRows ?? []) as LogEvidence[]);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('device')?.trim() ?? '';
    setDeviceCode(requested);
    void loadEvidence(requested);

    const refresh = window.setInterval(() => void loadEvidence(requested), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(clock);
    };
  }, [loadEvidence]);

  const checks = useMemo<AcceptanceCheck[]>(() => {
    const text = evidenceText(logs);
    const recentContact = device ? ageMs(device.last_seen_at, now) <= RECENT_DEVICE_MS : false;
    const activeSession = session?.status === 'active' && new Date(session.expires_at).getTime() > now;
    const acknowledged = Boolean(activeSession && session?.acknowledged_at);
    const streaming = Boolean(activeSession && session?.last_log_at && ageMs(session.last_log_at, now) <= STREAMING_MS);
    const protocol = device?.reported_machine_interface?.trim() || null;
    const profile = appliedProfile(device);
    const selection = /(?:selection|selected|button\s*(?:press|code)|product\s*(?:selected|selection)|choice)/i.test(text);
    const vend = /(?:vend[^\n]*(?:success|complete|completed|accepted|free|failed|cancel)|(?:success|free|failed|cancel)[^\n]*vend|vend[_ -]?result|vend outcome)/i.test(text);
    const counter = /(?:cup\s*counter|counter[^\n]*(?:increment|delta|count)|cups?\s*[+=:])/i.test(text);

    return [
      {
        label: 'Device contact',
        passed: recentContact,
        detail: device?.last_seen_at ? `Last device contact ${ageLabel(device.last_seen_at, now)}.` : 'No device contact has been recorded.',
      },
      {
        label: 'Cellular transport',
        passed: device?.last_transport === 'cellular',
        detail: device ? `Last accepted transport: ${device.last_transport ?? 'unknown'}${device.cellular_operator ? ` · ${device.cellular_operator}` : ''}.` : 'Waiting for the selected device.',
      },
      {
        label: 'Test session acknowledged',
        passed: acknowledged,
        detail: session ? (session.acknowledged_at ? `Device acknowledged the latest session ${ageLabel(session.acknowledged_at, now)}.` : 'Latest session is waiting for device acknowledgement.') : 'No Test Center session exists yet.',
      },
      {
        label: 'Logs streaming',
        passed: streaming,
        detail: session?.last_log_at ? `Latest diagnostic log ${ageLabel(session.last_log_at, now)}.` : 'No diagnostic log has reached this session.',
      },
      {
        label: 'Machine interface identified',
        passed: Boolean(protocol),
        detail: protocol ? `${protocol.toUpperCase()}${device?.reported_machine_model ? ` · ${device.reported_machine_model}` : ''}.` : 'Device has not reported MDB/DEX identity yet.',
      },
      {
        label: 'Decoder profile applied',
        passed: Boolean(profile),
        detail: profile ? `${profile}${device?.profile_assignment_method ? ` · ${device.profile_assignment_method}` : ''}.` : 'No applied decoder profile is visible yet.',
      },
      {
        label: 'Product selection evidence',
        passed: selection,
        detail: selection ? 'Selection/product evidence exists in the latest captured session.' : 'Perform a known product selection while the session is streaming.',
      },
      {
        label: 'Vend evidence',
        passed: vend,
        detail: vend ? 'A completed/free/failed/cancelled vend outcome is present in the captured evidence.' : 'No conclusive vend outcome has been captured yet.',
      },
      {
        label: 'Cup counter evidence',
        passed: counter,
        detail: counter ? 'Cup/counter evidence is present in the latest captured session.' : 'No cup-counter increment/delta evidence has been captured yet.',
      },
    ];
  }, [device, logs, now, session]);

  const passedCount = checks.filter((check) => check.passed).length;

  if (!deviceCode) {
    return (
      <section className={styles.panel} aria-label="Field acceptance">
        <div className={styles.heading}>
          <div><span>Field acceptance</span><strong>Choose a telemetry device first</strong></div>
          <span className={styles.score}>0 / {checks.length}</span>
        </div>
        <p>Open this Test Center from Device Management so the device code is carried in the URL. The acceptance panel will then score only evidence from that device.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Field acceptance">
      <div className={styles.heading}>
        <div>
          <span>Field acceptance</span>
          <strong>{device?.device_code ?? deviceCode}</strong>
          <small>{device?.firmware_version ? `Firmware ${device.firmware_version}` : 'Evidence from the latest Test Center session'}</small>
        </div>
        <span className={`${styles.score} ${passedCount === checks.length ? styles.complete : ''}`}>
          {passedCount} / {checks.length} proven
        </span>
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading && !device ? <p>Loading field evidence…</p> : null}
      {!loading && !device ? <p>No active telemetry device exactly matching <code>{deviceCode}</code> was found in the selected telemetry region.</p> : null}

      <div className={styles.grid}>
        {checks.map((check) => (
          <article className={`${styles.check} ${check.passed ? styles.passed : styles.waiting}`} key={check.label}>
            <span aria-hidden="true" className={styles.marker}>{check.passed ? '✓' : '·'}</span>
            <div><strong>{check.label}</strong><small>{check.detail}</small></div>
          </article>
        ))}
      </div>

      <div className={styles.footer}>
        <strong>{passedCount === checks.length ? 'Evidence chain complete for this captured session.' : 'Keep the Test Center session running while performing the controlled field test.'}</strong>
        <span>Final product quantities still need to be reconciled against live/daily/monthly reporting after the physical vend sequence.</span>
      </div>
    </section>
  );
}
