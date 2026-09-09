'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MachineCreateImportControls } from '@/components/features/MachineCreateImportControls';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './MachineFleetBrowser.module.css';

type ConnectionStatus = 'online' | 'delayed' | 'offline' | 'never' | 'unlinked';

type MachineRecord = {
  id: string;
  branch: string;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  machine_name: string | null;
  model: string | null;
  status: string;
  current_custodian: string | null;
  manufacturer: string | null;
};

type SiteRecord = { id: string; site_name: string | null; address: string | null };
type DeviceState = {
  device_id: string;
  device_code: string;
  machine_id: string | null;
  device_status: string;
  telemetry_mode: 'live' | 'daily' | 'monthly';
  machine_status: string;
  last_transport: 'wifi' | 'cellular' | null;
  wifi_rssi: number | null;
  cellular_csq: number | null;
  cellular_operator: string | null;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
};

type FaultRecord = { id: string; machine_id: string | null };
type OverviewPayload = { device_states?: DeviceState[]; active_faults?: FaultRecord[] };
type MachineView = MachineRecord & {
  siteName: string;
  location: string;
  device: DeviceState | null;
  connectionStatus: ConnectionStatus;
  faultCount: number;
  lastContact: string | null;
};

type QueryPage = { data: unknown[] | null; error: { message: string } | null };

const DATABASE_PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 75;
const SITE_BATCH_SIZE = 100;

function titleFor(machine: MachineRecord) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.asset_tag ?? 'Unnamed machine';
}

function connectionStatus(device: DeviceState | null): ConnectionStatus {
  if (!device) return 'unlinked';
  const contact = device.last_heartbeat_at ?? device.last_seen_at;
  if (!contact) return 'never';
  const age = Date.now() - new Date(contact).getTime();
  if (age <= 30 * 60 * 1000) return 'online';
  if (age <= 24 * 60 * 60 * 1000) return 'delayed';
  return 'offline';
}

