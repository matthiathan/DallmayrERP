'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { RequestedServiceCallCreateForm } from '@/components/features/RequestedServiceCallCreateForm';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { ServiceJobRecord, ServiceJobStatus, ServicePriority } from '@/types/enterprise-records';

type TechnicianOption = { user_id: string; display_name: string; role: string; branch: Branch };
type CustomerRelation = { customer_name: string | null };
type MachineRelation = { machine_name: string | null; serial_number: string | null };
type JobRow = ServiceJobRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
};
type OperationalView = 'kanban' | 'calendar' | 'map' | 'workload' | 'dashboard';

const statuses: ServiceJobStatus[] = ['new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled'];
const priorities: ServicePriority[] = ['low', 'medium', 'high', 'critical'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];
const terminalStatuses: ServiceJobStatus[] = ['completed', 'verified', 'closed', 'cancelled'];
const viewOptions: Array<{ id: OperationalView; label: string; description: string }> = [
  { id: 'kanban', label: 'Kanban', description: 'Assign and progress service work by status.' },
  { id: 'calendar', label: 'Calendar', description: 'Review reported and due work in date order.' },
  { id: 'map', label: 'Map', description: 'Organise jobs by recorded service location.' },
  { id: 'workload', label: 'Workload', description: 'Compare active assignments by technician.' },
  { id: 'dashboard', label: 'Dashboard', description: 'Monitor service pressure, ageing and completion.' },
];

function firstRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

function nextStatuses(status: ServiceJobStatus): ServiceJobStatus[] {
  const map: Record<ServiceJobStatus, ServiceJobStatus[]> = {
    new: ['new', 'assigned', 'cancelled'],
    assigned: ['assigned', 'in_progress', 'cancelled'],
    in_progress: ['in_progress', 'completed', 'cancelled'],
    completed: ['completed', 'verified'],
    verified: ['verified', 'closed'],
    closed: ['closed'],
    cancelled: ['cancelled'],
  };
  return map[status];
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled';
}

function localDateKey(value: string | null | undefined) {
  if (!value) return 'unscheduled';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unscheduled';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function customerName(job: JobRow) {
  return job.customer_name_snapshot ?? firstRelation(job.customers)?.customer_name ?? 'Customer not linked';
}

function isOverdue(job: JobRow) {
  return Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !terminalStatuses.includes(job.status));
}

function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function JobSummary({ job, technicianName }: { job: JobRow; technicianName?: string }) {
  return (
    <div className="monday-service-summary">
      <div><strong>Incident {job.incident_number}</strong><small>{job.job_number}</small></div>
      <p>{job.complaint_details}</p>
      <dl>
        <div><dt>Customer</dt><dd>{customerName(job)}</dd></div>
        <div><dt>Branch</dt><dd>{job.branch.toUpperCase()}</dd></div>
        <div><dt>Technician</dt><dd>{technicianName || 'Unassigned'}</dd></div>
        <div><dt>Due</dt><dd>{formatDateTime(job.due_at)}</dd></div>
      </dl>
      <div className="monday-service-summary-badges"><StatusBadge value={job.status} /><StatusBadge value={job.priority} />{isOverdue(job) ? <StatusBadge value="overdue" /> : null}</div>
    </div>
  );
}

