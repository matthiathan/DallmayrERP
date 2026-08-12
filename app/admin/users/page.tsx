import { AdminUsersWorkspace } from '@/components/features/AdminUsersWorkspace';
import { AppShell } from '@/components/layout/AppShell';

export default function UsersPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Administrator only</div>
          <h1>Users, Roles &amp; Access Rights</h1>
          <p>Approve pending users, assign their role and branch, add or remove users, and suspend or restore ERP access.</p>
        </div>
      </div>
      <AdminUsersWorkspace />
    </AppShell>
  );
}
