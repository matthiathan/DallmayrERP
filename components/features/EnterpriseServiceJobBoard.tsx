'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { RequestedServiceCallCreateForm } from '@/components/features/RequestedServiceCallCreateForm';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { ServiceJobRecord, ServiceJobStatus, ServicePriority } from '@/types/enterprise-records';

type TechnicianOption = { user_id: string; display_name: string; role: string; branch: Branch };
type CustomerRelation = { customer_name: string | null };
type MachineRelation = { machine_name: string | null; serial_number: string | null };
type CustomerSite = {
  id: string;
  customer_id: string;
  site_name: string;
  address: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};
type JobRow = ServiceJobRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
};
type OperationalView = 'kanban' | 'calendar' | 'map' | 'workload' | 'dashboard';
type MappedJob = {
  job: JobRow;
  site: CustomerSite;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
};
type WorkloadRow = {
  technician: TechnicianOption;
  assigned: JobRow[];
  overdue: number;
  critical: number;
  inProgress: number;
  score: number;
};

const statuses: ServiceJobStatus[] = ['new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled'];
const priorities: ServicePriority[] = ['low', 'medium', 'high', 'critical'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];
const terminalStatuses: ServiceJobStatus[] = ['completed', 'verified', 'closed', 'cancelled'];
const viewOptions: Array<{ id: OperationalView; label: string; description: string }> = [
  { id: 'kanban', label: 'Kanban', description: 'Assign and progress service work by controlled status.' },
  { id: 'calendar', label: 'Calendar', description: 'Review reported and due work across a seven-day window.' },
  { id: 'map', label: 'Map', description: 'Plot open work from authorised Customer Site coordinates.' },
  { id: 'workload', label: 'Workload', description: 'Compare active, overdue and critical assignments by technician.' },
  { id: 'dashboard', label: 'Dashboard', description: 'Monitor service pressure, ageing and completion.' },
];

const southAfricaOutline: Array<[number, number]> = [
  [16.5, -28.6], [17.1, -29.7], [18.4, -34.7], [20.2, -34.8], [22.3, -34.1],
  [24.9, -34.0], [27.0, -33.2], [28.0, -32.1], [29.4, -31.3], [30.5, -30.1],
  [31.2, -29.0], [32.8, -28.0], [32.5, -26.8], [31.9, -25.8], [31.5, -24.5],
  [30.8, -22.3], [28.8, -22.0], [26.8, -23.0], [25.0, -24.7], [23.0, -25.8],
  [21.0, -26.8], [18.5, -28.0],
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
  return value
    ? new Date(value).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not scheduled';
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromLocalValue(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, Math.max(0, month - 1), day || 1, 12);
}

function addDays(value: string, days: number) {
  const date = dateFromLocalValue(value);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function startOfWeekValue(value: string) {
  const date = dateFromLocalValue(value);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateValue(date);
}

function weekValues(value: string) {
  const start = startOfWeekValue(value);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function localDateKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : localDateValue(date);
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('en-ZA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dateFromLocalValue(value));
}

function customerName(job: JobRow) {
  return job.customer_name_snapshot ?? firstRelation(job.customers)?.customer_name ?? 'Customer not linked';
}

function isOverdue(job: JobRow) {
  return Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !terminalStatuses.includes(job.status));
}

function jobHref(job: JobRow) {
  return `/operations/service-jobs?job=${encodeURIComponent(job.id)}`;
}

function safeReadView(key: string): OperationalView | null {
  try {
    const value = window.localStorage.getItem(key);
    return viewOptions.some((option) => option.id === value) ? value as OperationalView : null;
  } catch {
    return null;
  }
}

function safeWriteView(key: string, view: OperationalView) {
  try {
    window.localStorage.setItem(key, view);
  } catch {
    // The selected view remains active for the current session.
  }
}

function mapCoordinate(longitude: number, latitude: number) {
  return {
    x: ((longitude - 16) / 17) * 1000,
    y: ((-22 - latitude) / 13) * 650,
  };
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
      <div className="monday-service-summary-badges">
        <StatusBadge value={job.status} />
        <StatusBadge value={job.priority} />
        {isOverdue(job) ? <StatusBadge value="overdue" /> : null}
      </div>
    </div>
  );
}

