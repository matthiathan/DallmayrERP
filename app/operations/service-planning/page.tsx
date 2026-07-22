import { DailyServicePlanner } from '@/components/features/DailyServicePlanner';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsServicePlanningPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Daily Service Route Planner</h1>
          <p>Plan each driver’s route from paid monthly obligations and customer-requested service work.</p>
        </div>
      </div>
      <DailyServicePlanner />
    </AppShell>
  );
}
