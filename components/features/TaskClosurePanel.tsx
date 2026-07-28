'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type TaskType = 'technician' | 'road_technician' | 'service_call' | 'preventive_service';
type Outcome = 'completed' | 'follow_up_required' | 'parts_required' | 'customer_unavailable';
type JobStatus = 'assigned' | 'in_progress';
type QueueFilter = 'all' | 'overdue' | 'in_progress' | 'high_priority';
type Relation<T> = T | T[] | null;

type CustomerRelation = {
  customer_name: string | null;
  address: string | null;
};

type SiteRelation = {
  site_name: string | null;
  address: string | null;
};

type MachineRelation = {
  id: string;
  branch: Branch;
  machine_name: string | null;
  model: string | null;
  serial_number: string | null;
  machine_barcode: string | null;
  asset_tag: string | null;
  status: string | null;
};

type AssignedServiceJob = {
  id: string;
  job_number: string;
  incident_number: string;
  branch: Branch;
  status: JobStatus;
  priority: string;
  summary: string;
  complaint_details: string;
  due_at: string | null;
  customer_name_snapshot: string | null;
  address_snapshot: string | null;
  customer_id: string | null;
  site_id: string | null;
  machine_id: string | null;
  customers: Relation<CustomerRelation>;
  customer_sites: Relation<SiteRelation>;
  machines: Relation<MachineRelation>;
};

type CompletionResult = {
  task_closure_id: string;
  job_number: string;
  status: string;
};

