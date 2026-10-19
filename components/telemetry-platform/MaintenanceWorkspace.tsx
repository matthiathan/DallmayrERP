'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationIcon } from '@/components/layout/NavigationIcon';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { ServiceJobRecord, ServiceJobStatus, ServicePriority } from '@/types/enterprise-records';
import styles from './MaintenanceWorkspace.module.css';

type ViewMode = 'table' | 'kanban' | 'calendar';
type StatusFilter = 'active' | ServiceJobStatus | 'all';
type Technician = { user_id: string; display_name: string; role: string; branch: string };
type MachineRelation = { machine_name: string | null; serial_number: string | null };
type CustomerRelation = { customer_name: string | null };
type SiteRelation = { site_name: string | null; address: string | null };

type Job = ServiceJobRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
  customer_sites?: SiteRelation | SiteRelation[] | null;
};

type Plan = {
  id: string;
  plan_number: string;
  machine_id: string;
  title: string;
  priority: ServicePriority;
  next_due_at: string | null;
  assigned_to: string | null;
  is_active: boolean;
};

const activeStatuses: ServiceJobStatus[] = ['new', 'assigned', 'in_progress'];
const terminalStatuses: ServiceJobStatus[] = ['completed', 'verified', 'closed', 'cancelled'];
const boardStatuses: ServiceJobStatus[] = ['new', 'assigned', 'in_progress', 'completed'];

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not scheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not scheduled';
  return date.toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dateOnly(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
}

function isOverdue(job: Job) {
  return Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !terminalStatuses.includes(job.status));
}

function isDueSoon(job: Job) {
  if (!job.due_at || terminalStatuses.includes(job.status)) return false;
  const due = new Date(job.due_at).getTime();
  return due >= Date.now() && due <= Date.now() + 24 * 60 * 60 * 1000;
}

function machineName(job: Job) {
  const machine = firstRelation(job.machines);
  return machine?.machine_name ?? machine?.serial_number ?? 'Machine not linked';
}

function customerName(job: Job) {
  return job.customer_name_snapshot ?? firstRelation(job.customers)?.customer_name ?? 'Customer not linked';
}

function siteName(job: Job) {
  return job.site_location ?? firstRelation(job.customer_sites)?.site_name ?? firstRelation(job.customer_sites)?.address ?? job.address_snapshot ?? 'Site not recorded';
}

