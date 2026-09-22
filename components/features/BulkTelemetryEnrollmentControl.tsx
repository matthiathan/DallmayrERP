'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { formatLocalDate } from '@/lib/dates/local-date';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './BulkTelemetryEnrollmentControl.module.css';

type ParsedRow = { hardware_uid: string; label: string };
type IssuedRow = ParsedRow & { token: string; token_id: string; expires_at: string };

type BulkResponse = {
  accepted?: boolean;
  telemetry_region?: string;
  count?: number;
  tokens?: Array<{ token_id?: string; hardware_uid?: string; expires_at?: string }>;
};

function csvCells(line: string) {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current.trim()); current = '';
    } else current += char;
  }
  values.push(current.trim());
  return values;
}

function parseRows(source: string) {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: ParsedRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const cells = csvCells(lines[index]);
    if (index === 0 && /hardware[_ ]?uid/i.test(cells[0] ?? '')) continue;
    const uid = (cells[0] ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
    rows.push({ hardware_uid: uid, label: cells[1] ?? '' });
  }
  return rows;
}

function randomToken() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BulkTelemetryEnrollmentControl() {
  const [source, setSource] = useState('');
  const [minutes, setMinutes] = useState(1440);
  const [batchLabel, setBatchLabel] = useState('Fleet rollout');
  const [issued, setIssued] = useState<IssuedRow[]>([]);
  const [region, setRegion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => parseRows(source), [source]);
  const invalid = rows.filter((row) => !/^[0-9A-F]{12}$/.test(row.hardware_uid));
  const duplicateCount = rows.length - new Set(rows.map((row) => row.hardware_uid)).size;

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSource(await file.text());
    setIssued([]);
    setError(null);
  }

  async function issueBatch() {
    if (!rows.length) { setError('Paste or upload at least one hardware UID.'); return; }
    if (rows.length > 500) { setError('A batch can contain at most 500 telemetry devices.'); return; }
    if (invalid.length) { setError(`${invalid.length} row(s) do not contain a valid 12-character ESP32 hardware UID.`); return; }
    if (duplicateCount) { setError(`${duplicateCount} duplicate hardware UID row(s) must be removed.`); return; }

    setBusy(true); setError(null); setIssued([]);
    try {
      const local = await Promise.all(rows.map(async (row) => {
        const token = randomToken();
        return { ...row, token, token_hash: await sha256Hex(token) };
      }));
      const { data, error: requestError } = await getSupabaseClient().rpc('create_telemetry_enrollment_tokens_bulk', {
        p_rows: local.map(({ hardware_uid, label, token_hash }) => ({ hardware_uid, label: label || null, token_hash })),
        p_minutes: minutes,
        p_label: batchLabel.trim() || null,
      });
      if (requestError) throw requestError;
      const response = (data ?? {}) as BulkResponse;
      const byUid = new Map((response.tokens ?? []).map((row) => [row.hardware_uid ?? '', row]));
      const next = local.map(({ hardware_uid, label, token }) => {
        const server = byUid.get(hardware_uid);
        if (!server?.token_id || !server.expires_at) throw new Error(`Supabase did not return token metadata for ${hardware_uid}.`);
        return { hardware_uid, label, token, token_id: server.token_id, expires_at: server.expires_at };
      });
      setIssued(next);
      setRegion(response.telemetry_region ?? null);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : 'Bulk enrollment tokens could not be created.');
    } finally {
      setBusy(false);
    }
  }

  function exportIssued() {
    if (!issued.length) return;
    const header = 'hardware_uid,label,enrollment_token,enrollment_command,expires_at,telemetry_region';
    const body = issued.map((row) => [
      row.hardware_uid,
      csvEscape(row.label),
      row.token,
      csvEscape(`ENROLL TOKEN ${row.token}`),
      row.expires_at,
      region ?? '',
    ].join(',')).join('\n');
    downloadCsv(`dallmayr-telemetry-enrollment-${formatLocalDate()}.csv`, `${header}\n${body}\n`);
  }

  function downloadTemplate() {
    downloadCsv('dallmayr-telemetry-enrollment-template.csv', 'hardware_uid,label\nB81F3FDA1CD8,Controller 001\n');
  }

  return (
    <section className={styles.panel} data-bulk-telemetry-enrollment="v1">
      <header className={styles.header}>
        <div><span>Fleet rollout</span><h3>Bulk controller enrollment</h3><p>Issue exact-UID one-time enrollment credentials for commissioning batches. Plaintext secrets are generated in this browser and are not stored in Supabase.</p></div>
        <button onClick={downloadTemplate} type="button">Download CSV template</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {issued.length ? <div className={styles.success} role="status"><strong>{issued.length} enrollment tokens issued{region ? ` for ${region.replaceAll('_', ' ')}` : ''}.</strong><span>Export the CSV now. Refreshing or closing this page discards the plaintext tokens.</span></div> : null}

      <div className={styles.grid}>
        <label className={styles.source}><span>Hardware UIDs</span><textarea rows={8} value={source} onChange={(event) => { setSource(event.target.value); setIssued([]); }} placeholder={'hardware_uid,label\nB81F3FDA1CD8,Controller 001'} /><small>{rows.length} row(s) · max 500</small></label>
        <div className={styles.options}>
          <label><span>Upload CSV</span><input accept=".csv,text/csv" onChange={(event) => void loadFile(event)} type="file" /></label>
          <label><span>Batch label</span><input value={batchLabel} onChange={(event) => setBatchLabel(event.target.value)} /></label>
          <label><span>Token validity</span><select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}><option value={60}>1 hour</option><option value={1440}>24 hours</option><option value={4320}>3 days</option><option value={10080}>7 days</option></select></label>
          <div className={styles.actions}><button disabled={busy || !rows.length || Boolean(invalid.length || duplicateCount)} onClick={() => void issueBatch()} type="button">{busy ? 'Issuing…' : `Issue ${rows.length || ''} token${rows.length === 1 ? '' : 's'}`}</button>{issued.length ? <button onClick={exportIssued} type="button">Export commissioning CSV</button> : null}</div>
          <small>Bulk issuance is restricted by the database to Administrator and Operations accounts in the selected telemetry region.</small>
        </div>
      </div>
    </section>
  );
}
