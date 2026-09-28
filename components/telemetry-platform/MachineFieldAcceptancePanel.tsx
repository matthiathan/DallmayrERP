'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineFieldAcceptancePanel.module.css';

type Device = {
  id: string;
  device_code: string;
  profile_id: string | null;
  machine_link_status: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_config_at: string | null;
  last_config_ack_at: string | null;
};

type Readiness = {
  machine_linked?: boolean;
  profile_ready?: boolean;
  mapping_ready?: boolean;
  ready_for_acceptance?: boolean;
  trusted_profile_key?: string | null;
  trusted_profile_name?: string | null;
  has_instant_porridge?: boolean;
  has_caramel_cappuccino?: boolean;
  other_mapped_product_count?: number;
  blockers?: string[];
};

type EvidenceSnapshot = {
  pass_ready?: boolean;
  checks?: Record<string, boolean>;
  controlled_plan_reconciliation?: {
    reconciled?: boolean;
    instant_porridge_units?: number;
    caramel_cappuccino_units?: number;
    other_mapped_units?: number;
    negative_or_free_scenario?: number;
  };
  reporting_reconciliation?: {
    reconciled?: boolean;
    live_success_units?: number;
    daily_delta_units?: number;
    monthly_delta_units?: number;
  };
  data_usage_evidence?: {
    reconciled?: boolean;
    cellular_bytes_delta?: number;
    last_transport?: string | null;
  };
};

type AcceptanceRecord = {
  id: string;
  outcome: 'passed' | 'failed';
  operator_notes: string | null;
  evidence_snapshot: EvidenceSnapshot | null;
  recorded_at: string;
  test_session_id: string;
};

type TestSession = {
  id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  acknowledged_at: string | null;
  last_log_at: string | null;
};

const CONTROLLED_PLAN = [
  '3 × Instant Porridge',
  '1 × Caramel Cappuccino',
  '1 × another mapped product',
  '1 × free, failed or cancelled scenario',
];

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function bytes(value: number | undefined) {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(count) / Math.log(1024)), units.length - 1);
  const scaled = count / (1024 ** index);
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

function yesNo(value: boolean | undefined) {
  return value ? 'Reconciled' : 'Not reconciled';
}

function sessionLabel(session: TestSession | null) {
  if (!session) return 'No session recorded';
  const status = session.status?.trim() || 'unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ');
}

