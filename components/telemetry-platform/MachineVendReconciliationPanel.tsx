'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineVendReconciliationPanel.module.css';

type WindowDays = 7 | 30 | 90;
type ReconciliationStatus =
  | 'matched_mdb_counter'
  | 'matched_dex_counter'
  | 'evidence_conflict'
  | 'mdb_evidence_ahead'
  | 'dex_evidence_ahead'
  | 'counter_ahead'
  | 'counter_only'
  | 'evidence_only'
  | 'no_confirmed_sale';

type ReconciliationRow = {
  sales_date: string;
  device_id: string;
  machine_id: string | null;
  selection_code: string;
  product_name: string | null;
  counter_units: number;
  counter_failed_units: number;
  mdb_success_units: number;
  mdb_failure_units: number;
  dex_units: number;
  machine_success_units: number;
  highest_confidence: number;
  reconciliation_status: ReconciliationStatus;
};

type ReconciliationPayload = {
  date_from?: string;
  date_to?: string;
  days?: number;
  rows?: ReconciliationRow[];
};

type DeviceRow = { id: string; device_code: string };
type LocalSummary = {
  rows: number;
  counterUnits: number;
  mdbUnits: number;
  dexUnits: number;
  machineUnits: number;
  matchedRows: number;
  attentionRows: number;
  counterOnlyRows: number;
  evidenceOnlyRows: number;
};

const attentionStatuses = new Set<ReconciliationStatus>([
  'evidence_conflict',
  'mdb_evidence_ahead',
  'dex_evidence_ahead',
  'counter_ahead',
  'evidence_only',
]);

const statusLabels: Record<ReconciliationStatus, string> = {
  matched_mdb_counter: 'MDB matched',
  matched_dex_counter: 'DEX matched',
  evidence_conflict: 'Evidence conflict',
  mdb_evidence_ahead: 'MDB ahead',
  dex_evidence_ahead: 'DEX ahead',
  counter_ahead: 'Counter ahead',
  counter_only: 'Counter only',
  evidence_only: 'Evidence only',
  no_confirmed_sale: 'No confirmed sale',
};

