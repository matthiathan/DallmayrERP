'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { ServiceJobRecord, ServiceJobStatus } from '@/types/enterprise-records';
import styles from './TechnicianFieldWorkspace.module.css';

type CustomerRelation = { customer_name: string | null };
type MachineRelation = {
  machine_name: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  manufacturer: string | null;
  model: string | null;
};

type Job = ServiceJobRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
};

type Site = {
  id: string;
  site_name: string;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

type Device = {
  id: string;
  machine_id: string | null;
  device_code: string;
  last_seen_at: string | null;
  last_heartbeat_at: string | null;
  last_transport: 'wifi' | 'cellular' | null;
  firmware_version: string | null;
  cellular_operator: string | null;
};

type Fault = { machine_id: string | null; severity: string | null; fault_code: string; canonical_title: string | null };

type CompletionOutcome = 'completed' | 'follow_up_required' | 'parts_required' | 'customer_unavailable';

const terminalStatuses: ServiceJobStatus[] = ['completed', 'verified', 'closed', 'cancelled'];
const activeStatuses: ServiceJobStatus[] = ['new', 'assigned', 'in_progress'];

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function machineName(job: Job) {
  const machine = firstRelation(job.machines);
  return machine?.machine_name ?? machine?.serial_number ?? 'Machine not linked';
}

function customerName(job: Job) {
  return job.customer_name_snapshot ?? firstRelation(job.customers)?.customer_name ?? 'Customer not linked';
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  return date.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function localDay(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function todayKey() {
  return localDay(new Date().toISOString());
}

function isOverdue(job: Job) {
  return Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !terminalStatuses.includes(job.status));
}

function priorityWeight(priority: string) {
  if (priority === 'critical') return 400;
  if (priority === 'high') return 300;
  if (priority === 'medium') return 200;
  return 100;
}

function jobScore(job: Job) {
  const overdue = isOverdue(job) ? 500 : 0;
  const due = job.due_at ? Math.max(0, 200 - Math.floor((new Date(job.due_at).getTime() - Date.now()) / 3_600_000)) : 0;
  return priorityWeight(job.priority) + overdue + due;
}

function contactAge(value: string | null) {
  if (!value) return 'Never';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 2880) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function TechnicianFieldWorkspace() {
  const { businessUser, userDetails, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [machineCode, setMachineCode] = useState('');
  const [completionOutcome, setCompletionOutcome] = useState<CompletionOutcome>('completed');
  const [completionNotes, setCompletionNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);

  const role = userDetails?.role ?? null;
  const technicianUserId = businessUser?.id ?? null;
  const isTechnician = role === 'technician' || role === 'road_technician';
  const canPreview = role === 'admin' || role === 'operations';

  const load = useCallback(async (quiet = false) => {
    if (!technicianUserId || (!isTechnician && !canPreview)) {
      setJobs([]);
      setLoading(false);
      return;
    }

    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);

    try {
      const client = getSupabaseClient();
      let jobQuery = client
        .from('service_jobs')
        .select(`
          id,job_number,incident_number,branch,customer_id,customer_code_snapshot,customer_name_snapshot,
          site_id,machine_id,assigned_to,priority,status,summary,description,complaint_details,due_at,completed_at,
          reported_at,call_logged_by,contact_name,telephone,fax,mobile,contact_email,address_snapshot,service_type,
          service_code,site_location,call_type,call_reason,category,sub_category,group_3,work_order_number,
          assignment_notes,closed_by,closed_at,closing_remarks,parts_extra,performance_report_required,
          visits_chargeable,quotation_required,ticket_reference,ticket_case_number,reference_date_1,reference_date_2,
          created_at,customers(customer_name),machines(machine_name,serial_number,machine_barcode,asset_tag,manufacturer,model)
        `)
        .in('status', activeStatuses)
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(500);

      if (isTechnician) jobQuery = jobQuery.eq('assigned_to', technicianUserId);

      const jobsResult = await jobQuery;
      if (jobsResult.error) throw jobsResult.error;
      const nextJobs = (jobsResult.data ?? []) as Job[];

      const siteIds = [...new Set(nextJobs.map((job) => job.site_id).filter((id): id is string => Boolean(id)))];
      const machineIds = [...new Set(nextJobs.map((job) => job.machine_id).filter((id): id is string => Boolean(id)))];

      const [sitesResult, devicesResult, faultsResult] = await Promise.all([
        siteIds.length
          ? client.from('customer_sites').select('id,site_name,address,contact_name,contact_phone,latitude,longitude').in('id', siteIds)
          : Promise.resolve({ data: [], error: null }),
        machineIds.length
          ? client.from('telemetry_devices').select('id,machine_id,device_code,last_seen_at,last_heartbeat_at,last_transport,firmware_version,cellular_operator').in('machine_id', machineIds).neq('status', 'retired')
          : Promise.resolve({ data: [], error: null }),
        machineIds.length
          ? client.from('telemetry_fault_events').select('machine_id,severity,fault_code,canonical_title').in('machine_id', machineIds).is('cleared_at', null)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (sitesResult.error) throw sitesResult.error;
      if (devicesResult.error) throw devicesResult.error;
      if (faultsResult.error) throw faultsResult.error;

      setJobs(nextJobs);
      setSites((sitesResult.data ?? []) as Site[]);
      setDevices((devicesResult.data ?? []) as Device[]);
      setFaults((faultsResult.data ?? []) as Fault[]);
      setSelectedId((current) => current && nextJobs.some((job) => job.id === current) ? current : null);
      setUpdated(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load technician field work.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canPreview, isTechnician, technicianUserId]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load]);

  const siteMap = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);
  const deviceMap = useMemo(() => {
    const map = new Map<string, Device>();
    devices.forEach((device) => { if (device.machine_id && !map.has(device.machine_id)) map.set(device.machine_id, device); });
    return map;
  }, [devices]);

  const selected = selectedId ? jobs.find((job) => job.id === selectedId) ?? null : null;
  const selectedSite = selected?.site_id ? siteMap.get(selected.site_id) ?? null : null;
  const selectedDevice = selected?.machine_id ? deviceMap.get(selected.machine_id) ?? null : null;
  const selectedFaults = selected?.machine_id ? faults.filter((fault) => fault.machine_id === selected.machine_id) : [];

  const today = todayKey();
  const todayJobs = useMemo(() => jobs.filter((job) => localDay(job.due_at ?? job.reported_at) === today).sort((a,b) => jobScore(b) - jobScore(a)), [jobs, today]);
  const nextJobs = useMemo(() => jobs.filter((job) => {
    const stamp = new Date(job.due_at ?? job.reported_at).getTime();
    return stamp > Date.now() && stamp <= Date.now() + 7 * 24 * 60 * 60 * 1000 && localDay(job.due_at ?? job.reported_at) !== today;
  }).sort((a,b) => new Date(a.due_at ?? a.reported_at).getTime() - new Date(b.due_at ?? b.reported_at).getTime()), [jobs, today]);
  const backlog = useMemo(() => jobs.filter((job) => !todayJobs.some((todayJob) => todayJob.id === job.id) && !nextJobs.some((nextJob) => nextJob.id === job.id)).sort((a,b) => jobScore(b) - jobScore(a)), [jobs, nextJobs, todayJobs]);
  const overdue = jobs.filter(isOverdue).length;
  const critical = jobs.filter((job) => job.priority === 'critical').length;
  const inProgress = jobs.filter((job) => job.status === 'in_progress').length;

  const startJob = async (job: Job) => {
    setUpdating(job.id);
    setError(null);
    setNotice(null);
    const { error: transitionError } = await getSupabaseClient().rpc('transition_service_job', {
      job_id: job.id,
      new_status: 'in_progress',
    });
    if (transitionError) setError(transitionError.message);
    else {
      setNotice(`${job.job_number} started.`);
      await load(true);
    }
    setUpdating(null);
  };

  const completeJob = async (job: Job) => {
    if (!machineCode.trim()) {
      setError('Scan or enter the linked machine QR, serial number or asset tag before completion.');
      return;
    }
    setUpdating(job.id);
    setError(null);
    setNotice(null);
    const { error: completionError } = await getSupabaseClient().rpc('complete_assigned_service_job', {
      p_service_job_id: job.id,
      p_machine_code: machineCode.trim(),
      p_outcome: completionOutcome,
      p_notes: completionNotes.trim() || null,
      p_photo_bucket: null,
      p_photo_path: null,
    });
    if (completionError) setError(completionError.message);
    else {
      setNotice(`${job.job_number} completed and recorded.`);
      setSelectedId(null);
      setMachineCode('');
      setCompletionNotes('');
      setCompletionOutcome('completed');
      await load(true);
    }
    setUpdating(null);
  };

  function renderJobCard(job: Job) {
    const site = job.site_id ? siteMap.get(job.site_id) : null;
    const device = job.machine_id ? deviceMap.get(job.machine_id) : null;
    const faultCount = job.machine_id ? faults.filter((fault) => fault.machine_id === job.machine_id).length : 0;
    return <button className={`${styles.jobCard} ${isOverdue(job) ? styles.jobOverdue : ''}`} key={job.id} onClick={() => setSelectedId(job.id)} type="button">
      <div className={styles.jobTop}><span className={`${styles.priority} ${styles[`priority_${job.priority}`]}`}>{job.priority}</span><small>{job.job_number}</small></div>
      <strong>{machineName(job)}</strong>
      <p>{job.summary}</p>
      <div className={styles.jobMeta}><span>{site?.site_name ?? job.site_location ?? customerName(job)}</span><span>{dateTime(job.due_at)}</span></div>
      <footer><span>{job.status.replace(/_/g,' ')}</span><span>{faultCount ? `${faultCount} active faults` : device ? `${device.last_transport ?? 'network unknown'} · ${contactAge(device.last_heartbeat_at ?? device.last_seen_at)}` : 'No telemetry device'}</span></footer>
    </button>;
  }

  if (authLoading || loading) return <HamsterLoader label="Loading technician field view" />;

  if (!isTechnician && !canPreview) {
    return <section className={styles.denied}><h1>Technician Field View</h1><p>This workspace is available to technicians, road technicians and authorised operations/admin users.</p><Link href="/">Return to dashboard</Link></section>;
  }

  return (
    <section className={styles.workspace} data-technician-field-view="v1">
      <header className={styles.header}>
        <div><span>Field Operations</span><h1>Technician</h1><p>{isTechnician ? 'Your assigned work, machine context and safe completion workflow.' : 'Operational preview of active technician work.'}</p></div>
        <div className={styles.headerActions}><Link href="/maintenance">Maintenance</Link><button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <section className={styles.metrics}>
        <article><span>Today</span><strong>{todayJobs.length}</strong><small>Scheduled / due today</small></article>
        <article><span>In progress</span><strong>{inProgress}</strong><small>Work currently started</small></article>
        <article className={overdue ? styles.metricDanger : ''}><span>Overdue</span><strong>{overdue}</strong><small>Past due date</small></article>
        <article className={critical ? styles.metricWarning : ''}><span>Critical</span><strong>{critical}</strong><small>Critical priority jobs</small></article>
        <article><span>Assigned backlog</span><strong>{jobs.length}</strong><small>{isTechnician ? 'Your open assignments' : 'Visible active jobs'}</small></article>
      </section>

      <section className={styles.fieldLayout}>
        <section className={styles.primaryColumn}>
          <header className={styles.sectionHeader}><div><span>Today</span><h2>Today’s route</h2></div><strong>{todayJobs.length}</strong></header>
          <div className={styles.jobGrid}>{todayJobs.map(renderJobCard)}</div>
          {!todayJobs.length ? <div className={styles.empty}>No jobs are scheduled for today.</div> : null}

          <header className={styles.sectionHeader}><div><span>Next 7 days</span><h2>Upcoming work</h2></div><strong>{nextJobs.length}</strong></header>
          <div className={styles.jobGrid}>{nextJobs.slice(0,12).map(renderJobCard)}</div>
          {!nextJobs.length ? <div className={styles.empty}>No upcoming jobs in the next seven days.</div> : null}
        </section>

        <aside className={styles.backlog}>
          <header className={styles.sectionHeader}><div><span>Smart backlog</span><h2>Next best work</h2></div><strong>{backlog.length}</strong></header>
          <p>Ranked by priority, overdue state and due-date pressure. No route optimisation or continuous location tracking is inferred.</p>
          <div>{backlog.slice(0,16).map(renderJobCard)}</div>
          {!backlog.length ? <div className={styles.empty}>No additional backlog work.</div> : null}
        </aside>
      </section>

      {selected ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(null); }} role="presentation">
        <aside className={styles.drawer} aria-label="Technician job details">
          <header><div><span>Field job</span><h2>{selected.job_number}</h2><p>{selected.incident_number} · {customerName(selected)}</p></div><button onClick={() => setSelectedId(null)} type="button">×</button></header>

          <section className={styles.drawerStatus}>
            <span className={`${styles.priority} ${styles[`priority_${selected.priority}`]}`}>{selected.priority}</span>
            <span className={styles.status}>{selected.status.replace(/_/g,' ')}</span>
            {isOverdue(selected) ? <strong>Overdue</strong> : null}
          </section>

          <section className={styles.routeCard}>
            <div><span>Site</span><strong>{selectedSite?.site_name ?? selected.site_location ?? 'Site not recorded'}</strong><small>{selectedSite?.address ?? selected.address_snapshot ?? 'Address not recorded'}</small></div>
            <div><span>Site contact</span><strong>{selectedSite?.contact_name ?? selected.contact_name ?? 'Not recorded'}</strong><small>{selectedSite?.contact_phone ?? selected.mobile ?? selected.telephone ?? 'No phone recorded'}</small></div>
            {selectedSite?.latitude != null && selectedSite?.longitude != null ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(selectedSite.latitude))},${encodeURIComponent(String(selectedSite.longitude))}`} rel="noreferrer" target="_blank">Open navigation</a> : null}
          </section>

          <dl className={styles.facts}>
            <div><dt>Machine</dt><dd>{machineName(selected)}</dd></div>
            <div><dt>Brand / model</dt><dd>{firstRelation(selected.machines)?.manufacturer ?? '—'} {firstRelation(selected.machines)?.model ?? ''}</dd></div>
            <div><dt>Serial</dt><dd>{firstRelation(selected.machines)?.serial_number ?? 'Not recorded'}</dd></div>
            <div><dt>Due</dt><dd>{dateTime(selected.due_at)}</dd></div>
            <div><dt>Service type</dt><dd>{selected.service_type}</dd></div>
            <div><dt>Category</dt><dd>{selected.category ?? 'Not classified'}</dd></div>
            <div><dt>Telemetry</dt><dd>{selectedDevice ? `${selectedDevice.device_code} · ${selectedDevice.last_transport ?? 'network unknown'}` : 'No active device'}</dd></div>
            <div><dt>Last contact</dt><dd>{selectedDevice ? contactAge(selectedDevice.last_heartbeat_at ?? selectedDevice.last_seen_at) : '—'}</dd></div>
            <div><dt>Active faults</dt><dd>{selectedFaults.length}</dd></div>
          </dl>

          <section className={styles.workRequired}><span>Work required</span><p>{selected.complaint_details || selected.description || selected.summary}</p>{selected.assignment_notes ? <><span>Assignment notes</span><p>{selected.assignment_notes}</p></> : null}</section>

          {selectedFaults.length ? <section className={styles.faultList}><span>Active machine faults</span>{selectedFaults.slice(0,8).map((fault,index) => <article key={`${fault.fault_code}-${index}`}><strong>{fault.canonical_title ?? fault.fault_code}</strong><small>{fault.severity ?? 'unrated'} · {fault.fault_code}</small></article>)}</section> : null}

          {isTechnician ? <section className={styles.fieldActions}>
            {selected.status === 'assigned' ? <button disabled={updating === selected.id} onClick={() => void startJob(selected)} type="button">{updating === selected.id ? 'Starting…' : 'Start job'}</button> : null}
            {selected.status === 'in_progress' ? <div className={styles.completion}>
              <label><span>Machine QR / serial / asset tag</span><input autoComplete="off" value={machineCode} onChange={(event) => setMachineCode(event.target.value)} placeholder="Scan or enter machine code" /></label>
              <label><span>Outcome</span><select value={completionOutcome} onChange={(event) => setCompletionOutcome(event.target.value as CompletionOutcome)}><option value="completed">Completed</option><option value="follow_up_required">Follow-up required</option><option value="parts_required">Parts required</option><option value="customer_unavailable">Customer unavailable</option></select></label>
              <label><span>Closure notes</span><textarea rows={3} value={completionNotes} onChange={(event) => setCompletionNotes(event.target.value)} placeholder="Work performed, parts, follow-up or customer context" /></label>
              <button disabled={updating === selected.id} onClick={() => void completeJob(selected)} type="button">{updating === selected.id ? 'Completing…' : 'Complete & record'}</button>
              <small>Completion uses the existing atomic technician RPC and validates the entered/scanned machine code against the assigned machine.</small>
            </div> : null}
          </section> : null}

          <footer>
            {selected.machine_id ? <Link href={`/machines/${selected.machine_id}`}>Open machine</Link> : null}
            {selectedDevice ? <Link href={`/telemetry/test-center?device=${encodeURIComponent(selectedDevice.device_code)}`}>Diagnostics</Link> : <Link href="/telemetry/test-center">Test Center</Link>}
            <Link href="/maintenance">Maintenance</Link>
          </footer>
        </aside>
      </div> : null}
    </section>
  );
}