export function MachineFieldAcceptancePanel({ machineId }: { machineId: string }) {
  const { businessProfile } = useAuth();
  const isClient = businessProfile?.user.account_scope === 'client';
  const [device, setDevice] = useState<Device | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [latestRecord, setLatestRecord] = useState<AcceptanceRecord | null>(null);
  const [latestSession, setLatestSession] = useState<TestSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    try {
      const { data: deviceData, error: deviceError } = await client
        .from('telemetry_devices')
        .select('id,device_code,profile_id,machine_link_status,last_transport,last_seen_at,last_heartbeat_at,last_config_at,last_config_ack_at')
        .eq('machine_id', machineId)
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (deviceError) throw deviceError;
      const nextDevice = (deviceData ?? null) as Device | null;
      setDevice(nextDevice);

      if (!nextDevice) {
        setReadiness(null);
        setLatestRecord(null);
        setLatestSession(null);
        return;
      }

      const [readinessResult, recordResult, sessionResult] = await Promise.all([
        client.rpc('get_telemetry_field_acceptance_readiness', { p_device_id: nextDevice.id }),
        client
          .from('telemetry_field_acceptance_records')
          .select('id,outcome,operator_notes,evidence_snapshot,recorded_at,test_session_id')
          .eq('device_id', nextDevice.id)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from('telemetry_test_sessions')
          .select('id,status,started_at,ended_at,acknowledged_at,last_log_at')
          .eq('device_id', nextDevice.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (readinessResult.error) throw readinessResult.error;
      if (recordResult.error) throw recordResult.error;
      if (sessionResult.error) throw sessionResult.error;

      setReadiness((readinessResult.data ?? null) as Readiness | null);
      setLatestRecord((recordResult.data ?? null) as AcceptanceRecord | null);
      setLatestSession((sessionResult.data ?? null) as TestSession | null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load field acceptance state.');
    } finally {
      setLoading(false);
    }
  }, [machineId]);

  useEffect(() => {
    void load();
    const timer = globalThis.setInterval(() => { void load(true); }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const evidence = latestRecord?.evidence_snapshot ?? null;
  const controlled = evidence?.controlled_plan_reconciliation;
  const reporting = evidence?.reporting_reconciliation;
  const usage = evidence?.data_usage_evidence;
  const blockers = readiness?.blockers ?? [];
  const preflightLabel = !device
    ? 'No telemetry device'
    : readiness?.ready_for_acceptance
      ? 'Ready for field test'
      : 'Setup required';

  return (
    <section className={styles.panel} aria-label="Machine field acceptance" data-machine-field-acceptance="v1">
      <header className={styles.header}>
        <div>
          <span>Field Acceptance</span>
          <h2>Controlled telemetry proof</h2>
          <p>Preflight, Test Center status and immutable acceptance evidence for this machine.</p>
        </div>
        <button disabled={loading} onClick={() => void load()} type="button">{loading ? 'Refreshing…' : 'Refresh acceptance'}</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.summaryGrid}>
        <article>
          <span>Current preflight</span>
          <strong className={readiness?.ready_for_acceptance ? styles.success : styles.warning}>{preflightLabel}</strong>
          <small>{device?.device_code ?? 'Assign an active telemetry device before acceptance.'}</small>
        </article>
        <article>
          <span>Latest acceptance</span>
          <strong className={latestRecord?.outcome === 'passed' ? styles.success : latestRecord?.outcome === 'failed' ? styles.danger : styles.neutral}>
            {latestRecord ? latestRecord.outcome.charAt(0).toUpperCase() + latestRecord.outcome.slice(1) : 'Not recorded'}
          </strong>
          <small>{latestRecord ? dateTime(latestRecord.recorded_at) : 'No immutable field-acceptance decision yet.'}</small>
        </article>
        <article>
          <span>Latest Test Center session</span>
          <strong>{sessionLabel(latestSession)}</strong>
          <small>{latestSession ? `Started ${dateTime(latestSession.started_at)}` : 'Start the timed run only when the hardware-safe field setup is ready.'}</small>
        </article>
        <article>
          <span>Trusted profile</span>
          <strong>{readiness?.trusted_profile_name ?? readiness?.trusted_profile_key ?? device?.profile_id ?? 'Not persisted'}</strong>
          <small>{readiness?.profile_ready ? 'Persisted decoder profile is ready.' : 'Profile review is still required.'}</small>
        </article>
      </div>

      <div className={styles.mainGrid}>
        <section className={styles.plan} aria-label="Controlled vend plan">
          <div className={styles.sectionHeading}>
            <span>Controlled vend plan</span>
            <strong>Run these six scenarios in one Test Center session</strong>
          </div>
          <ol>{CONTROLLED_PLAN.map((item) => <li key={item}>{item}</li>)}</ol>
          <p>A pass is never calculated in this panel. Test Center finalization uses server-derived session, vend, cup-counter, reporting and data evidence.</p>
        </section>

        <section className={styles.preflight} aria-label="Field acceptance preflight">
          <div className={styles.sectionHeading}>
            <span>Preflight detail</span>
            <strong>{readiness?.ready_for_acceptance ? 'Mapping and profile prerequisites satisfied' : 'Resolve blockers before the timed run'}</strong>
          </div>
          <div className={styles.checkGrid}>
            <div><span>Machine link</span><strong>{readiness?.machine_linked ? 'Ready' : 'Needs attention'}</strong></div>
            <div><span>Decoder profile</span><strong>{readiness?.profile_ready ? 'Ready' : 'Needs attention'}</strong></div>
            <div><span>Product mappings</span><strong>{readiness?.mapping_ready ? 'Ready' : 'Needs attention'}</strong></div>
          </div>
          {blockers.length ? <ul className={styles.blockers}>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className={styles.readyNote}>Preflight is ready. Physical acceptance still requires a real, hardware-safe vending-machine session.</p>}
        </section>
      </div>

      <section className={styles.evidence} aria-label="Latest immutable acceptance evidence">
        <div className={styles.sectionHeading}>
          <span>Latest immutable evidence</span>
          <strong>{latestRecord ? 'Server-derived acceptance snapshot' : 'No acceptance evidence recorded yet'}</strong>
        </div>
        <div className={styles.evidenceGrid}>
          <article><span>Controlled plan</span><strong>{latestRecord ? yesNo(controlled?.reconciled) : '—'}</strong><small>{controlled ? `${controlled.instant_porridge_units ?? 0} porridge · ${controlled.caramel_cappuccino_units ?? 0} caramel · ${controlled.other_mapped_units ?? 0} other` : 'Saved when Test Center finalizes the run.'}</small></article>
          <article><span>Reporting totals</span><strong>{latestRecord ? yesNo(reporting?.reconciled) : '—'}</strong><small>{reporting ? `Live ${reporting.live_success_units ?? 0} · daily Δ ${reporting.daily_delta_units ?? 0} · monthly Δ ${reporting.monthly_delta_units ?? 0}` : 'Live / daily / monthly reconciliation.'}</small></article>
          <article><span>Cellular data delta</span><strong>{latestRecord ? bytes(usage?.cellular_bytes_delta) : '—'}</strong><small>{usage ? `${yesNo(usage.reconciled)} · transport ${usage.last_transport ?? 'unknown'}` : 'Captured from the same acceptance session.'}</small></article>
        </div>
        {latestRecord?.operator_notes ? <p className={styles.notes}><strong>Operator notes:</strong> {latestRecord.operator_notes}</p> : null}
      </section>

      <footer className={styles.footer}>
        <div>
          <strong>{device?.device_code ?? 'No linked telemetry device'}</strong>
          <span>{isClient ? 'Client accounts have a read-only acceptance view.' : 'Pass/fail remains controlled by the existing Test Center audit workflow.'}</span>
        </div>
        <nav aria-label="Field acceptance actions">
          {!isClient && device?.device_code ? <Link className={styles.primaryAction} href={`/telemetry/test-center?device=${encodeURIComponent(device.device_code)}`}>Open field acceptance</Link> : null}
          {!isClient ? <Link href="/products">Product Mappings</Link> : null}
          {!isClient ? <Link href="/telemetry/devices">Device Management</Link> : null}
        </nav>
      </footer>
    </section>
  );
}
