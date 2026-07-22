'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { EnterpriseDataTable, type EnterpriseColumn } from '@/components/ui/EnterpriseDataTable';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { roleLabels } from '@/lib/auth/permissions';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Branch, BusinessRole } from '@/types/dallmayrerp';

const roles: BusinessRole[] = [
  'admin',
  'operations',
  'sales',
  'finance',
  'marketing',
  'executive',
  'warehouse_staff',
  'technician',
  'road_technician',
];

const branches: Branch[] = ['jhb', 'cpt', 'kzn', 'national'];

const branchLabels: Record<Branch, string> = {
  jhb: 'Johannesburg',
  cpt: 'Cape Town',
  kzn: 'KwaZulu-Natal',
  national: 'National',
};

const roleRights: Record<BusinessRole, { summary: string; rights: string[] }> = {
  admin: {
    summary: 'Full ERP administration and unrestricted module access.',
    rights: ['Manage users and roles', 'All operational modules', 'Finance and executive reporting', 'System audit and configuration'],
  },
  operations: {
    summary: 'Operations Manager control for service, routes, assets, deliveries and inventory.',
    rights: ['Daily service planning', 'Technician assignment', 'Asset and maintenance control', 'Inventory and operational reports'],
  },
  sales: {
    summary: 'Customer and sales-account activity without operational or finance administration.',
    rights: ['Customer directory', 'Sales workspace', 'Own requests and assigned work'],
  },
  finance: {
    summary: 'Commercial review, approvals and monthly-service payment control.',
    rights: ['Finance workspace', 'Purchase approvals', 'Monthly service coverage', 'Finance-assigned work'],
  },
  marketing: {
    summary: 'Campaign, segment, renewal and customer marketing access.',
    rights: ['Marketing dashboard', 'Campaigns and segments', 'Contract renewals', 'Customer directory'],
  },
  executive: {
    summary: 'Read-focused national oversight and executive reporting.',
    rights: ['Command centre', 'Branch and contract reporting', 'Service performance', 'Warehouse risk'],
  },
  warehouse_staff: {
    summary: 'Warehouse execution, stock movement, purchasing and traceability.',
    rights: ['Stock control', 'Purchase receiving', 'Locations and traceability', 'Inventory ledger'],
  },
  technician: {
    summary: 'Assigned technical work only; technicians cannot create or request tasks.',
    rights: ['Assigned technician jobs', 'Work execution', 'Reliability capture', 'Machine lookup'],
  },
  road_technician: {
    summary: 'Assigned field, route, delivery and technical work only.',
    rights: ['Assigned routes and deliveries', 'Work execution', 'Reliability capture', 'Machine lookup'],
  },
};

type UserAccessRow = {
  user_id: string;
  email: string;
  is_active: boolean;
  access_note: string | null;
  role: BusinessRole | null;
  branch: Branch | null;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  birthday: string | null;
  emergency_contact_name: string | null;
  profile_complete: boolean;
  created_at: string;
  updated_at: string;
  access_updated_at: string | null;
};

type CreateForm = {
  email: string;
  role: BusinessRole;
  branch: Branch;
  isActive: boolean;
  note: string;
};

const emptyCreateForm: CreateForm = {
  email: '',
  role: 'operations',
  branch: 'jhb',
  isActive: true,
  note: '',
};

