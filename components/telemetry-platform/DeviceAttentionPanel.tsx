'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { buildFleetAttentionItems, type FleetAttentionBalance, type FleetAttentionDevice, type FleetAttentionItem, type FleetAttentionKind } from '@/lib/telemetry/fleet-attention';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './DeviceAttentionPanel.module.css';

type MachineSummary = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  branch: string | null;
  current_custodian: string | null;
};

type AttentionFilter = 'all' | FleetAttentionKind;

const DEVICE_PAGE_SIZE = 1000;
const LOOKUP_BATCH = 100;
const PAGE_SIZE = 30;
const DEVICE_SELECT = 'id,device_code,machine_id,status,last_heartbeat_at,last_seen_at,last_upload_at,last_config_at,last_config_ack_at,last_transport,wifi_rssi,cellular_csq,cellular_operator';

async function loadAllDevices() {
  const client = getSupabaseClient();
  const rows: FleetAttentionDevice[] = [];
  for (let offset = 0; ; offset += DEVICE_PAGE_SIZE) {
    const { data, error } = await client
      .from('telemetry_devices')
      .select(DEVICE_SELECT)
      .order('device_code', { ascending: true })
      .range(offset, offset + DEVICE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as FleetAttentionDevice[];
    rows.push(...page);
    if (page.length < DEVICE_PAGE_SIZE) break;
  }
  return rows;
}

async function loadAllBalances() {
  const client = getSupabaseClient();
  const rows: FleetAttentionBalance[] = [];
  for (let offset = 0; ; offset += DEVICE_PAGE_SIZE) {
    const { data, error } = await client
      .rpc('get_telemetry_prepaid_balances')
      .range(offset, offset + DEVICE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as FleetAttentionBalance[];
    rows.push(...page);
    if (page.length < DEVICE_PAGE_SIZE) break;
  }
  return rows;
}

async function loadMachines(ids: string[]) {
  const client = getSupabaseClient();
  const rows: MachineSummary[] = [];
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH) {
    const { data, error } = await client
      .from('machines')
      .select('id,machine_name,serial_number,branch,current_custodian')
      .in('id', ids.slice(offset, offset + LOOKUP_BATCH));
    if (error) throw error;
    rows.push(...((data ?? []) as MachineSummary[]));
  }
  return rows;
}

function bytes(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return '0 B';
  if (amount < 1024) return `${Math.round(amount)} B`;
  if (amount < 1024 ** 2) return `${(amount / 1024).toFixed(1)} KB`;
  if (amount < 1024 ** 3) return `${(amount / 1024 ** 2).toFixed(1)} MB`;
  return `${(amount / 1024 ** 3).toFixed(2)} GB`;
}

function age(value: string | null) {
  if (!value) return 'not recorded';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function title(item: FleetAttentionItem) {
  if (item.kind === 'offline') return item.occurredAt ? 'Controller offline' : 'Controller has never contacted DallmayrERP';
  if (item.kind === 'config') return 'Configuration awaiting device ACK';
  if (item.kind === 'sim_balance') {
    if (item.balanceAlert === 'depleted') return 'SIM balance depleted';
    if (item.balanceAlert === 'critical') return 'SIM balance critical';
    return 'SIM balance low';
  }
  return item.lastTransport ? `${item.lastTransport === 'wifi' ? 'Wi-Fi' : 'Cellular'} signal not reported` : 'Network transport not reported';
}

function detail(item: FleetAttentionItem) {
  if (item.kind === 'offline') return item.occurredAt ? `Last confirmed device contact ${age(item.occurredAt)}.` : 'No heartbeat, upload, seen event or configuration acknowledgement has been received.';
  if (item.kind === 'config') return `Configuration was sent ${age(item.occurredAt)} and has not been acknowledged.`;
  if (item.kind === 'sim_balance') return `${bytes(item.remainingBytes)} remaining. ${item.balanceAlert === 'low' ? 'Plan a top-up.' : 'Top up this SIM now.'}`;
  return 'The controller is online, but its active network or signal strength has not been reported.';
}

function kindLabel(kind: FleetAttentionKind) {
  if (kind === 'offline') return 'Offline';
  if (kind === 'config') return 'Config ACK';
  if (kind === 'sim_balance') return 'SIM balance';
  return 'Network';
}

export function DeviceAttentionPanel() {
  const [devices, setDevices] = useState<FleetAttentionDevice[]>([]);
  const [balances, setBalances] = useState<FleetAttentionBalance[]>([]);
  const [machines, setMachines] = useState<Record<string, MachineSummary>>({});
  const [filter, setFilter] = useState<AttentionFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [balanceUnavailable, setBalanceUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const nextDevices = await loadAllDevices();
      let nextBalances: FleetAttentionBalance[] = [];
      let nextBalanceUnavailable = false;
      try {
        nextBalances = await loadAllBalances();
      } catch {
        nextBalanceUnavailable = true;
      }
      const items = buildFleetAttentionItems(nextDevices, nextBalances);
      const machineIds = Array.from(new Set(items.map((item) => item.machineId).filter((value): value is string => Boolean(value))));
      const machineRows = await loadMachines(machineIds);
      setDevices(nextDevices);
      setBalances(nextBalances);
      setMachines(Object.fromEntries(machineRows.map((machine) => [machine.id, machine])));
      setBalanceUnavailable(nextBalanceUnavailable);
      setUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Device attention could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = useMemo(() => buildFleetAttentionItems(devices, balances), [balances, devices]);
  const counts = useMemo(() => items.reduce((next, item) => {
    next[item.kind] = (next[item.kind] ?? 0) + 1;
    return next;
  }, {} as Record<FleetAttentionKind, number>), [items]);
  const critical = items.filter((item) => item.severity === 'critical').length;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!term) return true;
      const machine = item.machineId ? machines[item.machineId] : null;
      return [item.deviceCode, title(item), detail(item), machine?.machine_name, machine?.serial_number, machine?.branch, machine?.current_custodian]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [filter, items, machines, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => setPage(1), [filter, search]);
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);

  return (
    <section className={styles.panel} data-device-attention-center="v1" aria-label="Device attention">
      <header className={styles.header}>
        <div><span>Controller exceptions</span><strong>Device attention</strong><small>Live connectivity, configuration, SIM balance and network-reporting exceptions.</small></div>
        <div className={styles.headerActions}><span>{items.length.toLocaleString('en-ZA')} open</span><button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
      </header>

      {error ? <div className={styles.error} role="alert">Device attention unavailable: {error}</div> : null}
      {balanceUnavailable ? <div className={styles.warning} role="status">SIM balance status could not be loaded; connectivity and configuration exceptions are still current.</div> : null}

      {loading ? <div className={styles.loading}>Loading controller exceptions…</div> : <>
        <div className={styles.metrics} aria-label="Device attention summary">
          <button className={filter === 'all' ? styles.activeMetric : ''} onClick={() => setFilter('all')} type="button"><span>All</span><strong>{items.length.toLocaleString('en-ZA')}</strong><small>{critical.toLocaleString('en-ZA')} critical</small></button>
          <button className={filter === 'offline' ? styles.activeMetric : ''} onClick={() => setFilter('offline')} type="button"><span>Offline</span><strong>{(counts.offline ?? 0).toLocaleString('en-ZA')}</strong><small>Controller contact</small></button>
          <button className={filter === 'config' ? styles.activeMetric : ''} onClick={() => setFilter('config')} type="button"><span>Config ACK</span><strong>{(counts.config ?? 0).toLocaleString('en-ZA')}</strong><small>Pending delivery</small></button>
          <button className={filter === 'sim_balance' ? styles.activeMetric : ''} onClick={() => setFilter('sim_balance')} type="button"><span>SIM balance</span><strong>{(counts.sim_balance ?? 0).toLocaleString('en-ZA')}</strong><small>Top-up attention</small></button>
          <button className={filter === 'network' ? styles.activeMetric : ''} onClick={() => setFilter('network')} type="button"><span>Network</span><strong>{(counts.network ?? 0).toLocaleString('en-ZA')}</strong><small>Signal reporting</small></button>
        </div>

        <div className={styles.toolbar}>
          <label><NavigationIcon kind="search" /><input aria-label="Search device attention" onChange={(event) => setSearch(event.target.value)} placeholder="Search device, machine, serial, branch or exception" value={search} /></label>
          <span>{filtered.length.toLocaleString('en-ZA')} matching · updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>

        {!visible.length ? <div className={styles.empty}>{items.length ? 'No controller exceptions match this filter.' : 'No controller exceptions currently need attention.'}</div> : <div className={styles.list}>{visible.map((item) => {
          const machine = item.machineId ? machines[item.machineId] : null;
          return <article className={styles.row} key={item.id}>
            <i className={item.severity === 'critical' ? styles.critical : styles.warningTone} aria-hidden="true" />
            <div className={styles.body}>
              <div><span className={styles.kind}>{kindLabel(item.kind)}</span><strong>{title(item)}</strong><span className={`${styles.severity} ${item.severity === 'critical' ? styles.severityCritical : styles.severityWarning}`}>{item.severity}</span></div>
              <p>{detail(item)}</p>
              <small><b>{item.deviceCode}</b>{machine ? ` · ${machine.machine_name ?? machine.serial_number ?? 'Machine'} · ${machine.current_custodian ?? machine.branch?.toUpperCase() ?? 'Location unavailable'}` : ' · Unassigned controller'}</small>
            </div>
            <div className={styles.actions}>
              {item.machineId ? <Link href={`/machines/${item.machineId}`}>Machine</Link> : null}
              <Link href={`/telemetry/devices?device=${encodeURIComponent(item.deviceCode)}`}>Device</Link>
              <Link href={`/telemetry/test-center?device=${encodeURIComponent(item.deviceCode)}`}>Test Center</Link>
            </div>
          </article>;
        })}</div>}

        <footer className={styles.footer}>
          <span>Page {currentPage} of {pageCount}</span>
          <div><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><button disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div>
        </footer>
      </>}
    </section>
  );
}
