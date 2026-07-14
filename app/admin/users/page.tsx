'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole, BusinessUser, Department, UserDetails } from '@/types/dallmayrerp';
import { isProfileComplete } from '@/types/dallmayrerp';

const roles: BusinessRole[] = ['admin', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse_staff', 'technician', 'road_technician'];
const departments: Department[] = ['administration', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse', 'technical', 'field_service'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

const emptyForm = {
  employee_code: '',
  email: '',
  role: 'operations' as BusinessRole,
  department: 'operations' as Department,
  branch: 'jhb' as Branch,
  job_title: '',
  employment_status: 'active' as const,
};

type UserInviteRow = BusinessUser & { details: UserDetails | null };

function nameFromDetails(row: UserInviteRow) {
  return row.details?.full_name?.trim() || row.email;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserInviteRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);

    const client = getSupabaseClient();
    const [{ data: accessRows, error: accessError }, { data: detailsRows, error: detailsError }] = await Promise.all([
      client.from('users').select('*').order('created_at', { ascending: false }),
      client.from('user_details').select('*'),
    ]);

    if (accessError || detailsError) {
      setError(accessError?.message || detailsError?.message || 'Could not load users.');
      setLoading(false);
      return;
    }

    const detailsByUserId = new Map((detailsRows ?? []).map((details) => [details.user_id, details as UserDetails]));
    const rows = (accessRows ?? []).map((user) => ({
      ...(user as BusinessUser),
      details: detailsByUserId.get(user.id) ?? null,
    }));

    setUsers(rows);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createUserInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      email: form.email.trim().toLowerCase(),
      role: form.role,
      department: form.department,
      branch: form.branch,
      employee_code: form.employee_code.trim() || null,
      job_title: form.job_title.trim() || null,
      employment_status: form.employment_status,
      onboarding_required: true,
      profile_completed_at: null,
    };

    const { error: upsertError } = await getSupabaseClient()
      .from('users')
      .upsert(payload, { onConflict: 'email' });

    setSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setSuccess('User invite saved. The employee can now use First login → Activate account with the same email, then complete their profile.');
    setForm(emptyForm);
    await loadUsers();
  }

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Admin only</div>
          <h1>Users & Role Invites</h1>
          <p>Create access records using email, role, department and branch. Employees complete personal details in user_details on first login.</p>
        </div>
      </div>

      {error ? <div className="error" style={{ marginBottom: 18 }}>{error}</div> : null}
      {success ? <div className="success" style={{ marginBottom: 18 }}>{success}</div> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Create access invite</h2>
        <p>Admin controls only access fields. Personal profile fields are completed by the user after first login and stored in public.user_details.</p>
        <form className="form-grid" onSubmit={createUserInvite}>
          <label>
            Employee code
            <input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
          </label>
          <label>
            Email
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as BusinessRole })}>
              {roles.map((role) => <option key={role}>{role}</option>)}
            </select>
          </label>
          <label>
            Department
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value as Department })}>
              {departments.map((department) => <option key={department}>{department}</option>)}
            </select>
          </label>
          <label>
            Branch
            <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value as Branch })}>
              {branches.map((branch) => <option key={branch}>{branch}</option>)}
            </select>
          </label>
          <label>
            Job title
            <input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button className="button pulse-button" type="submit" disabled={saving}>{saving ? 'Saving invite...' : 'Save invite'}</button>
          </div>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name / email</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Birthday</th>
              <th>Role</th>
              <th>Department</th>
              <th>Branch</th>
              <th>Profile</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}>Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9}>No access invites yet.</td></tr>
            ) : users.map((user) => {
              const complete = isProfileComplete(user.details);
              return (
                <tr key={user.id}>
                  <td>{nameFromDetails(user)}</td>
                  <td>{user.email}</td>
                  <td>{user.details?.phone_number || '-'}</td>
                  <td>{user.details?.birthday || '-'}</td>
                  <td>{user.role}</td>
                  <td>{user.department}</td>
                  <td>{user.branch || '-'}</td>
                  <td>{complete ? 'Complete' : 'First login required'}</td>
                  <td>{user.employment_status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
