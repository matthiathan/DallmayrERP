'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './TelemetryCommissioningRecord.module.css';

type DeviceRow = {
  id: string;
  device_code: string;
  machine_id: string | null;
};

type SessionRow = {
  id: string;
  status: 'active' | 'stopped' | 'expired';
  started_at: string;
  acknowledged_at: string | null;
  last_log_at: string | null;
};

type PlanItem = {
  label?: string;
  expected_success_units?: number;
  expected_observation?: boolean;
  kind?: string;
};

type CounterDelta = {
  selection_code?: string;
  baseline_epoch?: string | null;
  final_epoch?: string | null;
  baseline_sold?: number;
  final_sold?: number;
  sold_delta?: number | null;
  failed_delta?: number | null;
  revenue_delta_cents?: number | null;
  epoch_changed?: boolean;
};

type CommissioningRun = {
  id: string;
  telemetry_region: string;
  device_id: string;
  machine_id: string;
  test_session_id: string | null;
  status: 'in_progress' | 'passed' | 'failed' | 'aborted';
  expected_plan: PlanItem[];
  start_snapshot: Record<string, unknown>;
  baseline_counter_snapshot: Record<string, unknown>[];
  final_counter_snapshot: Record<string, unknown>[] | null;
  counter_delta_snapshot: CounterDelta[] | null;
  automated_checks: Record<string, unknown>;
  result_summary: Record<string, unknown>;
  operator_notes: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const RUN_SELECT = 'id,telemetry_region,device_id,machine_id,test_session_id,status,expected_plan,start_snapshot,baseline_counter_snapshot,final_counter_snapshot,counter_delta_snapshot,automated_checks,result_summary,operator_notes,started_at,completed_at,created_at,updated_at';

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function checkLabel(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function downloadJson(run: CommissioningRun, deviceCode: string) {
  const payload = {
    schema: 'dallmayr-telemetry-commissioning-v1',
    exported_at: new Date().toISOString(),
    device_code: deviceCode,
    commissioning_run: run,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dallmayr-commissioning-${deviceCode}-${run.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TelemetryCommissioningRecord() {
  const client = useMemo(() => getSupabaseClient(), []);
  const [deviceCode, setDeviceCode] = useState('');
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [runs, setRuns] = useState<CommissioningRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (requestedDeviceCode: string, quiet = false) => {
    const requested = requestedDeviceCode.trim();
    if (!requested) {
      setDevice(null); setSession(null); setRuns([]); setSelectedRunId(null);
      return;
    }
    if (!quiet) setLoading(true);
    setError(null);

    const { data: deviceRows, error: deviceError } = await client.rpc('search_telemetry_test_devices', { p_search: requested, p_limit: 25 });
    if (deviceError) {
      setError(deviceError.message); setLoading(false); return;
    }
    const exact = ((deviceRows ?? []) as DeviceRow[]).find((row) => row.device_code.toLocaleLowerCase('en-ZA') === requested.toLocaleLowerCase('en-ZA')) ?? null;
    setDevice(exact);
    if (!exact) {
      setSession(null); setRuns([]); setSelectedRunId(null); setLoading(false); return;
    }

    const [sessionResult, runsResult] = await Promise.all([
      client.from('telemetry_test_sessions').select('id,status,started_at,acknowledged_at,last_log_at').eq('device_id', exact.id).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      client.from('telemetry_commissioning_runs').select(RUN_SELECT).eq('device_id', exact.id).order('started_at', { ascending: false }).limit(20),
    ]);

    if (sessionResult.error) setError(sessionResult.error.message);
    setSession((sessionResult.data ?? null) as SessionRow | null);
    if (runsResult.error) {
      setError(runsResult.error.message);
      setRuns([]);
    } else {
      const nextRuns = (runsResult.data ?? []) as CommissioningRun[];
      setRuns(nextRuns);
      setSelectedRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id ?? null);
    }
    setLoading(false);
  }, [client]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('device')?.trim() ?? '';
    setDeviceCode(requested);
    void load(requested);
    const timer = window.setInterval(() => void load(requested, true), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const activeRun = runs.find((run) => run.status === 'in_progress') ?? null;
  const booleanChecks = selectedRun ? Object.entries(selectedRun.automated_checks ?? {}).filter(([, value]) => typeof value === 'boolean') as Array<[string, boolean]> : [];
  const passedChecks = booleanChecks.filter(([, value]) => value).length;
  const deltas = selectedRun?.counter_delta_snapshot ?? [];

  async function startRun() {
    if (!device || !session) return;
    setWorking(true); setError(null); setMessage(null);
    const { data, error: startError } = await client.rpc('start_telemetry_commissioning_run', {
      p_device_id: device.id,
      p_test_session_id: session.id,
      p_expected_plan: null,
    });
    if (startError) setError(startError.message);
    else {
      const result = (data ?? {}) as { run_id?: string };
      setMessage('Commissioning run started. Baseline counters and device state were captured server-side.');
      await load(device.device_code, true);
      if (result.run_id) setSelectedRunId(result.run_id);
    }
    setWorking(false);
  }

  async function finalize(result: 'passed' | 'failed' | 'aborted') {
    if (!activeRun || !device) return;
    setWorking(true); setError(null); setMessage(null);
    const { data, error: finalizeError } = await client.rpc('finalize_telemetry_commissioning_run', {
      p_run_id: activeRun.id,
      p_result: result,
      p_notes: notes.trim() || null,
    });
    if (finalizeError) setError(finalizeError.message);
    else {
      const response = (data ?? {}) as { run_id?: string };
      setMessage(`Commissioning run marked ${result}. Final counters, deltas and automated checks were captured.`);
      setNotes('');
      await load(device.device_code, true);
      if (response.run_id) setSelectedRunId(response.run_id);
    }
    setWorking(false);
  }

  if (!deviceCode) return null;

  return (
    <section className={styles.panel} aria-label="Commissioning record" data-telemetry-commissioning="v1">
      <header className={styles.header}>
        <div><span>Commissioning record</span><h2>Installation evidence & sign-off</h2><p>Creates a durable audit trail tied to this controller, its current machine assignment and one Test Center session.</p></div>
        <strong>{runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'}` : 'No runs'}</strong>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {message ? <div className={styles.success} role="status">{message}</div> : null}
      {loading && !device ? <p className={styles.empty}>Loading commissioning state…</p> : null}
      {!loading && !device ? <p className={styles.empty}>No telemetry device exactly matching <code>{deviceCode}</code> is available in the selected region.</p> : null}

      {device ? <>
        <section className={styles.controlRow}>
          <div><span>Device</span><strong>{device.device_code}</strong><small>{device.machine_id ? 'Machine linked' : 'Machine assignment required'}</small></div>
          <div><span>Latest Test Center session</span><strong>{session ? session.status : 'None'}</strong><small>{session ? `Started ${dateTime(session.started_at)}${session.acknowledged_at ? ' · acknowledged' : ''}` : 'Start a Test Center session first'}</small></div>
          <button disabled={working || Boolean(activeRun) || !device.machine_id || !session} onClick={() => void startRun()} type="button">{activeRun ? 'Commissioning in progress' : working ? 'Starting…' : 'Start commissioning run'}</button>
        </section>

        {activeRun ? <section className={styles.signoff}>
          <div><span>Active run</span><strong>{activeRun.id}</strong><small>Started {dateTime(activeRun.started_at)} · baseline captured</small></div>
          <label><span>Operator notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observed products, free-vend/failed scenario, physical checks or exception notes" /></label>
          <div className={styles.signoffActions}>
            <button disabled={working} onClick={() => void finalize('passed')} type="button">Complete · Passed</button>
            <button disabled={working} onClick={() => void finalize('failed')} type="button">Complete · Failed</button>
            <button disabled={working} onClick={() => void finalize('aborted')} type="button">Abort run</button>
          </div>
          <small className={styles.warning}>Passing is an operator sign-off. The completed record separately preserves server-derived automated checks and counter deltas so the decision remains auditable.</small>
        </section> : null}

        {runs.length ? <div className={styles.runLayout}>
          <aside className={styles.runList}>{runs.map((run) => <button className={selectedRunId === run.id ? styles.selectedRun : undefined} key={run.id} onClick={() => setSelectedRunId(run.id)} type="button"><strong>{run.status}</strong><span>{dateTime(run.started_at)}</span><small>{run.id}</small></button>)}</aside>
          {selectedRun ? <section className={styles.detail}>
            <header className={styles.detailHeader}><div><span>Selected run</span><h3>{selectedRun.status}</h3><p>{dateTime(selectedRun.started_at)} → {dateTime(selectedRun.completed_at)}</p></div><button onClick={() => downloadJson(selectedRun, device.device_code)} type="button">Export audit JSON</button></header>

            <section className={styles.plan}><h4>Controlled test plan</h4>{(selectedRun.expected_plan ?? []).map((item, index) => <div key={`${item.label ?? 'item'}-${index}`}><strong>{item.label ?? `Step ${index + 1}`}</strong><span>{item.expected_success_units != null ? `${item.expected_success_units} expected successful vend${item.expected_success_units === 1 ? '' : 's'}` : 'Observation required'}</span></div>)}</section>

            <section className={styles.checks}><div className={styles.sectionTitle}><h4>Automated checks</h4><span>{booleanChecks.length ? `${passedChecks}/${booleanChecks.length} passed` : 'Captured at completion'}</span></div>{booleanChecks.length ? booleanChecks.map(([key, value]) => <div className={value ? styles.checkPassed : styles.checkWaiting} key={key}><b>{value ? '✓' : '·'}</b><span>{checkLabel(key)}</span></div>) : <p>No final automated check snapshot yet.</p>}</section>

            <section className={styles.deltas}><div className={styles.sectionTitle}><h4>Counter deltas</h4><span>{deltas.length} selections</span></div>{deltas.length ? <div className={styles.tableWrap}><table><thead><tr><th>Selection</th><th>Sold delta</th><th>Failed delta</th><th>Revenue delta</th><th>Epoch</th></tr></thead><tbody>{deltas.map((delta, index) => <tr key={`${delta.selection_code ?? 'selection'}-${index}`}><td>{delta.selection_code ?? '—'}</td><td>{delta.sold_delta == null ? '—' : Number(delta.sold_delta).toLocaleString('en-ZA')}</td><td>{delta.failed_delta == null ? '—' : Number(delta.failed_delta).toLocaleString('en-ZA')}</td><td>{delta.revenue_delta_cents == null ? '—' : `R ${(Number(delta.revenue_delta_cents) / 100).toFixed(2)}`}</td><td>{delta.epoch_changed ? 'Changed' : 'Stable'}</td></tr>)}</tbody></table></div> : <p>Final counter deltas are captured when the run is completed.</p>}</section>

            {selectedRun.operator_notes ? <div className={styles.notes}><strong>Operator notes</strong><p>{selectedRun.operator_notes}</p></div> : null}
          </section> : null}
        </div> : <p className={styles.empty}>No commissioning runs have been recorded for this device yet.</p>}
      </> : null}
    </section>
  );
}
