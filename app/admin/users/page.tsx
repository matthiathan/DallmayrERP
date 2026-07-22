import { AdminUserAccessControl } from '@/components/features/AdminUserAccessControl';
import { AppShell } from '@/components/layout/AppShell';

export default function UsersPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Administrator only</div>
          <h1>Users, Roles &amp; Access Rights</h1>
          <p>Add or remove users, change their role and branch, and suspend or restore ERP access.</p>
        </div>
      </div>
      <AdminUserAccessControl />
    </AppShell>
  );
}
