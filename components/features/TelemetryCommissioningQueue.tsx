'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';

type CommissioningState = 'waiting' | 'online' | 'enrolled_offline' | 'attention' | 'expired' | 'revoked';
type QueueFilter = 'all' | 'waiting' | 'enrolled' | 'attention' | 'history';

type CommissioningRow = {
  token_id: string;
  hardware_uid: string;
  label: string | null;
  token_status: string;
  commissioning_state: CommissioningState;
  attention_reason: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  expected_machine_id: string | null;
  machine_name: string | null;
  machine_serial: string | null;
  machine_asset_tag: string | null;
  machine_barcode: string | null;
  device_id: string | null;
  device_code: string | null;
  device_status: string | null;
  device_machine_id: string | null;
  device_machine_link_status: string | null;
  device_machine_link_method: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_transport: string | null;
};

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function machineLabel(row: CommissioningRow) {
  return row.machine_asset_tag
    ?? row.machine_serial
    ?? row.machine_barcode
    ?? row.machine_name
    ?? row.expected_machine_id
    ?? 'No machine pre-pair';
}

function stateLabel(state: CommissioningState) {
  if (state === 'enrolled_offline') return 'Enrolled offline';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function stateClass(state: CommissioningState) {
  if (state === 'online') return 'is-success';
  if (state === 'attention') return 'is-error';
  if (state === 'waiting' || state === 'enrolled_offline') return 'is-warning';
  return 'is-neutral';
}

export function TelemetryCommissioningQueue() {
  const [rows, setRows] = useState<CommissioningRow[]>([]);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadQueue = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);
    const { data, error: requestError } = await getSupabaseClient().rpc(
      'get_telemetry_commissioning_queue',
      { p_state: 'all', p_limit: 500 },
    );
    if (requestError) {
      setError(requestError.message);
    } else {
      setRows((data ?? []) as CommissioningRow[]);
      setError(null);
      setLastUpdated(new Date());
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadQueue(true);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !revokingTokenId) void loadQueue(false);
    }, 15_000);
    return () => window.clearInterval(intervalId);
  }, [loadQueue, revokingTokenId]);

  async function revokeWaitingCredential(row: CommissioningRow) {
    if (row.commissioning_state !== 'waiting' || row.token_status !== 'active' || row.used_at) return;
    if (!window.confirm(`Revoke the enrollment credential for ${row.hardware_uid}? The controller will no longer be able to enroll with this credential.`)) return;

    setRevokingTokenId(row.token_id);
    setError(null);
    setMessage(null);
    try {
      const { data, error: requestError } = await getSupabaseClient().rpc(
        'revoke_telemetry_enrollment_token',
        { p_token_id: row.token_id },
      );
      if (requestError) throw requestError;
      const result = (data ?? {}) as { revoked?: boolean };
      if (!result.revoked) throw new Error('The enrollment credential was not revoked. It may already have been used or revoked.');
      setMessage(`Enrollment credential for ${row.hardware_uid} revoked.`);
      await loadQueue(false);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'The enrollment credential could not be revoked.');
    } finally {
      setRevokingTokenId(null);
    }
  }

  const metrics = useMemo(() => ({
    waiting: rows.filter((row) => row.commissioning_state === 'waiting').length,
    online: rows.filter((row) => row.commissioning_state === 'online').length,
    offline: rows.filter((row) => row.commissioning_state === 'enrolled_offline').length,
    attention: rows.filter((row) => row.commissioning_state === 'attention').length,
    history: rows.filter((row) => row.commissioning_state === 'expired' || row.commissioning_state === 'revoked').length,
  }), [rows]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (filter === 'waiting') return row.commissioning_state === 'waiting';
    if (filter === 'enrolled') return row.commissioning_state === 'online' || row.commissioning_state === 'enrolled_offline';
    if (filter === 'attention') return row.commissioning_state === 'attention';
    if (filter === 'history') return row.commissioning_state === 'expired' || row.commissioning_state === 'revoked';
    return true;
  }), [filter, rows]);

  return (
    <section className="fleet-panel device-commissioning-queue" data-telemetry-commissioning-queue="v2">
      <div className="device-enrollment-heading">
        <div>
          <span>Fleet commissioning</span>
          <h2>Commissioning queue</h2>
          <p>Track UID-bound credentials from issuance through enrollment and first heartbeat. Only safe commissioning metadata is shown; enrollment-token hashes are never returned to the browser.</p>
        </div>
        <button className="fleet-button secondary" disabled={refreshing || Boolean(revokingTokenId)} onClick={() => void loadQueue(false)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh queue'}</button>
      </div>

      {error ? <div className="fleet-banner is-error" role="alert"><strong>Commissioning action failed.</strong><span>{error}</span></div> : null}
      {message ? <div className="fleet-banner is-success" role="status"><strong>Commissioning credential updated.</strong><span>{message}</span></div> : null}

      <div className="fleet-metric-grid device-metric-grid">
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-amber"><NavigationIcon kind="queue" /></span><div><span>Waiting</span><strong>{metrics.waiting}</strong></div><small>Issued, not yet enrolled</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-green"><NavigationIcon kind="telemetry" /></span><div><span>Online</span><strong>{metrics.online}</strong></div><small>Enrolled and seen within 30 minutes</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-grey"><NavigationIcon kind="telemetry" /></span><div><span>Enrolled offline</span><strong>{metrics.offline}</strong></div><small>Enrolled without a recent heartbeat</small></article>
        <article className="fleet-metric-card"><span className="fleet-metric-icon is-red"><NavigationIcon kind="bell" /></span><div><span>Attention</span><strong>{metrics.attention}</strong></div><small>Device or machine-link mismatch</small></article>
      </div>

      <div className="fleet-filters device-register-filters">
        <label><span>View</span><select value={filter} onChange={(event) => setFilter(event.target.value as QueueFilter)}><option value="all">All recent</option><option value="waiting">Waiting</option><option value="enrolled">Enrolled</option><option value="attention">Attention</option><option value="history">Expired / revoked</option></select></label>
        <span>{visibleRows.length.toLocaleString('en-ZA')} shown · {metrics.history.toLocaleString('en-ZA')} historical · last refreshed {lastUpdated ? formatDate(lastUpdated.toISOString()) : 'never'}</span>
      </div>

      {loading ? <HamsterLoader label="Loading telemetry commissioning queue" /> : visibleRows.length === 0 ? <div className="fleet-empty-state"><strong>No commissioning records in this view.</strong><span>New UID-bound enrollment credentials will appear here after they are issued.</span></div> : <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Controller</th><th>Intended machine</th><th>Credential</th><th>Enrolled device</th><th>Last contact</th><th>State</th><th>Actions</th></tr></thead><tbody>{visibleRows.map((row) => {
        const canRevoke = row.commissioning_state === 'waiting' && row.token_status === 'active' && !row.used_at;
        return <tr key={row.token_id}><td><strong>{row.hardware_uid}</strong><span>{row.label ?? 'No label'}</span></td><td><strong>{machineLabel(row)}</strong><span>{row.expected_machine_id ? row.machine_name ?? 'Machine pre-paired' : 'Serial fallback allowed'}</span></td><td><strong>{row.token_status}</strong><span>{row.used_at ? `Used ${formatDate(row.used_at)}` : `Expires ${formatDate(row.expires_at)}`}</span></td><td><strong>{row.device_code ?? 'Not enrolled'}</strong><span>{row.firmware_version ?? row.device_machine_link_method ?? 'Awaiting device'}</span></td><td><strong>{formatDate(row.last_seen_at)}</strong><span>{row.last_transport ? row.last_transport.replace('_', ' ') : 'No transport reported'}</span></td><td><span className={`fleet-status-pill ${stateClass(row.commissioning_state)}`}><i />{stateLabel(row.commissioning_state)}</span>{row.attention_reason ? <small>{row.attention_reason}</small> : null}</td><td>{canRevoke ? <button className="fleet-button secondary" disabled={revokingTokenId === row.token_id} onClick={() => void revokeWaitingCredential(row)} type="button">{revokingTokenId === row.token_id ? 'Revoking…' : 'Revoke credential'}</button> : <span>—</span>}</td></tr>;
      })}</tbody></table></div>}
    </section>
  );
}
