'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { BarcodeCapture } from '@/components/ui/BarcodeCapture';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch } from '@/types/dallmayrerp';

type TaskType = 'technician' | 'road_technician' | 'service_call' | 'preventive_service';
type Outcome = 'completed' | 'follow_up_required' | 'parts_required' | 'customer_unavailable';
type JobStatus = 'assigned' | 'in_progress';
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

function firstRelation<T>(relation: Relation<T> | undefined): T | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

function formatDueDate(value: string | null) {
  if (!value) return 'No due date';
  return new Intl.DateTimeFormat('en-ZA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function TaskClosurePanel({ taskType }: { taskType: TaskType; defaultBranch?: Branch }) {
  const { businessUser } = useAuth();
  const [jobs, setJobs] = useState<AssignedServiceJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [machineCode, setMachineCode] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('completed');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
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

  const loadJobs = useCallback(async () => {
    if (!businessUser) {
      setJobs([]);
      setLoadingJobs(false);
      return;
    }

    setLoadingJobs(true);
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

  function selectJob(jobId: string) {
    setSelectedJobId(jobId);
    setMachineCode('');
    setError(null);
    setSuccess(null);
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
  const machineLabel = selectedMachine
    ? selectedMachine.machine_name ?? selectedMachine.model ?? selectedMachine.serial_number ?? selectedMachine.machine_barcode ?? 'Linked machine'
    : 'No machine linked';
  const customerLabel = selectedJob?.customer_name_snapshot ?? selectedCustomer?.customer_name ?? 'Customer not set';
  const siteLabel = selectedSite?.site_name ?? selectedSite?.address ?? selectedJob?.address_snapshot ?? selectedCustomer?.address ?? 'Site not set';

  return (
    <div className="neo-card">
      <h2>Complete assigned service job</h2>
      <p>Select work assigned by Operations, scan the linked machine, capture the outcome and submit proof. The job cannot be completed against another machine.</p>
      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <form className="grid" onSubmit={completeJob}>
        <label>
          Assigned job
          <select
            disabled={loadingJobs || saving}
            onChange={(event) => selectJob(event.target.value)}
            required
            value={selectedJobId}
          >
            <option value="">{loadingJobs ? 'Loading assigned jobs...' : 'Select an assigned service job'}</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.job_number} · {job.status.replace('_', ' ')} · {job.summary}
              </option>
            ))}
          </select>
        </label>

        {!loadingJobs && jobs.length === 0 ? (
          <div className="field-note">There are no assigned or in-progress service jobs for this {roleLabel} account.</div>
        ) : null}

        {selectedJob ? (
          <div className="neo-card">
            <strong>{selectedJob.job_number} · Incident {selectedJob.incident_number}</strong>
            <p>{selectedJob.complaint_details}</p>
            <div className="feature-list">
              <div className="feature-pill">{selectedJob.branch.toUpperCase()} · {selectedJob.priority} priority</div>
              <div className="feature-pill">Due: {formatDueDate(selectedJob.due_at)}</div>
              <div className="feature-pill">Customer: {customerLabel}</div>
              <div className="feature-pill">Site: {siteLabel}</div>
              <div className="feature-pill">Machine: {machineLabel}</div>
            </div>
            {!selectedMachine ? <div className="error">This job has no linked machine. Operations must correct the assignment.</div> : null}
          </div>
        ) : null}

        <BarcodeCapture
          label="Assigned machine barcode / serial / asset tag"
          onChange={setMachineCode}
          value={machineCode}
        />
        {selectedMachine ? (
          <div className="field-note">
            The scanned value must exactly match the linked machine barcode, serial number or asset tag.
          </div>
        ) : null}

        <label>
          Outcome
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as Outcome)}>
            {outcomes.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label>Closure notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label>
          Closure photo
          <input
            accept="image/*"
            capture="environment"
            key={photoInputKey}
            type="file"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          className="button pulse-button"
          disabled={saving || !selectedJob || !selectedMachine || !machineCode.trim()}
          type="submit"
        >
          {saving ? 'Completing assigned job...' : 'Complete assigned job'}
        </button>
      </form>
    </div>
  );
}
