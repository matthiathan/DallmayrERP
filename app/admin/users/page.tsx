'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole, BusinessUser, Department } from '@/types/dallmayrerp';

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
      .order('full_name', { ascending: true });

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

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      ...form,
      email: form.email.trim().toLowerCase(),
      phone_number: form.phone_number || null,
      birthday: form.birthday || null,
      employee_code: form.employee_code || null,
      job_title: form.job_title || null,
    };

    const { error: insertError } = await getSupabaseClient().from('users').insert(payload);
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setSuccess('User created.');
    setForm(emptyForm);
    await loadUsers();
  }

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1>Business Users</h1>
          <p>Manage staff records, contact details, birthdays, departments and ERP roles.</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      {success ? <div className="success">{success}</div> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Add user</h2>
        <form className="form-grid" onSubmit={createUser}>
          <label>
            Employee code
            <input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
          </label>
          <label>
            First name
            <input required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </label>
          <label>
            Last name
            <input required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </label>
          <label>
            Email
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            Phone number
            <input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
          </label>
          <label>
            Birthday
            <input type="date" value={form.birthday} onChange={(e) => setForm({ ...form, birthday: e.target.value })} />
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
            <button className="button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add user'}</button>
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
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}>Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8}>No business users yet.</td></tr>
            ) : users.map((user) => (
              <tr key={user.id}>
                <td>{user.full_name || `${user.first_name} ${user.last_name}`}</td>
                <td>{user.email}</td>
                <td>{user.phone_number || '-'}</td>
                <td>{user.birthday || '-'}</td>
                <td>{user.role}</td>
                <td>{user.department}</td>
                <td>{user.branch || '-'}</td>
                <td>{user.employment_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
