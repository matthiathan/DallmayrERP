'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { ServiceJobRecord, ServiceJobStatus, ServicePriority } from '@/types/enterprise-records';

type TechnicianOption = {
  user_id: string;
  display_name: string;
  role: string;
  branch: Branch;
};

type CustomerRelation = { customer_name: string | null };
type MachineRelation = { machine_name: string | null; serial_number: string | null };
type JobRow = ServiceJobRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
};

const statuses: ServiceJobStatus[] = ['new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled'];
const priorities: ServicePriority[] = ['low', 'medium', 'high', 'critical'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

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
  return value ? new Date(value).toLocaleString('en-ZA') : null;
}

export function EnterpriseServiceJobBoard() {
  const searchParams = useSearchParams();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [search, setSearch] = useState(searchParams.get('job') ?? '');
  const [branchFilter, setBranchFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
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
      const { error: closeError } = await getSupabaseClient().rpc('close_service_job', {
        job_id: job.id,
        remarks: remarks.trim() || null,
      });
      setUpdatingId(null);
      if (closeError) {
        setError(closeError.message);
        return;
      }
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
    if (updateError) {
      setError(updateError.message);
      return;
    }
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
    if (assignmentError) {
      setError(assignmentError.message);
      return;
    }
    setMessage(`${job.job_number} assigned.`);
    await loadBoard();
  }

  const technicianMap = useMemo(
    () => new Map(technicians.map((technician) => [technician.user_id, technician])),
    [technicians],
  );

  const filteredJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const customer = job.customer_name_snapshot ?? firstRelation(job.customers)?.customer_name ?? '';
      const machine = firstRelation(job.machines);
      const technician = job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name ?? '' : '';
      const text = [
        job.id, job.incident_number, job.job_number, job.ticket_case_number,
        job.ticket_reference, job.work_order_number, job.summary, job.complaint_details,
        customer, job.customer_code_snapshot, job.contact_name, job.telephone, job.mobile,
        job.contact_email, job.service_type, job.service_code, job.site_location,
        job.call_type, job.call_reason, job.category, job.sub_category, job.group_3,
        machine?.machine_name, machine?.serial_number, technician,
      ].join(' ').toLowerCase();

      return (!term || text.includes(term))
        && (branchFilter === 'all' || job.branch === branchFilter)
        && (priorityFilter === 'all' || job.priority === priorityFilter);
    });
  }, [branchFilter, jobs, priorityFilter, search, technicianMap]);

  const grouped = useMemo(
    () => statuses.map((status) => ({ status, jobs: filteredJobs.filter((job) => job.status === status) })),
    [filteredJobs],
  );

  return (
    <div className="grid spatial-stage spatial-dashboard service-call-log-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" onClick={() => loadBoard().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh board</button>}
        description="View, search, assign and progress scheduled call-log records through controlled workflow stages. New recurring plans are created under Preventive Maintenance."
        lastUpdated={lastUpdated}
        title="Service dispatch"
      >
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Incident, ticket, WO, customer, contact or machine" type="search" /></label>
        <label>Branch
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value="all">All branches</option>
            {branches.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Priority
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="all">All priorities</option>
            {priorities.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </PageToolbar>

      <div className="grid grid-3 service-call-log-board">
        {grouped.map((group) => (
          <section className="card spatial-card service-call-log-lane" key={group.status}>
            <div className="page-toolbar-heading"><h3>{group.status.replace(/_/g, ' ')}</h3><StatusBadge value={group.status} /></div>
            <p>{group.jobs.length} call log(s)</p>
            <div className="grid">
              {group.jobs.length === 0 ? <div className="feature-pill">No call logs in this stage</div> : null}
              {group.jobs.map((job) => {
                const customer = job.customer_name_snapshot ?? firstRelation(job.customers)?.customer_name ?? 'Customer not linked';
                const machine = firstRelation(job.machines);
                const assignedTechnician = job.assigned_to ? technicianMap.get(job.assigned_to) : null;
                const overdue = Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !['completed', 'verified', 'closed', 'cancelled'].includes(job.status));
                const requirements = [
                  job.parts_extra ? 'Parts extra' : null,
                  job.performance_report_required ? 'Performance report' : null,
                  job.visits_chargeable ? 'Chargeable visit' : null,
                  job.quotation_required ? 'Quotation required' : null,
                ].filter(Boolean) as string[];

                return (
                  <article className="neo-card service-call-log-card" key={job.id}>
                    <div className="page-toolbar-heading">
                      <div><strong>Incident {job.incident_number}</strong><small>{job.job_number}</small></div>
                      <StatusBadge value={job.priority} />
                    </div>
                    <p className="service-call-log-summary"><strong>{job.complaint_details}</strong></p>
                    <dl className="service-call-log-details">
                      <div><dt>Customer</dt><dd>{job.customer_code_snapshot ? `${job.customer_code_snapshot} — ` : ''}{customer}</dd></div>
                      <div><dt>Service</dt><dd>{job.service_code ? `${job.service_code} — ` : ''}{job.service_type}</dd></div>
                      <div><dt>Category</dt><dd>{[job.category, job.sub_category, job.group_3].filter(Boolean).join(' / ') || 'Not classified'}</dd></div>
                      <div><dt>Contact</dt><dd>{job.contact_name || job.telephone || job.mobile || job.contact_email || 'Not recorded'}</dd></div>
                      <div><dt>Site / machine</dt><dd>{job.site_location || 'Site not recorded'} · {machine?.machine_name ?? machine?.serial_number ?? 'Machine not linked'}</dd></div>
                      <div><dt>Call type</dt><dd>{[job.call_type, job.call_reason].filter(Boolean).join(' — ') || 'Not recorded'}</dd></div>
                      <div><dt>WO / Ticket</dt><dd>{job.work_order_number || 'No WO'} · {job.ticket_case_number || 'No ticket case'}</dd></div>
                      <div><dt>Reported</dt><dd>{formatDateTime(job.reported_at)}</dd></div>
                    </dl>
                    {requirements.length > 0 ? <div className="service-call-log-flags">{requirements.map((requirement) => <span key={requirement}>{requirement}</span>)}</div> : null}
                    {job.assignment_notes ? <p className="service-call-log-note"><strong>Assignment notes:</strong> {job.assignment_notes}</p> : null}
                    {job.due_at ? <p>{overdue ? <StatusBadge value="overdue" /> : null} Follow up {formatDateTime(job.due_at)}</p> : null}
                    {job.closed_at ? <p><strong>Closed:</strong> {formatDateTime(job.closed_at)}{job.closing_remarks ? ` — ${job.closing_remarks}` : ''}</p> : null}
                    <label>Technician
                      <select disabled={updatingId === job.id || ['closed', 'cancelled'].includes(job.status)} value={job.assigned_to ?? ''} onChange={(event) => assignJob(job, event.target.value)}>
                        <option value="">Unassigned</option>
                        {technicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role}</option>)}
                      </select>
                    </label>
                    <label>Next status
                      <select disabled={updatingId === job.id} value={job.status} onChange={(event) => updateStatus(job, event.target.value as ServiceJobStatus)}>
                        {nextStatuses(job.status).map((status) => <option key={status}>{status}</option>)}
                      </select>
                    </label>
                    {assignedTechnician ? <small>Assigned to {assignedTechnician.display_name}</small> : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