const outcomes: Outcome[] = ['completed', 'follow_up_required', 'parts_required', 'customer_unavailable'];
const queueFilters: Array<{ value: QueueFilter; label: string }> = [
  { value: 'all', label: 'All open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'high_priority', label: 'High priority' },
];
const priorityValues = new Set(['high', 'critical', 'urgent']);
const noteTemplates = [
  'Machine tested and operating normally after the work was completed.',
  'Customer was advised that follow-up work is required.',
  'Required parts were identified and must be supplied before completion.',
  'Customer or site contact was unavailable during the visit.',
];
const outcomeCopy: Record<Outcome, { label: string; helper: string }> = {
  completed: { label: 'Completed', helper: 'Work finished and the machine is ready for service.' },
  follow_up_required: { label: 'Follow-up required', helper: 'Additional technical work or another visit is needed.' },
  parts_required: { label: 'Parts required', helper: 'The job cannot be finished until parts are supplied.' },
  customer_unavailable: { label: 'Customer unavailable', helper: 'The visit could not be completed with the customer.' },
};

function firstRelation<T>(relation: Relation<T> | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

function formatDueDate(value: string | null) {
  if (!value) return 'No due date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Due date unavailable';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function isOverdue(job: AssignedServiceJob) {
  if (!job.due_at) return false;
  const dueTime = new Date(job.due_at).getTime();
  return Number.isFinite(dueTime) && dueTime < Date.now();
}

function isHighPriority(job: AssignedServiceJob) {
  return priorityValues.has(job.priority.trim().toLowerCase());
}

function priorityLabel(value: string) {
  const clean = value.trim().replace(/_/g, ' ');
  return clean ? `${clean.charAt(0).toUpperCase()}${clean.slice(1)}` : 'Normal';
}

export function TaskClosurePanel({ taskType }: { taskType: TaskType; defaultBranch?: Branch }) {
  const { businessUser } = useAuth();
  const executionRef = useRef<HTMLDivElement | null>(null);
  const [jobs, setJobs] = useState<AssignedServiceJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [machineCode, setMachineCode] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('completed');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const selectedMachine = firstRelation(selectedJob?.machines);
  const selectedCustomer = firstRelation(selectedJob?.customers);
  const selectedSite = firstRelation(selectedJob?.customer_sites);

  const machineCodes = useMemo(() => {
    if (!selectedMachine) return [];
    return [selectedMachine.machine_barcode, selectedMachine.serial_number, selectedMachine.asset_tag]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
  }, [selectedMachine]);

  const cleanMachineCode = machineCode.trim().toLowerCase();
  const machineMatchState = !cleanMachineCode
    ? 'idle'
    : machineCodes.includes(cleanMachineCode)
      ? 'match'
      : 'mismatch';

  const queueMetrics = useMemo(() => ({
    open: jobs.length,
    overdue: jobs.filter(isOverdue).length,
    inProgress: jobs.filter((job) => job.status === 'in_progress').length,
    highPriority: jobs.filter(isHighPriority).length,
  }), [jobs]);

  const filteredJobs = useMemo(() => jobs.filter((job) => {
    if (queueFilter === 'overdue') return isOverdue(job);
    if (queueFilter === 'in_progress') return job.status === 'in_progress';
    if (queueFilter === 'high_priority') return isHighPriority(job);
    return true;
  }), [jobs, queueFilter]);

  const loadJobs = useCallback(async () => {
    if (!businessUser) {
      setJobs([]);
      setLoadingJobs(false);
      return;
    }

    setLoadingJobs(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('service_jobs')
      .select('id, job_number, incident_number, branch, status, priority, summary, complaint_details, due_at, customer_name_snapshot, address_snapshot, customer_id, site_id, machine_id, customers(customer_name, address), customer_sites(site_name, address), machines(id, branch, machine_name, model, serial_number, machine_barcode, asset_tag, status)')
      .eq('assigned_to', businessUser.id)
      .in('status', ['assigned', 'in_progress'])
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(100);

    setLoadingJobs(false);
    if (loadError) {
      setJobs([]);
      setError(`Assigned service jobs could not be loaded: ${loadError.message}`);
      return;
    }

    const assignedJobs = (data ?? []) as AssignedServiceJob[];
    setJobs(assignedJobs);
    setSelectedJobId((current) => assignedJobs.some((job) => job.id === current) ? current : '');
  }, [businessUser]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const previewUrl = URL.createObjectURL(photo);
    setPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [photo]);

  function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    setMachineCode('');
    setOutcome('completed');
    setNotes('');
    setPhoto(null);
    setPhotoInputKey((value) => value + 1);
    setError(null);
    setSuccess(null);
    window.setTimeout(() => executionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  function addNoteTemplate(template: string) {
    setNotes((current) => current.trim() ? `${current.trim()}\n${template}` : template);
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoInputKey((value) => value + 1);
  }

  async function completeJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !selectedJob) return;

    if (!selectedMachine) {
      setError('Operations must link this service job to a machine before it can be completed.');
      return;
    }

    if (!machineCode.trim()) {
      setError('Scan or enter the assigned machine code before completing the job.');
      return;
    }

    if (machineMatchState !== 'match') {
      setError('The scanned machine code does not match the machine assigned to this job.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const client = getSupabaseClient();
    let photoPath: string | null = null;

    if (photo) {
      const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      photoPath = `${taskType}/${businessUser.id}/${selectedJob.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await client.storage
        .from('dallmayrerp-task-photos')
        .upload(photoPath, photo, { upsert: false });

      if (uploadError) {
        setSaving(false);
        setError(uploadError.message);
        return;
      }
    }

    const { data, error: completionError } = await client.rpc('complete_assigned_service_job', {
      p_service_job_id: selectedJob.id,
      p_machine_code: machineCode.trim(),
      p_outcome: outcome,
      p_notes: notes.trim() || null,
      p_photo_bucket: photoPath ? 'dallmayrerp-task-photos' : null,
      p_photo_path: photoPath,
    });

    if (completionError) {
      let cleanupWarning = '';
      if (photoPath) {
        const { error: cleanupError } = await client.storage
          .from('dallmayrerp-task-photos')
          .remove([photoPath]);
        if (cleanupError) cleanupWarning = ` The uploaded photo could not be removed: ${cleanupError.message}`;
      }

      setSaving(false);
      setError(`${completionError.message}${cleanupWarning}`);
      return;
    }

    const result = (Array.isArray(data) ? data[0] : data) as CompletionResult | null;
    const completedJobNumber = result?.job_number ?? selectedJob.job_number;

    setSelectedJobId('');
    setMachineCode('');
    setOutcome('completed');
    setNotes('');
    setPhoto(null);
    setPhotoInputKey((value) => value + 1);
    setSaving(false);
    setSuccess(`${completedJobNumber} completed. Closure, scan and audit evidence were recorded together.`);
    await loadJobs();
  }

  const roleLabel = taskType === 'road_technician' ? 'road technician' : 'technician';
  const roleTitle = taskType === 'road_technician' ? 'Road technician field queue' : 'Technician job queue';
  const machineLabel = selectedMachine
    ? selectedMachine.machine_name ?? selectedMachine.model ?? selectedMachine.serial_number ?? selectedMachine.machine_barcode ?? 'Linked machine'
    : 'No machine linked';
  const customerLabel = selectedJob?.customer_name_snapshot ?? selectedCustomer?.customer_name ?? 'Customer not set';
  const siteLabel = selectedSite?.site_name ?? selectedSite?.address ?? selectedJob?.address_snapshot ?? selectedCustomer?.address ?? 'Site not set';
  const canSubmit = Boolean(selectedJob && selectedMachine && machineMatchState === 'match' && !saving);

  return (
    <div className="field-service-workspace">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {success ? <div className="success" role="status">{success}</div> : null}

      <section aria-label={`${roleLabel} job summary`} className="field-service-summary">
        <div className="field-service-metric"><span>Open jobs</span><strong>{queueMetrics.open}</strong><small>Assigned or in progress</small></div>
        <div className={`field-service-metric ${queueMetrics.overdue > 0 ? 'is-risk' : ''}`}><span>Overdue</span><strong>{queueMetrics.overdue}</strong><small>Past the job due time</small></div>
        <div className="field-service-metric"><span>In progress</span><strong>{queueMetrics.inProgress}</strong><small>Work already underway</small></div>
        <div className={`field-service-metric ${queueMetrics.highPriority > 0 ? 'is-attention' : ''}`}><span>High priority</span><strong>{queueMetrics.highPriority}</strong><small>High, urgent or critical</small></div>
      </section>

      <div className="field-service-layout">
        <aside className="neo-card field-job-queue" aria-label={roleTitle}>
          <div className="field-job-queue-header">
            <div>
              <span className="minimal-kicker">My assigned work</span>
              <h2>{roleTitle}</h2>
              <p>Open a job to review the customer, machine and closure requirements.</p>
            </div>
            <button className="button secondary field-queue-refresh" disabled={loadingJobs} onClick={() => void loadJobs()} type="button">
              {loadingJobs ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="field-job-filter-row" role="group" aria-label="Filter assigned jobs">
            {queueFilters.map((filter) => (
              <button
                aria-pressed={queueFilter === filter.value}
                className={queueFilter === filter.value ? 'active' : ''}
                key={filter.value}
                onClick={() => setQueueFilter(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="field-job-list">
            {loadingJobs ? (
              <div className="field-job-loading" role="status">
                <span />
                <span />
                <span />
              </div>
            ) : null}

            {!loadingJobs && filteredJobs.length === 0 ? (
              <div className="field-job-empty">
                <strong>No matching jobs</strong>
                <p>{jobs.length === 0 ? `There are no assigned or in-progress jobs for this ${roleLabel} account.` : 'Choose another queue filter to see the remaining assigned work.'}</p>
              </div>
            ) : null}

            {filteredJobs.map((job) => {
              const customer = firstRelation(job.customers);
              const site = firstRelation(job.customer_sites);
              const machine = firstRelation(job.machines);
              const jobCustomer = job.customer_name_snapshot ?? customer?.customer_name ?? 'Customer not set';
              const jobSite = site?.site_name ?? site?.address ?? job.address_snapshot ?? customer?.address ?? 'Site not set';
              const jobMachine = machine?.machine_name ?? machine?.model ?? machine?.serial_number ?? machine?.machine_barcode ?? 'Machine not linked';
              const overdue = isOverdue(job);
              const selected = job.id === selectedJobId;

              return (
                <button
                  aria-pressed={selected}
                  className={`field-job-card ${selected ? 'selected' : ''} ${overdue ? 'overdue' : ''}`}
                  key={job.id}
                  onClick={() => selectJob(job.id)}
                  type="button"
                >
                  <span className="field-job-card-top">
                    <span>
                      <strong>{job.job_number}</strong>
                      <small>Incident {job.incident_number}</small>
                    </span>
                    <StatusBadge value={job.status} />
                  </span>
                  <span className="field-job-card-title">{job.summary}</span>
                  <span className="field-job-card-location">{jobCustomer} · {jobSite}</span>
                  <span className="field-job-card-machine">{jobMachine}</span>
                  <span className="field-job-card-meta">
                    <span className={overdue ? 'is-overdue' : ''}>{formatDueDate(job.due_at)}</span>
                    <span>{priorityLabel(job.priority)} priority</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="neo-card field-execution" ref={executionRef}>
          <div className="field-execution-header">
            <div>
              <span className="minimal-kicker">Guided completion</span>
              <h2>{selectedJob ? `Complete ${selectedJob.job_number}` : 'Select an assigned job'}</h2>
              <p>{selectedJob ? 'Verify the exact machine, record the result and add evidence before submitting.' : 'Choose a job from your queue to begin the controlled closure workflow.'}</p>
            </div>
          </div>

          <ol className="field-stepper" aria-label="Job completion steps">
            <li className={selectedJob ? 'complete' : 'current'}><span>1</span><strong>Choose job</strong></li>
            <li className={machineMatchState === 'match' ? 'complete' : selectedJob ? 'current' : ''}><span>2</span><strong>Verify machine</strong></li>
            <li className={selectedJob && machineMatchState === 'match' ? 'current' : ''}><span>3</span><strong>Record result</strong></li>
            <li className={photo || notes.trim() ? 'complete' : ''}><span>4</span><strong>Add evidence</strong><small>Optional</small></li>
          </ol>

          {!selectedJob ? (
            <div className="field-execution-empty">
              <strong>Your queue is ready</strong>
              <p>Select the next assigned job. Overdue and high-priority work is highlighted in the queue.</p>
            </div>
          ) : (
            <form className="field-completion-form" onSubmit={completeJob}>
              <section className="field-form-section">
                <div className="field-section-header">
                  <div><span>Job details</span><h3>{selectedJob.summary}</h3></div>
                  <StatusBadge value={selectedJob.status} />
                </div>
                <p>{selectedJob.complaint_details || 'No complaint details were captured for this job.'}</p>
                <dl className="field-job-details">
                  <div><dt>Customer</dt><dd>{customerLabel}</dd></div>
                  <div><dt>Site</dt><dd>{siteLabel}</dd></div>
                  <div><dt>Machine</dt><dd>{machineLabel}</dd></div>
                  <div><dt>Due</dt><dd className={isOverdue(selectedJob) ? 'is-overdue' : ''}>{formatDueDate(selectedJob.due_at)}</dd></div>
                  <div><dt>Priority</dt><dd>{priorityLabel(selectedJob.priority)}</dd></div>
                  <div><dt>Branch</dt><dd>{selectedJob.branch.toUpperCase()}</dd></div>
                </dl>
                {!selectedMachine ? <div className="error">This job has no linked machine. Operations must correct the assignment.</div> : null}
              </section>

              <section className="field-form-section">
                <div className="field-section-header"><div><span>Step 2</span><h3>Verify the assigned machine</h3></div></div>
                <p>Scan or enter the machine barcode, serial number or asset tag. The value must match the machine assigned by Operations.</p>
                <BarcodeCapture
                  label="Assigned machine barcode / serial / asset tag"
                  onChange={setMachineCode}
                  value={machineCode}
                />
                {selectedMachine && machineCodes.length === 0 ? <div className="error">The linked machine has no barcode, serial number or asset tag. Operations must update the machine record.</div> : null}
                {selectedMachine && machineCodes.length > 0 ? (
                  <div aria-live="polite" className={`field-machine-match ${machineMatchState}`}>
                    {machineMatchState === 'idle' ? 'Waiting for a machine scan.' : null}
                    {machineMatchState === 'match' ? 'Machine verified. You can continue with the closure.' : null}
                    {machineMatchState === 'mismatch' ? 'This code does not match the assigned machine. Check the machine and scan again.' : null}
                  </div>
                ) : null}
              </section>

              <section className="field-form-section">
                <div className="field-section-header"><div><span>Step 3</span><h3>Record the outcome</h3></div></div>
                <div className="field-outcome-grid">
                  {outcomes.map((item) => (
                    <label className={`field-outcome-option ${outcome === item ? 'selected' : ''}`} key={item}>
                      <input checked={outcome === item} name="outcome" onChange={() => setOutcome(item)} type="radio" value={item} />
                      <span><strong>{outcomeCopy[item].label}</strong><small>{outcomeCopy[item].helper}</small></span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="field-form-section">
                <div className="field-section-header"><div><span>Step 4</span><h3>Add notes and proof</h3></div><small>Optional but recommended</small></div>
                <div className="field-note-templates" aria-label="Closure note templates">
                  {noteTemplates.map((template) => <button key={template} onClick={() => addNoteTemplate(template)} type="button">+ {template}</button>)}
                </div>
                <label className="field-textarea-label">Closure notes<textarea onChange={(event) => setNotes(event.target.value)} placeholder="Describe the work completed, checks performed, outstanding risk or required follow-up." value={notes} /></label>
                <label className="field-photo-input">
                  <span>Closure photo</span>
                  <input
                    accept="image/*"
                    capture="environment"
                    key={photoInputKey}
                    onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
                {photoPreview ? (
                  <div className="field-photo-preview">
                    <img alt="Selected closure proof preview" src={photoPreview} />
                    <div><strong>{photo?.name}</strong><small>{photo ? `${Math.max(1, Math.round(photo.size / 1024))} KB` : ''}</small><button className="button secondary" onClick={removePhoto} type="button">Remove photo</button></div>
                  </div>
                ) : null}
              </section>

              <div className="field-submit-bar">
                <div>
                  <strong>{machineMatchState === 'match' ? 'Ready to submit' : 'Machine verification required'}</strong>
                  <span>The database will record the closure, scan, job transition and audit event together.</span>
                </div>
                <button className="button pulse-button" disabled={!canSubmit} type="submit">
                  {saving ? 'Completing assigned job…' : `Complete ${selectedJob.job_number}`}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
