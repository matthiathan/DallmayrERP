'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MachineCreateImportControls } from '@/components/features/MachineCreateImportControls';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineFleetBrowser.module.css';

type ConnectionStatus = 'online' | 'delayed' | 'offline' | 'never' | 'unlinked';
type FleetFilterStatus = 'all' | ConnectionStatus | 'unconnected' | 'faults' | 'profile_attention';
type ProfileStatus = 'configured' | 'pending' | 'unmatched' | 'unlinked';

type MachineFleetRow = {
  id: string;
  branch: string;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  machine_name: string | null;
  model: string | null;
  asset_status: string;
  current_custodian: string | null;
  manufacturer: string | null;
  site_name: string;
  location: string;
  device_id: string | null;
  device_code: string | null;
  telemetry_mode: 'live' | 'daily' | 'monthly' | null;
  machine_status: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  profile_id: string | null;
  profile_assignment_method: 'automatic' | 'manual' | null;
  profile_model_key: string | null;
  profile_display_name: string | null;
  profile_status: ProfileStatus;
  reported_machine_interface: string | null;
  reported_machine_model: string | null;
  fault_count: number;
  last_contact: string | null;
  connection_status: ConnectionStatus;
};

type FleetSummary = Record<ConnectionStatus, number> & { active_faults: number; profile_attention: number };
type FleetPayload = {
  rows?: MachineFleetRow[];
  total?: number;
  fleet_total?: number;
  summary?: Partial<FleetSummary>;
  branches?: string[];
  limit?: number;
  offset?: number;
  generated_at?: string;
};

type SavedFleetView = { search: string; branch: string; status: FleetFilterStatus };

const TABLE_PAGE_SIZE = 75;
const FILTER_STORAGE_KEY = 'dallmayr-machine-fleet-view-v1';
const EMPTY_SUMMARY: FleetSummary = { online: 0, delayed: 0, offline: 0, never: 0, unlinked: 0, active_faults: 0, profile_attention: 0 };

function titleFor(machine: MachineFleetRow) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.asset_tag ?? 'Unnamed machine';
}

