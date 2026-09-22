'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryFieldAcceptanceRecord.module.css';

type Device = {
  id: string;
  device_code: string;
};

type TestSession = {
  id: string;
  status: 'active' | 'stopped' | 'expired';
  started_at: string;
  ended_at: string | null;
  expires_at: string;
};

type AcceptanceRecord = {
  id: string;
  telemetry_region: string;
  test_session_id: string;
  device_id: string;
  machine_id: string | null;
  outcome: 'passed' | 'failed';
  operator_notes: string | null;
  expected_plan: {
    name?: string;
    steps?: Array<{ label?: string; quantity?: number; expected?: string }>;
  } | null;
  evidence_snapshot: {
    pass_ready?: boolean;
    checks?: Record<string, boolean>;
    device?: Record<string, unknown>;
    session?: Record<string, unknown>;
    vend_evidence?: { row_count?: number; units?: number };
    cup_counter_evidence?: { row_count?: number; units?: number };
  } | null;
  recorded_at: string;
};

const RECORD_COLUMNS = 'id,telemetry_region,test_session_id,device_id,machine_id,outcome,operator_notes,expected_plan,evidence_snapshot,recorded_at';
const SESSION_COLUMNS = 'id,status,started_at,ended_at,expires_at';

const CONTROLLED_PLAN = [
  { label: 'Instant Porridge', quantity: 3, expected: 'Successful or free vend counter increments by three.' },
  { label: 'Caramel Cappuccino', quantity: 1, expected: 'Successful or free vend counter increments by one.' },
  { label: 'Known mapped product', quantity: 1, expected: 'Selection resolves to the expected mapped product and increments once.' },
  { label: 'Free, failed or cancelled scenario', quantity: 1, expected: 'Outcome is captured without corrupting successful cup totals.' },
];

