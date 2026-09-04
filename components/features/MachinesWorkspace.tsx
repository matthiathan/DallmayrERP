'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { SignalStrengthIndicator } from '@/components/ui/SignalStrengthIndicator';
import { getSupabaseClient } from '@/lib/supabase/client';

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

type MachineView = MachineRecord & {
  siteName: string;
  location: string;
  device: DeviceState | null;
  connectionStatus: ConnectionStatus;
  faultCount: number;
  lastContact: string | null;
};

type OverviewPayload = { device_states?: DeviceState[]; active_faults?: FaultRecord[] };

type QueryError = { message: string };
type QueryPage = { data: unknown[] | null; error: QueryError | null };

const DATABASE_PAGE_SIZE = 1000;
const TABLE_PAGE_SIZE = 100;
const SITE_BATCH_SIZE = 100;

function machineTitle(machine: MachineRecord) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? machine.asset_tag ?? 'Unnamed machine';
}

function timeAgo(value: string | null) {
  if (!value) return 'Never connected';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDateTime(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function statusTone(status: ConnectionStatus) {
  if (status === 'online') return 'success';
  if (status === 'delayed') return 'warning';
  if (status === 'offline') return 'danger';
  return 'neutral';
}

async function loadAllMachines() {
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
  if (siteIds.length === 0) return [] as SiteRecord[];
  const client = getSupabaseClient();
  const rows: SiteRecord[] = [];
  for (let from = 0; from < siteIds.length; from += SITE_BATCH_SIZE) {
    const { data, error } = await client.from('customer_sites').select('id,site_name,address').in('id', siteIds.slice(from, from + SITE_BATCH_SIZE));
    if (error) throw error;
    rows.push(...((data ?? []) as SiteRecord[]));
  }
  return rows;
}

export function MachinesWorkspace() {
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

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const [machineRows, overviewResult] = await Promise.all([
        loadAllMachines(),
        client.rpc('get_telemetry_dashboard', { p_period: 'today', p_branch: 'all' }),
      ]);
      if (overviewResult.error) throw overviewResult.error;
      const siteIds = Array.from(new Set(machineRows.map((row) => row.site_id).filter((value): value is string => Boolean(value))));
      const siteRows = await loadSites(siteIds);
      const overview = (overviewResult.data ?? {}) as OverviewPayload;
      setMachines(machineRows);
      setSites(Object.fromEntries(siteRows.map((site) => [site.id, site])));
      setDevices((overview.device_states ?? []).map((device) => ({
        ...device,
        wifi_rssi: device.wifi_rssi === null || device.wifi_rssi === undefined ? null : Number(device.wifi_rssi),
        cellular_csq: device.cellular_csq === null || device.cellular_csq === undefined ? null : Number(device.cellular_csq),
      })));
      setFaults(overview.active_faults ?? []);
      setLastUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the machine register.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => load(true).catch(() => undefined), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const rows = useMemo<MachineView[]>(() => {
    const deviceByMachine = new Map(devices.filter((device) => device.machine_id).map((device) => [device.machine_id as string, device]));
    const faultCountByMachine = new Map<string, number>();
    faults.forEach((fault) => {
      if (!fault.machine_id) return;
      faultCountByMachine.set(fault.machine_id, (faultCountByMachine.get(fault.machine_id) ?? 0) + 1);
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
        faultCount: faultCountByMachine.get(machine.id) ?? 0,
        lastContact: device?.last_heartbeat_at ?? device?.last_seen_at ?? null,
      };
    });
  }, [devices, faults, machines, sites]);

  const filteredRows = useMemo(() => rows.filter((machine) => {
    if (branch !== 'all' && machine.branch !== branch) return false;
    if (status !== 'all' && machine.connectionStatus !== status) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [machineTitle(machine), machine.serial_number, machine.machine_barcode, machine.asset_tag, machine.model, machine.manufacturer, machine.siteName, machine.location, machine.device?.device_code].join(' ').toLowerCase().includes(term);
  }), [branch, rows, search, status]);

  const branches = Array.from(new Set(rows.map((row) => row.branch))).sort();
  const counts = rows.reduce((summary, row) => {
    summary[row.connectionStatus] += 1;
    return summary;
  }, { online: 0, delayed: 0, offline: 0, never: 0, unlinked: 0 } as Record<ConnectionStatus, number>);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE);

  useEffect(() => { setPage(1); }, [branch, search, status]);
  useEffect(() => { setPage((value) => Math.min(value, pageCount)); }, [pageCount]);

  return (
    <section className="fleet-workspace">
      <div className="fleet-main-column">
        <header className="fleet-page-heading">
          <div><h1>Machines</h1><p>Select any machine to open its own vend, telemetry, fault and data-usage dashboard.</p></div>
          <div className="fleet-heading-actions"><button className="fleet-button secondary" disabled={refreshing || loading} onClick={() => load(true)} type="button"><NavigationIcon kind="telemetry" />{refreshing ? 'Refreshing…' : 'Refresh data'}</button><Link className="fleet-button" href="/telemetry/devices"><NavigationIcon kind="settings" />Manage devices</Link></div>
        </header>

        {error ? <div className="fleet-banner is-error" role="alert"><strong>Machines could not be loaded.</strong><span>{error}</span></div> : null}
        {loading ? <HamsterLoader label="Loading machines" /> : null}

        {!loading ? <>
          <section className="fleet-metric-grid" aria-label="Machine fleet status">
            <article className="fleet-metric-card"><span className="fleet-metric-icon is-blue"><NavigationIcon kind="tool" /></span><div><span>Total machines</span><strong>{rows.length.toLocaleString('en-ZA')}</strong></div><small>Machine register</small></article>
            <article className="fleet-metric-card"><span className="fleet-metric-icon is-green"><NavigationIcon kind="telemetry" /></span><div><span>Online</span><strong>{counts.online.toLocaleString('en-ZA')}</strong></div><small>Heartbeat within 30 minutes</small></article>
            <article className="fleet-metric-card"><span className="fleet-metric-icon is-grey"><NavigationIcon kind="telemetry" /></span><div><span>Offline</span><strong>{counts.offline.toLocaleString('en-ZA')}</strong></div><small>{counts.delayed} delayed · {counts.never} never connected</small></article>
            <article className="fleet-metric-card"><span className="fleet-metric-icon is-amber"><NavigationIcon kind="settings" /></span><div><span>No device</span><strong>{counts.unlinked.toLocaleString('en-ZA')}</strong></div><small>Awaiting telemetry assignment</small></article>
            <article className="fleet-metric-card"><span className="fleet-metric-icon is-red"><NavigationIcon kind="bell" /></span><div><span>Active faults</span><strong>{faults.length.toLocaleString('en-ZA')}</strong></div><small>Current unresolved telemetry faults</small></article>
          </section>

          <section className="fleet-panel fleet-table-panel">
            <header className="fleet-table-heading"><div><span>Fleet register</span><h2>Machines and connected telemetry</h2></div><span>{filteredRows.length.toLocaleString('en-ZA')} of {rows.length.toLocaleString('en-ZA')} machines</span></header>
            <div className="fleet-filters">
              <label className="fleet-search"><NavigationIcon kind="search" /><input aria-label="Search machines" placeholder="Search asset, serial, QR, site or device" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <label><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
              <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="online">Online</option><option value="delayed">Delayed</option><option value="offline">Offline</option><option value="never">Never connected</option><option value="unlinked">No device</option></select></label>
              <button className="fleet-button secondary" onClick={() => { setSearch(''); setBranch('all'); setStatus('all'); }} type="button">Clear filters</button>
            </div>

            {filteredRows.length === 0 ? <div className="fleet-empty-state"><strong>No machines match these filters</strong><p>Clear a filter or search for another machine, serial number, QR number or telemetry device.</p></div> : <div className="fleet-table-scroll"><table className="fleet-machine-table"><thead><tr><th>Status</th><th>Machine</th><th>Identifiers</th><th>Location</th><th>Telemetry device</th><th>Network</th><th>Signal</th><th>Errors</th><th>Last contact</th><th><span className="sr-only">Dashboard</span></th></tr></thead><tbody>{visibleRows.map((machine) => <tr key={machine.id}><td><span className={`fleet-status-pill is-${statusTone(machine.connectionStatus)}`}><i />{statusLabel(machine.connectionStatus)}</span></td><td><Link className="fleet-machine-link" href={`/machines/${machine.id}`}><strong>{machineTitle(machine)}</strong><span>{machine.model ?? 'No model'} · {machine.manufacturer ?? 'No manufacturer'} · {machine.status}</span></Link></td><td><strong>{machine.serial_number ?? 'No serial'}</strong><span>QR {machine.machine_barcode ?? machine.asset_tag ?? 'not recorded'}</span></td><td><strong>{machine.siteName}</strong><span>{machine.location}</span></td><td>{machine.device ? <><strong>{machine.device.device_code}</strong><span>{machine.device.telemetry_mode} · {machine.device.machine_status}</span></> : <><strong>Not connected</strong><span>Assign a telemetry device</span></>}</td><td><strong>{machine.device?.last_transport === 'cellular' ? 'Cellular' : machine.device?.last_transport === 'wifi' ? 'Wi-Fi' : 'Not reported'}</strong><span>{machine.device?.cellular_operator ?? ''}</span></td><td>{machine.device ? <SignalStrengthIndicator cellularCsq={machine.device.cellular_csq} compact transport={machine.device.last_transport} wifiRssi={machine.device.wifi_rssi} /> : '—'}</td><td><span className={`fleet-error-count ${machine.faultCount ? 'has-errors' : ''}`}>{machine.faultCount}</span></td><td><strong>{timeAgo(machine.lastContact)}</strong><span>{formatDateTime(machine.lastContact)}</span></td><td><Link aria-label={`Open ${machineTitle(machine)} dashboard`} className="fleet-row-action" href={`/machines/${machine.id}`}><NavigationIcon kind="chevron-right" /></Link></td></tr>)}</tbody></table></div>}
            <footer className="fleet-table-footer"><div className="fleet-table-footer-copy"><strong>Showing {filteredRows.length ? (currentPage - 1) * TABLE_PAGE_SIZE + 1 : 0}–{Math.min(currentPage * TABLE_PAGE_SIZE, filteredRows.length)} of {filteredRows.length.toLocaleString('en-ZA')}</strong><span>Updated {lastUpdated ? timeAgo(lastUpdated.toISOString()) : 'never'} · Select a machine name or arrow to open its dashboard.</span></div><div className="fleet-table-pagination"><button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><span>Page {currentPage} of {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div></footer>
          </section>
        </> : null}
      </div>
    </section>
  );
}
