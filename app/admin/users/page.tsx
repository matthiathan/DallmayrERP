'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole, BusinessUser, Department } from '@/types/dallmayrerp';
import { displayUserName } from '@/types/dallmayrerp';

const roles: BusinessRole[] = ['admin', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse_staff', 'technician', 'road_technician'];
const departments: Department[] = ['administration', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse', 'technical', 'field_service'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

const emptyForm = {
  employee_code: '',
  first_name: '',
  last_name: '',
  email: '',
  phone_number: '',
  birthday: '',
  role: 'operations' as BusinessRole,
  department: 'operations' as Department,
  branch: 'jhb' as Branch,
  job_title: '',
  employment_status: 'active' as const,
};

export default function UsersPage() {
  const [users, setUsers] = useState<BusinessUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getSupabaseClient()
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (loadError) {
      setError(loadError.message);
    } else {
      setUsers((data ?? []) as BusinessUser[]);
    }
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
      first_name: form.first_name.trim() || null,
      last_name: form.last_name.trim() || null,
      phone_number: form.phone_number.trim() || null,
      birthday: form.birthday || null,
      job_title: form.job_title.trim() || null,
      employment_status: form.employment_status,
      onboarding_required: !(form.first_name.trim() && form.last_name.trim() && form.phone_number.trim()),
      profile_completed_at: form.first_name.trim() && form.last_name.trim() && form.phone_number.trim() ? new Date().toISOString() : null,
    };

    const { error: upsertError } = await getSupabaseClient()
      .from('users')
      .upsert(payload, { onConflict: 'email' });

    setSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    setSuccess('User invite saved. Create or invite the matching Supabase Auth account using the same email, then the user will complete missing personal details on first login.');
    setForm(emptyForm);
    await loadUsers();
  }

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Admin only</div>
          <h1>Users & Role Invites</h1>
          <p>Create controlled business profiles. Users complete their personal details on first login only.</p>
        </div>
      </div>

      {error ? <div className="error" style={{ marginBottom: 18 }}>{error}</div> : null}
      {success ? <div className="success" style={{ marginBottom: 18 }}>{success}</div> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Create user invite</h2>
        <p>Admin controls role, department and branch. First name, last name, phone and birthday can be left blank for the employee to complete during onboarding.</p>
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
          <label>
            First name optional
            <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </label>
          <label>
            Last name optional
            <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </label>
          <label>
            Phone optional
            <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
          </label>
          <label>
            Birthday optional
            <input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
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
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Birthday</th>
              <th>Role</th>
              <th>Department</th>
              <th>Branch</th>
              <th>Onboarding</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}>Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9}>No business users yet.</td></tr>
            ) : users.map((user) => (
              <tr key={user.id}>
                <td>{displayUserName(user)}</td>
                <td>{user.email}</td>
                <td>{user.phone_number || '-'}</td>
                <td>{user.birthday || '-'}</td>
                <td>{user.role}</td>
                <td>{user.department}</td>
                <td>{user.branch || '-'}</td>
                <td>{user.onboarding_required ? 'Required' : 'Complete'}</td>
                <td>{user.employment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
