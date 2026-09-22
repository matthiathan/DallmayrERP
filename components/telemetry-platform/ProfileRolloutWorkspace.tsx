'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './ProfileRolloutWorkspace.module.css';

type ProfileQueueFilter = 'profile_attention' | 'profile_configured' | 'profile_pending' | 'profile_ambiguous' | 'profile_unmatched';
type ProfileStatus = 'configured' | 'pending' | 'ambiguous' | 'unmatched' | 'unlinked';
type ConnectionStatus = 'online' | 'delayed' | 'offline' | 'never' | 'unlinked';

type FleetSummary = {
  linked_devices: number;
  profile_configured: number;
  profile_pending: number;
  profile_ambiguous: number;
  profile_unmatched: number;
  profile_manual: number;
  profile_automatic: number;
  profile_resolved: number;
  profile_unresolved: number;
  profile_attention: number;
};

type RolloutRow = {
  id: string;
  branch: string | null;
  serial_number: string | null;
  asset_tag: string | null;
  machine_name: string | null;
  model: string | null;
  manufacturer: string | null;
  site_name: string;
  location: string;
  device_id: string | null;
  device_code: string | null;
  profile_assignment_method: 'automatic' | 'manual' | null;
  reported_machine_interface: string | null;
  reported_machine_model: string | null;
  reported_machine_profile_fingerprint: string | null;
  reported_machine_revision: string | null;
  reported_machine_identity_source: string | null;
  reported_machine_identity_at: string | null;
  effective_profile_key: string | null;
  applied_profile_key: string | null;
  profile_resolution: string | null;
  profile_confidence: string | null;
  profile_display_name: string | null;
  profile_status: ProfileStatus;
  connection_status: ConnectionStatus;
  last_contact: string | null;
};

type FleetResponse = {
  telemetry_region: string;
  rows: RolloutRow[];
  total: number;
  fleet_total: number;
  summary: FleetSummary;
  branches: string[];
  limit: number;
  offset: number;
  generated_at: string;
};

const PAGE_SIZE = 75;

function machineTitle(row: RolloutRow) {
  return row.machine_name ?? row.model ?? row.serial_number ?? row.asset_tag ?? 'Unnamed machine';
}

function statusLabel(status: ProfileStatus) {
  if (status === 'configured') return 'Configured';
  if (status === 'pending') return 'Pending ACK';
  if (status === 'ambiguous') return 'Ambiguous';
  if (status === 'unmatched') return 'Unmatched';
  return 'Unlinked';
}

