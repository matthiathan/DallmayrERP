'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminUserAccessControl } from '@/components/features/AdminUserAccessControl';
import { HamsterLoader } from '@/components/ui/HamsterLoader';
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

type UserAccessRow = {
  user_id: string;
  email: string;
  is_active: boolean;
  access_note: string | null;
  role: BusinessRole | null;
  branch: Branch | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
};

type PendingDraft = {
  role: BusinessRole;
  branch: Branch;
};

const defaultDraft: PendingDraft = {
  role: 'operations',
  branch: 'jhb',
};

function displayName(row: UserAccessRow) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.email;
}

function formatRequestedAt(value: string) {
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PendingUserApprovals({ onApproved }: { onApproved: () => void }) {
  const [pendingUsers, setPendingUsers] = useState<UserAccessRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PendingDraft>>({});
  const [loading, setLoading] = useState(true);
  const [approvingUserId, setApprovingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const loadPendingUsers = useCallback(async () => {
    const { data, error: loadError } = await getSupabaseClient().rpc('admin_list_user_access');

    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }

    const rows = ((data ?? []) as UserAccessRow[]).filter((row) => row.role === null || row.branch === null);
    setPendingUsers(rows);
    setDrafts((current) => {
      const next: Record<string, PendingDraft> = {};
      for (const row of rows) {
        next[row.user_id] = current[row.user_id] ?? {
          role: row.role ?? defaultDraft.role,
          branch: row.branch ?? defaultDraft.branch,
        };
      }
      return next;
    });
    setLastChecked(new Date());
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPendingUsers().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not check for pending user approvals.');
      setLoading(false);
    });

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        loadPendingUsers().catch(() => undefined);
      }
    };

    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadPendingUsers]);

  const pendingCountLabel = useMemo(
    () => `${pendingUsers.length} ${pendingUsers.length === 1 ? 'user' : 'users'} waiting for access approval`,
    [pendingUsers.length],
  );

  function updateDraft(userId: string, patch: Partial<PendingDraft>) {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] ?? defaultDraft),
        ...patch,
      },
    }));
  }

  async function approveUser(row: UserAccessRow) {
    const draft = drafts[row.user_id] ?? defaultDraft;
    setApprovingUserId(row.user_id);
    setError(null);
    setMessage(null);

    const { error: approvalError } = await getSupabaseClient().rpc('admin_update_user_access', {
      p_user_id: row.user_id,
      p_role: draft.role,
      p_branch: draft.branch,
      p_is_active: true,
      p_access_note: row.access_note?.trim() || null,
    });

    setApprovingUserId(null);

    if (approvalError) {
      setError(approvalError.message);
      return;
    }

    setMessage(
      `${displayName(row)} was approved as ${roleLabels[draft.role]} for ${branchLabels[draft.branch]}. They can now sign in and complete their profile.`,
    );
    await loadPendingUsers();
    onApproved();
  }

  if (loading) {
    return (
      <section aria-label="Pending user access approvals" className="neo-card admin-access-section admin-pending-approvals">
        <HamsterLoader label="Checking for pending user access approvals" />
      </section>
    );
  }

  if (!pendingUsers.length && !error && !message) return null;

  return (
    <section aria-labelledby="pending-access-title" className="neo-card admin-access-section admin-pending-approvals">
      <div className="admin-pending-notice">
        <div>
          <span className="minimal-kicker">Administrator notification</span>
          <h2 id="pending-access-title">Pending access approvals</h2>
          <p>
            These users have an ERP account but no assigned role and branch. Approving an entry creates the missing access details and unlocks first-login onboarding.
          </p>
        </div>
        <div aria-live="polite" className="admin-pending-count">
          <strong>{pendingUsers.length}</strong>
          <span>{pendingUsers.length === 1 ? 'approval required' : 'approvals required'}</span>
        </div>
      </div>

      {error ? <div className="error" role="alert">{error}</div> : null}
      {message ? <div className="success" role="status">{message}</div> : null}

      {pendingUsers.length ? (
        <>
          <div className="info" role="status">
            <strong>Action required</strong>
            <span>{pendingCountLabel}. Assign the correct role and branch before approving.</span>
          </div>

          <div className="admin-pending-grid">
            {pendingUsers.map((row) => {
              const draft = drafts[row.user_id] ?? defaultDraft;
              const approving = approvingUserId === row.user_id;

              return (
                <article className="admin-pending-card" key={row.user_id}>
                  <div className="admin-pending-card-heading">
                    <div>
                      <strong>{displayName(row)}</strong>
                      <span>{row.email}</span>
                    </div>
                    <span className="badge">Approval pending</span>
                  </div>

                  <div className="admin-pending-meta">
                    <span>Requested / created: {formatRequestedAt(row.created_at)}</span>
                    <span>Current access: {row.is_active ? 'active record, role pending' : 'suspended record'}</span>
                  </div>

                  <div className="admin-pending-form">
                    <label>
                      Role and rights
                      <select
                        aria-label={`Role for ${row.email}`}
                        disabled={approving}
                        value={draft.role}
                        onChange={(event) => updateDraft(row.user_id, { role: event.target.value as BusinessRole })}
                      >
                        {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                      </select>
                    </label>
                    <label>
                      Branch
                      <select
                        aria-label={`Branch for ${row.email}`}
                        disabled={approving}
                        value={draft.branch}
                        onChange={(event) => updateDraft(row.user_id, { branch: event.target.value as Branch })}
                      >
                        {branches.map((branch) => <option key={branch} value={branch}>{branchLabels[branch]}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="admin-pending-actions">
                    <button
                      className="button"
                      disabled={approvingUserId !== null}
                      onClick={() => approveUser(row)}
                      type="button"
                    >
                      {approving ? 'Approving access…' : 'Approve access'}
                    </button>
                    <small>Approval activates ERP access. The user will then complete their personal profile on first login.</small>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="success" role="status">No users are currently waiting for role and branch approval.</div>
      )}

      {lastChecked ? <small className="admin-pending-last-checked">Last checked {lastChecked.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</small> : null}
    </section>
  );
}

export function AdminUsersWorkspace() {
  const [accessControlVersion, setAccessControlVersion] = useState(0);

  return (
    <div className="admin-users-workspace">
      <PendingUserApprovals onApproved={() => setAccessControlVersion((current) => current + 1)} />
      <AdminUserAccessControl key={accessControlVersion} />
    </div>
  );
}