function priorityLabel(priority: ServicePriority) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function statusLabel(status: ServiceJobStatus) {
  return status.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function daysFromNow(offset: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function localDateKey(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function MaintenanceWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [view, setView] = useState<ViewMode>('table');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [priority, setPriority] = useState<'all' | ServicePriority>('all');
  const [technician, setTechnician] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const client = getSupabaseClient();
      const [jobsResult, plansResult, techniciansResult] = await Promise.all([
        client
          .from('service_jobs')
          .select(`
            id,job_number,incident_number,branch,customer_id,customer_code_snapshot,customer_name_snapshot,
            site_id,machine_id,assigned_to,priority,status,summary,description,complaint_details,due_at,completed_at,
            reported_at,call_logged_by,contact_name,telephone,fax,mobile,contact_email,address_snapshot,service_type,
            service_code,site_location,call_type,call_reason,category,sub_category,group_3,work_order_number,
            assignment_notes,closed_by,closed_at,closing_remarks,parts_extra,performance_report_required,
            visits_chargeable,quotation_required,ticket_reference,ticket_case_number,reference_date_1,reference_date_2,
            created_at,customers(customer_name),machines(machine_name,serial_number),customer_sites(site_name,address)
          `)
          .order('reported_at', { ascending: false })
          .limit(1000),
        client
          .from('maintenance_plans')
          .select('id,plan_number,machine_id,title,priority,next_due_at,assigned_to,is_active')
          .eq('is_active', true)
          .order('next_due_at', { ascending: true })
          .limit(1000),
        client.rpc('list_assignable_technicians'),
      ]);
      if (jobsResult.error) throw jobsResult.error;
      if (plansResult.error) throw plansResult.error;
      if (techniciansResult.error) throw techniciansResult.error;
      setJobs((jobsResult.data ?? []) as Job[]);
      setPlans((plansResult.data ?? []) as Plan[]);
      setTechnicians((techniciansResult.data ?? []) as Technician[]);
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load maintenance operations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
    return () => globalThis.clearInterval(timer);
  }, [load]);

  const technicianMap = useMemo(() => new Map(technicians.map((item) => [item.user_id, item])), [technicians]);
  const selected = selectedId ? jobs.find((job) => job.id === selectedId) ?? null : null;

  const activeJobs = useMemo(() => jobs.filter((job) => activeStatuses.includes(job.status)), [jobs]);
  const overdue = useMemo(() => activeJobs.filter(isOverdue), [activeJobs]);
  const dueSoon = useMemo(() => activeJobs.filter(isDueSoon), [activeJobs]);
  const unassigned = useMemo(() => activeJobs.filter((job) => !job.assigned_to), [activeJobs]);
  const inProgress = useMemo(() => activeJobs.filter((job) => job.status === 'in_progress'), [activeJobs]);
  const completed30d = useMemo(() => jobs.filter((job) => {
    if (!['completed', 'verified', 'closed'].includes(job.status)) return false;
    const stamp = new Date(job.completed_at ?? job.closed_at ?? job.reported_at).getTime();
    return stamp >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  }), [jobs]);
  const completionBase = jobs.filter((job) => new Date(job.reported_at).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000);
  const firstTimeFix = completionBase.length ? Math.round((completed30d.length / completionBase.length) * 100) : 100;
  const plansDue = plans.filter((plan) => plan.next_due_at && new Date(plan.next_due_at).getTime() <= Date.now()).length;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status === 'active' && !activeStatuses.includes(job.status)) return false;
      if (status !== 'all' && status !== 'active' && job.status !== status) return false;
      if (priority !== 'all' && job.priority !== priority) return false;
      if (technician === 'unassigned' && job.assigned_to) return false;
      if (technician !== 'all' && technician !== 'unassigned' && job.assigned_to !== technician) return false;
      if (!term) return true;
      const assigned = job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name ?? '' : '';
      return [
        job.job_number, job.incident_number, job.summary, job.complaint_details, job.category,
        job.sub_category, job.service_type, customerName(job), machineName(job), siteName(job),
        job.branch, assigned, job.work_order_number, job.ticket_reference, job.ticket_case_number,
      ].filter(Boolean).join(' ').toLowerCase().includes(term);
    });
  }, [jobs, priority, search, status, technician, technicianMap]);

  const updateStatus = async (job: Job, nextStatus: ServiceJobStatus) => {
    if (job.status === nextStatus) return;
    setUpdating(job.id);
    setError(null);
    setNotice(null);
    try {
      const { error: updateError } = await getSupabaseClient().rpc('transition_service_job', {
        job_id: job.id,
        new_status: nextStatus,
      });
      if (updateError) throw updateError;
      setNotice(`${job.job_number} moved to ${statusLabel(nextStatus)}.`);
      await load(true);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update the maintenance job.');
    } finally {
      setUpdating(null);
    }
  };

  const assign = async (job: Job, userId: string) => {
    if (!userId || userId === job.assigned_to) return;
    setUpdating(job.id);
    setError(null);
    setNotice(null);
    try {
      const { error: assignError } = await getSupabaseClient().rpc('assign_service_job', {
        job_id: job.id,
        assignee_id: userId,
      });
      if (assignError) throw assignError;
      setNotice(`${job.job_number} assigned to ${technicianMap.get(userId)?.display_name ?? 'technician'}.`);
      await load(true);
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Could not assign the maintenance job.');
    } finally {
      setUpdating(null);
    }
  };

  const calendarDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = daysFromNow(index);
    const key = dateKey(date);
    return {
      key,
      label: date.toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short' }),
      jobs: filtered.filter((job) => localDateKey(job.due_at ?? job.reported_at) === key),
    };
  }), [filtered]);

  return (
    <section className={styles.workspace} data-maintenance-workspace="telemetry-v1">
      <header className={styles.header}>
        <div><span>Operations</span><h1>Maintenance</h1><p>Plan service work, manage technician workload and follow machines from due date through completion.</p></div>
        <div className={styles.headerActions}>
          <Link href="/technician">Technician view</Link>
          <button disabled={refreshing} onClick={() => void load(true)} type="button">{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {loading ? <HamsterLoader label="Loading maintenance workspace" /> : null}

      {!loading ? <>
        <section className={styles.metrics} aria-label="Maintenance summary">
          <button onClick={() => { setStatus('active'); setSearch(''); }} type="button"><span>Open jobs</span><strong>{activeJobs.length.toLocaleString('en-ZA')}</strong><small>{unassigned.length} unassigned</small></button>
          <button className={overdue.length ? styles.metricDanger : ''} onClick={() => { setStatus('active'); setSearch(''); }} type="button"><span>Overdue</span><strong>{overdue.length.toLocaleString('en-ZA')}</strong><small>Past due date</small></button>
          <button className={dueSoon.length ? styles.metricWarning : ''} onClick={() => { setStatus('active'); setSearch(''); }} type="button"><span>Due today / next 24h</span><strong>{dueSoon.length.toLocaleString('en-ZA')}</strong><small>SLA attention</small></button>
          <button onClick={() => setStatus('in_progress')} type="button"><span>In progress</span><strong>{inProgress.length.toLocaleString('en-ZA')}</strong><small>Technician working</small></button>
          <button onClick={() => setStatus('completed')} type="button"><span>Completed · 30d</span><strong>{completed30d.length.toLocaleString('en-ZA')}</strong><small>{firstTimeFix}% completion ratio</small></button>
          <button onClick={() => setView('calendar')} type="button"><span>PM plans due</span><strong>{plansDue.toLocaleString('en-ZA')}</strong><small>{plans.length} active plans</small></button>
        </section>

        <section className={styles.viewBar}>
          <div className={styles.views}>
            <button aria-pressed={view === 'table'} className={view === 'table' ? styles.activeView : ''} onClick={() => setView('table')} type="button">Table</button>
            <button aria-pressed={view === 'kanban'} className={view === 'kanban' ? styles.activeView : ''} onClick={() => setView('kanban')} type="button">Kanban</button>
            <button aria-pressed={view === 'calendar'} className={view === 'calendar' ? styles.activeView : ''} onClick={() => setView('calendar')} type="button">Calendar</button>
          </div>
          <span>{filtered.length.toLocaleString('en-ZA')} jobs · updated {updatedAt ? updatedAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </section>

        <section className={styles.filters} aria-label="Maintenance filters">
          <label className={styles.search}><NavigationIcon kind="search" /><input aria-label="Search maintenance" onChange={(event) => setSearch(event.target.value)} placeholder="Search job, incident, customer, site, machine or technician" value={search} /></label>
          <label><span>Status</span><select onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}><option value="active">Active jobs</option><option value="all">All statuses</option><option value="new">New</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="verified">Verified</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></label>
          <label><span>Priority</span><select onChange={(event) => setPriority(event.target.value as 'all' | ServicePriority)} value={priority}><option value="all">All priorities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Normal</option><option value="low">Low</option></select></label>
          <label><span>Technician</span><select onChange={(event) => setTechnician(event.target.value)} value={technician}><option value="all">All technicians</option><option value="unassigned">Unassigned</option>{technicians.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}</select></label>
          <button onClick={() => { setSearch(''); setStatus('active'); setPriority('all'); setTechnician('all'); }} type="button">Clear filters</button>
        </section>

        {view === 'table' ? <section className={styles.tableCard}>
          <header><div><strong>Maintenance work queue</strong><small>Open any job for machine, SLA and technician context.</small></div><span>{filtered.length.toLocaleString('en-ZA')} matching</span></header>
          <div className={styles.tableScroll}>
            <table>
              <thead><tr><th>Priority</th><th>Job / incident</th><th>Machine</th><th>Customer / site</th><th>Status</th><th>Technician</th><th>Due</th><th /></tr></thead>
              <tbody>{filtered.map((job) => <tr className={isOverdue(job) ? styles.overdueRow : ''} key={job.id}>
                <td><span className={`${styles.priority} ${styles[`priority_${job.priority}`]}`}>{priorityLabel(job.priority)}</span></td>
                <td><strong>{job.job_number}</strong><small>{job.incident_number} · {job.summary}</small></td>
                <td>{job.machine_id ? <Link href={`/machines/${job.machine_id}`}>{machineName(job)}</Link> : <span>Not linked</span>}</td>
                <td><strong>{customerName(job)}</strong><small>{siteName(job)}</small></td>
                <td><span className={`${styles.status} ${styles[`status_${job.status}`]}`}>{statusLabel(job.status)}</span></td>
                <td>{job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name ?? 'Assigned technician' : <b className={styles.unassigned}>Unassigned</b>}</td>
                <td><strong>{dateOnly(job.due_at)}</strong><small>{isOverdue(job) ? 'Overdue' : dateTime(job.due_at)}</small></td>
                <td><button className={styles.openButton} onClick={() => setSelectedId(job.id)} type="button">Open</button></td>
              </tr>)}</tbody>
            </table>
          </div>
          {!filtered.length ? <div className={styles.empty}>No maintenance jobs match the selected filters.</div> : null}
        </section> : null}

        {view === 'kanban' ? <section className={styles.kanban}>
          {boardStatuses.map((columnStatus) => {
            const columnJobs = filtered.filter((job) => job.status === columnStatus);
            return <section className={styles.kanbanColumn} key={columnStatus}>
              <header><strong>{statusLabel(columnStatus)}</strong><span>{columnJobs.length}</span></header>
              <div>{columnJobs.map((job) => <button className={`${styles.jobCard} ${isOverdue(job) ? styles.jobCardOverdue : ''}`} key={job.id} onClick={() => setSelectedId(job.id)} type="button">
                <div><span className={`${styles.priority} ${styles[`priority_${job.priority}`]}`}>{priorityLabel(job.priority)}</span><small>{job.job_number}</small></div>
                <strong>{machineName(job)}</strong>
                <p>{job.summary}</p>
                <footer><span>{technicianMap.get(job.assigned_to ?? '')?.display_name ?? 'Unassigned'}</span><b>{dateOnly(job.due_at)}</b></footer>
              </button>)}</div>
            </section>;
          })}
        </section> : null}

        {view === 'calendar' ? <section className={styles.calendar}>
          <header><div><strong>7-day service calendar</strong><small>Scheduled maintenance jobs from today forward.</small></div><span>{plansDue} preventive plans currently due</span></header>
          <div className={styles.calendarGrid}>{calendarDays.map((day) => <section key={day.key}>
            <header><strong>{day.label}</strong><span>{day.jobs.length}</span></header>
            <div>{day.jobs.map((job) => <button key={job.id} onClick={() => setSelectedId(job.id)} type="button"><span className={`${styles.calendarDot} ${styles[`priority_${job.priority}`]}`} /><strong>{machineName(job)}</strong><small>{job.job_number} · {technicianMap.get(job.assigned_to ?? '')?.display_name ?? 'Unassigned'}</small></button>)}</div>
          </section>)}</div>
        </section> : null}

        {selected ? <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(null); }} role="presentation">
          <aside aria-label="Maintenance job details" className={styles.drawer}>
            <header>
              <div><span>Maintenance job</span><h2>{selected.job_number}</h2><p>{selected.incident_number} · {customerName(selected)}</p></div>
              <button aria-label="Close maintenance details" onClick={() => setSelectedId(null)} type="button">×</button>
            </header>
            <section className={styles.drawerSummary}>
              <span className={`${styles.priority} ${styles[`priority_${selected.priority}`]}`}>{priorityLabel(selected.priority)}</span>
              <span className={`${styles.status} ${styles[`status_${selected.status}`]}`}>{statusLabel(selected.status)}</span>
              {isOverdue(selected) ? <b>Overdue</b> : null}
            </section>
            <dl className={styles.drawerFacts}>
              <div><dt>Machine</dt><dd>{machineName(selected)}</dd></div>
              <div><dt>Customer</dt><dd>{customerName(selected)}</dd></div>
              <div><dt>Site</dt><dd>{siteName(selected)}</dd></div>
              <div><dt>Reported</dt><dd>{dateTime(selected.reported_at)}</dd></div>
              <div><dt>Due</dt><dd>{dateTime(selected.due_at)}</dd></div>
              <div><dt>Technician</dt><dd>{technicianMap.get(selected.assigned_to ?? '')?.display_name ?? 'Unassigned'}</dd></div>
              <div><dt>Service type</dt><dd>{selected.service_type}</dd></div>
              <div><dt>Category</dt><dd>{selected.category ?? 'Not classified'}</dd></div>
              <div><dt>Contact</dt><dd>{selected.contact_name ?? selected.telephone ?? selected.mobile ?? 'Not recorded'}</dd></div>
            </dl>
            <section className={styles.drawerDetail}>
              <span>Work required</span><p>{selected.complaint_details || selected.description || selected.summary}</p>
              {selected.assignment_notes ? <><span>Assignment notes</span><p>{selected.assignment_notes}</p></> : null}
              {selected.closing_remarks ? <><span>Closing remarks</span><p>{selected.closing_remarks}</p></> : null}
            </section>
            <section className={styles.assignment}>
              <label><span>Assigned technician</span><select disabled={updating === selected.id} onChange={(event) => void assign(selected, event.target.value)} value={selected.assigned_to ?? ''}><option value="">Unassigned</option>{technicians.map((item) => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}</select></label>
              <div><span>Job progression</span><div className={styles.progressActions}>
                {selected.status === 'new' ? <button disabled={updating === selected.id} onClick={() => void updateStatus(selected, 'assigned')} type="button">Mark assigned</button> : null}
                {['new', 'assigned'].includes(selected.status) ? <button disabled={updating === selected.id} onClick={() => void updateStatus(selected, 'in_progress')} type="button">Start job</button> : null}
                {selected.status === 'in_progress' ? <button disabled={updating === selected.id} onClick={() => void updateStatus(selected, 'completed')} type="button">Complete job</button> : null}
                {selected.status === 'completed' ? <button disabled={updating === selected.id} onClick={() => void updateStatus(selected, 'verified')} type="button">Verify completion</button> : null}
              </div></div>
            </section>
            <footer className={styles.drawerActions}>
              {selected.machine_id ? <Link href={`/machines/${selected.machine_id}`}>Open machine</Link> : null}
              <Link href="/alerts">Review alerts</Link>
              <Link href="/telemetry/test-center">Test Center</Link>
            </footer>
          </aside>
        </div> : null}
      </> : null}
    </section>
  );
}