export function EnterpriseServiceJobBoard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authUser, businessUser } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [search, setSearch] = useState(searchParams.get('job') ?? '');
  const [branchFilter, setBranchFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [view, setView] = useState<OperationalView>('kanban');
  const [referenceDate, setReferenceDate] = useState(localDateValue());
  const [selectedMapJobId, setSelectedMapJobId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  const userKey = businessUser?.id ?? authUser?.id ?? 'signed-out';
  const viewStorageKey = `dallmayrerp-service-operational-view-v1-${userKey}`;
  const weekDates = useMemo(() => weekValues(referenceDate), [referenceDate]);

  useEffect(() => {
    const queryView = searchParams.get('view');
    const validQueryView = viewOptions.find((option) => option.id === queryView)?.id ?? null;
    setView(validQueryView ?? safeReadView(viewStorageKey) ?? 'kanban');
  }, [searchParams, viewStorageKey]);

  useEffect(() => {
    const jobParam = searchParams.get('job');
    if (jobParam) setSearch(jobParam);
  }, [searchParams]);

  function changeView(nextView: OperationalView) {
    setView(nextView);
    safeWriteView(viewStorageKey, nextView);
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === 'kanban') params.delete('view');
    else params.set('view', nextView);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function loadBoard() {
    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setError(null);
    const client = getSupabaseClient();

    try {
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

      const nextJobs = (jobsResult.data ?? []) as JobRow[];
      const siteIds = Array.from(new Set(nextJobs.map((job) => job.site_id).filter((id): id is string => Boolean(id))));
      let nextSites: CustomerSite[] = [];

      if (siteIds.length > 0) {
        const siteResult = await client
          .from('customer_sites')
          .select('id, customer_id, site_name, address, latitude, longitude')
          .in('id', siteIds);
        if (siteResult.error) throw siteResult.error;
        nextSites = (siteResult.data ?? []) as CustomerSite[];
      }

      if (requestId !== requestSequenceRef.current) return;
      setJobs(nextJobs);
      setTechnicians((techniciansResult.data ?? []) as TechnicianOption[]);
      setSites(nextSites);
      setLastUpdated(new Date());
    } catch (loadError) {
      if (requestId === requestSequenceRef.current) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load service operations.');
      }
    } finally {
      if (requestId === requestSequenceRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadBoard().catch(() => undefined);
  }, []);

  async function updateStatus(job: JobRow, status: ServiceJobStatus) {
    if (job.status === status) return;
    if (status === 'closed') {
      const remarks = window.prompt(`Closing remarks for incident ${job.incident_number}:`, job.closing_remarks ?? '');
      if (remarks === null) return;
      setUpdatingId(job.id);
      setError(null);
      const { error: closeError } = await getSupabaseClient().rpc('close_service_job', {
        job_id: job.id,
        remarks: remarks.trim() || null,
      });
      setUpdatingId(null);
      if (closeError) { setError(closeError.message); return; }
      setMessage(`Incident ${job.incident_number} closed.`);
      await loadBoard();
      return;
    }

    setUpdatingId(job.id);
    setError(null);
    const { error: updateError } = await getSupabaseClient().rpc('transition_service_job', {
      job_id: job.id,
      new_status: status,
    });
    setUpdatingId(null);
    if (updateError) { setError(updateError.message); return; }
    setMessage(`${job.job_number} moved to ${status.replace(/_/g, ' ')}.`);
    await loadBoard();
  }

  async function assignJob(job: JobRow, technicianId: string) {
    if (!technicianId || job.assigned_to === technicianId) return;
    setUpdatingId(job.id);
    setError(null);
    const { error: assignmentError } = await getSupabaseClient().rpc('assign_service_job', {
      job_id: job.id,
      assignee_id: technicianId,
    });
    setUpdatingId(null);
    if (assignmentError) { setError(assignmentError.message); return; }
    setMessage(`${job.job_number} assigned.`);
    await loadBoard();
  }

  const technicianMap = useMemo(
    () => new Map(technicians.map((technician) => [technician.user_id, technician])),
    [technicians],
  );
  const siteMap = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);

  const filteredJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const machine = firstRelation(job.machines);
      const technician = job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name ?? '' : '';
      const site = job.site_id ? siteMap.get(job.site_id) : null;
      const text = [
        job.id, job.incident_number, job.job_number, job.ticket_case_number,
        job.ticket_reference, job.work_order_number, job.summary, job.complaint_details,
        customerName(job), job.customer_code_snapshot, job.contact_name, job.telephone,
        job.mobile, job.contact_email, job.service_type, job.service_code, job.site_location,
        job.address_snapshot, site?.site_name, site?.address, job.call_type, job.call_reason,
        job.category, job.sub_category, job.group_3, machine?.machine_name,
        machine?.serial_number, technician,
      ].join(' ').toLowerCase();

      return (!term || text.includes(term))
        && (branchFilter === 'all' || job.branch === branchFilter)
        && (priorityFilter === 'all' || job.priority === priorityFilter);
    });
  }, [branchFilter, jobs, priorityFilter, search, siteMap, technicianMap]);

  const grouped = useMemo(
    () => statuses.map((status) => ({ status, jobs: filteredJobs.filter((job) => job.status === status) })),
    [filteredJobs],
  );
  const activeJobs = useMemo(
    () => filteredJobs.filter((job) => !terminalStatuses.includes(job.status)),
    [filteredJobs],
  );
  const overdueJobs = useMemo(() => activeJobs.filter(isOverdue), [activeJobs]);
  const unassignedJobs = useMemo(() => activeJobs.filter((job) => !job.assigned_to), [activeJobs]);
  const highPriorityJobs = useMemo(
    () => activeJobs.filter((job) => ['high', 'critical'].includes(job.priority)),
    [activeJobs],
  );
  const completedJobs = useMemo(
    () => filteredJobs.filter((job) => ['completed', 'verified', 'closed'].includes(job.status)),
    [filteredJobs],
  );

  const calendarGroups = useMemo(() => weekDates.map((date) => ({
    date,
    jobs: filteredJobs
      .filter((job) => localDateKey(job.due_at ?? job.reported_at) === date)
      .sort((left, right) => new Date(left.due_at ?? left.reported_at).getTime() - new Date(right.due_at ?? right.reported_at).getTime()),
  })), [filteredJobs, weekDates]);

  const mappedJobs = useMemo<MappedJob[]>(() => activeJobs.flatMap((job) => {
    const site = job.site_id ? siteMap.get(job.site_id) : null;
    const latitude = Number(site?.latitude);
    const longitude = Number(site?.longitude);
    if (!site || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    if (latitude < -35 || latitude > -22 || longitude < 16 || longitude > 33) return [];
    const coordinate = mapCoordinate(longitude, latitude);
    return [{ job, site, latitude, longitude, x: coordinate.x, y: coordinate.y }];
  }), [activeJobs, siteMap]);

  const selectedMapJob = mappedJobs.find((item) => item.job.id === selectedMapJobId) ?? mappedJobs[0] ?? null;
  const missingCoordinateJobs = activeJobs.filter((job) => !mappedJobs.some((mapped) => mapped.job.id === job.id));

  const workload = useMemo<WorkloadRow[]>(() => {
    const rows: WorkloadRow[] = technicians.map((technician) => {
      const assigned = activeJobs.filter((job) => job.assigned_to === technician.user_id);
      const overdue = assigned.filter(isOverdue).length;
      const critical = assigned.filter((job) => job.priority === 'critical').length;
      const inProgress = assigned.filter((job) => job.status === 'in_progress').length;
      return {
        technician,
        assigned,
        overdue,
        critical,
        inProgress,
        score: assigned.length + (overdue * 2) + (critical * 2) + inProgress,
      };
    });
    rows.push({
      technician: { user_id: 'unassigned', display_name: 'Unassigned queue', role: 'queue', branch: 'national' },
      assigned: unassignedJobs,
      overdue: unassignedJobs.filter(isOverdue).length,
      critical: unassignedJobs.filter((job) => job.priority === 'critical').length,
      inProgress: 0,
      score: unassignedJobs.length + (unassignedJobs.filter(isOverdue).length * 2),
    });
    return rows.sort((left, right) => right.score - left.score || left.technician.display_name.localeCompare(right.technician.display_name));
  }, [activeJobs, technicians, unassignedJobs]);

  const completionRate = filteredJobs.length === 0
    ? 0
    : Math.round((completedJobs.length / filteredJobs.length) * 100);
  const selectedView = viewOptions.find((option) => option.id === view) ?? viewOptions[0];
  const maxWorkload = Math.max(1, ...workload.map((item) => item.score));
  const outlinePoints = southAfricaOutline.map(([longitude, latitude]) => {
    const point = mapCoordinate(longitude, latitude);
    return `${point.x},${point.y}`;
  }).join(' ');

  return (
    <div className="grid spatial-stage spatial-dashboard monday-service-operations">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <details className="monday-service-create-panel">
        <summary><span>New service call</span><small>Create request-only work without displacing the operational board.</small></summary>
        <div><RequestedServiceCallCreateForm technicians={technicians} onCreated={loadBoard} /></div>
      </details>

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={() => loadBoard()} type="button">{loading ? 'Refreshing…' : 'Refresh'}</button>}
        description="One authoritative service dataset presented as Kanban, calendar, map, workload and dashboard views."
        lastUpdated={lastUpdated}
        title="Service operations"
      >
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Incident, customer, ticket, technician or site" type="search" /></label>
        <label>Branch<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All branches</option>{branches.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
        <label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{priorities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </PageToolbar>

      <nav aria-label="Service operation views" className="monday-service-view-tabs">
        {viewOptions.map((option) => (
          <button
            aria-current={view === option.id ? 'page' : undefined}
            className={view === option.id ? 'is-active' : undefined}
            key={option.id}
            onClick={() => changeView(option.id)}
            type="button"
          >
            <strong>{option.label}</strong><small>{option.description}</small>
          </button>
        ))}
      </nav>

      <div className="monday-service-view-heading">
        <div><span>View</span><h2>{selectedView.label}</h2><p>{selectedView.description}</p></div>
        <strong>{filteredJobs.length.toLocaleString()} jobs</strong>
      </div>

      {loading ? <div className="neo-card monday-service-loading" role="status">Loading service operations…</div> : null}

      {!loading && view === 'kanban' ? (
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
                      <Link className="button secondary" href={jobHref(job)}>Open</Link>
                      <label>
                        Technician
                        <select
                          disabled={updatingId === job.id || ['closed', 'cancelled'].includes(job.status)}
                          value={job.assigned_to ?? ''}
                          onChange={(event) => assignJob(job, event.target.value)}
                        >
                          {!job.assigned_to ? <option value="">Choose technician</option> : null}
                          {technicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role}</option>)}
                        </select>
                      </label>
                      <label>
                        Next status
                        <select disabled={updatingId === job.id} value={job.status} onChange={(event) => updateStatus(job, event.target.value as ServiceJobStatus)}>
                          {nextStatuses(job.status).map((status) => <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>)}
                        </select>
                      </label>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {!loading && view === 'calendar' ? (
        <div className="monday-service-calendar-view">
          <div className="monday-service-calendar-controls">
            <button className="button secondary" onClick={() => setReferenceDate(addDays(referenceDate, -7))} type="button">Previous week</button>
            <label>Week of<input type="date" value={referenceDate} onChange={(event) => setReferenceDate(event.target.value)} /></label>
            <button className="button secondary" onClick={() => setReferenceDate(localDateValue())} type="button">Today</button>
            <button className="button secondary" onClick={() => setReferenceDate(addDays(referenceDate, 7))} type="button">Next week</button>
          </div>
          <div className="monday-service-calendar-scroll">
            <div className="monday-service-calendar">
              {calendarGroups.map((group) => (
                <section className={group.date === localDateValue() ? 'is-today' : undefined} key={group.date}>
                  <header><strong>{formatDay(group.date)}</strong><span>{group.jobs.length} jobs</span></header>
                  <div>
                    {group.jobs.map((job) => (
                      <Link href={jobHref(job)} key={job.id}>
                        <time>{formatDateTime(job.due_at ?? job.reported_at)}</time>
                        <JobSummary job={job} technicianName={job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name : undefined} />
                      </Link>
                    ))}
                    {group.jobs.length === 0 ? <p className="monday-service-empty">No service activity.</p> : null}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {!loading && view === 'map' ? (
        <div className="monday-service-coordinate-map">
          <div className="monday-service-map-canvas">
            <svg aria-label="South Africa service-job map" role="img" viewBox="0 0 1000 650">
              <defs>
                <pattern id="service-map-grid" width="100" height="65" patternUnits="userSpaceOnUse"><path d="M 100 0 L 0 0 0 65" fill="none" /></pattern>
              </defs>
              <rect className="monday-service-map-grid" width="1000" height="650" />
              <polygon className="monday-service-map-country" points={outlinePoints} />
              {mappedJobs.map((item) => {
                const selected = selectedMapJob?.job.id === item.job.id;
                return (
                  <g
                    aria-label={`${item.job.job_number}, ${customerName(item.job)}`}
                    className={selected ? 'monday-service-map-point is-selected' : 'monday-service-map-point'}
                    key={item.job.id}
                    onClick={() => setSelectedMapJobId(item.job.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedMapJobId(item.job.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    transform={`translate(${item.x} ${item.y})`}
                  >
                    <circle r={selected ? 13 : 9} />
                    <text x="16" y="4">{item.job.job_number}</text>
                  </g>
                );
              })}
              <text className="monday-service-map-city" x="130" y="570">Cape Town</text>
              <text className="monday-service-map-city" x="700" y="230">Johannesburg</text>
              <text className="monday-service-map-city" x="855" y="365">Durban</text>
            </svg>
          </div>
          <aside className="monday-service-map-detail">
            <header>
              <div><span>Mapped work</span><h3>{mappedJobs.length.toLocaleString()} jobs</h3></div>
              <div><span>Missing coordinates</span><h3>{missingCoordinateJobs.length.toLocaleString()}</h3></div>
            </header>
            {selectedMapJob ? (
              <section>
                <div><strong>{selectedMapJob.job.job_number}</strong><StatusBadge value={isOverdue(selectedMapJob.job) ? 'overdue' : selectedMapJob.job.priority} /></div>
                <h2>{customerName(selectedMapJob.job)}</h2>
                <p>{selectedMapJob.site.site_name} · {selectedMapJob.site.address || selectedMapJob.job.address_snapshot || 'No address captured'}</p>
                <dl>
                  <div><dt>Coordinates</dt><dd>{selectedMapJob.latitude.toFixed(5)}, {selectedMapJob.longitude.toFixed(5)}</dd></div>
                  <div><dt>Technician</dt><dd>{selectedMapJob.job.assigned_to ? technicianMap.get(selectedMapJob.job.assigned_to)?.display_name || 'Assigned' : 'Unassigned'}</dd></div>
                  <div><dt>Due</dt><dd>{formatDateTime(selectedMapJob.job.due_at)}</dd></div>
                </dl>
                <Link className="button" href={jobHref(selectedMapJob.job)}>Open service job</Link>
              </section>
            ) : <p className="monday-service-empty">No open jobs have usable Customer Site coordinates.</p>}
            {missingCoordinateJobs.length > 0 ? (
              <details>
                <summary>Jobs requiring site coordinates</summary>
                <div>{missingCoordinateJobs.slice(0, 12).map((job) => <Link href={jobHref(job)} key={job.id}>{job.job_number} · {customerName(job)}</Link>)}</div>
              </details>
            ) : null}
          </aside>
        </div>
      ) : null}

      {!loading && view === 'workload' ? (
        <div className="monday-service-workload">
          {workload.map((item) => (
            <section key={item.technician.user_id}>
              <header>
                <div><strong>{item.technician.display_name || item.technician.role}</strong><small>{item.technician.branch.toUpperCase()} · {item.technician.role.replace(/_/g, ' ')}</small></div>
                <span>{item.assigned.length} active</span>
              </header>
              <div className="monday-service-capacity" aria-label={`Workload score ${item.score}`}>
                <span style={{ width: `${Math.max(3, (item.score / maxWorkload) * 100)}%` }} />
              </div>
              <dl>
                <div><dt>Overdue</dt><dd>{item.overdue}</dd></div>
                <div><dt>Critical</dt><dd>{item.critical}</dd></div>
                <div><dt>In progress</dt><dd>{item.inProgress}</dd></div>
              </dl>
              <div>{item.assigned.slice(0, 6).map((job) => <Link href={jobHref(job)} key={job.id}>{job.incident_number} · {customerName(job)}</Link>)}</div>
            </section>
          ))}
        </div>
      ) : null}

      {!loading && view === 'dashboard' ? (
        <div className="monday-service-dashboard">
          <section className="monday-service-kpis">
            <article><span>Active work</span><strong>{activeJobs.length}</strong><small>Jobs not yet terminal</small></article>
            <article><span>Overdue</span><strong>{overdueJobs.length}</strong><small>Past follow-up date</small></article>
            <article><span>Unassigned</span><strong>{unassignedJobs.length}</strong><small>Requires dispatch</small></article>
            <article><span>High priority</span><strong>{highPriorityJobs.length}</strong><small>High or critical</small></article>
            <article><span>Completion</span><strong>{completionRate}%</strong><small>Completed, verified or closed</small></article>
          </section>
          <div className="monday-service-dashboard-grid">
            <section>
              <header><strong>Status distribution</strong></header>
              {grouped.map((group) => (
                <div className="monday-service-distribution" key={group.status}>
                  <span>{group.status.replace(/_/g, ' ')}</span>
                  <div><i style={{ width: `${filteredJobs.length ? Math.max(2, (group.jobs.length / filteredJobs.length) * 100) : 0}%` }} /></div>
                  <strong>{group.jobs.length}</strong>
                </div>
              ))}
            </section>
            <section>
              <header><strong>Attention required</strong></header>
              {[...overdueJobs, ...unassignedJobs.filter((job) => !overdueJobs.some((item) => item.id === job.id))].slice(0, 10).map((job) => (
                <Link href={jobHref(job)} key={job.id}>
                  <JobSummary job={job} technicianName={job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name : undefined} />
                </Link>
              ))}
              {overdueJobs.length + unassignedJobs.length === 0 ? <p>No urgent dispatch exceptions in the current filter.</p> : null}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
