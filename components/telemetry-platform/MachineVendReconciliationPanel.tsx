'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineVendReconciliationPanel.module.css';

type WindowDays = 7 | 30 | 90;

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
  reconciliation_status: string;
};

type ReconciliationSummary = {
  rows?: number;
  counter_units?: number;
  mdb_success_units?: number;
  dex_units?: number;
  matched_rows?: number;
  attention_rows?: number;
};

type ReconciliationPayload = {
  date_from?: string;
  date_to?: string;
  days?: number;
  summary?: ReconciliationSummary;
  rows?: ReconciliationRow[];
};

type DeviceRow = { id: string; device_code: string };

const attentionStatuses = new Set([
  'evidence_conflict',
  'mdb_evidence_ahead',
  'dex_evidence_ahead',
  'counter_ahead',
  'evidence_only',
]);

const statusLabels: Record<string, string> = {
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

function statusTone(status: string) {
  if (status === 'matched_mdb_counter' || status === 'matched_dex_counter') return styles.good;
  if (attentionStatuses.has(status)) return styles.bad;
  return styles.neutral;
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

  const rows = useMemo(() => {
    const source = [...(payload?.rows ?? [])];
    source.sort((a, b) => {
      const attentionDelta = Number(attentionStatuses.has(b.reconciliation_status)) - Number(attentionStatuses.has(a.reconciliation_status));
      if (attentionDelta) return attentionDelta;
      const dateDelta = b.sales_date.localeCompare(a.sales_date);
      if (dateDelta) return dateDelta;
      return a.selection_code.localeCompare(b.selection_code);
    });
    return source.slice(0, 250);
  }, [payload?.rows]);

  const summary = payload?.summary ?? {};
  const attentionRows = n(summary.attention_rows);
  const matchedRows = n(summary.matched_rows);

  return (
    <section className={styles.panel} data-machine-vend-reconciliation="v1">
      <header className={styles.header}>
        <div>
          <span>Telemetry evidence</span>
          <h2>Vend reconciliation</h2>
          <p>Production cup counters compared with independent MDB completion signals and DEX cumulative audit movement.</p>
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
          <article><span>Counter cups</span><strong>{n(summary.counter_units).toLocaleString('en-ZA')}</strong><small>Production accounting</small></article>
          <article><span>MDB confirmed</span><strong>{n(summary.mdb_success_units).toLocaleString('en-ZA')}</strong><small>Decoded terminal success</small></article>
          <article><span>DEX audit units</span><strong>{n(summary.dex_units).toLocaleString('en-ZA')}</strong><small>Cumulative counter deltas</small></article>
          <article className={attentionRows ? styles.metricAlert : styles.metricGood}><span>Needs attention</span><strong>{attentionRows.toLocaleString('en-ZA')}</strong><small>{matchedRows.toLocaleString('en-ZA')} matched rows</small></article>
        </section>

        <div className={styles.notice}>
          <strong>Accounting rule:</strong> counter snapshots remain authoritative. MDB and DEX are corroborating evidence and never add another sale by themselves.
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Date</th><th>Selection / product</th><th>Counter</th><th>MDB</th><th>DEX</th><th>Failed evidence</th><th>Confidence</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={`${row.sales_date}:${row.selection_code}`}>
                <td>{row.sales_date}</td>
                <td><strong>{row.product_name ?? row.selection_code}</strong><span>{row.product_name ? row.selection_code : ''}</span></td>
                <td>{n(row.counter_units).toLocaleString('en-ZA')}</td>
                <td>{n(row.mdb_success_units).toLocaleString('en-ZA')}</td>
                <td>{n(row.dex_units).toLocaleString('en-ZA')}</td>
                <td>{n(row.mdb_failure_units).toLocaleString('en-ZA')}</td>
                <td>{n(row.highest_confidence)}%</td>
                <td><b className={`${styles.status} ${statusTone(row.reconciliation_status)}`}>{statusLabels[row.reconciliation_status] ?? row.reconciliation_status}</b></td>
              </tr>
            ))}</tbody>
          </table>
          {!rows.length ? <div className={styles.empty}>No reconciliation rows are available for this device in the selected period.</div> : null}
        </div>

        <footer className={styles.footer}>
          <span>Device {device.device_code} · {payload.date_from ?? '—'} to {payload.date_to ?? '—'}</span>
          <span>Showing {rows.length.toLocaleString('en-ZA')} of {n(summary.rows).toLocaleString('en-ZA')} rows · Updated {updatedAt ? updatedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
        </footer>
      </> : null}
    </section>
  );
}
