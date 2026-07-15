import { AdminActivityLog } from '@/components/features/AdminActivityLog';
import { AppShell } from '@/components/layout/AppShell';

export default function AdminActivityPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel">
        <div>
          <div className="badge">Admin control</div>
          <h1>Activity Log</h1>
          <p>Enterprise audit trail for important user, stock, order, service, document and system events.</p>
        </div>
      </div>
      <AdminActivityLog />
    </AppShell>
  );
}
