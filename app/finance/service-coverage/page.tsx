import { FinanceServiceCoverage } from '@/components/features/FinanceServiceCoverage';
import { AppShell } from '@/components/layout/AppShell';

export default function FinanceServiceCoveragePage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Finance</div>
          <h1>Monthly Service Coverage</h1>
          <p>Confirm paid monthly-service customers and identify paid accounts that were not serviced.</p>
        </div>
      </div>
      <FinanceServiceCoverage />
    </AppShell>
  );
}
