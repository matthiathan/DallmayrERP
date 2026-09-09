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
  fault_count: number;
  last_contact: string | null;
  connection_status: ConnectionStatus;
};

type FleetSummary = Record<ConnectionStatus, number> & { active_faults: number };
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

const TABLE_PAGE_SIZE = 75;
const EMPTY_SUMMARY: FleetSummary = { online: 0, delayed: 0, offline: 0, never: 0, unlinked: 0, active_faults: 0 };

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
    fault_count: Number(row.fault_count ?? 0),
    wifi_rssi: row.wifi_rssi === null || row.wifi_rssi === undefined ? null : Number(row.wifi_rssi),
    cellular_csq: row.cellular_csq === null || row.cellular_csq === undefined ? null : Number(row.cellular_csq),
  };
}

export function MachineFleetBrowser() {
  const [rows, setRows] = useState<MachineFleetRow[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [status, setStatus] = useState<'all' | ConnectionStatus>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [fleetTotal, setFleetTotal] = useState(0);
  const [summary, setSummary] = useState<FleetSummary>(EMPTY_SUMMARY);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadFleet = useCallback(async (quiet = false, pageOverride?: number) => {
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
      });
      setBranches((payload.branches ?? []).filter(Boolean));
      setLastUpdated(payload.generated_at ? new Date(payload.generated_at) : new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the machine fleet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branch, page, search, status]);

  useEffect(() => { loadFleet(false).catch(() => undefined); }, [loadFleet]);

  useEffect(() => {
    const interval = window.setInterval(() => loadFleet(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, [loadFleet]);

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

  return (
    <section className={styles.workspace} data-machine-browser="televend-v3">
      <header className={styles.header}>
        <div className={styles.headerCopy}><h1>Machines</h1><p>Live machine status, faults, connectivity and device assignment.</p></div>
        <div className={styles.headerActions}>
          <button className={styles.headerButton} disabled={refreshing} onClick={() => loadFleet(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <MachineCreateImportControls onChanged={refreshAll} />
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading machine fleet" /> : null}

      {!loading ? <>
        <section aria-label="Machine fleet status" className={styles.statusStrip}>
          <article className={`${styles.statusCard} ${styles.online}`}><span>Online</span><strong>{summary.online.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.delayed}`}><span>Delayed</span><strong>{summary.delayed.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.offline}`}><span>Offline</span><strong>{summary.offline.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.unlinked}`}><span>No device / never</span><strong>{(summary.unlinked + summary.never).toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.faults}`}><span>Active faults</span><strong>{summary.active_faults.toLocaleString('en-ZA')}</strong></article>
        </section>

        <section className={styles.filters} aria-label="Machine filters">
          <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search machines" placeholder="Search machine, serial, QR, site or device" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
          <label className={styles.filterLabel}><span>Branch</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
          <label className={styles.filterLabel}><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="all">All statuses</option><option value="online">Online</option><option value="delayed">Delayed</option><option value="offline">Offline</option><option value="never">Never connected</option><option value="unlinked">No device</option></select></label>
          <button className={styles.clearButton} onClick={clearFilters} type="button">Clear filters</button>
        </section>

        <section className={styles.listCard}>
          <header className={styles.listHeader}><strong>Machine overview</strong><span>{total.toLocaleString('en-ZA')} of {fleetTotal.toLocaleString('en-ZA')} machines · updated {lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></header>

          {total === 0 ? <div className={styles.empty}>No machines match the selected filters.</div> : <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr><th>Machine</th><th>Status</th><th>Location</th><th>Telemetry device</th><th>Network</th><th>Signal</th><th>Faults</th><th>Last contact</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>{rows.map((machine) => (
                  <tr key={machine.id}>
                    <td className={`${styles.machineCell} ${styles[`status_${machine.connection_status}`]}`}><Link className={styles.machineLink} href={`/machines/${machine.id}`}><strong>{titleFor(machine)}</strong><span>{machine.serial_number ?? 'No serial'} · QR {machine.machine_barcode ?? machine.asset_tag ?? '—'}</span></Link></td>
                    <td><span className={`${styles.statusPill} ${styles[`is_${machine.connection_status}`]}`}><i />{statusLabel(machine.connection_status)}</span></td>
                    <td><strong>{machine.site_name}</strong><div className={styles.secondary}>{machine.location}</div></td>
                    <td>{machine.device_id ? <><strong>{machine.device_code}</strong><div className={styles.secondary}>{machine.telemetry_mode ?? 'live'} · {machine.machine_status ?? 'unknown'}</div></> : <span className={styles.secondary}>Not assigned</span>}</td>
                    <td><div className={styles.network}><strong>{transportLabel(machine)}</strong><span className={styles.secondary}>{machine.cellular_operator ?? machine.firmware_version ?? '—'}</span></div></td>
                    <td>{machine.device_id ? <SignalStrengthIndicator cellularCsq={machine.cellular_csq} transport={machine.last_transport} wifiRssi={machine.wifi_rssi} /> : <span className={styles.secondary}>—</span>}</td>
                    <td>{machine.fault_count ? <span className={styles.faultCount}>{machine.fault_count}</span> : <span className={styles.noFaults}>Clear</span>}</td>
                    <td>{contactAge(machine.last_contact)}</td>
                    <td><Link className={styles.openLink} href={`/machines/${machine.id}`}>Open <NavigationIcon kind="chevron-right" /></Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            <div className={styles.mobileList}>
              {rows.map((machine) => (
                <Link className={`${styles.machineMobile} ${styles[`status_${machine.connection_status}`]}`} href={`/machines/${machine.id}`} key={machine.id}>
                  <div className={styles.mobileMain}><strong>{titleFor(machine)}</strong><span>{machine.site_name}</span><small>{machine.location}</small></div>
                  <div className={styles.mobileSide}><span className={`${styles.statusPill} ${styles[`is_${machine.connection_status}`]}`}><i />{statusLabel(machine.connection_status)}</span>{machine.fault_count ? <b>{machine.fault_count} fault{machine.fault_count === 1 ? '' : 's'}</b> : null}</div>
                  <div className={styles.mobileMeta}><span>{machine.serial_number ?? 'No serial'}</span><span>·</span><span>{transportLabel(machine)}</span><span>·</span><span>{contactAge(machine.last_contact)}</span></div>
                </Link>
              ))}
            </div>
          </>}

          <footer className={styles.pagination}><span>Page {currentPage} of {pageCount}</span><div className={styles.pageButtons}><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><button disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div></footer>
        </section>
      </> : null}
    </section>
  );
}