const CHECK_LABELS: Record<string, string> = {
  device_contact: 'Device contact',
  cellular_transport: 'Cellular transport',
  test_session_acknowledged: 'Test session acknowledged',
  logs_streaming: 'Logs captured',
  machine_interface_identified: 'Machine interface identified',
  decoder_profile_applied: 'Decoder profile applied',
  product_selection_evidence: 'Product selection evidence',
  vend_evidence: 'Vend evidence',
  cup_counter_evidence: 'Cup counter evidence',
};

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function TelemetryFieldAcceptanceRecord() {
  const client = useMemo(() => getSupabaseClient(), []);
  const [deviceCode, setDeviceCode] = useState('');
  const [device, setDevice] = useState<Device | null>(null);
  const [session, setSession] = useState<TestSession | null>(null);
  const [records, setRecords] = useState<AcceptanceRecord[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<'passed' | 'failed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (requestedCode: string) => {
    const requested = requestedCode.trim();
    if (!requested) {
      setDevice(null);
      setSession(null);
      setRecords([]);
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

    const candidate = ((deviceRows ?? []) as Device[]).find(
      (row) => row.device_code.toLocaleLowerCase('en-ZA') === requested.toLocaleLowerCase('en-ZA'),
    ) ?? null;
    setDevice(candidate);

    if (!candidate) {
      setSession(null);
      setRecords([]);
      setLoading(false);
      return;
    }

    const [sessionQuery, recordsQuery] = await Promise.all([
      client
        .from('telemetry_test_sessions')
        .select(SESSION_COLUMNS)
        .eq('device_id', candidate.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from('telemetry_field_acceptance_records')
        .select(RECORD_COLUMNS)
        .eq('device_id', candidate.id)
        .order('recorded_at', { ascending: false })
        .limit(10),
    ]);

    if (sessionQuery.error) setError(sessionQuery.error.message);
    else setSession((sessionQuery.data ?? null) as TestSession | null);

    if (recordsQuery.error) setError(recordsQuery.error.message);
    else setRecords((recordsQuery.data ?? []) as AcceptanceRecord[]);

    setLoading(false);
  }, [client]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('device')?.trim() ?? '';
    setDeviceCode(requested);
    void load(requested);
  }, [load]);

  const latestRecord = records[0] ?? null;
  const currentSessionRecord = session ? records.find((record) => record.test_session_id === session.id) ?? null : null;
  const checks = Object.entries(latestRecord?.evidence_snapshot?.checks ?? {});
  const sessionCanFinalize = Boolean(session && session.status !== 'active' && !currentSessionRecord);

  async function finalize(outcome: 'passed' | 'failed') {
    if (!session || !sessionCanFinalize) return;
    setSaving(outcome);
    setError(null);
    setMessage(null);

    const { data, error: finalizeError } = await client.rpc('finalize_telemetry_field_acceptance', {
      p_session_id: session.id,
      p_outcome: outcome,
      p_notes: notes.trim() || null,
    });

    if (finalizeError) {
      setError(finalizeError.message);
      setSaving(null);
      return;
    }

    const created = data as AcceptanceRecord | null;
    setMessage(created?.outcome === 'passed'
      ? 'Passed acceptance record saved with a server-derived Evidence snapshot.'
      : 'Failed acceptance record saved with a server-derived Evidence snapshot.');
    setNotes('');
    await load(deviceCode);
    setSaving(null);
  }

  if (!deviceCode) {
    return (
      <section className={styles.panel} aria-label="Field acceptance record">
        <div className={styles.heading}><span>Commissioning record</span><strong>Choose a telemetry device first</strong></div>
        <p>Open Test Center from Device Management so the controller is carried into this commissioning workflow.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Field acceptance record">
      <div className={styles.heading}>
        <div>
          <span>Commissioning record</span>
          <strong>{device?.device_code ?? deviceCode}</strong>
          <small>Durable audit record · one decision per completed Test Center session</small>
        </div>
        {latestRecord ? <span className={`${styles.outcome} ${latestRecord.outcome === 'passed' ? styles.passed : styles.failed}`}>{latestRecord.outcome === 'passed' ? 'Passed' : 'Failed'}</span> : <span className={styles.outcome}>Not recorded</span>}
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {loading && !device ? <p>Loading commissioning evidence…</p> : null}
      {!loading && !device ? <p>No telemetry device exactly matching <code>{deviceCode}</code> exists in the selected telemetry region.</p> : null}

      <div className={styles.layout}>
        <section className={styles.plan}>
          <div className={styles.sectionTitle}><span>Controlled test plan</span><strong>Vend sequence</strong></div>
          <ol>
            {CONTROLLED_PLAN.map((step) => (
              <li key={step.label}>
                <strong>{step.quantity} × {step.label}</strong>
                <small>{step.expected}</small>
              </li>
            ))}
          </ol>
          <p>Complete the sequence while Test Center is streaming. The final scenario must be a free, failed or cancelled outcome so successful cup totals can be checked for contamination.</p>
        </section>

        <section className={styles.finalize}>
          <div className={styles.sectionTitle}><span>Latest Test Center session</span><strong>{session ? formatDate(session.started_at) : 'No session'}</strong></div>
          {session ? (
            <>
              <dl className={styles.sessionMeta}>
                <div><dt>Status</dt><dd>{session.status}</dd></div>
                <div><dt>Session ID</dt><dd><code>{session.id}</code></dd></div>
                <div><dt>Ended</dt><dd>{formatDate(session.ended_at)}</dd></div>
              </dl>

              {currentSessionRecord ? (
                <div className={styles.locked}>
                  <strong>This session already has an immutable {currentSessionRecord.outcome} decision.</strong>
                  <span>Start a new Test Center session for another acceptance attempt.</span>
                </div>
              ) : session.status === 'active' ? (
                <div className={styles.locked}>
                  <strong>Stop the Test Center session before finalizing.</strong>
                  <span>This prevents the Evidence snapshot changing after the commissioning decision.</span>
                </div>
              ) : (
                <>
                  <label className={styles.notes}>
                    <span>Operator notes</span>
                    <textarea rows={4} placeholder="Record anything relevant to the physical test, product sequence, free-vend case or discrepancy." value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </label>
                  <div className={styles.actions}>
                    <button disabled={Boolean(saving)} onClick={() => void finalize('passed')} type="button">{saving === 'passed' ? 'Recording…' : 'Passed'}</button>
                    <button disabled={Boolean(saving)} onClick={() => void finalize('failed')} type="button">{saving === 'failed' ? 'Recording…' : 'Failed'}</button>
                  </div>
                  <small className={styles.rule}>A Passed result is rejected server-side until all nine authoritative field-evidence checks are satisfied. Failed may be recorded with incomplete evidence for audit and retest.</small>
                </>
              )}
            </>
          ) : <p>Start and complete a Test Center session before recording field acceptance.</p>}
        </section>
      </div>

      {latestRecord ? (
        <section className={styles.snapshot}>
          <div className={styles.sectionTitle}>
            <span>Evidence snapshot</span>
            <strong>{latestRecord.outcome === 'passed' ? 'Passed' : 'Failed'} · {formatDate(latestRecord.recorded_at)}</strong>
          </div>
          <div className={styles.checks}>
            {checks.map(([key, value]) => (
              <div className={value ? styles.checkPassed : styles.checkFailed} key={key}>
                <span>{value ? '✓' : '·'}</span>
                <strong>{CHECK_LABELS[key] ?? key.replaceAll('_', ' ')}</strong>
              </div>
            ))}
          </div>
          <div className={styles.evidenceTotals}>
            <div><span>Vend evidence</span><strong>{Number(latestRecord.evidence_snapshot?.vend_evidence?.row_count ?? 0).toLocaleString('en-ZA')} rows</strong><small>{Number(latestRecord.evidence_snapshot?.vend_evidence?.units ?? 0).toLocaleString('en-ZA')} units</small></div>
            <div><span>Cup counter evidence</span><strong>{Number(latestRecord.evidence_snapshot?.cup_counter_evidence?.row_count ?? 0).toLocaleString('en-ZA')} rows</strong><small>{Number(latestRecord.evidence_snapshot?.cup_counter_evidence?.units ?? 0).toLocaleString('en-ZA')} units</small></div>
            <div><span>Pass-ready snapshot</span><strong>{latestRecord.evidence_snapshot?.pass_ready ? 'Yes' : 'No'}</strong><small>{latestRecord.telemetry_region.replaceAll('_', ' ')}</small></div>
          </div>
          {latestRecord.operator_notes ? <p className={styles.recordNotes}><strong>Operator notes:</strong> {latestRecord.operator_notes}</p> : null}
        </section>
      ) : null}

      {records.length ? (
        <section className={styles.history}>
          <div className={styles.sectionTitle}><span>Acceptance history</span><strong>{records.length} recent record{records.length === 1 ? '' : 's'}</strong></div>
          <div className={styles.historyRows}>
            {records.map((record) => (
              <article key={record.id}>
                <span className={`${styles.historyOutcome} ${record.outcome === 'passed' ? styles.passed : styles.failed}`}>{record.outcome === 'passed' ? 'Passed' : 'Failed'}</span>
                <div><strong>{formatDate(record.recorded_at)}</strong><small>Session {record.test_session_id}</small></div>
                <span>{record.evidence_snapshot?.pass_ready ? 'Evidence complete' : 'Evidence incomplete'}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