function statusLabel(status: ConnectionStatus) {
  if (status === 'unlinked') return 'No device';
  if (status === 'never') return 'Never connected';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function transportLabel(device: DeviceState | null) {
  if (!device?.last_transport) return 'Not reported';
  return device.last_transport === 'wifi' ? 'Wi-Fi' : 'Cellular';
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

async function loadMachineMaster() {
  const client = getSupabaseClient();
  const rows: MachineRecord[] = [];
  for (let from = 0; ; from += DATABASE_PAGE_SIZE) {
    const result = await client
      .from('machines')
      .select('id,branch,site_id,serial_number,machine_barcode,asset_tag,machine_name,model,status,current_custodian,manufacturer')
      .order('machine_name', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, from + DATABASE_PAGE_SIZE - 1) as QueryPage;
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as MachineRecord[];
    rows.push(...page);
    if (page.length < DATABASE_PAGE_SIZE) break;
  }
  return rows;
}

async function loadSites(siteIds: string[]) {
  if (!siteIds.length) return [] as SiteRecord[];
  const client = getSupabaseClient();
  const rows: SiteRecord[] = [];
  for (let offset = 0; offset < siteIds.length; offset += SITE_BATCH_SIZE) {
    const { data, error } = await client.from('customer_sites').select('id,site_name,address').in('id', siteIds.slice(offset, offset + SITE_BATCH_SIZE));
    if (error) throw error;
    rows.push(...((data ?? []) as SiteRecord[]));
  }
  return rows;
}

export function MachineFleetBrowser() {
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [sites, setSites] = useState<Record<string, SiteRecord>>({});
  const [devices, setDevices] = useState<DeviceState[]>([]);
  const [faults, setFaults] = useState<FaultRecord[]>([]);
  const [search, setSearch] = useState('');
  const [branch, setBranch] = useState('all');
  const [status, setStatus] = useState<'all' | ConnectionStatus>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadTelemetry = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const { data, error: telemetryError } = await getSupabaseClient().rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' });
      if (telemetryError) throw telemetryError;
      const payload = (data ?? {}) as OverviewPayload;
      setDevices((payload.device_states ?? []).map((device) => ({
        ...device,
        wifi_rssi: device.wifi_rssi === null || device.wifi_rssi === undefined ? null : Number(device.wifi_rssi),
        cellular_csq: device.cellular_csq === null || device.cellular_csq === undefined ? null : Number(device.cellular_csq),
      })));
      setFaults(payload.active_faults ?? []);
      setLastUpdated(new Date());
    } finally {
      if (quiet) setRefreshing(false);
    }
  }, []);

  const loadStatic = useCallback(async () => {
    const machineRows = await loadMachineMaster();
    const siteIds = Array.from(new Set(machineRows.map((row) => row.site_id).filter((value): value is string => Boolean(value))));
    const siteRows = await loadSites(siteIds);
    setMachines(machineRows);
    setSites(Object.fromEntries(siteRows.map((site) => [site.id, site])));
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadStatic(), loadTelemetry(false)]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the machine fleet.');
    } finally {
      setLoading(false);
    }
  }, [loadStatic, loadTelemetry]);

  useEffect(() => { loadInitial().catch(() => undefined); }, [loadInitial]);
  useEffect(() => {
    const interval = window.setInterval(() => loadTelemetry(true).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not refresh telemetry status.');
    }), 30_000);
    return () => window.clearInterval(interval);
  }, [loadTelemetry]);

  const rows = useMemo<MachineView[]>(() => {
    const deviceByMachine = new Map(devices.filter((device) => device.machine_id).map((device) => [device.machine_id as string, device]));
    const faultCount = new Map<string, number>();
    faults.forEach((fault) => {
      if (!fault.machine_id) return;
      faultCount.set(fault.machine_id, (faultCount.get(fault.machine_id) ?? 0) + 1);
    });

    return machines.map((machine) => {
      const device = deviceByMachine.get(machine.id) ?? null;
      const site = machine.site_id ? sites[machine.site_id] : null;
      return {
        ...machine,
        siteName: site?.site_name ?? 'Unassigned site',
        location: site?.address ?? machine.current_custodian ?? machine.branch.toUpperCase(),
        device,
        connectionStatus: connectionStatus(device),
        faultCount: faultCount.get(machine.id) ?? 0,
        lastContact: device?.last_heartbeat_at ?? device?.last_seen_at ?? null,
      };
    });
  }, [devices, faults, machines, sites]);

  const branches = useMemo(() => Array.from(new Set(rows.map((row) => row.branch))).sort(), [rows]);
  const filtered = useMemo(() => rows.filter((machine) => {
    if (branch !== 'all' && machine.branch !== branch) return false;
    if (status !== 'all' && machine.connectionStatus !== status) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [titleFor(machine), machine.serial_number, machine.machine_barcode, machine.asset_tag, machine.model, machine.manufacturer, machine.siteName, machine.location, machine.device?.device_code]
      .join(' ')
      .toLowerCase()
      .includes(term);
  }), [branch, rows, search, status]);

  const counts = rows.reduce((acc, machine) => {
    acc[machine.connectionStatus] += 1;
    return acc;
  }, { online: 0, delayed: 0, offline: 0, never: 0, unlinked: 0 } as Record<ConnectionStatus, number>);

  const pageCount = Math.max(1, Math.ceil(filtered.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  useEffect(() => setPage(1), [branch, search, status]);
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);

  const refreshAll = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await Promise.all([loadStatic(), loadTelemetry(false)]);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh the machine fleet.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className={styles.workspace} data-machine-browser="televend-v3">
      <header className={styles.header}>
        <div className={styles.headerCopy}><h1>Machines</h1><p>Live machine status, faults, connectivity and device assignment.</p></div>
        <div className={styles.headerActions}>
          <button className={styles.headerButton} disabled={refreshing} onClick={() => refreshAll()} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <MachineCreateImportControls onChanged={refreshAll} />
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {loading ? <HamsterLoader label="Loading machine fleet" /> : null}

      {!loading ? <>
        <section aria-label="Machine fleet status" className={styles.statusStrip}>
          <article className={`${styles.statusCard} ${styles.online}`}><span>Online</span><strong>{counts.online.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.delayed}`}><span>Delayed</span><strong>{counts.delayed.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.offline}`}><span>Offline</span><strong>{counts.offline.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.unlinked}`}><span>No device / never</span><strong>{(counts.unlinked + counts.never).toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.statusCard} ${styles.faults}`}><span>Active faults</span><strong>{faults.length.toLocaleString('en-ZA')}</strong></article>
        </section>

        <section className={styles.filters} aria-label="Machine filters">
          <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search machines" placeholder="Search machine, serial, QR, site or device" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className={styles.filterLabel}><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
          <label className={styles.filterLabel}><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="online">Online</option><option value="delayed">Delayed</option><option value="offline">Offline</option><option value="never">Never connected</option><option value="unlinked">No device</option></select></label>
          <button className={styles.clearButton} onClick={() => { setSearch(''); setBranch('all'); setStatus('all'); }} type="button">Clear filters</button>
        </section>

        <section className={styles.listCard}>
          <header className={styles.listHeader}><strong>Machine overview</strong><span>{filtered.length.toLocaleString('en-ZA')} of {rows.length.toLocaleString('en-ZA')} machines · updated {lastUpdated ? lastUpdated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></header>

          {filtered.length === 0 ? <div className={styles.empty}>No machines match the selected filters.</div> : <>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr><th>Machine</th><th>Status</th><th>Location</th><th>Telemetry device</th><th>Network</th><th>Signal</th><th>Faults</th><th>Last contact</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>{visible.map((machine) => (
                  <tr key={machine.id}>
                    <td className={`${styles.machineCell} ${styles[`status_${machine.connectionStatus}`]}`}><Link className={styles.machineLink} href={`/machines/${machine.id}`}><strong>{titleFor(machine)}</strong><span>{machine.serial_number ?? 'No serial'} · QR {machine.machine_barcode ?? machine.asset_tag ?? '—'}</span></Link></td>
                    <td><span className={`${styles.statusPill} ${styles[`is_${machine.connectionStatus}`]}`}><i />{statusLabel(machine.connectionStatus)}</span></td>
                    <td><strong>{machine.siteName}</strong><div className={styles.secondary}>{machine.location}</div></td>
                    <td>{machine.device ? <><strong>{machine.device.device_code}</strong><div className={styles.secondary}>{machine.device.telemetry_mode} · {machine.device.machine_status}</div></> : <span className={styles.secondary}>Not assigned</span>}</td>
                    <td><div className={styles.network}><strong>{transportLabel(machine.device)}</strong><span className={styles.secondary}>{machine.device?.cellular_operator ?? machine.device?.firmware_version ?? '—'}</span></div></td>
                    <td>{machine.device ? <SignalStrengthIndicator cellularCsq={machine.device.cellular_csq} transport={machine.device.last_transport} wifiRssi={machine.device.wifi_rssi} /> : <span className={styles.secondary}>—</span>}</td>
                    <td>{machine.faultCount ? <span className={styles.faultCount}>{machine.faultCount}</span> : <span className={styles.noFaults}>Clear</span>}</td>
                    <td>{contactAge(machine.lastContact)}</td>
                    <td><Link className={styles.openLink} href={`/machines/${machine.id}`}>Open <NavigationIcon kind="chevron-right" /></Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            <div className={styles.mobileList}>
              {visible.map((machine) => (
                <Link className={`${styles.machineMobile} ${styles[`status_${machine.connectionStatus}`]}`} href={`/machines/${machine.id}`} key={machine.id}>
                  <div className={styles.mobileMain}><strong>{titleFor(machine)}</strong><span>{machine.siteName}</span><small>{machine.location}</small></div>
                  <div className={styles.mobileSide}><span className={`${styles.statusPill} ${styles[`is_${machine.connectionStatus}`]}`}><i />{statusLabel(machine.connectionStatus)}</span>{machine.faultCount ? <b>{machine.faultCount} fault{machine.faultCount === 1 ? '' : 's'}</b> : null}</div>
                  <div className={styles.mobileMeta}><span>{machine.serial_number ?? 'No serial'}</span><span>·</span><span>{transportLabel(machine.device)}</span><span>·</span><span>{contactAge(machine.lastContact)}</span></div>
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