function age(value: string | null) {
  if (!value) return 'Never';
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortFingerprint(value: string | null) {
  if (!value) return 'No fingerprint';
  return value.length <= 36 ? value : `${value.slice(0, 35)}…`;
}

function SummaryCard({ label, value, detail, active = false, onClick }: { label: string; value: number; detail: string; active?: boolean; onClick?: () => void }) {
  if (onClick) {
    return <button aria-pressed={active} className={`${styles.summaryCard} ${active ? styles.summaryActive : ''}`} onClick={onClick} type="button"><span>{label}</span><strong>{value.toLocaleString('en-ZA')}</strong><small>{detail}</small></button>;
  }
  return <article className={styles.summaryCard}><span>{label}</span><strong>{value.toLocaleString('en-ZA')}</strong><small>{detail}</small></article>;
}

export function ProfileRolloutWorkspace() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [status, setStatus] = useState<ProfileQueueFilter>('profile_attention');
  const [branch, setBranch] = useState('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const offset = (page - 1) * PAGE_SIZE;
    const { data: result, error: queryError } = await getSupabaseClient().rpc('get_telemetry_machine_fleet', {
      p_search: search,
      p_branch: branch,
      p_status: status,
      p_offset: offset,
      p_limit: PAGE_SIZE,
    });
    if (queryError) {
      setError(queryError.message);
      setLoading(false);
      return;
    }
    setData((result ?? null) as FleetResponse | null);
    setLoading(false);
  }, [branch, page, search, status]);

  useEffect(() => { void load(); }, [load]);

  function applyStatus(next: ProfileQueueFilter) {
    setStatus(next);
    setPage(1);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchDraft.trim());
    setPage(1);
  }

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? {
    linked_devices: 0,
    profile_configured: 0,
    profile_pending: 0,
    profile_ambiguous: 0,
    profile_unmatched: 0,
    profile_manual: 0,
    profile_automatic: 0,
    profile_resolved: 0,
    profile_unresolved: 0,
    profile_attention: 0,
  };
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className={styles.workspace} data-profile-rollout="v1">
      {error ? <div className={styles.error} role="alert"><strong>Profile rollout error</strong><span>{error}</span></div> : null}

      <section className={styles.summary} aria-label="Decoder profile rollout summary">
        <SummaryCard detail={`${summary.profile_automatic.toLocaleString('en-ZA')} automatic · ${summary.profile_manual.toLocaleString('en-ZA')} manual`} label="Linked controllers" value={summary.linked_devices} />
        <SummaryCard active={status === 'profile_configured'} detail="Effective profile ACKed" label="Configured" onClick={() => applyStatus('profile_configured')} value={summary.profile_configured} />
        <SummaryCard active={status === 'profile_pending'} detail="Profile selected, device ACK pending" label="Pending ACK" onClick={() => applyStatus('profile_pending')} value={summary.profile_pending} />
        <SummaryCard active={status === 'profile_ambiguous'} detail="Multiple plausible decoder profiles" label="Ambiguous" onClick={() => applyStatus('profile_ambiguous')} value={summary.profile_ambiguous} />
        <SummaryCard active={status === 'profile_unmatched'} detail="No profile meets resolver threshold" label="Unmatched" onClick={() => applyStatus('profile_unmatched')} value={summary.profile_unmatched} />
        <SummaryCard active={status === 'profile_attention'} detail={`${summary.profile_unresolved.toLocaleString('en-ZA')} unresolved`} label="Needs attention" onClick={() => applyStatus('profile_attention')} value={summary.profile_attention} />
      </section>

      <section className={styles.explainer}>
        <div><span>Resolved</span><strong>{summary.profile_resolved.toLocaleString('en-ZA')}</strong><small>Configured or waiting only for device acknowledgement.</small></div>
        <div><span>Unresolved</span><strong>{summary.profile_unresolved.toLocaleString('en-ZA')}</strong><small>Requires more identity evidence or an operator decision.</small></div>
        <div><span>Region</span><strong>{(data?.telemetry_region ?? '—').replaceAll('_', ' ')}</strong><small>All counts and queue rows are region scoped.</small></div>
      </section>

      <section className={styles.toolbar}>
        <form className={styles.search} onSubmit={submitSearch}>
          <input aria-label="Search profile rollout queue" onChange={(event) => setSearchDraft(event.target.value)} placeholder="Machine, serial, device, model or fingerprint" value={searchDraft} />
          <button type="submit">Search</button>
        </form>
        <select aria-label="Filter profile rollout status" onChange={(event) => applyStatus(event.target.value as ProfileQueueFilter)} value={status}>
          <option value="profile_attention">Needs attention</option>
          <option value="profile_pending">Pending ACK</option>
          <option value="profile_ambiguous">Ambiguous</option>
          <option value="profile_unmatched">Unmatched</option>
          <option value="profile_configured">Configured</option>
        </select>
        <select aria-label="Filter profile rollout branch" onChange={(event) => { setBranch(event.target.value); setPage(1); }} value={branch}>
          <option value="all">All branches</option>
          {(data?.branches ?? []).map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
        </select>
        <button className={styles.refresh} disabled={loading} onClick={() => void load()} type="button">Refresh</button>
        <small>{total.toLocaleString('en-ZA')} matching · page {page.toLocaleString('en-ZA')} of {pageCount.toLocaleString('en-ZA')}</small>
      </section>

      {loading && !data ? <HamsterLoader label="Loading profile rollout queue" /> : (
        <section className={styles.queue} aria-busy={loading}>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Status</th><th>Machine</th><th>Controller</th><th>Effective profile</th><th>Identity evidence</th><th>Contact</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><span className={`${styles.statusPill} ${styles[`status_${row.profile_status}`]}`}>{statusLabel(row.profile_status)}</span><small>{row.profile_confidence ?? 'unknown'} confidence</small></td>
                    <td><strong>{machineTitle(row)}</strong><small>{row.serial_number ?? row.asset_tag ?? 'No serial'} · {row.site_name}</small></td>
                    <td><strong>{row.device_code ?? 'No controller'}</strong><small>{row.profile_assignment_method ?? 'automatic'} · {row.reported_machine_interface?.toUpperCase() ?? 'interface unknown'}</small></td>
                    <td><strong>{row.profile_display_name ?? row.effective_profile_key ?? 'No profile selected'}</strong><small>{row.applied_profile_key ? `Applied ${row.applied_profile_key}` : 'No applied profile ACK'}</small></td>
                    <td><strong>{row.reported_machine_model ?? 'Model not reported'}</strong><small title={row.reported_machine_profile_fingerprint ?? undefined}>{shortFingerprint(row.reported_machine_profile_fingerprint)}</small></td>
                    <td><strong>{row.connection_status}</strong><small>{age(row.last_contact)}</small></td>
                    <td><div className={styles.actions}><Link href={`/machines/${row.id}`}>Machine</Link>{row.device_code ? <Link href={`/telemetry/devices?device=${encodeURIComponent(row.device_code)}`}>Device</Link> : null}{row.device_code ? <Link href={`/telemetry/devices/profile-identity?device=${encodeURIComponent(row.device_code)}`}>Evidence</Link> : null}{row.device_code ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(row.device_code)}`}>Test Center</Link> : null}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileCards}>
            {rows.map((row) => <article className={styles.mobileCard} key={row.id}>
              <header><div><span className={`${styles.statusPill} ${styles[`status_${row.profile_status}`]}`}>{statusLabel(row.profile_status)}</span><h3>{machineTitle(row)}</h3><p>{row.device_code ?? 'No controller'} · {row.site_name}</p></div><small>{age(row.last_contact)}</small></header>
              <dl><div><dt>Effective profile</dt><dd>{row.profile_display_name ?? row.effective_profile_key ?? 'No profile selected'}</dd></div><div><dt>Evidence</dt><dd>{row.reported_machine_model ?? shortFingerprint(row.reported_machine_profile_fingerprint)}</dd></div><div><dt>Confidence</dt><dd>{row.profile_confidence ?? 'unknown'}</dd></div></dl>
              <div className={styles.actions}><Link href={`/machines/${row.id}`}>Machine</Link>{row.device_code ? <Link href={`/telemetry/devices?device=${encodeURIComponent(row.device_code)}`}>Device</Link> : null}{row.device_code ? <Link href={`/telemetry/devices/profile-identity?device=${encodeURIComponent(row.device_code)}`}>Evidence</Link> : null}</div>
            </article>)}
          </div>

          {!rows.length ? <div className={styles.empty}><strong>No machines match this profile state.</strong><span>Change the status, branch or search filter to inspect another part of the rollout.</span></div> : null}

          <footer className={styles.pagination}><button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button><span>Page {page.toLocaleString('en-ZA')} of {pageCount.toLocaleString('en-ZA')}</span><button disabled={page >= pageCount || loading} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">Next</button></footer>
        </section>
      )}
    </section>
  );
}
