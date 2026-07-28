import { OperationsDispatchOverview } from '@/components/features/OperationsDispatchOverview';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsDispatchPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card dispatch-page-header">
        <div>
          <div className="badge">Operations</div>
          <h1>Dispatch Overview</h1>
          <p>See route gaps, service exceptions, delivery pressure and technician workload in one operational view.</p>
        </div>
      </div>
      <OperationsDispatchOverview />
    </AppShell>
  );
}
