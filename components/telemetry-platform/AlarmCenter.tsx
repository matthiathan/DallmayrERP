'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { AccessibleDialog } from '@/components/ui/AccessibleDialog';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { getSupabaseClient } from '@/lib/supabase/client';
import styles from './AlarmCenter.module.css';

type Fault = {
  id: string;
  machine_id: string | null;
  device_id: string | null;
  fault_code: string;
  severity: string;
  source: string;
  detail: string | null;
  started_at: string;
  last_seen_at: string;
  cleared_at: string | null;
};

type Machine = {
  id: string;
  machine_name: string | null;
  serial_number: string | null;
  branch: string;
  current_custodian: string | null;
};

type Device = {
  id: string;
  device_code: string;
};

type AlarmWorkflow = {
  fault_id: string;
  workflow_status: 'open' | 'acknowledged' | 'resolved';
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  assigned_to: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  updated_at: string;
};

type FilterStatus = 'active' | 'resolved' | 'all';
type WorkflowFilter = 'all' | 'unacknowledged' | 'acknowledged' | 'owned' | 'operator_resolved';
type TimeFilter = '24h' | '7d' | '30d';
type WorkflowAction = 'acknowledge' | 'unacknowledge' | 'take' | 'release' | 'resolve' | 'reopen';

const PAGE_SIZE = 75;
const LOOKUP_BATCH = 100;

function severityKey(value: string) {
  const severity = value.toLowerCase();
  if (severity === 'critical') return 'critical';
  if (severity === 'warning' || severity === 'medium') return 'warning';
  if (severity === 'connectivity') return 'connectivity';
  if (severity === 'info' || severity === 'low') return 'info';
  return 'fault';
}

function dateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function age(value: string) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function timeCutoff(filter: TimeFilter) {
  const hours = filter === '24h' ? 24 : filter === '7d' ? 24 * 7 : 24 * 30;
  return Date.now() - hours * 60 * 60 * 1000;
}

async function loadMachines(ids: string[]) {
  const client = getSupabaseClient();
  const rows: Machine[] = [];
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH) {
    const { data, error } = await client.from('machines').select('id,machine_name,serial_number,branch,current_custodian').in('id', ids.slice(offset, offset + LOOKUP_BATCH));
    if (error) throw error;
    rows.push(...((data ?? []) as Machine[]));
  }
  return rows;
}

async function loadDevices(ids: string[]) {
  const client = getSupabaseClient();
  const rows: Device[] = [];
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH) {
    const { data, error } = await client.from('telemetry_devices').select('id,device_code').in('id', ids.slice(offset, offset + LOOKUP_BATCH));
    if (error) throw error;
    rows.push(...((data ?? []) as Device[]));
  }
  return rows;
}

async function loadWorkflows(ids: string[]) {
  const client = getSupabaseClient();
  const rows: AlarmWorkflow[] = [];
  for (let offset = 0; offset < ids.length; offset += LOOKUP_BATCH) {
    const { data, error } = await client
      .from('telemetry_alarm_workflow')
      .select('fault_id,workflow_status,acknowledged_at,acknowledged_by,assigned_to,resolved_at,resolved_by,resolution_note,updated_at')
      .in('fault_id', ids.slice(offset, offset + LOOKUP_BATCH));
    if (error) throw error;
    rows.push(...((data ?? []) as AlarmWorkflow[]));
  }
  return rows;
}

function workflowLabel(workflow: AlarmWorkflow | undefined, currentUserId: string | null) {
  if (workflow?.workflow_status === 'resolved') return 'Operator resolved';
  if (workflow?.assigned_to && workflow.assigned_to === currentUserId) return 'Owned by you';
  if (workflow?.workflow_status === 'acknowledged') return 'Acknowledged';
  return 'Unacknowledged';
}

function occurrenceKey(fault: Fault) {
  return `${fault.machine_id ?? fault.device_id ?? 'unassigned'}:${fault.fault_code.toLowerCase()}`;
}

