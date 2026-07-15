import { ServiceJobBoard } from '@/components/features/ServiceJobBoard';
import { AppShell } from '@/components/layout/AppShell';

export default function OperationsServiceJobsPage() {
  return (
    <AppShell>
      <div className="page-header hero-panel spatial-card">
        <div>
          <div className="badge">Operations</div>
          <h1>Service Jobs</h1>
          <p>Create, prioritise and manage service work across branches and technicians.</p>
        </div>
      </div>
      <ServiceJobBoard />
    </AppShell>
  );
}