function n(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTone(status: ReconciliationStatus) {
  if (status === 'matched_mdb_counter' || status === 'matched_dex_counter') return styles.good;
  if (attentionStatuses.has(status)) return styles.bad;
  return styles.neutral;
}

function summarize(rows: ReconciliationRow[]): LocalSummary {
  return rows.reduce<LocalSummary>((summary, row) => {
    summary.rows += 1;
    summary.counterUnits += n(row.counter_units);
    summary.mdbUnits += n(row.mdb_success_units);
    summary.dexUnits += n(row.dex_units);
    summary.machineUnits += n(row.machine_success_units);
    if (row.reconciliation_status === 'matched_mdb_counter' || row.reconciliation_status === 'matched_dex_counter') summary.matchedRows += 1;
    if (attentionStatuses.has(row.reconciliation_status)) summary.attentionRows += 1;
    if (row.reconciliation_status === 'counter_only') summary.counterOnlyRows += 1;
    if (row.reconciliation_status === 'evidence_only') summary.evidenceOnlyRows += 1;
    return summary;
  }, { rows: 0, counterUnits: 0, mdbUnits: 0, dexUnits: 0, machineUnits: 0, matchedRows: 0, attentionRows: 0, counterOnlyRows: 0, evidenceOnlyRows: 0 });
}

function evidenceState(summary: LocalSummary) {
  if (!summary.rows) return { label: 'No machine evidence', detail: 'No dated counter/evidence rows for this machine.', className: styles.neutral };
  if (summary.attentionRows) return { label: 'Needs review', detail: `${summary.attentionRows} disagreement${summary.attentionRows === 1 ? '' : 's'} detected.`, className: styles.bad };
  if (summary.matchedRows === summary.rows) return { label: 'Reconciled', detail: 'All dated rows independently match.', className: styles.good };
  if (summary.counterOnlyRows === summary.rows) return { label: 'Counter coverage only', detail: 'No independent MDB/DEX evidence yet.', className: styles.neutral };
  return { label: 'Partial evidence', detail: `${summary.matchedRows} of ${summary.rows} rows independently match.`, className: styles.neutral };
}

export function MachineVendReconciliationPanel({ machineId }: { machineId: string }) {
  const [days, setDays] = useState<WindowDays>(30);
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [payload, setPayload] = useState<ReconciliationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    const deviceResult = await client
      .from('telemetry_devices')
      .select('id,device_code')
      .eq('machine_id', machineId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (deviceResult.error) {
      setError(deviceResult.error.message ?? 'Could not resolve the machine telemetry device.');
      setLoading(false);
      return;
    }

    const activeDevice = deviceResult.data as DeviceRow | null;
    setDevice(activeDevice);
    if (!activeDevice) {
      setPayload(null);
      setUpdatedAt(new Date());
      setLoading(false);
      return;
    }

    const result = await client.rpc('get_telemetry_vend_reconciliation', {
      p_days: days,
      p_device_id: activeDevice.id,
    });

    if (result.error) {
      setError(result.error.message ?? 'Could not load vend reconciliation.');
      setLoading(false);
      return;
    }

    setPayload((result.data ?? {}) as ReconciliationPayload);
    setUpdatedAt(new Date());
    setLoading(false);
  }, [days, machineId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = globalThis.setInterval(() => { void load(); }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const machineRows = useMemo(() => (payload?.rows ?? [])
    .filter((row) => row.machine_id === machineId)
    .map((row) => ({
      ...row,
      counter_units: n(row.counter_units),
      counter_failed_units: n(row.counter_failed_units),
      mdb_success_units: n(row.mdb_success_units),
      mdb_failure_units: n(row.mdb_failure_units),
      dex_units: n(row.dex_units),
      machine_success_units: n(row.machine_success_units),
      highest_confidence: n(row.highest_confidence),
    })), [machineId, payload?.rows]);

  const rows = useMemo(() => {
    const source = [...machineRows];
    source.sort((a, b) => {
      const attentionDelta = Number(attentionStatuses.has(b.reconciliation_status)) - Number(attentionStatuses.has(a.reconciliation_status));
      if (attentionDelta) return attentionDelta;
      const dateDelta = b.sales_date.localeCompare(a.sales_date);
      if (dateDelta) return dateDelta;
      return a.selection_code.localeCompare(b.selection_code);
    });
    return source.slice(0, 250);
  }, [machineRows]);

  const summary = useMemo(() => summarize(machineRows), [machineRows]);
  const state = evidenceState(summary);

  return (
    <section className={styles.panel} data-machine-vend-reconciliation="v2">
      <header className={styles.header}>
        <div>
          <span>Telemetry evidence</span>
          <h2>Vend reconciliation</h2>
          <p>Production cup counters compared with independent MDB completion signals and DEX cumulative audit movement for this machine only.</p>
        </div>
        <div className={styles.actions}>
          <select aria-label="Reconciliation window" value={days} onChange={(event) => setDays(Number(event.target.value) as WindowDays)}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button disabled={loading} onClick={() => void load()} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {!device ? <div className={styles.empty}>No active telemetry device is assigned to this machine, so reconciliation is not available.</div> : null}
      {error ? <div className={styles.error} role="alert"><strong>Reconciliation unavailable.</strong><span>{error}</span></div> : null}

      {device && payload ? <>
        <section className={styles.metrics} aria-label="Vend reconciliation summary">
          <article><span>Counter cups</span><strong>{summary.counterUnits.toLocaleString('en-ZA')}</strong><small>Production accounting</small></article>
          <article><span>MDB / DEX evidence</span><strong>{Math.max(summary.mdbUnits, summary.dexUnits, summary.machineUnits).toLocaleString('en-ZA')}</strong><small>Independent confirmations</small></article>
          <article><span>Matched rows</span><strong>{summary.matchedRows.toLocaleString('en-ZA')}</strong><small>{summary.rows.toLocaleString('en-ZA')} machine rows</small></article>
          <article className={summary.attentionRows ? styles.metricAlert : styles.metricGood}><span>Evidence state</span><strong className={state.className}>{state.label}</strong><small>{state.detail}</small></article>
        </section>

        <div className={styles.notice}>
          <strong>Accounting rule:</strong> counter snapshots remain authoritative. MDB, DEX and machine-complete evidence corroborate counters and never add another sale by themselves. Historical rows from previous machine assignments are excluded.
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Date</th><th>Selection / product</th><th>Counter</th><th>MDB</th><th>DEX</th><th>Failed evidence</th><th>Confidence</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.sales_date}:${row.selection_code}`}>
                <td>{row.sales_date}</td>
                <td><strong>{row.product_name ?? row.selection_code}</strong><span>{row.product_name ? row.selection_code : ''}</span></td>
                <td>{row.counter_units.toLocaleString('en-ZA')}</td>
                <td>{row.mdb_success_units.toLocaleString('en-ZA')}</td>
                <td>{row.dex_units.toLocaleString('en-ZA')}</td>
                <td>{row.mdb_failure_units.toLocaleString('en-ZA')}</td>
                <td>{row.highest_confidence}%</td>
                <td><b className={`${styles.status} ${statusTone(row.reconciliation_status)}`}>{statusLabels[row.reconciliation_status]}</b></td>
              </tr>
            ))}</tbody>
          </table>
          {!rows.length ? <div className={styles.empty}>No reconciliation rows belong to the current machine in this period. This can be normal when the controller was previously assigned elsewhere or has not uploaded counters yet.</div> : null}
        </div>

        <footer className={styles.footer}>
          <span>Device {device.device_code} · {payload.date_from ?? '—'} to {payload.date_to ?? '—'}</span>
          <span>Showing {rows.length.toLocaleString('en-ZA')} machine rows · Updated {updatedAt ? updatedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
        </footer>
      </> : null}
    </section>
  );
}
