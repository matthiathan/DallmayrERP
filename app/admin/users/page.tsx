'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole, BusinessUser, UserDetails } from '@/types/dallmayrerp';
import { displayDetailsName, isProfileComplete } from '@/types/dallmayrerp';

const roles: BusinessRole[] = ['admin', 'operations', 'sales', 'finance', 'marketing', 'executive', 'warehouse_staff', 'technician', 'road_technician'];
const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

const emptyForm = {
  email: '',
  role: 'operations' as BusinessRole,
  branch: 'jhb' as Branch,
};

type UserInviteRow = BusinessUser & { details: UserDetails | null };

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

    const client = getSupabaseClient();
    const cleanEmail = form.email.trim().toLowerCase();

    const { data: userRow, error: userError } = await client
      .from('users')
      .upsert({ email: cleanEmail }, { onConflict: 'email' })
      .select('*')
      .single();

    if (userError || !userRow) {
      setSaving(false);
      setError(userError?.message || 'Could not save user invite.');
      return;
    }

    const { error: detailsError } = await client
      .from('user_details')
      .upsert({
        user_id: userRow.id,
        role: form.role,
        branch: form.branch,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    setSaving(false);

    if (detailsError) {
      setError(detailsError.message);
      return;
    }

    setSuccess('User invite saved. The employee can now use First login → Activate account with the same email, then complete their personal profile.');
    setForm(emptyForm);
    await loadUsers();
  }

  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Admin only</div>
          <h1>Users & Role Invites</h1>
          <p>Create a user with email only, then assign their role and branch in user_details. Employees fill in the remaining details on first login.</p>
        </div>
      </div>

      {error ? <div className="error" style={{ marginBottom: 18 }}>{error}</div> : null}
      {success ? <div className="success" style={{ marginBottom: 18 }}>{success}</div> : null}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Create access invite</h2>
        <p>Admin controls email, role and branch. First name, last name, phone number, birthday and emergency contact are completed by the user.</p>
        <form className="form-grid" onSubmit={createUserInvite}>
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
            Branch
            <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value as Branch })}>
              {branches.map((branch) => <option key={branch}>{branch}</option>)}
            </select>
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
              <th>Branch</th>
              <th>Emergency Contact</th>
              <th>Profile</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}>Loading users...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8}>No access invites yet.</td></tr>
            ) : users.map((user) => {
              const complete = isProfileComplete(user.details);
              return (
                <tr key={user.id}>
                  <td>{displayDetailsName(user.details, user.email)}</td>
                  <td>{user.email}</td>
                  <td>{user.details?.phone_number || '-'}</td>
                  <td>{user.details?.birthday || '-'}</td>
                  <td>{user.details?.role || '-'}</td>
                  <td>{user.details?.branch || '-'}</td>
                  <td>{user.details?.emergency_contact_name || '-'}</td>
                  <td>{complete ? 'Complete' : 'First login required'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