export function AlarmCenter() {
  const [faults, setFaults] = useState<Fault[]>([]);
  const [machines, setMachines] = useState<Record<string, Machine>>({});
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [workflows, setWorkflows] = useState<Record<string, AlarmWorkflow>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<FilterStatus>('active');
  const [severity, setSeverity] = useState('all');
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('all');
  const [branch, setBranch] = useState('all');
  const [source, setSource] = useState('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30d');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyFaultId, setBusyFaultId] = useState<string | null>(null);
  const [resolutionTarget, setResolutionTarget] = useState<Fault | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const { data, error: faultError } = await client
        .from('telemetry_fault_events')
        .select('id,machine_id,device_id,fault_code,severity,source,detail,started_at,last_seen_at,cleared_at')
        .gte('started_at', from.toISOString())
        .order('last_seen_at', { ascending: false })
        .limit(5000);
      if (faultError) throw faultError;
      const nextFaults = (data ?? []) as Fault[];
      const machineIds = Array.from(new Set(nextFaults.map((fault) => fault.machine_id).filter((value): value is string => Boolean(value))));
      const deviceIds = Array.from(new Set(nextFaults.map((fault) => fault.device_id).filter((value): value is string => Boolean(value))));
      const faultIds = nextFaults.map((fault) => fault.id);
      const [machineRows, deviceRows, workflowRows, authResult] = await Promise.all([
        loadMachines(machineIds),
        loadDevices(deviceIds),
        loadWorkflows(faultIds),
        client.auth.getUser(),
      ]);
      setFaults(nextFaults);
      setMachines(Object.fromEntries(machineRows.map((machine) => [machine.id, machine])));
      setDevices(Object.fromEntries(deviceRows.map((device) => [device.id, device])));
      setWorkflows(Object.fromEntries(workflowRows.map((workflow) => [workflow.fault_id, workflow])));
      setCurrentUserId(authResult.data.user?.id ?? null);
      setUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load alarms.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load().catch(() => undefined); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => load(true).catch(() => undefined), 30_000); return () => window.clearInterval(timer); }, [load]);

  const active = faults.filter((fault) => !fault.cleared_at);
  const resolved = faults.filter((fault) => fault.cleared_at);
  const critical = active.filter((fault) => severityKey(fault.severity) === 'critical').length;
  const unacknowledged = active.filter((fault) => !workflows[fault.id] || workflows[fault.id].workflow_status === 'open').length;
  const ownedByMe = currentUserId ? active.filter((fault) => workflows[fault.id]?.assigned_to === currentUserId && workflows[fault.id]?.workflow_status !== 'resolved').length : 0;
  const operatorResolved = faults.filter((fault) => workflows[fault.id]?.workflow_status === 'resolved').length;
  const resolvedRate = faults.length ? resolved.length / faults.length * 100 : 100;
  const activeRate = faults.length ? active.length / faults.length * 100 : 0;

  const severityCounts = active.reduce((counts, fault) => {
    const key = severityKey(fault.severity);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const maxSeverity = Math.max(1, ...Object.values(severityCounts));
  const branches = useMemo(() => Array.from(new Set(Object.values(machines).map((machine) => machine.branch).filter(Boolean))).sort(), [machines]);
  const sources = useMemo(() => Array.from(new Set(faults.map((fault) => fault.source).filter(Boolean))).sort(), [faults]);
  const occurrences = useMemo(() => faults.reduce((counts, fault) => {
    const key = occurrenceKey(fault);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>), [faults]);

  const filtered = useMemo(() => faults.filter((fault) => {
    if (new Date(fault.started_at).getTime() < timeCutoff(timeFilter)) return false;
    if (status === 'active' && fault.cleared_at) return false;
    if (status === 'resolved' && !fault.cleared_at) return false;
    const key = severityKey(fault.severity);
    if (severity !== 'all' && key !== severity) return false;
    if (source !== 'all' && fault.source !== source) return false;
    const machine = fault.machine_id ? machines[fault.machine_id] : null;
    if (branch !== 'all' && machine?.branch !== branch) return false;
    const workflow = workflows[fault.id];
    if (workflowFilter === 'unacknowledged' && workflow?.workflow_status && workflow.workflow_status !== 'open') return false;
    if (workflowFilter === 'acknowledged' && workflow?.workflow_status !== 'acknowledged') return false;
    if (workflowFilter === 'owned' && (!currentUserId || workflow?.assigned_to !== currentUserId || workflow?.workflow_status === 'resolved')) return false;
    if (workflowFilter === 'operator_resolved' && workflow?.workflow_status !== 'resolved') return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    const device = fault.device_id ? devices[fault.device_id] : null;
    return [fault.fault_code, fault.severity, fault.source, fault.detail, machine?.machine_name, machine?.serial_number, machine?.branch, machine?.current_custodian, device?.device_code, workflow?.resolution_note]
      .filter(Boolean).join(' ').toLowerCase().includes(term);
  }), [branch, currentUserId, devices, faults, machines, search, severity, source, status, timeFilter, workflowFilter, workflows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => setPage(1), [branch, search, severity, source, status, timeFilter, workflowFilter]);
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);

  const runWorkflowAction = async (faultId: string, action: WorkflowAction, note?: string) => {
    setBusyFaultId(faultId);
    setError(null);
    setNotice(null);
    try {
      const { data, error: actionError } = await getSupabaseClient().rpc('set_telemetry_alarm_workflow', {
        p_fault_id: faultId,
        p_action: action,
        p_note: note?.trim() || null,
      });
      if (actionError) throw actionError;
      const next = data as AlarmWorkflow;
      setWorkflows((current) => ({ ...current, [faultId]: next }));
      setNotice(action === 'resolve'
        ? 'Alarm workflow resolved. Live machine telemetry remains authoritative and is not altered.'
        : action === 'reopen' ? 'Alarm workflow reopened.' : 'Alarm workflow updated.');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Alarm workflow could not be updated.');
    } finally {
      setBusyFaultId(null);
    }
  };

  const submitResolution = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolutionTarget || resolutionNote.trim().length < 3) return;
    const target = resolutionTarget;
    await runWorkflowAction(target.id, 'resolve', resolutionNote);
    setResolutionTarget(null);
    setResolutionNote('');
  };

  const clearFilters = () => {
    setSearch('');
    setStatus('active');
    setSeverity('all');
    setWorkflowFilter('all');
    setBranch('all');
    setSource('all');
    setTimeFilter('30d');
  };

  return (
    <section className={styles.center} data-alarm-center="televend-v3">
      <header className={styles.header}><div><h1>Alarms & events</h1><p>Live machine faults, acknowledgement, ownership and auditable resolution workflow.</p></div><button disabled={refreshing} onClick={() => load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button></header>
      {error ? <div className={styles.error} role="alert">Alarm data unavailable: {error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {loading ? <HamsterLoader label="Loading alarm center" /> : null}

      {!loading ? <>
        <section className={styles.metrics} aria-label="Alarm status summary">
          <button className={`${styles.metric} ${styles.critical}`} onClick={() => { setStatus('active'); setWorkflowFilter('all'); }} type="button"><span>Active machine faults</span><strong>{active.length.toLocaleString('en-ZA')}</strong></button>
          <button className={`${styles.metric} ${styles.critical}`} onClick={() => { setStatus('active'); setSeverity('critical'); }} type="button"><span>Critical</span><strong>{critical.toLocaleString('en-ZA')}</strong></button>
          <button className={`${styles.metric} ${styles.warning}`} onClick={() => { setStatus('active'); setWorkflowFilter('unacknowledged'); }} type="button"><span>Unacknowledged</span><strong>{unacknowledged.toLocaleString('en-ZA')}</strong></button>
          <button className={`${styles.metric} ${styles.connectivity}`} onClick={() => { setStatus('active'); setWorkflowFilter('owned'); }} type="button"><span>Owned by me</span><strong>{ownedByMe.toLocaleString('en-ZA')}</strong></button>
          <button className={`${styles.metric} ${styles.resolved}`} onClick={() => { setStatus('resolved'); setWorkflowFilter('all'); }} type="button"><span>Machine cleared · 30d</span><strong>{resolved.length.toLocaleString('en-ZA')}</strong></button>
          <button className={`${styles.metric} ${styles.operator}`} onClick={() => { setStatus('all'); setWorkflowFilter('operator_resolved'); }} type="button"><span>Operator resolved</span><strong>{operatorResolved.toLocaleString('en-ZA')}</strong></button>
        </section>

        <section className={styles.analysis}>
          <article className={styles.card}><header className={styles.cardHeader}><div><span>Active alarm mix</span><h2>Severity distribution</h2></div><span>{active.length} open</span></header><div className={styles.barList}>{[
            ['Critical', severityCounts.critical ?? 0], ['Warning', severityCounts.warning ?? 0], ['Connectivity', severityCounts.connectivity ?? 0], ['Other', (severityCounts.fault ?? 0) + (severityCounts.info ?? 0)],
          ].map(([label, value]) => <div className={styles.barRow} key={String(label)}><span>{label}</span><div className={styles.track}><i style={{ width: `${Number(value) / maxSeverity * 100}%` }} /></div><b>{Number(value).toLocaleString('en-ZA')}</b></div>)}</div></article>
          <article className={styles.card}><header className={styles.cardHeader}><div><span>30-day machine lifecycle</span><h2>Active vs machine-cleared</h2></div><span>{faults.length} events</span></header><div className={styles.rings}><div className={styles.ringWrap}><div className={`${styles.ring} ${styles.red}`} style={{ '--ring': `${Math.max(2, activeRate)}%` } as CSSProperties}><div><strong>{active.length}</strong><span>Active</span></div></div></div><div className={styles.ringWrap}><div className={styles.ring} style={{ '--ring': `${Math.max(2, resolvedRate)}%` } as CSSProperties}><div><strong>{resolved.length}</strong><span>Cleared</span></div></div></div></div></article>
        </section>

        <section className={styles.filters} aria-label="Alarm filters">
          <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search alarms" placeholder="Search fault, machine, serial, device, detail or resolution note" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><span>Machine signal</span><select value={status} onChange={(event) => setStatus(event.target.value as FilterStatus)}><option value="active">Active</option><option value="resolved">Machine cleared</option><option value="all">All</option></select></label>
          <label><span>Workflow</span><select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value as WorkflowFilter)}><option value="all">All workflow states</option><option value="unacknowledged">Unacknowledged</option><option value="acknowledged">Acknowledged</option><option value="owned">Owned by me</option><option value="operator_resolved">Operator resolved</option></select></label>
          <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="connectivity">Connectivity</option><option value="fault">Fault</option><option value="info">Info</option></select></label>
          <label><span>Branch</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">All branches</option>{branches.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
          <label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>Period</span><select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
          <button onClick={clearFilters} type="button">Clear filters</button>
        </section>

        <section className={styles.tableCard}>
          <header className={styles.tableHead}><div><strong>Event console</strong><small>Operator workflow never overwrites the machine-generated fault state.</small></div><span>{filtered.length.toLocaleString('en-ZA')} events · updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></header>
          {!visible.length ? <div className={styles.empty}>No alarms match the selected filters.</div> : <>
            <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Severity</th><th>Machine</th><th>Fault</th><th>Machine state</th><th>Workflow</th><th>Last seen</th><th>Actions</th></tr></thead><tbody>{visible.map((fault) => {
              const machine = fault.machine_id ? machines[fault.machine_id] : null;
              const device = fault.device_id ? devices[fault.device_id] : null;
              const workflow = workflows[fault.id];
              const key = severityKey(fault.severity);
              const repeatCount = occurrences[occurrenceKey(fault)] ?? 1;
              const owned = Boolean(currentUserId && workflow?.assigned_to === currentUserId);
              const busy = busyFaultId === fault.id;
              return <tr key={fault.id}>
                <td><span className={`${styles.severity} ${styles[`sev_${key}`] ?? ''}`}>{fault.severity}</span></td>
                <td>{fault.machine_id ? <Link className={styles.machineLink} href={`/machines/${fault.machine_id}`}><strong>{machine?.machine_name ?? machine?.serial_number ?? 'Machine'}</strong><span className={styles.muted}>{machine?.current_custodian ?? machine?.branch?.toUpperCase() ?? 'Location unavailable'}</span></Link> : <span className={styles.muted}>Unassigned</span>}</td>
                <td><strong>{fault.fault_code}</strong><div className={styles.muted}>{fault.detail ?? fault.source}{repeatCount > 1 ? ` · ${repeatCount} occurrences / 30d` : ''}</div></td>
                <td><span className={`${styles.machineState} ${fault.cleared_at ? styles.machineCleared : styles.machineActive}`}>{fault.cleared_at ? `Cleared ${dateTime(fault.cleared_at)}` : 'Telemetry active'}</span></td>
                <td><span className={`${styles.workflowState} ${workflow?.workflow_status === 'resolved' ? styles.workflowResolved : workflow?.workflow_status === 'acknowledged' ? styles.workflowAcknowledged : styles.workflowOpen}`}>{workflowLabel(workflow, currentUserId)}</span>{workflow?.resolution_note ? <div className={styles.muted}>{workflow.resolution_note}</div> : null}{workflow?.workflow_status === 'resolved' && !fault.cleared_at ? <div className={styles.workflowWarning}>Machine fault still active</div> : null}</td>
                <td>{age(fault.last_seen_at)} ago<div className={styles.muted}>{dateTime(fault.last_seen_at)}</div></td>
                <td><div className={styles.rowActions}>
                  {workflow?.workflow_status === 'resolved' ? <button disabled={busy} onClick={() => void runWorkflowAction(fault.id, 'reopen')} type="button">Reopen</button> : <>
                    <button disabled={busy} onClick={() => void runWorkflowAction(fault.id, workflow?.workflow_status === 'acknowledged' ? 'unacknowledge' : 'acknowledge')} type="button">{workflow?.workflow_status === 'acknowledged' ? 'Unack' : 'Acknowledge'}</button>
                    <button disabled={busy} onClick={() => void runWorkflowAction(fault.id, owned ? 'release' : 'take')} type="button">{owned ? 'Release' : 'Take'}</button>
                    <button disabled={busy} onClick={() => { setResolutionTarget(fault); setResolutionNote(''); }} type="button">Resolve</button>
                  </>}
                  {fault.machine_id ? <Link href={`/machines/${fault.machine_id}`}>Machine</Link> : null}
                  {device?.device_code ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(device.device_code)}`}>Test Center</Link> : null}
                </div></td>
              </tr>;
            })}</tbody></table></div>

            <div className={styles.mobileList}>{visible.map((fault) => {
              const machine = fault.machine_id ? machines[fault.machine_id] : null;
              const device = fault.device_id ? devices[fault.device_id] : null;
              const workflow = workflows[fault.id];
              const key = severityKey(fault.severity);
              const repeatCount = occurrences[occurrenceKey(fault)] ?? 1;
              const owned = Boolean(currentUserId && workflow?.assigned_to === currentUserId);
              const busy = busyFaultId === fault.id;
              return <article className={`${styles.alarmMobile} ${styles[key] ?? ''}`} key={fault.id}>
                <div className={styles.alarmMain}><strong>{fault.fault_code}</strong><span>{machine?.machine_name ?? machine?.serial_number ?? 'Unassigned machine'}</span><small>{fault.detail ?? fault.source}{repeatCount > 1 ? ` · ${repeatCount} occurrences` : ''}</small></div>
                <div className={styles.alarmSide}><span className={`${styles.workflowState} ${workflow?.workflow_status === 'resolved' ? styles.workflowResolved : workflow?.workflow_status === 'acknowledged' ? styles.workflowAcknowledged : styles.workflowOpen}`}>{workflowLabel(workflow, currentUserId)}</span><small>{fault.cleared_at ? 'Machine cleared' : `${age(fault.last_seen_at)} ago`}</small></div>
                <div className={styles.alarmMeta}><span>{fault.severity}</span><span>·</span><span>{machine?.current_custodian ?? machine?.branch?.toUpperCase() ?? fault.source}</span>{workflow?.workflow_status === 'resolved' && !fault.cleared_at ? <b>· Machine fault still active</b> : null}</div>
                <div className={styles.mobileActions}>
                  {workflow?.workflow_status === 'resolved' ? <button disabled={busy} onClick={() => void runWorkflowAction(fault.id, 'reopen')} type="button">Reopen</button> : <><button disabled={busy} onClick={() => void runWorkflowAction(fault.id, workflow?.workflow_status === 'acknowledged' ? 'unacknowledge' : 'acknowledge')} type="button">{workflow?.workflow_status === 'acknowledged' ? 'Unack' : 'Acknowledge'}</button><button disabled={busy} onClick={() => void runWorkflowAction(fault.id, owned ? 'release' : 'take')} type="button">{owned ? 'Release' : 'Take'}</button><button disabled={busy} onClick={() => { setResolutionTarget(fault); setResolutionNote(''); }} type="button">Resolve</button></>}
                  {fault.machine_id ? <Link href={`/machines/${fault.machine_id}`}>Machine</Link> : null}
                  {device?.device_code ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(device.device_code)}`}>Test Center</Link> : null}
                </div>
              </article>;
            })}</div>
          </>}
          <footer className={styles.pagination}><span>Page {currentPage} of {pageCount}</span><div><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><button disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div></footer>
        </section>
      </> : null}

      <AccessibleDialog ariaLabel="Resolve alarm" className={styles.resolveDialog} id="resolve-telemetry-alarm-dialog" onClose={() => { if (!busyFaultId) { setResolutionTarget(null); setResolutionNote(''); } }} open={Boolean(resolutionTarget)} closeOnBackdrop={!busyFaultId}>
        <header><div><h2>Resolve alarm workflow</h2><p>This records an operator resolution. It does not clear the machine-generated telemetry fault.</p></div><button aria-label="Close resolve alarm dialog" disabled={Boolean(busyFaultId)} onClick={() => setResolutionTarget(null)} type="button">×</button></header>
        <form onSubmit={submitResolution}>
          <div className={styles.resolveBody}>
            <div className={styles.resolveFault}><span>Alarm</span><strong>{resolutionTarget?.fault_code ?? '—'}</strong><small>{resolutionTarget?.machine_id ? machines[resolutionTarget.machine_id]?.machine_name ?? machines[resolutionTarget.machine_id]?.serial_number ?? 'Machine' : 'Unassigned machine'}</small></div>
            <label><span>Resolution note</span><textarea data-dialog-initial-focus maxLength={1000} minLength={3} onChange={(event) => setResolutionNote(event.target.value)} placeholder="What was checked or done?" required rows={5} value={resolutionNote} /></label>
            {resolutionTarget && !resolutionTarget.cleared_at ? <div className={styles.resolveWarning}><strong>Telemetry fault is still active.</strong><span>The alarm remains visibly marked as machine-active until the vending machine reports recovery.</span></div> : null}
          </div>
          <footer><button disabled={Boolean(busyFaultId)} onClick={() => { setResolutionTarget(null); setResolutionNote(''); }} type="button">Cancel</button><button disabled={Boolean(busyFaultId) || resolutionNote.trim().length < 3} type="submit">{busyFaultId ? 'Saving…' : 'Resolve workflow'}</button></footer>
        </form>
      </AccessibleDialog>
    </section>
  );
}