export function EnterpriseServiceJobBoard() {
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [search, setSearch] = useState(searchParams.get('job') ?? '');
  const [branchFilter, setBranchFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [view, setView] = useState<OperationalView>('kanban');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadBoard() {
    setError(null);
    const client = getSupabaseClient();
    const [jobsResult, techniciansResult] = await Promise.all([
      client.from('service_jobs')
        .select(`
          id, job_number, incident_number, branch, customer_id,
          customer_code_snapshot, customer_name_snapshot, site_id, machine_id,
          assigned_to, priority, status, summary, description, complaint_details,
          due_at, completed_at, reported_at, call_logged_by, contact_name,
          telephone, fax, mobile, contact_email, address_snapshot, service_type,
          service_code, site_location, call_type, call_reason, category,
          sub_category, group_3, work_order_number, assignment_notes, closed_by,
          closed_at, closing_remarks, parts_extra, performance_report_required,
          visits_chargeable, quotation_required, ticket_reference,
          ticket_case_number, reference_date_1, reference_date_2, created_at,
          customers(customer_name), machines(machine_name, serial_number)
        `)
        .order('reported_at', { ascending: false })
        .limit(300),
      client.rpc('list_assignable_technicians'),
    ]);
    if (jobsResult.error) throw jobsResult.error;
    if (techniciansResult.error) throw techniciansResult.error;
    setJobs((jobsResult.data ?? []) as JobRow[]);
    setTechnicians((techniciansResult.data ?? []) as TechnicianOption[]);
    setLastUpdated(new Date());
  }

  useEffect(() => {
    loadBoard().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load service dispatch.'));
  }, []);

  async function updateStatus(job: JobRow, status: ServiceJobStatus) {
    if (job.status === status) return;
    if (status === 'closed') {
      const remarks = window.prompt(`Closing remarks for incident ${job.incident_number}:`, job.closing_remarks ?? '');
      if (remarks === null) return;
      setUpdatingId(job.id);
      setError(null);
      const { error: closeError } = await getSupabaseClient().rpc('close_service_job', { job_id: job.id, remarks: remarks.trim() || null });
      setUpdatingId(null);
      if (closeError) { setError(closeError.message); return; }
      setMessage(`Incident ${job.incident_number} closed.`);
      await loadBoard();
      return;
    }
    setUpdatingId(job.id);
    setError(null);
    const { error: updateError } = await getSupabaseClient().rpc('transition_service_job', { job_id: job.id, new_status: status });
    setUpdatingId(null);
    if (updateError) { setError(updateError.message); return; }
    setMessage(`${job.job_number} moved to ${status.replace(/_/g, ' ')}.`);
    await loadBoard();
  }

  async function assignJob(job: JobRow, technicianId: string) {
    if (job.assigned_to === technicianId) return;
    setUpdatingId(job.id);
    setError(null);
    const { error: assignmentError } = await getSupabaseClient().rpc('assign_service_job', { job_id: job.id, assignee_id: technicianId || null });
    setUpdatingId(null);
    if (assignmentError) { setError(assignmentError.message); return; }
    setMessage(technicianId ? `${job.job_number} assigned.` : `${job.job_number} unassigned.`);
    await loadBoard();
  }

  const technicianMap = useMemo(() => new Map(technicians.map((technician) => [technician.user_id, technician])), [technicians]);
  const filteredJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const machine = firstRelation(job.machines);
      const technician = job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name ?? '' : '';
      const text = [job.id, job.incident_number, job.job_number, job.ticket_case_number, job.ticket_reference, job.work_order_number, job.summary, job.complaint_details, customerName(job), job.customer_code_snapshot, job.contact_name, job.telephone, job.mobile, job.contact_email, job.service_type, job.service_code, job.site_location, job.address_snapshot, job.call_type, job.call_reason, job.category, job.sub_category, job.group_3, machine?.machine_name, machine?.serial_number, technician].join(' ').toLowerCase();
      return (!term || text.includes(term))
        && (branchFilter === 'all' || job.branch === branchFilter)
        && (priorityFilter === 'all' || job.priority === priorityFilter);
    });
  }, [branchFilter, jobs, priorityFilter, search, technicianMap]);

  const grouped = useMemo(() => statuses.map((status) => ({ status, jobs: filteredJobs.filter((job) => job.status === status) })), [filteredJobs]);
  const activeJobs = useMemo(() => filteredJobs.filter((job) => !terminalStatuses.includes(job.status)), [filteredJobs]);
  const overdueJobs = useMemo(() => activeJobs.filter(isOverdue), [activeJobs]);
  const unassignedJobs = useMemo(() => activeJobs.filter((job) => !job.assigned_to), [activeJobs]);
  const highPriorityJobs = useMemo(() => activeJobs.filter((job) => ['high', 'critical'].includes(job.priority)), [activeJobs]);
  const completedJobs = useMemo(() => filteredJobs.filter((job) => ['completed', 'verified', 'closed'].includes(job.status)), [filteredJobs]);

  const calendarGroups = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    filteredJobs.forEach((job) => {
      const key = localDateKey(job.due_at ?? job.reported_at);
      map.set(key, [...(map.get(key) ?? []), job]);
    });
    return Array.from(map.entries()).sort(([left], [right]) => left === 'unscheduled' ? 1 : right === 'unscheduled' ? -1 : left.localeCompare(right));
  }, [filteredJobs]);

  const locationGroups = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    filteredJobs.forEach((job) => {
      const location = (job.address_snapshot || job.site_location || '').trim() || 'Location not recorded';
      map.set(location, [...(map.get(location) ?? []), job]);
    });
    return Array.from(map.entries()).sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
  }, [filteredJobs]);

  const workload = useMemo(() => {
    const rows = technicians.map((technician) => {
      const assigned = activeJobs.filter((job) => job.assigned_to === technician.user_id);
      return { technician, assigned, overdue: assigned.filter(isOverdue).length, critical: assigned.filter((job) => job.priority === 'critical').length };
    });
    rows.push({ technician: { user_id: 'unassigned', display_name: 'Unassigned', role: 'Queue', branch: 'national' }, assigned: unassignedJobs, overdue: unassignedJobs.filter(isOverdue).length, critical: unassignedJobs.filter((job) => job.priority === 'critical').length });
    return rows.sort((left, right) => right.assigned.length - left.assigned.length);
  }, [activeJobs, technicians, unassignedJobs]);

  const completionRate = filteredJobs.length === 0 ? 0 : Math.round((completedJobs.length / filteredJobs.length) * 100);
  const selectedView = viewOptions.find((option) => option.id === view) ?? viewOptions[0];

  return (
    <div className="grid spatial-stage spatial-dashboard monday-service-operations">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <RequestedServiceCallCreateForm technicians={technicians} onCreated={loadBoard} />

      <PageToolbar
        actions={<button className="button secondary" onClick={() => loadBoard().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh</button>}
        description="One operational dataset presented as Kanban, calendar, location, workload and dashboard views."
        lastUpdated={lastUpdated}
        title="Service operations"
      >
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Incident, customer, ticket, technician or location" type="search" /></label>
        <label>Branch<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All branches</option>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
        <label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{priorities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </PageToolbar>

      <nav aria-label="Service operation views" className="monday-service-view-tabs">
        {viewOptions.map((option) => <button aria-current={view === option.id ? 'page' : undefined} className={view === option.id ? 'is-active' : undefined} key={option.id} onClick={() => setView(option.id)} type="button"><strong>{option.label}</strong><small>{option.description}</small></button>)}
      </nav>

      <div className="monday-service-view-heading"><div><span>View</span><h2>{selectedView.label}</h2><p>{selectedView.description}</p></div><strong>{filteredJobs.length.toLocaleString()} jobs</strong></div>

      {view === 'kanban' ? (
        <div className="monday-service-kanban">
          {grouped.map((group) => (
            <section className="monday-service-lane" key={group.status}>
              <header><div><StatusBadge value={group.status} /><strong>{group.status.replace(/_/g, ' ')}</strong></div><span>{group.jobs.length}</span></header>
              <div className="monday-service-lane-list">
                {group.jobs.length === 0 ? <p className="monday-service-empty">No jobs in this stage</p> : null}
                {group.jobs.map((job) => (
                  <article className="monday-service-job-card" key={job.id}>
                    <JobSummary job={job} technicianName={job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name : undefined} />
                    <div className="monday-service-card-actions">
                      <Link className="button secondary" href={`/operations/service-jobs/${job.id}`}>Open</Link>
                      <label>Technician<select disabled={updatingId === job.id || ['closed', 'cancelled'].includes(job.status)} value={job.assigned_to ?? ''} onChange={(event) => assignJob(job, event.target.value)}><option value="">Unassigned</option>{technicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role}</option>)}</select></label>
                      <label>Next status<select disabled={updatingId === job.id} value={job.status} onChange={(event) => updateStatus(job, event.target.value as ServiceJobStatus)}>{nextStatuses(job.status).map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}</select></label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {view === 'calendar' ? (
        <div className="monday-service-calendar">
          {calendarGroups.map(([dateKey, dateJobs]) => <section key={dateKey}><header><strong>{dateKey === 'unscheduled' ? 'Unscheduled' : new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong><span>{dateJobs.length} jobs</span></header><div>{dateJobs.map((job) => <Link href={`/operations/service-jobs/${job.id}`} key={job.id}><time>{formatDateTime(job.due_at ?? job.reported_at)}</time><JobSummary job={job} technicianName={job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name : undefined} /></Link>)}</div></section>)}
        </div>
      ) : null}

      {view === 'map' ? (
        <div className="monday-service-map-grid">
          {locationGroups.map(([location, locationJobs]) => <section key={location}><header><div><span>Service location</span><strong>{location}</strong></div><span>{locationJobs.length}</span></header>{location !== 'Location not recorded' ? <a className="button secondary" href={mapsUrl(location)} rel="noreferrer" target="_blank">Open map</a> : null}<div>{locationJobs.slice(0, 8).map((job) => <Link href={`/operations/service-jobs/${job.id}`} key={job.id}><JobSummary job={job} technicianName={job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name : undefined} /></Link>)}</div>{locationJobs.length > 8 ? <small>Showing 8 of {locationJobs.length} jobs at this location.</small> : null}</section>)}
        </div>
      ) : null}

      {view === 'workload' ? (
        <div className="monday-service-workload">
          {workload.map((item) => { const capacity = Math.min(100, item.assigned.length * 12.5); return <section key={item.technician.user_id}><header><div><strong>{item.technician.display_name || item.technician.role}</strong><small>{item.technician.branch.toUpperCase()} · {item.technician.role}</small></div><span>{item.assigned.length} active</span></header><div className="monday-service-capacity" aria-label={`${Math.round(capacity)} percent workload indicator`}><span style={{ width: `${capacity}%` }} /></div><dl><div><dt>Overdue</dt><dd>{item.overdue}</dd></div><div><dt>Critical</dt><dd>{item.critical}</dd></div><div><dt>In progress</dt><dd>{item.assigned.filter((job) => job.status === 'in_progress').length}</dd></div></dl><div>{item.assigned.slice(0, 5).map((job) => <Link href={`/operations/service-jobs/${job.id}`} key={job.id}>{job.incident_number} · {customerName(job)}</Link>)}</div></section>; })}
        </div>
      ) : null}

      {view === 'dashboard' ? (
        <div className="monday-service-dashboard">
          <section className="monday-service-kpis"><article><span>Active work</span><strong>{activeJobs.length}</strong><small>Jobs not yet terminal</small></article><article><span>Overdue</span><strong>{overdueJobs.length}</strong><small>Past follow-up date</small></article><article><span>Unassigned</span><strong>{unassignedJobs.length}</strong><small>Requires dispatch</small></article><article><span>High priority</span><strong>{highPriorityJobs.length}</strong><small>High or critical</small></article><article><span>Completion</span><strong>{completionRate}%</strong><small>Completed, verified or closed</small></article></section>
          <div className="monday-service-dashboard-grid"><section><header><strong>Status distribution</strong></header>{grouped.map((group) => <div className="monday-service-distribution" key={group.status}><span>{group.status.replace(/_/g, ' ')}</span><div><i style={{ width: `${filteredJobs.length ? Math.max(2, (group.jobs.length / filteredJobs.length) * 100) : 0}%` }} /></div><strong>{group.jobs.length}</strong></div>)}</section><section><header><strong>Attention required</strong></header>{[...overdueJobs, ...unassignedJobs.filter((job) => !overdueJobs.some((item) => item.id === job.id))].slice(0, 10).map((job) => <Link href={`/operations/service-jobs/${job.id}`} key={job.id}><JobSummary job={job} technicianName={job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name : undefined} /></Link>)}{overdueJobs.length + unassignedJobs.length === 0 ? <p>No urgent dispatch exceptions in the current filter.</p> : null}</section></div>
        </div>
      ) : null}
    </div>
  );
}
