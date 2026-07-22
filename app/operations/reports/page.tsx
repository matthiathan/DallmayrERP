import { OperationsPerformanceReport } from '@/components/features/OperationsPerformanceReport';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsReportsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations Manager</div>
          <h1>Operations Performance</h1>
          <p>Measure service coverage, route planning, overdue work and delivery execution by date and branch.</p>
        </div>
      </div>
      <OperationsPerformanceReport />
    </AppShell>
  );
}
