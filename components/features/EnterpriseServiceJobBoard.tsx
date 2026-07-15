'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { CustomerSelect, type CustomerOption } from '@/components/ui/CustomerSelect';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { recordAuditEvent } from '@/lib/data/audit';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';
import type { ServiceJobRecord, ServiceJobStatus, ServicePriority } from '@/types/enterprise-records';

type CustomerRelation = { customer_name: string | null };
type MachineRelation = { machine_name: string | null; serial_number: string | null };
type JobRow = ServiceJobRecord & {
  customers?: CustomerRelation | CustomerRelation[] | null;
  machines?: MachineRelation | MachineRelation[] | null;
};
type TechnicianOption = { user_id: string; display_name: string; role: string; branch: Branch };
type SiteOption = { id: string; site_name: string; address: string | null };
type MachineOption = { id: string; machine_name: string | null; serial_number: string | null; machine_barcode: string | null; site_id: string | null };

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

export function EnterpriseServiceJobBoard() {
  const searchParams = useSearchParams();
  const { businessUser, userDetails } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'jhb');
  const [priority, setPriority] = useState<ServicePriority>('medium');
  const [dueAt, setDueAt] = useState('');
  const [search, setSearch] = useState(searchParams.get('job') ?? '');
  const [branchFilter, setBranchFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadBoard() {
    setError(null);
    const client = getSupabaseClient();
    const [jobsResult, techniciansResult] = await Promise.all([
      client.from('service_jobs')
        .select('id, job_number, branch, customer_id, site_id, machine_id, assigned_to, priority, status, summary, description, due_at, completed_at, created_at, customers(customer_name), machines(machine_name, serial_number)')
        .order('created_at', { ascending: false })
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

  async function applyCustomer(customer: CustomerOption | null) {
    setCustomerId(customer?.id ?? null);
    setCustomerName(customer?.customer_name ?? '');
    setSiteId('');
    setMachineId('');
    setSites([]);
    setMachines([]);
    if (!customer) return;
    setBranch(customer.branch);
    const client = getSupabaseClient();
    const [siteResult, machineResult] = await Promise.all([
      client.from('customer_sites').select('id, site_name, address').eq('customer_id', customer.id).order('site_name'),
      client.from('machines').select('id, machine_name, serial_number, machine_barcode, site_id').eq('customer_id', customer.id).order('machine_name'),
    ]);
    if (siteResult.error || machineResult.error) {
      setError(siteResult.error?.message ?? machineResult.error?.message ?? 'Could not load customer assets.');
      return;
    }
    setSites((siteResult.data ?? []) as SiteOption[]);
    setMachines((machineResult.data ?? []) as MachineOption[]);
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !summary.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const client = getSupabaseClient();
    const jobNumber = `SJ-${branch.toUpperCase()}-${Date.now()}`;
    const initialStatus: ServiceJobStatus = assignedTo ? 'assigned' : 'new';
    const { data, error: createError } = await client.from('service_jobs').insert({
      branch,
      customer_id: customerId,
      site_id: siteId || null,
      machine_id: machineId || null,
      assigned_to: assignedTo || null,
      priority,
      status: initialStatus,
      job_number: jobNumber,
      summary: summary.trim(),
      description: description.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      created_by: businessUser.id,
    }).select('id, job_number').single();
    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }
    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch,
      entityType: 'service_job',
      entityId: data.id,
      action: 'service_job_created',
      summary: `${data.job_number} created: ${summary.trim()}`,
      afterPayload: { customer_id: customerId, site_id: siteId || null, machine_id: machineId || null, assigned_to: assignedTo || null, branch, priority, status: initialStatus, summary: summary.trim(), due_at: dueAt || null },
    });
    setMessage(`${data.job_number} created.`);
    setSummary('');
    setDescription('');
    setDueAt('');
    setAssignedTo('');
    await loadBoard();
  }

  async function updateStatus(job: JobRow, status: ServiceJobStatus) {
    if (job.status === status) return;
    setUpdatingId(job.id);
    setError(null);
    const { error: updateError } = await getSupabaseClient().rpc('transition_service_job', { job_id: job.id, new_status: status });
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
    const { error: assignmentError } = await getSupabaseClient().rpc('assign_service_job', { job_id: job.id, assignee_id: technicianId });
    setUpdatingId(null);
    if (assignmentError) {
      setError(assignmentError.message);
      return;
    }
    setMessage(`${job.job_number} assigned.`);
    await loadBoard();
  }

  const technicianMap = useMemo(() => new Map(technicians.map((technician) => [technician.user_id, technician])), [technicians]);
  const filteredJobs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return jobs.filter((job) => {
      const customer = firstRelation(job.customers)?.customer_name ?? '';
      const machine = firstRelation(job.machines);
      const technician = job.assigned_to ? technicianMap.get(job.assigned_to)?.display_name ?? '' : '';
      const text = [job.id, job.job_number, job.summary, customer, machine?.machine_name, machine?.serial_number, technician].join(' ').toLowerCase();
      return (!term || text.includes(term)) && (branchFilter === 'all' || job.branch === branchFilter) && (priorityFilter === 'all' || job.priority === priorityFilter);
    });
  }, [branchFilter, jobs, priorityFilter, search, technicianMap]);
  const grouped = useMemo(() => statuses.map((status) => ({ status, jobs: filteredJobs.filter((job) => job.status === status) })), [filteredJobs]);

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="neo-card spatial-service-heat spatial-card">
        <h2>Create service job</h2>
        <p>Link service work to the customer, site, machine and assigned technician.</p>
        <form className="grid" onSubmit={createJob}>
          <div className="form-grid">
            <CustomerSelect label="Customer" onSelect={applyCustomer} value={customerName} />
            <label>Site<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">No site selected</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select></label>
            <label>Machine<select value={machineId} onChange={(event) => setMachineId(event.target.value)}><option value="">No machine selected</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.machine_name ?? machine.serial_number ?? machine.machine_barcode ?? 'Unnamed machine'}</option>)}</select></label>
          </div>
          <div className="form-grid">
            <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as ServicePriority)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Technician<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">Unassigned</option>{technicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role} - {technician.branch.toUpperCase()}</option>)}</select></label>
          </div>
          <label>Job summary<input required value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
          <div className="form-grid">
            <label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          </div>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <button className="button pulse-button" disabled={saving || !summary.trim()} type="submit">{saving ? 'Creating job...' : 'Create service job'}</button>
        </form>
      </div>

      <PageToolbar
        actions={<button className="button secondary" onClick={() => loadBoard().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Refresh failed.'))} type="button">Refresh board</button>}
        description="Filter service work and move it only through valid workflow stages."
        lastUpdated={lastUpdated}
        title="Service dispatch"
      >
        <label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job, customer, machine or technician" type="search" /></label>
        <label>Branch<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">All branches</option>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
      </PageToolbar>

      <div className="grid grid-3">
        {grouped.map((group) => (
          <section className="card spatial-card" key={group.status}>
            <div className="page-toolbar-heading"><h3>{group.status.replace(/_/g, ' ')}</h3><StatusBadge value={group.status} /></div>
            <p>{group.jobs.length} job(s)</p>
            <div className="grid">
              {group.jobs.length === 0 ? <div className="feature-pill">No jobs in this stage</div> : null}
              {group.jobs.map((job) => {
                const customer = firstRelation(job.customers)?.customer_name ?? 'Customer not linked';
                const machine = firstRelation(job.machines);
                const assignedTechnician = job.assigned_to ? technicianMap.get(job.assigned_to) : null;
                const overdue = Boolean(job.due_at && new Date(job.due_at).getTime() < Date.now() && !['completed', 'verified', 'closed', 'cancelled'].includes(job.status));
                return (
                  <article className="neo-card" key={job.id}>
                    <div className="page-toolbar-heading"><strong>{job.job_number}</strong><StatusBadge value={job.priority} /></div>
                    <p><strong>{job.summary}</strong><br />{customer}<br />{machine?.machine_name ?? machine?.serial_number ?? 'Machine not linked'}<br />{job.branch.toUpperCase()}</p>
                    {job.due_at ? <p>{overdue ? <StatusBadge value="overdue" /> : null} Due {new Date(job.due_at).toLocaleString()}</p> : null}
                    <label>Technician<select disabled={updatingId === job.id} value={job.assigned_to ?? ''} onChange={(event) => assignJob(job, event.target.value)}><option value="">Unassigned</option>{technicians.map((technician) => <option key={technician.user_id} value={technician.user_id}>{technician.display_name || technician.role}</option>)}</select></label>
                    <label>Next status<select disabled={updatingId === job.id} value={job.status} onChange={(event) => updateStatus(job, event.target.value as ServiceJobStatus)}>{nextStatuses(job.status).map((status) => <option key={status}>{status}</option>)}</select></label>
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