function statusLabel(status: ConnectionStatus) {
  if (status === 'unlinked') return 'No device';
  if (status === 'never') return 'Never connected';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function transportLabel(machine: MachineFleetRow) {
  if (!machine.last_transport) return 'Not reported';
  return machine.last_transport === 'wifi' ? 'Wi-Fi' : 'Cellular';
}

function profileLabel(machine: MachineFleetRow) {
  if (!machine.device_id) return 'No device';
  const name = machine.profile_display_name ?? machine.profile_model_key;
  if (machine.profile_status === 'pending') return name ? `Pending · ${name}` : 'Profile pending';
  if (!machine.profile_id) return 'Automatic · unmatched';
  if (machine.profile_assignment_method === 'manual') return `Manual · ${name ?? 'Configured'}`;
  return `Automatic · ${name ?? 'Configured'}`;
}

function contactAge(value: string | null) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function normaliseRow(row: MachineFleetRow): MachineFleetRow {
  return {
    ...row,
    profile_status: row.profile_status ?? (row.device_id ? 'unmatched' : 'unlinked'),
    fault_count: Number(row.fault_count ?? 0),
    wifi_rssi: row.wifi_rssi === null || row.wifi_rssi === undefined ? null : Number(row.wifi_rssi),
    cellular_csq: row.cellular_csq === null || row.cellular_csq === undefined ? null : Number(row.cellular_csq),
  };
}

function isFleetFilterStatus(value: unknown): value is FleetFilterStatus {
  return typeof value === 'string' && ['all', 'online', 'delayed', 'offline', 'never', 'unlinked', 'unconnected', 'faults', 'profile_attention'].includes(value);
}

export function MachineFleetBrowser() {
  const [rows, setRows] = useState<MachineFleetRow[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [status, setStatus] = useState<FleetFilterStatus>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [fleetTotal, setFleetTotal] = useState(0);
  const [summary, setSummary] = useState<FleetSummary>(EMPTY_SUMMARY);
  const [branches, setBranches] = useState<string[]>([]);
  const [filtersReady, setFiltersReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedFleetView>;
        const savedSearch = typeof saved.search === 'string' ? saved.search.trim() : '';
        setSearchInput(savedSearch);
        setSearch(savedSearch);
        setBranch(typeof saved.branch === 'string' && saved.branch ? saved.branch : 'all');
        setStatus(isFleetFilterStatus(saved.status) ? saved.status : 'all');
      }
    } catch {
      window.localStorage.removeItem(FILTER_STORAGE_KEY);
    } finally {
      setFiltersReady(true);
    }
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filtersReady, searchInput]);

  useEffect(() => {
    if (!filtersReady) return;
    const saved: SavedFleetView = { search: searchInput.trim(), branch, status };
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(saved));
  }, [branch, filtersReady, searchInput, status]);

  const loadFleet = useCallback(async (quiet = false, pageOverride?: number) => {
    if (!filtersReady) return;
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const targetPage = Math.max(1, pageOverride ?? page);
      const { data, error: fleetError } = await getSupabaseClient().rpc('get_telemetry_machine_fleet', {
        p_search: search,
        p_branch: branch,
        p_status: status,
        p_offset: (targetPage - 1) * TABLE_PAGE_SIZE,
        p_limit: TABLE_PAGE_SIZE,
      });
      if (fleetError) throw fleetError;
      const payload = (data ?? {}) as FleetPayload;
      const nextSummary = payload.summary ?? {};
      setRows((payload.rows ?? []).map(normaliseRow));
      setTotal(Number(payload.total ?? 0));
      setFleetTotal(Number(payload.fleet_total ?? 0));
      setSummary({
        online: Number(nextSummary.online ?? 0),
        delayed: Number(nextSummary.delayed ?? 0),
        offline: Number(nextSummary.offline ?? 0),
        never: Number(nextSummary.never ?? 0),
        unlinked: Number(nextSummary.unlinked ?? 0),
        active_faults: Number(nextSummary.active_faults ?? 0),
        profile_attention: Number(nextSummary.profile_attention ?? 0),
      });
      setBranches((payload.branches ?? []).filter(Boolean));
      setLastUpdated(payload.generated_at ? new Date(payload.generated_at) : new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the machine fleet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branch, filtersReady, page, search, status]);

  useEffect(() => { loadFleet(false).catch(() => undefined); }, [loadFleet]);

  useEffect(() => {
    if (!filtersReady) return;
    const interval = window.setInterval(() => loadFleet(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, [filtersReady, loadFleet]);

  const pageCount = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const refreshAll = useCallback(async () => {
    if (page !== 1) {
      setPage(1);
      return;
    }
    await loadFleet(true, 1);
  }, [loadFleet, page]);

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setBranch('all');
    setStatus('all');
    setPage(1);
  };

  const applyStatusFilter = (nextStatus: FleetFilterStatus) => {
    setStatus((current) => current === nextStatus ? 'all' : nextStatus);
    setPage(1);
  };

  return (
    <section className={styles.workspace} data-machine-browser="televend-v3">
      <header className={styles.header}>
        <div className={styles.headerCopy}><h1>Machines</h1><p>Live machine status, faults, connectivity, decoder profile and device assignment.</p></div>
        <div className={styles.headerActions}>
          <button className={styles.headerButton} disabled={refreshing} onClick={() => loadFleet(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <MachineCreateImportControls onChanged={refreshAll} />
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading machine fleet" /> : null}

      {!loading ? <>
        <section aria-label="Machine fleet status" className={styles.statusStrip}>
          <button aria-pressed={status === 'online'} className={`${styles.statusCard} ${styles.online} ${status === 'online' ? styles.statusCardActive : ''}`} onClick={() => applyStatusFilter('online')} type="button"><span>Online</span><strong>{summary.online.toLocaleString('en-ZA')}</strong><small>Filter fleet</small></button>
          <button aria-pressed={status === 'delayed'} className={`${styles.statusCard} ${styles.delayed} ${status === 'delayed' ? styles.statusCardActive : ''}`} onClick={() => applyStatusFilter('delayed')} type="button"><span>Delayed</span><strong>{summary.delayed.toLocaleString('en-ZA')}</strong><small>Filter fleet</small></button>
          <button aria-pressed={status === 'offline'} className={`${styles.statusCard} ${styles.offline} ${status === 'offline' ? styles.statusCardActive : ''}`} onClick={() => applyStatusFilter('offline')} type="button"><span>Offline</span><strong>{summary.offline.toLocaleString('en-ZA')}</strong><small>Filter fleet</small></button>
          <button aria-pressed={status === 'unconnected'} className={`${styles.statusCard} ${styles.unlinked} ${status === 'unconnected' ? styles.statusCardActive : ''}`} onClick={() => applyStatusFilter('unconnected')} type="button"><span>No device / never</span><strong>{(summary.unlinked + summary.never).toLocaleString('en-ZA')}</strong><small>Filter fleet</small></button>
          <button aria-pressed={status === 'faults'} className={`${styles.statusCard} ${styles.faults} ${status === 'faults' ? styles.statusCardActive : ''}`} onClick={() => applyStatusFilter('faults')} type="button"><span>Active faults</span><strong>{summary.active_faults.toLocaleString('en-ZA')}</strong><small>Filter affected machines</small></button>
          <button aria-pressed={status === 'profile_attention'} className={`${styles.statusCard} ${styles.profiles} ${status === 'profile_attention' ? styles.statusCardActive : ''}`} onClick={() => applyStatusFilter('profile_attention')} type="button"><span>Profile attention</span><strong>{summary.profile_attention.toLocaleString('en-ZA')}</strong><small>Unmatched or pending</small></button>
        </section>

        <section className={styles.filters} aria-label="Machine filters">
          <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search machines" placeholder="Search machine, serial, QR, site, device, model or profile" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
          <label className={styles.filterLabel}><span>Branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
          <label className={styles.filterLabel}><span>Operational view</span><select value={status} onChange={(event) => { setStatus(event.target.value as FleetFilterStatus); setPage(1); }}><option value="all">All machines</option><option value="online">Online</option><option value="delayed">Delayed</option><option value="offline">Offline</option><option value="unconnected">No device / never connected</option><option value="never">Never connected</option><option value="unlinked">No device</option><option value="faults">Active faults</option><option value="profile_attention">Profile attention</option></select></label>
          <button className={styles.clearButton} onClick={clearFilters} type="button">Clear saved filters</button>
        </section>

        <section className={styles.listCard}>
          <header className={styles.listHeader}><div><strong>Machine overview</strong><small>Faults and decoder-profile attention are prioritised within each result page.</small></div><span>{total.toLocaleString('en-ZA')} of {fleetTotal.toLocaleString('en-ZA')} machines · updated {lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></header>

          {total === 0 ? <div className={styles.empty}>No machines match the selected filters.</div> : <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr><th>Machine</th><th>Status</th><th>Location</th><th>Telemetry device</th><th>Profile</th><th>Network</th><th>Signal</th><th>Faults</th><th>Last contact</th><th>Quick actions</th></tr></thead>
                <tbody>{rows.map((machine) => (
                  <tr key={machine.id}>
                    <td className={`${styles.machineCell} ${styles[`status_${machine.connection_status}`]}`}><Link className={styles.machineLink} href={`/machines/${machine.id}`}><strong>{titleFor(machine)}</strong><span>{machine.serial_number ?? 'No serial'} · QR {machine.machine_barcode ?? machine.asset_tag ?? '—'}</span></Link></td>
                    <td><span className={`${styles.statusPill} ${styles[`is_${machine.connection_status}`]}`}><i />{statusLabel(machine.connection_status)}</span></td>
                    <td><strong>{machine.site_name}</strong><div className={styles.secondary}>{machine.location}</div></td>
                    <td>{machine.device_id ? <><strong>{machine.device_code}</strong><div className={styles.secondary}>{machine.telemetry_mode ?? 'live'} · {machine.machine_status ?? 'unknown'}</div></> : <span className={styles.secondary}>Not assigned</span>}</td>
                    <td><span className={`${styles.profilePill} ${styles[`profile_${machine.profile_status}`]}`}>{profileLabel(machine)}</span><div className={styles.secondary}>{machine.reported_machine_interface ? machine.reported_machine_interface.toUpperCase() : machine.reported_machine_model ?? 'No identity evidence'}</div></td>
                    <td><div className={styles.network}><strong>{transportLabel(machine)}</strong><span className={styles.secondary}>{machine.cellular_operator ?? machine.firmware_version ?? '—'}</span></div></td>
                    <td>{machine.device_id ? <SignalStrengthIndicator cellularCsq={machine.cellular_csq} transport={machine.last_transport} wifiRssi={machine.wifi_rssi} /> : <span className={styles.secondary}>—</span>}</td>
                    <td>{machine.fault_count ? <span className={styles.faultCount}>{machine.fault_count}</span> : <span className={styles.noFaults}>Clear</span>}</td>
                    <td>{contactAge(machine.last_contact)}</td>
                    <td><div className={styles.quickActions}><Link href={`/machines/${machine.id}`}>Dashboard</Link>{machine.device_code ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(machine.device_code)}`}>Test</Link> : null}<Link href="/products">Mappings</Link></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            <div className={styles.mobileList}>
              {rows.map((machine) => (
                <article className={`${styles.machineMobile} ${styles[`status_${machine.connection_status}`]}`} key={machine.id}>
                  <Link className={styles.mobileOpen} href={`/machines/${machine.id}`}>
                    <div className={styles.mobileMain}><strong>{titleFor(machine)}</strong><span>{machine.site_name}</span><small>{machine.location}</small></div>
                    <div className={styles.mobileSide}><span className={`${styles.statusPill} ${styles[`is_${machine.connection_status}`]}`}><i />{statusLabel(machine.connection_status)}</span>{machine.fault_count ? <b>{machine.fault_count} fault{machine.fault_count === 1 ? '' : 's'}</b> : null}</div>
                    <div className={styles.mobileMeta}><span>{machine.serial_number ?? 'No serial'}</span><span>·</span><span>{transportLabel(machine)}</span><span>·</span><span>{contactAge(machine.last_contact)}</span></div>
                    <div className={styles.mobileProfile}><span className={`${styles.profilePill} ${styles[`profile_${machine.profile_status}`]}`}>{profileLabel(machine)}</span><small>{machine.reported_machine_interface ? machine.reported_machine_interface.toUpperCase() : 'Protocol not reported'}</small></div>
                  </Link>
                  <div className={styles.mobileActions}><Link href={`/machines/${machine.id}`}>Dashboard</Link>{machine.device_code ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(machine.device_code)}`}>Test Center</Link> : null}<Link href="/products">Mappings</Link></div>
                </article>
              ))}
            </div>
          </>}

          <footer className={styles.pagination}><span>Page {currentPage} of {pageCount}</span><div className={styles.pageButtons}><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><button disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div></footer>
        </section>
      </> : null}
    </section>
  );
}
