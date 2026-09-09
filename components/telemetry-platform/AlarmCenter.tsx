'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
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

type FilterStatus = 'active' | 'resolved' | 'all';
const PAGE_SIZE = 75;
const MACHINE_BATCH = 100;

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

async function loadMachines(ids: string[]) {
  const client = getSupabaseClient();
  const rows: Machine[] = [];
  for (let offset = 0; offset < ids.length; offset += MACHINE_BATCH) {
    const { data, error } = await client.from('machines').select('id,machine_name,serial_number,branch,current_custodian').in('id', ids.slice(offset, offset + MACHINE_BATCH));
    if (error) throw error;
    rows.push(...((data ?? []) as Machine[]));
  }
  return rows;
}

export function AlarmCenter() {
  const [faults, setFaults] = useState<Fault[]>([]);
  const [machines, setMachines] = useState<Record<string, Machine>>({});
  const [status, setStatus] = useState<FilterStatus>('active');
  const [severity, setSeverity] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const { data, error: faultError } = await getSupabaseClient()
        .from('telemetry_fault_events')
        .select('id,machine_id,device_id,fault_code,severity,source,detail,started_at,last_seen_at,cleared_at')
        .gte('started_at', from.toISOString())
        .order('last_seen_at', { ascending: false })
        .limit(5000);
      if (faultError) throw faultError;
      const nextFaults = (data ?? []) as Fault[];
      const machineIds = Array.from(new Set(nextFaults.map((fault) => fault.machine_id).filter((value): value is string => Boolean(value))));
      const machineRows = await loadMachines(machineIds);
      setFaults(nextFaults);
      setMachines(Object.fromEntries(machineRows.map((machine) => [machine.id, machine])));
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
  const warning = active.filter((fault) => severityKey(fault.severity) === 'warning').length;
  const connectivity = active.filter((fault) => severityKey(fault.severity) === 'connectivity').length;
  const affected = new Set(active.map((fault) => fault.machine_id).filter(Boolean)).size;
  const resolvedRate = faults.length ? resolved.length / faults.length * 100 : 100;
  const activeRate = faults.length ? active.length / faults.length * 100 : 0;

  const severityCounts = active.reduce((counts, fault) => {
    const key = severityKey(fault.severity);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const maxSeverity = Math.max(1, ...Object.values(severityCounts));

  const filtered = useMemo(() => faults.filter((fault) => {
    if (status === 'active' && fault.cleared_at) return false;
    if (status === 'resolved' && !fault.cleared_at) return false;
    const key = severityKey(fault.severity);
    if (severity !== 'all' && key !== severity) return false;
    const machine = fault.machine_id ? machines[fault.machine_id] : null;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return [fault.fault_code, fault.severity, fault.source, fault.detail, machine?.machine_name, machine?.serial_number, machine?.branch, machine?.current_custodian]
      .filter(Boolean).join(' ').toLowerCase().includes(term);
  }), [faults, machines, search, severity, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => setPage(1), [search, severity, status]);
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);

  return (
    <section className={styles.center} data-alarm-center="televend-v3">
      <header className={styles.header}><div><h1>Alarms & events</h1><p>Current machine exceptions and 30-day alarm history.</p></div><button disabled={refreshing} onClick={() => load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button></header>
      {error ? <div className={styles.error} role="alert">Alarm data unavailable: {error}</div> : null}
      {loading ? <HamsterLoader label="Loading alarm center" /> : null}

      {!loading ? <>
        <section className={styles.metrics} aria-label="Alarm status summary">
          <article className={`${styles.metric} ${styles.critical}`}><span>Active alarms</span><strong>{active.length.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.metric} ${styles.critical}`}><span>Critical</span><strong>{critical.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.metric} ${styles.warning}`}><span>Warnings</span><strong>{warning.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.metric} ${styles.connectivity}`}><span>Machines affected</span><strong>{affected.toLocaleString('en-ZA')}</strong></article>
          <article className={`${styles.metric} ${styles.resolved}`}><span>Resolved · 30d</span><strong>{resolved.length.toLocaleString('en-ZA')}</strong></article>
        </section>

        <section className={styles.analysis}>
          <article className={styles.card}><header className={styles.cardHeader}><div><span>Active alarm mix</span><h2>Severity distribution</h2></div><span>{active.length} open</span></header><div className={styles.barList}>{[
            ['Critical', severityCounts.critical ?? 0], ['Warning', severityCounts.warning ?? 0], ['Connectivity', severityCounts.connectivity ?? 0], ['Other', (severityCounts.fault ?? 0) + (severityCounts.info ?? 0)],
          ].map(([label, value]) => <div className={styles.barRow} key={String(label)}><span>{label}</span><div className={styles.track}><i style={{ width: `${Number(value) / maxSeverity * 100}%` }} /></div><b>{Number(value).toLocaleString('en-ZA')}</b></div>)}</div></article>
          <article className={styles.card}><header className={styles.cardHeader}><div><span>30-day lifecycle</span><h2>Raised vs resolved</h2></div><span>{faults.length} events</span></header><div className={styles.rings}><div className={styles.ringWrap}><div className={`${styles.ring} ${styles.red}`} style={{ '--ring': `${Math.max(2, activeRate)}%` } as CSSProperties}><div><strong>{active.length}</strong><span>Open</span></div></div></div><div className={styles.ringWrap}><div className={styles.ring} style={{ '--ring': `${Math.max(2, resolvedRate)}%` } as CSSProperties}><div><strong>{resolved.length}</strong><span>Resolved</span></div></div></div></div></article>
        </section>

        <section className={styles.filters} aria-label="Alarm filters">
          <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search alarms" placeholder="Search fault, machine, serial or detail" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as FilterStatus)}><option value="active">Active</option><option value="resolved">Resolved</option><option value="all">All 30 days</option></select></label>
          <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="connectivity">Connectivity</option><option value="fault">Fault</option><option value="info">Info</option></select></label>
          <button onClick={() => { setSearch(''); setStatus('active'); setSeverity('all'); }} type="button">Clear filters</button>
        </section>

        <section className={styles.tableCard}>
          <header className={styles.tableHead}><strong>Event console</strong><span>{filtered.length.toLocaleString('en-ZA')} events · updated {updated ? updated.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></header>
          {!visible.length ? <div className={styles.empty}>No alarms match the selected filters.</div> : <>
            <div className={styles.scroll}><table className={styles.table}><thead><tr><th>Severity</th><th>Machine</th><th>Fault</th><th>Source</th><th>Started</th><th>Last seen</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{visible.map((fault) => {
              const machine = fault.machine_id ? machines[fault.machine_id] : null;
              const key = severityKey(fault.severity);
              return <tr key={fault.id}><td><span className={`${styles.severity} ${styles[`sev_${key}`] ?? ''}`}>{fault.severity}</span></td><td>{fault.machine_id ? <Link className={styles.machineLink} href={`/machines/${fault.machine_id}`}><strong>{machine?.machine_name ?? machine?.serial_number ?? 'Machine'}</strong><span className={styles.muted}>{machine?.current_custodian ?? machine?.branch?.toUpperCase() ?? 'Location unavailable'}</span></Link> : <span className={styles.muted}>Unassigned</span>}</td><td><strong>{fault.fault_code}</strong><div className={styles.muted}>{fault.detail ?? 'No detail'}</div></td><td>{fault.source}</td><td>{dateTime(fault.started_at)}</td><td>{age(fault.last_seen_at)} ago</td><td>{fault.cleared_at ? `Resolved ${dateTime(fault.cleared_at)}` : 'Active'}</td><td>{fault.machine_id ? <Link className={styles.open} href={`/machines/${fault.machine_id}`}>Open ›</Link> : null}</td></tr>;
            })}</tbody></table></div>
            <div className={styles.mobileList}>{visible.map((fault) => {
              const machine = fault.machine_id ? machines[fault.machine_id] : null;
              const key = severityKey(fault.severity);
              const content = <><div className={styles.alarmMain}><strong>{fault.fault_code}</strong><span>{machine?.machine_name ?? machine?.serial_number ?? 'Unassigned machine'}</span><small>{fault.detail ?? fault.source}</small></div><div className={styles.alarmSide}>{fault.cleared_at ? 'Resolved' : 'Active'}<br />{age(fault.last_seen_at)} ago</div><div className={styles.alarmMeta}><span>{fault.severity}</span><span>·</span><span>{machine?.current_custodian ?? machine?.branch?.toUpperCase() ?? fault.source}</span></div></>;
              return fault.machine_id ? <Link className={`${styles.alarmMobile} ${styles[key] ?? ''}`} href={`/machines/${fault.machine_id}`} key={fault.id}>{content}</Link> : <div className={`${styles.alarmMobile} ${styles[key] ?? ''}`} key={fault.id}>{content}</div>;
            })}</div>
          </>}
          <footer className={styles.pagination}><span>Page {currentPage} of {pageCount}</span><div><button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Previous</button><button disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Next</button></div></footer>
        </section>
      </> : null}
    </section>
  );
}
