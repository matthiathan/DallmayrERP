'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './ArchiveWorkspace.module.css';

type ArchiveTab = 'machines' | 'devices';

type CustomerRelation = { customer_name: string | null; status: string | null };
type SiteRelation = { site_name: string | null; address: string | null; status: string | null };

type ArchivedMachine = {
  id: string;
  machine_name: string | null;
  model: string | null;
  manufacturer: string | null;
  customer_id: string | null;
  site_id: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  status: string;
  branch: string;
  updated_at: string | null;
  customers?: CustomerRelation | CustomerRelation[] | null;
  customer_sites?: SiteRelation | SiteRelation[] | null;
};

type ArchivedDevice = {
  id: string;
  device_code: string;
  hardware_uid: string | null;
  machine_id: string | null;
  site_id: string | null;
  status: string;
  firmware_version: string | null;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_transport: string | null;
  cellular_operator: string | null;
  machine_link_status: string | null;
  updated_at: string | null;
};

type AuditEvent = {
  id: string;
  action: string;
  summary: string | null;
  actor_role: string | null;
  created_at: string;
  before_payload: Record<string, unknown> | null;
  after_payload: Record<string, unknown> | null;
};

type ArchivePayload = {
  rows?: Array<ArchivedMachine | ArchivedDevice>;
  total?: number;
  summary?: {
    retired_machines?: number;
    retired_devices?: number;
    linked_retired_devices?: number;
  };
};

const ARCHIVE_PAGE_SIZE = 50;

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function machineName(machine: ArchivedMachine) {
  return machine.machine_name ?? machine.model ?? machine.serial_number ?? 'Unnamed machine';
}

function dateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ArchiveWorkspace() {
  const [tab, setTab] = useState<ArchiveTab>('machines');
  const [machines, setMachines] = useState<ArchivedMachine[]>([]);
  const [devices, setDevices] = useState<ArchivedDevice[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ retiredMachines: 0, retiredDevices: 0, linkedRetiredDevices: 0 });
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);

    try {
      const { data, error: archiveError } = await getSupabaseClient().rpc('get_telemetry_archive', {
        p_kind: tab,
        p_search: debouncedSearch,
        p_offset: page * ARCHIVE_PAGE_SIZE,
        p_limit: ARCHIVE_PAGE_SIZE,
      });
      if (archiveError) throw archiveError;
      const payload = (data ?? {}) as ArchivePayload;
      const rows = payload.rows ?? [];
      if (tab === 'machines') {
        const machineRows = rows as ArchivedMachine[];
        setMachines(machineRows);
        setDevices([]);
        setSelectedMachineId((current) => current && machineRows.some((item) => item.id === current) ? current : null);
        setSelectedDeviceId(null);
      } else {
        const deviceRows = rows as ArchivedDevice[];
        setDevices(deviceRows);
        setMachines([]);
        setSelectedDeviceId((current) => current && deviceRows.some((item) => item.id === current) ? current : null);
        setSelectedMachineId(null);
      }
      setTotal(Number(payload.total ?? 0));
      const nextSummary = payload.summary ?? {};
      setSummary({
        retiredMachines: Number(nextSummary.retired_machines ?? 0),
        retiredDevices: Number(nextSummary.retired_devices ?? 0),
        linkedRetiredDevices: Number(nextSummary.linked_retired_devices ?? 0),
      });
      setUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load archived records.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [debouncedSearch, page, tab]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => globalThis.clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(0); }, [debouncedSearch, tab]);
  useEffect(() => { void load(); }, [load]);

  const selectedMachine = selectedMachineId ? machines.find((item) => item.id === selectedMachineId) ?? null : null;
  const selectedDevice = selectedDeviceId ? devices.find((item) => item.id === selectedDeviceId) ?? null : null;

  const loadAudit = useCallback(async (entityType: string, entityId: string) => {
    setAuditLoading(true);
    const { data } = await getSupabaseClient()
      .from('audit_events')
      .select('id,action,summary,actor_role,created_at,before_payload,after_payload')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(40);
    setAuditEvents((data ?? []) as AuditEvent[]);
    setAuditLoading(false);
  }, []);

  useEffect(() => {
    if (selectedMachine) void loadAudit('machine', selectedMachine.id);
    else if (selectedDevice) void loadAudit('telemetry_device', selectedDevice.id);
    else setAuditEvents([]);
  }, [loadAudit, selectedDevice, selectedMachine]);


  const restoreMachine = async (machine: ArchivedMachine) => {
    const customer = firstRelation(machine.customers);
    const site = firstRelation(machine.customer_sites);
    if (!machine.machine_name || !machine.model || !machine.manufacturer || !machine.customer_id || !machine.serial_number || !machine.machine_barcode) {
      setError('This retired machine is missing required identity fields and cannot be reactivated through the existing machine-management workflow.');
      return;
    }
    if (customer?.status && customer.status !== 'active') {
      setError('The linked customer is not active. Reactivation is blocked by the existing machine-management workflow.');
      return;
    }
    if (site?.status && site.status !== 'active') {
      setError('The linked site is not active. Reactivation is blocked by the existing machine-management workflow.');
      return;
    }

    setRestoringId(machine.id);
    setError(null);
    setNotice(null);
    const { error: restoreError } = await getSupabaseClient().rpc('update_telemetry_machine', {
      p_machine_id: machine.id,
      p_machine_name: machine.machine_name,
      p_model: machine.model,
      p_manufacturer: machine.manufacturer,
      p_customer_id: machine.customer_id,
      p_site_id: machine.site_id,
      p_serial_number: machine.serial_number,
      p_machine_barcode: machine.machine_barcode,
      p_status: 'active',
    });

    if (restoreError) {
      setError(restoreError.message);
    } else {
      setNotice(`${machineName(machine)} was reactivated using the existing region-safe machine-management workflow.`);
      setSelectedMachineId(null);
      await load(true);
    }
    setRestoringId(null);
  };

  return (
    <section className={styles.workspace} data-archive-workspace="v1">
      <header className={styles.header}>
        <div><span>Fleet</span><h1>Archive</h1><p>Retired machines and telemetry devices, with operational history kept separate from destructive device deletion.</p></div>
        <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {loading ? <HamsterLoader label="Loading archived records" /> : <>
        <section className={styles.metrics}>
          <article><span>Retired machines</span><strong>{summary.retiredMachines}</strong><small>Machine status = retired</small></article>
          <article><span>Retired devices</span><strong>{summary.retiredDevices}</strong><small>Device status = retired</small></article>
          <article><span>Linked retired devices</span><strong>{summary.linkedRetiredDevices}</strong><small>Still reference a machine record</small></article>
          <article><span>Archive model</span><strong>Status-based</strong><small>No dedicated archive table yet</small></article>
        </section>

        <section className={styles.controls}>
          <nav aria-label="Archive types">
            <button aria-selected={tab === 'machines'} className={tab === 'machines' ? styles.activeTab : ''} onClick={() => { setTab('machines'); setPage(0); setSelectedDeviceId(null); }} type="button">Machines</button>
            <button aria-selected={tab === 'devices'} className={tab === 'devices' ? styles.activeTab : ''} onClick={() => { setTab('devices'); setPage(0); setSelectedMachineId(null); }} type="button">Telemetry Devices</button>
          </nav>
          <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === 'machines' ? 'Machine, serial, QR, customer, site or branch' : 'Device, UID, firmware or operator'} /></label>
          <span>Updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </section>

        {tab === 'machines' ? <section className={styles.tableCard}>
          <header><div><strong>Retired machines</strong><small>Reactivation is available only through the existing region-safe machine-management RPC and remains subject to its validation rules.</small></div><span>{total}</span></header>
          <div className={styles.tableScroll}><table><thead><tr><th>Machine</th><th>Customer / site</th><th>Serial / QR</th><th>Branch</th><th>Last updated</th><th /></tr></thead><tbody>
            {machines.map((machine) => <tr key={machine.id}>
              <td><strong>{machineName(machine)}</strong><small>{machine.manufacturer ?? 'Unknown brand'} · {machine.model ?? 'Unknown model'}</small></td>
              <td><strong>{firstRelation(machine.customers)?.customer_name ?? 'Not linked'}</strong><small>{firstRelation(machine.customer_sites)?.site_name ?? 'No site'}</small></td>
              <td><strong>{machine.serial_number ?? 'No serial'}</strong><small>{machine.machine_barcode ?? 'No QR code'}</small></td>
              <td>{machine.branch.toUpperCase()}</td>
              <td>{dateTime(machine.updated_at)}</td>
              <td><button onClick={() => setSelectedMachineId(machine.id)} type="button">Open</button></td>
            </tr>)}
          </tbody></table></div>
          {!total ? <div className={styles.empty}>No retired machines match this view.</div> : null}
        </section> : null}

        {tab === 'devices' ? <section className={styles.tableCard}>
          <header><div><strong>Retired telemetry devices</strong><small>Retired controllers remain visible for history. No safe device-reactivation RPC exists in the current production backend.</small></div><span>{total}</span></header>
          <div className={styles.tableScroll}><table><thead><tr><th>Device</th><th>Hardware UID</th><th>Firmware</th><th>Last network</th><th>Last contact</th><th>Last updated</th><th /></tr></thead><tbody>
            {devices.map((device) => <tr key={device.id}>
              <td><strong>{device.device_code}</strong><small>{device.machine_link_status ?? 'No link state'}</small></td>
              <td>{device.hardware_uid ?? 'Not recorded'}</td>
              <td>{device.firmware_version ?? 'Unknown'}</td>
              <td><strong>{device.last_transport === 'wifi' ? 'Wi-Fi' : device.last_transport === 'cellular' ? 'Cellular' : 'Not recorded'}</strong><small>{device.cellular_operator ?? ''}</small></td>
              <td>{dateTime(device.last_heartbeat_at ?? device.last_seen_at)}</td>
              <td>{dateTime(device.updated_at)}</td>
              <td><button onClick={() => setSelectedDeviceId(device.id)} type="button">Open</button></td>
            </tr>)}
          </tbody></table></div>
          {!total ? <div className={styles.empty}>No retired telemetry devices match this view.</div> : null}
        </section> : null}

        <nav className={styles.pagination} aria-label="Archive pages">
          <button disabled={page === 0 || refreshing} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">Previous</button>
          <span>Page {page + 1} of {Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE))}</span>
          <button disabled={(page + 1) * ARCHIVE_PAGE_SIZE >= total || refreshing} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>

        {(selectedMachine || selectedDevice) ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) { setSelectedMachineId(null); setSelectedDeviceId(null); } }} role="presentation">
          <aside className={styles.drawer} aria-label="Archived record details">
            <header>
              <div><span>Archived record</span><h2>{selectedMachine ? machineName(selectedMachine) : selectedDevice?.device_code}</h2><p>{selectedMachine ? 'Retired machine' : 'Retired telemetry device'}</p></div>
              <button onClick={() => { setSelectedMachineId(null); setSelectedDeviceId(null); }} type="button">×</button>
            </header>
            {selectedMachine ? <dl>
              <div><dt>Status</dt><dd>{selectedMachine.status}</dd></div>
              <div><dt>Serial</dt><dd>{selectedMachine.serial_number ?? 'Not recorded'}</dd></div>
              <div><dt>QR code</dt><dd>{selectedMachine.machine_barcode ?? 'Not recorded'}</dd></div>
              <div><dt>Customer</dt><dd>{firstRelation(selectedMachine.customers)?.customer_name ?? 'Not linked'}</dd></div>
              <div><dt>Site</dt><dd>{firstRelation(selectedMachine.customer_sites)?.site_name ?? 'Not linked'}</dd></div>
              <div><dt>Branch</dt><dd>{selectedMachine.branch.toUpperCase()}</dd></div>
              <div><dt>Last updated</dt><dd>{dateTime(selectedMachine.updated_at)}</dd></div>
            </dl> : null}
            {selectedDevice ? <dl>
              <div><dt>Status</dt><dd>{selectedDevice.status}</dd></div>
              <div><dt>Hardware UID</dt><dd>{selectedDevice.hardware_uid ?? 'Not recorded'}</dd></div>
              <div><dt>Firmware</dt><dd>{selectedDevice.firmware_version ?? 'Unknown'}</dd></div>
              <div><dt>Machine reference</dt><dd>{selectedDevice.machine_id ?? 'Not linked'}</dd></div>
              <div><dt>Last transport</dt><dd>{selectedDevice.last_transport ?? 'Not recorded'}</dd></div>
              <div><dt>Last contact</dt><dd>{dateTime(selectedDevice.last_heartbeat_at ?? selectedDevice.last_seen_at)}</dd></div>
              <div><dt>Last updated</dt><dd>{dateTime(selectedDevice.updated_at)}</dd></div>
            </dl> : null}
            <section className={styles.history}>
              <header><div><span>Audit trail</span><strong>Related recorded events</strong></div><small>{auditLoading ? 'Loading…' : `${auditEvents.length} events`}</small></header>
              <div>{auditEvents.map((event) => <article key={event.id}><div><strong>{event.action.replace(/_/g, ' ')}</strong><span>{dateTime(event.created_at)} · {event.actor_role ?? 'system'}</span></div><p>{event.summary ?? 'No event summary.'}</p></article>)}</div>
              {!auditLoading && !auditEvents.length ? <p className={styles.historyEmpty}>No matching audit events are currently recorded for this entity.</p> : null}
            </section>
            <section className={styles.safeguard}>
              <strong>History safeguard</strong>
              <p>The current backend represents archive state with <code>status = retired</code>. It does not store a dedicated archive reason, archive timestamp, disposition, or reactivation approval record, so those fields are not invented here.</p>
            </section>
            <footer>
              {selectedMachine ? <button disabled={restoringId === selectedMachine.id} onClick={() => void restoreMachine(selectedMachine)} type="button">{restoringId === selectedMachine.id ? 'Reactivating…' : 'Reactivate machine'}</button> : null}
              {selectedDevice ? <button disabled type="button">Device reactivation unavailable</button> : null}
              <Link href={selectedMachine ? `/machines/${selectedMachine.id}` : '/telemetry/devices'}>{selectedMachine ? 'Open machine record' : 'Open device management'}</Link>
            </footer>
          </aside>
        </div> : null}
      </>}
    </section>
  );
}
