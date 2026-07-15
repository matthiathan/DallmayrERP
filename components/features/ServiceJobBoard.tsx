'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';
import { recordAuditEvent } from '@/lib/data/audit';
import type { Branch } from '@/types/dallmayrerp';

type JobStatus = 'new' | 'assigned' | 'in_progress' | 'completed' | 'verified' | 'closed' | 'cancelled';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type JobRow = { id: string; job_number: string; branch: Branch; priority: Priority; status: JobStatus; title: string; description: string | null; due_at: string | null; created_at: string };

const statuses: JobStatus[] = ['new', 'assigned', 'in_progress', 'completed', 'verified', 'closed', 'cancelled'];
const priorities: Priority[] = ['low', 'medium', 'high', 'critical'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

export function ServiceJobBoard() {
  const { businessUser, userDetails } = useAuth();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [branch, setBranch] = useState<Branch>(userDetails?.branch ?? 'jhb');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadJobs() {
    const { data, error: loadError } = await getSupabaseClient()
      .from('service_jobs')
      .select('id, job_number, branch, priority, status, title, description, due_at, created_at')
      .order('created_at', { ascending: false })
      .limit(120);
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setJobs((data ?? []) as JobRow[]);
  }

  useEffect(() => {
    loadJobs();
  }, []);

  const grouped = useMemo(() => statuses.map((status) => ({ status, jobs: jobs.filter((job) => job.status === status) })), [jobs]);

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessUser || !title.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const client = getSupabaseClient();
    const jobNumber = `SJ-${branch.toUpperCase()}-${Date.now()}`;
    const { data, error: createError } = await client.from('service_jobs').insert({
      branch,
      priority,
      job_number: jobNumber,
      title: title.trim(),
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
      summary: `${data.job_number} created: ${title.trim()}`,
      afterPayload: { branch, priority, title, due_at: dueAt || null },
    });

    setMessage(`${data.job_number} created.`);
    setTitle('');
    setDescription('');
    setDueAt('');
    await loadJobs();
  }

  async function updateStatus(job: JobRow, status: JobStatus) {
    if (!businessUser || job.status === status) return;
    const client = getSupabaseClient();
    const patch: Record<string, string> = { status };
    if (status === 'completed') patch.completed_at = new Date().toISOString();
    const { error: updateError } = await client.from('service_jobs').update(patch).eq('id', job.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await recordAuditEvent(client, {
      actorUserId: businessUser.id,
      actorRole: userDetails?.role,
      branch: job.branch,
      entityType: 'service_job',
      entityId: job.id,
      action: 'service_job_status_changed',
      summary: `${job.job_number} changed from ${job.status} to ${status}.`,
      beforePayload: { status: job.status },
      afterPayload: { status },
    });
    await loadJobs();
  }

  return (
    <div className="grid spatial-stage spatial-dashboard">
      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}
      <div className="neo-card spatial-service-heat spatial-card">
        <h2>Service job assignment board</h2>
        <p>Create, prioritise and move service work through the enterprise service workflow.</p>
        <form className="grid" onSubmit={createJob}>
          <div className="form-grid">
            <label>Branch<select value={branch} onChange={(event) => setBranch(event.target.value as Branch)}>{branches.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          </div>
          <label>Job title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <button className="button pulse-button" disabled={saving || !title.trim()} type="submit">{saving ? 'Creating job...' : 'Create service job'}</button>
        </form>
      </div>
      <div className="grid grid-3">
        {grouped.map((group) => (
          <div className="card spatial-card" key={group.status}>
            <h3>{group.status}</h3>
            <p>{group.jobs.length} job(s)</p>
            {group.jobs.slice(0, 8).map((job) => (
              <div className="neo-card" key={job.id} style={{ marginBottom: 10 }}>
                <strong>{job.job_number}</strong>
                <p>{job.title}<br />{job.branch.toUpperCase()} • {job.priority}</p>
                <select value={job.status} onChange={(event) => updateStatus(job, event.target.value as JobStatus)}>
                  {statuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
