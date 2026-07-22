import { OperationsManagerDashboard } from '@/components/features/OperationsManagerDashboard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsDashboardPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations Manager</div>
          <h1>Operations Control</h1>
          <p>Plan routes, dispatch service work, control deliveries, monitor maintenance and resolve branch exceptions.</p>
        </div>
      </div>
      <OperationsManagerDashboard />
    </AppShell>
  );
}