function displayName(row: UserAccessRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.email;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminUserAccessControl() {
  const { businessUser } = useAuth();
  const [users, setUsers] = useState<UserAccessRow[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreateForm);
  const [editRole, setEditRole] = useState<BusinessRole>('operations');
  const [editBranch, setEditBranch] = useState<Branch>('jhb');
  const [editActive, setEditActive] = useState(true);
  const [editNote, setEditNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const selectedUser = useMemo(
    () => users.find((user) => user.user_id === selectedUserId) ?? null,
    [selectedUserId, users],
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await getSupabaseClient().rpc('admin_list_user_access');
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as UserAccessRow[];
    setUsers(rows);
    setSelectedUserId((current) => current && rows.some((row) => row.user_id === current) ? current : null);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load user access records.');
      setLoading(false);
    });
  }, [loadUsers]);

  useEffect(() => {
    if (!selectedUser) return;
    setEditRole(selectedUser.role ?? 'operations');
    setEditBranch(selectedUser.branch ?? 'jhb');
    setEditActive(selectedUser.is_active);
    setEditNote(selectedUser.access_note ?? '');
  }, [selectedUser]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const cleanEmail = createForm.email.trim().toLowerCase();
    const { data, error: createError } = await getSupabaseClient().rpc('admin_create_user_access', {
      p_email: cleanEmail,
      p_role: createForm.role,
      p_branch: createForm.branch,
      p_is_active: createForm.isActive,
      p_access_note: createForm.note.trim() || null,
    });

    setSaving(false);
    if (createError) {
      setError(createError.message);
      return;
    }

    setMessage(`${cleanEmail} was added as ${roleLabels[createForm.role]} with ${createForm.isActive ? 'active' : 'suspended'} access.`);
    setCreateForm(emptyCreateForm);
    await loadUsers();
    if (data) setSelectedUserId(String(data));
  }

  async function saveUserAccess() {
    if (!selectedUser) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: saveError } = await getSupabaseClient().rpc('admin_update_user_access', {
      p_user_id: selectedUser.user_id,
      p_role: editRole,
      p_branch: editBranch,
      p_is_active: editActive,
      p_access_note: editNote.trim() || null,
    });

    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }

    setMessage(`${displayName(selectedUser)} now has ${roleLabels[editRole]} rights for ${branchLabels[editBranch]}. Access is ${editActive ? 'active' : 'suspended'}.`);
    await loadUsers();
  }

  async function deleteUnusedInvite() {
    if (!selectedUser) return;

    const confirmed = window.confirm(
      `Permanently delete the unused ERP access record for ${displayName(selectedUser)}? Users with operational history cannot be deleted and must be suspended instead.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setMessage(null);

    const { error: deleteError } = await getSupabaseClient().rpc('admin_delete_user_access', {
      p_user_id: selectedUser.user_id,
    });

    setDeleting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setMessage(`${selectedUser.email} was removed from DallmayrERP access.`);
    setSelectedUserId(null);
    await loadUsers();
  }

  const metrics = useMemo(() => ({
    active: users.filter((user) => user.is_active).length,
    suspended: users.filter((user) => !user.is_active).length,
    administrators: users.filter((user) => user.is_active && user.role === 'admin').length,
    incomplete: users.filter((user) => !user.profile_complete).length,
  }), [users]);

  const columns = useMemo<EnterpriseColumn<UserAccessRow>[]>(() => [
    {
      id: 'select',
      header: 'Manage',
      filterable: false,
      defaultWidth: 105,
      value: (row) => row.user_id,
      render: (row) => (
        <button
          className={`button secondary compact-action ${selectedUserId === row.user_id ? 'is-selected' : ''}`}
          onClick={() => setSelectedUserId(row.user_id)}
          type="button"
        >
          Select
        </button>
      ),
    },
    {
      id: 'user',
      header: 'User',
      value: (row) => `${displayName(row)} ${row.email}`,
      render: (row) => <strong>{displayName(row)}<small>{row.email}</small></strong>,
      defaultWidth: 285,
    },
    {
      id: 'status',
      header: 'Access',
      value: (row) => row.is_active ? 'active' : 'suspended',
      render: (row) => <StatusBadge value={row.is_active ? 'active' : 'inactive'} label={row.is_active ? 'Active' : 'Suspended'} />,
      defaultWidth: 135,
    },
    {
      id: 'role',
      header: 'Role and rights',
      value: (row) => row.role ? roleLabels[row.role] : 'unassigned',
      render: (row) => <span>{row.role ? roleLabels[row.role] : 'Role not assigned'}</span>,
      defaultWidth: 190,
    },
    {
      id: 'branch',
      header: 'Branch',
      value: (row) => row.branch ? branchLabels[row.branch] : '',
      render: (row) => <span>{row.branch ? branchLabels[row.branch] : 'Not assigned'}</span>,
      defaultWidth: 155,
    },
    {
      id: 'profile',
      header: 'Profile',
      value: (row) => row.profile_complete ? 'complete' : 'first login required',
      render: (row) => <StatusBadge value={row.profile_complete ? 'completed' : 'pending'} label={row.profile_complete ? 'Complete' : 'First login required'} />,
      defaultWidth: 190,
    },
    {
      id: 'contact',
      header: 'Contact',
      value: (row) => `${row.phone_number ?? ''} ${row.emergency_contact_name ?? ''}`,
      render: (row) => <span>{row.phone_number || 'No phone'}<small>{row.emergency_contact_name ? `Emergency: ${row.emergency_contact_name}` : 'No emergency contact'}</small></span>,
      defaultWidth: 225,
    },
    {
      id: 'updated',
      header: 'Access updated',
      value: (row) => row.access_updated_at ?? row.updated_at,
      render: (row) => <span>{formatDate(row.access_updated_at ?? row.updated_at)}</span>,
      defaultWidth: 185,
    },
  ], [selectedUserId]);

  const isSelf = selectedUser?.user_id === businessUser?.id;
  const selectedRights = roleRights[editRole];
  const createRights = roleRights[createForm.role];

  return (
    <div className="admin-access-stage">
      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      <PageToolbar
        actions={<button className="button secondary" disabled={loading} onClick={loadUsers} type="button">{loading ? 'Refreshing…' : 'Refresh users'}</button>}
        description="Administrators can add users, assign role-based rights, change roles and branches, suspend or restore access, and remove unused invites."
        lastUpdated={lastUpdated}
        title="User access control"
      />

      <section aria-label="User access totals" className="grid grid-4 admin-access-kpis">
        <KpiCard label="Active users" value={metrics.active} helper="Users currently permitted to enter the ERP." />
        <KpiCard label="Suspended users" value={metrics.suspended} helper="Profiles retained with all ERP rights revoked." />
        <KpiCard label="Active administrators" value={metrics.administrators} helper="The final active Administrator is protected." />
        <KpiCard label="Profiles incomplete" value={metrics.incomplete} helper="Users who still need to complete first-login details." />
      </section>

      <section className="neo-card admin-access-section">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">Add user</span>
            <h2>Create an ERP access record</h2>
            <p>Rights are assigned through the selected role so navigation, RLS and database functions remain aligned.</p>
          </div>
        </div>

        <form className="admin-access-create-grid" onSubmit={createUser}>
          <label>Email address
            <input
              autoCapitalize="none"
              autoComplete="off"
              required
              spellCheck={false}
              type="email"
              value={createForm.email}
              onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
            />
          </label>
          <label>Role and rights
            <select value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value as BusinessRole }))}>
              {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </select>
          </label>
          <label>Branch
            <select value={createForm.branch} onChange={(event) => setCreateForm((current) => ({ ...current, branch: event.target.value as Branch }))}>
              {branches.map((branch) => <option key={branch} value={branch}>{branchLabels[branch]}</option>)}
            </select>
          </label>
          <label className="admin-access-toggle">
            <input checked={createForm.isActive} type="checkbox" onChange={(event) => setCreateForm((current) => ({ ...current, isActive: event.target.checked }))} />
            <span>Activate access immediately</span>
          </label>
          <label className="admin-access-note">Access note
            <textarea value={createForm.note} onChange={(event) => setCreateForm((current) => ({ ...current, note: event.target.value }))} placeholder="Reason, approval reference or temporary restriction." />
          </label>
          <div className="role-rights-preview">
            <strong>{roleLabels[createForm.role]} rights</strong>
            <p>{createRights.summary}</p>
            <div>{createRights.rights.map((right) => <span key={right}>{right}</span>)}</div>
          </div>
          <button className="button" disabled={saving} type="submit">{saving ? 'Adding user…' : 'Add user and rights'}</button>
        </form>
      </section>

      <section className="neo-card admin-access-section">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">Existing users</span>
            <h2>Select a user to change access</h2>
            <p>Every heading supports contains search, and the table includes its own bottom horizontal scrollbar.</p>
          </div>
        </div>

        {loading ? <HamsterLoader label="Loading users and access rights" /> : (
          <EnterpriseDataTable
            columns={columns}
            defaultPageSize={50}
            emptyMessage="No ERP access records were found."
            getSearchText={(row) => [displayName(row), row.email, row.role, row.branch, row.is_active ? 'active' : 'suspended', row.phone_number].join(' ')}
            rowKey={(row) => row.user_id}
            rows={users}
            searchPlaceholder="Search name, email, role, branch or access status"
            tableId="admin-user-access"
          />
        )}
      </section>

      <section className="neo-card admin-access-section admin-access-editor">
        <div className="minimal-panel-header">
          <div>
            <span className="minimal-kicker">Role and rights editor</span>
            <h2>{selectedUser ? displayName(selectedUser) : 'Select a user from the table'}</h2>
            <p>{selectedUser ? selectedUser.email : 'Role, branch, access status and removal controls will appear here.'}</p>
          </div>
          {selectedUser ? <StatusBadge value={selectedUser.is_active ? 'active' : 'inactive'} label={selectedUser.is_active ? 'Current access: Active' : 'Current access: Suspended'} /> : null}
        </div>

        {selectedUser ? (
          <div className="admin-access-editor-grid">
            <div className="admin-access-editor-panel">
              <div className="form-grid">
                <label>Role and rights
                  <select disabled={isSelf || saving} value={editRole} onChange={(event) => setEditRole(event.target.value as BusinessRole)}>
                    {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                </label>
                <label>Branch
                  <select disabled={saving} value={editBranch} onChange={(event) => setEditBranch(event.target.value as Branch)}>
                    {branches.map((branch) => <option key={branch} value={branch}>{branchLabels[branch]}</option>)}
                  </select>
                </label>
              </div>

              <label className="admin-access-toggle">
                <input disabled={isSelf || saving} checked={editActive} type="checkbox" onChange={(event) => setEditActive(event.target.checked)} />
                <span>{editActive ? 'ERP access active' : 'ERP access suspended — all rights removed'}</span>
              </label>

              <label>Administrative access note
                <textarea disabled={saving} value={editNote} onChange={(event) => setEditNote(event.target.value)} placeholder="Reason for role, branch or access change." />
              </label>

              {isSelf ? <div className="info">Your own Administrator role and active status are protected while you are signed in. You may still update your branch or access note.</div> : null}

              <div className="action-row">
                <button className="button" disabled={saving} onClick={saveUserAccess} type="button">{saving ? 'Saving access…' : 'Save role and rights'}</button>
                <button className="button secondary danger-action" disabled={deleting || isSelf} onClick={deleteUnusedInvite} type="button">{deleting ? 'Deleting…' : 'Delete unused invite'}</button>
              </div>
            </div>

            <aside className="role-rights-preview selected-role-rights">
              <strong>{roleLabels[editRole]} rights</strong>
              <p>{selectedRights.summary}</p>
              <div>{selectedRights.rights.map((right) => <span key={right}>{right}</span>)}</div>
              <small>Changing the role replaces the user’s role-based rights. Suspending access removes all effective ERP permissions while preserving operational history.</small>
            </aside>
          </div>
        ) : <div className="empty-state compact-empty-state">Select a user to change role, branch, rights or access status.</div>}
      </section>
    </div>
  );
}
